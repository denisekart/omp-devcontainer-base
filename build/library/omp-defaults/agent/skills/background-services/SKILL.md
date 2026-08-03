<!-- ported for oh-my-pi -->
---
name: background-services
description: Hosted services, background jobs, outbox patterns, and graceful shutdown handling for ASP.NET Core applications.
---

# Background Services

Use this skill when implementing background processing, handling outbox patterns, or managing graceful service shutdown in ASP.NET Core applications.

## Key Principles
- **Separation of Concerns**: Offload long-running work from the request pipeline.
- **Reliability**: Use the Outbox pattern to ensure messages are never lost.
- **Observability**: Always log worker starts, stops, and errors.
- **Graceful Degradation**: Respect the `CancellationToken` for clean shutdowns.

## BackgroundService vs IHostedService

| Feature | `BackgroundService` | `IHostedService` |
|---------|-------------------|-----------------|
| Purpose | Continuous work / polling loop | Startup/shutdown hooks |
| Lifetime | Runs until host shutdown | `StartAsync` at startup, `StopAsync` at shutdown |

## Guidelines

### 1. Basic BackgroundService Structure
Inject `IServiceScopeFactory` to use scoped services within a singleton worker.

```csharp
public sealed class Worker(IServiceScopeFactory scopeFactory, ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<IBusinessService>();
                await service.DoWorkAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Error in worker");
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }
    }
}
```

### 2. Outbox Pattern
Store messages in the database transactionally before async processing to ensure reliability.

```csharp
public async Task CreateOrderAsync(Order order)
{
    await using var transaction = await _db.Database.BeginTransactionAsync();
    _db.Orders.Add(order);
    _db.OutboxMessages.Add(new OutboxMessage { Payload = Serialize(order) });
    await _db.SaveChangesAsync();
    await transaction.CommitAsync();
}
```

### 3. Graceful Shutdown
Always pass the `stoppingToken` to I/O operations and avoid blocking the `StartAsync` method.

## Checklist
- [ ] Is `IServiceScopeFactory` used for scoped services?
- [ ] Are exceptions caught to prevent host shutdown?
- [ ] Is the `CancellationToken` respected in all async calls?
- [ ] Is back-off logic implemented for errors?
- [ ] Is the Outbox pattern used for critical cross-service messaging?
