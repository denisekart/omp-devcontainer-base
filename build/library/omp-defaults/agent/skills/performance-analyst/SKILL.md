---
name: performance-analyst
description: "Expertise in .NET performance tuning, allocation reduction, async optimization, type design, and database access patterns."
---

# Performance Analyst

## When to use

- Optimizing bottlenecks, reducing memory allocations, or designing high-throughput systems.
- Deciding between `struct`/`class`, `ValueTask`/`Task`, or synchronous/async I/O.
- Implementing file uploads, downloads, or disk-based streaming processing.
- Optimizing LINQ chains, database queries, or JSON serialization paths.

## Rules

1. Measure first — never optimize without benchmark or profile data.
2. Use `readonly struct` for small, immutable value types (≤ 16 bytes); seal classes by default for JIT devirtualization.
3. Always accept and propagate `CancellationToken`; avoid `.Result`/`.Wait()` deadlocks.
4. Use `AsNoTracking()` for all read-only queries; separate read/write models in large systems.
5. Apply row limits (`.Take()`) to every collection query; use `.Any()` not `.Count() > 0`.
6. Use `ArrayPool<T>.Shared` for temporary buffers in hot paths; stream large files instead of loading into memory.
7. Use `ValueTask<T>` for async methods that frequently complete synchronously (e.g., cache hits).
8. Use `Span<T>`/`Memory<T>` in hot paths; prefer source generators for `System.Text.Json` Native AOT.

## Pattern

```csharp
// Efficient streaming with pooled buffer
await using var stream = File.OpenRead(path);
var buffer = ArrayPool<byte>.Shared.Rent(81920);
try {
    await stream.CopyToAsync(new MemoryStream(), buffer, ct);
} finally { ArrayPool<byte>.Shared.Return(buffer); }

// ValueTask for cache hits
public ValueTask<Data> GetAsync(string key)
{
    if (_cache.TryGetValue(key, out var data)) return new(data);
    return FetchFromDbAsync(key);
}
```

## Checklist

- [ ] Are small, immutable types defined as `readonly struct`?
- [ ] Are classes `sealed` unless designed for inheritance?
- [ ] Is `AsNoTracking()` used for all read-only queries?
- [ ] Are row limits (`Take`) applied to all collection queries?
- [ ] Is `ValueTask` used for methods with frequent sync completion?
- [ ] Are file operations async with streaming and buffer reuse?
