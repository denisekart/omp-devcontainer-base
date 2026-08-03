<!-- ported for oh-my-pi -->
---
name: crap-analysis
description: Analyze code coverage and CRAP (Change Risk Anti-Patterns) scores to identify high-risk code. Use OpenCover format with ReportGenerator for Risk Hotspots showing cyclomatic complexity and untested code paths.
---

# CRAP Score Analysis

## When to Use This Skill

Use this skill when:
- Evaluating code quality and test coverage before changes
- Identifying high-risk code that needs refactoring or testing
- Setting up coverage collection for a .NET project
- Prioritizing which code to test based on risk
- Establishing coverage thresholds for CI/CD pipelines

---

## What is CRAP?

**CRAP Score = Complexity x (1 - Coverage)^2**

The CRAP (Change Risk Anti-Patterns) score combines cyclomatic complexity with test coverage to identify risky code.

| CRAP Score | Risk Level | Action Required |
|------------|------------|-----------------|
| **< 5** | Low | Well-tested, maintainable code |
| **5-30** | Medium | Acceptable but watch complexity |
| **> 30** | High | Needs tests or refactoring |

### CRAP Score Examples

| Method | Complexity | Coverage | Calculation | CRAP |
|--------|------------|----------|-------------|------|
| `GetUserId()` | 1 | 0% | 1 x (1 - 0)^2 | **1** |
| `ParseToken()` | 54 | 52% | 54 x (1 - 0.52)^2 | **12.4** |
| `ValidateForm()` | 20 | 0% | 20 x (1 - 0)^2 | **20** |
| `ProcessOrder()` | 45 | 20% | 45 x (1 - 0.20)^2 | **28.8** |
| `ImportData()` | 80 | 10% | 80 x (1 - 0.10)^2 | **64.8** |

---

## Coverage Collection Setup

### coverage.runsettings

Create a `coverage.runsettings` file in your repository root. The **OpenCover format is required** for CRAP score calculation.

```xml
<?xml version="1.0" encoding="utf-8" ?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat code coverage">
        <Configuration>
          <Format>cobertura,opencover</Format>
          <Exclude>[*.Tests]*,[*.Benchmark]*,[*.Migrations]*</Exclude>
          <ExcludeByAttribute>Obsolete,GeneratedCodeAttribute,CompilerGeneratedAttribute,ExcludeFromCodeCoverageAttribute</ExcludeByAttribute>
          <ExcludeByFile>**/obj/**/*,**/*.g.cs,**/*.designer.cs,**/*.razor.g.cs,**/*.razor.css.g.cs,**/Migrations/**/*</ExcludeByFile>
          <IncludeTestAssembly>false</IncludeTestAssembly>
          <SingleHit>false</SingleHit>
          <UseSourceLink>true</UseSourceLink>
          <SkipAutoProps>true</SkipAutoProps>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

---

## Collecting Coverage

```bash
# Clean previous results
rm -rf coverage/ TestResults/

# Run tests with coverage
dotnet test --settings coverage.runsettings \
  --collect:"XPlat Code Coverage" \
  --results-directory ./TestResults

# Generate HTML report
dotnet reportgenerator \
  -reports:"TestResults/**/coverage.opencover.xml" \
  -targetdir:"coverage" \
  -reporttypes:"Html;TextSummary;MarkdownSummaryGithub"
```

---

## Coverage Thresholds

| Coverage Type | Target | Action |
|---------------|--------|--------|
| Line Coverage | > 80% | Good for most projects |
| Branch Coverage | > 60% | Catches conditional logic |
| CRAP Score | < 30 | Maximum for new code |

---

## Quick Reference

```bash
# Full analysis workflow
rm -rf coverage/ TestResults/ && \
dotnet test --settings coverage.runsettings \
  --collect:"XPlat Code Coverage" \
  --results-directory ./TestResults && \
dotnet reportgenerator \
  -reports:"TestResults/**/coverage.opencover.xml" \
  -targetdir:"coverage" \
  -reporttypes:"Html;TextSummary"
```

## Additional Resources

- **Coverlet Documentation**: https://github.com/coverlet-coverage/coverlet
- **ReportGenerator**: https://github.com/danielpalme/ReportGenerator
