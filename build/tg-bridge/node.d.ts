// node.d.ts — Ambient type declarations for node builtins

interface Event {
  target?: unknown;
}

interface AbortSignal {
  aborted?: boolean;
  onabort?: ((this: AbortSignal, ev: Event) => void) | null;
  reason?: unknown;
  throwIfAborted?(): void;
}

declare class AbortController {
  constructor();
  signal: AbortSignal;
  abort(): void;
}

interface Buffer {
  toString(): string;
  length: number;
}

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
};

declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  cwd(): string;
  pid: number;
  on(signal: string, listener: (...args: unknown[]) => void): void;
};

declare function require(id: string): unknown;

declare function setTimeout(
  callback: (...args: unknown[]) => void,
  ms?: number,
): number;

declare function clearTimeout(timeoutId: number): void;

declare function setInterval(
  callback: (...args: unknown[]) => void,
  ms?: number,
): number;

declare function clearInterval(intervalId: number): void;

declare const URL: {
  prototype: URL;
  new (url: string, base?: string | URL): URL;
};

interface URL {
  href: string;
  pathname: string;
  search: string;
  hash: string;
  searchParams: URLSearchParams;
  toString(): string;
  toJSON(): string;
}

interface URLSearchParams {
  get(name: string): string | null;
  getAll(name: string): string[];
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  delete(name: string): void;
  has(name: string): boolean;
  toString(): string;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  forEach(callback: (value: string, key: string) => void): void;
}

declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive: boolean }): string | null;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Uint8Array;
  export function unlinkSync(path: string): void;
  export function chmodSync(path: string, mode: number | string): void;
  export function statSync(path: string): { isDirectory(): boolean };
  export function readdirSync(path: string): string[];
  export function rmdirSync(path: string): void;
  export interface WriteStream {
    write(data: string): boolean;
    end(): void;
  }
  export function createWriteStream(
    path: string,
    options?: { flags?: string },
  ): WriteStream;
  export function openSync(path: string, flags: string): number;
  export function closeSync(fd: number): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function copyFileSync(src: string, dest: string): void;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
  export function extname(path: string): string;
}

declare module "node:net" {
  export interface Socket {
    on(event: string, handler: (...args: unknown[]) => void): void;
    on(event: 'error', handler: (err: Error) => void): void;
    write(data: string | Uint8Array): boolean;
    end(): void;
    destroy(): void;
    setNoDelay(noDelay?: boolean): void;
  }
  export interface NetServer {
    on(event: string, handler: (...args: unknown[]) => void): void;
    listen(port: number, host: string, callback?: () => void): void;
    listen(path: string, callback?: () => void): void;
    close(callback?: () => void): void;
    address(): string | { port: number } | null;
  }
  export function createConnection(path: string): Socket;
  export function createServer(handler: (socket: Socket) => void): NetServer;
}

declare module "node:child_process" {
  export interface ChildProcessStdio {
    on(event: string, handler: (data: Buffer) => void): void;
  }
  export interface ChildProcess {
    stdout: ChildProcessStdio | null;
    stderr: ChildProcessStdio | null;
    stdin: ChildProcessStdio | null;
    on(event: string, handler: (...args: unknown[]) => void): void;
    once(event: string, handler: (...args: unknown[]) => void): void;
    kill(signal?: string): boolean;
    connected: boolean;
    pid: number;
    exitCode: number | null;
  }
  export function spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdio?: string[];
      detached?: boolean;
    }
  ): ChildProcess;
}

declare module "fs" {
  export {
    mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync,
    chmodSync, statSync, readdirSync, rmdirSync, createWriteStream,
    openSync, closeSync, renameSync, copyFileSync
  } from "node:fs";
}

declare module "http" {
  export interface IncomingMessage {
    url?: string;
    on(event: string, handler: (...args: unknown[]) => void): void;
  }
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  }
  export interface Server {
    on(event: string, handler: (...args: unknown[]) => void): void;
    listen(port: number, host: string, callback?: () => void): void;
    close(callback?: () => void): void;
    address(): string | { port: number } | null;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare function fetch(url: string | URL, init?: RequestInit): Promise<Response>;

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

interface Response {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
