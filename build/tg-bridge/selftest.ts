// selftest.ts — Self-test harness against mock TG API

import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

interface MockCall {
  method: string;
  args: Record<string, unknown>;
  response?: unknown;
  error_code?: number;
  retry_after?: number;
}

interface TestCase {
  name: string;
  run: () => Promise<boolean>;
}

// Mock Telegram API server
class MockTelegramServer {
  private calls: MockCall[] = [];
  private pendingUpdates: Array<() => void> = [];
  private updateQueue: Array<{ update: unknown; resolve: () => void }> = [];
  private nextUpdateId = 0;
  private port = 0;
  private httpServer: import("http").Server | null = null;

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
    // Wake any in-flight long-poll so the daemon returns and its next poll
    // (immediately after) receives the 409.
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
            // The telegram client POSTs to /v1/bot<token>/<method> with the
            // arguments as the JSON body; the method lives in the URL, not the
            // body. Derive it from the last path segment.
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
            // No pre-seeded response mechanism: every request gets a real
            // response (409 flag above, long-poll below, {ok:true} otherwise).

            if (method === "getUpdates") {
              // Long poll: if the queue already has an update (injected before
              // this poll began), return it immediately; otherwise wait for an
              // injected update (or, in a real Telegram, the long-poll timeout).
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
    const socket = net.createConnection(socketPath);

    // Buffer every frame unconditionally so tests can inspect `messages`
    // without needing to register a listener first.
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

    const api = {
      socket,
      send: (msg: Record<string, unknown>) => {
        socket.write(JSON.stringify(msg) + "\n");
      },
      onMessage: (cb: (msg: unknown) => void) => {
        listeners.push(cb);
      },
      messages,
    };

    socket.on("connect", () => {
      resolve(api);
    });

    socket.on("error", (_err: unknown) => {
      resolve(api);
    });
  });
}

async function main(): Promise<void> {
  const results: { name: string; passed: boolean }[] = [];

  // Create temp state dir
  const stateDir = join("/tmp", `tg-bridge-test-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });
  // A real, existing workspace path for /bind (the daemon validates it).
  const projectCwd = join(stateDir, "project");
  mkdirSync(projectCwd, { recursive: true });

  const config = {
    botToken: "test:token",
    groupId: -1001234567890,
    allowedUserIds: [42],
    maxConcurrent: 3,
    editIntervalMs: 1500,
  };

  writeFileSync(
    join(stateDir, "config.json"),
    JSON.stringify(config, null, 2),
  );

  // Create stub omp binary
  const ompBin = join(stateDir, "omp");
  writeFileSync(
    ompBin,
    `#!/usr/bin/env bash
while read line; do
  echo "$line"
  if echo "$line" | grep -q "SIGINT"; then
    exit 0
  fi
done
`,
  );
  (require("fs") as typeof import("fs")).chmodSync(ompBin, 0o755);

  // Launch mock server
  const mockServer = new MockTelegramServer();
  await mockServer.start();
  const port = mockServer.getPort();

  // Launch daemon
  const daemon = spawn("bun", ["build/tg-bridge/daemon.ts"], {
    cwd: "/workspaces/omp-devcontainer-base",
    env: {
      ...process.env,
      TG_BRIDGE_STATE_DIR: stateDir,
      TG_BRIDGE_OMP_BIN: ompBin,
      TG_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let daemonStdout = "";
  let daemonStderr = "";
  daemon.stdout?.on("data", (data: Buffer) => {
    daemonStdout += data.toString();
  });
  daemon.stderr?.on("data", (data: Buffer) => {
    daemonStderr += data.toString();
  });

  // Give daemon time to start
  await new Promise((r) => setTimeout(r, 500));

  const tests: TestCase[] = [
    // 1. Offset persistence
    {
      name: "offset persistence",
      run: async () => {
        const update = {
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 42, first_name: "Admin" },
            chat: { id: -1001234567890, type: "supergroup" },
            date: Date.now(),
            text: "/start test",
            thread_id: 1,
          },
        };
        mockServer.injectUpdate(update);

        await new Promise((r) => setTimeout(r, 500));

        const offsetPath = join(stateDir, "offset.json");
        if (!existsSync(offsetPath)) return false;
        let offset: Record<string, unknown> | null = null;
        try {
          offset = JSON.parse(readFileSync(offsetPath, "utf8"));
        } catch {
          offset = null;
        }
        return offset !== null && offset.offset !== undefined;
      },
    },

    // 2. Whitelist gate (non-paired user)
    {
      name: "whitelist gate",
      run: async () => {
        // Remove user 42 from allowed list temporarily
        let cfg: Record<string, unknown> | null = null;
        try {
          cfg = JSON.parse(
            readFileSync(join(stateDir, "config.json"), "utf8"),
          );
        } catch {
          cfg = null;
        }
        if (!cfg) return false;
        (cfg as { allowedUserIds: number[] }).allowedUserIds = [];
        writeFileSync(
          join(stateDir, "config.json"),
          JSON.stringify(cfg, null, 2),
        );

        // Count sendMessage calls so far (earlier tests may have replied to
        // allowed users); the stranger's message must not add any.
        const sendsBefore = mockServer
          .getCalls()
          .filter((c) => c.method === "sendMessage").length;

        const update = {
          update_id: 2,
          message: {
            message_id: 2,
            from: { id: 99, first_name: "Stranger" },
            chat: { id: -1001234567890, type: "supergroup" },
            date: Date.now(),
            text: "hello",
            thread_id: 1,
          },
        };
        mockServer.injectUpdate(update);

        await new Promise((r) => setTimeout(r, 500));

        const sendsAfter = mockServer
          .getCalls()
          .filter((c) => c.method === "sendMessage").length;
        return sendsAfter === sendsBefore;
      },
    },

    // 3. /bind creates topic + binding
    {
      name: "/bind creates topic + binding",
      run: async () => {
        // Send /bind command from allowed user
        config.allowedUserIds = [42];
        writeFileSync(
          join(stateDir, "config.json"),
          JSON.stringify(config, null, 2),
        );

        const update = {
          update_id: 3,
          message: {
            message_id: 3,
            from: { id: 42, first_name: "Admin" },
            chat: { id: -1001234567890, type: "supergroup" },
            date: Date.now(),
            text: `/bind ${projectCwd}`,
            thread_id: 1,
          },
        };
        mockServer.injectUpdate(update);

        await new Promise((r) => setTimeout(r, 500));

        const calls = mockServer.getCalls();
        const sendMessages = calls.filter(
          (c) => c.method === "sendMessage",
        );
        const bindCall = sendMessages.find(
          (c) =>
            c.args.text &&
            c.args.text.toString().includes("Bound topic to"),
        );
        if (!bindCall) return false;

        // Check bindings.json
        const bindingsPath = join(stateDir, "bindings.json");
        if (!existsSync(bindingsPath)) return false;

        let bindings: Record<string, unknown> | null = null;
        try {
          bindings = JSON.parse(
            readFileSync(bindingsPath, "utf8"),
          );
        } catch {
          bindings = null;
        }
        if (!bindings) return false;

        const binding = bindings["1"]; // topic id 1
        return (
          binding !== null &&
          (binding as Record<string, unknown>).cwd === projectCwd
        );
      },
    },

    // 4. Free text routing to connected socket session
    {
      name: "free text routing to socket session",
      run: async () => {
        // Connect a fake socket client
        const socketClient = await connectSocket(join(stateDir, "sock"));

        // Send hello
        socketClient.send({
          type: "hello",
          cwd: projectCwd,
          sessionId: "sess-123",
          ompVersion: "18.0.0",
          pid: 1234,
        });

        await new Promise((r) => setTimeout(r, 200));

        // Send free text message
        const update = {
          update_id: 4,
          message: {
            message_id: 4,
            from: { id: 42, first_name: "Admin" },
            chat: { id: -1001234567890, type: "supergroup" },
            date: Date.now(),
            text: "hello from telegram",
            thread_id: 1,
          },
        };
        mockServer.injectUpdate(update);

        await new Promise((r) => setTimeout(r, 500));

        // Check that the socket client received a prompt frame
        const hasPrompt = socketClient.messages.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            "type" in m &&
            (m as Record<string, unknown>).type === "prompt",
        );

        socketClient.socket.end();
        return hasPrompt;
      },
    },

    // 5. Question → keyboard → callback → answer frame
    {
      name: "question → keyboard → callback → answer frame",
      run: async () => {
        // Connect socket client
        const socketClient = await connectSocket(join(stateDir, "sock"));

        socketClient.send({
          type: "hello",
          cwd: projectCwd,
          sessionId: "sess-456",
          ompVersion: "18.0.0",
          pid: 5678,
        });

        await new Promise((r) => setTimeout(r, 200));

        // Send a question message
        const update = {
          update_id: 5,
          message: {
            message_id: 5,
            from: { id: 42, first_name: "Admin" },
            chat: { id: -1001234567890, type: "supergroup" },
            date: Date.now(),
            text: "/ask What is the capital of France?",
            thread_id: 1,
          },
        };
        mockServer.injectUpdate(update);

        await new Promise((r) => setTimeout(r, 500));

        // Check that a sendMessage was called with an inline keyboard
        const calls = mockServer.getCalls();
        const sendMessages = calls.filter(
          (c) => c.method === "sendMessage",
        );
        const questionMsg = sendMessages.find(
          (c) =>
            c.args.text &&
            c.args.text.toString().includes("capital of France"),
        );
        if (!questionMsg) return false;

        // Simulate callback answer
        const callbackQuery = {
          update_id: 6,
          callback_query: {
            id: "cb-1",
            from: { id: 42, first_name: "Admin" },
            message: { message_id: 100 },
            data: "q:1:0", // question id 1, option 0
            chat_instance: "ci-1",
          },
        };
        mockServer.injectUpdate(callbackQuery);

        await new Promise((r) => setTimeout(r, 500));

        // Check that the socket client received an answer frame
        const hasAnswer = socketClient.messages.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            "type" in m &&
            (m as Record<string, unknown>).type === "answer",
        );

        socketClient.socket.end();
        return hasAnswer;
      },
    },

    // 6. config_update persistence (must run while the daemon is alive; the
    //    409 test kills it, so it comes last)
    {
      name: "config_update persistence",
      run: async () => {
        // Reset config for this test
        config.allowedUserIds = [42];
        writeFileSync(
          join(stateDir, "config.json"),
          JSON.stringify(config, null, 2),
        );

        // Connect socket client
        const socketClient = await connectSocket(join(stateDir, "sock"));

        socketClient.send({
          type: "hello",
          cwd: projectCwd,
          sessionId: "sess-789",
          ompVersion: "18.0.0",
          pid: 9999,
        });

        await new Promise((r) => setTimeout(r, 200));

        // Send config_update
        socketClient.send({
          type: "config_update",
          cwd: projectCwd,
          enabled: false,
          verbosity: "low",
        });

        await new Promise((r) => setTimeout(r, 500));

        // Check bindings.json
        const bindingsPath = join(stateDir, "bindings.json");
        if (!existsSync(bindingsPath)) return false;

        let bindings: Record<string, unknown> | null = null;
        try {
          bindings = JSON.parse(
            readFileSync(bindingsPath, "utf8"),
          );
        } catch {
          bindings = null;
        }
        if (!bindings) return false;

        const binding = bindings["1"]; // topic id 1
        if (!binding) return false;
        return (
          (binding as Record<string, unknown>).remoteEnabled === false &&
          (binding as Record<string, unknown>).verbosity === "low"
        );
      },
    },

    // 7. 409 from getUpdates makes the daemon exit 1 (kills the daemon; last)
    {
      name: "409 exit",
      run: async () => {
        mockServer.set409OnNext();
        // Wait for the daemon to actually exit (the in-flight long-poll is
        // woken by set409OnNext, so the next poll gets the 409 and the
        // daemon's pollLoop process.exit(1)s).
        await new Promise<void>((r) => {
          if (daemon.exitCode !== null) {
            r();
            return;
          }
          daemon.once("exit", () => r());
        });
        return daemon.exitCode === 1;
      },
    },
  ];

  // Run tests
  for (const test of tests) {
    const passed = await test.run();
    results.push({ name: test.name, passed });
  }

  // Print results
  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status}: ${result.name}`);
    if (!result.passed) allPassed = false;
  }

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
    if (daemonStderr) console.log("\n--- daemon.stderr ---\n" + daemonStderr);
    if (daemonStdout) console.log("\n--- daemon.stdout ---\n" + daemonStdout);
  }

  // Cleanup
  if (daemon.exitCode === null) {
    daemon.kill("SIGTERM");
    await new Promise((r) => daemon.on("exit", r));
  }
  mockServer.stop();
  unlinkSync(join(stateDir, "sock"));
  unlinkSync(join(stateDir, "config.json"));
  unlinkSync(ompBin);
  unlinkSync(join(stateDir, "daemon.log"));
  try {
    unlinkSync(join(stateDir, "offset.json"));
  } catch {
    // Ignore
  }
  try {
    unlinkSync(join(stateDir, "bindings.json"));
  } catch {
    // Ignore
  }
  try {
    unlinkSync(join(stateDir, "replay.json"));
  } catch {
    // Ignore
  }
  rmdirRecursive(stateDir);

  console.log(allPassed ? "\nAll tests passed" : "\nSome tests failed");
  process.exit(allPassed ? 0 : 1);
}

function rmdirRecursive(dir: string): void {
  try {
    const entries = (require("fs") as typeof import("fs")).readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = (require("fs") as typeof import("fs")).statSync(fullPath);
      if (stat.isDirectory()) {
        rmdirRecursive(fullPath);
      } else {
        unlinkSync(fullPath);
      }
    }
    (require("fs") as typeof import("fs")).rmdirSync(dir);
  } catch {
    // Ignore
  }
}

main().catch((_err: unknown) => {
  console.error("Selftest error:", _err);
  process.exit(1);
});
