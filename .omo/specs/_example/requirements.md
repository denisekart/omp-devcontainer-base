# Example: Health Endpoint Requirements

> SDD-lite triggered: this change introduces a new API contract (criterion c) and a new durable service endpoint (criterion a) — 2+ rubric points met.

## Functional Requirements

- R1: WHEN a client sends `GET /health` THE System SHALL return HTTP 200 with JSON body `{"status": "healthy"}` if all dependencies are reachable.
- R2: WHEN a client sends `GET /health` AND the database connection is unavailable THE System SHALL return HTTP 503 with JSON body `{"status": "degraded", "reason": "database"}`.
- R3: THE System SHALL NOT expose internal stack traces or secrets in the health endpoint response.
- R4: IF the health check takes longer than 2 seconds THE System SHALL return HTTP 503 with `{"status": "timeout"}`.

## Non-Functional Requirements

- NF1: THE health endpoint SHALL respond within 200ms under normal load.
- NF2: THE health endpoint SHALL be accessible without authentication.

## Correctness Properties

- P1: For any request to `GET /health`, the response status code SHALL be either 200 or 503.
- P2: The response body SHALL always be valid JSON.
