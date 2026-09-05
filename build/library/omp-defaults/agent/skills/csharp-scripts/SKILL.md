---
name: csharp-scripts
description: "Writing and running single-file C# programs using top-level statements and the dotnet <file>.cs command in .NET 10."
---

# C# Scripts (.NET 10+)

## When to use

- Quick prototyping, API testing, or small utility scripts without full `.csproj` overhead.
- One-off data transformations or format conversions.
- Testing a library API before integrating into a project.

## Rules

1. Use top-level statements — no `class Program` or `static void Main` required.
2. Add NuGet dependencies with `#:package <Name>@<Version>` at the top of the file.
3. Run with `dotnet <file>.cs` — the SDK resolves packages and compiles on the fly.
4. File-based apps enable Native AOT by default; use source-generated JSON for serialization.
5. Delete the script and cached artifacts when done.

## Pattern

```csharp
#:package Humanizer@2.14.1
using Humanizer;

Console.WriteLine("hello world".Titleize());

var data = new { Message = "Scripting is easy", Date = DateTime.Now };
Console.WriteLine($"{data.Message} at {data.Date}");
```

## Checklist

- [ ] Is the .NET SDK version 10.0+?
- [ ] Are `#:package` directives used for dependencies?
- [ ] Is the script outside existing project directories to avoid `.csproj` conflicts?
- [ ] Are top-level statements used for simplicity?
