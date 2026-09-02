# tmux

The container ships a preconfigured tmux (`~/.tmux.conf` is baked into the image). Setup and onboarding are in [getting-started.md](getting-started.md).

## Why tmux

- Persistent shell state across VS Code terminal restarts — a new integrated terminal is always a fresh shell; tmux sessions survive
- It hosts the self-healing Hindsight memory supervisor (the `hindsight` session, below)
- It is the safe place to run long-lived dev servers alongside `omp` without their output corrupting the TUI

## Prefix & General

- Prefix is `C-Space` (`C-b` is unbound)
- `escape-time 0` — no ESC delay in key sequences
- Mouse on — click to select panes, scroll history with the wheel, drag pane borders to resize
- Status bar on top, refreshed every 5 seconds
- `history-limit 100000` lines of scrollback per pane
- Default shell: zsh
- Windows and panes are numbered starting at 1, with `renumber-windows on` (no gaps after a kill)

## Key Bindings

Prefix bindings exactly as baked into `~/.tmux.conf`:

| Key (after prefix) | Action |
|--------------------|--------|
| `r` | Reload `~/.tmux.conf` |
| `+` | Split pane horizontally |
| `-` | Split pane vertically |
| `Left` / `Down` / `Up` / `Right` | Move pane selection left / down / up / right |
| `c` | New window |
| `x` | Kill window |
| `R` | Rename window (prompts, pre-filled with the current name) |
| `C-Left` | Previous window |
| `C-Right` | Next window |

## The `hindsight` Session

The `hindsight` tmux session is auto-started by the devcontainer `postStartCommand`:

```bash
tmux has-session -t hindsight 2>/dev/null || tmux new-session -d -s hindsight 'bash /usr/local/share/omp-scripts/hindsight-supervisor.sh || exec bash'
```

The supervisor inside it:

- Health-checks `http://localhost:8888/health` every 15 seconds
- Starts Hindsight when absent (launched with `nohup`, so the server outlives the tmux session and gets re-adopted)
- Restarts it if it stays unhealthy for more than 180 seconds
- Enforces a single instance via `flock` on `~/.hindsight/supervisor.lock`

Commands:

```bash
tmux ls                       # list sessions (the hindsight session should appear)
tmux attach -t hindsight      # watch the supervisor run
```

Log file: `~/.hindsight/hindsight.log` (size-rotated at 10 MiB).

Note: `tmux kill-session -t hindsight` stops only the supervisor; the nohup'd server keeps running, and a running supervisor restarts the server if it dies.

## Backgrounding Commands Safely

`bgrun <command>` is a zsh function baked into the image's `~/.zshrc`:

- Redirects stdout+stderr to `/tmp/bgrun-<pid>.log`
- Disowns the job and prints `Background: PID=<pid> log=<path>`

It is the only safe way to background a long-running command in a terminal shared with TUI apps — the shell sets `NO_MONITOR`, `BG_NICE`, and `NO_CHECK_JOBS` so job notifications never leak into the TUI, but a bare `&` still lets raw output through and corrupts the screen.

```bash
bgrun dotnet run --project src/App.AppHost
tail -f /tmp/bgrun-*.log
```

## VS Code Notes

- Every new integrated terminal is a fresh shell with no persistent state — keep long-lived work inside tmux sessions
- `terminal.integrated.gpuAcceleration` is already set to `off` in the devcontainer settings (TUI rendering safety)
