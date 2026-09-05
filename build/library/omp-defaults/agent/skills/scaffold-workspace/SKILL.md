---
name: scaffold-workspace
description: "Provides a /scaffold command to generate recommended project structures for detected stacks."
---

# Scaffold Workspace

## When to use

- Creating the directory skeleton for a new project based on the detected or specified stack.
- Initializing a fresh workspace with standard .NET Aspire + Svelte or .NET-only layouts.

## Rules

1. Read `AGENTS.md` or `.omp/config.yml` to detect the stack preset.
2. Create directories and `.gitkeep` files according to the chosen preset.
3. Confirm completion to the user after scaffolding.

## Presets

| Preset | Directories |
| -------- | ------------ |
| `dotnet-aspire-svelte` | `src/App.AppHost/`, `src/App.Web/`, `src/App.ServiceDefaults/`, `tests/App.Tests.Unit/`, `tests/App.Tests.E2E/`, `src/frontend/`, `docs/` |
| `dotnet-only` | `src/App.AppHost/`, `src/App.Web/`, `src/App.ServiceDefaults/`, `tests/App.Tests.Unit/`, `docs/` |
| `svelte-only` / `generic` | `src/`, `tests/`, `docs/` |

## Pattern

```bash
# dotnet-aspire-svelte
mkdir -p src/App.AppHost src/App.Web src/App.ServiceDefaults \
  tests/App.Tests.Unit tests/App.Tests.E2E src/frontend docs
touch src/App.AppHost/.gitkeep src/App.Web/.gitkeep src/App.ServiceDefaults/.gitkeep
touch tests/App.Tests.Unit/.gitkeep tests/App.Tests.E2E/.gitkeep
touch src/frontend/.gitkeep docs/.gitkeep
```

## Checklist

- [ ] Is the stack preset correctly identified?
- [ ] Are all required directories created?
- [ ] Are `.gitkeep` files placed in every new directory?
- [ ] Is completion confirmed to the user?
