<!-- ported for oh-my-pi -->
---
name: file-handling
description: Best practices for file I/O, streaming, and large file processing in .NET.
---

# File Handling

Use this skill when implementing file uploads, downloads, or disk-based data processing.

## Key Principles
- **Async I/O**: Always use `Async` methods (`File.ReadAllBytesAsync`, etc.).
- **Streaming**: Use `Stream` or `PipeReader` for large files to keep memory usage low.
- **Buffer Reuse**: Use `ArrayPool<byte>.Shared` for temporary buffers.
- **Security**: Sanitize file names and validate file types to prevent directory traversal and malware.

## Guidelines

### 1. Efficient Streaming
Avoid loading entire files into memory.

```csharp
await using var stream = File.OpenRead(path);
await stream.CopyToAsync(destination, ct);
```

### 2. File Uploads (Minimal APIs)
Use `IFormFile` or stream directly from the request.

```csharp
app.MapPost("/upload", async (IFormFile file) => {
    var path = Path.Combine("uploads", file.FileName);
    await using var stream = File.Create(path);
    await file.CopyToAsync(stream);
    return Results.Ok();
});
```

## Checklist
- [ ] Are all file operations asynchronous?
- [ ] Is streaming used for large files?
- [ ] Are file names sanitized (Path.GetFileName)?
- [ ] Are buffers reused via `ArrayPool`?
