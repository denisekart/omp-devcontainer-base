<!-- ported for oh-my-pi -->
---
name: technical-writer
description: Guidelines for high-quality technical documentation, CHANGELOG management, and code commenting in the project.
---

# Technical Writer

Use this skill when writing READMEs, updating CHANGELOG.md, documenting APIs, or adding complex comments to the codebase.

## Key Principles
- **Clarity and Conciseness**: Explain complex concepts simply.
- **Audience-Centric**: Write for the developer who will maintain this code in 6 months.
- **Standardization**: Follow templates and naming conventions.

## Guidelines
- **CHANGELOG.md**: Always update the CHANGELOG for user-facing changes. Use [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.
- **KDoc/XML Comments**: Use standard documentation tags for public APIs in C#. Use JSDoc for TypeScript.
- **README Files**: Each major module should have a README.
- **Commit Messages**: Follow conventional commits (feat, fix, docs, etc.).

## Example: C# XML Documentation
```csharp
/// <summary>
/// Calculates a score based on raw data.
/// </summary>
/// <param name="data">The raw data points.</param>
/// <returns>A normalized score between 0 and 100.</returns>
public double CalculateScore(IEnumerable<RawData> data)
{
    // Implementation
}
```

## Checklist
- [ ] Is the language clear?
- [ ] Have all public members been documented?
- [ ] Is the CHANGELOG updated?
- [ ] Does the documentation match the implementation?
