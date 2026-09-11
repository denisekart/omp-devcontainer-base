---
name: devcontainer-bake-not-adhoc
description: "Bake environment setup into build/Dockerfile, build/scripts, build/library/omp-defaults and .devcontainer/*.json — never apt/pip/npm/uv install (or apt-get update) in the live container"
condition: "\"command\":\\s*\"[^\"]*(apt(-get)?\\s+(install|update|upgrade)|pip3?\\s+install|npm\\s+install\\s+-g|uv\\s+tool\\s+install)"
scope: "tool"
---

You just ran environment setup (apt/pip/npm/uv) in the **live** container. This is a devcontainer repository (omp-devcontainer-base): anything that must survive a rebuild is throwaway here. State-changing setup belongs in the image recipe, not the running container:

- New apt packages, env vars, shell config → a `RUN` layer in `build/Dockerfile`
- Global npm/uv/dotnet tool installs → `build/Dockerfile`
- Baked agent defaults (skills, agents, config, MCP) → `build/library/omp-defaults/agent/`, lifecycle in `build/scripts/*.sh`
- VS Code extensions/settings, mounts, ports → `.devcontainer/devcontainer.json` **and** `.devcontainer/distribute.devcontainer.json` (keep in sync; only `build` vs `image` key may differ)

Live-container commands are fine for **inspection only** (`command -v`, `apt-cache policy`, `--version`, listing files). If a version check needs a fresh package list, do not `apt-get update` in the live container — read the Dockerfile recipe and note the check in the plan instead.