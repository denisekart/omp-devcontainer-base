<!-- ported for oh-my-pi -->
---
name: playwright-testing
description: Guidelines for end-to-end (E2E) testing using Playwright for .NET with Aspire orchestration.
---

# Playwright Testing (.NET)

Use this skill when writing, debugging, or optimizing E2E tests for the frontend using Playwright for .NET.

## Key Principles
- **Data-TestId First**: Always prefer `Page.GetByTestId("id")` (which maps to `[data-testid='id']`).
- **Semantic Locators**: Fall back to `GetByRole` or `GetByLabel` if a TestId is not appropriate.
- **Aspire Integration**: Use `Aspire.Hosting.Testing` to spin up the full AppHost environment.
- **Auto-Waiting**: Rely on Playwright's built-in waiting and `Expect()` assertions.

## Guidelines

### 1. Project Setup
- Use `Microsoft.Playwright.Xunit` for base classes.
- Install browsers via `dotnet tool run playwright install`.

### 2. Interactions
- **Role-based**: `Page.GetByRole(AriaRole.Button, new() { Name = "Submit" })`.
- **Interactions**: Use `FillAsync`, `ClickAsync`, `CheckAsync`, and `SelectOptionAsync`.

### 3. Debugging & Tools
- **Trace Viewer**: Enable traces in CI to record every step, screenshot, and console log.
- **Codegen**: Use `playwright codegen` to record interactions and generate C# code.

### 4. Aspire Orchestration
Always use `DistributedApplicationTestingBuilder` to ensure your tests target the correct dynamic ports and backing services.

## Example: Reliable E2E Test
```csharp
[Fact]
public async Task Login_ValidUser_RedirectsToDashboard()
{
    var appHost = await DistributedApplicationTestingBuilder.CreateAsync<TAppHost>(); // TAppHost = the generated AppHost project type (see AGENTS.md Project Paths)
    await using var app = await appHost.BuildAsync();
    await app.StartAsync();

    var baseUrl = app.GetEndpoint("frontend");
    await Page.GotoAsync(baseUrl.ToString());

    await Page.GetByTestId("email").FillAsync("user@example.com");
    await Page.GetByTestId("password").FillAsync("P@ssw0rd!");
    await Page.GetByTestId("login-btn").ClickAsync();

    await Expect(Page).ToHaveURLAsync(new Regex("/dashboard"));
}
```

## Checklist
- [ ] Are `GetByTestId` locators prioritized?
- [ ] Is `Aspire.Hosting.Testing` used for orchestration?
- [ ] Are auto-waiting and `Expect()` used for assertions?
- [ ] Are tests independent and self-contained?
- [ ] Is `CancellationToken` used where appropriate?
