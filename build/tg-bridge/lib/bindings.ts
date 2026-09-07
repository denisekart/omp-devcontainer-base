// lib/bindings.ts - State read/write for config, bindings, replay (0600)

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  botToken: string;
  groupId: number;
  allowedUserIds: number[];
  maxConcurrent: number;
  editIntervalMs: number;
  apiBase?: string;
}

export interface Binding {
  cwd: string;
  name: string;
  lastSessionId?: string;
  lastSessionFile?: string;
  lastEventAt: number;
  remoteEnabled: boolean;
  verbosity: "low" | "mid" | "high" | "xhigh";
}

export type Verbosity = "low" | "mid" | "high" | "xhigh";

export interface ReplayEntry {
  text: string;
}

export function addReplayEntry(
  replay: Map<number, ReplayEntry[]>,
  topicId: number,
  entry: ReplayEntry,
): void {
  const entries = replay.get(topicId) ?? [];
  entries.push(entry);
  // Keep only last 100 entries
  while (entries.length > 100) {
    entries.shift();
  }
  replay.set(topicId, entries);
}

export function getReplayEntries(
  replay: Map<number, ReplayEntry[]>,
  topicId: number,
): ReplayEntry[] {
  return replay.get(topicId) ?? [];
}
const DEFAULT_EDIT_INTERVAL_MS = 1500;
const DEFAULT_MAX_CONCURRENT = 3;

export function readStateDir(): string {
  return process.env.TG_BRIDGE_STATE_DIR ?? "/home/vscode/.omp/tg-bridge";
}

export function ensureStateDir(): void {
  const dir = readStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readConfig(): Config | null {
  const dir = readStateDir();
  const path = join(dir, "config.json");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8") as string;
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw) as Partial<Config>;
  } catch {
    return null;
  }
  return {
    botToken: parsed.botToken!,
    groupId: parsed.groupId!,
    allowedUserIds: parsed.allowedUserIds ?? [],
    maxConcurrent: parsed.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    editIntervalMs: parsed.editIntervalMs ?? DEFAULT_EDIT_INTERVAL_MS,
    apiBase: parsed.apiBase,
  };
}

export function readBindings(): Map<number, Binding> {
  const dir = readStateDir();
  const path = join(dir, "bindings.json");
  const map = new Map<number, Binding>();
  if (!existsSync(path)) return map;
  const raw = readFileSync(path, "utf8") as string;
  let obj: Record<string, Binding>;
  try {
    obj = JSON.parse(raw) as Record<string, Binding>;
  } catch {
    return new Map();
  }
  for (const [key, val] of Object.entries(obj)) {
    map.set(Number(key), val);
  }
  return map;
}

export function writeBindings(bindings: Map<number, Binding>): void {
  const dir = readStateDir();
  ensureStateDir();
  const path = join(dir, "bindings.json");
  const obj: Record<string, Binding> = {};
  for (const [key, val] of bindings) {
    obj[String(key)] = val;
  }
  writeFileSync(path, JSON.stringify(obj, null, 2));
  chmodSync(path, 0o600);
}

export function readReplay(): Map<number, ReplayEntry[]> {
  const dir = readStateDir();
  const path = join(dir, "replay.json");
  const map = new Map<number, ReplayEntry[]>();
  if (!existsSync(path)) return map;
  const raw = readFileSync(path, "utf8") as string;
  let obj: Record<string, ReplayEntry[]>;
  try {
    obj = JSON.parse(raw) as Record<string, ReplayEntry[]>;
  } catch {
    return new Map();
  }
  for (const [key, val] of Object.entries(obj)) {
    map.set(Number(key), val);
  }
  return map;
}

export function writeReplay(replay: Map<number, ReplayEntry[]>): void {
  const dir = readStateDir();
  ensureStateDir();
  const path = join(dir, "replay.json");
  const obj: Record<string, ReplayEntry[]> = {};
  for (const [key, val] of replay) {
    obj[String(key)] = val;
  }
  writeFileSync(path, JSON.stringify(obj, null, 2));
  chmodSync(path, 0o600);
}

export function getBindingForTopic(
  bindings: Map<number, Binding>,
  topicId: number,
): Binding | undefined {
  return bindings.get(topicId);
}

export function setBindingForTopic(
  bindings: Map<number, Binding>,
  topicId: number,
  cwd: string,
): void {
  const name = cwd.split("/").pop() ?? "unknown";
  bindings.set(topicId, { cwd, name, lastEventAt: Date.now(), remoteEnabled: true, verbosity: "mid" });
}

export function removeBindingForTopic(
  bindings: Map<number, Binding>,
  topicId: number,
): void {
  bindings.delete(topicId);
}

export function updateBindingEvent(
  bindings: Map<number, Binding>,
  topicId: number,
  sessionId?: string,
  sessionFile?: string,
): void {
  const existing = bindings.get(topicId);
  if (existing) {
    bindings.set(topicId, {
      ...existing,
      lastSessionId: sessionId ?? existing.lastSessionId,
      lastSessionFile: sessionFile ?? existing.lastSessionFile,
      lastEventAt: Date.now(),
    });
  }
}
