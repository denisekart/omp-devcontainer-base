---
name: concurrency-patterns
description: "Choosing the right concurrency abstraction in .NET. Covers async/await, Channels, Parallel.ForEachAsync, and synchronization primitives."
---

# .NET Concurrency Patterns

## When to use

- Deciding how to handle concurrent operations, manage shared state, or process data streams.
- Choosing between `async/await`, `Parallel.ForEachAsync`, `Channel<T>`, or `Task.WhenAll`.
- Protecting shared mutable state across threads or async boundaries.

## Rules

1. **Wait for I/O?** → `async/await`. **CPU-bound parallel?** → `Parallel.ForEachAsync`. **Producer/Consumer?** → `Channel<T>`.
2. Always accept and propagate `CancellationToken`; avoid `.Result`/`.Wait()` deadlocks.
3. Use `SemaphoreSlim.WaitAsync()` for async-compatible locks; `lock` for simple synchronous sections.
4. Use thread-safe collections (`ConcurrentDictionary`, `Interlocked`) for shared mutable state.
5. `Task.WhenAll` for fan-out; `Task.WhenAny` for first-to-complete.

## Pattern

```csharp
// Parallel.ForEachAsync — CPU-bound fan-out
await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 4 },
    async (item, ct) => await ProcessAsync(item, ct));

// Channel — producer/consumer
var channel = Channel.CreateBounded<WorkItem>(100);
await channel.Writer.WriteAsync(item, ct);
await foreach (var item in channel.Reader.ReadAllAsync(ct)) { /* ... */ }
```

## Checklist

- [ ] Is `async/await` used for all I/O?
- [ ] Is `CancellationToken` propagated through all async calls?
- [ ] Are thread-safe collections used for shared data?
- [ ] Is `SemaphoreSlim` used if locking is required in an async context?
- [ ] Are deadlocks avoided by not mixing sync and async?
