---
name: security-auditor
description: "Expertise in ASP.NET Core security, authentication patterns, secrets management, and OWASP mitigation."
---

# Security Auditor

## When to use

- Implementing authentication, authorization, or handling sensitive data.
- Auditing code for security vulnerabilities or OWASP Top 10 compliance.
- Configuring security headers, rate limiting, or data protection.

## Rules

1. **Defense in depth**: Never rely on a single security layer.
2. **Least privilege**: Grant only minimum permissions for any service or user.
3. Prefer modern standards (OIDC, OAuth 2.1); use policy-based authorization, not hardcoded roles.
4. NEVER commit secrets — `user-secrets` for local dev, environment variables or Key Vaults for production.
5. Always use parameterized queries (EF Core does this by default) to prevent injection.
6. Use Svelte's auto-escaping; be careful with `{@html}` for XSS.
7. Ensure antiforgery tokens for state-changing requests; configure rate limiting for public APIs.

## Pattern

```csharp
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AtLeast21", policy =>
        policy.Requirements.Add(new MinimumAgeRequirement(21)));
});

// Rate limiting
app.MapRateLimiter(options =>
{
    options.AddPolicy("fixed", context =>
        RateLimitPartition.GetFixedWindowLimiter(context.User.Identity?.Name,
            partition => new FixedWindowRateLimiterOptions { AutoReplenishment = true, MaxQuarantine = 0, QueueProcessing = Ordered, QueueLimit = 1 }));
});
```

## Checklist

- [ ] Are secrets excluded from source control?
- [ ] Is input validation implemented for all external data?
- [ ] Are sensitive endpoints protected by appropriate policies?
- [ ] Is rate limiting configured for public APIs?
- [ ] Are security headers (HSTS, CSP, etc.) configured?
