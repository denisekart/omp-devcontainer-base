# Draft — smoke-license-note

> Slug: smoke-license-note
> Tier: trivial
> Intent: CLEAR

## TL;DR

Add a `## License` section to the root `README.md` of `omp-devcontainer-base` recording the image's license, as a **behavioral smoke test** of the SDD workflow (this task exercises the plan-mode draft → approval → materialization → execution → progress-tracking mechanics end-to-end).

## Scope IN

- One new `## License` section in the root `README.md`, placed before `## For Maintainers`
- The smoke test itself: a plan-mode flow with a stored draft iteration (revision log v1 → v2), approval via `xd://propose`, materialization of `.omp/plans/smoke-license-note.md`, integrity check, todo execution, checkbox flip, and dated Progress lines

## Scope OUT

- No changes to any other file (no LICENSE file creation, no docs changes beyond this one README section)
- No product code, tests, or tooling changes

## Components ledger

- `C1 README.md License section` — the only file change; can succeed/fail independently of everything else
- `C2 SDD mechanics under test` — the plan file, integrity check, and Progress lines; their correctness is the actual subject of this smoke test

## Open assumptions

- **A1**: The license is **MIT** (adopted default; rationale: the project already ships under the MIT badge in `README.md`; reversible: change the one-line section text)
- **A2**: Target file is the root `README.md`, not `docs/README.md` (rationale: `docs/README.md` does not exist in this repo; surfaced as spec drift, see Revision log v2)
- **A3**: One todo is sufficient (single file, single section); trivial tier → no spec files, no critic rounds

## Questions

- None — all open items resolved by announced defaults (A1–A3)

## Revision log

- v1 — 2026-09-03 13:02 — initial draft; target was `docs/README.md` per the smoke-test spec
- v2 — 2026-09-03 13:03 — target corrected to root `README.md`: `docs/README.md` does not exist in this repo (spec drift, surfaced to owner; default adopted per UNCLEAR-mode rule: announce, do not interrogate)
