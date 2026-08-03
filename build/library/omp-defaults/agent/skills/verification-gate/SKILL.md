---
name: verification-gate
description: Final verification steps to ensure code quality and mitigate AI hallucinations.
---

# Verification Gate Skill

Use this skill before emitting a Completion Signal to ensure the work is actually correct and follows project standards.

## Verification Checklist

### 1. Hallucination Check
- [ ] **Filesystem Reality**: Did you actually create/modify the files you claim? (Use `ls` or `read` to confirm).
- [ ] **API Reality**: Does the API/library you used actually exist in the current project version? (Check `package.json` or `.csproj` and project symbols).
- [ ] **Import Check**: Are all new imports valid and resolvable?

### 2. Standard Compliance
- [ ] **Minimalism**: Did you only change what was requested? (No "helpful" but unrequested refactors).
- [ ] **Convention**: Does the code match existing patterns in the file/project (naming, indentation, async patterns)?
- [ ] **Runes (Svelte)**: If Svelte 5, are you using runes? No `export let` or `$:`?
- [ ] **Clean Architecture (.NET)**: Is business logic outside of Controllers/Delegates?

### 3. Execution Gate
- [ ] **Compilation**: Does it build? (`dotnet build` or `pnpm check`).
- [ ] **Tests**: Do the relevant tests pass? (`dotnet test` or `pnpm test`).
- [ ] **LSP Health**: Are there any red squiggles reported by the Language Server?

## How to use this skill
At the end of your task, perform a "Verification Pass". If any checklist item fails, fix it immediately before reporting "DONE".

```
// Example Verification Pass
1. Run pnpm check -> passed.
2. Verified src/lib/NewComponent.svelte exists -> confirmed.
3. Verified $state() used for reactivity -> confirmed.
```
