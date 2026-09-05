---
name: solution-navigation
description: "Efficiently navigating large .NET solutions, project structures, and dependency graphs — AppHost-first."
---

# Solution Navigation

## When to use

- Exploring a new codebase, identifying project boundaries, or tracing data flow across the solution.
- Understanding the distributed topology of an Aspire-hosted application.
- Tracing a request from API surface through application layer to database.

## Rules

1. **AppHost-first**: Start with the `AppHost` to understand what resources (DBs, APIs, Workers) exist and how they connect.
2. **ServiceDefaults**: Shows global OTEL, health checks, and resilience configuration.
3. **Web project**: Shows the API surface (Minimal APIs) and middleware pipeline.
4. **Application layer**: Search for "Handlers", "Services", or "Commands" for business logic.
5. **Domain layer**: Search for "Entities", "ValueObjects", and "Aggregates".

## Pattern

```
Request flow:
AppHost → Web/Endpoints/ → Application/Handlers/ → Domain/Entities/ → Infrastructure/EF Core/
```

## Checklist

- [ ] Is the `AppHost` reviewed to understand the full system scope?
- [ ] Are project dependencies correctly identified?
- [ ] Is the request flow traced from API to Database?
- [ ] Are aggregate boundaries clearly understood?
