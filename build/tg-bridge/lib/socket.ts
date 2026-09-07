// lib/socket.ts — JSONL unix socket server with per-session state

import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { createServer, type Socket as NetSocket } from "node:net";
type NetServer = ReturnType<typeof createServer>;
import type { Verbosity } from "./bindings";

export interface SessionState {
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  ompVersion: string;
  pid: number;
  turnLive: boolean;
  lastEventAt: number;
  enabled: boolean;
  verbosity: Verbosity;
  stream?: NetSocket;
}

export interface QuestionFrame {
  id: string;
  kind: "select" | "confirm" | "input";
  title: string;
  options?: string[];
  default?: string;
}

export interface SocketCallbacks {
  onHello: (cwd: string, state: SessionState) => void;
  onProgress: (cwd: string, kind: string, data: unknown) => void;
  onQuestion: (cwd: string, question: QuestionFrame) => void;
  onConfigUpdate: (cwd: string, enabled?: boolean, verbosity?: Verbosity) => void;
  onLog?: (msg: string) => void;
}

export interface SocketServer {
  start(socketPath: string, callbacks: SocketCallbacks): void;
  stop(): void;
  getSession(cwd: string): SessionState | undefined;
  setSession(cwd: string, state: SessionState): void;
  removeSession(cwd: string): void;
  sendFrame(cwd: string, frame: unknown): boolean;
}

export class SocketManager implements SocketServer {
  private server: NetServer | null = null;
  private sessions = new Map<string, SessionState>();
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private callbacks: SocketCallbacks;

  constructor() {
    this.callbacks = {
      onHello: () => {},
      onProgress: () => {},
      onQuestion: () => {},
      onConfigUpdate: () => {},
    };
  }

  setCallbacks(callbacks: SocketCallbacks): void {
    this.callbacks = callbacks;
  }

  setLogStream(stream: ReturnType<typeof createWriteStream>) {
    this.logStream = stream;
  }

  private log(msg: string) {
    this.callbacks.onLog?.(msg);
    if (this.logStream) this.logStream.write(msg + "\n");
  }

  getSession(cwd: string): SessionState | undefined {
    return this.sessions.get(cwd);
  }

  setSession(cwd: string, state: SessionState): void {
    this.sessions.set(cwd, state);
  }

  removeSession(cwd: string): void {
    this.sessions.delete(cwd);
  }

  start(socketPath: string, callbacks: SocketCallbacks): void {
    this.callbacks = callbacks;
    if (existsSync(socketPath)) {
      try {
        unlinkSync(socketPath);
      } catch {
        // Ignore
      }
    }

    const server = createServer((socket: NetSocket) => {
      this.log(`Socket client connected`);
      socket.setNoDelay(true);

      socket.on("data", (data: unknown) => {
        const text = (data as Buffer).toString();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const frame = JSON.parse(line);
            this.handleFrame(JSON.stringify(frame), socket);
          } catch {
            // Ignore parse errors
          }
        }
      });

      socket.on("close", () => {
        this.log("Socket client disconnected");
        for (const [cwd, session] of this.sessions) {
          if (session.stream === socket) {
            this.sessions.delete(cwd);
          }
        }
      });

      socket.on("error", (err: unknown) => {
        this.log(`Socket error: ${(err as Error).message}`);
      });
    });

    server.on("error", (err: unknown) => {
      this.log(`Socket server error: ${(err as Error).message}`);
    });

    server.listen(socketPath, () => {
      this.log(`Socket server listening on ${socketPath}`);
    });

    this.server = server;
  }

  private handleFrame(frameStr: string, socket: NetSocket): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(frameStr) as Record<string, unknown>;
    } catch {
      return;
    }
    // Progress/question frames omit cwd (per protocol) — infer it from the
    // session this socket established via hello.
    let cwd = frame.cwd as string | undefined;
    if (!cwd) {
      for (const [c, s] of this.sessions) {
        if (s.stream === socket) {
          cwd = c;
          break;
        }
      }
    }
    if (!cwd) return;

    const type = frame.type as string;
    switch (type) {
      case "hello": {
        const sessionId = frame.sessionId as string;
        const ompVersion = frame.ompVersion as string;
        const pid = frame.pid as number;
        const state: SessionState = {
          cwd,
          sessionId: sessionId ?? "",
          sessionFile: frame.sessionFile as string | undefined,
          ompVersion: ompVersion ?? "",
          pid: pid ?? 0,
          turnLive: false,
          lastEventAt: Date.now(),
          enabled: true,
          verbosity: "mid",
          stream: socket,
        };
        this.sessions.set(cwd, state);
        this.callbacks.onHello(cwd, state);
        break;
      }
      case "progress": {
        const kind = frame.kind as string;
        const session = this.sessions.get(cwd);
        if (session) {
          session.lastEventAt = Date.now();
          if (kind === "turn_start") session.turnLive = true;
          if (kind === "turn_end") session.turnLive = false;
        }
        this.callbacks.onProgress(cwd, kind, frame.data);
        break;
      }
      case "question": {
        const session = this.sessions.get(cwd);
        if (session) session.lastEventAt = Date.now();
        const question: QuestionFrame = {
          id: frame.id as string,
          kind: (frame.kind as QuestionFrame["kind"]) ?? "input",
          title: (frame.title as string) ?? "",
          options: frame.options as string[] | undefined,
          default: frame.default as string | undefined,
        };
        this.callbacks.onQuestion(cwd, question);
        break;
      }
      case "bye": {
        const session = this.sessions.get(cwd);
        if (session) {
          session.turnLive = false;
          session.lastEventAt = Date.now();
        }
        break;
      }
      case "config_request": {
        const session = this.sessions.get(cwd);
        if (session) {
          this.sendFrame(cwd, {
            type: "config",
            enabled: session.enabled,
            verbosity: session.verbosity,
          });
        }
        break;
      }
      case "config_update": {
        const enabled = frame.enabled as boolean | undefined;
        const verbosity = frame.verbosity as Verbosity | undefined;
        if (enabled !== undefined || verbosity !== undefined) {
          const session = this.sessions.get(cwd);
          if (session) {
            if (enabled !== undefined) session.enabled = enabled;
            if (verbosity !== undefined) session.verbosity = verbosity;
          }
          this.callbacks.onConfigUpdate(cwd, enabled, verbosity);
        }
        break;
      }
      default:
        this.log(`Unknown frame type: ${type}`);
    }
  }

  sendFrame(cwd: string, frame: unknown): boolean {
    const session = this.sessions.get(cwd);
    if (!session || !session.stream) return false;
    try {
      session.stream.write(JSON.stringify(frame) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
