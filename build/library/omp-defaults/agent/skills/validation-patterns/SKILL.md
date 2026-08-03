<!-- ported for oh-my-pi -->
---
name: validation-patterns
description: Comprehensive input validation patterns using .NET 10 AddValidation, FluentValidation, and ProblemDetails.
---

# Validation Patterns

Use this skill when implementing request validation, business rule enforcement, or API error handling.

## Validation Frameworks

1. **.NET 10 Built-in Validation (`AddValidation`)**: Default for new projects. Source-generator-based and AOT-compatible.
2. **FluentValidation**: Best for complex, cross-property, or asynchronous business rules.
3. **Data Annotations**: Suitable for simple DTOs and shared models.

## Guidelines

### 1. .NET 10 Built-in Validation
Use `[ValidatableType]` on partial classes to trigger source generation.

```csharp
[ValidatableType]
public partial class CreateRequest
{
    [Required]
    [StringLength(100)]
    public required string Name { get; set; }
}

// Registration
builder.Services.AddValidation();
```

### 2. FluentValidation
Create dedicated validator classes for complex logic.

```csharp
public class OrderValidator : AbstractValidator<OrderDto>
{
    public OrderValidator()
    {
        RuleFor(x => x.Items).NotEmpty();
        RuleFor(x => x.Total).GreaterThan(0);
    }
}
```

### 3. API Integration & ProblemDetails
Ensure validation failures return RFC 7807 `ProblemDetails`.

```csharp
// Minimal API auto-returns ValidationProblem with AddValidation()
app.MapPost("/data", (CreateRequest req) => Results.Ok());
```

## Checklist
- [ ] Is the correct validation framework chosen for the complexity?
- [ ] Are models annotated with `[ValidatableType]` for .NET 10 validation?
- [ ] Are error responses compliant with `ProblemDetails`?
- [ ] Is security-focused validation applied (e.g., input sanitization)?
