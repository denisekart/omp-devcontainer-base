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
  SessionShutdownEvent,
  SessionStartEvent,
  CustomToolCallEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

// Timer is not exported from the types module; it's just a timer handle.
type Timer = number;

// ── Types ──────────────────────────────────────────────────────────────────

type VerbosityLevel = "low" | "mid" | "high" | "xhigh";

interface BridgeConfig {
  enabled: boolean;
  verbosity: VerbosityLevel;
}

interface PendingAnswer {
  id: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: Timer;
}

interface PendingQuestion {
  id: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface ProgressBatch {
  lines: string[];
  timer: Timer | null;
}

interface AskState {
  pending: PendingQuestion[];
  answered: Map<string, unknown>;
  timer: Timer | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BridgeConfig = { enabled: true, verbosity: "mid" };
const SOCKET_PATH_ENV = "TG_BRIDGE_SOCK";
const DEFAULT_SOCK_DIR = path.join(os.homedir(), ".omp", "tg-bridge");
const DEFAULT_SOCK_PATH = path.join(DEFAULT_SOCK_DIR, "sock");
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_FACTOR = 1.5;
const BATCH_FLUSH_MS = 1_500;
const ASK_TIMEOUT_MS = 600_000; // 10 minutes
const ASK_TIMEOUT_MS_ENV = "TG_BRIDGE_ASK_TIMEOUT_MS";

// ── State ──────────────────────────────────────────────────────────────────

let config: BridgeConfig = { ...DEFAULT_CONFIG };
let socket: net.Socket | null = null;
let connected = false;
let reconnectBackoffMs = RECONNECT_MIN_MS;
let lastEventAt = Date.now();
let askTimeoutMs = parseInt(
  process.env[ASK_TIMEOUT_MS_ENV] ?? "",
  10
) || ASK_TIMEOUT_MS;
let progressBatch: ProgressBatch = { lines: [], timer: null };
let pendingAnswers = new Map<string, PendingAnswer>();
let ctxRef: ExtensionContext | null = null;
let piRef: ExtensionAPI | null = null;
let sessionId = "";
let sessionFile = "";
let cwd = "";
let pid = process.pid;
let ompVersion = "unknown";
let recvBuffer = "";
let shuttingDown = false;

// ── Helpers ────────────────────────────────────────────────────────────────

function getSocketPath(): string {
  return process.env[SOCKET_PATH_ENV] ?? DEFAULT_SOCK_PATH;
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

function flushProgressBatch(): void {
  if (progressBatch.lines.length > 0) {
    const lines = progressBatch.lines;
    progressBatch.lines = [];
    if (lines.length > 0) {
      safeSend({
        type: "progress",
        kind: "message",
        data: lines.join("\n"),
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

function renderProgressLine(kind: string, data: unknown): string | null {
  if (!config.enabled || !connected) return null;

  const v = config.verbosity;

  // Always emit for enabled+connected
  switch (kind) {
    case "turn_start": {
      const ev = data as TurnStartEvent;
      if (v === "low" || v === "mid" || v === "high" || v === "xhigh") {
        return `[turn ${ev.turnIndex}] start`;
      }
      return null;
    }
    case "turn_end": {
      const ev = data as TurnEndEvent;
      if (v === "low" || v === "mid" || v === "high" || v === "xhigh") {
        return `[turn ${ev.turnIndex}] end`;
      }
      return null;
    }
    case "tool": {
      const ev = data as ToolExecutionStartEvent;
      if (v === "low") return null;
      // mid+: tool one-liner
      return renderToolOneLiner(ev);
    }
    case "message": {
      const ev = data as MessageEndEvent;
      if (v === "low") return null;
      return renderMessageEnd(ev);
    }
    case "todo": {
      const ev = data as TodoReminderEvent;
      if (v === "low" || v === "mid") return null;
      return renderTodo(ev);
    }
    case "error": {
      const ev = data as ToolExecutionEndEvent;
      if (v === "low") {
        return ev.isError ? `${ev.toolName} ERROR` : null;
      }
      return ev.isError ? `${ev.toolName} ERROR` : null;
    }
    case "agent_start": {
      if (v === "xhigh") {
        const ev = data as AgentStartEvent;
        return `[agent] start`;
      }
      return null;
    }
    case "agent_end": {
      if (v === "xhigh") {
        const ev = data as AgentEndEvent;
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

  // Truncate to 4096 chars max per Telegram limit
  const truncated = text.length > 4096 ? text.slice(0, 4093) + "…" : text;
  return truncated;
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
  try {
    socket = new net.Socket();
    socket.connect(sockPath, () => {
      connected = true;
      reconnectBackoffMs = RECONNECT_MIN_LAST;
      log("connected");
      sendHello();
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
      if (!shuttingDown) scheduleReconnect();
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

const RECONNECT_MIN_LAST = RECONNECT_MIN_MS;

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
      if (enabled !== undefined) config.enabled = enabled;
      if (verbosity !== undefined) config.verbosity = verbosity;
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
      break;
    }
    case "abort": {
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
  }
}

// ── Event handlers ─────────────────────────────────────────────────────────

function handleSessionStart(_ev: SessionStartEvent, ctx: ExtensionContext): void {
  ctxRef = ctx;
  cwd = ctx.cwd;
  sessionId = ctx.sessionManager.getSessionId() ?? "";
  sessionFile = ctx.sessionManager.getSessionFile() ?? "";
  pid = process.pid;
  try {
    ompVersion = String((piRef?.pi as { VERSION?: string })?.VERSION ?? "unknown");
  } catch {
    /* version is best-effort */
  }
  connectSocket();
}

function handleTurnStart(ev: TurnStartEvent, ctx: ExtensionContext): void {
  enqueueProgress("turn_start", ev);
}

function handleTurnEnd(ev: TurnEndEvent, ctx: ExtensionContext): void {
  enqueueProgress("turn_end", ev);
  immediateFlush();
}

function handleToolExecutionStart(
  ev: ToolExecutionStartEvent,
  ctx: ExtensionContext
): void {
  enqueueProgress("tool", ev);
}

function handleToolExecutionEnd(
  ev: ToolExecutionEndEvent,
  ctx: ExtensionContext
): void {
  if (ev.isError) {
    enqueueProgress("error", ev);
  }
}

function handleMessageEnd(ev: MessageEndEvent, ctx: ExtensionContext): void {
  enqueueProgress("message", ev);
}

function handleTodoReminder(ev: TodoReminderEvent, ctx: ExtensionContext): void {
  enqueueProgress("todo", ev);
}

function handleAgentStart(ev: AgentStartEvent, ctx: ExtensionContext): void {
  enqueueProgress("agent_start", ev);
}

function handleAgentEnd(ev: AgentEndEvent, ctx: ExtensionContext): void {
  enqueueProgress("agent_end", ev);
}

function handleSessionShutdown(_ev: SessionShutdownEvent): void {
  flushProgressBatch();
  closeSocket();
}

async function handleToolCall(
  ev: ToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | undefined> {
  if (!config.enabled || !connected) return undefined;

  // Only intercept CustomToolCallEvent (ask is not a named variant)
  if (ev.type !== "tool_call") return undefined;
  const custom = ev as CustomToolCallEvent;
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
      title,
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
            "No reply from mobile within 10 minutes. The user is unavailable; proceed with your best judgement and note the assumption."
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

// ── /remote command ────────────────────────────────────────────────────────

function registerRemoteCommand(pi: ExtensionAPI): void {
  try {
    pi.registerCommand("remote", {
      description: "Telegram bridge control: status, on/off, verbosity",
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        try {
          const notify = (text: string, type?: "info" | "warning" | "error") => {
            try {
              ctx.ui?.notify?.(text, type);
            } catch {
              /* notify is best-effort (may be absent in -p mode) */
            }
          };
          const trimmed = args.trim();

          if (!trimmed) {
            // Status
            const statusLines: string[] = [
              `Telegram bridge: enabled=${config.enabled}, verbosity=${config.verbosity}`,
              `daemon connected: ${connected ? "yes" : "no"}`,
            ];
            if (!connected) {
              const age = Math.round((Date.now() - lastEventAt) / 1000);
              statusLines.push(`last event: ${age}s ago`);
            }
            notify(statusLines.join("\n"), "info");
            return;
          }

          const parts = trimmed.split(/\s+/);
          const cmd = parts[0]?.toLowerCase();

          if (cmd === "on") {
            config.enabled = true;
            safeSend({ type: "config_update" as const, cwd, enabled: true });
            notify("Telegram bridge: enabled", "info");
          } else if (cmd === "off") {
            config.enabled = false;
            safeSend({ type: "config_update" as const, cwd, enabled: false });
            notify("Telegram bridge: disabled", "info");
          } else if (cmd === "verbosity" || cmd === "verb") {
            const level = parts[1]?.toLowerCase();
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
          } else {
            notify(
              `Telegram bridge: unknown command "${cmd}". Use: on|off|verbosity <level>`,
              "warning"
            );
          }
        } catch {
          // Never crash the session
        }
      },
    });
  } catch {
    // registerCommand may not exist in -p mode; no-op
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

  // Ask interception
  pi.on("tool_call", handleToolCall);
}
