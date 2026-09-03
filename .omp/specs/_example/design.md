# _example — Design

> Companion to `requirements.md`; standard tier.
> This directory (`.omp/specs/_example/`) is the worked reference example referenced by the `plan-workflow` skill.

## Architecture

A single in-process endpoint. `GET /health` is registered as an ASP.NET Core Minimal API in `App.Web/Program.cs`:

```csharp
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
```

## Why (topology)

- No new service, no new project, no Aspire resource change: the web host already owns the HTTP surface, and a liveness probe is a host concern, not a service concern.
- No new external contract: the route is additive and versionless; the response shape is fixed by R1.

## Correctness properties

- **Stateless** — the handler captures no request state and no scoped service.
- **Idempotent** — repeated GETs produce the same result with no side effects (enforced by R3/R4).
- **Failure isolation** — `/health` reports process liveness only; it SHALL NOT aggregate upstream health (out of scope per R3).

## Data flow

`HTTP GET /health` → Kestrel → Minimal API handler → `Results.Ok(new { status = "ok" })` → JSON `200`. No middleware dependency beyond the default pipeline; no auth-middleware interaction (R2).

## Test strategy

xUnit + `WebApplicationFactory<Program>`:

- **R1**: `GET /health` → assert 200 and body `{"status":"ok"}`.
- **R2**: unauthenticated request → assert 200 (no 401 path).
- **R3**: primary evidence is the absence of injected dependencies/upstream calls in the handler; keep timing assertions out of the deterministic suite (flaky).
- **R4**: assert the route handler is a parameterless lambda and that `DbContext` is never resolved for `/health`.
