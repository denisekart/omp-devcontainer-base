<!-- ported for oh-my-pi -->
---
name: concurrency-patterns
description: Choosing the right concurrency abstraction in .NET. Covers async/await, Channels, Parallel.ForEachAsync, and synchronization primitives.
---

# .NET Concurrency Patterns

Use this skill when deciding how to handle concurrent operations, managing shared state, or processing data streams.

## Decision Matrix
1. **Wait for I/O?** -> Use `async/await`.
2. **Process collection in parallel (CPU-bound)?** -> Use `Parallel.ForEachAsync`.
3. **Producer/Consumer pattern?** -> Use `System.Threading.Channels`.
4. **Coordinate multiple async operations?** -> Use `Task.WhenAll` / `Task.WhenAny`.
5. **Protect shared mutable state?**
    - Single scalar? -> `Interlocked`.
    - Key-value lookup? -> `ConcurrentDictionary`.
    - Async-compatible lock? -> `SemaphoreSlim.WaitAsync`.
    - Simple, synchronous section? -> `lock`.

## Guidelines

### 1. Async/Await (Default Choice)
Always accept `CancellationToken`. Avoid `.Result` or `.Wait()` which cause deadlocks.

```csharp
public async Task<Data> FetchAsync(string id, CancellationToken ct)
{
    var tasks = new[] { _serviceA.Get(id, ct), _serviceB.Get(id, ct) };
    await Task.WhenAll(tasks);
    return Combine(tasks[0].Result, tasks[1].Result);
}
```

### 2. Channels (Producer/Consumer)
Use `Channel<T>` for high-performance, non-blocking message passing between threads.

```csharp
var channel = Channel.CreateBounded<WorkItem>(100);
// Producer
await channel.Writer.WriteAsync(item, ct);
// Consumer
await foreach (var item in channel.Reader.ReadAllAsync(ct)) { /* ... */ }
```

### 3. Parallel.ForEachAsync
Efficient parallel processing of collections with controlled degree of parallelism.

```csharp
await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 4 }, async (item, ct) => {
    await ProcessAsync(item, ct);
});
```

## Checklist
- [ ] Is `async/await` used for all I/O?
- [ ] Is `CancellationToken` propagated through all async calls?
- [ ] Are thread-safe collections used for shared data?
- [ ] Is `SemaphoreSlim` used if locking is required in an async context?
- [ ] Are deadlocks avoided by not mixing sync and async?
