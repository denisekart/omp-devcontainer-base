# Rubric Check: Fix typo in README

## Architecture-Tier Rubric (2+ points required to trigger SDD-lite)

A plan is Architecture-tier, and therefore gets SDD-lite companion docs, if AND ONLY IF it meets 2+ of:
- (a) changes system topology or introduces a new durable service/process
- (b) touches 5+ modules/projects
- (c) introduces a new external contract (API, schema, or cross-repo integration) other teams/agents depend on
- (d) is expected to span multiple work sessions

## Scoring This Change

| Criterion | Met? | Reason |
|-----------|------|--------|
| (a) new durable service/process | NO | Single file edit, no service changes |
| (b) 5+ modules | NO | Touches exactly 1 file (README.md) |
| (c) new external contract | NO | Documentation only, no API or schema |
| (d) multiple sessions | NO | Single-session trivial fix |

score = 1 (only if one criterion was borderline — in this case score = 0)

## Verdict

**SDD-lite NOT triggered** — this change scores below the 2+ threshold.
Proceed with a Todos-only plan in `.omo/plans/`. No `requirements.md` or `design.md` needed.
