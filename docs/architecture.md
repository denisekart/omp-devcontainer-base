# Architecture — Maintainers Only

This document covers how the `omp-devcontainer-base` image is built and what changes where. It is for maintainers of this image; consumers of the prebuilt image do not need it (see [getting-started.md](getting-started.md)).

## Sources of Truth

Image behavior is defined by exactly two entry points and their inputs:

1. **The devcontainer configs** — `.devcontainer/devcontainer.json` (build mode, used when developing this repo) and `.devcontainer/distribute.devcontainer.json` (consumer template, prebuilt image). They are identical except the `build` vs `image` key — **keep them in sync**.
2. **`build/Dockerfile`** — the image recipe, which bakes `build/scripts/` into `/usr/local/share/omp-scripts/` and `build/library/omp-defaults/` into `/usr/local/share/omp-defaults/`.

When a doc claim conflicts with a source file, the source file wins.

### Where Is What Configured

| Behavior | Where |
|----------|-------|
| Model defaults (providers, roles, tiny models) | `build/library/omp-defaults/agent/models.yml` + `config.yml` |
| First-boot lifecycle (order of operations) | `postCreateCommand` / `postStartCommand` in both `.devcontainer/*.json` + the scripts in `build/scripts/` |
| tmux key bindings | the `~/.tmux.conf` block in `build/Dockerfile` (lines 282–333) |
| Shell aliases, `bgrun`, zsh options | the `~/.zshrc` block in `build/Dockerfile` (lines 246–280) |
| VS Code extensions/settings | `customizations` in `.devcontainer/*.json` |
| Persistent volumes | `mounts` in `.devcontainer/*.json` |
| Port forwarding (all ports; 8888 = Hindsight) | `forwardPorts` / `portsAttributes` in `.devcontainer/*.json` |
| Toolchain versions (dotnet, node, bun, npm packages, uv tools) | the `RUN` layers in `build/Dockerfile` |
| Baked MCP servers | `build/library/omp-defaults/agent/mcp.json`; per-stack project MCP → the `MCP_JSON` case in `build/scripts/bootstrap.sh` (lines 217–247) |
| Plugin list | the `PLUGINS` array in `build/scripts/install-omp-plugins.sh` |

## Image Layout

Base image: `mcr.microsoft.com/devcontainers/base:bookworm`.

**Immutable baked paths** (read-only defaults, never modified at runtime):

- `/usr/local/share/omp-defaults/agent/` — `config.yml`, `models.yml`, `mcp.json`, `agents/` (9 agents), `skills/` (31 skills), `cache/` (pre-downloaded tiny models: `gemma-270m`, `lfm2-350m`, `lfm2-1.2b`)
- `/usr/local/share/omp-scripts/` — 5 scripts: `link-gitconfig.sh`, `seed-omp-home.sh`, `install-omp-plugins.sh`, `bootstrap.sh`, `hindsight-supervisor.sh`

**Global installs:**

- npm (global): `typescript`, `pnpm`, and the 5 language servers (`typescript-language-server`, `svelte-language-server`, `vscode-langservers-extracted`, `bash-language-server`)
- bun (global): `@oh-my-pi/pi-coding-agent` (latest); `pi` symlink to `omp`; legacy shim patches adding `stripTerminalSequences` to `legacy-pi-tui-shim` and `getSupportedThinkingLevels` / `clampThinkingLevel` to `legacy-pi-ai-shim`
- dotnet tools (global): `dotnet-ef`, `Aspire.Cli` (prerelease), `csharp-ls`; Aspire workload
- uv tools (global): `python-lsp-server`, `mcp-server-docker`, `mcp-server-fetch`, `mcp-server-git`, `mcp-server-time`
- Hindsight venv at `~/.local/share/hindsight`, with symlinks into `~/.local/bin`

## First-Boot Lifecycle

Ordered contract for the 5 scripts (order enforced by `postCreateCommand`):

1. **`link-gitconfig.sh`** — symlinks `~/.gitconfig` → `~/.persisted-git/gitconfig` (Docker volumes cannot target a single file); seeds an empty gitconfig; idempotent.
2. **`seed-omp-home.sh`** — merges `/usr/local/share/omp-defaults/agent/` → `~/.omp/agent/`. The sentinel `~/.omp/.seeded-v1` stores a content hash of the source tree. It NEVER overwrites existing files (user edits always win); an image update with new default files auto re-merges (hash mismatch triggers the merge); the fast path skips when the hash matches and the target is intact. Also seeds the pi-knowledge store on every boot (before the fast path): ONNX embedder/reranker models from `/usr/local/share/omp-defaults/knowledge-models/` → `~/.omp/knowledge/models/` and `~/.omp/knowledge.env` from the image default — both never clobber existing files, so `rm -rf ~/.omp/knowledge/` re-seeds on the next container creation.
   - Manual: re-run after deleting the sentinel (safe re-merge, no clobber).
   - Full reset (DANGEROUS — wipes user edits): `rm -rf ~/.omp/agent ~/.omp/.seeded-v1`, then re-run the script.
3. **`install-omp-plugins.sh`** — installs the 5 pinned plugins (incl. `pi-knowledge@0.10.0`) via `omp plugin install` as root (the global bun prefix is root-owned; `sudo` passes `HOME`/`BUN_INSTALL` through and user trees are chowned back). Sentinel `~/.omp/.plugins-installed-v1` stores `<omp version>|<sha256 of the pinned plugin specs>` — an omp bump OR a changed `PLUGINS` array triggers reinstall on existing volumes (reinstall is idempotent); lockfile `~/.omp/plugins.lock.json`; degrades to a global npm install if the `omp plugin` subcommand is missing.
   - Force reinstall: `rm ~/.omp/.plugins-installed-v1 && bash /usr/local/share/omp-scripts/install-omp-plugins.sh`
4. **`bootstrap.sh`** — workspace root = `git rev-parse --show-toplevel` (fallback: CWD). Stack from `--stack <preset>` or auto-detection (`has_dotnet`: any `*.sln`/`*.csproj`; `has_aspire`: an `*AppHost*.csproj` or any csproj referencing `Aspire.Hosting.AppHost`; `has_svelte`: any `package.json` containing `"svelte"`; precedence dotnet → aspire → svelte → `generic`). All writes go through `write_if_absent` (NEVER overwrites existing):
   - `AGENTS.md` — project-context template with stack + active-profile bullets
   - `.omp/{plans,skills,agents}/` — with `.gitkeep`
   - `.omp/config.yml` — stack, `providers` tiny-model block, commented `modelRoles`
   - `.omp/models.yml` — copy of `~/.omp/agent/models.yml`, else the image default
   - `.omp/mcp.json` — per stack: `dotnet-aspire-svelte` / `dotnet-only` / `generic` → `docker`, `aspire`, `shadcn`, `puppeteer`; `svelte-only` → `shadcn`, `puppeteer`
5. **`hindsight-supervisor.sh`** (via `postStartCommand`) — starts the self-healing Hindsight supervisor in the `hindsight` tmux session; see [tmux.md](tmux.md) (section 4).

## Repository Layout

```
.
├── build/
│   ├── Dockerfile               # image recipe (toolchain, baked tmux/zshrc blocks, shim patches)
│   ├── scripts/                 # 5 lifecycle scripts baked to /usr/local/share/omp-scripts/
│   └── library/omp-defaults/    # baked to /usr/local/share/omp-defaults/ (immutable defaults)
├── .devcontainer/
│   ├── devcontainer.json        # build mode (this repo): `build` key
│   ├── distribute.devcontainer.json  # consumer template: `image` key
│   └── devcontainer-lock.json   # pins the docker-in-docker feature
├── docs/                        # this documentation (consumer-first; README is the index)
└── .github/workflows/build-and-push.yml  # tag → multi-arch publish
```

Repo-root `.omp/` — bootstrap output from dogfooding this container on this repo itself; NOT part of the image, safe to ignore.

## CI & Publishing

`.github/workflows/build-and-push.yml`:

- Triggers on tag push (verified to be on `main`) or `workflow_dispatch`
- QEMU + buildx for multi-arch
- Pushes `ghcr.io/denisekart/omp-devcontainer-base:<tag>` and `:latest`
- Platforms: `linux/amd64,linux/arm64`
- GitHub Actions build cache

Manual multi-arch build:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/denisekart/omp-devcontainer-base:latest -f build/Dockerfile build/ --push
```

## Change Flow

What you want to change → file to edit → how it reaches existing users:

| Change | File | How it reaches existing users |
|--------|------|-------------------------------|
| Model/role defaults | `build/library/omp-defaults/agent/models.yml` or `config.yml` | Existing users KEEP their edited files — only new files auto-propagate on reseed; per-file and full reset paths in §3 |
| MCP defaults | `build/library/omp-defaults/agent/mcp.json` | Same seeding contract as model defaults |
| Per-stack project MCP | the `MCP_JSON` case in `build/scripts/bootstrap.sh` | Next bootstrap run in workspaces without an existing `.omp/mcp.json` |
| Lifecycle behavior | `build/scripts/*.sh` | Must stay idempotent, re-runnable, and respect the enforced order |
| Plugin list | the `PLUGINS` array in `build/scripts/install-omp-plugins.sh` | Next container create (or force reinstall after deleting the sentinel) |
| tmux/shell behavior | the respective blocks in `build/Dockerfile` | Next image build + container create |
| VS Code/mounts/ports | BOTH `.devcontainer/*.json` | Keep in sync; only the `build` vs `image` key may differ |
| Edited/deleted defaults | `build/scripts/sync-omp-defaults.sh` | Dogfood escape hatch: force-syncs only the defaults surface (`agents/`, `skills/`, top-level config) without touching live state; run after an image rebuild when repo defaults diverge from seeded defaults |

Then: rebuild the image (devcontainer, or buildx) and push a tag for CI.
