// daemon.ts — tg-bridge entry point.
// Wires the lib modules (telegram client, socket server, render
// engine, bindings/replay state) into a single long-polling daemon.
//
// Outbound-only: long-poll HTTPS to Telegram + a unix-socket listener for the
// in-session extension. No inbound ports.
//
// Env: TG_BRIDGE_STATE_DIR, TG_BRIDGE_SOCK, TG_BRIDGE_OMP_BIN, TG_BRIDGE_API_BASE.

import {
  createWriteStream,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import {
  addReplayEntry,
  ensureStateDir,
  getReplayEntries,
  readBindings,
  readConfig,
  readReplay,
  readStateDir,
  setBindingForTopic,
  updateBindingEvent,
  writeBindings,
  writeReplay,
  type Binding,
  type Config,
  type Verbosity,
} from "./lib/bindings";
import {
  ConflictError,
  TelegramClient,
  type TelegramMessage,
  type TelegramUpdate,
} from "./lib/telegram";
import { SocketManager, type QuestionFrame, type SessionState } from "./lib/socket";
import { RenderEngine } from "./lib/render";

// ─── Persistent helpers ──────────────────────────────────────────────────────

function offsetPath(): string {
  return join(readStateDir(), "offset.json");
}

function readOffset(): number {
  try {
    const raw = readFileSync(offsetPath(), "utf8");
    const parsed = JSON.parse(raw) as { offset?: number };
    return parsed.offset ?? 0;
  } catch {
    return 0;
  }
}

function writeOffset(offset: number): void {
  try {
    writeFileSync(offsetPath(), JSON.stringify({ offset }, null, 2));
  } catch {
    // non-fatal
  }
}

// ─── Daemon state ────────────────────────────────────────────────────────────

interface PendingQuestion {
  cwd: string;
  questionId: string;
  options: string[];
}

interface Daemon {
  config: Config;
  stateDir: string;
  apiBase: string;
  log: ReturnType<typeof createWriteStream>;
  client: TelegramClient;
  socket: SocketManager;
  render: RenderEngine;
  bindings: Map<number, Binding>;
  replay: Map<number, { text: string }[]>;
  pending: Map<string, PendingQuestion>;
  qCounter: number;
  offset: number;
  socketPath: string;
  /** topicId → currently-active turnId; live progress lines edit only the active turn's message. */
  activeTurn: Map<number, string>;
  typingTimers: Map<string, number>;
  lastTodos: Map<string, { content: string; status: string }[]>;
}

function logMsg(d: Daemon, msg: string): void {
  try {
    d.log.write(`[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // ignore log write failures
  }
}

/** Human-readable age string from milliseconds. */
function formatAge(ms: number): string {
  if (ms < 0) return "in the future";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ─── Reverse lookup helpers ──────────────────────────────────────────────────

function topicForCwd(d: Daemon, cwd: string): number | undefined {
  for (const [topicId, b] of d.bindings) {
    if (b.cwd === cwd) return topicId;
  }
  return undefined;
}
/** Next unused topic id: max(existing topic ids) + 1. */
function nextTopicId(bindings: Map<number, Binding>): number {
  let max = 0;
  for (const k of bindings.keys()) if (k > max) max = k;
  return max + 1;
}

// ─── Telegram send helpers ───────────────────────────────────────────────────

/** Escape for Telegram's HTML parse mode (the extension sends already-formatted HTML). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tgSend(
  d: Daemon,
  text: string,
  topicId?: number,
  replyMarkup?: unknown,
  html?: boolean,
): Promise<void> {
  try {
    const opts: { parse_mode?: string; reply_markup?: unknown; message_thread_id?: number } =
      {};
    if (topicId !== undefined) opts.message_thread_id = topicId;
    if (replyMarkup !== undefined) opts.reply_markup = replyMarkup;
    if (html) opts.parse_mode = "HTML";
    await d.client.sendMessage(d.config.groupId, text, opts);
  } catch (err) {
    logMsg(d, `sendMessage failed: ${(err as Error).message}`);
  }
}

// ─── Question rendering (keyboard) ───────────────────────────────────────────

async function publishQuestion(
  d: Daemon,
  topicId: number,
  title: string,
  options: string[],
  handle: string,
): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      options.map((opt, idx) => ({
        text: opt.length > 64 ? `${escapeHtml(opt.slice(0, 64))}…` : escapeHtml(opt),
        callback_data: `q:${handle}:${idx}`,
      })),
    ],
  };
  await tgSend(d, title, topicId, keyboard, true);
}

function handleCallbackData(d: Daemon, data: string): void {
  // format: q:<handle>:<idx>
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "q") return;
  const handle = parts[1];
  const idx = Number(parts[2]);
  const pending = d.pending.get(handle);
  if (!pending) return;
  d.pending.delete(handle);
  const value = pending.options[idx] ?? "";
  d.socket.sendFrame(pending.cwd, { type: "answer", id: pending.questionId, value });
  logMsg(d, `answer for ${pending.cwd} q=${pending.questionId} idx=${idx}`);
}

// ─── Command dispatch ────────────────────────────────────────────────────────

async function handleCommand(
  d: Daemon,
  text: string,
  topicId: number,
): Promise<void> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ").trim();
  const binding = d.bindings.get(topicId);
  const cwd = binding?.cwd;

  switch (cmd) {
    case "/help": {
      await tgSend(
        d,
        [
          "Commands (this topic):",
          "/status — daemon + session status",
          "/abort — abort the current turn (process keeps running)",
          "/bind <cwd> — bind this topic to a workspace",
          "/replay [N] — resend last N progress entries",
          "/ask <question> — pose a question with inline buttons",
          "/pair <cwd> — pair this topic with a workspace (auto-bind)",
          "/unpair — unbind this topic",
          "/remote on|off — toggle remote for this topic",
          "Free text — steer (running) / new turn (idle); trailing `??` always delivers the next turn's final answer",
          "/btw <question> — side question, answered immediately (does not steer the turn)",
          "/pair /unpair — DM pairing (admin)",
        ].join("\n"),
        topicId,
      );
      return;
    }

    case "/bind": {
      if (!arg) {
        await tgSend(d, "Usage: /bind <cwd>", topicId);
        return;
      }
      if (!existsSync(arg)) {
        await tgSend(d, `Path does not exist: ${arg}`, topicId);
        return;
      }
      setBindingForTopic(d.bindings, topicId, arg);
      updateBindingEvent(d.bindings, topicId);
      writeBindings(d.bindings);
      logMsg(d, `bound topic ${topicId} -> ${arg}`);
      await tgSend(d, `Bound topic to ${arg} (${basename(arg)})`, topicId);
      return;
    }

    case "/status": {
      const b = binding;
      const cwdStr: string | undefined = b?.cwd;
      const session = cwdStr ? d.socket.getSession(cwdStr) : undefined;
      const remoteOn = session?.remoteOn ?? false;
      const sessionCount = d.socket.getSessionCount();
      const lines: string[] = [
        `Workspace: ${b?.cwd ?? "(unbound)"}`,
        `Remote: ${remoteOn ? "on" : "off"}  Verbosity: ${b?.verbosity ?? "mid"}`,
        `Live session: ${session ? `${session.sessionId} (turn ${session.turnLive ? "live" : "idle"})` : "none"}`,
        `Active sessions: ${sessionCount}`,
      ];
      if (session) {
        const ageMs = Date.now() - session.lastEventAt;
        const ageStr = formatAge(ageMs);
        lines.push(`Last event: ${ageStr}`);
        if (cwdStr) {
          const todos = d.lastTodos.get(cwdStr);
          if (todos && todos.length > 0) {
            lines.push("Todos:");
            for (const t of todos.slice(0, 5)) {
              lines.push(`  - ${t.content} [${t.status}]`);
            }
          }
        }
      } else {
        lines.push("Last event: no session connected");
        const todos = cwdStr ? d.lastTodos.get(cwdStr) : undefined;
        if (todos && todos.length > 0) {
          lines.push("Last-known todos:");
          for (const t of todos.slice(0, 5)) {
            lines.push(`  - ${t.content} [${t.status}]`);
          }
        }
      }
      await tgSend(d, lines.join("\n"), topicId);
      return;
    }

    case "/abort": {
      if (!cwd) {
        await tgSend(d, "This topic is not bound.", topicId);
        return;
      }
      const sent = d.socket.sendFrame(cwd, { type: "abort" });
      await tgSend(
        d,
        sent ? "Abort sent to live session." : "No live session to abort.",
        topicId,
      );
      return;
    }

    case "/replay": {
      const n = Math.max(1, Math.min(100, Number(arg) || 10));
      const entries = getReplayEntries(d.replay, topicId).slice(-n);
      if (entries.length === 0) {
        await tgSend(d, "No progress recorded for this topic yet.", topicId);
        return;
      }
      for (const e of entries) {
        for (const chunk of d.client.splitHtmlAware(e.text)) await tgSend(d, chunk, topicId, undefined, true);
      }
      return;
    }

    case "/ask": {
      // Pose a free-form question with inline buttons. The tap routes back as an
      // `answer` frame to the live session for this workspace's cwd.
      const title = arg || "(no question text)";
      const options = ["Confirm"];
      const handle = String(++d.qCounter);
      d.pending.set(handle, { cwd: cwd ?? "", questionId: handle, options });
      if (!cwd) {
        await tgSend(d, `Cannot answer: topic not bound. Question discarded.`, topicId);
        d.pending.delete(handle);
        return;
      }
      await publishQuestion(d, topicId, escapeHtml(title), options, handle);
      return;
    }
    case "/btw": {
      // Side question: answered immediately by a one-shot AI call in the
      // extension (not routed into the running turn).
      if (!cwd) {
        await tgSend(d, "This topic is not bound.", topicId);
        return;
      }
      if (!arg) {
        await tgSend(d, "Usage: /btw <question> — side question, answered immediately", topicId);
        return;
      }
      const session = d.socket.getSession(cwd);
      if (!session || !session.remoteOn) {
        await tgSend(d, "No live session (or remote is off).", topicId);
        return;
      }
      await tgSend(d, "💭 Thinking…", topicId);
      const sent = d.socket.sendFrame(cwd, { type: "btw", question: arg });
      if (!sent) {
        await tgSend(d, "Failed to deliver question to session.", topicId);
        return;
      }
      logMsg(d, `btw question for ${cwd}: ${arg.slice(0, 80)}`);
      return;
    }

    case "/pair": {
      if (!arg) {
        await tgSend(d, "Usage: /pair <cwd>", topicId);
        return;
      }
      if (!existsSync(arg)) {
        await tgSend(d, `Path does not exist: ${arg}`, topicId);
        return;
      }
      setBindingForTopic(d.bindings, topicId, arg);
      updateBindingEvent(d.bindings, topicId);
      writeBindings(d.bindings);
      logMsg(d, `paired topic ${topicId} -> ${arg}`);
      await tgSend(d, `Paired topic to ${arg} (${basename(arg)})`, topicId);
      return;
    }

    case "/unpair": {
      d.bindings.delete(topicId);
      writeBindings(d.bindings);
      logMsg(d, `unpaired topic ${topicId}`);
      await tgSend(d, `Unpaired topic ${topicId}.`, topicId);
      return;
    }

    case "/remote": {
      if (!cwd) {
        await tgSend(d, "This topic is not bound.", topicId);
        return;
      }
      const onOff = arg?.toLowerCase();
      if (onOff !== "on" && onOff !== "off") {
        await tgSend(d, "Usage: /remote on|off", topicId);
        return;
      }
      const session = d.socket.getSession(cwd);
      if (session) {
        session.remoteOn = onOff === "on";
      }
      const b = d.bindings.get(topicId);
      if (b) {
        b.remoteOn = onOff === "on";
        updateBindingEvent(d.bindings, topicId, session?.sessionId, session?.sessionFile);
        writeBindings(d.bindings);
      }
      if (session) {
        d.socket.sendFrame(cwd, {
          type: "config",
          enabled: onOff === "on",
          verbosity: session.verbosity,
        });
      }
      await tgSend(d, `Remote ${onOff} for ${cwd}.`, topicId);
      return;
    }

    default:
      // Unknown command — treat as free text below.
      return;
  }
}

// ─── Message routing ─────────────────────────────────────────────────────────

async function handleMessage(d: Daemon, msg: TelegramMessage): Promise<void> {
  const from = msg.from?.id;
  if (from === undefined) return;

  // Live whitelist check (config.json may be edited at runtime).
  const cfg = readConfig();
  if (!cfg || !cfg.allowedUserIds.includes(from)) {
    // Only /pair / /unpair are accepted outside the whitelist (DM pairing).
    const isPairCmd =
      (msg.text ?? "").trim().startsWith("/pair") || (msg.text ?? "").trim().startsWith("/unpair");
    if (!isPairCmd) return;
  }

  const text = msg.text ?? "";
  const isGroup = msg.chat.type !== "private" && msg.chat.id === d.config.groupId;

  // DM pairing commands (not in the group).
  if (!isGroup) {
    if (text.trim().startsWith("/pair")) {
      const c = readConfig();
      if (c && !c.allowedUserIds.includes(from)) {
        c.allowedUserIds.push(from);
        writeConfigLive(c);
        logMsg(d, `paired user ${from}`);
      }
      await tgSend(d, `Pairing complete for user ${from}. You are now in the whitelist.`, Number(msg.chat.id));
      return;
    }
    if (text.trim().startsWith("/unpair")) {
      const c = readConfig();
      if (c) {
        c.allowedUserIds = c.allowedUserIds.filter((u) => u !== from);
        writeConfigLive(c);
      }
      await tgSend(d, `Unpaired user ${from}.`, Number(msg.chat.id));
      return;
    }
    // Other non-group messages are ignored.
    return;
  }

  // In-group: must be a forum topic (message_thread_id) to route to a workspace.
  const topicId = msg.message_thread_id ?? msg.reply_to_message?.message_thread_id ?? 0;

  if (text.trim().startsWith("/") && text.includes("\n") === false) {
    // A command.
    await handleCommand(d, text, topicId);
    return;
  }

  // Free text → prompt to the live session for this topic's cwd.
  const binding = d.bindings.get(topicId);

  // Auto-pair: if whitelist is empty and this is the first group message,
  // bind this topic to the cwd from the binding (if any).
  if (!binding && cfg !== null && cfg.allowedUserIds.length === 0) {
    // No binding exists; look for a cwd from an existing binding's cwd
    // that matches this message's context. For now, skip auto-pair without
    // a cwd hint — the user must /bind first.
  }

  if (!binding) {
    await tgSend(d, "This topic is not bound. Use /bind <cwd> first.", topicId);
    return;
  }

  const session = d.socket.getSession(binding.cwd);
  if (!session || !session.remoteOn) {
    await tgSend(d, "This topic is not bound (or remote is off).", topicId);
    return;
  }
  const deliverAs = session.turnLive ? ("steer" as const) : ("new" as const);
  const ok = d.socket.sendFrame(binding.cwd, { type: "prompt", text, deliverAs });
  if (!ok) {
    await tgSend(d, "Failed to deliver prompt to session.", topicId);
    return;
  }
  await tgSend(
    d,
    deliverAs === "steer"
      ? "🎯 Got it — steering the running turn."
      : "🎯 Got it — starting on it.",
    topicId,
  );
}

function writeConfigLive(cfg: Config): void {
  const path = join(readStateDir(), "config.json");
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

// ─── Socket callbacks (ext → daemon) ─────────────────────────────────────────

// Coerce a raw groupId (number or string) into a normalized negative group id.
// Telegram group/supergroup ids are negative; a positive value is negated.
// Returns null when the value is missing or not an integer.
function coerceGroupId(value: unknown): number | null {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const g = Math.trunc(n);
  return g > 0 ? -g : g;
}

function buildSocketCallbacks(d: Daemon) {
  return {
    onHello: (cwd: string, state: SessionState) => {
      const topicId = topicForCwd(d, cwd);
      if (topicId !== undefined) {
        const b = d.bindings.get(topicId);
        if (b) {
          // Seed session state from the persisted binding (remoteOn defaults false).
          state.remoteOn = b.remoteOn ?? false;
          state.verbosity = b.verbosity ?? "mid";
          updateBindingEvent(d.bindings, topicId, state.sessionId, state.sessionFile);
          writeBindings(d.bindings);
        }
      }
      // Answer the extension's config_request with the workspace's persisted state.
      d.socket.sendFrame(cwd, {
        type: "config",
        enabled: state.remoteOn,
        verbosity: state.verbosity,
        summaryEvery: d.config.summaryEvery ?? 8,
      });
      logMsg(d, `hello from ${cwd} (${state.sessionId}) topic=${topicId ?? "none"} remoteOn=${state.remoteOn}`);
    },

    onProgress: (cwd: string, kind: string, data: unknown) => {
      const topicId = topicForCwd(d, cwd);
      const session = d.socket.getSession(cwd);
      if (topicId === undefined || !session || !session.remoteOn) return;
      const verbosity = session.verbosity;

      if (kind === "turn_start") {
        // Start typing indicator for this cwd.
        // Send one immediate typing.
        if (topicId !== undefined) {
          void d.client.sendChatAction(d.config.groupId, "typing", { message_thread_id: topicId }).catch(() => {});
        }
        if (!d.typingTimers.has(cwd)) {
          const timer = setInterval(() => {
            const s = d.socket.getSession(cwd);
            if (!s || !s.turnLive || !s.remoteOn) {
              clearInterval(timer);
              d.typingTimers.delete(cwd);
              return;
            }
            void d.client.sendChatAction(d.config.groupId, "typing", { message_thread_id: topicId }).catch(() => {});
          }, 4000);
          d.typingTimers.set(cwd, timer);
        }
        // New turn gets its own live message; previous turn stays final.
        d.activeTurn.set(topicId, typeof data === "string" ? data : `t${Date.now().toString(36)}`);
      } else if (kind === "turn_end") {
        const turnId = turnIdFor(d, topicId);
        d.activeTurn.delete(topicId);
        void d.render.finalizeTurn(d.config.groupId, topicId, turnId).catch(() => {});
        d.socket.sendFrame(cwd, { type: "bye" });
        // Clear typing for this cwd.
        const timer = d.typingTimers.get(cwd);
        if (timer) {
          clearInterval(timer);
          d.typingTimers.delete(cwd);
        }
      } else if (kind === "todo_state") {
        // Cache todo state; do NOT render.
        if (data && typeof data === "object" && "todos" in data) {
          const raw = (data as Record<string, unknown>).todos;
          if (Array.isArray(raw)) {
            const todos: { content: string; status: string }[] = [];
            for (const item of raw) {
              if (item && typeof item === "object" && "content" in item && "status" in item) {
                const c = (item as Record<string, unknown>).content;
                const s = (item as Record<string, unknown>).status;
                if (typeof c === "string" && typeof s === "string") {
                  todos.push({ content: c, status: s });
                }
              }
            }
            d.lastTodos.set(cwd, todos);
          }
        }
      } else if (kind === "summary") {
        // Send a standalone summary message.
        if (data && typeof data === "object" && "text" in data) {
          const text = (data as Record<string, unknown>).text;
          const textStr = typeof text === "string" ? text : "";
          void tgSend(d, "📊 " + textStr, topicId, undefined, true).catch(() => {});
        }
      } else if (kind === "error") {
        // Render error at ALL verbosity levels.
        if (data && typeof data === "object" && "toolName" in data) {
          const d2 = data as Record<string, unknown>;
          const toolName = typeof d2.toolName === "string" ? d2.toolName : "";
          const text = typeof d2.text === "string" ? d2.text : "";
          void renderLine(d, topicId, "⚠️ " + escapeHtml(toolName) + (text ? ": " + escapeHtml(text) : "")).catch(() => {});
        }
      } else if (kind === "todo") {
        if (verbosity === "high" || verbosity === "xhigh") {
          const text = typeof data === "string" ? data : JSON.stringify(data);
          void renderLine(d, topicId, text).catch(() => {});
        }
      } else if (kind === "btw") {
        // Side-question answer: standalone 💬 message (does not touch the
        // active turn's live message).
        if (data && typeof data === "object" && "text" in data) {
          const text = (data as Record<string, unknown>).text;
          const textStr = typeof text === "string" ? text : "";
          void tgSend(d, "💬 " + textStr, topicId, undefined, true).catch(() => {});
        }
      } else if (kind === "message") {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        addReplayEntry(d.replay, topicId, { text });
        writeReplay(d.replay);
        void renderLine(d, topicId, text).catch(() => {});
      }
    },

    onQuestion: (cwd: string, q: QuestionFrame) => {
      const topicId = topicForCwd(d, cwd);
      const session = d.socket.getSession(cwd);
      if (topicId === undefined || !session || !session.remoteOn) return;
      const handle = String(++d.qCounter);
      d.pending.set(handle, { cwd, questionId: q.id, options: q.options ?? ["Confirm"] });
      void publishQuestion(d, topicId, q.title, q.options ?? ["Confirm"], handle).catch((e) =>
        logMsg(d, `publishQuestion failed: ${(e as Error).message}`),
      );
    },

    onConfigUpdate: (cwd: string, enabled?: boolean, verbosity?: Verbosity) => {
      const session = d.socket.getSession(cwd);
      if (session && enabled !== undefined) session.remoteOn = enabled;
      if (session && verbosity !== undefined) session.verbosity = verbosity;
      const topicId = topicForCwd(d, cwd);
      if (topicId === undefined) {
        // No binding for this cwd yet — create one so the persisted state survives.
        const newTopicId = nextTopicId(d.bindings);
        setBindingForTopic(d.bindings, newTopicId, cwd);
        const b = d.bindings.get(newTopicId);
        if (b) {
          if (enabled !== undefined) b.remoteOn = enabled;
          if (verbosity !== undefined) b.verbosity = verbosity;
          updateBindingEvent(d.bindings, newTopicId, session?.sessionId, session?.sessionFile);
        }
      } else {
        const b = d.bindings.get(topicId);
        if (b) {
          if (enabled !== undefined) b.remoteOn = enabled;
          if (verbosity !== undefined) b.verbosity = verbosity;
          updateBindingEvent(d.bindings, topicId, session?.sessionId, session?.sessionFile);
        }
      }
      writeBindings(d.bindings);
      // Forward updated config (including summaryEvery) to the extension.
      d.socket.sendFrame(cwd, {
        type: "config",
        enabled: session?.remoteOn,
        verbosity: session?.verbosity,
        summaryEvery: d.config.summaryEvery ?? 8,
      });
      logMsg(d, `config_update ${cwd}: remoteOn=${enabled ?? "unchanged"} verbosity=${session?.verbosity ?? "unchanged"}`);
    },

    onControl: (type: string, frame: Record<string, unknown>) => {
      if (type === "config_set") {
        const topicNum = Number(frame.topicId);
        if (!Number.isFinite(topicNum)) {
          logMsg(d, `config_set: missing topicId (${JSON.stringify(frame)})`);
          return;
        }
        const enabled =
          typeof frame.remoteOn === "boolean"
            ? frame.remoteOn
            : typeof frame.enabled === "boolean"
              ? frame.enabled
              : undefined;
        const verbosity =
          typeof frame.verbosity === "string" ? (frame.verbosity as Verbosity) : undefined;
        const existing = d.bindings.get(topicNum);
        if (existing) {
          if (enabled !== undefined) existing.remoteOn = enabled;
          if (verbosity !== undefined) existing.verbosity = verbosity;
          existing.lastEventAt = Date.now();
        } else {
          // Topic not bound yet — create a minimal binding so the config persists.
          const cwdHint =
            typeof frame.cwd === "string" ? frame.cwd : d.stateDir;
          setBindingForTopic(d.bindings, topicNum, cwdHint);
          const created = d.bindings.get(topicNum);
          if (created) {
            if (enabled !== undefined) created.remoteOn = enabled;
            if (verbosity !== undefined) created.verbosity = verbosity;
          }
        }
        writeBindings(d.bindings);
        logMsg(d, `config_set topic=${topicNum} remoteOn=${enabled ?? "unchanged"} verbosity=${verbosity ?? "unchanged"}`);
        return;
      }
      if (type === "config_reload") {
        const cfg = readConfig();
        if (cfg) {
          d.config = cfg;
          logMsg(d, "config_reload: config re-read from disk");
        } else {
          logMsg(d, "config_reload: config.json not readable, keeping current");
        }
        return;
      }
      if (type === "pair" || type === "pair_validate" || type === "pair_validate_group") {
        void (async () => {
          const token = typeof frame.token === "string" ? frame.token : "";
          if (!token) {
            logMsg(d, `pair: missing token (${type})`);
            return;
          }
          const probe = new TelegramClient(
            { token, apiBase: d.apiBase },
            { onLog: () => {}, onLogError: () => {}, onReply: () => {}, onUpdate: () => {} },
          );
          let ok = false;
          try {
            const me = await probe.getMe();
            ok = me !== null;
          } catch (err) {
            ok = false;
            logMsg(d, `pair: getMe failed: ${(err as Error).message}`);
          }
          if (ok && type === "pair_validate_group") {
            const groupId = coerceGroupId(frame.groupId);
            if (groupId === null) {
              ok = false;
              logMsg(d, "pair_validate_group: missing/invalid groupId");
            } else {
              try {
                const chat = await probe.getChat(groupId);
                ok = chat !== null;
                if (!ok) logMsg(d, `pair_validate_group: getChat(${groupId}) failed`);
              } catch (err) {
                ok = false;
                logMsg(d, `pair_validate_group: getChat threw: ${(err as Error).message}`);
              }
            }
          }
          if (ok && type === "pair") {
            const groupId = coerceGroupId(frame.groupId) ?? d.config.groupId;
            const cfg: Config = {
              botToken: token,
              groupId,
              allowedUserIds: [],
              editIntervalMs: d.config.editIntervalMs,
            };
            writeConfigLive(cfg);
            d.config = cfg;
            logMsg(d, `pair: config.json written (group=${groupId})`);
          }
          if (ok) {
            for (const session of d.socket.allSessions.values()) {
              d.socket.sendFrame(session.cwd, { type: "pair_done", success: true });
            }
          } else {
            for (const session of d.socket.allSessions.values()) {
              d.socket.sendFrame(session.cwd, { type: "pair_done", success: false });
            }
            logMsg(d, `pair: token validation failed (${type})`);
          }
        })();
        return;
      }
      logMsg(d, `control: unknown type ${type}`);
    },

    onLog: (m: string) => logMsg(d, `[socket] ${m}`),
  };
}

// Progress rendering: one live message per (topic, turn). The daemon tracks
// the active turn per topic (set by turn_start/turn_end frames); lines only
// ever edit the active turn's message, so finished turns keep their own
// final message and are never re-edited — no repeated old-turn content.
function turnIdFor(d: Daemon, topicId: number): string {
  return d.activeTurn.get(topicId) ?? `t${Date.now().toString(36)}`;
}

function renderLine(d: Daemon, topicId: number, line: string): Promise<void> {
  return d.render.addLine(d.config.groupId, topicId, turnIdFor(d, topicId), line);
}

// ─── Telegram update dispatch ────────────────────────────────────────────────

async function handleUpdate(d: Daemon, update: TelegramUpdate): Promise<void> {
  // Persist offset for every processed update (durability across restarts).
  writeOffset(update.update_id + 1);
  if (update.message) {
    await handleMessage(d, update.message);
  } else if (update.callback_query) {
    const cq = update.callback_query;
    const from = cq.from?.id;
    const cfg = readConfig();
    if (from === undefined || !cfg || !cfg.allowedUserIds.includes(from)) return;
    handleCallbackData(d, cq.data);
  }
}

// ─── Poll loop ───────────────────────────────────────────────────────────────

let stopPolling = false;

async function pollLoop(d: Daemon): Promise<void> {
  try {
    await d.client.deleteWebhook();
  } catch {
    // ignore
  }
  while (!stopPolling) {
    let updates: TelegramUpdate[];
    try {
      // 25s long-poll timeout + 30s fetch timeout via AbortController.
      // Telegram blocks server-side until an update arrives or the timeout
      // elapses, so this loop never busy-polls. It must run even with zero
      // active sessions: bootstrap commands (/bind, /pair, /unpair) and the
      // 409-conflict check are only reachable while the long-poll is live.
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 30000);
      try {
        updates = await d.client.getUpdates(d.offset, 25, undefined, controller.signal);
      } finally {
        clearTimeout(fetchTimeout);
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        logMsg(d, "409 conflict: another instance is polling this token. Exiting.");
        process.exit(1);
      }
      logMsg(d, `poll error: ${(err as Error).message}; retrying in 1s`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    for (const u of updates) {
      try {
        await handleUpdate(d, u);
      } catch (err) {
        logMsg(d, `update ${u.update_id} error: ${(err as Error).message}`);
      }
    }
    if (updates.length > 0) {
      d.offset = updates[updates.length - 1].update_id + 1;
      writeOffset(d.offset);
    }
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function buildDaemon(): Daemon | null {
  const config = readConfig();
  if (!config) return null;
  ensureStateDir();

  const stateDir = readStateDir();
  const logPath = join(stateDir, "daemon.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const apiBase =
    process.env.TG_BRIDGE_API_BASE ?? config.apiBase ?? "https://api.telegram.org";
  const socketPath = process.env.TG_BRIDGE_SOCK ?? join(stateDir, "sock");

  const client = new TelegramClient({ token: config.botToken, apiBase }, {
    onLog: (m) => log.write(`[tg] ${m}\n`),
    onLogError: (m) => log.write(`[tg:err] ${m}\n`),
    onReply: () => {},
    onUpdate: () => {},
  });
  client.setLogStream(log);

  const socket = new SocketManager();
  const render = new RenderEngine(client, config.editIntervalMs);
  render.setLogStream(log);

  const d: Daemon = {
    config,
    stateDir,
    apiBase,
    log,
    client,
    socket,
    render,
    bindings: readBindings(),
    replay: readReplay(),
    pending: new Map(),
    activeTurn: new Map(),
    typingTimers: new Map(),
    lastTodos: new Map(),
    qCounter: 0,
    offset: readOffset(),
    socketPath,
  };

  return d;
}

async function main(): Promise<void> {
  const d = buildDaemon();
  if (!d) {
    console.error("tg-bridge: config.json not ready (missing botToken/groupId). Supervisor will retry.");
    process.exit(0);
  }
  logMsg(d, `starting daemon (api=${d.apiBase}, sock=${d.socketPath})`);

  // Belt-and-braces: drop any stale sock file left by a crashed daemon so the
  // fresh listener binds cleanly (start() also unlinks, but only after its
  // own guard passes — an orphan file can race that path).
  try {
    if (existsSync(d.socketPath)) unlinkSync(d.socketPath);
  } catch {
    // Ignore: start() will still attempt its own unlink.
  }
  // Socket server for the in-session extension (start() installs the callbacks).
  d.socket.setLogStream(d.log);
  d.socket.start(d.socketPath, buildSocketCallbacks(d));

  // SIGHUP handler for config reload.
  process.on("SIGHUP", () => {
    logMsg(d, "SIGHUP received, reloading config");
    const cfg = readConfig();
    if (cfg) {
      d.config = cfg;
      logMsg(d, "config reloaded");
    }
  });

  // unhandledRejection watchdog.
  process.on("unhandledRejection", (reason) => {
    logMsg(d, `unhandledRejection: ${(reason as Error).message}`);
  });

  // Graceful shutdown.
  process.on("SIGTERM", () => {
    logMsg(d, "SIGTERM received, shutting down");
    stopPolling = true;
    d.socket.stop();
    process.exit(0);
  });

  // Run the poll loop (it exits on 409 via process.exit).
  await pollLoop(d);
}

main().catch((err) => {
  console.error("tg-bridge fatal:", err);
  process.exit(1);
});
