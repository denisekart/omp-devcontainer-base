---
name: dotnet-aspire
description: "AppHost orchestration, resource management, distributed application patterns, and observability."
---

# .NET Aspire

## When to use

- Managing cloud-native orchestration, defining resources in the AppHost, or configuring service defaults.
- Wiring application projects with backing services via `WithReference()` and `WaitFor()`.
- Setting up distributed testing with `Aspire.Hosting.Testing`.
- Configuring observability (traces, logs, metrics) and health checks.

## Rules

1. **Exclusive orchestration**: Use Aspire for all infrastructure dependencies — no Testcontainers.
2. **Resource naming**: Use consistent, lowercase names (`postgres`, `redis`, `api`).
3. **Service discovery**: Use Aspire's built-in discovery via endpoint names, not hardcoded URLs.
4. **ServiceDefaults**: Every service project must reference and use the `ServiceDefaults` project.
5. **Resilience**: Apply retry/circuit-breaker patterns to all outgoing HTTP calls.
6. **Health checks**: Always register health checks and verify them in the Dashboard.

## Pattern

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("pg").WithPgAdmin().AddDatabase("appdb");
var redis = builder.AddRedis("cache");

var api = builder.AddProject<Projects.App_Web>("api")
    .WithReference(postgres).WithReference(redis);

builder.AddProject<Projects.App_Worker>("worker")
    .WithReference(postgres).WaitFor(api);

builder.Build().Run();
```

## Checklist

- [ ] Are all external resources defined in `AppHost`?
- [ ] Is service discovery used instead of hardcoded URLs?
- [ ] Are health checks correctly mapped to `/health`?
- [ ] Do all services reference `ServiceDefaults`?
- [ ] Are resource dependencies handled with `WaitFor`?
- [ ] Is the Aspire Dashboard used for local debugging and traces?
