<!-- ported for oh-my-pi -->
---
name: dotnet-aspire
description: Guidelines for .NET Aspire orchestration, resource management, and distributed application patterns.
---

# .NET Aspire

Use this skill when managing cloud-native orchestration, defining resources in the AppHost, or configuring service defaults. **Aspire is our primary orchestration tool for both production and testing.**

## Key Principles
- **Exclusive Orchestration**: Use Aspire for all infrastructure dependencies. **Do not use Testcontainers**; rely on Aspire's `WithReference` and `Aspire.Hosting.Testing`.
- **Resource Naming**: Use consistent, lowercase names for resources (e.g., `postgres`, `redis`, `api`).
- **Service Discovery**: Use Aspire's built-in service discovery via endpoint names.
- **Observability**: Leverage the Aspire Dashboard for traces, logs, metrics, and resource status.

## Guidelines

### 1. AppHost Configuration
- **Backing Services**: Use Aspire Components (PostgreSQL, Redis, RabbitMQ) to manage containers.
- **Project References**: Use `AddProject<Projects.App_Web>("api")` to wire application projects.
- **Reference Management**: Map connection strings and environment variables using `WithReference()`.
- **Startup Ordering**: Use `WaitFor(resource)` to control the sequence of resource startup.

### 2. ServiceDefaults
- **Shared Config**: Ensure every service project references and uses the `ServiceDefaults` project.
- **Health Checks**: Always register health checks in `ServiceDefaults` and verify them in the Dashboard.
- **Resilience**: Apply standard resilience patterns (retry, circuit breaker) to all outgoing HTTP calls.

### 3. Distributed Testing
- **AppHost Testing Framework**: Use `Aspire.Hosting.Testing` to write integration tests.
- **Verification**: Assert resource availability, healthy status, and inter-service communication.

### 4. Manifests & Deployment
- **Deployment Manifests**: Use `WithExternalHttpEndpoints()` to mark endpoints as public for tools like `azd`.

## Example: Complex Topology
```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("pg").WithPgAdmin().AddDatabase("appdb");
var redis = builder.AddRedis("cache");

var api = builder.AddProject<Projects.App_Web>("api")
    .WithReference(postgres)
    .WithReference(redis);

builder.AddProject<Projects.App_Worker>("worker")
    .WithReference(postgres)
    .WaitFor(api); // Start worker after API is healthy

builder.Build().Run();
```

## Checklist
- [ ] Are all external resources defined in `AppHost`?
- [ ] Is service discovery used instead of hardcoded URLs?
- [ ] Are health checks correctly mapped to `/health`?
- [ ] Do all services reference `ServiceDefaults`?
- [ ] Are resource dependencies handled with `WaitFor`?
- [ ] Is the Aspire Dashboard used for local debugging and traces?
