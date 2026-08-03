# omp Plugin Decisions

This document records the plugin adoption decisions for this devcontainer base image.
Plugins are installed via `.devcontainer/scripts/install-omp-plugins.sh` on first container create.
Pinned versions and integrity digests are stored in `plugins.lock.json` at the repo root.

## Adopted Plugins

These 5 plugins are installed by default and wired into the `extensions:` array in `image/omp-defaults/agent/config.yml`.

| Plugin | npm | GitHub | Purpose | Satisfies |
|--------|-----|--------|---------|-----------|
| `pi-atelier` | [npmjs.com/package/pi-atelier](https://npmjs.com/package/pi-atelier) | [github.com/michaelmjhhhh/pi-atelier](https://github.com/michaelmjhhhh/pi-atelier) | Responsive status rail and live activity sidebar for Pi | TUI/theme request |
| `pi-loop-police` | [npmjs.com/package/pi-loop-police](https://npmjs.com/package/pi-loop-police) | [github.com/sebaxzero/pi-loop-police](https://github.com/sebaxzero/pi-loop-police) | Detects and breaks infinite loops in real time | Self-correction / ralph-loop guardrail |
| `pi-lens` | [npmjs.com/package/pi-lens](https://npmjs.com/package/pi-lens) | [github.com/apmantza/pi-lens](https://github.com/apmantza/pi-lens) | Real-time code feedback: LSP, linters, formatters, type-checking | Lens/context feedback; reinforces LSP integration |
| `context-mode` | [npmjs.com/package/context-mode](https://npmjs.com/package/context-mode) | [github.com/mksglu/context-mode](https://github.com/mksglu/context-mode) | MCP plugin that saves up to 98% of context window | Context-mode request, directly |
| `@narumitw/pi-btw` | [npmjs.com/package/@narumitw/pi-btw](https://npmjs.com/package/@narumitw/pi-btw) | [github.com/narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) | Adds `/btw` side-question command | pi-btw request |

To reinstall after removing the sentinel:
```bash
rm ~/.omp/.plugins-installed-v1
bash .devcontainer/scripts/install-omp-plugins.sh
```

## Deferred / Optional Plugins

These plugins are real and verified on npm/GitHub but are **not** installed by default.
Install manually:

| Plugin | Install command | Purpose | Why deferred |
|--------|----------------|---------|--------------|
| `@lnilluv/pi-ralph-loop` (or `pi-ralph`) | `omp plugin install @lnilluv/pi-ralph-loop` | Self-correction loop mechanism — closest verified match to "pi-smart-ralph" | The exact name "pi-smart-ralph" does not exist; this is the closest confirmed analog. Not installed by default to avoid imposing an unverified workflow on all users. |
| `@tintinweb/pi-tasks` | `omp plugin install @tintinweb/pi-tasks` | Claude Code-style task tracking and coordination for pi | Closest verified match to "pi-task". Useful addition but not required for the core workflow; easily added per-user. |

## Considered But Not Adopted

These names were researched and rejected:

| Name | Reason |
|------|--------|
| `pi-tree-context-window` / `pi-context-tree` | A package named `pi-context-tree` exists but its behavior could not be independently verified beyond a name match. Not adopted due to insufficient evidence of safety and fit. |
| `pi-blackhole` | Found only on GitHub ([github.com/k0valik/pi-blackhole](https://github.com/k0valik/pi-blackhole)) with no npm listing. Purpose unclear — reads a config file but actual behavior is unverified. Not adopted. |
| `pi-oven` | NOT FOUND on npm or GitHub under any variant. No real package exists with this name. |
