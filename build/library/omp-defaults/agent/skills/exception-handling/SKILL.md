<!-- ported for oh-my-pi -->
---
name: exception-handling
description: Global error handling, ProblemDetails mapping, and resilience patterns in ASP.NET Core.
---

# Exception Handling

Use this skill when implementing error boundaries, custom exceptions, or resilient call chains.

## Key Principles
- **Centralized Handling**: Use `UseExceptionHandler` to map exceptions to `ProblemDetails`.
- **Informative Errors**: Return RFC 7807 compliant responses without leaking sensitive stack traces.
- **Fail Fast**: Validate inputs and state early to avoid deep failures.
- **Resilience**: Use `Polly` for retries, circuit breakers, and timeouts.

## Guidelines

### 1. Global Exception Mapping
Register `IExceptionHandler` or use the built-in middleware.

```csharp
app.UseExceptionHandler(); // Maps exceptions to ProblemDetails automatically
```

### 2. Custom Exceptions
Define domain-specific exceptions to distinguish between validation, authorization, and infrastructure failures.

```csharp
public class EntityNotFoundException(string name, object key) 
    : Exception($"{name} ({key}) was not found.");
```

### 3. Resilience Patterns
Integrate Polly with `HttpClient` for reliable external calls.

```csharp
builder.Services.AddHttpClient("ExternalApi")
    .AddStandardResilienceHandler();
```

## Checklist
- [ ] Is `UseExceptionHandler` configured?
- [ ] Are sensitive details excluded from production error responses?
- [ ] Are retries and timeouts applied to external service calls?
- [ ] Are domain exceptions used to control API status codes?
