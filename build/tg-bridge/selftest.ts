// selftest.ts — Self-test harness against mock TG API
// Tests the session-driven, off-by-default design: no task mgmt, unconditional
// config_set/config_reload, auto-pair, status_request, plus the original
// offset-persistence, whitelist gate, free-text routing, and ask→answer flow.

import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, readdirSync, statSync, rmdirSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

// Repo root: selftest is run as `cd build/tg-bridge && bun selftest.ts` (see
// docs/telegram-bridge.md), so process.cwd() is the tg-bridge dir.
const REPO_ROOT = dirname(dirname(process.cwd()));

interface MockCall {
  method: string;
  path: string;
  args: Record<string, unknown>;
  response?: unknown;
  error_code?: number;
  retry_after?: number;
}

interface TestCase {
  name: string;
  run: (stateDir: string, handle: SelftestHandle) => Promise<boolean>;
}

// Per-test resources; the harness kills them if a test times out.
interface SelftestHandle {
  daemon?: ChildProcess;
  socketClient?: { socket: net.Socket };
  mockServer?: MockTelegramServer;
}

// --- Mock Telegram API server ----------------------------------------------

class MockTelegramServer {
  private calls: MockCall[] = [];
  private pendingUpdates: Array<() => void> = [];
  private updateQueue: Array<{ update: unknown; resolve: () => void }> = [];
  private nextUpdateId = 0;
  private port = 0;
  private httpServer: import("http").Server | null = null;
  private apiResults: Record<string, unknown> = {};
  private apiErrors: Record<string, { description: string; error_code: number }> = {};

  // Make a non-getUpdates method (e.g. getMe, getChat) return {ok:true, result}.
  setApiResult(method: string, result: unknown): void {
    this.apiResults[method] = result;
  }

  // Make a non-getUpdates method return {ok:false, error_code, description}.
  setApiError(method: string, error_code: number, description: string): void {
    this.apiErrors[method] = { description, error_code };
  }

  getCalls(): MockCall[] {
    return this.calls;
  }

  getPort(): number {
    return this.port;
  }

  injectUpdate(update: unknown): void {
    this.updateQueue.push({ update, resolve: () => {} });
    if (this.pendingUpdates.length > 0) {
      const resolve = this.pendingUpdates.shift()!;
      resolve();
    }
  }

  set409OnNext(): void {
    this.pending409 = true;
    for (const resolve of this.pendingUpdates.splice(0)) {
      resolve();
    }
  }

  private pending409 = false;

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.httpServer = (require("http") as typeof import("http")).createServer(
        async (
          req: import("http").IncomingMessage,
          res: import("http").ServerResponse,
        ) => {
          const respond = (status: number, body: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body));
          };
          let body = "";
          req.on("data", ((chunk: unknown) => {
            body += (chunk as Buffer).toString();
          }));
          req.on("end", async () => {
            const rawUrl = req.url ?? "/";
            const path = rawUrl.split("?")[0] ?? "";
            const method = path.split("/").filter(Boolean).pop() ?? "";
            let parsed: Record<string, unknown>;
            try {
              parsed = body.length > 0
                ? (JSON.parse(body) as Record<string, unknown>)
                : {};
            } catch {
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end();
              return;
            }

            const call: MockCall = {
              method,
              path,
              args: parsed as Record<string, unknown>,
            };

            if (this.pending409 && method === "getUpdates") {
              this.pending409 = false;
              call.error_code = 409;
              call.response = {
                ok: false,
                error_code: 409,
                description: "Conflict: terminated from other instance",
              };
              this.calls.push(call);
              respond(200, call.response);
              return;
            }

            if (method === "getUpdates") {
              const hadUpdate = this.updateQueue.length > 0;
              if (!hadUpdate) {
                await new Promise<void>((r) => {
                  this.pendingUpdates.push(r);
                });
              }
              const entry = this.updateQueue.shift();
              const update = entry?.update;
              if (update) {
                (update as Record<string, number>).update_id = ++this.nextUpdateId;
              }
              const result = update ? [update] : [];
              call.response = { ok: true, result };
              this.calls.push(call);
              respond(200, call.response);
              return;
            }

            const apiError = this.apiErrors[method];
            if (apiError) {
              call.response = { ok: false, error_code: apiError.error_code, description: apiError.description };
              this.calls.push(call);
              respond(200, call.response);
              return;
            }
            const apiResult = this.apiResults[method];
            if (apiResult !== undefined) {
              call.response = { ok: true, result: apiResult };
              this.calls.push(call);
              respond(200, call.response);
              return;
            }
            call.response = { ok: true };
            this.calls.push(call);
            respond(200, call.response);
          });
        },
      );

      this.httpServer!.listen(0, "127.0.0.1", () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          resolve(this.port);
        }
      });
    });
  }

  stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
    }
  }
}

// --- Socket helper ---------------------------------------------------------

function connectSocket(
  socketPath: string,
): Promise<{
  socket: net.Socket;
  send: (msg: Record<string, unknown>) => void;
  onMessage: (cb: (msg: unknown) => void) => void;
  messages: unknown[];
}> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const listeners: Array<(msg: unknown) => void> = [];
    let settled = false;

    const attempt = (tries: number) => {
      const socket = net.createConnection(socketPath);

      const finish = (s: net.Socket) => {
        if (settled) return;
        settled = true;
        resolve({
          socket: s,
          send: (msg: Record<string, unknown>) => {
            s.write(JSON.stringify(msg) + "\n");
          },
          onMessage: (cb: (msg: unknown) => void) => {
            listeners.push(cb);
          },
          messages,
        });
      };

      socket.on("data", (data: unknown) => {
        const text = (data as Buffer).toString();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            messages.push(parsed);
            for (const cb of listeners) cb(parsed);
          } catch {
            // Ignore parse errors
          }
        }
      });

      socket.on("connect", () => finish(socket));
      socket.on("error", (_err: unknown) => {
        // The daemon is a spawned process; its Unix socket is not listening
        // until the process finishes bootstrapping. Retry a few times instead
        // of resolving on the first ECONNREFUSED (which would leave every
        // subsequent send() writing to a dead socket).
        socket.destroy();
        if (tries >= 40) {
          finish(socket);
        } else {
          setTimeout(() => attempt(tries + 1), 25);
        }
      });
    };

    attempt(0);
  });
}

// --- Helpers ---------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  // SAFETY: setTimeout calls the resolver with no args; the cast bridges the
  // `void` vs `(value: void) => void` signature mismatch.
  return new Promise((resolve) => setTimeout(resolve as unknown as () => void, ms));
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}
// Spawn the daemon pointed at an isolated state dir + a mock Telegram API.
// Returns the child so the caller can connect sockets and assert.
function spawnDaemonWithMock(
  stateDir: string,
  port: number,
  extraConfig: Record<string, unknown> = {},
): ChildProcess {
  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
    ...extraConfig,
  };
  writeJson(join(stateDir, "config.json"), config);
  return spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Wait for a socket client to receive a frame whose `type` matches.
async function waitForFrame(
  client: { messages: unknown[] },
  type: string,
  timeoutMs = 2000,
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = client.messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>).type === type,
    );
    if (hit) return hit as Record<string, unknown>;
    await sleep(25);
  }
  return null;
}

// --- Test cases ------------------------------------------------------------

async function t_offsetPersistence(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  // Connect socket client with remoteOn=true so daemon polls getUpdates.
  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "test-offset",
    ompVersion: "18.0.0",
    pid: process.pid,
  });
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "high",
  });
  await sleep(100);

  // Inject update so daemon polls and records offset.
  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "hello",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const offsetPath = join(stateDir, "offset.json");
  if (!existsSync(offsetPath)) return false;
  const offset = readJson(offsetPath);
  if (!offset || offset.offset === undefined) return false;

  // Free text in a bound, remote-on forum topic is routed to the live
  // session as a `prompt` frame over the socket (not echoed back via
  // sendMessage). Verify the frame carried the original text.
  const prompt = socketClient.messages.find(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "type" in m &&
      (m as Record<string, unknown>).type === "prompt" &&
      (m as Record<string, unknown>).text === "hello",
  );

  // Regression: the daemon must hit the real Bot API path shape
  // `/bot<token>/<method>` — a stray segment (e.g. a historical `/v1`)
  // 404s against api.telegram.org while the path-agnostic mock kept passing.
  const getUpdatesPaths = mockServer
    .getCalls()
    .filter((c) => c.method === "getUpdates")
    .map((c) => c.path);
  if (getUpdatesPaths.length === 0) return false;
  if (!getUpdatesPaths.every((p) => /^\/bot[^/]+\/getUpdates$/.test(p))) return false;
  if (!prompt) return false;

  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  socketClient.socket.end();
  mockServer.stop();
  return true;
}


async function t_offByDefault(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  // Off-by-default: free text on an unbound topic is not forwarded to a
  // session — the daemon replies "not bound" instead.
  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "hello",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const repliedNotBound = mockServer
    .getCalls()
    .filter((c) => c.method === "sendMessage")
    .filter(
      (c) =>
        (c.args as Record<string, unknown>).text ===
        "This topic is not bound. Use /bind <cwd> first.",
    ).length === 1;

  // Enable remote: socket hello + config_update creates the topic-1 binding
  // and flips the session's remoteOn.
  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "test-off",
    ompVersion: "18.0.0",
    pid: process.pid,
  });
  await sleep(100);
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "mid",
  });
  await sleep(100);

  // Free text on the bound + remote-on topic is delivered to the session.
  mockServer.injectUpdate({
    update_id: 2,
    message: {
      message_id: 2,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "hello again",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const hasPrompt = socketClient.messages.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "type" in m &&
      (m as Record<string, unknown>).type === "prompt",
  );

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return repliedNotBound && hasPrompt;
}

async function t_configSet(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;

  // Send config_set to enable remote on topic 1.
  socketClient.send({
    type: "config_set",
    topicId: "1",
    remoteOn: true,
    verbosity: "high",
  });
  await sleep(100);

  // Check bindings.json for the updated config.
  const bindingsPath = join(stateDir, "bindings.json");
  if (!existsSync(bindingsPath)) return false;
  const bindings = readJson(bindingsPath);
  if (!bindings) return false;

  const binding = bindings["1"];
  if (!binding) return false;

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return (
    (binding as Record<string, unknown>).remoteOn === true &&
    (binding as Record<string, unknown>).verbosity === "high"
  );
}

async function t_configReload(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;

  // Send config_reload — daemon should re-read config.json.
  socketClient.send({ type: "config_reload" });
  await sleep(100);

  // Verify the daemon didn't crash (still running).
  const stillRunning = daemon.exitCode === null;

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return stillRunning;
}

async function t_autoPair(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  // Start with empty allowedUserIds — first DM should trigger auto-pair.
  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  // DM from a new user — should trigger pair_done.
  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "private" },
      date: Date.now(),
      text: "/pair",
    },
  });
  await sleep(200);

  const calls = mockServer.getCalls();
  const sendMessages = calls.filter((c) => c.method === "sendMessage");
  const pairDone = sendMessages.some(
    (c) =>
      c.args.text &&
      c.args.text.toString().includes("pair_done") ||
      c.args.text &&
      c.args.text.toString().includes("Pairing"),
  );

  // Verify user 42 is now in allowedUserIds.
  const updatedConfig = readJson(join(stateDir, "config.json"));
  const userIdInList =
    !!updatedConfig &&
    Array.isArray((updatedConfig as Record<string, unknown>).allowedUserIds) &&
    (updatedConfig as { allowedUserIds: number[] }).allowedUserIds.includes(42);

  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return (pairDone as boolean) && userIdInList;
}

async function t_statusRequest(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "sess-123",
    ompVersion: "18.0.0",
    pid: 1234,
  });
  await sleep(100);

  // Send a status_request from the socket.
  socketClient.send({ type: "status_request" });
  await sleep(100);

  // Check that the socket received a daemon_status response.
  const hasStatus = socketClient.messages.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "type" in m &&
      (m as Record<string, unknown>).type === "daemon_status",
  );

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return hasStatus;
}

async function t_whitelistGate(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  // Remove user 42 temporarily.
  config.allowedUserIds = [];
  writeJson(join(stateDir, "config.json"), config);

  const sendsBefore = mockServer
    .getCalls()
    .filter((c) => c.method === "sendMessage").length;

  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 99, first_name: "Stranger" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "hello",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const sendsAfter = mockServer
    .getCalls()
    .filter((c) => c.method === "sendMessage").length;
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return sendsAfter === sendsBefore;
}

async function t_freeTextRouting(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  // Connect socket client and bind the topic.
  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "sess-123",
    ompVersion: "18.0.0",
    pid: 1234,
  });
  await sleep(100);
  // Bind topic 1 to the project and enable remote (creates the binding and
  // flips the session's remoteOn) — preconditions for free-text routing.
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "mid",
  });
  await sleep(100);

  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "hello from telegram",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const hasPrompt = socketClient.messages.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "type" in m &&
      (m as Record<string, unknown>).type === "prompt",
  );

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return hasPrompt;
}

async function t_questionAnswer(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "sess-456",
    ompVersion: "18.0.0",
    pid: 5678,
  });
  await sleep(100);
  // Bind topic 1 to the project and enable remote so /ask can publish.
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "mid",
  });
  await sleep(100);

  // Send a question message.
  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "/ask What is the capital of France?",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  // Simulate callback answer.
  mockServer.injectUpdate({
    update_id: 2,
    callback_query: {
      id: "cb-1",
      from: { id: 42, first_name: "Admin" },
      message: { message_id: 100 },
      data: "q:1:0",
      chat_instance: "ci-1",
    },
  });
  await sleep(200);

  const hasAnswer = socketClient.messages.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "type" in m &&
      (m as Record<string, unknown>).type === "answer",
  );

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return hasAnswer;
}

async function t_configUpdate(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;

  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "sess-789",
    ompVersion: "18.0.0",
    pid: 9999,
  });
  await sleep(100);

  // Send config_update with remoteOn (not enabled).
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: false,
    verbosity: "low",
  });
  await sleep(100);

  const bindingsPath = join(stateDir, "bindings.json");
  if (!existsSync(bindingsPath)) return false;

  const bindings = readJson(bindingsPath);
  if (!bindings) return false;

  // Topic 1 was created by earlier bind test in the daemon.
  // Use the first available binding key.
  const keys = Object.keys(bindings);
  if (keys.length === 0) return false;

  const binding = bindings[keys[0]];
  if (!binding) return false;

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return (
    (binding as Record<string, unknown>).remoteOn === false &&
    (binding as Record<string, unknown>).verbosity === "low"
  );
}

async function t_bindCreatesTopic(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: `/bind ${projectCwd}`,
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const calls = mockServer.getCalls();
  const sendMessages = calls.filter((c) => c.method === "sendMessage");
  const bindCall = sendMessages.find(
    (c) =>
      c.args.text &&
      c.args.text.toString().includes("Bound topic to"),
  );
  if (!bindCall) return false;
  // The /bind message arrived in forum topic 1 (message_thread_id: 1); the
  // confirmation must be sent back into that same topic — a general-topic
  // reply (no message_thread_id) or a wrong thread is a routing regression.
  if (bindCall.args.message_thread_id !== 1) return false;

  const bindingsPath = join(stateDir, "bindings.json");
  if (!existsSync(bindingsPath)) return false;

  const bindings = readJson(bindingsPath);
  if (!bindings) return false;

  const binding = bindings["1"];
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return (
    binding !== null &&
    (binding as Record<string, unknown>).cwd === projectCwd
  );
}

async function t_409Exit(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);


  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  mockServer.set409OnNext();
  await new Promise<void>((r) => {
    if (daemon.exitCode !== null) {
      r();
      return;
    }
    daemon.once("exit", () => r());
  });
  return daemon.exitCode === 1;
}

async function t_pairValidateGroup(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  mockServer.setApiResult("getMe", { id: 1, username: "mockbot", first_name: "Mock" });
  mockServer.setApiResult("getChat", {
    id: -1001234567890,
    type: "supergroup",
    title: "grp",
  });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);

  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "sess-pv",
    ompVersion: "18.0.0",
    pid: 4321,
  });
  await sleep(100);

  // Known group (getChat ok) → pair_done success:true.
  const before = socketClient.messages.length;
  socketClient.send({ type: "pair_validate_group", token: "test:token", groupId: -1001234567890 });
  await sleep(250);
  const firstDone = (socketClient.messages
    .slice(before)
    .find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as Record<string, unknown>).type === "pair_done",
    ) as Record<string, unknown> | undefined);
  const successKnown = firstDone?.success === true;

  // Flip getChat to a failure → pair_done success:false (real getChat, not a
  // fake always-true).
  mockServer.setApiError("getChat", 400, "Bad Request: peer not found");
  const before2 = socketClient.messages.length;
  socketClient.send({ type: "pair_validate_group", token: "test:token", groupId: -1001234567890 });
  await sleep(250);
  const secondDone = (socketClient.messages
    .slice(before2)
    .find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as Record<string, unknown>).type === "pair_done",
    ) as Record<string, unknown> | undefined);
  const successUnknown = secondDone?.success === false;

  const getChatCalled = mockServer.getCalls().some((c) => c.method === "getChat");

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return successKnown && successUnknown && getChatCalled;
}

async function t_staleSocketReplaced(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  mockServer.setApiResult("getMe", { id: 1, username: "mockbot", first_name: "Mock" });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);

  // Plant a stale non-socket file at the sock path, as a crashed daemon leaves.
  writeFileSync(join(stateDir, "sock"), "stale-sock");

  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "sess-stale",
    ompVersion: "18.0.0",
    pid: 4322,
  });
  await sleep(100);

  // Prove the socket is the live daemon (not the stale file): a pair_validate
  // must round-trip a success.
  socketClient.send({ type: "pair_validate", token: "test:token" });
  await sleep(250);
  const pairDone = (socketClient.messages.find(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "type" in m &&
      (m as Record<string, unknown>).type === "pair_done",
  ) as Record<string, unknown> | undefined);

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return pairDone?.success === true;
}

// Per-turn message isolation: each turn's rendered lines must land in its own
// Telegram message; a finalized turn's content must never be re-edited into,
// and no single message may mix lines from two turns.
async function t_turnIsolation(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);

  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;

  await sleep(200);

  // The mock returns the same message_id for every sendMessage, so assertions
  // key on text content, not ids.
  mockServer.setApiResult("sendMessage", { message_id: 1 });
  mockServer.setApiResult("editMessageText", true);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "test-turns",
    ompVersion: "18.0.0",
    pid: process.pid,
  });
  await sleep(100);
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "mid",
  });
  await sleep(100);

  // Turn 1: start → two message lines → end (finalize flushes via edit).
  socketClient.send({ type: "progress", kind: "turn_start", data: "1" });
  await sleep(50);
  socketClient.send({ type: "progress", kind: "message", data: "turn one line A" });
  await sleep(200);
  socketClient.send({ type: "progress", kind: "message", data: "turn one line B" });
  await sleep(200);
  socketClient.send({ type: "progress", kind: "turn_end", data: "1" });
  await sleep(200);

  // Turn 2: start → one line, which must be a fresh message.
  socketClient.send({ type: "progress", kind: "turn_start", data: "2" });
  await sleep(200);
  socketClient.send({ type: "progress", kind: "message", data: "turn two line A" });
  await sleep(400);

  const calls = mockServer.getCalls();
  const rendered = calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText");
  const textOf = (c: MockCall) => String((c.args as Record<string, unknown>).text ?? "");
  const sentTexts = rendered.filter((c) => c.method === "sendMessage").map(textOf);
  const editedTexts = rendered.filter((c) => c.method === "editMessageText").map(textOf);

  if (rendered.length === 0) return false;

  // (a) Every rendered send/edit uses HTML parse mode.
  const allHtml = rendered.every(
    (c) => (c.args as Record<string, unknown>).parse_mode === "HTML",
  );

  // (b) Turn 1's finalized content was edited into its own message and does
  // not contain any turn 2 line.
  const finalTurnOne = editedTexts.find((t) => t.includes("turn one line B"));
  if (!finalTurnOne || finalTurnOne.includes("turn two")) return false;

  // (c) Turn 2's line appears in a fresh message that never mentions turn 1.
  const turnTwoSend = sentTexts.find(
    (t) => t.includes("turn two line A") && !t.includes("turn one"),
  );
  if (!turnTwoSend) return false;

  // (d) No single message mixes both turns.
  const noMix = [...sentTexts, ...editedTexts].every(
    (t) => !(t.includes("turn one") && t.includes("turn two")),
  );

  socketClient.socket.end();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();

  return allHtml && noMix;
}
// Per-cwd session eviction: a second hello for the same cwd destroys the
// first stream (single session per workspace contract) while other cwds are
// untouched.
async function t_evictStaleSession(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();
  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const daemon = spawnDaemonWithMock(stateDir, port);
  handle.daemon = daemon;
  await sleep(200);

  const c1 = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = c1;
  c1.send({ type: "hello", cwd: projectCwd, sessionId: "sess-one", ompVersion: "18.0.0", pid: process.pid });
  const cfg1 = await waitForFrame(c1, "config");
  if (!cfg1) return false;

  const c3 = await connectSocket(join(stateDir, "sock"));
  const otherCwd = join(stateDir, "other");
  mkdirSync(otherCwd, { recursive: true });
  c3.send({ type: "hello", cwd: otherCwd, sessionId: "sess-other", ompVersion: "18.0.0", pid: process.pid });
  const cfg3 = await waitForFrame(c3, "config");
  if (!cfg3) return false;

  // Same-cwd hello from a second stream must evict c1's stream.
  const c2 = await connectSocket(join(stateDir, "sock"));
  c2.send({ type: "hello", cwd: projectCwd, sessionId: "sess-two", ompVersion: "18.0.0", pid: process.pid });
  const cfg2 = await waitForFrame(c2, "config");
  if (!cfg2) return false;
  await sleep(200);

  let daemonLog = "";
  try {
    daemonLog = readFileSync(join(stateDir, "daemon.log"), "utf8");
  } catch {
    daemonLog = "";
  }
  const evicted = daemonLog.includes("evicting stale session");
  // The old stream was destroyed by the same-cwd hello; cfg2 proves the new
  // session is live and receiving frames.

  c1.socket.destroy();
  c2.socket.destroy();
  c3.socket.destroy();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return evicted && !!cfg2 && !!cfg3;
}

// Frames from an evicted (old) same-cwd stream must not render Telegram
// messages — the daemon routes progress through the current session only.
async function t_noDuplicateFramesPerCwd(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();
  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const daemon = spawnDaemonWithMock(stateDir, port);
  handle.daemon = daemon;
  await sleep(200);

  const old = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = old;
  old.send({ type: "hello", cwd: projectCwd, sessionId: "old-sess", ompVersion: "18.0.0", pid: process.pid });
  old.send({ type: "config_update", cwd: projectCwd, remoteOn: true, verbosity: "mid" });
  await sleep(200);

  const fresh = await connectSocket(join(stateDir, "sock"));
  fresh.send({ type: "hello", cwd: projectCwd, sessionId: "new-sess", ompVersion: "18.0.0", pid: process.pid });
  await waitForFrame(fresh, "config");
  fresh.send({ type: "config_update", cwd: projectCwd, remoteOn: true, verbosity: "mid" });
  await sleep(200);

  // A progress frame from the evicted stream must not render to Telegram.
  old.send({ type: "progress", kind: "message", data: "stale-frame-text" });
  await sleep(300);

  const calls = mockServer.getCalls();
  const staleRendered = calls.some((c) =>
    (c.method === "sendMessage" || c.method === "editMessageText") &&
    String(c.args.text ?? "").includes("stale-frame-text"),
  );
  const clean = !staleRendered;

  old.socket.destroy();
  fresh.socket.destroy();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return clean;
}
// Session evicted frame: when a second client connects with the same cwd, the
// first client must receive a { type: "session_evicted" } frame so it knows
// the daemon has replaced its stream.
async function t_sessionEvicted(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();
  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const daemon = spawnDaemonWithMock(stateDir, port);
  handle.daemon = daemon;
  await sleep(200);

  const c1 = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = c1;
  c1.send({ type: "hello", cwd: projectCwd, sessionId: "sess-one", ompVersion: "18.0.0", pid: process.pid });
  await waitForFrame(c1, "config");

  // Second client for the same cwd — should evict c1.
  const c2 = await connectSocket(join(stateDir, "sock"));
  c2.send({ type: "hello", cwd: projectCwd, sessionId: "sess-two", ompVersion: "18.0.0", pid: process.pid });
  await waitForFrame(c2, "config");
  await sleep(200);

  // c1 must have received a session_evicted frame.
  const evicted = c1.messages.some(
    (m) => typeof m === "object" && m !== null && "type" in m && (m as Record<string, unknown>).type === "session_evicted",
  );

  c1.socket.destroy();
  c2.socket.destroy();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return evicted;
}

// Unchanged-text edit skip: finalizing a turn whose text was already sent
// must not call editMessageText again (kills the 'message is not modified'
// 400 spam).
async function t_skipUnchangedEdit(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();
  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const daemon = spawnDaemonWithMock(stateDir, port, { editIntervalMs: 100 });
  handle.daemon = daemon;
  await sleep(200);

  mockServer.setApiResult("sendMessage", { message_id: 1 });
  mockServer.setApiError("editMessageText", 400, "message is not modified");

  const c = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = c;
  c.send({ type: "hello", cwd: projectCwd, sessionId: "skip-test", ompVersion: "18.0.0", pid: process.pid });
  c.send({ type: "config_update", cwd: projectCwd, remoteOn: true, verbosity: "mid" });
  await sleep(200);

  c.send({ type: "progress", kind: "turn_start", data: "1" });
  await sleep(50);
  c.send({ type: "progress", kind: "message", data: "skip-a" });
  await sleep(300);
  // turn_end finalizes; the text equals the already-sent line, so no extra
  // editMessageText for identical text.
  c.send({ type: "progress", kind: "turn_end", data: "1" });
  await sleep(300);

  const edits = mockServer.getCalls().filter(
    (call) =>
      call.method === "editMessageText" &&
      String(call.args.text ?? "").includes("skip-a"),
  );
  // Old code (no lastSentText) edits the message again with identical text on
  // finalize → a "message is not modified" 400. New code skips it: zero
  // editMessageText calls for already-sent text, zero 400s.
  let daemonLog = "";
  try {
    daemonLog = readFileSync(join(stateDir, "daemon.log"), "utf8");
  } catch {
    daemonLog = "";
  }
  const notModified = daemonLog.split("message is not modified").length - 1;

  c.socket.destroy();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return edits.length === 0 && notModified === 0;
}

// Empty-message suppression: a whitespace-only turn produces zero Telegram
// messages; a real line that follows whitespace lands in exactly one message.
async function t_emptyTurnPublishesNothing(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();
  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const daemon = spawnDaemonWithMock(stateDir, port);
  handle.daemon = daemon;
  await sleep(200);

  mockServer.setApiResult("sendMessage", { message_id: 1 });
  mockServer.setApiResult("editMessageText", true);

  const c = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = c;
  c.send({ type: "hello", cwd: projectCwd, sessionId: "empty-test", ompVersion: "18.0.0", pid: process.pid });
  c.send({ type: "config_update", cwd: projectCwd, remoteOn: true, verbosity: "mid" });
  await sleep(200);

  // Turn 1: whitespace only → nothing.
  c.send({ type: "progress", kind: "turn_start", data: "1" });
  await sleep(50);
  c.send({ type: "progress", kind: "message", data: "   " });
  await sleep(200);
  c.send({ type: "progress", kind: "turn_end", data: "1" });
  await sleep(200);

  // Turn 2: whitespace then a real line → exactly one message with the real
  // line.
  c.send({ type: "progress", kind: "turn_start", data: "2" });
  await sleep(100);
  c.send({ type: "progress", kind: "message", data: "  " });
  await sleep(200);
  c.send({ type: "progress", kind: "message", data: "empty-turn-real" });
  await sleep(300);
  const rendered = mockServer.getCalls().filter((call) => call.method === "sendMessage" || call.method === "editMessageText");
  const emptyOnly = rendered.filter((call) => {
    const t = String(call.args.text ?? "");
    return t.trim() === "";
  });
  const withReal = rendered.filter((call) => String(call.args.text ?? "").includes("empty-turn-real"));


  c.socket.destroy();
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  mockServer.stop();
  return emptyOnly.length === 0 && withReal.length === 1;
}

// /todo: the daemon must forward a todo_request frame to the live session and
// render the extension's todo_list answer (not stay silent). Regression for
// the "nothing happens on /todo" bug: the extension used to only answer when
// it had captured todo state, so a session that never ran an init op was
// silent. The extension now always answers; the daemon renders a note when
// the answer is empty.
async function t_todoCommand(stateDir: string, handle: SelftestHandle): Promise<boolean> {
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  handle.mockServer = mockServer;
  const port = mockServer.getPort();

  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    editIntervalMs: 1500,
  };
  writeJson(join(stateDir, "config.json"), config);

  const daemon = spawn("bun", [join(REPO_ROOT, "build/tg-bridge/daemon.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  handle.daemon = daemon;
  await sleep(200);

  const socketClient = await connectSocket(join(stateDir, "sock"));
  handle.socketClient = socketClient;
  socketClient.send({
    type: "hello",
    cwd: projectCwd,
    sessionId: "todo-sess",
    ompVersion: "18.0.0",
    pid: process.pid,
  });
  // Bind topic 1 → projectCwd, remote on (mirrors /bind + remoteOn=true).
  socketClient.send({
    type: "config_set",
    topicId: 1,
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "mid",
  });
  await sleep(200);

  const textOf = (c: MockCall) => String((c.args as Record<string, unknown>).text ?? "");

  // --- Case 1: /todo → todo_request frame → todo_list answer → rendered ---
  // config_update drives the live session's remoteOn (config_set only binds the topic).
  socketClient.send({
    type: "config_update",
    cwd: projectCwd,
    remoteOn: true,
    verbosity: "mid",
  });
  await sleep(200);
  mockServer.injectUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "/todo",
      message_thread_id: 1,
    },
  });
  await sleep(200);

  const request = socketClient.messages.find(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).type === "todo_request",
  );
  if (!request) {
    daemon.kill("SIGTERM");
    socketClient.socket.end();
    mockServer.stop();
    return false;
  }

  // The (fixed) extension answers todo_request with its full captured state.
  socketClient.send({
    type: "progress",
    kind: "todo_list",
    data: {
      phases: [
        {
          name: "Verify",
          tasks: [
            { content: "Gates green", status: "completed" },
            { content: "Deploy daemon", status: "in_progress" },
          ],
        },
      ],
      updatedAt: Date.now(),
    },
  });
  await sleep(250);

  const renderedList = mockServer
    .getCalls()
    .filter((c) => c.method === "sendMessage" || c.method === "editMessageText")
    .map(textOf)
    .find((t) => t.includes("Gates green") && t.includes("Deploy daemon"));
  if (!renderedList) {
    daemon.kill("SIGTERM");
    socketClient.socket.end();
    mockServer.stop();
    return false;
  }

  // --- Case 2: empty todo_list answer must still render a note (no silence) ---
  mockServer.injectUpdate({
    update_id: 2,
    message: {
      message_id: 11,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "/todo",
      message_thread_id: 1,
    },
  });
  await sleep(200);
  socketClient.send({
    type: "progress",
    kind: "todo_list",
    data: { phases: [], updatedAt: Date.now() },
  });
  await sleep(250);

  const renderedNote = mockServer
    .getCalls()
    .filter((c) => c.method === "sendMessage" || c.method === "editMessageText")
    .map(textOf)
    .find((t) => t.includes("No todos captured yet"));

  // --- Case 3: mistyped /todo/status must normalize to /todo (not free text) ---
  const requestsBefore = socketClient.messages.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).type === "todo_request",
  ).length;
  mockServer.injectUpdate({
    update_id: 3,
    message: {
      message_id: 12,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "/todo/status",
      message_thread_id: 1,
    },
  });
  await sleep(200);
  socketClient.send({ type: "progress", kind: "todo_list", data: { phases: [], updatedAt: Date.now() } });
  await sleep(250);

  const requestsAfter = socketClient.messages.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).type === "todo_request",
  ).length;
  const freeTextPrompts = socketClient.messages.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).type === "prompt",
  ).length;

  // --- Case 4: unknown /-command must ack (never silent at any verbosity) ---
  mockServer.injectUpdate({
    update_id: 4,
    message: {
      message_id: 13,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "/frobnicate",
      message_thread_id: 1,
    },
  });
  await sleep(200);
  const unknownAck = mockServer
    .getCalls()
    .filter((c) => c.method === "sendMessage" || c.method === "editMessageText")
    .map(textOf)
    .find((t) => t.includes("Unknown command"));

  // --- Case 5: /SUMMARY (wrong case) must resolve to /summary (not silent) ---
  mockServer.injectUpdate({
    update_id: 5,
    message: {
      message_id: 14,
      from: { id: 42, first_name: "Admin" },
      chat: { id: -1001234567890, type: "supergroup" },
      date: Date.now(),
      text: "/SUMMARY",
      message_thread_id: 1,
    },
  });
  await sleep(200);
  const summarizeFrames = socketClient.messages.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).type === "summarize",
  ).length;
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.on("exit", r));
  socketClient.socket.end();
  mockServer.stop();

  return Boolean(renderedList) && Boolean(renderedNote) && requestsAfter > requestsBefore && freeTextPrompts === 0 && Boolean(unknownAck) && summarizeFrames > 0;
}
// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const stateDir = join("/tmp", `tg-bridge-test-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });

  const tests: TestCase[] = [
    { name: "offset persistence", run: (d, h) => t_offsetPersistence(d, h) },
    { name: "whitelist gate", run: (d, h) => t_whitelistGate(d, h) },
    { name: "/bind creates topic + binding", run: (d, h) => t_bindCreatesTopic(d, h) },
    { name: "free text routing to socket session", run: (d, h) => t_freeTextRouting(d, h) },
    { name: "question → keyboard → callback → answer frame", run: (d, h) => t_questionAnswer(d, h) },
    { name: "off-by-default free text gate", run: (d, h) => t_offByDefault(d, h) },
    { name: "config_set", run: (d, h) => t_configSet(d, h) },
    { name: "config_reload", run: (d, h) => t_configReload(d, h) },
    { name: "auto-pair", run: (d, h) => t_autoPair(d, h) },
    { name: "status_request", run: (d, h) => t_statusRequest(d, h) },
    { name: "config_update (remoteOn)", run: (d, h) => t_configUpdate(d, h) },
    { name: "409 exit", run: (d, h) => t_409Exit(d, h) },
    { name: "pair_validate_group (getChat)", run: (d, h) => t_pairValidateGroup(d, h) },
    { name: "stale sock replaced", run: (d, h) => t_staleSocketReplaced(d, h) },
    { name: "per-turn message isolation", run: (d, h) => t_turnIsolation(d, h) },
    { name: "evict stale same-cwd session", run: (d, h) => t_evictStaleSession(d, h) },
    { name: "no duplicate frames after eviction", run: (d, h) => t_noDuplicateFramesPerCwd(d, h) },
    { name: "skip unchanged-text edit", run: (d, h) => t_skipUnchangedEdit(d, h) },
    { name: "session_evicted frame on same-cwd reconnect", run: (d, h) => t_sessionEvicted(d, h) },
    { name: "empty turn publishes nothing", run: (d, h) => t_emptyTurnPublishesNothing(d, h) },
    { name: "/todo renders todo_list answer", run: (d, h) => t_todoCommand(d, h) },
  ];

  const results: { name: string; passed: boolean }[] = [];
  let ti = 0;
  for (const test of tests) {
    // Isolated state dir per test: one test's leftovers can't corrupt the next.
    const testDir = join(stateDir, `t${ti++}`);
    mkdirSync(testDir, { recursive: true });
    const handle: SelftestHandle = {};
    console.error(`RUN: ${test.name} (${testDir})`);
    const passed = await Promise.race([
      test.run(testDir, handle),
      new Promise<boolean>((_, r) => setTimeout(() => r(false), 15_000)),
    ]);
    // Timeout path: a hung test leaves its daemon/socket/mock behind.
    if (handle.daemon && handle.daemon.exitCode === null) handle.daemon.kill("SIGTERM");
    handle.socketClient?.socket.destroy();
    handle.mockServer?.stop();
    console.error(`DONE: ${test.name} = ${passed}`);
    results.push({ name: test.name, passed });
  }
  console.error("TEST LOOP DONE");


  console.error("RESULTS LOOP START");
  let allPassed = true;
  for (const result of results) {
    console.error(`  RESULT: ${result.name} = ${result.passed}`);
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status}: ${result.name}`);
    if (!result.passed) allPassed = false;
  }
  console.error("RESULTS LOOP DONE");

  if (!allPassed) {
    const logPath = join(stateDir, "daemon.log");
    let logText = "";
    try {
      logText = readFileSync(logPath, "utf8");
    } catch {
      logText = "(no daemon.log)";
    }
    const tail = logText.split("\n").slice(-40).join("\n");
    console.log("\n--- daemon.log (last 40) ---\n" + tail);
  }

  // Cleanup with timeout to detect hangs
  console.error("CLEANUP START");
  try {
    unlinkSync(join(stateDir, "sock"));
  } catch { /* ignore */ }
  try { unlinkSync(join(stateDir, "config.json")); } catch { /* ignore */ }
  try { unlinkSync(join(stateDir, "daemon.log")); } catch { /* ignore */ }
  try { unlinkSync(join(stateDir, "offset.json")); } catch { /* ignore */ }
  try { unlinkSync(join(stateDir, "bindings.json")); } catch { /* ignore */ }
  try { unlinkSync(join(stateDir, "replay.json")); } catch { /* ignore */ }
  console.error("CLEANUP RMDIR");
  rmdirRecursive(stateDir);
  console.error("CLEANUP DONE");

  console.log(allPassed ? "\nAll tests passed" : "\nSome tests failed");
  process.exit(allPassed ? 0 : 1);
}

function rmdirRecursive(dir: string): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      rmdirRecursive(path);
    } else {
      unlinkSync(path);
    }
  }
  rmdirSync(dir); // remove dir itself
}

main().catch((_err: unknown) => {
  console.error("Selftest failed:", _err);
  process.exit(1);
});
