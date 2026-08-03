<!-- ported for oh-my-pi -->
---
name: ef-core-specialist
description: Advanced EF Core patterns, including architecture, performance, migrations, and clean data modeling.
---

# EF Core Specialist

Use this skill when designing data models, configuring DbContext, or optimizing database access via EF Core.

## Key Principles
- **Separation of Concerns**: Separate read models (projections) from write models (aggregates).
- **Aggregate Boundaries**: Load and save clusters of entities together as consistency boundaries.
- **Fluent API**: Use Fluent API for all model configurations; keep entities as clean POCOs.
- **Performance**: Govern N+1 queries, use `AsNoTracking()` for reads, and apply row limits.

## Guidelines

### 1. Read/Write Split
Use a single `DbContext` but apply `AsNoTracking()` for queries. For large systems, consider separate `ReadDbContext` and `WriteDbContext`.

### 2. Global Query Filters
Use for soft-deletes or multi-tenancy.
```csharp
modelBuilder.Entity<Order>().HasQueryFilter(o => !o.IsDeleted);
```

### 3. Advanced Modeling
- **Value Objects**: Map value objects (records) to JSON columns or separate columns using `.OwnsOne()`.
- **Strongly-Typed IDs**: Use records to wrap IDs and configure them using `ValueConverter`.
- **Shadow Properties**: Use for metadata like `CreatedAt` or `LastModifiedAt` to keep them out of domain entities.

### 4. Query Optimization
- **Projections**: Always use `.Select()` to only fetch required columns.
- **Compiled Queries**: Use for frequently executed, performance-critical queries.
- **Batching**: Use `ExecuteUpdateAsync` and `ExecuteDeleteAsync` for bulk operations (.NET 7+).

### 5. Migrations
Always review migration SQL before applying. Use idempotent scripts for production deployments.

## Checklist
- [ ] Is business logic kept out of the DbContext and entities?
- [ ] Are navigation properties restricted to aggregate boundaries?
- [ ] Is `AsNoTracking()` used for all read-only queries?
- [ ] Are all I/O operations asynchronous?
- [ ] Is the database schema optimized with appropriate indexes?
- [ ] Are row limits enforced on all collection queries?
