// daemon.ts — tg-bridge entry point.
// Wires the lib modules (telegram client, socket server, task manager, render
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
import { TaskManager } from "./lib/tasks";
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
  tasks: TaskManager;
  socket: SocketManager;
  render: RenderEngine;
  bindings: Map<number, Binding>;
  replay: Map<number, { text: string }[]>;
  pending: Map<string, PendingQuestion>;
  qCounter: number;
  offset: number;
  socketPath: string;
  ompBin: string;
}

function logMsg(d: Daemon, msg: string): void {
  try {
    d.log.write(`[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // ignore log write failures
  }
}

// ─── Reverse lookup helpers ──────────────────────────────────────────────────

function topicForCwd(d: Daemon, cwd: string): number | undefined {
  for (const [topicId, b] of d.bindings) {
    if (b.cwd === cwd) return topicId;
  }
  return undefined;
}

// ─── Telegram send helpers ───────────────────────────────────────────────────

async function tgSend(
  d: Daemon,
  text: string,
  topicId?: number,
  replyMarkup?: unknown,
): Promise<void> {
  try {
    const opts: { parse_mode?: string; reply_markup?: unknown; message_thread_id?: number } =
      {};
    if (topicId !== undefined) opts.message_thread_id = topicId;
    if (replyMarkup !== undefined) opts.reply_markup = replyMarkup;
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
        text: opt.length > 64 ? opt.slice(0, 64) + "…" : opt,
        callback_data: `q:${handle}:${idx}`,
      })),
    ],
  };
  await tgSend(d, title, topicId, keyboard);
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
          "/start <prompt> — spawn an omp task in this workspace",
          "/stop — abort + kill the running task",
          "/restart [prompt] — kill + resume last session",
          "/resume — resume last session (fresh process)",
          "/status — daemon + task status",
          "/abort — abort the current turn (process keeps running)",
          "/bind <cwd> — bind this topic to a workspace",
          "/replay [N] — resend last N progress entries",
          "/ask <question> — pose a question with inline buttons",
          "Free text — steer (running) / new turn (idle)",
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
      const task = cwd ? d.tasks.getInfo(cwd) : undefined;
      const session = cwd ? d.socket.getSession(cwd) : undefined;
      const lines = [
        `Workspace: ${b?.cwd ?? "(unbound)"}`,
        `Enabled: ${b?.remoteEnabled ?? true}  Verbosity: ${b?.verbosity ?? "mid"}`,
        `Task: ${task ? `running (pid ${task.pid})` : "none"}`,
        `Live session: ${session ? `${session.sessionId} (turn ${session.turnLive ? "live" : "idle"})` : "none"}`,
        `Last event: ${b ? new Date(b.lastEventAt).toISOString() : "never"}`,
      ];
      await tgSend(d, lines.join("\n"), topicId);
      return;
    }

    case "/start": {
      if (!cwd) {
        await tgSend(d, "This topic is not bound. Use /bind <cwd> first.", topicId);
        return;
      }
      if (!arg) {
        await tgSend(d, "Usage: /start <prompt>", topicId);
        return;
      }
      if (d.tasks.getActiveCount() >= d.config.maxConcurrent) {
        await tgSend(d, `Max concurrent tasks (${d.config.maxConcurrent}) reached.`, topicId);
        return;
      }
      const task = d.tasks.spawn(cwd, arg);
      if (!task) {
        await tgSend(d, "A task is already running for this workspace.", topicId);
        return;
      }
      await tgSend(d, `Started task (pid ${task.pid}): ${arg}`, topicId);
      return;
    }

    case "/stop": {
      if (!cwd) {
        await tgSend(d, "This topic is not bound.", topicId);
        return;
      }
      // Prefer socket abort (graceful); kill as fallback.
      const session = d.socket.getSession(cwd);
      if (session) d.socket.sendFrame(cwd, { type: "abort" });
      const killed = d.tasks.kill(cwd);
      await tgSend(
        d,
        killed ? "Task stopped." : "No daemon-owned task; sent abort to live session.",
        topicId,
      );
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

    case "/restart":
    case "/resume": {
      if (!cwd) {
        await tgSend(d, "This topic is not bound.", topicId);
        return;
      }
      const b = d.bindings.get(topicId);
      const prompt =
        cmd === "/restart" && arg ? arg : b?.lastSessionFile ? "(resuming last session)" : "";
      d.tasks.kill(cwd);
      const task = b?.lastSessionFile
        ? d.tasks.spawn(cwd, prompt || "Continue.", b.lastSessionFile)
        : d.tasks.spawn(cwd, prompt || "Continue.");
      if (!task) {
        await tgSend(d, "Could not (re)start task.", topicId);
        return;
      }
      await tgSend(d, `${cmd === "/restart" ? "Restarted" : "Resumed"} (pid ${task.pid}).`, topicId);
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
        for (const chunk of d.client.chunkText(e.text)) await tgSend(d, chunk, topicId);
      }
      return;
    }

    case "/ask": {
      // Pose a free-form question with inline buttons. The tap routes back as an
      // `answer` frame to the live session for this workspace's cwd.
      const title = arg || "(no question text)";
      const options = cwd ? ["Confirm"] : ["Confirm"];
      const handle = String(++d.qCounter);
      d.pending.set(handle, {
        cwd: cwd ?? "",
        questionId: handle,
        options,
      });
      if (!cwd) {
        await tgSend(d, `Cannot answer: topic not bound. Question discarded.`, topicId);
        d.pending.delete(handle);
        return;
      }
      await publishQuestion(d, topicId, title, options, handle);
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
  const isGroup = msg.chat.id === d.config.groupId;

  // DM pairing commands (not in the group).
  if (!isGroup) {
    if (text.trim().startsWith("/pair")) {
      const c = readConfig();
      if (c && !c.allowedUserIds.includes(from)) {
        c.allowedUserIds.push(from);
        writeConfigLive(c);
        logMsg(d, `paired user ${from}`);
      }
      await tgSend(d, `Paired user ${from}.`, Number(msg.chat.id));
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

  // In-group: must be a forum topic (thread_id) to route to a workspace.
  const topicId = msg.thread_id ?? msg.reply_to_message?.thread_id ?? 0;

  if (text.trim().startsWith("/") && text.includes("\n") === false) {
    // A command.
    await handleCommand(d, text, topicId);
    return;
  }

  // Free text → prompt to the live session for this topic's cwd.
  const binding = d.bindings.get(topicId);
  if (!binding || !binding.remoteEnabled) {
    await tgSend(d, "This topic is not bound (or remote is disabled).", topicId);
    return;
  }
  const session = d.socket.getSession(binding.cwd);
  if (!session) {
    // No live session: if a daemon task is running, we can't steer it (it's a
    // spawned `omp -p` child with no interactive socket). Report status.
    const task = d.tasks.getInfo(binding.cwd);
    if (task) {
      await tgSend(
        d,
        `A task is running (pid ${task.pid}) but has no interactive session to steer. Use /status.`,
        topicId,
      );
    } else {
      await tgSend(d, `No live session for ${binding.cwd}. Use /start <prompt> to launch one.`, topicId);
    }
    return;
  }
  const deliverAs = session.turnLive ? ("steer" as const) : ("new" as const);
  const ok = d.socket.sendFrame(binding.cwd, { type: "prompt", text, deliverAs });
  if (!ok) {
    await tgSend(d, "Failed to deliver prompt to session.", topicId);
  }
}

function writeConfigLive(cfg: Config): void {
  const path = join(readStateDir(), "config.json");
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

// ─── Socket callbacks (ext → daemon) ─────────────────────────────────────────

function buildSocketCallbacks(d: Daemon) {
  return {
    onHello: (cwd: string, state: SessionState) => {
      const topicId = topicForCwd(d, cwd);
      if (topicId !== undefined) {
        const b = d.bindings.get(topicId);
        if (b) {
          // Seed session state from the persisted binding.
          state.enabled = b.remoteEnabled;
          state.verbosity = b.verbosity;
          updateBindingEvent(d.bindings, topicId, state.sessionId, state.sessionFile);
          writeBindings(d.bindings);
        }
      }
      // Answer the extension's config_request with the workspace's persisted state.
      d.socket.sendFrame(cwd, {
        type: "config",
        enabled: state.enabled,
        verbosity: state.verbosity,
      });
      logMsg(d, `hello from ${cwd} (${state.sessionId}) topic=${topicId ?? "none"}`);
    },

    onProgress: (cwd: string, kind: string, data: unknown) => {
      const topicId = topicForCwd(d, cwd);
      const session = d.socket.getSession(cwd);
      const b = topicId !== undefined ? d.bindings.get(topicId) : undefined;
      if (topicId === undefined || !session || !session.enabled) return;
      const verbosity = session.verbosity;
      // Replay capture: keep the rendered text for /replay continuity.
      if (kind === "message") {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        addReplayEntry(d.replay, topicId, { text });
        writeReplay(d.replay);
        void renderLine(d, topicId, text).catch((e) =>
          logMsg(d, `render failed: ${(e as Error).message}`),
        );
      } else if (kind === "turn_start" || kind === "turn_end") {
        const label = kind === "turn_start" ? "— turn start —" : "— turn end —";
        addReplayEntry(d.replay, topicId, { text: label });
        void renderLine(d, topicId, label).catch(() => {});
        if (kind === "turn_end") {
          d.socket.sendFrame(cwd, { type: "bye" });
        }
      } else if ((kind === "error" || kind === "todo") && (verbosity === "high" || verbosity === "xhigh")) {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        void renderLine(d, topicId, text).catch(() => {});
      }
      void b; // b used for future per-binding render tuning
    },

    onQuestion: (cwd: string, q: QuestionFrame) => {
      const topicId = topicForCwd(d, cwd);
      const session = d.socket.getSession(cwd);
      if (topicId === undefined || !session || !session.enabled) return;
      const handle = String(++d.qCounter);
      d.pending.set(handle, { cwd, questionId: q.id, options: q.options ?? ["Confirm"] });
      void publishQuestion(d, topicId, q.title, q.options ?? ["Confirm"], handle).catch((e) =>
        logMsg(d, `publishQuestion failed: ${(e as Error).message}`),
      );
    },

    onConfigUpdate: (cwd: string, enabled?: boolean, verbosity?: Verbosity) => {
      const topicId = topicForCwd(d, cwd);
      if (topicId === undefined) return;
      const b = d.bindings.get(topicId);
      if (!b) return;
      if (enabled !== undefined) b.remoteEnabled = enabled;
      if (verbosity !== undefined) b.verbosity = verbosity;
      writeBindings(d.bindings);
      logMsg(d, `config_update ${cwd}: enabled=${b.remoteEnabled} verbosity=${b.verbosity}`);
    },

    onLog: (m: string) => logMsg(d, `[socket] ${m}`),
  };
}

async function renderLine(d: Daemon, topicId: number, line: string): Promise<void> {
  // One live message per (topic, "turn"). We use a stable turnId per topic so
  // successive lines edit the same message, respecting the edit interval.
  const turnId = `topic-${topicId}`;
  await d.render.addLine(d.config.groupId, topicId, turnId, line);
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
      updates = await d.client.getUpdates(d.offset, 28);
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
  const ompBin = process.env.TG_BRIDGE_OMP_BIN ?? "/usr/local/bin/omp";
  const socketPath = process.env.TG_BRIDGE_SOCK ?? join(stateDir, "sock");

  const client = new TelegramClient({ token: config.botToken, apiBase }, {
    onLog: (m) => log.write(`[tg] ${m}\n`),
    onLogError: (m) => log.write(`[tg:err] ${m}\n`),
    onReply: () => {},
    onUpdate: () => {},
  });
  client.setLogStream(log);

  const tasks = new TaskManager(ompBin, {
    onLine: (cwd, line) => log.write(`[task:${basename(cwd)}] ${line}\n`),
    onExit: (cwd, code) => log.write(`[task:${basename(cwd)}] exited ${code}\n`),
    onLog: (m) => log.write(`[task] ${m}\n`),
  });
  tasks.setLogStream(log);

  const socket = new SocketManager();
  const render = new RenderEngine(
    client,
    { onLine: () => {}, onFinalize: () => {} },
    config.editIntervalMs,
  );
  render.setLogStream(log);

  const d: Daemon = {
    config,
    stateDir,
    apiBase,
    log,
    client,
    tasks,
    socket,
    render,
    bindings: readBindings(),
    replay: readReplay(),
    pending: new Map(),
    qCounter: 0,
    offset: readOffset(),
    socketPath,
    ompBin,
  };

  return d;
}

async function main(): Promise<void> {
  const d = buildDaemon();
  if (!d) {
    console.error("tg-bridge: config.json not ready (missing botToken/groupId). Supervisor will retry.");
    process.exit(0);
  }
  logMsg(d, `starting daemon (api=${d.apiBase}, sock=${d.socketPath}, omp=${d.ompBin})`);

  // Socket server for the in-session extension (start() installs the callbacks).
  d.socket.setLogStream(d.log);
  d.socket.start(d.socketPath, buildSocketCallbacks(d));

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
