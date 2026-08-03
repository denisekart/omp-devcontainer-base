# Example: Health Endpoint Design

## Architecture

The health endpoint is a thin handler in the API layer that delegates to a `HealthService`.

```
GET /health
  → HealthHandler.Check()
    → HealthService.CheckAll()
      → DatabaseProbe.Ping()    (2s timeout)
    → returns HealthResult
  → JSON response (200 or 503)
```

## Components

- `HealthHandler` — maps HTTP request to `HealthService.CheckAll()`, maps result to HTTP response
- `HealthService` — coordinates probes, enforces 2s total timeout
- `DatabaseProbe` — single ping query, returns reachable/unreachable

## Correctness Properties (testable)

- For any `HealthResult`, exactly one of `{healthy, degraded, timeout}` SHALL be set (no null/empty status)
- The HTTP status code SHALL be 200 iff `result.Status == "healthy"`
