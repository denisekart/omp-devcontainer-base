---
name: scaffold-workspace
description: Provides a /scaffold command to generate recommended project structures.
---

# Scaffold Workspace Skill

Use the `/scaffold` command to create the directory skeleton for your project based on the detected or specified stack.

## Usage
- `/scaffold`: Detects the stack from `AGENTS.md` or `.omp/config.yml` and creates the folders.
- `/scaffold --stack <preset>`: Forces a specific stack preset.

## Presets
- `dotnet-aspire-svelte`: `src/App.AppHost/`, `src/App.Web/`, `src/App.ServiceDefaults/`, `tests/App.Tests.Unit/`, `tests/App.Tests.E2E/`, `src/frontend/`, `docs/`
- `dotnet-only`: `src/App.AppHost/`, `src/App.Web/`, `src/App.ServiceDefaults/`, `tests/App.Tests.Unit/`, `docs/`
- `svelte-only`: `src/`, `tests/`, `docs/`
- `generic`: `src/`, `tests/`, `docs/`

## Instructions
1. Identify the project stack (read `AGENTS.md` or `.omp/config.yml`).
2. Create the directories and `.gitkeep` files according to the chosen preset.
3. Confirm completion to the user.

### Dotnet Aspire Svelte
```bash
mkdir -p src/App.AppHost src/App.Web src/App.ServiceDefaults tests/App.Tests.Unit tests/App.Tests.E2E src/frontend docs
touch src/App.AppHost/.gitkeep src/App.Web/.gitkeep src/App.ServiceDefaults/.gitkeep
touch tests/App.Tests.Unit/.gitkeep tests/App.Tests.E2E/.gitkeep
touch src/frontend/.gitkeep docs/.gitkeep
```

### Dotnet Only
```bash
mkdir -p src/App.AppHost src/App.Web src/App.ServiceDefaults tests/App.Tests.Unit docs
touch src/App.AppHost/.gitkeep src/App.Web/.gitkeep src/App.ServiceDefaults/.gitkeep
touch tests/App.Tests.Unit/.gitkeep docs/.gitkeep
```

### Svelte Only / Generic
```bash
mkdir -p src tests docs
touch src/.gitkeep tests/.gitkeep docs/.gitkeep
```
