# Telegram Bridge

Control long-running `omp` sessions from a phone over Telegram. No inbound ports — the daemon polls Telegram's Bot API over outbound HTTPS only, so the rig stays on a private network with nothing exposed.

One **forum group** acts as the control surface. Each topic in the group is bound to a workspace (`/bind <cwd>`), so multiple repositories get separate, persistent threads that survive container restarts and `omp` session termination.

## Architecture

```
Phone (Telegram) ──HTTPS──▶ Telegram Bot API ──(long poll)──▶ tg-bridge daemon
                                                                       │
                                                                Unix socket
                                                                (~/.omp/tg-bridge/sock)
                                                                       │
                                                                omp extension
                                                                (in-process, per session)
```

- **Daemon** (`/usr/local/share/tg-bridge/daemon.ts`): runs continuously in a tmux session (`tgbridge`), started by `postStartCommand`. Polls `getUpdates`, routes messages by topic, manages sessions, and owns the Unix socket. Single-instance via `flock` on `~/.omp/tg-bridge/daemon.lock`.
- **Extension** (`~/.omp/agent/extensions/telegram-bridge.ts`): auto-loaded in every `omp` session. Connects to the socket, streams compact progress to its bound topic, and intercepts `ask` prompts to forward them to Telegram. Silently no-ops when the daemon is absent.

## Setup

One-time pairing (per bot + group):

1. Create a bot with `@BotFather` and copy the token (`123456:ABC-...`).
2. Create a **forum group** (supergroup with topics) and add the bot as a member.
3. Get the group's `chat.id`: add a group-info bot (e.g. `@getidsbot`) to the group and ask for the chat ID. Forum group IDs are long negative numbers, e.g. `-1001234567890`.
4. Pair from any live `omp` session:
   - `/remote pair` — interactive wizard: prompts for the token → validates locally via `getMe` (no daemon required — fresh installs work) → prompts for the group ID → validates via `getChat` → writes the config → enables the bridge.
   - `/remote pair <token> <groupId>` — non-interactive one-liner; same local validation.
5. In Telegram: DM the bot `/pair` (the first DM is auto-whitelisted when `allowedUserIds` is empty), then run `/bind <workspace-path>` in a topic and `/remote on` in the session.

The wizard writes `~/.omp/tg-bridge/config.json` (mode `0600`, existing keys preserved). A supervisor sitting in `wait_for_config` unblocks within ~5 s and starts the daemon; a running daemon receives `config_reload` and hot-swaps.

### Manual config

Alternatively write `~/.omp/tg-bridge/config.json` by hand:

```json
{
  "botToken": "123456:ABC-...",
  "groupId": -1001234567890,
  "allowedUserIds": [],
  "editIntervalMs": 1500,
  "apiBase": "https://api.telegram.org"
}
```

- `botToken` — required, non-empty.
- `groupId` — required, the group's `chat.id`, **negative**.
- `allowedUserIds` — optional whitelist of Telegram user IDs (empty = auto-pair the first DM).
- `editIntervalMs` — optional Telegram message-edit throttle (default `1500`).
- `apiBase` — optional; defaults to `https://api.telegram.org` (the `TG_BRIDGE_API_BASE` env var takes precedence).
- `summaryEvery` — optional summary cadence in turns (default `8`); the daemon also forwards it to the extension in the `config` frame.

The supervisor requires `botToken` plus a negative `groupId` before it starts the daemon. After editing the file by hand, reload with `kill -HUP $(pgrep -f tg-bridge/supervisor.sh)`.

## Session-driven design

Unlike the earlier task-centric model, the bridge is now **session-driven**:

- The daemon does **not** manage task lifecycle (`/start`, `/stop`, `/restart`, `/resume` are removed).
- The daemon long-polls continuously — even with no active sessions, so bootstrap commands (`/bind`, DM `/pair`) and the `409` conflict check always work. `remoteOn: false` (off-by-default) gates only *outbound* behaviour: progress is not forwarded and free text is not delivered to a session until it is `true`.
- Free text to a topic is routed to the most recently active session for that cwd (steer if running, else new turn).
- The `/remote` slash command in-session toggles `remoteOn` and sets verbosity.

## Message rendering: per-turn isolation, HTML, ack

Progress is rendered with Telegram's **HTML parse mode**. Formatting is owned by the extension (it emits HTML for message text, code, and bold); the daemon escapes question titles/options it renders itself.

- **Per-turn isolation.** Each turn gets its own live message. The daemon tracks the active turn per topic from the immediate `turn_start`/`turn_end` progress frames; lines only ever edit the active turn's message, and `turn_end` finalizes it (flush + release the handle). A finished turn is never re-edited, so old-turn content is never repeated and two turns never share a message. Overflow beyond the 4096-char Telegram limit is split by `splitHtmlAware` into tag-balanced chunks; overflow messages are edited in place on later flushes (never re-sent).
- **No turn framing.** Turns no longer emit `🛫`/`🛬` lines at any verbosity level; `turn_start`/`turn_end` frames are wire-only — the daemon uses them to drive the typing indicator and to finalize the turn's live message.
- **Typing indicator.** While a turn is live for a bound topic with `remoteOn`, the daemon sends a `typing` chat action to the topic immediately and every 4 s until the turn ends (or the session goes idle/off).
- **Empty-message suppression.** Whitespace-only turns create no Telegram message: `publishTurn` keeps an in-memory handle but sends nothing until real content arrives, and flushes whose accumulated text is whitespace-only are skipped.
- **Unchanged-text edit skip.** A flush whose text equals the message's last successfully sent text is skipped, eliminating `message is not modified` (400) spam from identical finalize edits.
- **Single session per workspace.** If two extension streams `hello` for the same cwd (two `omp` sessions on the same repo), the newer one wins: the daemon logs `evicting stale session` and destroys the older socket, so progress and free text never split across two streams.
- **HTML chunking.** `splitHtmlAware` splits at line boundaries, closes/reopens open `<pre>`/`<code>`/`<b>` tags at chunk edges, and hard-splits overly long lines backing off into partial tags. A failed `editMessageText` (e.g. unparseable entities) falls back to resending the full text as fresh messages.
- **Errors with context.** Tool errors arrive as a dedicated `error` frame (`{ toolName, text }` — first line of the result, truncated at 200 chars) and render at **all** verbosity levels as `⚠️ <tool>: <text>`.
- **Side questions (`/btw`).** A message starting with `/btw <question>` is answered immediately by a one-shot AI call in the extension (`completeSimple` from `@oh-my-pi/pi-ai`, same path as the summary) and posted as a `💬` message — it never steers the running turn. Free text ending in `??` behaves normally (steer/new) except the next turn's final answer is delivered regardless of verbosity.
- **Received ack.** When free text is routed to a session, the daemon replies `🎯 Got it — steering the running turn.` or `🎯 Got it — starting on it.` (plain text); delivery failure gets an explicit error message.
- **Questions.** `ask` interception and `/ask` publish the title + options with an inline keyboard (`parse_mode: HTML`); tapping an option routes an `answer` frame back to the live session.

## Socket protocol v2

JSONL, one frame per line. Changes from v1: `enabled` → `remoteOn`, task frames removed, `config_set` replaces `config_update`, new `daemon_status` response.

| dir | frame | payload |
| --- | --- | --- |
| ext→daemon | `progress` | `{ kind: turn_start\|turn_end, data: "<turnIndex>" }` — sent **immediately, unbatched**; the daemon uses these for the typing indicator and turn finalization. `{ kind: message, data: "<rendered HTML>", turnIndex }` — flushed from the 1.5 s batch (at `mid`, the turn's final assistant answer only). `{ kind: tool\|todo\|agent_start\|agent_end, data }` batched the same way. `{ kind: error, data: { toolName, text } }` — dedicated tool-error frame (all levels). `{ kind: todo_state, data: { todos: [{ content, status }] } }` — cached by the daemon for `/status`; not rendered. `{ kind: summary, data: { text, source: "ai"\|"digest" } }` — rendered as a standalone `📊` message. `{ kind: btw, data: { text } }` — side-question answer (from `/btw`), rendered as a standalone `💬` message. |
| ext→daemon | `config_set` | `{ topicId, remoteOn?, verbosity? }` |
| ext→daemon | `config_update` | `{ cwd, remoteOn?, verbosity? }` |
| ext→daemon | `config_reload` | — |
| ext→daemon | `status_request` | — |
| ext→daemon | `pair` | `{ token, groupId? }` (control; writes `config.json`, validates via `getMe`/`getChat`) |
| ext→daemon | `pair_validate` | `{ token }` (control; `getMe` only) |
| ext→daemon | `pair_validate_group` | `{ token, groupId }` (control; `getMe` + `getChat`) |
| daemon→ext | `prompt` | `{ text, deliverAs: steer\|followUp\|new }` |
| daemon→ext | `abort` | — |
| daemon→ext | `answer` | `{ id, value }` |
| daemon→ext | `config` | `{ enabled, verbosity, summaryEvery }` (sent on `hello` and after `config_update`; `summaryEvery` defaults to `8`) |
| daemon→ext | `daemon_status` | `{ sessions, activeSessions }` (activeSessions = sessions with `remoteOn`) |
| daemon→ext | `pair_done` | `{ success }` (pair-wizard token/group validation result) |

Routing: `hello.cwd` → binding → topic. Free text in a topic goes to the most recently active session for that cwd. Frames without `cwd` (`config_set`, `config_reload`, `pair*`) are control frames routed to the daemon regardless of the sending stream's session — even on a socket that already sent `hello`.

## Commands

All commands are typed **inside the bound topic**. Free text (non-command) steers the running session or starts a new turn when idle.

| Command | Effect |
| `/status` | Workspace + remote on/off + verbosity, live session (turn live/idle) with last-event age and top-5 todos (cached from `todo_state`; "last-known todos" when the session is gone), active-session count |
| `/btw <question>` | Side question, answered immediately by a one-shot AI call in the session (does not steer the running turn); answer posts as a `💬` message |
| `/abort` | Abort the current turn (process keeps running) |
| `/bind <cwd>` | Bind this topic to a workspace (absolute path) |
| `/replay [N]` | Resend the last N progress entries (default 10, max 100) |
| `/ask <question>` | Pose a free-form question with inline buttons |
| `/help` | Show this list |
| `/pair` / `/unpair` | DM pairing (admin only) |

### `/remote` (in-session)

Available inside any live `omp` session (TUI). No daemon required. The TUI autocompletes `/remote` subcommands (`status`, `on`, `off`, `verbosity`, `pair`, `help`) and the `verbosity` level argument.

```
/remote              # status: remoteOn, verbosity, daemon connection
/remote on           # enable progress streaming for this session
/remote off          # disable
/remote verbosity low|mid|high|xhigh   # set verbosity (medium = mid)
/remote pair            # interactive pairing wizard (local getMe/getChat, no daemon needed)
/remote pair <token> <groupId>   # non-interactive pairing; writes config, enables bridge
```

## Pairing

Two distinct steps — in-session pairing sets up the bridge; Telegram DM pairing whitelists you:

1. **In session:** `/remote pair` (or `/remote pair <token> <groupId>`). The wizard validates the token with a local `getMe` and the group with `getChat` directly against the Bot API — no daemon round-trip, so it works on a fresh install where no daemon is running yet. On success it writes `~/.omp/tg-bridge/config.json` (mode `0600`, existing keys preserved) and enables the bridge; a waiting supervisor picks the config up within ~5 s, and a running daemon hot-swaps via `config_reload`.
2. **In Telegram:** DM the bot `/pair`. The first DM is whitelisted (auto-pair: if `allowedUserIds` is empty, the sender is added).
3. All other users are ignored everywhere (group, DM, socket). Revoke with `/unpair` (DM).

## Verbosity levels

Controls how much progress reaches Telegram per turn. Progress text is HTML-formatted by the extension (code fences → `<pre><code>`, inline code → `<code>`, `**bold**` → `<b>`); the daemon chunks long output via `splitHtmlAware` (tag-balanced at the 4096-char Telegram limit) and batches flushes every 1.5 s.

| Level | Content |
| --- | --- |
| `low` | Tool errors only (`⚠️ <tool>: <first line>`) |
| `mid` | (default) + the turn's final assistant answer (not per-message) + the periodic `📊` summary (every `summaryEvery` turns or a long turn) |
| `high` | + per-message assistant text + tool one-liners (🔧 read, edit, bash, grep…) + todo reminders |
| `xhigh` | + agent start/end + all events |

## Security model

- **No inbound ports.** The daemon only opens outbound HTTPS to `api.telegram.org`. The Unix socket is filesystem-local (`~/.omp/tg-bridge/sock`, `0700`), so no network exposure.
- **Whitelist gate.** After `/pair`, every Telegram message is checked against the whitelisted `user.id`. Unknown users are dropped at the poll layer — never routed to a topic or socket.
- **Token isolation.** The bot token lives only in `config.json` (never in the repo). One daemon per token: a second container with the same token will get a `409` from `getUpdates` and exit.
- **No secrets in logs.** The daemon logs to `~/.omp/tg-bridge/daemon.log` (rotated at 1 MB); the token is never printed.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `409 Conflict` in `daemon.log` | Two daemons polling with the same token | One daemon per bot token. `flock` prevents double-start within a container; check another container isn't running the same token. |
| Daemon not starting | `config.json` missing or lacks `botToken`/`groupId` | Write `~/.omp/tg-bridge/config.json` (see Setup). The supervisor waits indefinitely, polling every 5 s. |
| No progress in topic | Extension not connected to socket | Run `/remote` in the session — `daemon connected: yes/no`. Check `ls -la ~/.omp/tg-bridge/sock`. |
| `ask` question times out | No reply within 10 min (configurable via `TG_BRIDGE_ASK_TIMEOUT_MS`) | The agent proceeds with its best judgement and notes the assumption. Answer faster, or raise the timeout. |
| Extension silently no-ops | Daemon absent or omp version drift | Expected behaviour — the extension degrades gracefully. Check `tmux ls` for the `tgbridge` session; check `daemon.log`. |
| Free text not reaching session | Topic not bound | Run `/bind <absolute-path>` in the topic first. |

## State

| Path | Purpose |
| --- | --- |
| `~/.omp/tg-bridge/config.json` | Bot token + group ID (user-managed) |
| `~/.omp/tg-bridge/sock` | Unix socket (daemon ↔ extension) |
| `~/.omp/tg-bridge/daemon.log` | Daemon log (rotated at 1 MB) |
| `~/.omp/tg-bridge/daemon.lock` | `flock` single-instance lock |
| `~/.omp/tg-bridge/bindings.json` | Topic → workspace bindings (persists across restarts) |
| `~/.omp/tg-bridge/replay/` | Recent progress entries for `/replay` |
| `~/.omp/tg-bridge/offset.json` | Last Telegram poll offset (persists across restarts) |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TG_BRIDGE_STATE_DIR` | `~/.omp/tg-bridge` | State directory |
| `TG_BRIDGE_SOCK` | `$STATE_DIR/sock` | Unix socket path |
| `TG_BRIDGE_OMP_BIN` | `/usr/local/bin/omp` | `omp` binary path |
| `TG_BRIDGE_API_BASE` | `https://api.telegram.org` | Telegram API base (override for self-hosted mirrors) |
| `TG_BRIDGE_ASK_TIMEOUT_MS` | `600000` (10 min) | Ask-interception timeout |

## Supervisor behavior

The supervisor (`supervisor.sh`) manages daemon lifecycle:

- **Infinite config wait.** No timeout — polls for `config.json` presence every 5 s.
- **SIGHUP triggers.** On `SIGHUP`, checks config.json mtime; if changed, restarts the daemon hot (no sleep).
- **Orphan kill.** On startup, kills stale `bun daemon.ts` processes from prior runs.
- **Linear backoff.** Restart loop uses linear backoff (1 s, 2 s, 3 s, … capped at 30 s max).
- **Single-instance.** `flock` on `daemon.lock` prevents concurrent daemon instances.
- **Graceful shutdown.** `SIGTERM` terminates the daemon and exits cleanly.

## Self-test

```bash
cd build/tg-bridge && bun selftest.ts
```

Exercises the full daemon path against a local mock Telegram API (no network, no token needed; 19 tests): polling offset persistence, whitelist gate, topic binding, free-text routing, `ask` → inline keyboard → callback → answer, off-by-default free text gate, `config_set`, `config_reload`, auto-pair, `status_request`, `409` → exit 1, `pair_validate_group` (real `getChat` success/failure round-trip), stale-socket replacement (a leftover non-socket `sock` file is replaced by the daemon's fresh listener), **per-turn message isolation** (each turn's lines land in its own Telegram message — a finalized turn's content is edited into its own message, never mixed with a later turn's lines, and every rendered send/edit uses `parse_mode: HTML`), **stale same-cwd session eviction** (a second `hello` for the same cwd destroys the older socket and logs `evicting stale session`), **no duplicate frames after eviction** (messages from the evicted socket's stream produce no Telegram sends/edits), **unchanged-text edit skip** (a flush whose text equals the last sent text performs zero `editMessageText` calls and zero `message is not modified` log entries), and **empty-turn suppression** (a whitespace-only turn renders nothing; a following turn renders exactly its real content).
