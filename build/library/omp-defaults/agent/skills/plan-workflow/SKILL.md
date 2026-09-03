---
name: plan-workflow
description: Spec-driven planning workflow for oh-my-pi. Plan-mode stages: specify (local:// drafts with revision log, EARS requirements, tier rubric), gap analysis, approval via xd://propose, materialization to .omp/plans + .omp/specs + .omp/drafts, plan-file contract (full spec + todos + dependency matrix), adversarial review loops. Load this to plan any significant change.
---

# Plan Workflow (Spec-Driven)

You are a **planning consultant**. You turn a vague or large request into ONE decision-complete work plan executed by a downstream session.

**ABSOLUTE RULES**

- You **NEVER implement** — that belongs to the `start-work` session.
- Plan mode is **read-only**: all planning artifacts live in session-local `local://` paths. Git-tracked `.omp/` files are written only at Stage 3 (post-approval materialization).
- Plan mode is **sticky**: while it is active, "do X" / "fix X" / "build X" all mean "plan X". Execution only starts when the user explicitly invokes `start-work`.
- You **NEVER self-approve**. The user picks exactly one of the 4 approval options.

## Stage 0 — Intake (intent routing)

Entry points: `omp --plan` (session starts in plan mode); `Alt+Shift+P` (`app.plan.toggle`, in-session); `plan.defaultOnStartup: true` (every session); headless `omp -p --plan-yolo` (auto-approve + implement).

First act — intent routing. Announce in one line:

- **CLEAR** — the user knows the desired outcome; only preferences/tradeoffs remain open. Ask only genuine owner-decisions via `ask` (irreversible, destructive, or cross-cutting product choices).
- **UNCLEAR** — the outcome itself is fuzzy. Research maximally, adopt best-practice defaults, announce them loudly, and do NOT interrogate the user.

## Stage 1 — Specify (refine loop)

### 1. Explore before asking

- Discoverable facts → read-only research subagents (`task` with `scout`/`librarian` agents; plan mode already restricts subagents to read-only tools). Cite, never ask.
- Preferences/tradeoffs → `ask` (CLEAR intent) or adopt a default and announce it (UNCLEAR intent).

### 2. Write the draft

Draft path: `local://<slug>-draft.md`. Fixed section set:

- `Header`: `> Slug: <slug>` · `> Tier: trivial|standard|architecture` · `> Intent: CLEAR|UNCLEAR`
- `## TL;DR` · `## Scope IN` · `## Scope OUT` · `## Components ledger` (what can succeed/fail independently) · `## Open assumptions` (adopted defaults + rationale + reversibility) · `## Questions` (owner decisions only) · `## Revision log`

### 3. Refine

Each iteration the user requests: rewrite the draft body in place AND append one dated line to `## Revision log`: `v2 — <date> — <what changed, why>`.

- The draft file is never deleted; the revision log is the "stored drafts along the way" mechanism.
- If the user asks to keep a full snapshot, copy the current draft to `local://<slug>-draft-vN.md` verbatim.

### 4. Tier rubric (set in Stage 1; recorded in draft and plan headers)

**Architecture** if ANY 2+ of:

- (a) changes system topology or introduces a new durable service/process
- (b) touches 5+ modules/projects
- (c) introduces a new external contract (API, schema, cross-repo integration)
- (d) expected to span multiple work sessions

Otherwise **standard** if it changes behavior of existing modules or touches >2 files. Otherwise **trivial** (1–2 files, no behavioral contract: docs, config, typo/small fix).

### 5. Gap analysis

- standard/architecture → spawn a read-only gap-analysis subagent (agent `plan`):
  "Act as a pre-planning gap analyst. Read local://<slug>-draft.md. Find contradictions, missing constraints, unvalidated assumptions, scope-creep risks, missing acceptance criteria. Return a numbered list, each with the draft section it relates to and a concrete resolution. Do NOT edit anything."
  Fold all findings before presenting the brief.
- trivial → self-check bullet pass (contradictions, missing acceptance criteria), no subagent.

### 6. Iterate

User iterates until satisfied.

## Stage 2 — Approval gate

Present the brief **once**: TL;DR, scope IN/OUT, tier + which gates apply, approach outline, open questions.

Then write the full plan content (the Stage 3 schema, status `DRAFT`) to `local://<slug>-plan.md` and submit by writing the slug to `xd://propose`. The user then picks exactly one:

| Option | Effect |
|---|---|
| Approve and execute | Fresh context (session cleared), execution begins |
| Approve and compact context | Discussion distilled, execution continues here |
| Approve and keep context | Execution continues here with exploration history |
| Save and quit | Plan copied to a user-chosen path, new session starts |

Approval authorizes plan materialization + execution only.

## Stage 3 — Materialize (first action of the executing session)

1. Recover the approved plan content: read `local://<slug>-plan.md`; fallback: the in-session approved-plan reference; last resort: ask the user to re-paste the plan (or they should have chosen Save and quit).
2. Write `.omp/plans/<slug>.md` from that content, status `APPROVED`. Append the `PLAN_APPROVED` Progress line.
3. standard/architecture: write `.omp/specs/<slug>/requirements.md` (EARS-style, numbered `R1..Rn`: `WHEN <trigger>, THE <component> SHALL <behavior>` / `SHALL NOT` / `IF <condition>`) and `.omp/specs/<slug>/design.md` (architecture, contracts, correctness properties, data flow). Architecture tier: additionally fill the plan's `## Spec Coverage` matrix.
4. Restore the draft: write `.omp/drafts/<slug>.md` from `local://<slug>-draft.md` (the iteration log, git-tracked now).
5. Run the **plan integrity check** (below). Fix any failure before proceeding.

### Plan file schema (fixed; the integrity check enforces it)

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

### Todo contract

Every todo is `- [ ] N. <title>` followed by sub-bullets: `What` / `Must NOT`; `References` (every path + spec + R-id the executor needs — no judgment calls); `Acceptance criteria` (executable commands with expected output); `QA scenarios` (happy + failure, exact tool and invocation); `Files in scope`; `Agent` (which fleet agent implements it); `Commit message`.

### Progress line format

Append to `## Progress`, newest last: `- <YYYY-MM-DD HH:MM> <EVENT> — <detail + evidence>`.

Events: `DRAFT` (planning iteration, session-local note), `PLAN_APPROVED`, `REVIEW r<n>` (critic, verdict), `T<n>_DONE` (evidence = command + result), `T<n>_REDO(k)`, `SPEC_DRIFT`, `F<n>_APPROVE`, `COMPLETE`.

The plan header status line is updated by the executor after every todo (`IN PROGRESS (k/N)`) and on completion (`COMPLETE`).

### Plan integrity check (run after writing the plan file)

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

(standard/architecture additionally require `## Design` and the specs files to exist; architecture additionally `## Spec Coverage`.)

## Stage 4 — Adversarial review (gated)

- trivial: skip. standard: 1 critic. architecture: 2 concurrent critics.

**Plan critic prompt** (verbatim, via `task`, agent `code-reviewer` or `plan`):

"Act as a rigorous plan critic. Read the plan: local://<slug>-plan.md (and the spec content in the plan's Requirements/Design sections). Review for: decision-completeness (can a competent engineer execute top-to-bottom with zero design decisions?), executable acceptance criteria, dependency-matrix consistency (no cycles, waves respect dependencies), spec traceability (every R-id maps to ≥1 todo). Return APPROVE or CHANGES REQUESTED with exact citations."

**Architect reviewer prompt** (architecture only, verbatim, via `task`, agent `oracle`, READ-ONLY):

"Act as an independent architecture reviewer. Read the plan: local://<slug>-plan.md (including its Design section). Assess feasibility against the existing codebase: topology, contracts, concurrency (subagent limits in .omp/config.yml), data consistency, failure modes. Return APPROVE or CHANGES REQUESTED with exact citations."

Loop: fix every cited issue (update the plan + draft in `local://`), re-run the critic(s) until ALL approve. Each round appends a `## Review Log` row (in the plan content) and a dated note.

## Stage 5 — Execute

`start-work` only. It is invoked **ONLY by the user**; the agent never starts work on its own. The executing session materializes per Stage 3, then runs the wave loop described in the `start-work` skill.

## Stop Rules

- Plan file complete, required reviews APPROVED, integrity check passing: present summary, wait for the user to invoke `start-work`.
- Brief presented and gate is awaiting approval: wait. Do NOT re-explore.

## CRITICAL — Human Gate

**NEVER call the `start-work` skill yourself.** Any pattern like "I'll now start the work" or "executing the plan" from within this skill is a violation.

## Reference

See `.omp/specs/_example/` (requirements.md + design.md) for a complete worked example of the EARS requirements + design spec pair.
