---
name: caching-strategies
description: "Comprehensive caching patterns for ASP.NET Core APIs. Covers output caching, memory caching, distributed caching with Redis, and HybridCache."
---

# Caching Strategies

## When to use

- Optimizing application performance by choosing the right caching layer.
- Implementing cache invalidation after writes (write-through/write-behind).
- Serving shared data across multiple server instances.
- Reducing database load for frequently-read, infrequently-changed data.

## Rules

1. Choose the correct caching level: output cache for HTTP responses, memory cache for single-instance, distributed for multi-instance, HybridCache for the best of both.
2. Always set `SizeLimit` for memory cache entries to prevent unbounded growth.
3. Pass `CancellationToken` through all cache operations.
4. Use tag-based eviction (`EvictByTagAsync`) for surgical invalidation; never rely solely on time-based expiration.
5. HybridCache (.NET 9+) is the modern standard — handles L1 (memory) and L2 (distributed) automatically.

## Pattern

```csharp
// HybridCache — modern standard
public async Task<Product> GetProductAsync(int id, CancellationToken ct)
{
    return await _hybridCache.GetOrCreateAsync(
        $"product:{id}",
        async cancel => await db.Products.FindAsync(id, cancel),
        cancellationToken: ct
    );
}

// Tag-based invalidation
await _outputCache.EvictByTagAsync("products");
```

## Checklist

- [ ] Is the correct caching level chosen (L1 vs L2)?
- [ ] Are size limits set for memory cache?
- [ ] Is `CancellationToken` passed to cache operations?
- [ ] Is a strategy in place for cache invalidation?
- [ ] Is HybridCache used for new .NET 9+ implementations?
