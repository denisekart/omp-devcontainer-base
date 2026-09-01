# omp Plugin Decisions

This document records the plugin adoption decisions for this devcontainer base image.
Plugins are installed via `.devcontainer/scripts/install-omp-plugins.sh` on first container create.
Pinned versions and integrity digests are stored in `plugins.lock.json` at the repo root.

## Adopted Plugins

These 3 plugins are installed globally by default via `omp plugin install` during container initialization (`install-omp-plugins.sh`).

| Plugin | npm | GitHub | Purpose | Satisfies |
|--------|-----|--------|---------|-----------|
| `pi-loop-police` | [npmjs.com/package/pi-loop-police](https://npmjs.com/package/pi-loop-police) | [github.com/sebaxzero/pi-loop-police](https://github.com/sebaxzero/pi-loop-police) | Detects and breaks infinite loops in real time | Self-correction / ralph-loop guardrail |
| `pi-lens` | [npmjs.com/package/pi-lens](https://npmjs.com/package/pi-lens) | [github.com/apmantza/pi-lens](https://github.com/apmantza/pi-lens) | Real-time code feedback: LSP, linters, formatters, type-checking | Lens/context feedback; reinforces LSP integration |
| `context-mode` | [npmjs.com/package/context-mode](https://npmjs.com/package/context-mode) | [github.com/mksglu/context-mode](https://github.com/mksglu/context-mode) | MCP plugin that saves up to 98% of context window | Context-mode request, directly |

To reinstall after removing the sentinel:
```bash
rm ~/.omp/.plugins-installed-v1
bash /usr/local/share/omp-scripts/install-omp-plugins.sh
```

## Deferred / Incompatible Legacy Plugins

These plugins were evaluated but removed from defaults due to runtime shim incompatibilities with modern `@oh-my-pi/pi-coding-agent`:

| Plugin | Original Purpose | Why Removed / Alternative |
|--------|------------------|---------------------------|
| `pi-atelier` | Custom TUI theme, status rail, and activity sidebar | Fails extension validation against modern OMP legacy TUI shims. **Alternative**: Use native OMP built-in themes and native status bar / TUI differential layout. |
| `@narumitw/pi-btw` | `/btw` side-question command | Fails extension validation against modern OMP legacy AI shims. **Alternative**: Use native OMP subagents via the `task` tool, native `/ask`, or session branching/forking. |
| `@lnilluv/pi-ralph-loop` (or `pi-ralph`) | Self-correction loop mechanism | Closest verified match to "pi-smart-ralph", but not installed by default to avoid unverified workflow constraints. |
| `@tintinweb/pi-tasks` | Claude Code-style task tracking | Useful addition but not required for core workflow; can be installed per-user. |

## Considered But Not Adopted

These names were researched and rejected:

| Name | Reason |
|------|--------|
| `pi-tree-context-window` / `pi-context-tree` | A package named `pi-context-tree` exists but its behavior could not be independently verified beyond a name match. Not adopted due to insufficient evidence of safety and fit. |
| `pi-blackhole` | Found only on GitHub ([github.com/k0valik/pi-blackhole](https://github.com/k0valik/pi-blackhole)) with no npm listing. Purpose unclear — reads a config file but actual behavior is unverified. Not adopted. |
| `pi-oven` | NOT FOUND on npm or GitHub under any variant. No real package exists with this name. |
