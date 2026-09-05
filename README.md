# omp-devcontainer-base

A portable, workspace-independent devcontainer for the [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`/`pi`) AI coding harness. The prebuilt image (`ghcr.io/denisekart/omp-devcontainer-base`) bundles a .NET 10/Aspire + SvelteKit + Python toolchain with a pre-configured agent environment — drop it into any repository and work. The consumer flow copies the bundled template `.devcontainer/distribute.devcontainer.json` into the target repo and reopens it in a container.

## Key Features

- **Workspace independence** — the same image works in any repository
- **Baked-in agents and skills** — capabilities ship inside the image, no workspace pollution
- **Persistent state** — configuration and memory (Hindsight) are shared across your projects via Docker volumes
- **Native omp integration** — `task` delegation, `recall`/`store` memory, and session continuation out of the box

## Quick Start

1. Add `.devcontainer/devcontainer.json` to your repository using this repo's `.devcontainer/distribute.devcontainer.json` as the template (change the `name` field)
2. VS Code → **Dev Containers: Reopen Folder in Container**
3. Point models at your LLM endpoint (`~/.omp/agent/models.yml` or `.omp/models.yml`)
4. Run `omp`

Full walkthrough: [docs/getting-started.md](docs/getting-started.md)

## Documentation

| Doc | What it covers |
|-----|----------------|
| [docs/getting-started.md](docs/getting-started.md) | Setup & onboarding — the only doc a new user needs |
| [docs/using-omp.md](docs/using-omp.md) | Day-to-day: plan mode, agents, skills, memory, profiles, slash commands |
| [docs/tmux.md](docs/tmux.md) | tmux environment, key bindings, the hindsight session, safe backgrounding |
| [docs/models.md](docs/models.md) | Model configuration, roles, local tiny models |
| [docs/mcp.md](docs/mcp.md) | MCP reference + bundled servers |
| [docs/plugins.md](docs/plugins.md) | Plugin adoption decisions |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptom → fix |
| [docs/architecture.md](docs/architecture.md) | Internals & change flow — for maintainers of this image |

## License

The container image and this repository's tooling are licensed under the [MIT License](https://opensource.org/licenses/MIT).

## For Maintainers

Building and publishing: `docker buildx build -f build/Dockerfile build/` (or a devcontainer rebuild); a tag push on `main` triggers CI, which builds and pushes `linux/amd64,linux/arm64`. See [docs/architecture.md](docs/architecture.md).

The [sync-omp-defaults.sh](build/scripts/sync-omp-defaults.sh) script is the dogfood escape hatch: after an image rebuild, it force-syncs edited/deleted defaults into the workspace without touching live state (sessions, databases, cache).
