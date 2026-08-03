<!-- ported for oh-my-pi -->
---
name: coding-standards
description: Modern, high-performance C# coding standards using records, pattern matching, value objects, and async/await best practices.
---

# Modern C# Coding Standards

Use this skill when writing new C# code or refactoring existing logic to ensure it is idiomatic, performant, and maintainable.

## Core Principles
1. **Immutability by Default**: Use `record` types and `init`-only properties.
2. **Type Safety**: Leverage nullable reference types (NRT) and strongly-typed IDs.
3. **Modern Pattern Matching**: Use `switch` expressions and patterns extensively.
4. **Async Everywhere**: Prefer async APIs with proper cancellation support.
5. **Zero-Allocation Patterns**: Use `Span<T>` and `Memory<T>` for performance-critical code.

## Naming Conventions
- **Classes/Records/Methods**: `PascalCase`.
- **Interfaces**: `I` + `PascalCase` (`IOrderRepository`).
- **Private Fields**: `_camelCase` (`_logger`).
- **Async Methods**: Always suffix with `Async` (`GetByIdAsync`).
- **Booleans**: Prefix with `Is`, `Has`, `Can` (`IsActive`).

## Code Style
- **File-Scoped Namespaces**: Use `namespace MyProject.Core;` (C# 10+).
- **Braces**: Always use braces for control flow, even for single lines.
- **Expression-Bodied Members**: Use for single-expression properties and methods.
- **Null Handling**: Prefer pattern matching (`if (obj is not null)`) over standard null checks.
- **String Interpolation**: Prefer `$""` or `$$""" """` (raw string literals) over concatenation.

## Quality Standards
- **CRAP Score**: Keep Change Risk Anti-Patterns score low (Complexity x (1 - Coverage)^2).
- **Documentation**: Use XML docs (`/// <summary>`) for public-facing APIs.
- **Clean Code**: Avoid deep nesting, large methods, and "god" classes.

## Checklist
- [ ] Are records used for immutable data/DTOs?
- [ ] Do async methods have the `Async` suffix and `CancellationToken`?
- [ ] Is nullable reference types (NRT) logic correctly applied?
- [ ] Are naming conventions followed consistently?
- [ ] Is the code structured to be easily testable?
