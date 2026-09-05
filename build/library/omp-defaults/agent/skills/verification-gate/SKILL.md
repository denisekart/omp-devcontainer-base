---
name: verification-gate
description: "Final verification steps to ensure code quality and mitigate AI hallucinations before completion."
---

# Verification Gate

## When to use

- Before emitting a Completion Signal to confirm the work is correct and follows project standards.
- Validating that claimed file changes, API usage, and imports actually exist.
- Checking compilation, tests, and LSP health before declaring done.

## Rules

1. **Hallucination check**: Use `read`/`glob`/`lsp` to confirm files exist and APIs are real — never `ls`.
2. **Import check**: All new imports must be valid and resolvable against project references.
3. **Minimalism**: Only change what was requested — no unrequested refactors.
4. **Convention**: Match existing patterns (naming, indentation, async, runes for Svelte).
5. **Compilation**: Must build (`dotnet build` or `pnpm check`).
6. **Tests**: Relevant tests must pass (`dotnet test` or `pnpm test`).
7. **LSP health**: No red squiggles reported by the Language Server.

## Pattern

```
// Verification Pass
1. Run pnpm check → passed.
2. Verify src/lib/NewComponent.svelte exists → confirmed via read.
3. Verify $state() used for reactivity → confirmed via lsp.
4. dotnet build → 0 errors.
5. dotnet test → all pass.
```

## Checklist

- [ ] Did you actually create/modify the files you claim? (read/glob)
- [ ] Does the API/library actually exist in the project? (lsp/read)
- [ ] Are all new imports valid and resolvable?
- [ ] Did you only change what was requested?
- [ ] Does it compile? (`dotnet build` or `pnpm check`)
- [ ] Do relevant tests pass? (`dotnet test` or `pnpm test`)
