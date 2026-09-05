---
name: dotnet-core
description: Modern C# 14 idioms, Clean-Arch layering, DI lifetimes, EF Core Fluent API, and Minimal API conventions for the project.
---
# .NET Core

Formerly: coding-standards, agent-gotchas, backend-conventions

## When to use

- Writing new C# code or refactoring existing logic (coding-standards)
- Cross-checking implementations for common AI-generated errors in .NET (agent-gotchas)
- Developing backend features, designing schemas, or working with Aspire (backend-conventions)

## Rules

1. **Immutability by default**: Use `record` types and `init`-only properties. Prefer C# 14 records for DTOs.
2. **Imperative frontmatter**: Ground claims in tools (`read`/`glob`/`lsp`), not model knowledge. No effort keywords (`ultrathink` etc.) in agent bodies.
3. **File-scoped namespaces**: `namespace MyProject.Core;` (C# 10+).
4. **Braces always**: Even for single-line control flow.
5. **Expression-bodied members**: Use for single-expression properties/methods.
6. **Null handling**: Prefer pattern matching (`if (obj is not null)`) over `!` null-forgiving.
7. **String interpolation**: `$""` or `$$""" """` over concatenation.
8. **Async everywhere**: Suffix with `Async`, accept `CancellationToken`, never `.Result`/`.Wait()`.
9. **Zero-allocation**: Use `Span<T>`/`Memory<T>` for performance-critical code.
10. **CRAP-aware**: Keep Change Risk Anti-Patterns score low (complexity × (1 − coverage)²).
11. **XML docs**: Use `/// <summary>` for public-facing APIs.

### Gotchas

- **Blocking**: No `.Result`, `.Wait()`, `.GetAwaiter().GetResult()`.
- **Fire-and-forget**: No `async void` or ignored `Task` returns.
- **Captive dependencies**: Never inject scoped into singleton.
- **Manual instantiation**: Use DI container, not `new` for services.
- **NuGet names**: Verify package names against docs (e.g. `Microsoft.EntityFrameworkCore`, not `EntityFramework`).
- **WebClient**: Use `HttpClient` via `IHttpClientFactory`.
- **BinaryFormatter**: Banned; use `System.Text.Json` or `Protobuf`.

### Clean Architecture

- Strictly separate Domain, Application, Infrastructure layers.
- Service Layer Pattern: all business logic in Service/Handler layer.
- Minimal APIs: thin endpoints delegate to handlers. Never add logic in the endpoint delegate.
- DI lifetimes: Transient (stateless handlers), Scoped (DbContext per request), Singleton (caches).

## Pattern

```csharp
public static class UserEndpoints
{
    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/users").WithTags("Users");
        group.MapGet("/{id}", async (Guid id, IUserHandler handler) =>
        {
            var user = await handler.GetUserByIdAsync(id);
            return user is not null ? Results.Ok(user) : Results.NotFound();
        });
    }
}
```

## Checklist

- [ ] Records used for immutable data/DTOs?
- [ ] Async methods have `Async` suffix + `CancellationToken`?
- [ ] Nullable reference types correctly applied?
- [ ] Naming conventions followed (PascalCase, I-prefix, _camelCase, Is/Has/Can)?
- [ ] Business logic in Service/Domain layer, not endpoints?
- [ ] Minimal API endpoints thin (delegating to handlers)?
- [ ] DI lifetimes correct (Transient/Scoped/Singleton)?
- [ ] Fluent API used for EF Core?
- [ ] All I/O operations asynchronous?
- [ ] Modern, non-deprecated APIs used?
