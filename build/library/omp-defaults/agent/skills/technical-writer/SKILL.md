---
name: technical-writer
description: "Guidelines for keep-a-changelog, conventional commits, XML doc comments, and JSDoc."
---

# Technical Writer

## When to use

- Writing READMEs, updating CHANGELOG.md, documenting APIs, or adding complex comments.
- Adding XML documentation comments to public C# APIs or JSDoc to TypeScript.
- Following conventional commit messages for feat/fix/docs changes.

## Rules

1. **CHANGELOG.md**: Always update for user-facing changes using Keep a Changelog format (<https://keepachangelog.com/en/1.0.0/>).
2. **C# XML docs**: Use `/// <summary>`, `/// <param name="">`, `/// <returns>` for public members.
3. **JSDoc**: Use `/** */` blocks for TypeScript/JavaScript public APIs.
4. **Commit messages**: Follow conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
5. **README files**: Each major module should have a README; keep them concise and up to date.

## Pattern

```csharp
/// <summary>
/// Calculates a score based on raw data.
/// </summary>
/// <param name="data">The raw data points.</param>
/// <returns>A normalized score between 0 and 100.</returns>
public double CalculateScore(IEnumerable<RawData> data);
```

```javascript
/**
 * Validates the user's authentication token.
 * @param {string} token - The JWT token to validate.
 * @returns {Promise<boolean>} Whether the token is valid.
 */
async function validateToken(token) { /* ... */ }
```

## Checklist

- [ ] Is the language clear and concise?
- [ ] Have all public members been documented?
- [ ] Is the CHANGELOG updated for user-facing changes?
- [ ] Does the documentation match the implementation?
- [ ] Are commit messages following conventional commits?
