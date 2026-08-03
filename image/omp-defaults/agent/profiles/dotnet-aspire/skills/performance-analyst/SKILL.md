<!-- ported for oh-my-pi -->
---
name: performance-analyst
description: Expertise in .NET performance tuning, allocation reduction, async optimization, type design, and database access patterns.
---

# Performance Analyst

Use this skill when optimizing bottlenecks, reducing memory usage, or designing high-throughput systems.

## Key Principles
- **Measure First**: Never optimize without a benchmark (BenchmarkDotNet) or profile data.
- **Type Design**: Use `readonly struct` for small value types (<= 16 bytes). Seal classes by default to enable JIT devirtualization.
- **Database Hygiene**: Separate read/write models. Use `AsNoTracking()` for reads. Always apply row limits.
- **Allocation Awareness**: Use `Span<T>`, `Memory<T>`, and `ArrayPool<T>` in hot paths.

## Guidelines

### 1. Type Design & Performance
- **Struct vs Class**: Use `struct` for small, immutable types with value semantics.
- **Sealed Types**: Seal classes to allow the JIT to replace virtual calls with direct calls.
- **ValueTask**: Use `ValueTask<T>` for async methods that often complete synchronously (e.g., cache hits).

### 2. LINQ Optimization
- **Avoid Multiple Enumeration**: Materialize with `.ToList()` or `.ToArray()` if used more than once.
- **Avoid Count() > 0**: Use `.Any()` for existence checks to allow short-circuiting.
- **Avoid Premature Materialization**: Don't call `.ToList()` mid-chain in a LINQ query.

### 3. Database Performance
- **Batching**: Avoid N+1 queries by using `.Include()` or projection.
- **No Application-Side Joins**: Perform joins in SQL, not in C#.
- **Row Limits**: Never return unbounded result sets; always use `.Take(limit)`.

### 4. Memory & JSON
- **Source Generators**: Use `System.Text.Json` source generators for Native AOT and performance.
- **Buffers**: Use `ArrayPool<T>.Shared` to reuse large arrays.

## Checklist
- [ ] Are small, immutable types defined as `readonly struct`?
- [ ] Are classes `sealed` unless designed for inheritance?
- [ ] Are database queries using `AsNoTracking()` where appropriate?
- [ ] Are row limits (Take) applied to all collection queries?
- [ ] Is `ValueTask` used for methods with frequent synchronous completion?
- [ ] Are LINQ queries optimized to avoid multiple enumerations?
