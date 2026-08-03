<!-- ported for oh-my-pi -->
---
name: caching-strategies
description: Comprehensive caching patterns for ASP.NET Core APIs. Covers output caching, memory caching, distributed caching with Redis, and HybridCache.
---

# Caching Strategies

Use this skill when optimizing application performance, choosing between memory and distributed caching, or implementing cache invalidation.

## Caching Hierarchy

| Strategy | Scope | Use Case | Latency |
|----------|-------|----------|---------|
| **Output Caching** | Server-wide | Full API responses | Low |
| **Memory Cache** | Single instance | Short-lived, expensive data | Very Low |
| **Distributed Cache** | Multi-instance | Shared data (Redis) | Medium |
| **HybridCache (.NET 9+)** | Multi-instance | Best of memory + distributed | Very Low |

## Guidelines

### 1. Output Caching (Minimal APIs)
Use for endpoints that don't change frequently.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOutputCache(opt => {
    opt.AddBasePolicy(b => b.Expire(TimeSpan.FromSeconds(10)));
});

var app = builder.Build();
app.UseOutputCache();

app.MapGet("/products", GetProducts).CacheOutput();
```

### 2. Memory Caching
Use for expensive computations within a single server instance. Always set a `SizeLimit`.

```csharp
public async Task<Data> GetDataAsync(string key)
{
    return await _cache.GetOrCreateAsync(key, async entry => {
        entry.SetSize(1);
        entry.SetAbsoluteExpiration(TimeSpan.FromMinutes(10));
        return await FetchFromDbAsync();
    });
}
```

### 3. HybridCache (.NET 9+)
The modern standard for .NET caching. Handles L1 (Memory) and L2 (Distributed) automatically.

```csharp
public async Task<Product> GetProductAsync(int id, CancellationToken ct)
{
    return await _hybridCache.GetOrCreateAsync(
        $"product:{id}",
        async cancel => await db.Products.FindAsync(id, cancel),
        cancellationToken: ct
    );
}
```

## Cache Invalidation
- **Time-based**: Absolute vs Sliding expiration.
- **Tag-based**: Use `IOutputCacheStore.EvictByTagAsync` for surgical invalidation.
- **Manual**: Remove specific keys when data changes (Write-through/Write-behind).

## Checklist
- [ ] Is the correct caching level chosen (L1 vs L2)?
- [ ] Are size limits set for memory cache?
- [ ] Is `CancellationToken` passed to cache operations?
- [ ] Is a strategy in place for cache invalidation?
- [ ] Is HybridCache used for new .NET 9+ implementations?
