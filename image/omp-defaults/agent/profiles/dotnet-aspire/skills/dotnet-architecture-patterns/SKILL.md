<!-- ported for oh-my-pi -->
---
name: dotnet-architecture-patterns
description: "Organizing APIs at scale. Vertical slices, request pipelines, caching, error handling, idempotency."
---

# dotnet-architecture-patterns

Modern architecture patterns for .NET applications. Covers vertical slice architecture, request pipeline composition, validation strategies, caching, error handling, and idempotency/outbox patterns.

---

## Vertical Slice Architecture

Organize code by feature (vertical slice) rather than by technical layer. Each slice owns its endpoint, handler, validation, and data access.

### Directory Structure

```
Features/
  Orders/
    CreateOrder/
      CreateOrderEndpoint.cs
      CreateOrderHandler.cs
      CreateOrderRequest.cs
      CreateOrderValidator.cs
    GetOrder/
      GetOrderEndpoint.cs
```

### Why Vertical Slices

- **Low coupling**: changing one feature does not ripple through shared layers
- **Easy navigation**: everything for a feature is in one place
- **Independent testability**: each slice has a clear input/output contract

---

## Minimal API Organization at Scale

### Route Group Pattern

```csharp
app.MapGroup("/api/orders")
   .WithTags("Orders")
   .MapOrderEndpoints();
```

### Endpoint Classes

Keep each endpoint in its own static class with a single `Handle` method:

```csharp
public static class CreateOrderEndpoint
{
    public static async Task<IResult> Handle(
        CreateOrderRequest request,
        IValidator<CreateOrderRequest> validator,
        IOrderService orderService,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.ValidationProblem(validation.ToDictionary());

        var order = await orderService.CreateAsync(request, ct);
        return Results.Created($"/api/orders/{order.OrderId}", order);
    }
}
```

---

## Error Handling

### Problem Details (RFC 9457)

```csharp
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
    {
        context.ProblemDetails.Extensions["traceId"] =
            context.HttpContext.TraceIdentifier;
    };
});
```

### Result Pattern for Business Logic

```csharp
public abstract record Result<T>
{
    public sealed record Success(T Value) : Result<T>;
    public sealed record NotFound(string Message) : Result<T>;
    public sealed record ValidationFailed(IDictionary<string, string[]> Errors) : Result<T>;
    public sealed record Conflict(string Message) : Result<T>;
}
```

---

## Caching Strategy

### Output Caching

```csharp
builder.Services.AddOutputCache(options =>
{
    options.AddPolicy("ProductList", p =>
        p.Expire(TimeSpan.FromMinutes(5)).Tag("products"));
});
```

### HybridCache (.NET 9+)

```csharp
builder.Services.AddHybridCache(options =>
{
    options.DefaultEntryOptions = new HybridCacheEntryOptions
    {
        Expiration = TimeSpan.FromMinutes(10),
        LocalCacheExpiration = TimeSpan.FromMinutes(2)
    };
});
```

---

## Idempotency and Outbox Pattern

### Idempotency Keys

Prevent duplicate processing of retried requests:
1. **Scope keys** by route + user/tenant
2. **Atomically claim** the key before executing
3. **Store a concrete response envelope** for safe replay

### Transactional Outbox Pattern

Guarantee at-least-once delivery of domain events alongside database writes:

```csharp
await using var transaction = await _db.Database.BeginTransactionAsync(ct);
_db.Orders.Add(order);
_db.OutboxMessages.Add(new OutboxMessage { /* ... */ });
await _db.SaveChangesAsync(ct);
await transaction.CommitAsync(ct);
```

---

## Key Principles

- **Apply SOLID principles** -- Single Responsibility, Open/Closed, Dependency Inversion
- **Prefer composition over inheritance** -- use endpoint filters and middleware
- **Keep slices independent** -- avoid shared abstractions
- **Validate early, fail fast** -- validate at the boundary
- **Use Problem Details everywhere** -- consistent error format
- **Cache at the right level** -- output cache for HTTP, distributed cache for shared state
- **Make writes idempotent** -- use idempotency keys for retried operations

---

## Agent Gotchas

1. **Idempotency must handle three states** -- no-record, in-progress, completed
2. **Always finalize idempotency records unconditionally**
3. **Cache invalidation must be explicit** -- invalidate after writes
4. **HybridCache stampede protection only works with `GetOrCreateAsync`**
5. **Outbox messages must be written in the same transaction as domain data**
6. **Endpoint filter order matters** -- filters added first run outermost
7. **Do NOT share `DbContext` across concurrent requests**

## References

- [ASP.NET Core Best Practices](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices)
- [Minimal APIs overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview)
- [Vertical Slice Architecture (Jimmy Bogard)](https://www.jimmybogard.com/vertical-slice-architecture/)
