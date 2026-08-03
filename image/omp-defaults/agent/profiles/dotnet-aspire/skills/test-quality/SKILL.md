<!-- ported for oh-my-pi -->
---
name: test-quality
description: Measuring and improving test effectiveness using code coverage, CRAP score analysis, and mutation testing.
---

# Test Quality & Analysis

Use this skill when evaluating test coverage, identifying high-risk code (Risk Hotspots), or improving test suite reliability.

## Key Metrics

### 1. Code Coverage
Standard metric for identifying untested code. Use `coverlet.collector` for Cobertura/OpenCover output.
- **Run command**: `dotnet test --collect:"XPlat Code Coverage"`

### 2. CRAP Score (Change Risk Anti-Patterns)
**CRAP = Complexity x (1 - Coverage)^2**
Combines cyclomatic complexity with test coverage.
- **Score < 5**: Good.
- **Score 5-30**: Acceptable but watch complexity.
- **Score > 30**: High risk; needs refactoring or more tests.

### 3. Mutation Testing (Stryker.NET)
Evaluates if tests actually catch logic changes. "Kills" mutants to prove test strength.
- **Run command**: `dotnet stryker`

## Guidelines
- **OpenCover for CRAP**: CRAP analysis requires the `opencover` format to capture complexity metrics.
- **Risk Hotspots**: Prioritize testing for code with high cyclomatic complexity, not just low coverage.
- **Flaky Test Management**: Identify and isolate non-deterministic tests. Use `[Retry]` patterns sparingly; fix the root cause.
- **Merge Coverage**: Use `ReportGenerator` to merge results from multiple test projects into a single HTML report.

## Checklist
- [ ] Is code coverage collected during test runs?
- [ ] Are CRAP scores analyzed for complex methods?
- [ ] Is mutation testing used for critical business logic?
- [ ] Are generated code and migrations excluded from coverage?
- [ ] Is `ReportGenerator` used for human-readable results?
