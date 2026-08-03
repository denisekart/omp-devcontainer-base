<!-- ported for oh-my-pi -->
---
name: backend-conventions
description: Guidelines for ASP.NET Core 10, C# 14, Clean Architecture, and EF Core in the project.
---

# Backend Conventions

Use this skill when developing backend features, designing database schemas, or working with Aspire orchestration.

## Key Principles
- **Clean Architecture**: Strictly separate Domain, Application, and Infrastructure layers.
- **Service Layer Pattern**: All business logic must live in the Service layer (Handlers/Use Case services).
- **Minimal API Grouping**: Use `MapGroup` to properly organize and version API endpoints.
- **Dependency Injection**: Explicitly manage service lifetimes (Transient, Scoped, Singleton).

## Guidelines
- **Minimal APIs**: Prefer Minimal APIs. Keep endpoints thin; they should only handle request binding and calling the appropriate service.
- **Logic Placement**: Never add business logic directly in the Minimal API endpoint delegate. Always delegate to a dedicated handler service.
- **EF Core**: Use Fluent API for all model configurations. Entities must remain POCO.
- **Aspire**: Use `ServiceDefaults` for all service registrations and health checks.
- **PostgreSQL/MySQL**: Optimize queries and use appropriate indexing.
- **Async/Await**: Ensure all I/O bound operations are asynchronous.
- **Error Handling**: Use the built-in exception-to-problem-details mapping in ASP.NET Core 10.

## Dependency Injection (DI)
- **Transient**: For lightweight, stateless services (e.g., handlers).
- **Scoped**: For services that should share state within a single request (e.g., DbContext).
- **Singleton**: For stateful services shared across the application (e.g., caches).

## Example: Grouped Minimal API with Service Delegation
```csharp
public static class UserEndpoints
{
    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/users").WithTags("Users");

        group.MapGet("/{id}", async (Guid id, IUserHandler handler) =>
        {
            // Thin endpoint: only calls the handler
            var user = await handler.GetUserByIdAsync(id);
            return user is not null ? Results.Ok(user) : Results.NotFound();
        });
    }
}
```

## Checklist
- [ ] Is business logic in the Service/Domain layer?
- [ ] Are Minimal API endpoints thin (delegating to handlers)?
- [ ] Are endpoints properly grouped using `MapGroup`?
- [ ] Are DI lifetimes correctly assigned (Transient/Scoped/Singleton)?
- [ ] Are DTOs using C# 14 records?
- [ ] Is Fluent API used for EF Core?
- [ ] Are all I/O operations asynchronous?
