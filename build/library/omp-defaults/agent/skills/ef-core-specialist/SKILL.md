---
name: ef-core-specialist
description: "Advanced EF Core patterns, including architecture, performance, migrations, and clean data modeling."
---

# EF Core Specialist

## When to use

- Designing data models, configuring `DbContext`, or optimizing database access via EF Core.
- Mapping value objects, strongly-typed IDs, or shadow properties.
- Setting up global query filters for soft-delete or multi-tenancy.
- Optimizing queries with projections, compiled queries, or bulk operations.

## Rules

1. Keep entities as clean POCOs; use Fluent API for all model configurations.
2. Separate read models (projections) from write models (aggregates); use `AsNoTracking()` for reads.
3. Load and save entity clusters together as consistency boundaries — respect aggregate boundaries.
4. Use `.Select()` projections to fetch only required columns; compiled queries for hot paths.
5. Use `ExecuteUpdateAsync`/`ExecuteDeleteAsync` for bulk operations (.NET 7+).
6. Always review migration SQL before applying; use idempotent scripts for production.

## Pattern

```csharp
// Value object mapping via OwnsOne
modelBuilder.Entity<Order>().OwnsOne(o => o.Address, a => {
    a.Property(a => a.Street).HasMaxLength(200);
});

// Global query filter for soft-delete
modelBuilder.Entity<Order>().HasQueryFilter(o => !o.IsDeleted);

// Compiled query for hot path
private static readonly Func<AppDbContext, int, Task<Order?>> _getById =
    EF.CompileAsyncQuery((AppDbContext db, int id) => db.Orders.FirstOrDefault(o => o.Id == id));
```

## Checklist

- [ ] Is business logic kept out of the `DbContext` and entities?
- [ ] Are navigation properties restricted to aggregate boundaries?
- [ ] Is `AsNoTracking()` used for all read-only queries?
- [ ] Are all I/O operations asynchronous?
- [ ] Is the database schema optimized with appropriate indexes?
- [ ] Are row limits enforced on all collection queries?
