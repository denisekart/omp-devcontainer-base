---
name: dotnet-architecture-patterns
description: "Organizing APIs at scale. Vertical slices, request pipelines, caching, error handling, idempotency."
---

# dotnet-architecture-patterns

## When to use

- Organizing a Minimal API by feature (vertical slice) rather than technical layer.
- Implementing background services, hosted workers, or polling loops.
- Adding outbox messaging for reliable cross-service event delivery.
- Configuring graceful shutdown with `CancellationToken` propagation.
- Designing idempotent endpoints with idempotency keys.

## Rules

1. Each vertical slice owns its endpoint, handler, validation, and data access — no shared controllers.
2. Route groups use `MapGroup` with `.WithTags()` for API organization.
3. Endpoint classes are static with a single `Handle` method accepting request, validator, service, and `CancellationToken`.
4. Background services inject `IServiceScopeFactory` for scoped service resolution; never share `DbContext` across requests.
5. Outbox messages are written in the same transaction as domain data.
6. Idempotency must handle three states: no-record, in-progress, completed — always finalize unconditionally.
7. Cache invalidation is explicit after writes; stampede protection requires `GetOrCreateAsync`.
8. Endpoint filter order matters — filters added first run outermost.

## Pattern

```csharp
// Vertical slice endpoint
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

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        _db.Orders.Add(order);
        _db.OutboxMessages.Add(new OutboxMessage { /* ... */ });
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/orders/{order.OrderId}", order);
    }
}

// BackgroundService with scoped resolution
public sealed class Worker : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = _scopeFactory.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IWorker>().RunAsync(stoppingToken);
            await Task.Delay(5000, stoppingToken);
        }
    }
}
```

## Checklist

- [ ] Does each feature have its own vertical slice directory?
- [ ] Are endpoints static with a single `Handle` method?
- [ ] Is `IServiceScopeFactory` used for scoped services in workers?
- [ ] Are exceptions caught to prevent host shutdown?
- [ ] Is the `CancellationToken` respected in all async calls?
- [ ] Are outbox messages written in the same transaction as domain data?
