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

## Session-driven design

Unlike the earlier task-centric model, the bridge is now **session-driven**:

- The daemon does **not** manage task lifecycle (`/start`, `/stop`, `/restart`, `/resume` are removed).
- The daemon long-polls continuously — even with no active sessions, so bootstrap commands (`/bind`, DM `/pair`) and the `409` conflict check always work. `remoteOn: false` (off-by-default) gates only *outbound* behaviour: progress is not forwarded and free text is not delivered to a session until it is `true`.
- Free text to a topic is routed to the most recently active session for that cwd (steer if running, else new turn).
- The `/remote` slash command in-session toggles `remoteOn` and sets verbosity.

## Socket protocol v2

JSONL, one frame per line. Changes from v1: `enabled` → `remoteOn`, task frames removed, `config_set` replaces `config_update`, new `daemon_status` response.

| dir | frame | payload |
| --- | --- | --- |
| ext→daemon | `hello` | `{ cwd, sessionId, sessionFile, ompVersion, pid }` |
| ext→daemon | `progress` | `{ kind: turn_start\|turn_end\|tool\|message\|todo\|error\|agent_start\|agent_end, data }` |
| ext→daemon | `question` | `{ id, kind: select\|confirm\|input, title, options?, default? }` |
| ext→daemon | `bye` | — |
| ext→daemon | `config_set` | `{ topicId, remoteOn?, verbosity? }` |
| ext→daemon | `config_update` | `{ cwd, remoteOn?, verbosity? }` |
| ext→daemon | `config_reload` | — |
| ext→daemon | `status_request` | — |
| daemon→ext | `prompt` | `{ text, deliverAs: steer\|followUp\|new }` |
| daemon→ext | `abort` | — |
| daemon→ext | `answer` | `{ id, value }` |
| daemon→ext | `config` | `{ enabled, verbosity }` |
| daemon→ext | `daemon_status` | `{ sessions, activeSessions }` (activeSessions = sessions with `remoteOn`) |
| daemon→ext | `pair_done` | `{ success }` (pair-wizard token/group validation result) |

Routing: `hello.cwd` → binding → topic. Free text in a topic goes to the most recently active session for that cwd.

## Commands

All commands are typed **inside the bound topic**. Free text (non-command) steers the running session or starts a new turn when idle.

| Command | Effect |
| --- | --- |
| `/status` | Daemon + socket status |
| `/abort` | Abort the current turn (process keeps running) |
| `/bind <cwd>` | Bind this topic to a workspace (absolute path) |
| `/replay [N]` | Resend the last N progress entries (default 10, max 100) |
| `/ask <question>` | Pose a free-form question with inline buttons |
| `/help` | Show this list |
| `/pair` / `/unpair` | DM pairing (admin only) |

### `/remote` (in-session)

Available inside any live `omp` session (TUI). No daemon required.

```
/remote              # status: remoteOn, verbosity, daemon connection
/remote on           # enable progress streaming for this session
/remote off          # disable
/remote verbosity low|mid|high|xhigh   # set verbosity (medium = mid)
```

## Pairing wizard flow

1. DM the bot `/pair`. The first DM pair is whitelisted (auto-pair: if `allowedUserIds` is empty, the sender is added).
2. All other users are ignored everywhere (group, DM, socket).
3. Revoke with `/unpair` (DM).

## Verbosity levels

Controls how much progress reaches Telegram per turn. All levels keep messages under 4096 chars (Telegram limit); batching flushes every 1.5 s.

| Level | Content |
| --- | --- |
| `low` | Turn start/end + final answer only |
| `mid` | (default) + tool one-liners (read, edit, bash, grep…) |
| `high` | + message-end summaries + todo reminders |
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

Exercises the full daemon path against a local mock Telegram API (no network, no token needed): polling offset persistence, whitelist gate, topic binding, free-text routing, `ask` → inline keyboard → callback → answer, off-by-default free text gate, `config_set`, `config_reload`, auto-pair, `status_request`, and `409` → exit 1.
