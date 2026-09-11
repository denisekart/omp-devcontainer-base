/**
 * Telegram bridge extension — in-process half of the Telegram bridge.
 *
 * Reports session identity and progress over a unix socket; receives prompts,
 * answers, and abort signals from the bridge daemon. Silent no-op when the
 * daemon is absent.
 *
 * Socket: unix socket at $TG_BRIDGE_SOCK or ~/.omp/tg-bridge/sock.
 * One JSON object per line (JSONL).
 */
import child_process from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  ToolCallEvent,
  ToolCallEventResult,
  TurnStartEvent,
  TurnEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionEndEvent,
  MessageEndEvent,
  TodoReminderEvent,
  AgentStartEvent,
  AgentEndEvent,
  SessionCompactingEvent,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  CustomToolCallEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { Context, AssistantMessage } from "@oh-my-pi/pi-ai";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
// Timer: opaque handle returned by ctx.setTimeout (the API's Timer type is not
// exported). Stored as number; ctx.clearTimer accepts the handle at runtime.
type Timer = number;

// ── Types ──────────────────────────────────────────────────────────────────

type VerbosityLevel = "low" | "mid" | "high" | "xhigh";

interface BridgeConfig {
  enabled: boolean;
  summaryEvery: number;
  verbosity: VerbosityLevel;
}

interface PendingAnswer {
  id: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: Timer;
}

interface ProgressBatch {
  lines: string[];
  timer: Timer | null;
}

interface StructuredDigest {
  userMessages: string[];
  toolOneLiners: string[];
  assistantExcerpts: string[];
}

interface LastErrorEntry {
  error: string;
  text: string | null;
  count: number;
}

interface TodoPhase {
  phase: string;
  todos: { content: string; status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked" }[];
}

interface TodosSummary {
  done: number;
  active: number;
  total: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BridgeConfig = { enabled: false, verbosity: "mid", summaryEvery: 8 };
const SOCKET_PATH_ENV = "TG_BRIDGE_SOCK";
const DEFAULT_SOCK_DIR = path.join(os.homedir(), ".omp", "tg-bridge");
const DEFAULT_SOCK_PATH = path.join(DEFAULT_SOCK_DIR, "sock");
const CONFIG_FILE_NAME = "config.json";
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_FACTOR = 1.5;
const BATCH_FLUSH_MS = 1_500;
const ASK_TIMEOUT_MS = 600_000; // 10 minutes
const ASK_TIMEOUT_MS_ENV = "TG_BRIDGE_ASK_TIMEOUT_MS";
const API_BASE_ENV = "TG_BRIDGE_API_BASE";
const DEFAULT_API_BASE = "https://api.telegram.org";
const PAIR_VALIDATE_TIMEOUT_MS = 30_000;

// ── State ──────────────────────────────────────────────────────────────────

const config: BridgeConfig = { ...DEFAULT_CONFIG };
let socket: net.Socket | null = null;
let connected = false;
let reconnectBackoffMs = RECONNECT_MIN_MS;
let lastEventAt = Date.now();
const askTimeoutMs = parseInt(
  process.env[ASK_TIMEOUT_MS_ENV] ?? "",
  10
) || ASK_TIMEOUT_MS;
const progressBatch: ProgressBatch = { lines: [], timer: null };
let currentTurnIndex = 0;
const pendingAnswers = new Map<string, PendingAnswer>();
let ctxRef: ExtensionContext | null = null;
let piRef: ExtensionAPI | null = null;
let sessionId = "";
let sessionFile = "";
let cwd = "";
let pid = process.pid;
let ompVersion = "unknown";
let recvBuffer = "";
let shuttingDown = false;
let supervisorProcess: child_process.ChildProcess | null = null;
const digest: StructuredDigest = { userMessages: [], toolOneLiners: [], assistantExcerpts: [] };
let midFinalText = "";
let turnsSinceSummary = 0;
let lastError: LastErrorEntry | null = null;
const todoPhases: TodoPhase[] = [];
let todoUpdatedAt = 0;
let sessionStartAt = 0;
let lastToolAt = 0;
let turnDurationMs: number | null = null;
let turnStartAt = 0;
let _daemonSocketPath = "";
let evictedByDaemon = false;
let summaryThisTurn = false;
let heartbeatTimer: number | null = null;
let toolCallsThisTurn = 0;
let compacting = false;
// Cumulative cross-turn progress recaps: the per-turn digest is cleared every
// turn_start, so without this the summarizer has zero cross-turn memory and
// claims "no prior progress" after real work.
const turnRecaps: string[] = [];
// Set when an abort frame was delivered; cleared at the next turn_start.
// Supresses the plan-completion summary for the aborted run.
let abortPending = false;
// is delivered to Telegram regardless of verbosity.
let nextTurnDeliverFinal = false;

// ── Helpers ────────────────────────────────────────────────────────────────

function getSocketPath(): string {
  return process.env[SOCKET_PATH_ENV] ?? DEFAULT_SOCK_PATH;
}

/** Readable model identity for display (ctxRef.model is a Model object, not a string). */
function modelName(): string | null {
  const m = ctxRef?.model as { name?: string; id?: string } | undefined;
  if (!m) return null;
  return (typeof m.name === "string" && m.name) || (typeof m.id === "string" && m.id) || null;
}

function getConfigPath(): string {
  return path.join(DEFAULT_SOCK_DIR, CONFIG_FILE_NAME);
}

function log(msg: string): void {
  // Silent by design — the daemon collects frames
}

function safeSend(data: unknown): void {
  if (socket && socket.readyState === "open") {
    try {
      socket.write(JSON.stringify(data) + "\n");
    } catch {
      /* socket closed — handled by close event */
    }
  }
}

interface TgCallResult {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
}

async function tgCall(
  botToken: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<TgCallResult> {
  const apiBase = process.env[API_BASE_ENV] ?? DEFAULT_API_BASE;
  const url = `${apiBase}/bot${botToken}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIR_VALIDATE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    const data: TgCallResult = (await resp.json()) as TgCallResult;
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, description: msg };
  } finally {
    clearTimeout(timer);
  }
}

interface TokenValidation {
  ok: boolean;
  username?: string;
  reason: string;
}

async function validateToken(botToken: string): Promise<TokenValidation> {
  const data = await tgCall(botToken, "getMe");
  if (data.ok && data.result) {
    const result = data.result as { id?: unknown; username?: string };
    if (typeof result.id === "number") {
      return { ok: true, username: result.username, reason: "ok" };
    }
    return { ok: false, reason: "unexpected getMe result" };
  }
  if (data.error_code === 401) {
    return { ok: false, reason: "invalid bot token" };
  }
  return { ok: false, reason: `cannot reach Telegram API: ${data.description ?? "unknown"}` };
}

interface GroupValidation {
  ok: boolean;
  reason: string;
}

async function validateGroup(botToken: string, groupId: number): Promise<GroupValidation> {
  const data = await tgCall(botToken, "getChat", { chat_id: groupId });
  if (data.ok && data.result) {
    return { ok: true, reason: "ok" };
  }
  if (data.error_code === 400 || data.error_code === 403) {
    return {
      ok: false,
      reason: `bot is not a member of group ${groupId} (${data.description ?? "access denied"})`,
    };
  }
  return { ok: false, reason: `cannot reach Telegram API: ${data.description ?? "unknown"}` };
}

function parseGroupId(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?\d{6,}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? -n : n;
}


function writeBridgeConfig(botToken: string, groupId: number): boolean {
  const configPath = getConfigPath();
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      /* no config yet */
    }
    const merged: Record<string, unknown> = {
      ...existing,
      botToken,
      groupId,
      allowedUserIds:
        Array.isArray(existing.allowedUserIds) && existing.allowedUserIds.length > 0
          ? existing.allowedUserIds
          : [],
      editIntervalMs:
        typeof existing.editIntervalMs === "number" ? existing.editIntervalMs : 1500,
      apiBase: existing.apiBase ?? DEFAULT_API_BASE,
      enabled: true,
      verbosity: config.verbosity,
    };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function flushProgressBatch(): void {
  if (progressBatch.lines.length > 0) {
    const lines = progressBatch.lines;
    progressBatch.lines = [];
    if (lines.length > 0) {
      safeSend({
        type: "progress",
        kind: "message",
        data: lines.join("\n"),
        turnIndex: currentTurnIndex,
      });
    }
    progressBatch.timer = null;
  }
}

function enqueueProgress(kind: string, data: unknown): void {
  if (!config.enabled || !connected) return;
  const line = renderProgressLine(kind, data);
  if (!line) return;
  progressBatch.lines.push(line);
  // Schedule only when idle, so active streams flush on a fixed cadence
  if (progressBatch.timer === null) {
    progressBatch.timer = ctxRef?.setTimeout?.(() => {
      flushProgressBatch();
    }, BATCH_FLUSH_MS) ?? null;
  }
}

function immediateFlush(): void {
  flushProgressBatch();
}
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractToolErrorText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      const texts = obj.content
        .filter((c: unknown): c is { type: string; text?: string } => typeof c === "object" && c !== null && "type" in c && typeof (c as Record<string, unknown>).type === "string")
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .filter((t: string) => t.length > 0);
      if (texts.length > 0) return texts[0].slice(0, 200);
    }
    if ("error" in obj && typeof obj.error === "string") return obj.error;
    if ("message" in obj && typeof obj.message === "string") return obj.message;
    const firstLine = JSON.stringify(obj).split("\n")[0];
    return firstLine.slice(0, 200);
  }
  return String(result ?? "").slice(0, 200);
}

/**
 * Convert markdown-ish progress text into Telegram HTML. Escape &/</> first,
 * then: ``` fences → <pre><code>, inline `code`, **bold** → <b>. If the result
 * would exceed Telegram's ~200-tag/message limit, fall back to escaped plain text.
 */
function toTelegramHtml(text: string): string {
  const esc = escapeHtml(text);
  let out = esc.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
  const tagCount = out.split("<").length - 1;
  if (tagCount > 150) return esc;
  return out;
}

function renderProgressLine(kind: string, data: unknown): string | null {
  if (!config.enabled || !connected) return null;

  const v = config.verbosity;

  switch (kind) {
    case "turn_start": {
      // All verbosity levels: drop framing emoji
      return null;
    }
    case "turn_end": {
      // All verbosity levels: drop framing emoji
      return null;
    }
    case "tool": {
      const ev = data as ToolExecutionStartEvent;
      if (v === "low" || v === "mid") return null;
      // high+: tool one-liner
      return `🔧 ${escapeHtml(renderToolOneLiner(ev))}`;
    }
    case "message": {
      const ev = data as MessageEndEvent;
      if (v === "low" || v === "mid") return null;
      // high+: every message
      return renderMessageEnd(ev);
    }
    case "todo": {
      const ev = data as TodoReminderEvent;
      if (v === "low" || v === "mid") return null;
      return renderTodo(ev) === null ? null : escapeHtml(renderTodo(ev)!);
    }
    case "error": {
      const ev = data as ToolExecutionEndEvent;
      if (v === "low") {
        return ev.isError ? `⚠️ ${escapeHtml(ev.toolName)} error` : null;
      }
      return ev.isError ? `⚠️ ${escapeHtml(ev.toolName)} error` : null;
    }
    case "agent_start": {
      if (v === "xhigh") {
        const _ev = data as AgentStartEvent;
        return `[agent] start`;
      }
      return null;
    }
    case "agent_end": {
      if (v === "xhigh") {
        const _ev = data as AgentEndEvent;
        return `[agent] end`;
      }
      return null;
    }
    default:
      return null;
  }
}

function renderToolOneLiner(ev: ToolExecutionStartEvent): string {
  const name = ev.toolName;
  const args = ev.args as Record<string, unknown> | undefined;

  // bash → first 60 chars of command
  if (name === "bash") {
    const cmd = (args?.command as string) ?? "";
    return `bash ${cmd.slice(0, 60)}`;
  }

  // edit/write/read → path
  if (name === "edit" || name === "write" || name === "read") {
    const p = (args?.path as string) ?? (args?.paths as string[])?.join(", ") ?? "";
    return `${name} ${p}`;
  }

  // todo → first in_progress item
  if (name === "todo") {
    const list = args?.list as { items?: string[]; phase?: string }[] | undefined;
    if (list?.length) {
      const first = list[0].items?.[0] ?? "";
      return `todo ${first}`;
    }
    return `todo`;
  }

  // grep/glob → pattern
  if (name === "grep" || name === "glob") {
    const pattern = (args?.pattern as string) ?? (args?.path as string) ?? "";
    return `${name} ${pattern}`;
  }

  return `${name}`;
}

function renderMessageEnd(ev: MessageEndEvent): string | null {
  const msg = ev.message;
  // AgentMessage is a union; only AssistantMessage has content array
  if (msg.role !== "assistant") return null;

  const content = msg.content;
  if (!content) return null;

  const textParts: string[] = [];
  for (const c of content) {
    if (c.type === "text" && c.text) {
      textParts.push(c.text);
    }
  }

  const text = textParts.join("\n");
  if (!text) return null;

  // HTML-format; the daemon chunks long output via splitHtmlAware
  return toTelegramHtml(text);
}

function renderTodo(ev: TodoReminderEvent): string | null {
  const todos = ev.todos as { content: string; status: string }[] | undefined;
  if (!todos?.length) return null;

  const items: string[] = [];
  for (const task of todos) {
    if (task.status === "in_progress" || task.status === "pending") {
      const prefix = task.status === "in_progress" ? "⚡" : "○";
      items.push(`${prefix} ${task.content}`);
    }
  }
  return items.length > 0 ? `todo: ${items.join("; ")}` : null;
}

// ── Socket ─────────────────────────────────────────────────────────────────

function connectSocket(): void {
  if (connected) return;

  const sockPath = getSocketPath();
  _daemonSocketPath = sockPath;
  try {
    socket = new net.Socket();
    socket.connect(sockPath, () => {
      connected = true;
      evictedByDaemon = false;
      reconnectBackoffMs = RECONNECT_MIN_MS;
      log("connected");
      sendHello();
      startHeartbeat();
    });

    socket.on("data", (data: Buffer) => {
      lastEventAt = Date.now();
      recvBuffer += data.toString("utf-8");
      let idx: number;
      while ((idx = recvBuffer.indexOf("\n")) >= 0) {
        const line = recvBuffer.slice(0, idx).trim();
        recvBuffer = recvBuffer.slice(idx + 1);
        if (!line) continue;
        try {
          const frame = JSON.parse(line);
          handleFrame(frame);
        } catch {
          /* malformed JSON — skip */
        }
      }
      if (recvBuffer.length > 65536) recvBuffer = ""; // runaway guard
    });

    socket.on("close", () => {
      connected = false;
      recvBuffer = "";
      if (!shuttingDown && !evictedByDaemon) scheduleReconnect();
    });

    socket.on("error", () => {
      connected = false;
      if (!shuttingDown) scheduleReconnect();
    });
  } catch {
    /* ECONNREFUSED or similar — silent no-op */
    if (!shuttingDown) scheduleReconnect();
  }
}

function closeSocket(): void {
  shuttingDown = true;
  stopHeartbeat();
  if (socket) {
    try {
      safeSend({ type: "bye" });
    } catch {
      /* ignore */
    }
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
    socket = null;
    connected = false;
  }
  // Reject any in-flight mobile answers so awaiting handlers resolve
  for (const [id, pending] of pendingAnswers) {
    ctxRef?.clearTimer?.(pending.timer);
    pendingAnswers.delete(id);
    pending.reject(new Error("bridge disconnected"));
  }
}


function scheduleReconnect(): void {
  if (!ctxRef) return;
  const ms = Math.min(reconnectBackoffMs, RECONNECT_MAX_MS);
  reconnectBackoffMs = Math.min(
    reconnectBackoffMs * RECONNECT_FACTOR,
    RECONNECT_MAX_MS
  );
  const timer = ctxRef.setTimeout(() => {
    connectSocket();
  }, ms);
  if (timer) {
    // Store somewhere to clear on shutdown if needed
  }
}

function sendHello(): void {
  const hello = {
    type: "hello" as const,
    ompVersion: ompVersion,
    cwd: cwd,
    sessionId: sessionId,
    sessionFile: sessionFile,
    pid: pid,
  };
  safeSend(hello);
  // Request config
  safeSend({ type: "config_request" as const, cwd: cwd });
}

// ── Frame handling ─────────────────────────────────────────────────────────

function handleFrame(frame: Record<string, unknown>): void {
  const type = frame.type as string;

  switch (type) {
    case "config": {
      const enabled = frame.enabled as boolean | undefined;
      const verbosity = frame.verbosity as VerbosityLevel | undefined;
      const summaryEveryVal = frame.summaryEvery as number | undefined;
      if (enabled !== undefined) config.enabled = enabled;
      if (verbosity !== undefined) config.verbosity = verbosity;
      if (summaryEveryVal !== undefined && summaryEveryVal > 0) config.summaryEvery = summaryEveryVal;
      break;
    }
    case "pair_done": {
      // Auto-paired by daemon; notify user
      try {
        ctxRef?.ui?.notify?.("Auto-paired to Telegram via daemon. You're all set.", "info");
      } catch {
        /* best-effort */
      }
      break;
    }
    case "prompt": {
      const text = frame.text as string | undefined;
      const deliverAs = (frame.deliverAs as "steer" | "followUp" | "new") ?? "steer";
      if (text) {
        if (deliverAs === "new") {
          // Start a new turn
          piRef?.sendUserMessage?.(text);
        } else {
          piRef?.sendUserMessage?.(text, { deliverAs });
        }
      }
      if (text && text.trimEnd().endsWith("??")) {
        nextTurnDeliverFinal = true;
      }
      break;
    }
    case "btw": {
      // Side question from Telegram: answer via one-shot AI call, never steer
      // the running turn.
      const q = frame.question as string | undefined;
      if (q) {
        void answerBtw(q);
      }
      break;
    }
    case "abort": {
      abortPending = true;
      if (ctxRef?.isIdle?.() === false) {
        ctxRef?.abort?.();
      }
      break;
    }
    case "answer": {
      const id = frame.id as string | undefined;
      const value = frame.value;
      if (id) {
        const pending = pendingAnswers.get(id);
        if (pending) {
          ctxRef?.clearTimer?.(pending.timer);
          pendingAnswers.delete(id);
          pending.resolve(value);
        }
      }
      break;
    }
    case "todo_request": {
      // Empty request frame — respond with the full captured todo state.
      // Always answer when connected so /todo is never silent (empty list
      // renders as a note on the daemon side).
      if (connected) {
        safeSend({
          type: "progress" as const,
          kind: "todo_list" as const,
          data: {
            phases: todoPhases.map((p) => ({
              name: p.phase,
              tasks: p.todos.map((t) => ({ content: t.content, status: t.status })),
            })),
            updatedAt: Date.now(),
          },
        });
      }
      break;
    }
    case "summarize": {
      if (config.enabled && connected && ctxRef) {
        void maybeSendSummary();
      }
      break;
    }
    case "session_evicted": {
      evictedByDaemon = true;
      stopHeartbeat();
      break;
    }
  }
}

// ── Supervisor ensure ──────────────────────────────────────────────────────

function ensureDaemon(): void {
  const sockPath = getSocketPath();

  // A live socket connection means the daemon is reachable; skip the guard
  // instead of trusting the sock file (a stale file from a crashed daemon
  // would otherwise block every socket path). The tmux has-session guard and
  // the daemon's own stale-sock unlink are the real idempotency mechanisms.
  if (connected) return;

  // Ensure directory exists
  try {
    fs.mkdirSync(path.dirname(sockPath), { recursive: true });
  } catch {
    /* directory may already exist */
  }

  const supervisorScript = "/usr/local/share/tg-bridge/supervisor.sh";

  // Try tmux first
  try {
    piRef?.exec?.("tmux", ["has-session", "-t", "tgbridge"])
      .then((result) => {
        if (result.code === 0) return;
        // tmux session doesn't exist; try to create it
        return piRef?.exec?.("tmux", ["new-session", "-d", "-s", "tgbridge", "bash", supervisorScript])
          .catch(() => null);
      })
      .then((result) => {
        if (result?.code === 0) {
          supervisorProcess = null; // managed by tmux
          return;
        }
        // tmux absent or failed; fall back to child_process.spawn
        spawnSupervisorDirect(supervisorScript);
      });
  } catch {
    // tmux command failed; fall back to direct spawn
    spawnSupervisorDirect(supervisorScript);
  }
}

function spawnSupervisorDirect(scriptPath: string): void {
  try {
    const proc = child_process.spawn("bash", [scriptPath], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    supervisorProcess = proc;
    proc.on("error", () => {
      /* supervisor failed to start */
    });
    // Don't keep reference alive
    proc.unref();
  } catch {
    /* spawn failed */
  }
}

// ── Pair wizard ────────────────────────────────────────────────────────────

async function runPairWizard(): Promise<void> {
  const ui = ctxRef?.ui;
  const notify = (text: string, type?: "info" | "warning" | "error"): void => {
    try {
      ui?.notify?.(text, type);
    } catch {
      /* best-effort (may be absent in -p mode) */
    }
  };

  // Step 0: Explain pairing
  notify?.(
    "🔗 Telegram Pairing Wizard\n\n" +
    "Step 1: Create a bot with @BotFather on Telegram and copy the bot token.\n" +
    "Step 2: Enter the bot token when prompted.",
    "info"
  );

  // Step 1: Get bot token
  const token = await ui?.input?.("Bot token", "123456:ABC-...");
  if (!token || !token.trim()) {
    notify?.("No token provided. Pairing cancelled.", "warning");
    return;
  }

  const botToken = token.trim();

  // Step 2: Validate the token locally (no daemon required — this is the
  // fresh-install case where no daemon exists yet, so the old socket round-trip
  // always timed out).
  notify?.("Validating bot token…", "info");
  const tokenCheck = await validateToken(botToken);
  if (!tokenCheck.ok) {
    notify?.(`Bot token validation failed: ${tokenCheck.reason}. Pairing cancelled.`, "error");
    return;
  }
  const botName = tokenCheck.username ? ` (@${tokenCheck.username})` : "";
  notify?.(`Bot token valid${botName}.`, "info");

  // Step 3: Group ID is required (there is no auto-detect: getUpdates stays
  // empty while no group is known, and the daemon hard-requires a negative
  // groupId for every outbound path).
  notify?.(
    "Step 3: Add the bot to a Telegram group (a forum/supergroup), then reply with the group's ID.\n\n" +
    "The ID is the group's chat.id — a long negative number, e.g. -1001234567890.\n" +
    "Add a group-info bot (e.g. @getidsbot) to the group and ask for the chat ID.",
    "info"
  );

  let groupId: number | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const groupIdInput = await ui?.input?.(
      "Group ID",
      "-1001234567890",
    );
    if (!groupIdInput || !groupIdInput.trim()) break;
    const parsed = parseGroupId(groupIdInput.trim());
    if (parsed === null) {
      notify?.(
        `Invalid group ID "${groupIdInput.trim()}". Expected a (negative) number with 6+ digits, e.g. -1001234567890.`,
        "warning"
      );
      continue;
    }
    groupId = parsed;

    // Step 4: Validate group membership via getChat (local — no daemon).
    notify?.(`Validating group ${groupId}…`, "info");
    const groupCheck = await validateGroup(botToken, groupId);
    if (!groupCheck.ok) {
      notify?.(`Group validation failed: ${groupCheck.reason}`, "error");
      break;
    }
    break;
  }

  if (groupId === null) {
    notify?.("No valid group ID provided. Pairing cancelled.", "warning");
    return;
  }

  // Step 5: Write the full config.json. This is what unblocks a supervisor
  // sitting in wait_for_config (it polls for botToken + negative groupId),
  // and what the daemon reads on start/reload.
  if (!writeBridgeConfig(botToken, groupId)) {
    notify?.("Failed to write config. Pairing incomplete.", "error");
    return;
  }

  // Step 6: Enable and connect. A waiting supervisor picks up the config
  // within ~5 s and starts the daemon; if one is already running, the
  // config_reload below hot-swaps it.
  config.enabled = true;
  ensureDaemon();
  connectSocket();
  safeSend({ type: "config_reload" as const });

  notify?.(
    `✅ Pairing complete! Bot${botName} is paired to group ${groupId}.\n\n` +
    "Next: in the group, send the bot /pair (DM) and /bind <workspace-path> in a topic, then /remote on to start the bridge.",
    "info"
  );
}

// ── /remote command ────────────────────────────────────────────────────────

async function handleRemoteCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const notify = (text: string, type?: "info" | "warning" | "error") => {
      try {
        ctx.ui?.notify?.(text, type);
      } catch {
        /* notify is best-effort (may be absent in -p mode) */
      }
    };

    const trimmed = args.trim();

    // ── /remote or /remote status ──
    if (!trimmed || trimmed.toLowerCase() === "status") {
      const statusLines: string[] = [
        `Telegram bridge: enabled=${config.enabled}, verbosity=${config.verbosity}`,
        `daemon connected: ${connected ? "yes" : "no"}`,
        `workspace: ${cwd}`,
      ];
      if (!connected) {
        const age = Math.round((Date.now() - lastEventAt) / 1000);
        statusLines.push(`last event: ${age}s ago`);
      }
      notify(statusLines.join("\n"), "info");
      return;
    }

    // ── /remote on ──
    if (trimmed.toLowerCase() === "on") {
      config.enabled = true;
      ensureDaemon();
      connectSocket();
      safeSend({ type: "config_update" as const, cwd, enabled: true });
      notify("Telegram bridge: enabled and connecting…", "info");
      return;
    }

    // ── /remote off ──
    if (trimmed.toLowerCase() === "off") {
      config.enabled = false;
      safeSend({ type: "config_update" as const, cwd, enabled: false });
      closeSocket();
      notify("Telegram bridge: disabled and disconnected.", "info");
      return;
    }

    // ── /remote verbosity <level> ──
    if (trimmed.toLowerCase().startsWith("verbosity") || trimmed.toLowerCase().startsWith("verb")) {
      const levelMatch = trimmed.match(/verbosity\s+(\S+)/i);
      if (!levelMatch) {
        notify("Usage: /remote verbosity <low|mid|high|xhigh>", "warning");
        return;
      }
      const level = levelMatch[1].toLowerCase();
      const validLevels: VerbosityLevel[] = ["low", "mid", "high", "xhigh"];
      // Accept "medium" as alias for "mid"
      const mappedLevel = level === "medium" ? "mid" : level;
      if (validLevels.includes(mappedLevel as VerbosityLevel)) {
        config.verbosity = mappedLevel as VerbosityLevel;
        safeSend({
          type: "config_update" as const,
          cwd,
          verbosity: mappedLevel,
        });
        notify(`Telegram bridge: verbosity set to ${mappedLevel}`, "info");
      } else {
        notify(
          `Telegram bridge: invalid verbosity "${level}". Use low|mid|high|xhigh`,
          "warning"
        );
      }
      return;
    }

    // ── /remote pair ──
    if (trimmed.toLowerCase() === "pair") {
      await runPairWizard();
      return;
    }

    // ── /remote pair <token> <groupId> ──
    const pairMatch = trimmed.match(/^pair\s+(\S+)\s+(\S+)/i);
    if (pairMatch) {
      const botToken = pairMatch[1].trim();
      const rawGroupId = pairMatch[2].trim();
      const groupId = parseGroupId(rawGroupId);
      if (groupId === null) {
        notify(
          `Invalid group ID "${rawGroupId}". Expected a (negative) number with 6+ digits, e.g. -1001234567890.`,
          "warning"
        );
        return;
      }
      notify(`Validating bot token ${botToken.slice(0, 6)}…`, "info");
      const tokenCheck = await validateToken(botToken);
      if (!tokenCheck.ok) {
        notify(`Bot token validation failed: ${tokenCheck.reason}.`, "error");
        return;
      }
      notify(`Validating group ${groupId}…`, "info");
      const groupCheck = await validateGroup(botToken, groupId);
      if (!groupCheck.ok) {
        notify(`Group validation failed: ${groupCheck.reason}.`, "error");
        return;
      }
      if (!writeBridgeConfig(botToken, groupId)) {
        notify("Failed to write config.", "error");
        return;
      }
      config.enabled = true;
      ensureDaemon();
      connectSocket();
      safeSend({ type: "config_reload" as const });
      notify(
        `✅ Paired with token ${botToken.slice(0, 6)}… and group ${groupId}. Bridge enabled.`,
        "info"
      );
      return;
    }

    // ── /remote help ──
    if (trimmed.toLowerCase() === "help") {
      const helpText = [
        "Telegram bridge control:",
        "",
        "  /remote                    — show status (daemon connected, enabled, verbosity, workspace)",
        "  /remote status             — same as above",
        "  /remote on                 — connect this session to Telegram (starts polling if daemon not running)",
        "  /remote off                — disconnect this session from Telegram (stops polling if no sessions remain)",
        "  /remote verbosity <level>  — set verbosity (low|mid|high|xhigh)",
        "  /remote pair               — interactive setup wizard",
        "  /remote pair <token> <groupId> — direct pairing (non-interactive)",
        "  /remote help               — show this message",
      ].join("\n");
      notify(helpText, "info");
      return;
    }

    // ── Unknown command ──
    notify(
      `Unknown subcommand "${trimmed}". Use /remote help for usage.`,
      "warning"
    );
  } catch {
    // Never crash the session
  }
}

interface RemoteSubcommand {
  name: string;
  label: string;
  description: string;
  hint?: string;
}

const REMOTE_SUBCOMMANDS: RemoteSubcommand[] = [
  { name: "status", label: "status", description: "Show bridge status" },
  { name: "on", label: "on", description: "Connect this session to Telegram" },
  { name: "off", label: "off", description: "Disconnect this session from Telegram" },
  {
    name: "verbosity",
    label: "verbosity",
    description: "Set verbosity level",
    hint: "low|mid|high|xhigh",
  },
  {
    name: "pair",
    label: "pair",
    description: "Pair a bot token + group",
    hint: "<token> <groupId>",
  },
  { name: "help", label: "help", description: "Show usage" },
];

const REMOTE_VERBOSITY_LEVELS: string[] = ["low", "mid", "high", "xhigh"];

/** TUI completions for /remote <subcommand> [arg]. */
function getRemoteCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const lower = argumentPrefix.toLowerCase();
  const sp = lower.indexOf(" ");
  if (sp !== -1) {
    // Complete only the second argument for known multi-arg subcommands.
    if (lower.slice(0, sp) === "verbosity") {
      const rest = argumentPrefix.slice(sp + 1);
      return REMOTE_VERBOSITY_LEVELS.filter((l) => l.startsWith(rest)).map((l) => ({
        value: `verbosity ${l} `,
        label: l,
        description: `Set verbosity to ${l}`,
      }));
    }
    return null;
  }
  return REMOTE_SUBCOMMANDS.filter((s) => s.name.startsWith(lower)).map((s) => ({
    value: `${s.name} `,
    label: s.label,
    description: s.description,
    hint: s.hint,
  }));
}

function registerRemoteCommand(pi: ExtensionAPI): void {
  try {
    pi.registerCommand("remote", {
      description: "Telegram bridge control: status, on/off, verbosity, pair",
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        await handleRemoteCommand(args, ctx);
      },
      getArgumentCompletions: getRemoteCompletions,
    });
  } catch {
    // registerCommand may not exist in -p mode; no-op
  }
}
function sendStateFrame(): void {
  if (!config.enabled || !connected) return;
  const usage = ctxRef?.getContextUsage?.();
  const snapshot = ctxRef?.getAsyncJobSnapshot?.();
  const running = snapshot?.running ?? [];
  const recent = snapshot?.recent ?? [];
  const model = modelName();
  const doneCount = todoPhases.reduce((s, p) => s + p.todos.filter((t) => t.status === "completed" || t.status === "abandoned").length, 0);
  const activeCount = todoPhases.reduce((s, p) => s + p.todos.filter((t) => t.status === "pending" || t.status === "in_progress" || t.status === "blocked").length, 0);
  const totalTasks = todoPhases.reduce((s, p) => s + p.todos.length, 0);
  const todosSummary: TodosSummary | null = totalTasks > 0 ? { done: doneCount, active: activeCount, total: totalTasks } : null;
  safeSend({
    type: "progress" as const,
    kind: "state" as const,
    data: {
      contextPct: usage?.percent ?? null,
      jobsRunning: running.length,
      jobsRecent: recent.length,
      turnDurationMs,
      turnCount: currentTurnIndex,
      sessionStartAt,
      lastToolAt,
      todoUpdatedAt,
      model,
      todosSummary,
    },
  });
}


function startHeartbeat(): void {
  if (!ctxRef || heartbeatTimer) return;
  const ref = ctxRef;
  heartbeatTimer = ref.setInterval(() => {
    if (!connected) {
      heartbeatTimer = null;
      return;
    }
    sendStateFrame();
  }, 30_000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    ctxRef?.clearTimer?.(heartbeatTimer);
    heartbeatTimer = null;
  }
}
function buildDigestText(): string {
  const parts: string[] = [];
  // Metadata header
  const model = modelName() ?? "unknown";
  const usage = ctxRef?.getContextUsage?.();
  const contextPct = usage?.percent ?? null;
  const turnLive = turnStartAt > 0;
  parts.push(`cwd: ${cwd ?? "?"}`);
  parts.push(`session: ${sessionId || "?"}`);
  parts.push(`model: ${model}`);
  parts.push(`verbosity: ${config.verbosity}`);
  parts.push(`turn: ${turnLive ? "live" : "idle"}`);
  parts.push(`context: ${contextPct === null ? "n/a" : contextPct + "%"}`);
  // Cumulative cross-turn progress (most recent first) — the AI's only memory
  // of earlier turns; without it every summary claims "no prior progress".
  if (turnRecaps.length) {
    parts.push("prior progress: " + turnRecaps.slice(-6).reverse().join(" ;; "));
  }
  // Tool one-liners (last 5)
  if (digest.toolOneLiners.length) {
    parts.push("tools: " + digest.toolOneLiners.slice(-5).join(", "));
  }
  // Assistant excerpts (last 200 chars total)
  if (digest.assistantExcerpts.length) {
    const last = digest.assistantExcerpts[digest.assistantExcerpts.length - 1];
    parts.push("assistant: " + (last.length > 200 ? last.slice(0, 200) + "…" : last));
  }
  // User messages
  if (digest.userMessages.length) {
    parts.push("user: " + digest.userMessages.join(" » "));
  }
  // Todos summary
  const doneCount = todoPhases.reduce((s, p) => s + p.todos.filter((t) => t.status === "completed" || t.status === "abandoned").length, 0);
  const activeCount = todoPhases.reduce((s, p) => s + p.todos.filter((t) => t.status === "pending" || t.status === "in_progress" || t.status === "blocked").length, 0);
  const totalTasks = todoPhases.reduce((s, p) => s + p.todos.length, 0);
  if (totalTasks > 0) {
    parts.push(`todos: ${doneCount} done / ${activeCount} active / ${totalTasks} total`);
  }
  const full = parts.join(" | ");
  // Cap at ~3000 chars
  return full.length > 3000 ? full.slice(0, 3000) + "…" : full;
}

type SummaryMode = "turn" | "plan";

async function maybeSendSummary(mode: SummaryMode = "turn"): Promise<void> {
  const prompt =
    mode === "plan"
      ? "The plan/task is complete. Summarize the ENTIRE task execution for the user in 3-5 short lines: the goal, what was done (done), anything still in flight, and any blockers. Base it strictly on the 'prior progress' and other evidence — never claim there was no prior work if the evidence shows work was done. Be concise, no preamble."
      : "Summarize this coding session's progress in 2-4 short lines: what is done, what is in flight, any blockers. Be concise, no preamble.";
  try {
    const digestText = buildDigestText();
    const pi = await import("@oh-my-pi/pi-ai");
    const model = ctxRef?.model;
    if (model) {
      const apiKey = await ctxRef!.modelRegistry.getApiKey(model);
      const ctx: Context = {
        systemPrompt: [prompt],
        messages: [{ role: "user" as const, content: [{ type: "text" as const, text: digestText }], timestamp: Date.now() }],
      };
      const resp: AssistantMessage = await pi.completeSimple(model, ctx, { apiKey });
      const text = (resp.content ?? [])
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (text) {
        safeSend({ type: "progress", kind: "summary", data: { text: toTelegramHtml(text), source: "ai" as const } });
        if (mode === "turn") {
          summaryThisTurn = true;
          turnsSinceSummary = 0;
        }
        log(`[summary] ${mode} ai`);
        return;
      }
    }
  } catch {
    // Any failure degrades to digest path
  }
  // Fallback: deterministic digest
  const fb = buildDigestText() || "(no events this window)";
  safeSend({ type: "progress", kind: "summary", data: { text: escapeHtml(fb), source: "digest" as const } });
  summaryThisTurn = true;
  turnsSinceSummary = 0;
  log(`[btw] digest`);
}

/**
 * Side-question handler: one-shot AI call (like the summary path) whose
 * answer is posted to the topic immediately as a `btw` progress frame.
 * Never touches the running turn.
 */
async function answerBtw(question: string): Promise<void> {
  try {
    // Lazy: pi-ai resolves only against the runtime model registry, never at
    // extension-load time (same pattern as maybeSendSummary).
    const pi = await import("@oh-my-pi/pi-ai");
    const model = ctxRef?.model;
    if (!model) {
      safeSend({ type: "progress", kind: "btw", data: { text: escapeHtml("(no active model — cannot answer)") } });
      return;
    }
    const apiKey = await ctxRef?.modelRegistry.getApiKey(model);
    const ctx: Context = {
      systemPrompt: [
        "You are answering a quick side question about the coding session you are running. Answer directly in 1-4 short lines, no preamble.",
      ],
      messages: [
        { role: "user" as const, content: [{ type: "text" as const, text: "Session started at " + new Date(sessionStartAt).toISOString() + ". Current working directory: " + cwd + "." }], timestamp: Date.now() },
        { role: "user" as const, content: [{ type: "text" as const, text: question }], timestamp: Date.now() },
      ],
    };
    const resp: AssistantMessage = await pi.completeSimple(model, ctx, { apiKey });
    const text = (resp.content ?? [])
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (text) {
      safeSend({ type: "progress", kind: "btw", data: { text: toTelegramHtml(text) } });
      log("[btw] answer");
      return;
    }
    safeSend({ type: "progress", kind: "btw", data: { text: escapeHtml("(empty answer)") } });
  } catch (e) {
    log(`[btw] failed: ${(e as Error).message}`);
    safeSend({ type: "progress", kind: "btw", data: { text: escapeHtml("(side-question call failed)") } });
  }
}

function handleUserMessage(
  ev: { message: { role: "user"; content: string | { type: string; text?: string }[]; synthetic?: boolean; steering?: boolean } },
  _ctx: ExtensionContext
): void {
  const msg = ev.message;
  if (msg.role !== "user") return;
  if (msg.synthetic || msg.steering) return;
  if (typeof msg.content === "string") {
    if (msg.content.trim()) {
      digest.userMessages.push(msg.content.trim());
    }
    return;
  }
  if (Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type === "text" && c.text && c.text.trim()) {
        digest.userMessages.push(c.text.trim());
        break;
      }
    }
  }
}
// ── Event handlers ─────────────────────────────────────────────────────────

function handleSessionStart(_ev: SessionStartEvent, ctx: ExtensionContext): void {
  ctxRef = ctx;
  cwd = ctx.cwd;
  sessionId = ctx.sessionManager.getSessionId() ?? "";
  sessionFile = ctx.sessionManager.getSessionFile() ?? "";
  pid = process.pid;
  sessionStartAt = Date.now();
  try {
    ompVersion = String((piRef?.pi as { VERSION?: string })?.VERSION ?? "unknown");
  } catch {
    /* version is best-effort */
  }

  // Connect socket only when enabled
  if (config.enabled) {
    ensureDaemon();
    connectSocket();
  }
}
function handleTurnStart(ev: TurnStartEvent, _ctx: ExtensionContext): void {
  currentTurnIndex = ev.turnIndex;
  midFinalText = "";
  digest.userMessages.length = 0;
  digest.toolOneLiners.length = 0;
  digest.assistantExcerpts.length = 0;
  toolCallsThisTurn = 0;
  summaryThisTurn = false;
  nextTurnDeliverFinal = false;
  turnStartAt = Date.now();
  abortPending = false;
  sendCompactionDone();
  if (config.enabled && connected) {
    safeSend({ type: "progress", kind: "turn_start", data: String(ev.turnIndex) });
  }
  enqueueProgress("turn_start", ev);
}

function handleTurnEnd(ev: TurnEndEvent, _ctx: ExtensionContext): void {
  // Flush message lines first so they precede the turn_end frame on the wire.
  immediateFlush();
  if (config.enabled && connected) {
    safeSend({ type: "progress", kind: "turn_end", data: String(ev.turnIndex) });
  }
  enqueueProgress("turn_end", ev);
  // Capture turn duration for state frame
  turnDurationMs = turnStartAt ? Date.now() - turnStartAt : null;
  // Mid: deliver final answer as standalone message frame
  if (config.verbosity === "mid" && midFinalText.trim() && connected) {
    safeSend({ type: "progress", kind: "message", data: midFinalText, turnIndex: currentTurnIndex });
  }
  // Cross-turn memory: append a one-line recap of the turn that just ended.
  // The per-turn digest is cleared at the next turn_start, so this is the
  // only place where completed-turn work survives into later summaries.
  {
    const last = digest.assistantExcerpts.length
      ? digest.assistantExcerpts[digest.assistantExcerpts.length - 1].trim()
      : "";
    const tools = digest.toolOneLiners.slice(-3).join(", ");
    const recap =
      last.slice(0, 160) ||
      (tools ? "tools: " + tools.slice(0, 120) : `turn ${ev.turnIndex} ended (no assistant text)`);
    turnRecaps.push(`t${ev.turnIndex}: ${recap}`);
    if (turnRecaps.length > 40) turnRecaps.splice(0, turnRecaps.length - 40);
  }
  turnsSinceSummary++;
  const should = (turnsSinceSummary % (config.summaryEvery || 8) === 0) || (toolCallsThisTurn >= 6 && !summaryThisTurn);
  if (config.enabled && connected && should && ctxRef) {
    void maybeSendSummary();
  }
  sendStateFrame();
}

function handleToolExecutionStart(
  ev: ToolExecutionStartEvent,
  _ctx: ExtensionContext
): void {
  toolCallsThisTurn++;
  lastToolAt = Date.now();
  if (ev.toolName) {
    digest.toolOneLiners.push(renderToolOneLiner(ev));
  }
  enqueueProgress("tool", ev);
}

function handleToolExecutionEnd(
  ev: ToolExecutionEndEvent,
  _ctx: ExtensionContext
): void {
  // The todo tool's result carries the full phase snapshot (details.phases)
  // for every op — the authoritative source for /todo and /status.
  if (ev.toolName === "todo" && !ev.isError) {
    captureTodoResult(ev.result);
  }
  if (ev.isError) {
    const text = extractToolErrorText(ev.result);
    const firstLine = (text.split("\n")[0] ?? "").slice(0, 200);
    const key = `${ev.toolName}::${firstLine}`;
    if (lastError && lastError.error === key) {
      lastError.count += 1;
    } else {
      lastError = { error: key, text: firstLine, count: 1 };
    }
    if (connected) {
      safeSend({ type: "progress", kind: "error", data: { toolName: ev.toolName, text: escapeHtml(firstLine), repeated: lastError.count } });
    }
    digest.toolOneLiners.push(`❌ ${ev.toolName}: ${firstLine}`);
  }
}

function handleMessageEnd(ev: MessageEndEvent, _ctx: ExtensionContext): void {
  if ((config.verbosity === "mid" || nextTurnDeliverFinal) && ev.message.role === "assistant") {
    midFinalText = renderMessageEnd(ev) ?? "";
  }
  if (config.verbosity !== "mid") {
    enqueueProgress("message", ev);
  }
  // Add assistant text excerpt to digest
  if (ev.message.role === "assistant" && ev.message.content) {
    for (const c of ev.message.content) {
      if (c.type === "text" && c.text) {
        digest.assistantExcerpts.push(c.text.slice(0, 120));
        break;
      }
    }
  }
}

type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

function normalizeTodoPhases(raw: unknown): TodoPhase[] {
  const phases: TodoPhase[] = [];
  if (!Array.isArray(raw)) return phases;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.phase === "string" ? obj.phase : typeof obj.name === "string" ? obj.name : "General";
    const items = (obj.items ?? []) as unknown[];
    const tasks: { content: string; status: TodoStatus }[] = [];
    for (const item of items) {
      if (typeof item === "string") tasks.push({ content: item, status: "pending" });
      else if (item && typeof item === "object") {
        const ti = item as Record<string, unknown>;
        if (typeof ti.content === "string") {
          tasks.push({ content: ti.content, status: (typeof ti.status === "string" ? ti.status : "pending") as TodoStatus });
        }
      }
    }
    if (tasks.length > 0) phases.push({ phase: name, todos: tasks });
  }
  return phases;
}

function upsertPhase(phase: string, tasks: { content: string; status: TodoStatus }[]): void {
  const idx = todoPhases.findIndex((p) => p.phase === phase);
  if (idx >= 0) todoPhases[idx] = { phase, todos: tasks };
  else todoPhases.push({ phase, todos: tasks });
}

/**
 * Replace captured todo state from the authoritative tool result.
 * ToolExecutionEndEvent.result is the AgentToolResult { content, details };
 * for the todo tool, details.phases is the full phase snapshot after the op —
 * present for every op (init/append/start/done/…/view), unlike the input,
 * which only carries the full list for init/append.
 */
function captureTodoResult(result: unknown): void {
  const details = (result && typeof result === "object" ? (result as Record<string, unknown>).details : undefined) as Record<string, unknown> | undefined;
  if (!details || !Array.isArray(details.phases)) return;
  const phases = normalizeTodoPhases(details.phases);
  if (phases.length > 0) {
    todoPhases.length = 0;
    for (const p of phases) upsertPhase(p.phase, p.todos);
  }
  todoUpdatedAt = Date.now();
}

function handleTodoReminder(ev: TodoReminderEvent, _ctx: ExtensionContext): void {
  enqueueProgress("todo", ev);
  // Fold reminder todos (incomplete only) into captured phases by content;
  // seed a phase for any unknown task so the list is never empty when the
  // session restored tasks without a captured todo op this session.
  for (const t of ev.todos ?? []) {
    const content = typeof t.content === "string" ? t.content : "";
    if (!content) continue;
    const status = (typeof t.status === "string" ? t.status : "pending") as TodoStatus;
    let found = false;
    for (const p of todoPhases) {
      const existing = p.todos.find((x) => x.content === content);
      if (existing) { existing.status = status; found = true; break; }
    }
    if (!found) {
      let phase = todoPhases.find((p) => p.phase === "Tasks");
      if (!phase) {
        phase = { phase: "Tasks", todos: [] };
        todoPhases.push(phase);
      }
      phase.todos.push({ content, status });
    }
  }
  todoUpdatedAt = Date.now();
  // Send todo_state frame for /status
  if (connected) {
    safeSend({ type: "progress", kind: "todo_state", data: { todos: (ev.todos ?? []).map((t) => ({ content: t.content ?? "", status: t.status ?? "" })) } });
  }
}

function handleAgentStart(ev: AgentStartEvent, _ctx: ExtensionContext): void {
  enqueueProgress("agent_start", ev);
}

function handleAgentEnd(ev: AgentEndEvent, _ctx: ExtensionContext): void {
  enqueueProgress("agent_end", ev);
  // Plan completion: the whole task finished (no auto-continuation scheduled,
  // not an aborted run, and no summary already sent this turn).
  if (
    config.enabled &&
    connected &&
    ctxRef &&
    ev.willContinue !== true &&
    !abortPending &&
    !summaryThisTurn
  ) {
    void maybeSendSummary("plan");
  }
}

/**
 * Signal the end of a compaction window. Guarded by the compacting flag so it
 * fires exactly once (from session_compact or, if that never fires, from the
 * next turn_start).
 */
function sendCompactionDone(): void {
  if (!compacting) return;
  compacting = false;
  if (config.enabled && connected) {
    safeSend({ type: "progress", kind: "compaction_done", data: { at: Date.now() } });
  }
}

function handleCompacting(_ev: SessionCompactingEvent, _ctx: ExtensionContext): void {
  compacting = true;
  if (config.enabled && connected) {
    safeSend({ type: "progress", kind: "compacting", data: { at: Date.now() } });
  }
}

function handleCompactionEnd(ev: SessionCompactEvent, _ctx: ExtensionContext): void {
  sendCompactionDone();
  const before = ev.compactionEntry?.tokensBefore;
  const after = ev.compactionEntry?.tokensAfter;
  if (config.enabled && connected && (typeof before === "number" || typeof after === "number")) {
    safeSend({
      type: "progress",
      kind: "compaction_detail",
      data: { tokensBefore: before ?? null, tokensAfter: after ?? null },
    });
  }
}

function handleSessionShutdown(_ev: SessionShutdownEvent): void {
  flushProgressBatch();
  closeSocket();
  shuttingDown = false; // reset for next session
}

async function handleToolCall(
  ev: ToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | undefined> {
  if (ev.type !== "tool_call") return undefined;
  const custom = ev as CustomToolCallEvent;

  if (!config.enabled || !connected) return undefined;
  if (custom.toolName !== "ask") return undefined;

  // Intercept ask: send question, await answer, return block+reason
  return handleAskInterception(custom, ctx);
}

async function handleAskInterception(
  ev: CustomToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult> {
  const input = ev.input as Record<string, unknown> | undefined;
  if (!input) return { block: false };

  const questions = input.questions as
    | {
        header?: string;
        id?: string;
        question?: string;
        options?: { label?: string; description?: string; preview?: string }[];
        multi?: boolean;
        recommended?: number;
      }[]
    | undefined;

  if (!questions?.length) return { block: false };

  // Build pending answers for each question
  const answerPromises: Promise<unknown>[] = [];
  const qIds: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qId = `${ev.toolCallId}-${i + 1}`;

    // Map options to question frame
    const opts = q.options;
    const kind: "select" | "input" =
      opts && opts.length > 0 ? "select" : "input";
    const title = q.question ?? q.header ?? `Question ${i + 1}`;
    const options = opts?.map((o) => o.label).filter(Boolean) ?? [];
    const defaultOpt =
      q.recommended !== undefined && opts?.[q.recommended]?.label
        ? opts[q.recommended].label
        : undefined;

    const questionFrame = {
      type: "question" as const,
      id: qId,
      kind,
      title: escapeHtml(title),
      options,
      default: defaultOpt,
    };
    safeSend(questionFrame);

    // Create pending answer with timeout
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = ctx.setTimeout(() => {
      const pending = pendingAnswers.get(qId);
      if (pending) {
        pendingAnswers.delete(qId);
        reject(
          new Error(
            `No reply from mobile within ${Math.round(askTimeoutMs / 60000)} minutes. The user is unavailable; proceed with your best judgement and note the assumption.`
          )
        );
      }
    }, askTimeoutMs);

    pendingAnswers.set(qId, {
      id: qId,
      resolve,
      reject,
      timer,
    });
    qIds.push(qId);
    answerPromises.push(promise);
  }

  try {
    const answers = await Promise.all(answerPromises);
    const values = answers.map((a) =>
      Array.isArray(a) ? a.map((x) => String(x)).join(", ") : String(a ?? "no reply")
    );
    return {
      block: true,
      reason: `User answered the mobile question${values.length > 1 ? "s" : ""}: ${values.join(" | ")}`,
    };
  } catch (err) {
    // Timeout or disconnect: release any still-pending questions
    for (const id of qIds) {
      const pending = pendingAnswers.get(id);
      if (pending) {
        ctx.clearTimer?.(pending.timer);
        pendingAnswers.delete(id);
      }
    }
    const msg = err instanceof Error ? err.message : "No reply from mobile";
    return { block: true, reason: msg };
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  piRef = pi;
  // Register /remote command
  registerRemoteCommand(pi);

  // Session lifecycle
  pi.on("session_start", handleSessionStart);
  pi.on("session_shutdown", handleSessionShutdown);

  // Progress events
  pi.on("turn_start", handleTurnStart);
  pi.on("turn_end", handleTurnEnd);
  pi.on("tool_execution_start", handleToolExecutionStart);
  pi.on("tool_execution_end", handleToolExecutionEnd);
  pi.on("message_end", handleMessageEnd);
  pi.on("todo_reminder", handleTodoReminder);
  pi.on("agent_start", handleAgentStart);
  pi.on("agent_end", handleAgentEnd);
  pi.on("session.compacting", handleCompacting);
  pi.on("session_compact", handleCompactionEnd);

  // User message tracking
  (pi.on as (event: string, handler: (ev: unknown, ctx: ExtensionContext) => void) => void)("user_message", handleUserMessage as (ev: unknown, ctx: ExtensionContext) => void);
  // Ask interception
  pi.on("tool_call", handleToolCall);
}
