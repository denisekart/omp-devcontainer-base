/**
 * harness-rsi — RSI telemetry + ledger extension.
 *
 * Tools:    harness_report (read)  — aggregate session transcripts into a
 *           fingerprinted telemetry report under ~/.omp/harness/.
 *           harness_ledger (write) — append-only proposal ledger with dedup.
 * Commands: /rsi-export [days]     — print a pasteable findings skeleton.
 *           /rsi-intake <file>     — base-repo mechanical validate/dedup pass.
 *
 * No runtime imports beyond node: builtins — @sinclair/typebox does not resolve
 * in this image, and pi's TSchema explicitly accepts plain JSON Schema
 * documents for extension-authored tools (TJsonSchema = Record<string, unknown>).
 */
import child_process from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

// ── Constants ──────────────────────────────────────────────────────────────

const SESSIONS_DIR = path.join(os.homedir(), ".omp", "agent", "sessions");
const HARNESS_DIR = path.join(os.homedir(), ".omp", "harness");
const LEDGER_PATH = path.join(HARNESS_DIR, "ledger.json");
const USER_MCP_PATH = path.join(os.homedir(), ".omp", "agent", "mcp.json");
const PLUGINS_LOCK_PATH = path.join(os.homedir(), ".omp", "plugins.lock.json");
const MCP_PREFIX = "xd://mcp__";
const DISABLE_CANDIDATE_DAYS = 14;

// ── Small helpers ──────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

let ompVersionCache: string | null = null;
function ompVersion(): string {
  if (ompVersionCache === null) {
    try {
      const r = child_process.spawnSync("omp", ["--version"], { encoding: "utf8", timeout: 10_000 });
      ompVersionCache = r.status === 0 && r.stdout ? r.stdout.trim() : "unknown";
    } catch {
      ompVersionCache = "unknown";
    }
  }
  return ompVersionCache;
}

/** Parse the `2026-09-14T06-18-50-872Z` prefix omp uses in session names. */
function tsFromName(name: string): number | null {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Timestamp for a transcript file. Main-session files embed an ISO timestamp in
 * the name; subagent files (<AgentName>.jsonl inside a sibling directory named
 * after the parent session) do not — fall back to the parent dir/file name,
 * then to mtime.
 */
function fileTimestampMs(file: string): number {
  const base = tsFromName(path.basename(file));
  if (base !== null) return base;
  const parent = tsFromName(path.basename(path.dirname(file)));
  if (parent !== null) return parent;
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function walkJsonl(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    else if (recursive && e.isDirectory()) out.push(...walkJsonl(p, true));
  }
  return out;
}

/** The subset of a session jsonl line the aggregator reads. */
interface TranscriptLine {
  type?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: { type?: string; name?: string }[];
    isError?: boolean;
    toolName?: string;
  };
}

/** Iterate parsed JSON lines of a transcript; malformed lines are skipped. */
function eachLine(file: string, fn: (rec: TranscriptLine) => void): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec && typeof rec === "object") fn(rec as TranscriptLine); // structural view; every field read is typeof-guarded
  }
}

// ── MCP server resolution ──────────────────────────────────────────────────

const mcpServersCache = new Map<string, string[]>();

function mcpServerNamesFrom(file: string): string[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || !("mcpServers" in raw)) return [];
    const servers = (raw as { mcpServers?: unknown }).mcpServers;
    return servers && typeof servers === "object" && !Array.isArray(servers) ? Object.keys(servers) : [];
  } catch {
    return [];
  }
}

function mcpServerNames(cwd: string | undefined): string[] {
  const key = cwd ?? "";
  const hit = mcpServersCache.get(key);
  if (hit) return hit;
  const names = new Set([...mcpServerNamesFrom(USER_MCP_PATH), ...mcpServerNamesFrom(cwd ? path.join(cwd, ".omp", "mcp.json") : "")]);
  const list = [...names];
  mcpServersCache.set(key, list);
  return list;
}

/**
 * Resolve `xd://mcp__<escapedServer>_<tool>` to its server: dashes in server
 * names become underscores and server+tool are joined by ONE underscore, so
 * `xd://mcp__context_mode_ctx_execute` is server `context-mode`, tool
 * `ctx_execute`. The boundary is ambiguous (`a_b_tool` could be server `a` or
 * `a_b`), so match the longest escaped server name that is a `name_` prefix of
 * the remainder; otherwise "unknown".
 */
function resolveMcpServer(toolName: string, cwd: string | undefined): string {
  if (!toolName.startsWith(MCP_PREFIX)) return "";
  const rest = toolName.slice(MCP_PREFIX.length);
  let best = "";
  let bestEscLen = -1;
  for (const server of mcpServerNames(cwd)) {
    const esc = server.replace(/-/g, "_");
    if (rest.startsWith(`${esc}_`) && esc.length > bestEscLen) {
      best = server;
      bestEscLen = esc.length;
    }
  }
  return best || "unknown";
}

// ── Report pipeline (shared by tool + /rsi-export) ─────────────────────────

interface FileAgg {
  toolCalls: Map<string, number>;
  failed: Map<string, number>;
  thinkingChanges: number;
  mcpCalls: { server: string; ts: number; calls: number }[];
  cwd: string | undefined;
}

function aggregateFile(file: string): FileAgg {
  const agg: FileAgg = { toolCalls: new Map(), failed: new Map(), thinkingChanges: 0, mcpCalls: [], cwd: undefined };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  eachLine(file, (rec) => {
    if (rec.type === "session" && typeof rec.cwd === "string" && !agg.cwd) agg.cwd = rec.cwd;
    else if (rec.type === "thinking_level_change") agg.thinkingChanges++;
    else if (rec.type === "message" && rec.message?.role === "assistant") {
      for (const block of rec.message.content ?? []) {
        if (block?.type === "toolCall" && typeof block.name === "string") bump(agg.toolCalls, block.name);
      }
    } else if (rec.type === "message" && rec.message?.role === "toolResult" && rec.message.isError === true) {
      if (typeof rec.message.toolName === "string") bump(agg.failed, rec.message.toolName);
    }
  });
  const ts = fileTimestampMs(file);
  for (const [name, calls] of agg.toolCalls) {
    const server = resolveMcpServer(name, agg.cwd);
    if (server) agg.mcpCalls.push({ server, ts, calls });
  }
  return agg;
}

interface PluginLockEntry {
  version?: string;
}

interface Fingerprint {
  ompVersion: string;
  host: string;
  plugins: Record<string, PluginLockEntry>;
  date: string;
}

interface WorkspaceStats {
  sessions: number;
  toolCalls: Record<string, number>;
  failedTools: Record<string, number>;
  thinkingChanges: number;
}

interface Report {
  fingerprint: Fingerprint;
  workspaces: Record<string, WorkspaceStats>;
  mcpUsage: Record<string, { calls: number; lastSeen: string | null }>;
}

function pluginsFromLock(): Record<string, PluginLockEntry> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(PLUGINS_LOCK_PATH, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, PluginLockEntry> = {};
    for (const [name, v] of Object.entries(raw)) {
      out[name] = v && typeof v === "object" && "version" in v && typeof v.version === "string" ? { version: v.version } : {};
    }
    return out;
  } catch {
    return {};
  }
}

function buildReport(days: number): { report: Report; reportPath: string } {
  const cutoff = Date.now() - days * 86_400_000;
  const workspaces: Record<string, WorkspaceStats> = {};
  const mcpUsage: Report["mcpUsage"] = {};
  let wsDirs: string[] = [];
  try {
    wsDirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* no sessions dir → empty report */
  }
  for (const ws of wsDirs) {
    const dir = path.join(SESSIONS_DIR, ws);
    const mainFiles = walkJsonl(dir, false).filter((f) => fs.statSync(f).mtimeMs >= cutoff);
    const allFiles = walkJsonl(dir, true).filter((f) => fs.statSync(f).mtimeMs >= cutoff);
    if (allFiles.length === 0) continue;
    const toolCalls: Record<string, number> = {};
    const failedTools: Record<string, number> = {};
    let thinkingChanges = 0;
    for (const f of allFiles) {
      const agg = aggregateFile(f);
      for (const [k, n] of agg.toolCalls) toolCalls[k] = (toolCalls[k] ?? 0) + n;
      for (const [k, n] of agg.failed) failedTools[k] = (failedTools[k] ?? 0) + n;
      thinkingChanges += agg.thinkingChanges;
      for (const { server, ts, calls } of agg.mcpCalls) {
        if (!mcpUsage[server]) mcpUsage[server] = { calls: 0, lastSeen: null };
        const u = mcpUsage[server];
        u.calls += calls;
        const iso = new Date(ts).toISOString();
        if (!u.lastSeen || iso > u.lastSeen) u.lastSeen = iso;
      }
    }
    workspaces[ws] = { sessions: mainFiles.length, toolCalls, failedTools, thinkingChanges };
  }
  const report: Report = {
    fingerprint: { ompVersion: ompVersion(), host: os.hostname(), plugins: pluginsFromLock(), date: today() },
    workspaces,
    mcpUsage,
  };
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  const reportPath = path.join(HARNESS_DIR, `report-${today()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath };
}

function summarize(report: Report, reportPath: string): string {
  const totalCalls = Object.values(report.workspaces).reduce(
    (s, w) => s + Object.values(w.toolCalls).reduce((a, b) => a + b, 0), 0);
  const wsCount = Object.keys(report.workspaces).length;
  const servers = Object.keys(report.mcpUsage).length;
  return `Harness report: ${wsCount} workspace(s), ${totalCalls} tool calls in window, ${servers} MCP server(s) seen. Written to ${reportPath}`;
}

// ── Ledger (shared by tool + /rsi-intake) ──────────────────────────────────

interface LedgerEntry {
  date: string;
  host: string;
  ompVersion: string;
  source: string;
  target: string;
  gist: string;
  disposition: string;
}

interface Proposal {
  target: string;
  gist: string;
  disposition?: string;
}

function isLedgerEntry(v: unknown): v is LedgerEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.target === "string" && typeof e.gist === "string";
}

function ledgerKey(target: string, gist: string): string {
  return crypto.createHash("sha256").update(`${target}\n${gist}`).digest("hex");
}

function loadLedger(): LedgerEntry[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    return Array.isArray(raw) && raw.every(isLedgerEntry) ? raw : [];
  } catch {
    return [];
  }
}

type LedgerVerdict = { target: string; gist: string; verdict: string };

function ledgerCheck(proposals: Proposal[]): { verdicts: LedgerVerdict[]; matches: LedgerEntry[] } {
  const ledger = loadLedger();
  const seen = new Set(ledger.map((e) => ledgerKey(e.target, e.gist)));
  const verdicts = proposals.map((p) => ({
    target: p.target,
    gist: p.gist,
    verdict: seen.has(ledgerKey(p.target, p.gist)) ? "duplicate" : "new",
  }));
  const targets = new Set(proposals.map((p) => p.target));
  return { verdicts, matches: ledger.filter((e) => targets.has(e.target)) };
}

function ledgerRecord(source: string, proposals: Proposal[]): number {
  const ledger = loadLedger();
  for (const p of proposals) {
    ledger.push({
      date: new Date().toISOString(),
      host: os.hostname(),
      ompVersion: ompVersion(),
      source,
      target: p.target,
      gist: p.gist,
      disposition: p.disposition ?? "pending",
    });
  }
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger.length;
}

// ── Findings document ──────────────────────────────────────────────────────

function buildFindingsMd(report: Report): string {
  const f = report.fingerprint;
  const plugins = Object.entries(f.plugins)
    .map(([n, v]) => `${n}@${v.version ?? "unknown"}`)
    .join(", ") || "none";
  const staleCutoff = Date.now() - DISABLE_CANDIDATE_DAYS * 86_400_000;
  const lines: string[] = [
    `# HARNESS FINDINGS ${f.date}`,
    "",
    "## Fingerprint",
    `- ompVersion: ${f.ompVersion}`,
    `- host: ${f.host}`,
    `- date: ${f.date}`,
    `- plugins: ${plugins}`,
    "",
    "## Telemetry",
    "| workspace | sessions | tool calls | failed | thinking changes |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [ws, w] of Object.entries(report.workspaces)) {
    const calls = Object.values(w.toolCalls).reduce((a, b) => a + b, 0);
    const failed = Object.values(w.failedTools).reduce((a, b) => a + b, 0);
    lines.push(`| ${ws} | ${w.sessions} | ${calls} | ${failed} | ${w.thinkingChanges} |`);
  }
  for (const [ws, w] of Object.entries(report.workspaces)) {
    const top = Object.entries(w.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, n]) => `\`${k}\` ×${n}`).join(", ");
    if (top) lines.push("", `Top tools \`${ws}\`: ${top}`);
  }
  lines.push("", "### MCP usage", "| server | calls | lastSeen | disable-candidate |", "|---|---:|---|---|");
  for (const [server, u] of Object.entries(report.mcpUsage)) {
    const stale = u.lastSeen === null || Date.parse(u.lastSeen) < staleCutoff;
    lines.push(`| ${server} | ${u.calls} | ${u.lastSeen ?? "never"} | ${stale ? "YES" : ""} |`);
  }
  lines.push(
    "",
    "## Findings",
    "_Add counted observations here (dead references, loops, config mismatches, failed-tool spikes). One bullet per finding, each citing a number from Telemetry above._",
    "",
    "## Proposals [upstream]",
    "_One line per proposal, format `target: gist`, where target is a file under `build/` in denisekart/omp-devcontainer-base. Keep gists stable — the base-repo ledger dedups on target+gist._",
    "",
    "Intake: paste this document into an omp session in the base repo (denisekart/omp-devcontainer-base); the session agent delegates to `harness-retro` which ledger-checks and implements it.",
    "",
  );
  return lines.join("\n");
}

const EXPORT_BEGIN = "--- BEGIN HARNESS FINDINGS ---";
const EXPORT_END = "--- END HARNESS FINDINGS ---";

// ── /rsi-intake parsing ────────────────────────────────────────────────────

/**
 * Pull the export date and the `target: gist` proposal lines out of a findings
 * document. Proposal lines run until the next heading or the closing `Intake:`
 * line; instruction/blank lines (starting with `_`) are skipped; the first `:`
 * splits target from gist.
 */
function parseFindings(text: string): { date: string | null; proposals: Proposal[] } {
  const proposals: Proposal[] = [];
  let date: string | null = text.match(/# HARNESS FINDINGS (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (!date) date = text.match(/^- date: (\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  const m = text.match(/^## Proposals \[upstream\]\n([\s\S]*?)(?=^## |^Intake:)/m) ?? text.match(/^## Proposals \[upstream\]\n([\s\S]*)/m);
  if (m) {
    for (const raw of m[1].split("\n")) {
      const line = raw.trim();
      if (/^(Intake:|#)/.test(line)) break;
      if (!line || line.startsWith("_")) continue;
      const sep = line.indexOf(":");
      if (sep <= 0) continue;
      const target = line.slice(0, sep).trim();
      const gist = line.slice(sep + 1).trim();
      if (target && gist) proposals.push({ target, gist });
    }
  }
  return { date, proposals };
}

/** Last committer date of `target` (cwd-relative); null if git has no record. */
function targetLastChanged(target: string): string | null {
  try {
    const r = child_process.spawnSync("git", ["log", "-1", "--format=%cI", "--", target], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const out = r.status === 0 ? r.stdout.trim() : "";
    return out || null;
  } catch {
    return null;
  }
}

// ── Command handlers ───────────────────────────────────────────────────────

async function handleExport(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const notify = (text: string, type?: "info" | "warning" | "error") => {
    try {
      ctx.ui?.notify?.(text, type);
    } catch {
      /* notify is best-effort (may be absent in -p mode) */
    }
  };
  try {
    const parsed = parseInt(args.trim(), 10);
    const days = parsed > 0 ? parsed : 7;
    const { report, reportPath } = buildReport(days);
    const mdPath = path.join(HARNESS_DIR, `findings-${today()}.md`);
    const md = buildFindingsMd(report);
    fs.writeFileSync(mdPath, md);
    notify(`Wrote ${mdPath} (report: ${reportPath}).\n\n${EXPORT_BEGIN}\n${md}${EXPORT_END}`, "info");
  } catch (err) {
    notify(`rsi-export failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

async function handleIntake(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const notify = (text: string, type?: "info" | "warning" | "error") => {
    try {
      ctx.ui?.notify?.(text, type);
    } catch {
      /* notify is best-effort (may be absent in -p mode) */
    }
  };
  try {
    const file = args.trim();
    if (!file) {
      notify("Usage: /rsi-intake <path-to-findings.md>", "warning");
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      notify(`Cannot read findings file: ${file}`, "error");
      return;
    }
    const { date, proposals } = parseFindings(text);
    if (proposals.length === 0) {
      notify(`No "target: gist" proposals found under "## Proposals [upstream]" in ${file}.`, "warning");
      return;
    }
    const { verdicts, matches } = ledgerCheck(proposals);
    const exportMs = date ? Date.parse(`${date}T23:59:59Z`) : NaN;
    const rows = verdicts.map((v) => {
      let verdict = v.verdict;
      if (verdict === "new" && !Number.isNaN(exportMs)) {
        const changed = targetLastChanged(v.target);
        if (changed && Date.parse(changed) > exportMs) verdict = "stale";
      }
      if (v.verdict === "duplicate") {
        const prior = matches.find((e) => e.target === v.target && e.gist === v.gist);
        verdict = `duplicate(${prior ? prior.date.slice(0, 10) : "?"},${prior?.disposition ?? "?"})`;
      }
      return `| ${v.target} | ${v.gist} | ${verdict} |`;
    });
    const priorByTarget = new Map<string, LedgerEntry[]>();
    for (const e of matches) {
      const list = priorByTarget.get(e.target) ?? [];
      list.push(e);
      priorByTarget.set(e.target, list);
    }
    const priorLines = [...priorByTarget.entries()].map(([t, es]) =>
      `- ${t}: ${es.map((e) => `${e.date.slice(0, 10)} ${e.disposition}`).join("; ")}`);
    notify(
      [
        `RSI intake — ${proposals.length} proposal(s), export date ${date ?? "unknown"}`,
        "",
        "| target | gist | verdict |",
        "|---|---|---|",
        ...rows,
        ...(priorLines.length ? ["", "Prior ledger entries:", ...priorLines] : []),
        "",
        "Hand this document + verdicts to `harness-retro` for implementation.",
      ].join("\n"),
      "info",
    );
  } catch (err) {
    notify(`rsi-intake failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

interface ReportParams {
  days?: number;
}

interface LedgerParams {
  action: string;
  source?: string;
  proposals?: Proposal[];
}

type LedgerDetails =
  | { verdicts: LedgerVerdict[]; matches: LedgerEntry[] }
  | { recorded: number; total: number; path: string };

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "harness_report",
    label: "Harness Report",
    description:
      "Aggregate recent omp session transcripts (~/.omp/agent/sessions) into a fingerprinted telemetry report: per-workspace session/tool-call/failure counts, MCP server usage, and an environment fingerprint. Writes ~/.omp/harness/report-<date>.json. days defaults to 7.",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Lookback window in days (default 7)" } },
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId: string, params: ReportParams): Promise<AgentToolResult<Report>> {
      const days = typeof params?.days === "number" && params.days > 0 ? params.days : 7;
      const { report, reportPath } = buildReport(days);
      return { content: [{ type: "text", text: summarize(report, reportPath) }], details: report };
    },
  });

  pi.registerTool({
    name: "harness_ledger",
    label: "Harness Ledger",
    description:
      'Append-only proposal ledger (~/.omp/harness/ledger.json) for RSI intake. action "check": verdict per proposal (new/duplicate; dedup key sha256(target+"\\n"+gist)) plus every historical entry matching the target. action "record": append proposals with disposition (applied | rejected:<reason> | stale | belongs-to-source-repo | pending).',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["check", "record"] },
        source: { type: "string", description: "Origin of the proposals (e.g. findings doc path/host)" },
        proposals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target: { type: "string", description: "File under build/ the fix belongs to" },
              gist: { type: "string", description: "One-line stable description of the change" },
              disposition: { type: "string", description: "For record: applied | rejected:<reason> | stale | belongs-to-source-repo | pending" },
            },
            required: ["target", "gist"],
            additionalProperties: false,
          },
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    approval: "write",
    async execute(_toolCallId: string, params: LedgerParams): Promise<AgentToolResult<LedgerDetails>> {
      const proposals = Array.isArray(params?.proposals) ? params.proposals : [];
      if (params?.action === "record") {
        const total = ledgerRecord(params.source ?? "", proposals);
        return {
          content: [{ type: "text", text: `Recorded ${proposals.length} proposal(s). Ledger total: ${total}. File: ${LEDGER_PATH}` }],
          details: { recorded: proposals.length, total, path: LEDGER_PATH },
        };
      }
      const { verdicts, matches } = ledgerCheck(proposals);
      const text = verdicts.length ? verdicts.map((v) => `${v.target} — ${v.verdict}`).join("\n") : "No proposals supplied.";
      return { content: [{ type: "text", text }], details: { verdicts, matches } };
    },
  });

  try {
    pi.registerCommand("rsi-export", {
      description: "Print a pasteable harness findings skeleton (default window: 7 days)",
      handler: handleExport,
    });
    pi.registerCommand("rsi-intake", {
      description: "Validate a HARNESS FINDINGS document: ledger dedup + staleness verdicts",
      handler: handleIntake,
    });
  } catch {
    // registerCommand may not exist in -p mode; tools stay registered
  }
}
