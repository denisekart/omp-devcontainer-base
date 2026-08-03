<!-- ported for oh-my-pi -->
---
name: security-auditor
description: Expertise in ASP.NET Core security, authentication patterns, secrets management, and OWASP mitigation.
---

# Security Auditor

Use this skill when implementing authentication, authorization, handling sensitive data, or auditing code for vulnerabilities.

## Key Principles
- **Defense in Depth**: Never rely on a single security layer.
- **Least Privilege**: Grant only the minimum permissions necessary for any service or user.
- **Secure Defaults**: Configure the system to be secure out of the box.

## Guidelines
- **Authentication**: Prefer modern standards (OIDC, OAuth 2.1). Use ASP.NET Core Identity for user management if applicable.
- **Authorization**: Use Policy-based authorization. Avoid hardcoding roles in `[Authorize]` attributes.
- **Secrets Management**: NEVER commit secrets. Use `user-secrets` for local dev, and Environment Variables or Key Vaults for production.
- **OWASP Mitigation**:
    - **Injection**: Always use parameterized queries (EF Core does this by default).
    - **XSS**: Use Svelte's auto-escaping. Be careful with `{@html}`.
    - **CSRF**: Ensure Antiforgery tokens are used for state-changing requests.
- **Data Protection**: Use the Data Protection API for encrypting sensitive values at rest.
- **Rate Limiting**: Use the built-in `Microsoft.AspNetCore.RateLimiting` middleware to prevent DoS.

## Example: Policy-based Authorization
```csharp
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AtLeast21", policy =>
        policy.Requirements.Add(new MinimumAgeRequirement(21)));
});
```

## Checklist
- [ ] Are secrets excluded from source control?
- [ ] Is input validation implemented for all external data?
- [ ] Are sensitive endpoints protected by appropriate policies?
- [ ] Is rate limiting configured for public APIs?
- [ ] Are security headers (HSTS, CSP, etc.) configured?
