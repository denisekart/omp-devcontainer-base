---
name: test-quality
description: "Measuring and improving test effectiveness using code coverage, CRAP scores, mutation testing, and flaky test management."
---

# Test Quality & Analysis

Formerly: test-quality, crap-analysis

## When to use

- Evaluating test coverage before making changes to a codebase.
- Identifying high-risk code (CRAP hotspots) that needs refactoring or more tests.
- Setting up coverage collection for a .NET project.
- Prioritizing which code to test based on cyclomatic complexity.
- Establishing coverage thresholds for CI/CD pipelines.
- Managing flaky or non-deterministic tests.

## Rules

1. **CRAP Score = Complexity × (1 − Coverage)²** — combines cyclomatic complexity with test coverage.
2. **Score < 5**: low risk. **5–30**: acceptable but watch complexity. **> 30**: high risk; needs tests or refactoring.
3. OpenCover format is required for CRAP score calculation; merge multiple test project results with `ReportGenerator`.
4. Prioritize testing high-complexity code over low-coverage trivial code.
5. Exclude generated code, migrations, and benchmarks from coverage via `.runsettings`.
6. Use `[Retry]` sparingly; fix the root cause of flaky tests.

## Pattern

```bash
# Run tests with coverage (OpenCover format required for CRAP)
dotnet test --settings coverage.runsettings \
  --collect:"XPlat Code Coverage" \
  --results-directory ./TestResults

# Generate HTML report with CRAP hotspots
dotnet reportgenerator \
  -reports:"TestResults/**/coverage.opencover.xml" \
  -targetdir:"coverage" \
  -reporttypes:"Html;TextSummary;MarkdownSummaryGithub"
```

## Checklist

- [ ] Is code coverage collected during test runs?
- [ ] Are CRAP scores analyzed for complex methods?
- [ ] Is mutation testing used for critical business logic?
- [ ] Are generated code and migrations excluded from coverage?
- [ ] Is `ReportGenerator` used for human-readable results?
- [ ] Are flaky tests identified and isolated?
