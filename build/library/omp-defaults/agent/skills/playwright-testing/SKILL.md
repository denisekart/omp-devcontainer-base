---
name: playwright-testing
description: "Guidelines for end-to-end (E2E) testing using Playwright for .NET with Aspire orchestration."
---

# Playwright Testing (.NET)

## When to use

- Writing, debugging, or optimizing E2E tests for the frontend using Playwright for .NET.
- Verifying inter-service communication in a full Aspire-hosted environment.
- Recording interactions via `playwright codegen` or enabling trace viewer in CI.

## Rules

1. **Data-testid first**: Always prefer `Page.GetByTestId("id")` over other locators.
2. **Semantic fallback**: Use `GetByRole` or `GetByLabel` when a TestId is not appropriate.
3. **Auto-waiting**: Rely on Playwright's built-in waiting and `Expect()` assertions.
4. **Aspire orchestration**: Always use `DistributedApplicationTestingBuilder` for dynamic ports and backing services.
5. Tests must be independent and self-contained; use `[Retry]` sparingly.

## Pattern

```csharp
[Fact]
public async Task Login_ValidUser_RedirectsToDashboard()
{
    var appHost = await DistributedApplicationTestingBuilder.CreateAsync<TAppHost>();
    await using var app = await appHost.BuildAsync();
    await app.StartAsync();

    var baseUrl = app.GetEndpoint("frontend");
    await Page.GotoAsync(baseUrl.ToString());

    await Page.GetByTestId("email").FillAsync("user@example.com");
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
