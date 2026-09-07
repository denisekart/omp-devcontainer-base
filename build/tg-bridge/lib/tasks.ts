// lib/tasks.ts — Spawn/kill/track omp daemon tasks

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export interface TaskInfo {
  cwd: string;
  pid: number;
  prompt: string;
  startTime: number;
  process: ReturnType<typeof spawn>;
  lastLine: string;
  sessionFile?: string;
}
export interface TaskCallbacks {
  onLine: (cwd: string, line: string) => void;
  onExit: (cwd: string, code: number | null) => void;
  onLog: (msg: string) => void;
}

export class TaskManager {
  private tasks = new Map<string, TaskInfo>();
  private callbacks: TaskCallbacks;
  private ompBin: string;
  private logStream: ReturnType<typeof createWriteStream> | null = null;

  constructor(ompBin: string, callbacks: TaskCallbacks) {
    this.ompBin = ompBin;
    this.callbacks = callbacks;
  }

  setLogStream(stream: ReturnType<typeof createWriteStream>) {
    this.logStream = stream;
  }

  private log(msg: string) {
    this.callbacks.onLog?.(msg);
    if (this.logStream) this.logStream.write(msg + "\n");
  }

  spawn(
    cwd: string,
    prompt: string,
    sessionFile?: string,
  ): TaskInfo | null {
    if (this.tasks.has(cwd)) {
      this.log(`Task already running for ${cwd} (pid: ${this.tasks.get(cwd)?.pid})`);
      return this.tasks.get(cwd) ?? null;
    }

    const args = ["-p", prompt, "--cwd", cwd];
    if (sessionFile) {
      args.push("-r", sessionFile);
    }

    this.log(`Spawning omp: ${this.ompBin} ${args.join(" ")}`);
    const process = spawn(this.ompBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startTime = Date.now();
    const task: TaskInfo = {
      cwd,
      pid: process.pid ?? 0,
      prompt,
      startTime,
      process,
      lastLine: "",
      sessionFile,
    };
    this.tasks.set(cwd, task);

    process.stdout?.on("data", (data: unknown) => {
      const text = (data as Buffer).toString();
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.length > 0) {
          task.lastLine = line;
          this.callbacks.onLine(cwd, line);
        }
      }
    });

    process.stderr?.on("data", (data: Buffer) => {
      this.log(`[${cwd}] stderr: ${data}`);
    });

    process.on("exit", (code: unknown) => {
      this.tasks.delete(cwd);
      this.log(`[${cwd}] exited with code ${(code as number | null)}`);
      this.callbacks.onExit(cwd, code as number | null);
    });

    return task;
  }

  kill(cwd: string): boolean {
    const task = this.tasks.get(cwd);
    if (!task) return false;
    task.process.kill("SIGINT");
    this.log(`Sent SIGINT to ${cwd} (pid ${task.pid})`);
    return true;
  }

  getInfo(cwd: string): TaskInfo | undefined {
    return this.tasks.get(cwd);
  }

  getStatusText(cwd: string): string {
    const task = this.tasks.get(cwd);
    if (!task) return "No task running";
    const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
    return `Running (pid: ${task.pid}, elapsed: ${elapsed}s)\nLast line: ${task.lastLine}`;
  }

  getActiveCount(): number {
    return this.tasks.size;
  }

  hasTask(cwd: string): boolean {
    return this.tasks.has(cwd);
  }

  getRunningCwds(): string[] {
    return Array.from(this.tasks.keys());
  }
}
