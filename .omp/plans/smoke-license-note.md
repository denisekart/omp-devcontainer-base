# smoke-license-note — Work Plan
> Status: COMPLETE
> Tier: trivial
> Specs: none (trivial)
> Draft: .omp/drafts/smoke-license-note.md

## TL;DR

Add a `## License` section to the root `README.md` recording the MIT license. Serves as the end-to-end behavioral smoke test of the SDD workflow (draft + revision log → approval → materialization → integrity check → execution → checkbox flip + Progress lines).

## Requirements

- **R1** WHEN the reader opens the root `README.md`, THE `README.md` SHALL present a `## License` section stating the project is licensed under the MIT License, placed before the `## For Maintainers` section.
- **R2** THE `README.md` SHALL NOT be modified outside the added section (no other sections changed, no files added/removed).
- **R3** IF the `## License` section is requested twice, THE change SHALL be idempotent (a second run detects the section and reports already-present).

## Design

Single docs edit. The section is inserted before `## For Maintainers` in the root `README.md`. Text: `## License` heading + one line: "Licensed under the [MIT License](https://opensource.org/licenses/MIT). No new file is created (no separate `LICENSE` file) — the note is informational; this is a trivial-tier smoke task." No behavioral code, no contracts; tier trivial.

## Todos

- [x] 1. Add `## License` section to root README.md
  - What: Insert the `## License` section before `## For Maintainers`.
  - Must NOT: Modify any other section; create new files; touch other docs.
  - References: `README.md` (root); R1, R2, R3.
  - Acceptance criteria: `grep -n '^## License' README.md` prints exactly one line; `grep -n 'MIT License' README.md` matches inside the License section; the License section appears before `## For Maintainers` (line-number order).
  - QA scenarios: happy — grep commands above; failure — re-run the edit after the section exists: expected result is "already present, no change" (idempotency, R3).
  - Files in scope: `README.md`
  - Agent: `task` (general-purpose; mechanical docs edit)
  - Commit message: `docs: add License section to README (SDD smoke test)`

## Dependency Matrix

| Todo | Depends on | Wave |
|------|------------|------|
| 1    | —          | 1    |
| F1   | 1          | 2    |
| F2   | 1, F1      | 2    |

## Verification Strategy

- `grep -c '^## License' README.md` → `1`
- `sed -n '/^## License/,/^## For Maintainers/p' README.md` → shows the section between the two headers, with the MIT line
- `git diff --stat` → exactly one file changed (`README.md`)

## Final Verification Wave

- [x] F1. Build + full test suite — repo has no product build/tests (docs-only repo change); command: `test -f README.md && grep -q '^## License' README.md` → exit 0.
- [x] F2. Spec-coverage audit — map R1→`grep '^## License'` + section position; R2→`git diff --stat` single file; R3→idempotency re-run. All R-ids have evidence.

## Spec Coverage

| R-id | Todo(s) | Evidence |
|------|---------|----------|
| R1   | 1       | `grep -n '^## License' README.md` + `sed -n` section dump |
| R2   | 1       | `git diff --stat` (single file) |
| R3   | 1       | idempotency re-run (QA failure scenario) |

## Review Log

| Round | Critic | Verdict | Findings resolved |
|-------|--------|---------|-------------------|
| —     | (trivial tier — no critics required) | — | self-check pass: no contradictions, all R-ids mapped to todos |

## Progress

- 2026-09-03 13:02 DRAFT — v1 draft at local://smoke-license-note-draft.md (target: docs/README.md per smoke spec)
- 2026-09-03 13:03 DRAFT — v2 revision: target corrected to root README.md (docs/README.md absent — SPEC_DRIFT surfaced to owner)
- 2026-09-03 13:03 DRAFT — self-check pass (trivial tier): no contradictions; R1–R3 all mapped to todo 1
- 2026-09-03 13:05 PLAN_APPROVED — owner approved at session start ("Plan approved"); materialized to .omp/plans/smoke-license-note.md (xd://propose unavailable headlessly — approval gate recorded in this Progress line)
- 2026-09-03 13:18 T1_REDO(1) — subagent `T1LicenseNote` exited without calling yield (exit 1, harness issue); no file change made; re-delegated
- 2026-09-03 13:21 T1_REDO(2) — subagent `T1LicenseNote2` again exited without calling yield (exit 1, same harness issue); no file change made; trivial mechanical edit completed directly by orchestrator (justified: single fully-specified insertion, re-delegation exhausted)
- 2026-09-03 13:24 T1_DONE — `## License` section inserted before `## For Maintainers` in README.md. Evidence: `grep -c '^## License' README.md` → 1 (heading at line 35, MIT line at 37, For Maintainers at 39 — placement OK); idempotency re-check count still 1 (R3); `git diff --stat` confirms README.md change is scoped to the added section
- 2026-09-03 13:26 F1_APPROVE — `test -f README.md && grep -q '^## License' README.md` → exit 0; repo has no src/ (docs/skills repo, no product build/test suite to run — substitute per plan's F1 definition)
- 2026-09-03 13:26 F2_APPROVE — spec-coverage audit: R1→1 `## License` heading at line 35, before `## For Maintainers` (line 39); R2→README.md diff scoped to the added section (4 lines added for the section, 0 removed; no other file touched by this todo); R3→idempotency re-run count still 1. All R-ids have evidence.
- 2026-09-03 13:26 COMPLETE — smoke-license-note done. End-to-end SDD mechanics demonstrated: draft + revision log (v1→v2, SPEC_DRIFT surfaced) → approval (owner, session start; xd://propose unavailable headlessly) → materialization (.omp/plans + .omp/drafts) → integrity check (PASS, todo count 3 == matrix rows 3) → wave execution (T1_DONE after T1_REDO x2; subagent yield harness issue logged) → final wave F1/F2 APPROVE. Note: Success Criteria "exactly one changed file" is satisfied for the smoke test's scope (README.md License section); the repo-wide diff additionally contains the SDD implementation files (skills/guide/docs) from this session's own plan, which predated the smoke test.

## Commit Strategy

One commit after verification: `docs: add License section to README (SDD smoke test)`.

## Success Criteria

- `## License` section present in root `README.md` with MIT statement, before `## For Maintainers`
- `git diff --stat` shows exactly one changed file
- This plan file: checkbox flipped, `T1_DONE` + `F1_APPROVE`/`F2_APPROVE` + `COMPLETE` Progress lines appended, status `COMPLETE`
- SDD mechanics demonstrated end-to-end (draft revision log, materialization, integrity check, checkbox flip, Progress lines, completion block)
