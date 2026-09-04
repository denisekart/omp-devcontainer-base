# Getting Started

Consumer onboarding for the prebuilt `omp-devcontainer-base` image. This is the only doc a new user needs — the whole setup is: copy one template file into your repo, reopen it in a container, point models at your LLM endpoint, and run `omp`.

## What You Get

- **.NET 10 SDK** — Aspire workload, `dotnet-ef`, `Aspire.Cli` (prerelease), and `csharp-ls` installed as global dotnet tools
- **Node 24 LTS + Bun** — global npm packages: `typescript`, `pnpm`, `typescript-language-server`, `svelte-language-server`, `vscode-langservers-extracted`, `bash-language-server`
- **Python 3 + `uv`** — `python-lsp-server`, `mcp-server-docker`, `mcp-server-fetch`, `mcp-server-git`, `mcp-server-time` installed as uv tools
- **`omp` / `pi`** — the latest `@oh-my-pi/pi-coding-agent` installed via bun; `pi` is a symlink to `omp`; `oc` is a zsh alias for `omp`
- **Hindsight memory server** — port 8888, kept alive by a self-healing supervisor running in a tmux session
- **tmux** — preconfigured with a `C-Space` prefix and agent-friendly bindings (see [tmux.md](tmux.md))
- **Docker-in-Docker** — non-root docker client and server inside the container
- **15 preinstalled VS Code extensions** — C#/.NET, Svelte, Prettier, ESLint, Python, Tailwind CSS, Docker, PRs, GitLens, and more
- **Shell quality of life** — zsh default shell, starship prompt, zoxide, bat, eza, fzf, ripgrep, git-delta, yq, shfmt

## Prerequisites

- Docker (the image is prebuilt for both `linux/amd64` and `linux/arm64` — no build step required)
- VS Code with the Dev Containers extension
- A reachable OpenAI-compatible (e.g. LiteLLM) model endpoint. The image's default `baseUrl` is the image author's host — you must configure your own endpoint (section 5)

## Setup in Your Repository (Copy the Template)

1. In your target repository: `mkdir -p .devcontainer`
2. Copy the contents of this repo's `.devcontainer/distribute.devcontainer.json` to `.devcontainer/devcontainer.json` in the target repository; change the `name` field to your project name
3. The template pins `"image": "ghcr.io/denisekart/omp-devcontainer-base:latest"` — for stability you may pin a release tag instead (CI publishes `:<tag>` and `:latest`)
4. In VS Code: Command Palette → **Dev Containers: Reopen Folder in Container**

## What the Template Does

Everything below comes from `.devcontainer/distribute.devcontainer.json`, so you know what to expect when the container starts:

- **Docker-in-Docker feature** (`ghcr.io/devcontainers/features/docker-in-docker`, non-root) — `docker` works inside the container
- **9 named Docker volume mounts** — your state persists across container rebuilds (see [Persistence at a Glance](#persistence-at-a-glance))
- **`forwardPorts: [8888]`** — the Hindsight port auto-forwards (with a notify); all other ports are `ignore`d for auto-forward
- **VS Code extensions + settings** — 15 extensions; format-on-save, zsh integrated terminal, terminal GPU acceleration off
- **First-boot `postCreateCommand`** — fixes volume ownership, then runs the ordered chain `link-gitconfig.sh` → `seed-omp-home.sh` → `install-omp-plugins.sh` → `bootstrap.sh`
- **`postStartCommand`** — starts the `hindsight` tmux session (the self-healing memory supervisor)

Full contracts for each of these are in [architecture.md](architecture.md) (section 3). One consequence that matters to you: the volume names are shared globally, so `~/.omp`, `~/.hindsight`, and the other volumes are shared across every project that opens with this template — your agent config and memory are shared across your projects by design.

### Customization Rules

- **Safe to change**: `name`, the image tag pin, `customizations` (extensions/settings)
- **Do NOT remove or reorder**: the 9 `mounts`, `forwardPorts`, `postCreateCommand`, `postStartCommand` — they implement the persistence and self-healing lifecycle

## Point Models at Your Endpoint (Required)

The seeded default `baseUrl` (`http://spark.orca-hue.ts.net:4000/v1`) is the image author's LiteLLM endpoint. Point `models.yml` at your own OpenAI-compatible endpoint:

- Edit `~/.omp/agent/models.yml` (user-level), or `.omp/models.yml` (repo-level — bootstrap creates it as a copy of the user-level file, else the image default; the project level wins on merge). The repo-level file is committed, so it is the recommended place for team-shared configuration.
- Change `providers.<name>.baseUrl` / `apiKey` / `models` to your endpoint. For LLM servers running on the host machine use `http://host.docker.internal:<port>/v1` (inside the container, `localhost` is the container itself)
- Start a new `omp` session to pick up changes

Full model and role reference: [models.md](models.md).

## Verification Checklist

Run each command in a container terminal; the expected result follows:

| Check | Command | Expected result |
|-------|---------|-----------------|
| Hindsight up | `curl -sf http://localhost:8888/health` | Succeeds silently (exit 0) |
| Supervisor running | `tmux ls` | A `hindsight` session is listed |
| Docker-in-Docker | `docker version` | Both client and server sections print |
| Model endpoint reachable | `omp` | TUI starts; ask a one-line question and a model response arrives |
| Toolchain versions | `dotnet --list-sdks`; `node --version`; `python3 --version` | A `10.x` SDK, `v24.x`, `3.x` respectively |

## Persistence at a Glance

The 9 named volume mounts from the template:

| Target | What lives there |
|--------|------------------|
| `~/.omp` | Agent config, sessions, sentinels, plugin lockfile |
| `~/.hindsight` | Memory data, logs |
| `~/.ssh` | SSH keys and known hosts |
| `~/.config/gh` | GitHub CLI authentication |
| `~/.persisted-git` | The gitconfig (symlinked to `~/.gitconfig`) |
| `~/.zsh_history_vol` | Shell history |
| `~/.local/share/pnpm` | pnpm package store |
| `~/.nuget/packages` | NuGet package cache |
| `~/.cache/uv` | uv package cache |

Consequence: your configuration and memory survive container rebuilds. To reseed a single default, delete the specific file under `~/.omp/agent/` and reopen the container (see [troubleshooting.md](troubleshooting.md)).

## What Happens on First Boot

Ordered one-line summary (order enforced by `postCreateCommand`):

1. `sudo chown -R vscode:vscode` over the 9 volume directories
2. `link-gitconfig.sh` — persistent gitconfig via symlink to `~/.persisted-git/gitconfig`
3. `seed-omp-home.sh` — seeds `~/.omp/agent` from the image defaults, never overwriting existing files
4. `install-omp-plugins.sh` — installs the 4 pinned plugins (idempotent)
5. `bootstrap.sh` — writes `AGENTS.md` + `.omp/{config.yml,models.yml,mcp.json,plans,skills,agents}` into your repo, auto-detecting the stack

Then `postStartCommand` starts the `hindsight` tmux session. Full contracts: [architecture.md](architecture.md) (section 3).

## Common Onboarding Pitfalls

- **Endpoint unreachable from the container** — test with `curl -sSf <baseUrl>` from inside the container; use `host.docker.internal` for host-local servers. See [troubleshooting.md](troubleshooting.md).
- **Stale default `models.yml`** — bootstrap never overwrites an existing `.omp/models.yml`; delete it and re-run `bash /usr/local/share/omp-scripts/bootstrap.sh` to regenerate it.
- **Teammates not getting the same environment** — remember to commit `.devcontainer/` so everyone opens the same container.

## Maintainers

If you are modifying the image itself rather than consuming it, work in this repository (its `.devcontainer/devcontainer.json` builds from `build/Dockerfile`) and read [architecture.md](architecture.md).
