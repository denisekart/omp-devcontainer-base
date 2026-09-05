---
name: ci-cd-patterns
description: "OIDC secrets, official GitHub Actions, dotnet build --no-restore, and deployment workflows for .NET and SvelteKit."
---

# CI/CD Patterns

## When to use

- Modifying GitHub Actions, build scripts, or deployment configurations.
- Setting up OIDC authentication, caching, or matrix builds.
- Configuring optimized build/test steps for .NET and SvelteKit projects.

## Rules

1. Use official actions (`actions/checkout`, `actions/setup-dotnet`, `actions/setup-node`).
2. Cache `nuget` packages and `node_modules` (or `pnpm` store) to speed up builds.
3. Use `dotnet build --no-restore` and `dotnet test --no-build` for efficiency after initial restore.
4. Use OIDC for cloud authentication — never use long-lived secrets in workflows.
5. Run `pnpm check` and `pnpm test` for frontend validation.

## Pattern

```yaml
- name: Build
  run: dotnet build --configuration Release --no-restore

- name: Test
  run: dotnet test --configuration Release --no-build \
       --logger "trx;LogFileName=test_results.trx"

- name: Upload coverage
  uses: actions/upload-artifact@v4
  with { name: coverage, path: coverage/ }
```

## Checklist

- [ ] Are dependencies cached?
- [ ] Are secrets managed via Action Secrets or OIDC?
- [ ] Do builds run in non-interactive mode?
- [ ] Are test results uploaded as artifacts?
- [ ] Is the workflow using the latest stable action versions?
