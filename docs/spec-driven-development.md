# Spec-Driven Development with omp

How to do spec-driven development (SDD) with `omp`: specs as the source of truth, draft → approved plan with full spec + task dependency matrix → wave-parallel execution with automatically tracked progress.

The workflow runs on two workflow skills — [`plan-workflow`](../build/library/omp-defaults/agent/skills/plan-workflow/SKILL.md) (planning side) and [`start-work`](../build/library/omp-defaults/agent/skills/start-work/SKILL.md) (execution side). Everything else they use is native `omp`.

## 1. Philosophy & Scope

**Specs are the source of truth.** Every approved plan carries its full requirement set (EARS, `R1..Rn`) inline, and for standard/architecture tiers a canonical copy lives in `.omp/specs/<slug>/`. Todos reference requirement IDs; the final verification wave audits that every R-id has concrete evidence. If a requirement turns out wrong mid-flight, the spec changes first (the spec-drift rule) and the change is surfaced to the owner — implementation never drifts silently from the spec.

The 6-stage SDLC runs for **every** change; a 3-tier rubric (trivial / standard / architecture, set in Stage 1) scales which gates are mandatory. Same stage names for every tier — no separate fast path that skips the flow.

| SDLC phase | SDD stage |
|---|---|
| Planning | Stage 1 draft + Stage 2 brief |
| Refinement | Stage 1 iteration loop + gap analysis; Stage 4 adversarial review |
| Implementation | Stage 5 wave loop (`start-work`) |
| Testing | Per-todo acceptance QA; final wave F1 (build + test suite) and F2 (spec-coverage audit) |
| Adversarial review | Stage 4 (plan critic + architect, gated by tier); F3 (code review, architecture tier) |
| Verification & close | Stage 6 final verification wave + completion block |

### Native omp vs. what the two skills wire up

**Nothing is missing — no plugin, no npm tooling, no hook is required.** This was checked during the SDD design: every requirement maps to a native capability. What is native:

- **Plan mode** — `omp --plan`, `Alt+Shift+P` (`app.plan.toggle`), `plan.defaultOnStartup: true`; plan mode makes the working tree read-only and restricts planning subagents to read-only tools (`read`/`grep`/`glob`/`web_search`).
- **Approval via `xd://propose`** — the agent submits the plan by slug; the user picks exactly one of 4 options (approve-and-execute / approve-and-compact / approve-and-keep / save-and-quit). The agent never self-approves.
- **`local://` session artifacts** — drafts and plan drafts persist across the approval boundary inside the session.
- **`task` subagent fan-out** — per-agent-type model routing and parallel dispatch.
- **Skills as workflow injection** — `plan-workflow` and `start-work` load automatically when their description matches the current work.
- **Session naming from the approved plan title**, and `/continue` handoff for long plans.

What the two skills add is **wiring, not tooling**: the stage discipline (draft contract + revision log, tier rubric, gap-analysis prompt, brief + `xd://propose` submit), materialization of the session-local artifacts into git-tracked `.omp/` files with a fixed plan-file schema + integrity check, the gated review loops with verbatim critic prompts, and the execution mechanics (wave loop, per-todo verification, checkbox flips + dated Progress lines, spec-drift rule, final verification wave with spec-coverage audit).

## 2. Artifact Map

During plan mode the working tree is **read-only**: all planning artifacts live in session-local `local://` paths. Git-tracked `.omp/` files are written only at Stage 3, after approval.

| Artifact | Location | Stage | Lifecycle |
|---|---|---|---|
| Draft | `local://<slug>-draft.md` | 1–4 | Session-local; carries the `## Revision log` (stored drafts along the way); a verbatim snapshot can be copied to `local://<slug>-draft-vN.md` on request |
| Plan (pre-approval) | `local://<slug>-plan.md` | 2–4 | Session-local; the exact content submitted to `xd://propose`; read back at materialization |
| Draft (git-tracked) | `.omp/drafts/<slug>.md` | 3+ | Restored from the session-local draft; the iteration log, now in `git log` |
| Plan | `.omp/plans/<slug>.md` | 3+ | **The single source of truth for execution** — full spec + todos + dependency matrix; header `Status` line + `## Progress` are updated as work proceeds |
| Requirements | `.omp/specs/<slug>/requirements.md` | 3+ (standard/architecture) | EARS, numbered `R1..Rn`; canonical home for the spec; plan's `## Requirements` carries the same content inline |
| Design | `.omp/specs/<slug>/design.md` | 3+ (standard/architecture) | Architecture, contracts, correctness properties, data flow |

Reference example of the spec pair: [`.omp/specs/_example/`](../.omp/specs/_example/requirements.md).

## 3. Stage-by-Stage Walkthrough

### Stage 0 — Intake

| | |
|---|---|
| **You do** | `omp --plan` (or `Alt+Shift+P` in-session, or `omp -p --plan-yolo` headless) |
| **Agent does** | Announces intent routing in one line: `Intent: CLEAR` (you know the outcome; only owner-preferences open) or `Intent: UNCLEAR` (outcome fuzzy; it researches maximally, adopts best-practice defaults, announces them, does not interrogate) |
| **Look for** | The `Intent:` line before any exploration; for UNCLEAR, the adopted defaults stated loudly |

### Stage 1 — Specify (refine loop)

| | |
|---|---|
| **You do** | Request iterations ("tighten scope", "add error handling", "keep a snapshot of this version") |
| **Agent does** | Read-only research subagents for discoverable facts; `ask` for genuine owner decisions (CLEAR) or announced defaults (UNCLEAR); writes the draft at `local://<slug>-draft.md` (TL;DR, Scope IN/OUT, components ledger, open assumptions, questions, revision log); sets the **tier**; runs gap analysis (standard/architecture: read-only `plan` subagent; trivial: self-check) |
| **Artifacts** | `local://<slug>-draft.md` (+ `-vN` snapshots if you ask) |
| **Look for** | The draft's revision log **growing one dated line per iteration** (`v2 — <date> — <what changed, why>`); the tier announcement; gap-analysis findings folded into the draft before you see the brief |

### Stage 2 — Approval gate

| | |
|---|---|
| **You do** | Review the brief (TL;DR, scope IN/OUT, tier + which gates apply, approach, open questions), then pick one of the 4 options in the approval dialog |
| **Agent does** | Presents the brief **once**; writes the full plan (status `DRAFT`) to `local://<slug>-plan.md`; submits the slug to `xd://propose` |
| **Look for** | The 4-option approval dialog. The options: **Approve and execute** (fresh context), **Approve and compact context** (discussion distilled), **Approve and keep context** (history retained), **Save and quit** (plan copied to a path you choose). Approval authorizes materialization + execution only |

### Stage 3 — Materialize (first action of the executing session)

| | |
|---|---|
| **You do** | Nothing (or, for "Save and quit", re-invoke with the saved plan) |
| **Agent does** | Reads `local://<slug>-plan.md` back; writes `.omp/plans/<slug>.md` (status `APPROVED`) with a `PLAN_APPROVED` Progress line; for standard/architecture writes `.omp/specs/<slug>/{requirements.md,design.md}`; restores `.omp/drafts/<slug>.md`; runs the plan integrity check |
| **Look for** | The materialized files in git; the integrity-check output (all sections present, todo count == dependency-matrix rows, status line present). Any `MISSING:` line means the agent fixes the plan before proceeding |

### Stage 4 — Adversarial review (gated)

| | |
|---|---|
| **You do** | Read the review verdicts if you want; nothing is required |
| **Agent does** | trivial: skipped · standard: 1 plan critic (`code-reviewer`/`plan`) · architecture: 2 concurrent critics (plan critic + `oracle` architect reviewer). Each returns `APPROVE` or `CHANGES REQUESTED` with exact citations; the agent fixes every cited issue and re-runs until all approve |
| **Look for** | `## Review Log` rows accumulating (Round / Critic / Verdict / Findings resolved) and `REVIEW r<n>` Progress entries |

### Stage 5 — Implement

| | |
|---|---|
| **You do** | `$start-work <slug>` — **you invoke this; the agent never starts work on its own** |
| **Agent does** | Reads the full plan; sets status `IN PROGRESS (0/N)`; runs the wave loop: finds the first incomplete wave in the dependency matrix, dispatches its todos **in parallel** (≤4 in-flight, agent per todo's `Agent` field); for each completed todo runs the exact acceptance commands itself, reads the changed files, flips the checkbox, appends a `T<n>_DONE` Progress line, updates the status count; on failure re-delegates (max 3) then escalates to `oracle` |
| **Look for** | Checkboxes flipping in `.omp/plans/<slug>.md`, dated Progress lines with evidence, the `IN PROGRESS (k/N)` count advancing — and the agent **never** asking "should I continue?" |

### Stage 6 — Verify & close

| | |
|---|---|
| **You do** | Review the completion block |
| **Agent does** | Runs the `## Final Verification Wave` in parallel: `F1` build + full test suite, `F2` spec-coverage audit (every R-id mapped to evidence), `F3` adversarial code review (architecture tier). Any FAIL → fix loop, re-run only the failed F tasks. All APPROVE → status `COMPLETE`, final Progress line, milestone retained to memory |
| **Look for** | The completion block: |

```
START-WORK COMPLETE
Plan: <slug>
Todos: N/N complete
Final wave: F1 APPROVE | F2 APPROVE | F3 APPROVE
```

## 4. The Plan File Template

The fixed schema of `.omp/plans/<slug>.md` (the integrity check enforces it):

```markdown
# <slug> — Work Plan
> Status: DRAFT | APPROVED | IN PROGRESS (k/N) | COMPLETE | ABANDONED
> Tier: trivial | standard | architecture
> Specs: .omp/specs/<slug>/ (standard/architecture) | none (trivial)
> Draft: .omp/drafts/<slug>.md

## TL;DR
## Requirements            # full spec, R1..Rn, EARS. For standard/architecture the
                          # canonical home is requirements.md; this section carries the
                          # same content inline so the plan is self-contained.
## Design                  # key decisions inline; for standard/architecture link design.md
## Todos                  # column-zero checkboxes, see todo contract
## Dependency Matrix      # table: Todo | Depends on | Wave  (wave = maximal parallel set)
## Verification Strategy
## Final Verification Wave # - [ ] F1..Fn, run in parallel after all todos
## Spec Coverage          # table: R-id | Todo(s) | Evidence (test/command/behavior).
                          # Mandatory for architecture; optional for standard
## Review Log             # table: Round | Critic | Verdict | Findings resolved
## Progress               # append-only dated lines (see format)
## Commit Strategy
## Success Criteria
```

**Todo contract** — every todo is `- [ ] N. <title>` followed by sub-bullets:

- `What` / `Must NOT`
- `References` — every path + spec + R-id the executor needs (no judgment calls)
- `Acceptance criteria` — executable commands with expected output
- `QA scenarios` — happy + failure, exact tool and invocation
- `Files in scope`
- `Agent` — which fleet agent implements it
- `Commit message`

**Progress line format** — append to `## Progress`, newest last:

```
- <YYYY-MM-DD HH:MM> <EVENT> — <detail + evidence>
```

Events: `DRAFT` (planning iteration), `PLAN_APPROVED`, `REVIEW r<n>` (critic, verdict), `T<n>_DONE` (evidence = command + result), `T<n>_REDO(k)`, `SPEC_DRIFT`, `F<n>_APPROVE`, `COMPLETE`.

**Integrity check** (run after writing the plan file; standard/architecture additionally require `## Design` + the specs files; architecture additionally `## Spec Coverage`):

```bash
P=.omp/plans/<slug>.md
for s in "## TL;DR" "## Requirements" "## Todos" "## Dependency Matrix" \
         "## Verification Strategy" "## Final Verification Wave" \
         "## Review Log" "## Progress" "## Success Criteria"; do
  grep -q "^$s" "$P" || echo "MISSING: $s"
done
grep -c '^- \[ \] ' "$P"   # todo count; must equal Dependency Matrix row count
grep -q '^> Status:' "$P" || echo "MISSING status line"
```

## 5. Tier Guide

| Tier | Rubric | Example | Gates that apply | Cost |
|---|---|---|---|---|
| **trivial** | 1–2 files, no behavioral contract | A docs edit, a config tweak, a typo fix | Gap self-check only; no spec files; no critics; no Spec Coverage | Fastest; still the full 6-stage flow |
| **standard** | Changes behavior of existing modules OR touches >2 files | A new endpoint on an existing service | Spec files (`requirements.md` + `design.md`); 1 plan critic; Spec Coverage optional | One review round-trip |
| **architecture** | ANY 2+ of: (a) new durable service/process or topology change, (b) 5+ modules touched, (c) new external contract (API, schema, cross-repo), (d) spans multiple work sessions | Adding a new service to the Aspire topology | Everything above + 2 concurrent critics (plan critic + `oracle` architect), mandatory `## Spec Coverage` matrix, F3 code review in the final wave | Heaviest; the extra gates are the point |

The tier is set in Stage 1 and recorded in both the draft header and the plan header.

## 6. Progress & Resume

- **Progress tracking is mechanical, not ceremonial.** The executor MUST flip plan checkboxes **and** append a dated one-line entry to `## Progress` after every state change (todo done, review verdict, redo, spec drift, final-wave approval, completion). No hook plugin, no live-status command — the plan file itself is the tracker, and it is git-tracked, so `git log .omp/plans/<slug>.md` is a second history.
- **Status count**: the header `> Status:` line advances `IN PROGRESS (k/N)` after every todo and lands on `COMPLETE` (or `ABANDONED`) at the end.
- **Resuming a long plan across sessions**: when context gets heavy, run `/continue`. The fresh session re-reads `.omp/plans/<slug>.md`, checks the status line and the Progress section, and continues at the **first unchecked todo** (equivalently: the first incomplete wave in the dependency matrix). The plan file + Progress is the entire continuity artifact — nothing else is carried over.
- **Requirement change mid-flight (spec drift)**: implementation reveals a requirement is wrong or missing → stop that todo; update `requirements.md` **and** the plan's `## Requirements` section **and** `## Spec Coverage` in the same edit; append a `SPEC_DRIFT` Progress line; surface the change to the owner. Requirement changes are owner decisions — never silent.

## 7. Roles & Models

| Role | Who | Runs on |
|---|---|---|
| Planner | Main agent in plan mode (the `plan-workflow` skill) | `plan` role model |
| Gap analyst | `plan` agent, read-only subagent | read-only plan subagent |
| Plan critic (Stage 4, standard+) | `code-reviewer` or `plan` agent | `task` role model |
| Architect reviewer (Stage 4, architecture) | `oracle`, read-only | big-model slot |
| Implementers (Stage 5) | Per-todo `Agent` field — `backend-expert`, `frontend-expert`, `quality-assurance`, `dotnet-aspire`, `documentation-specialist`, … | `task` role model (worker pool) |
| Final-wave reviewers (F2/F3) | `code-reviewer` (F3), a coverage-audit subagent (F2) | `task` role model |

**Model guidance.** The engine has 2 big-model slots (`subagents.parallel.concurrency: 2` — the 27B model serves `--max-num-seqs 2`) and a worker pool (the 35B worker serves `--max-num-seqs 6`; `globalConcurrencyLimit: 20`). The SDD wave cap is **4 in-flight subagents per wave**: up to 2 big-model specialists run concurrently, workers fill the rest; extra todos queue. Route heavy reasoning (architecture, hard debugging) to the big-model slots; routine implementation todos to the worker pool. See [models.md](models.md) for the full role mapping.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Plan mode stuck at approval | The agent never self-approves. Pick one of the 4 options in the `xd://propose` dialog (or Save and quit, then re-open with the saved plan). Headless: `omp -p --plan-yolo` auto-approves and implements. |
| Integrity check fails (`MISSING: …`) | The plan file is missing a required section or the todo count ≠ dependency-matrix rows. Fix the plan (in `local://` pre-approval, in `.omp/plans/` post-approval — and note the change in Progress), re-run the check before proceeding. |
| A wave hangs | Cancel the stuck subagent via the task tool (`hub cancel` / re-dispatch), re-delegate that todo with the failure evidence in the prompt. Max 3 attempts, then `oracle`. |
| Requirement drift discovered late | The spec-drift rule (§6): update `requirements.md` + plan `## Requirements` + `## Spec Coverage` in one edit, log `SPEC_DRIFT`, surface to the owner. Do not let implementation drift from the spec. |
| Example spec missing (e.g. on a fresh repo) | Create it from the plan-file template in §4 and the EARS pattern in [`.omp/specs/_example/`](../.omp/specs/_example/requirements.md) (4 requirements, each with a verification hint, plus a 1-page design). |
| Docs feel stale about the workflow | This page is the how-to; the two skills are the contract. If they disagree, the skills win and this page gets fixed. |

## 9. Quick Reference

| Trigger | What it does |
|---|---|
| `omp --plan` | Session starts in plan mode (SDD planning flow active) |
| `Alt+Shift+P` | Toggle plan mode in-session (`app.plan.toggle`) |
| `/settings plan.defaultOnStartup` → `true` | Every session starts in plan mode |
| `omp -p --plan-yolo` | Headless: auto-approve + implement (default target `smol` role) |
| `$start-work <slug>` | Execute the approved `.omp/plans/<slug>.md` (user-invoked only) |
| `/continue` | Native handoff — fresh session, context summarized; plan file is the continuity artifact |
| `/settings skills` | Inspect/adjust skill configuration |
| `/settings task` | Inspect task/role model configuration |

Related: [using-omp.md](using-omp.md) (day-to-day reference), [models.md](models.md) (roles & concurrency), [troubleshooting.md](troubleshooting.md) (environment issues).
