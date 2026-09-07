# Mobile Bridge: Control omp Sessions from Telegram

## Context

- omp v18.1.11 (`@oh-my-pi/pi-coding-agent`) is baked into this devcontainer image; long-running interactive sessions run in tmux; `~/.omp` is a persistent volume (survives container restarts and image rebuilds).
- No official omp messaging plugin exists. Ecosystem prior art (all MIT, reviewed): `pi-telegram-plus` (in-process extension + daemon, multi-instance, history replay), `badlogic/pi-telegram` (minimal polling, pairing, draft streaming), `tensorfish/pi-telegram` (modular relay, progress edits), `CCGram` (tmux↔Telegram bridge). We build a native omp extension + daemon adapted from these patterns — no paid services, zero npm dependencies.
- Verified integration surfaces (`omp://extensions.md`, `omp://extension-loading.md`, `omp://rpc.md`, dist `.d.ts`):
  - Extension auto-discovery from `~/.omp/agent/extensions/` (user agent dir) — every omp session, cwd-independent, no config change (the baked `config.yml` `extensions: []` is a separate explicit list and does not suppress directory discovery). Confirmed by the oh-my-pi `authoring-extensions` skill sample (can1357/oh-my-pi `docs/skills/`): default-export factory `export default function (pi: ExtensionAPI)`, `pi.on(...)` events, `pi.registerCommand(name, { description, handler })` slash commands, `pi.zod` for tool params.
  - Steering: `pi.sendUserMessage(text, { deliverAs: "steer" | "followUp" | "aside" })`; abort: `ctx.abort()`; idle: `ctx.isIdle()`.
  - Ask interception: `tool_call` handler returns `ToolCallEventResult { block?, reason?, input? }` — `block + reason` is returned to the LLM as a tool error. **Open question (P0 spike #2):** the typed `ToolCallEvent` union covers bash/read/edit/write/grep/glob + `CustomToolCallEvent { toolName, input }` — the built-in `ask` tool is not a named variant; P0 verifies empirically whether `tool_call` fires for `ask` (and as which variant) and that `block+reason` reaches the model.
  - Progress events: `turn_start/turn_end`, `agent_start/agent_end`, `tool_execution_start/end`, `message_start/end`, `session_start/shutdown`, `todo_reminder`; managed timers `ctx.setInterval` required (raw timers can crash the session).
  - CLI: `omp -p <prompt> --cwd <dir> [-r <sessionFile>] [--mode rpc]` for daemon-spawned tasks; the extension auto-loads in spawned sessions too → uniform progress + ask handling.
- Network constraint: rig is on a private network; no inbound ports. Telegram Bot API **long polling** (`getUpdates`) is outbound HTTPS only — fits the constraint (webhooks rejected). `api.telegram.org` is reachable from the container (verified).
- Existing bake-in patterns to mirror: `build/library/omp-defaults/` → `/usr/local/share/omp-defaults` → seeded into `~/.omp/` by `seed-omp-home.sh` (never overwrites user files; hash-sentinel merge picks up new default files at next boot); the `hindsight` supervisor runs as a tmux session started from `postStartCommand`.

## Goal

One Telegram supergroup (forum topics) as the mobile control surface for all omp workspaces:

1. **Progress reports** (text): compact tool lines, turn boundaries, todo deltas, final answers — live per workspace topic.
2. **Q&A**: the `ask` tool's dialog is routed to Telegram with an inline keyboard; a tap answers in-session.
3. **Steering**: free text to a topic → steer (running) / new prompt (idle); `/abort` stops the turn.
4. **Task lifecycle**: `/start`, `/stop`, `/restart`, `/resume`, `/status` — daemon spawns `omp -p --cwd <ws>` children per workspace (pid-tracked, concurrency-capped).
5. **One topic per repo**; bindings + Telegram history persist across omp session termination and container restart; `/replay` re-sends recent progress so the thread continues.
6. **Per-session control from the TUI**: `/remote on|off|status` and `/remote verbosity low|mid|high|xhigh` toggle the bridge and its detail level (persisted per workspace by the daemon).
7. **Secure**: outbound-only HTTPS to Telegram; user-ID whitelist pairing; 0600 state; no inbound ports; single daemon instance.

## Architecture

Two components, one socket protocol:

- **Extension `telegram-bridge.ts`** (in every omp session, in-process): reports identity + progress over the unix socket; receives prompts/abort/answers; intercepts `ask` via `tool_call` block+reason; registers the `/remote` slash command. Silent no-op when the daemon is absent or the workspace is disabled.
- **Daemon `tg-bridge`** (standalone bun process, auto-started at container start): long-polls Telegram; owns pairing, topic↔workspace bindings, task lifecycle (spawn/kill `omp` children), progress rendering (one edited "live" message per turn, 4096-char chunking, ≥1.5s edit interval), and the persisted per-workspace remote state (enabled flag + verbosity).

### Socket protocol (JSONL, one frame per line)

| dir | frame | payload |
| --- | --- | --- |
| ext→daemon | `hello` | `{ cwd, sessionId, sessionFile, ompVersion, pid }` |
| ext→daemon | `progress` | `{ kind: turn_start\|turn_end\|tool\|message\|todo\|error\|agent_start\|agent_end, data }` |
| ext→daemon | `question` | `{ id, kind: select\|confirm\|input, title, options?, default? }` |
| ext→daemon | `bye` | — |
| ext→daemon | `config_request` | `{ cwd }` |
| ext→daemon | `config_update` | `{ cwd, enabled?, verbosity? }` |
| daemon→ext | `prompt` | `{ text, deliverAs: steer\|followUp\|new }` |
| daemon→ext | `abort` | — |
| daemon→ext | `answer` | `{ id, value }` |
| daemon→ext | `config` | `{ enabled, verbosity }` |

Routing: `hello.cwd` → binding → topic. Free text in a topic goes to the most recently active session for that cwd (steer if running, else new turn). `/stop`/`/status` target the daemon-owned task pid for the cwd.

### `/remote` slash command (TUI, per session)

Registered by the extension via `pi.registerCommand` (pattern per the oh-my-pi `authoring-extensions` skill sample):

- `/remote` — status: enabled, verbosity, daemon connection, last event time
- `/remote on` / `/remote off` — enable/disable the bridge for **this workspace**; the daemon persists the flag per workspace (all sessions in the workspace share it; survives session termination). `off` stops progress emission and ask routing (normal TUI `ask` dialog is used instead).
- `/remote verbosity low|mid|high|xhigh` — set verbosity; persisted per workspace; default `mid`

Verbosity levels (follows thinking-effort conventions):

- `low` — turn boundaries, final answer, errors only
- `mid` (default) — + tool one-liners
- `high` — + todo-list deltas, tool error details
- `xhigh` — + tool args/details, agent lifecycle, compaction/model events

When the daemon is offline the command reports that and the bridge is a no-op anyway; settings sent while connected are applied immediately.

### State (all under `~/.omp/tg-bridge/`, volume-backed, 0600)

- `config.json` — `botToken`, `groupId`, `allowedUserIds[]`, `maxConcurrent` (3), `editIntervalMs` (1500), `apiBase` (default `https://api.telegram.org`; overridable for tests)
- `bindings.json` — `topicId → { cwd, name, lastSessionId, lastSessionFile, lastEventAt, remoteEnabled: true, verbosity: "mid" }`
- `replay.json` — last 100 rendered entries per topic (for `/replay`)
- `daemon.log` — rotated at 1 MB
- `sock`, `daemon.lock` — IPC + flock single-instance

Env overrides (testability): `TG_BRIDGE_STATE_DIR`, `TG_BRIDGE_SOCK`, `TG_BRIDGE_OMP_BIN` (daemon), extension reads `TG_BRIDGE_SOCK` for the socket path.

### Commands (per topic, whitelisted users only)

| cmd | effect |
| --- | --- |
| `/start <prompt>` | spawn `omp -p --cwd <ws> <prompt>` task in the topic |
| `/stop` | abort via socket; kill after 10s grace |
| `/restart [prompt]` | kill + respawn with `-r <lastSessionFile>` (resume) |
| `/resume` | respawn the last session for the cwd (fresh process) |
| `/status` | daemon + task pid / elapsed / last event / todos |
| `/abort` | steer-only abort (process keeps running) |
| `/bind <cwd>` | bind the current topic to a workspace |
| `/replay [N]` | resend the last N rendered entries (thread continuity) |
| `/pair`, `/unpair` | DM pairing (auto-pair on first DM when the list is empty) |
| `/help` | command reference |
| free text | prompt: steer (running) / new turn (idle) / start (no session) |

### Progress rendering (extension → daemon → Telegram)

- Tool one-liners: `edit src/foo.ts`, `bash dotnet build`, `read 3 files` (name + truncated key args)
- Turn start/end lines; todo-list deltas on `todo_reminder` / todo tool results; final assistant text (chunked at 4096)
- One edited "live" message per (topic, turn), updated at most every 1.5s (extension-side batching via `ctx.setInterval`); finalized at `turn_end`; respect Telegram 429 `retry_after`
- Emission is filtered by the workspace's verbosity level (above) before sending

### Ask flow

- `tool_call` on `ask` → extension sends `question`, awaits `answer` (10-min timeout) → returns `{ block: true, reason: "Answered via Telegram: <choice>" }`. Timeout → `{ block: true, reason: "No reply from mobile within 10 min — proceed without user input." }`
- The model receives the answer as a tool-error payload (documented 18.x limitation). The TUI dialog never renders for intercepted asks (blocked before execution). Only answer paths: Telegram tap or timeout.
- Guard: the extension intercepts `ask` **only while the socket is connected and the workspace is enabled**. Daemon absent or `remote off` → handler returns `undefined` → normal TUI dialog. Sessions are never frozen on a dead daemon.

### Bake-in & startup

- `build/Dockerfile`: `COPY tg-bridge /usr/local/share/tg-bridge` (+ chmod +x, chown vscode) — next to the existing `COPY scripts` / `COPY library/omp-defaults` blocks
- `build/library/omp-defaults/agent/extensions/telegram-bridge.ts`: new default file → auto-seeded to `~/.omp/agent/extensions/` at next container boot (seed-omp-home.sh hash-sentinel merge picks up new files; existing user files are never overwritten)
- `.devcontainer/devcontainer.json` `postStartCommand`: append `; tmux has-session -t tgbridge 2>/dev/null || tmux new-session -d -s tgbridge 'bash /usr/local/share/tg-bridge/supervisor.sh || exec bash'` (mirrors the hindsight supervisor line)
- `supervisor.sh`: flock `daemon.lock`; if `config.json` lacks token/groupId → sleep-poll (user can configure later); else loop-restart the daemon with backoff, logging to `daemon.log`

## Files

| File | Owner | Action |
| --- | --- | --- |
| `build/tg-bridge/daemon.ts` | bridge | create |
| `build/tg-bridge/lib/telegram.ts` | bridge | create |
| `build/tg-bridge/lib/bindings.ts` | bridge | create |
| `build/tg-bridge/lib/tasks.ts` | bridge | create |
| `build/tg-bridge/lib/socket.ts` | bridge | create |
| `build/tg-bridge/lib/render.ts` | bridge | create |
| `build/tg-bridge/supervisor.sh` | bridge | create |
| `build/tg-bridge/selftest.ts` | bridge | create |
| `build/tg-bridge/tsconfig.json` | bridge | create |
| `build/library/omp-defaults/agent/extensions/telegram-bridge.ts` | bridge | create |
| `build/Dockerfile` | integration | modify (one COPY block) |
| `.devcontainer/devcontainer.json` | integration | modify (postStartCommand append) |
| `docs/telegram-bridge.md` | docs | create |
| `~/.omp/tg-bridge/*` | — | runtime state, never in the repo |

## Phases & dispatch

- **P0 — spike** (oracle, ~30 min, inline): verify assumptions against the installed build; record evidence into this plan:
  1. An extension dropped in `~/.omp/agent/extensions/` loads in a fresh `-p` session with no config change (stub extension + `session_start` log).
  2. `tool_call` on the built-in `ask` tool: does it fire, as which event variant, and does `{ block, reason }` reach the model's context?
  3. Session-file location + `omp -r <path>` resume works from a non-interactive spawn.
  4. `pi.sendUserMessage(…, { deliverAs: "steer" })` mid-turn from a socket-driven extension works in a live session.
  5. (merged into 1) a spawned `omp -p --cwd <dir>` loads the extension and streams over the socket.
- **P1 — daemon** (bridge agent, isolated): telegram client (mock `apiBase`), pairing, topics/bindings, commands, socket server, task manager, render, supervisor.sh, selftest.ts. Acceptance: self-test against the mock API passes (polling offset, pairing gate, topic routing, command dispatch, 409 handling); tsc + shellcheck clean.
- **P2 — extension** (bridge agent, parallel slot; after P0 evidence): socket client + no-op degradation, progress batching with verbosity, prompt/abort handling, ask interception with timeout (per P0 findings), `/remote` command. Acceptance: `bunx tsc --noEmit` clean; fake-daemon harness proves no-op + ask timeout.
- **P3 — bake-in + docs** (integration owner, after P1+P2): Dockerfile, devcontainer.json, docs/telegram-bridge.md.
- **P4 — E2E** (verification): real bot, in-container, full acceptance checklist.

Parallel: P1 starts with P0 (contracts fixed in this plan; P1 is independent of P0's ask findings). P2 starts after P0. Then P3 → P4 sequential.

## Acceptance

- [ ] `tg-bridge` daemon auto-starts on container start (postStartCommand), survives container restart, single instance (flock; no Telegram 409s in `daemon.log`)
- [ ] First `/pair` DM whitelists exactly one user; messages from other users are ignored everywhere
- [ ] One topic per workspace (via `/bind` or `/start`); bindings persist across container restart and omp session termination; `/replay` re-sends recent history so the thread continues
- [ ] A long-running interactive omp session in tmux streams compact progress to its topic (tool lines + final answer, 4096-safe)
- [ ] `/remote off` stops progress reporting for the workspace, persists across session restart, and restores the normal TUI `ask` dialog; `/remote on` resumes reporting; `/remote` shows status; `/remote verbosity xhigh` changes the detail level visible in the topic
- [ ] Free text to the topic while a session runs → steer (visible in the TUI transcript); while idle → new turn
- [ ] `/abort` stops the running turn; the process survives
- [ ] An `ask` call appears in the topic as an inline keyboard; a tap → model proceeds with the chosen option; 10-min timeout → model proceeds with the "no reply" note
- [ ] `/start <prompt>` launches a daemon-owned task; `/status` shows pid/elapsed/last event; `/stop` aborts+kills; `/restart` resumes the same session file; `/resume` continues the last session for the cwd
- [ ] No inbound ports: the daemon holds only outbound HTTPS to `api.telegram.org` plus the unix-socket listener (verified via `ss -tlnp` + process check)
- [ ] The extension is a no-op when the daemon is absent (session unaffected, zero overhead); it loads in every omp session (verified in two workspaces)
- [ ] `docs/telegram-bridge.md` covers bot setup, forum group setup, pairing, commands (Telegram + `/remote`), verbosity levels, security model, troubleshooting (409, offline, version drift); `knowledge_update` run

## Verification

- **Typecheck**: `bunx tsc --noEmit -p build/tg-bridge` (daemon + selftest); extension typechecked against the installed `@oh-my-pi/pi-coding-agent` dist types; `shellcheck supervisor.sh`
- **Daemon self-test**: `selftest.ts` against a local mock TG API (Bun.serve, `apiBase` override, temp state dir) — polling offset persistence, pairing gate, topic routing, command dispatch, 409 → exit 1, config_update persistence
- **Extension harness**: fake-daemon socket server — hello/progress flow, prompt→steer, ask timeout, no-op when socket absent, `/remote` state transitions
- **E2E (manual, in-container, real bot)**: acceptance checklist above; evidence recorded per item
- **Regression**: bare `omp` sessions with the daemon stopped run unaffected (no hangs, no extension errors logged)

## Risks

1. **Ask interception (P0-verified):** `ask` is NOT registered in `omp -p` sessions (`AskTool.createIf` returns null without a UI) — daemon-spawned children never ask (autonomous by design; no change needed). In interactive (TUI) sessions `ask` IS registered and its `tool_call` event fires with input `{ questions: [{ id, question, options: [{label,description?,preview?}], multi?, recommended? }] }`. The `tool_call` handler's `{ block, reason }` is returned to the model verbatim as the tool result (P0-verified on the `read` tool). P2 intercepts `ask` in interactive sessions only; the model receives the Telegram answer. `tool_call` handlers may return a Promise (async await + managed timeout).
2. **`omp update` drift** (postStartCommand updates omp on every container start): the extension degrades to a silent no-op on load failure; a version guard warns once on omp major mismatch; P4 re-verifies after the update.
3. **Telegram rate limits**: one edited message per turn, ≥1.5s intervals, batched tool lines, respect 429 `retry_after`; a single operator cannot trigger floods.
4. **Two containers, one token** → `getUpdates` 409. Documented: one daemon per bot token; flock prevents double start within a container.
5. **arm64**: daemon runs on the baked-in bun (same runtime as omp); zero npm dependencies (global fetch + `node:` builtins).
6. **Frozen interactive session during ask**: an intercepted `ask` blocks the agent loop until the Telegram answer or the 10-min timeout — intended (blocking decision), documented; the extension never blocks `ask` when the daemon is unreachable or the workspace is disabled. P0-confirmed the block+reason path returns to the model.

## Non-goals

- WhatsApp/Signal support (Telegram only this iteration; the provider layer is isolated for a future swap)
- Web dashboard / mini-app
- Inbound webhooks / tunnels / port forwarding
- Multi-user collaboration (single operator; whitelist is one user)
- Graphical visualizations (text only, by design)

## P0 Evidence

**P0 (2026-09-06, oracle spike, omp v18.1.11; full evidence in /tmp/tg-spike/report.md):**
- **(1) CONFIRMED** extension auto-discovery from `~/.omp/agent/extensions/` in `omp -p` sessions, no config change; socket streaming hello→turn_start→(hb)→turn_end→bye via `ctx.setInterval` works.
- **(2) FAILED for `-p`, mechanism CONFIRMED**: `ask` absent in headless mode (not a design problem — daemon children are autonomous); `tool_call` block+reason confirmed verbatim on built-ins; reasons must be phrased as factual answers.
- **(3) CONFIRMED** session files at `~/.omp/agent/sessions/<dashed-cwd>/<ISO-ts>_<uuid7>.jsonl`; `omp -p -r <path>` resumes with live prior context.
- **(4) CONFIRMED** `pi.sendUserMessage(text, { deliverAs: "steer" })` mid-turn from a socket-driven extension works first try; managed timers only.
- **Design adjustments applied:** daemon children = autonomous (no ask); interactive sessions get ask→Telegram; factual reason phrasing; discover newest session via `ls -t`; one socket conn per child, daemon tolerates ECONNREFUSED.
