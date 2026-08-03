# omp-devcontainer-base

A reusable devcontainer base image for the [oh-my-pi](https://omp.sh/) (`omp`/`pi`) AI coding harness. Bundles a full .NET 10/Aspire + SvelteKit + Python toolchain, a self-healing Hindsight memory server, 5 community plugins, and a workspace bootstrap script — all in one image that works with **any** repository you mount into it.

## What This Is

This devcontainer is **workspace-independent**. The same image works across any project you clone and mount. Configuration lives at the user level (`~/.omp/`), persisted across rebuilds via named Docker volumes. Stack-specific tools (Aspire MCP, shadcn, Puppeteer) are activated only when you run the bootstrap script against a detected or declared stack.

Contrast with a per-project devcontainer: those bake project-specific dependencies into the image and break when you switch repos. This image doesn't.

## Quick Start

### Opening in VS Code

1. Install the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension
2. Clone this repo (or copy `.devcontainer/` into your own repo)
3. Open the folder in VS Code → press `F1` → **Dev Containers: Reopen in Container**

### Opening via CLI

```bash
# Install the devcontainer CLI once: npm install -g @devcontainers/cli
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . -- zsh
```

### Adding to an existing repo

Copy `.devcontainer/` into your repo root, then open in VS Code. Volume names use the `omp-devcontainer-base-` prefix and are shared across all repos using this base image — your auth, history, and omp config survive across projects.

## Bootstrapping a Workspace

After the container starts, run `bootstrap.sh` to configure omp for your project:

### Existing repository

```bash
bash scripts/bootstrap.sh existing-repo
# or with an explicit stack preset:
bash scripts/bootstrap.sh existing-repo --stack dotnet-aspire-svelte
```

Creates: `.omp/config.yml`, `.omp/mcp.json`, `.omo/drafts/`, `.omo/plans/`, `AGENTS.md` (omp context file), and copies profile skills to `.omp/skills/`. **Never** creates `src/`, `tests/`, or `docs/` — those are your project's concern.

Supported presets: `dotnet-aspire-svelte` | `dotnet-only` | `svelte-only` | `generic`

### New project

```bash
bash scripts/bootstrap.sh new-project --stack dotnet-aspire-svelte
```

Same as existing-repo, **plus** scaffolds the folder skeleton:

| Preset | Scaffolded paths |
|--------|-----------------|
| `dotnet-aspire-svelte` | `src/App.AppHost/`, `src/App.Web/`, `src/App.ServiceDefaults/`, `tests/App.Tests.Unit/`, `tests/App.Tests.E2E/`, `src/frontend/`, `docs/` |
| `dotnet-only` | `src/App.AppHost/`, `src/App.Web/`, `src/App.ServiceDefaults/`, `tests/App.Tests.Unit/`, `docs/` |
| `svelte-only` | `src/`, `tests/`, `docs/` |
| `generic` | `src/`, `tests/`, `docs/` |

## Connecting Local LLM Endpoints

Two local model endpoints are pre-configured as placeholders. Edit the 3 `__FILL_*__` values per alias — no other files change:

```yaml
# Live file inside container: ~/.omp/agent/models.yml
# Source template: image/omp-defaults/agent/models.yml

models:
  nemotron-super-120b:
    baseUrl: "http://host.docker.internal:__FILL_NEMOTRON_PORT__/v1"
    apiKey:  "__FILL_API_KEY_OR_NONE__"
    model:   "__FILL_NEMOTRON_MODEL_ID__"
    concurrency: 4          # runs 4 parallel jobs

  qwen-4b-instruct:
    baseUrl: "http://host.docker.internal:__FILL_QWEN_PORT__/v1"
    apiKey:  "__FILL_API_KEY_OR_NONE__"
    model:   "__FILL_QWEN_MODEL_ID__"
    concurrency: 16         # runs 16 parallel jobs
```

**Swap procedure** (takes ~30 seconds):
1. Open `~/.omp/agent/models.yml` inside the container
2. Replace all 6 `__FILL_*__` placeholders (3 per alias × 2 aliases)
3. Restart omp — changes take effect immediately

`host.docker.internal` resolves to your host machine from inside the container.

## Running omp

```bash
omp           # interactive TUI
omp --plan    # plan-only mode (no code edits)
```

`oc` is aliased to `omp` in zsh for convenience.

## Monitoring Hindsight

Hindsight provides cross-session memory and is auto-started via a supervised background loop on every container boot.

```bash
# Check health
curl -sf http://localhost:8888/health && echo "Hindsight OK"

# View logs
cat ~/.hindsight/hindsight.log

# Check if the supervisor is running
ps aux | grep hindsight-supervisor | grep -v grep
```

Key paths:
- **Logs**: `~/.hindsight/hindsight.log`
- **Supervisor lock**: `~/.hindsight/supervisor.lock` (prevents duplicate loops)
- **Data**: `~/.hindsight/pgdata/` (persisted via named volume across rebuilds)

Fallback: change `memory.backend` in `~/.omp/agent/config.yml` from `hindsight` to `mnemopi` for lightweight SQLite mode.

## Persistence

All user state survives container restarts **and** full image rebuilds via named Docker volumes:

| Volume | Mounted at | Contents |
|--------|-----------|---------|
| `omp-devcontainer-base-omp-home` | `~/.omp` | omp config, sessions, installed plugins |
| `omp-devcontainer-base-hindsight-data` | `~/.hindsight` | Hindsight Postgres data + logs |
| `omp-devcontainer-base-ssh` | `~/.ssh` | SSH keys |
| `omp-devcontainer-base-gh-config` | `~/.config/gh` | GitHub CLI auth |
| `omp-devcontainer-base-persisted-git` | `~/.persisted-git` | gitconfig (symlinked → `~/.gitconfig`) |
| `omp-devcontainer-base-zsh-history` | `~/.zsh_history_vol` | Shell history |
| `omp-devcontainer-base-pnpm-store` | `~/.local/share/pnpm` | pnpm global package cache |
| `omp-devcontainer-base-nuget` | `~/.nuget/packages` | NuGet package cache |
| `omp-devcontainer-base-uv-cache` | `~/.cache/uv` | Python/uv package cache |

> **Note:** Docker-in-Docker inner state (`/var/lib/docker`) is intentionally **not** persisted — it is derived cache state and rebuilds automatically. This is by design.

## Troubleshooting

### Hindsight not starting

```bash
# Check the supervisor log
cat ~/.hindsight/hindsight.log

# Check if another supervisor loop is holding the lock
ls -la ~/.hindsight/supervisor.lock

# Force a restart (container's PID namespace clears stale locks on restart)
bash .devcontainer/scripts/hindsight-supervisor.sh &
```

### Plugin install failures

Plugins are installed with an idempotency sentinel. Delete it to force a clean reinstall:

```bash
rm ~/.omp/.plugins-installed-v1
bash .devcontainer/scripts/install-omp-plugins.sh
```

Check npm registry reachability if the reinstall also fails:

```bash
curl -sf https://registry.npmjs.org/pi-atelier > /dev/null && echo "npm OK"
```

### Config seeding didn't happen

```bash
# Check whether seeding ran
ls ~/.omp/.seeded-v1

# If missing, re-run seeding (safe — checks sentinel before acting)
bash .devcontainer/scripts/seed-omp-home.sh
```

### Resetting to image defaults

```bash
# WARNING: destroys all user edits to ~/.omp/agent/
rm ~/.omp/.seeded-v1
bash .devcontainer/scripts/seed-omp-home.sh
```
