<!-- ported for oh-my-pi -->
---
name: solution-navigation
description: Efficiently navigating and understanding large .NET solutions, project structures, and dependency graphs.
---

# Solution Navigation

Use this skill when exploring a new codebase, identifying project boundaries, or tracing data flow across the solution.

## Key Principles
- **Top-Down Approach**: Start with the `AppHost` (orchestration) to understand the distributed topology.
- **Dependency Flow**: Identify the relationships between `Domain`, `Application`, `Infrastructure`, and `Web` projects.
- **Boundary Identification**: Recognize Clean Architecture layers and aggregate boundaries.

## Navigation Strategies

### 1. The Entry Points
- **AppHost**: Shows what resources (DBs, APIs, Workers) exist and how they connect.
- **ServiceDefaults**: Shows global configurations for OTEL, health checks, and resilience.
- **Web Project**: Shows the API surface (Minimal APIs) and middleware pipeline.

### 2. Finding Business Logic
- **Application Layer**: Search for "Handlers", "Services", or "Commands".
- **Domain Layer**: Search for "Entities", "ValueObjects", and "Aggregates".

### 3. Tracing a Request
1. Start at `Endpoints/` (Web).
2. Follow the call to `IAppService` (Application).
3. Follow database access to `IRepository` (Infrastructure/EF Core).

## Checklist
- [ ] Is the `AppHost` reviewed to understand the full system scope?
- [ ] Are project dependencies correctly identified?
- [ ] Is the request flow traced from API to Database?
- [ ] Are aggregate boundaries clearly understood?
