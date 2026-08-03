<!-- ported for oh-my-pi -->
---
name: csharp-scripts
description: Writing and running single-file C# programs using top-level statements and the `dotnet <file>.cs` command in .NET 10.
---

# C# Scripts (.NET 10+)

Use this skill for quick prototyping, API testing, or small utility scripts without the overhead of a full `.csproj`.

## Workflow
1. **Create File**: Create a `.cs` file with top-level statements.
2. **Add Packages**: Use `#:package <Name>@<Version>` at the top of the file.
3. **Run**: Execute `dotnet <file>.cs` in the terminal.

## Example Script
```csharp
#:package Humanizer@2.14.1
using Humanizer;

Console.WriteLine("hello world".Titleize());

var data = new { Message = "Scripting is easy", Date = DateTime.Now };
Console.WriteLine($"{data.Message} at {data.Date}");
```

## Guidelines
- **Top-Level Statements**: No `class Program` or `static void Main` required.
- **Dependency Management**: Use `#:package` for NuGet dependencies.
- **AOT Compatibility**: File-based apps enable Native AOT by default. Use source-generated JSON if serializing.
- **Cleanup**: Delete the script and its cached artifacts when done.

## Checklist
- [ ] Is the .NET SDK version 10.0+?
- [ ] Are `#:package` directives used for dependencies?
- [ ] Is the script outside existing project directories to avoid `.csproj` conflicts?
- [ ] Are top-level statements used for simplicity?
