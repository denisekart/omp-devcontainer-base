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
  SessionShutdownEvent,
  SessionStartEvent,
  CustomToolCallEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

// Timer: opaque handle returned by ctx.setTimeout (the API's Timer type is not
// exported). Stored as number; ctx.clearTimer accepts the handle at runtime.
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

interface ProgressBatch {
  lines: string[];
  timer: Timer | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BridgeConfig = { enabled: false, verbosity: "mid" };
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
let daemonSocketPath = "";

// ── Helpers ────────────────────────────────────────────────────────────────

function getSocketPath(): string {
  return process.env[SOCKET_PATH_ENV] ?? DEFAULT_SOCK_PATH;
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
  daemonSocketPath = sockPath;
  try {
    socket = new net.Socket();
    socket.connect(sockPath, () => {
      connected = true;
      reconnectBackoffMs = RECONNECT_MIN_MS;
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

// ── Supervisor ensure ──────────────────────────────────────────────────────

function ensureDaemon(): void {
  const sockPath = getSocketPath();

  // If socket already exists, daemon is running
  if (fs.existsSync(sockPath)) return;

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

  // Step 2: Validate token with getMe (send to daemon for direct fetch)
  notify?.("Validating bot token…", "info");
  safeSend({ type: "pair_validate" as const, token: botToken });

  // Wait for pair_done or timeout (30s)
  const validatePromise = new Promise<boolean>((resolve) => {
    // Intercept pair_done via a one-shot socket handler until it arrives or times out.
    if (socket && socket.readyState === "open") {
      const handler = (data: Buffer) => {
        lastEventAt = Date.now();
        const raw = data.toString("utf-8");
        const lines = raw.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const frame = JSON.parse(trimmed);
            if (frame.type === "pair_done") {
              const success = frame.success as boolean | undefined;
              if (success) {
                resolve(true);
                return;
              }
            }
          } catch {
            /* skip */
          }
        }
      };
      socket.on("data", handler);
      setTimeout(() => {
        socket?.removeListener("data", handler);
        resolve(false);
      }, 30_000);
    } else {
      resolve(false);
    }
  });

  const validated = await validatePromise;
  if (!validated) {
    notify?.("Bot token validation failed or timed out. Pairing cancelled.", "error");
    return;
  }

  // Step 3: Explain group setup
  notify?.(
    "Step 3: Add your bot to a Telegram group (supergroup/forum).\n\n" +
    "The daemon will auto-detect the group, or you can provide the group ID manually.\n\n" +
    "Reply with a group ID (e.g. -1001234567890) or press Enter to auto-detect.",
    "info"
  );

  const groupIdInput = await ui?.input?.("Group ID (optional)", "-1001234567890");
  const groupId = groupIdInput?.trim();

  if (groupId) {
    // Step 4: Validate group with daemon
    notify?.("Validating group…", "info");
    safeSend({ type: "pair_validate_group" as const, groupId });

    const groupValidated = await new Promise<boolean>((resolve) => {
      const savedHandler = (data: Buffer) => {
        lastEventAt = Date.now();
        const raw = data.toString("utf-8");
        const lines = raw.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const frame = JSON.parse(trimmed);
            if (frame.type === "pair_done") {
              const success = frame.success as boolean | undefined;
              if (success) resolve(true);
            }
          } catch {
            /* skip */
          }
        }
      };
      socket?.on("data", savedHandler);
      setTimeout(() => {
        socket?.removeListener("data", savedHandler);
        resolve(false);
      }, 30_000);
    });

    if (!groupValidated) {
      notify?.("Group validation failed or timed out. Pairing cancelled.", "error");
      return;
    }
  }

  // Step 5: Write config.json
  const configPath = getConfigPath();
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      /* no config yet */
    }
    const configData = JSON.stringify({ ...existing, enabled: true, verbosity: config.verbosity }, null, 2);
    fs.writeFileSync(configPath, configData, { mode: 0o600 });
  } catch {
    notify?.("Failed to write config. Pairing incomplete.", "error");
    return;
  }

  // Step 6: Send config_reload to daemon
  safeSend({ type: "config_reload" as const });

  notify?.("✅ Pairing complete! Your session is now connected to Telegram.", "info");
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
      const token = pairMatch[1];
      const groupId = pairMatch[2];
      config.enabled = true;
      ensureDaemon();
      connectSocket();

      // Write config
      const configPath = getConfigPath();
      try {
        let existing: Record<string, unknown> = {};
        try {
          existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch {
          /* no config yet */
        }
        const configData = JSON.stringify({ ...existing, enabled: true, verbosity: config.verbosity }, null, 2);
        fs.writeFileSync(configPath, configData, { mode: 0o600 });
      } catch {
        notify("Failed to write config.", "error");
        return;
      }

      // Send pair command to daemon
      safeSend({ type: "pair" as const, token, groupId });
      safeSend({ type: "config_reload" as const });

      notify(`Pairing with token ${token.slice(0, 6)}… and group ${groupId}`, "info");
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

function registerRemoteCommand(pi: ExtensionAPI): void {
  try {
    pi.registerCommand("remote", {
      description: "Telegram bridge control: status, on/off, verbosity, pair",
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        await handleRemoteCommand(args, ctx);
      },
    });
  } catch {
    // registerCommand may not exist in -p mode; no-op
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

  // Connect socket only when enabled
  if (config.enabled) {
    ensureDaemon();
    connectSocket();
  }
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
  shuttingDown = false; // reset for next session
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

  // Ask interception
  pi.on("tool_call", handleToolCall);
}
