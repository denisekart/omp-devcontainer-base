---
name: api-patterns
description: ProblemDetails error mapping, UseExceptionHandler, AddValidation/FluentValidation, idempotency, and rate-limiting patterns for ASP.NET Core APIs.
---
# API Patterns

Formerly: exception-handling, validation-patterns

## When to use

- Implementing error boundaries, custom exceptions, or resilient call chains (exception-handling)
- Implementing request validation, business rule enforcement, or API error handling (validation-patterns)

## Rules

1. **Centralized handling**: Register `UseExceptionHandler()` to map exceptions to RFC 7807 `ProblemDetails`.
2. **Informative errors**: Return compliant `ProblemDetails` without leaking sensitive stack traces.
3. **Fail fast**: Validate inputs and state early.
4. **Resilience**: Use Polly for retries, circuit breakers, and timeouts on external calls.
5. **Domain exceptions**: Define domain-specific exceptions to distinguish validation, authorization, and infrastructure failures.

### Validation Frameworks

- **.NET 10 `AddValidation`**: Default for new projects. Source-generator-based, AOT-compatible. Use `[ValidatableType]` on partial classes.
- **FluentValidation**: Best for complex, cross-property, or async business rules.
- **Data Annotations**: Suitable for simple DTOs and shared models.

### API Integration

- Minimal API auto-returns `ValidationProblem` with `AddValidation()`.
- Security-focused validation: input sanitization, length limits, type checks.

## Pattern

```csharp
// Global exception mapping
app.UseExceptionHandler();

// .NET 10 built-in validation
[ValidatableType]
public partial class CreateRequest
{
    [Required]
    [StringLength(100)]
    public required string Name { get; set; }
}

// FluentValidation for complex rules
public class OrderValidator : AbstractValidator<OrderDto>
{
    public OrderValidator()
    {
        RuleFor(x => x.Items).NotEmpty();
        RuleFor(x => x.Total).GreaterThan(0);
    }
}

// Resilience handler
builder.Services.AddHttpClient("ExternalApi")
    .AddStandardResilienceHandler();
```

## Checklist

- [ ] `UseExceptionHandler` configured?
- [ ] Sensitive details excluded from production errors?
- [ ] Retries/timeouts on external calls?
- [ ] Domain exceptions control API status codes?
- [ ] Correct validation framework chosen for complexity?
- [ ] Models annotated with `[ValidatableType]` for .NET 10?
- [ ] Error responses compliant with `ProblemDetails`?
- [ ] Security-focused validation applied?
