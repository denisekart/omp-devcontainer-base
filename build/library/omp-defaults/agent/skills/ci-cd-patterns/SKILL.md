<!-- ported for oh-my-pi -->
---
name: ci-cd-patterns
description: Guidelines for GitHub Actions, project building, testing, and deployment workflows for .NET and SvelteKit.
---

# CI/CD Patterns

Use this skill when modifying GitHub Actions, build scripts, or deployment configurations.

## Key Principles
- **Fast Feedback**: Prioritize fast-running unit tests in the main PR loop.
- **Repeatability**: Ensure that the local dev environment (DevContainer) matches the CI environment as closely as possible.
- **Security**: Use OIDC for cloud authentication. Never use long-lived secrets in workflows.

## Guidelines
- **GitHub Actions**:
    - Use official actions (e.g., `actions/checkout`, `actions/setup-dotnet`).
    - Cache `nuget` packages and `node_modules` (or `pnpm` store) to speed up builds.
    - Use matrix builds for testing across multiple configurations if needed.
- **Build & Test**:
    - Use `dotnet build --no-restore` and `dotnet test --no-build` for efficiency.
    - Run `pnpm check` and `pnpm test` for frontend validation.
    - Ensure `docker-in-docker` or appropriate runners work in the CI environment for Aspire tests.
- **Deployment**:
    - Use `azd` (Azure Developer CLI) patterns for Aspire applications.
    - Implement Blue/Green or Canary deployments where supported.
- **Artifacts**: Upload test results and coverage reports for visibility.

## Example: Optimized .NET Build Step
```yaml
- name: Build
  run: dotnet build --configuration Release --no-restore
- name: Test
  run: dotnet test --configuration Release --no-build --logger "trx;LogFileName=test_results.trx"
```

## Checklist
- [ ] Are dependencies cached?
- [ ] Are secrets managed via Action Secrets or OIDC?
- [ ] Do builds run in non-interactive mode?
- [ ] Are test results uploaded as artifacts?
- [ ] Is the workflow using the latest stable action versions?
