# _example — Requirements

> Tier: standard
> Feature: GET /health endpoint on App.Web
>
> This directory (`.omp/specs/_example/`) is the worked reference example of an EARS
> requirements + design spec pair. Real specs live at `.omp/specs/<slug>/`.

## R1 — Status response

WHEN a client sends `GET /health`, THE `App.Web` host SHALL respond `200 OK` with a JSON body `{"status":"ok"}`.

- Verification hint: `curl -s http://localhost:<port>/health` returns 200 and the body contains `"status":"ok"`; unit test via `WebApplicationFactory`.

## R2 — No authentication required

WHEN a client sends `GET /health` without credentials, THE `App.Web` host SHALL respond `200`; the endpoint SHALL NOT require authentication or authorization.

- Verification hint: `curl` without an `Authorization` header returns 200, not 401.

## R3 — No upstream calls

WHEN the process is alive, THE `/health` endpoint SHALL respond within 100 ms and SHALL NOT call any external service, database, or message broker.

- Verification hint: the handler is registered with no injected dependencies (inspect `Program.cs`); unit test runs without external fixtures; timing is a secondary smoke check.

## R4 — No store writes

IF `/health` is invoked, THE `App.Web` host SHALL NOT create, update, or delete any record in any store (database, cache, or file system).

- Verification hint: code inspection — the handler closure references no `DbContext`/scoped store; unit test asserts no `DbContext` is resolved for the route.
