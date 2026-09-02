# Project Context (omp-devcontainer-base)

## What This Repo Is

The base-image factory for the omp devcontainer. The deliverables are the Dockerfile, the two devcontainer configs, the lifecycle scripts, the baked agent defaults, and `docs/`. Consumers use the prebuilt image (`ghcr.io/denisekart/omp-devcontainer-base`) via `.devcontainer/distribute.devcontainer.json` — they never build this repo.

## Key Paths

- `.devcontainer/devcontainer.json` — build-mode devcontainer for THIS repo (`build` key)
- `.devcontainer/distribute.devcontainer.json` — consumer template, prebuilt image (`image` key); identical to the build-mode file except that one key — keep them in sync
- `build/Dockerfile` — image recipe: toolchain, baked `~/.tmux.conf` and `~/.zshrc` blocks, legacy shim patches
- `build/scripts/` — the 5 lifecycle scripts, enforced order: `link-gitconfig` → `seed-omp-home` → `install-omp-plugins` → `bootstrap`; plus `hindsight-supervisor.sh`
- `build/library/omp-defaults/agent/` — baked immutable defaults: `config.yml`, `models.yml`, `mcp.json`, `agents/` (9), `skills/` (33)
- `docs/` — consumer-first documentation; `README.md` is the index
- `.github/workflows/build-and-push.yml` — tag → multi-arch publish (linux/amd64, linux/arm64)

## Conventions

- Docs live in `docs/` and are **consumer-first**: the canonical consumer flow is "copy `distribute.devcontainer.json` into a repo → reopen in container → configure models → run `omp`"; maintainer content belongs only in `architecture.md`.
- `README.md` stays a slim index (one line per doc; no content duplication; keep links resolvable).
- The sources of truth for image behavior are the devcontainer configs + `build/Dockerfile` (+ the scripts/defaults they bake in); when a doc claim conflicts with a source file, the source file wins — fix the doc.
- Change baked defaults → `build/library/omp-defaults/agent/` (seed contract: never overwrites user files, new files auto-propagate); lifecycle behavior → `build/scripts/*.sh` (idempotent, re-runnable, respect the enforced order); VS Code/mounts/ports → BOTH `.devcontainer/*.json`.
- Repo-root `.omp/` (and the `.omp/`/`AGENTS.md` templates inside `bootstrap.sh`) are bootstrap output for consumer workspaces — here they are dogfooding artifacts of running this container on this repo; they are NOT part of the image and NOT a documentation target.

## Build & Verify

- `docker buildx build -f build/Dockerfile build/` (or a devcontainer rebuild)
- Test script changes by running them in a fresh container
- Publishing: push a tag on `main` (CI builds `linux/amd64,linux/arm64`)

## Native Workflow

When working in this repo inside the container:

- Delegation via the `task` tool — see the baked agents in `build/library/omp-defaults/agent/agents/`
- Memory via `recall`/`store` (Hindsight on :8888)
- `/continue` for session handoff
- Plan mode (`--plan`) writing to `.omp/plans/`
- `/scaffold` for project structure
