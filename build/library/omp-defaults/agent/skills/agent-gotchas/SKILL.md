<!-- ported for oh-my-pi -->
---
name: agent-gotchas
description: Common pitfalls and mistakes to avoid when generating or modifying .NET code.
---

# .NET Agent Gotchas

Use this skill to cross-check implementations for common AI-generated errors in .NET projects.

## Common Pitfalls

### 1. Async/Await Misuse
- **Blocking**: Using `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()` (causes deadlocks).
- **Fire-and-Forget**: Using `async void` or ignoring `Task` returns (exceptions are lost).
- **CancellationToken**: Not accepting or forwarding `CancellationToken`.

### 2. Dependency Injection
- **Captive Dependencies**: Injecting a scoped service (like `DbContext`) into a singleton.
- **Manual Instantiation**: Using `new` for services that should be managed by the DI container.

### 3. NuGet & Project Structure
- **Wrong Names**: Hallucinating package names (e.g., `EntityFramework` instead of `Microsoft.EntityFrameworkCore`).
- **Version Mismatches**: Referencing package versions incompatible with the project's Target Framework (TFM).

### 4. Deprecated APIs
- **WebClient**: Use `HttpClient` via `IHttpClientFactory` instead.
- **BinaryFormatter**: Banned due to security vulnerabilities; use `System.Text.Json` or `Protobuf`.
- **Legacy Crypto**: Avoid `SHA1CryptoServiceProvider`; use `SHA256.Create()`.

### 5. Code Quality
- **LINQ Performance**: Premature `.ToList()` materialization or multiple enumerations of `IEnumerable`.
- **NRT Issues**: Using `!` (null-forgiving operator) to hide warnings instead of properly handling nulls.

## Checklist
- [ ] Are all async methods awaited properly?
- [ ] Is `CancellationToken` propagated?
- [ ] Are DI lifetimes respected?
- [ ] Are modern, non-deprecated APIs used?
- [ ] Are NuGet package names and versions verified?
