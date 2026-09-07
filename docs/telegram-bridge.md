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

- **Daemon** (`/usr/local/share/tg-bridge/daemon.ts`): runs continuously in a tmux session (`tgbridge`), started by `postStartCommand`. Polls `getUpdates`, routes messages by topic, spawns `omp -p --cwd <dir>` children, and owns the Unix socket. Single-instance via `flock` on `~/.omp/tg-bridge/daemon.lock`.
- **Extension** (`~/.omp/agent/extensions/telegram-bridge.ts`): auto-loaded in every `omp` session. Connects to the socket, streams compact progress to its bound topic, and intercepts `ask` prompts to forward them to Telegram. Silently no-ops when the daemon is absent (zero overhead, no session impact).

## Setup

### 1. Create a Telegram bot

1. DM [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Enable privacy mode OFF: `/setprivacy` → `Disable` (required for the bot to read free-text in a group).

### 2. Create a forum group

1. Create a new group (or add the bot to an existing one).
2. **Convert to a forum**: Group settings → *Topics* → *Turn on Topics*.
3. The group's `chat.id` is a **negative** number (e.g. `-1001234567890`). Get it by adding the bot, sending any message, then:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[] | .message.chat.id' | head -1
   ```

### 3. Configure the daemon

Write `~/.omp/tg-bridge/config.json`:

```json
{
  "botToken": "123456:ABC-your-token-here",
  "groupId": -1001234567890
}
```

The supervisor waits up to 150 s for this file to appear, then starts the daemon. No token in the file? The daemon exits; the supervisor retries with backoff.

### 4. Pair (DM the bot)

DM the bot `/pair`. The first DM pair is whitelisted. All other users are ignored everywhere (group, DM, socket). Revoke with `/unpair` (DM).

## Commands

All commands are typed **inside the bound topic**. Free text (non-command) steers the running session or starts a new turn when idle.

| Command | Effect |
| --- | --- |
| `/start <prompt>` | Spawn an autonomous `omp -p` task in this workspace |
| `/stop` | Abort + kill the running task |
| `/restart [prompt]` | Kill + resume the last session (fresh process) |
| `/resume` | Resume the last session (fresh process) |
| `/status` | Daemon + task + socket status |
| `/abort` | Abort the current turn (process keeps running) |
| `/bind <cwd>` | Bind this topic to a workspace (absolute path) |
| `/replay [N]` | Resend the last N progress entries (default 10, max 100) |
| `/ask <question>` | Pose a free-form question with inline buttons |
| `/help` | Show this list |
| `/pair` / `/unpair` | DM pairing (admin only) |

### `/remote` (in-session)

Available inside any live `omp` session (TUI). No daemon required.

```
/remote              # status: enabled, verbosity, daemon connection
/remote on           # enable progress streaming for this session
/remote off          # disable
/remote verbosity low|mid|high|xhigh   # set verbosity (medium = mid)
```

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
| Daemon not starting | `config.json` missing or lacks `botToken`/`groupId` | Write `~/.omp/tg-bridge/config.json` (see Setup). The supervisor retries every second for up to 150 s. |
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

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TG_BRIDGE_STATE_DIR` | `~/.omp/tg-bridge` | State directory |
| `TG_BRIDGE_SOCK` | `$STATE_DIR/sock` | Unix socket path |
| `TG_BRIDGE_OMP_BIN` | `/usr/local/bin/omp` | `omp` binary path |
| `TG_BRIDGE_API_BASE` | `https://api.telegram.org` | Telegram API base (override for self-hosted mirrors) |
| `TG_BRIDGE_ASK_TIMEOUT_MS` | `600000` (10 min) | Ask-interception timeout |

## Self-test

```bash
cd build/tg-bridge && bun selftest.ts
```

Exercises the full daemon path against a local mock Telegram API (no network, no token needed): polling offset persistence, whitelist gate, topic binding, free-text routing, `ask` → inline keyboard → callback → answer, `config_update` persistence, and `409` → exit 1.
