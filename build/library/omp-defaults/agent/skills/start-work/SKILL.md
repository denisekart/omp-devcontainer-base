---
name: start-work
description: Execute an approved .omp/plans/<slug>.md via the SDD implement stage. Wave-parallel subagent dispatch from the dependency matrix, per-todo verification, automatic progress tracking (checkbox flips + dated Progress entries), spec-drift handling, final verification wave with spec-coverage audit. ONLY invoked explicitly by the user.
---

# Start Work (SDD Implement Stage)

This skill executes an approved plan from `.omp/plans/<slug>.md`.

## ABSOLUTE RULES

- **User-invoked only.** The user's explicit invocation IS the gate — the planner never calls this.
- **You are an orchestrator, never the implementer.** Every unit of implementation, QA, and review work is delegated to a spawned subagent via `task`. You never write product files directly.
- **You verify, never trust.** Run each todo's exact acceptance commands and read every file the subagent created/modified before marking it done.

## Usage

```
$start-work [plan-name]
```

## Phase 1 — Select Plan

1. Read `.omp/plans/` and select the target plan. If ambiguous, ask once.
2. Read the FULL plan first (spec sections included).
3. Set the header status to `IN PROGRESS (0/N)`.
4. Confirm a `PLAN_APPROVED` Progress line exists (it is logged at materialization); log the first dispatch.

## Phase 2 — Execute Wave by Wave

1. Find the first incomplete wave in the plan's `## Dependency Matrix` (a wave = maximal parallel set respecting dependencies).
2. Dispatch all of that wave's todos **in parallel** via `task` (agent per todo's `Agent` field; model = `task` role).
3. Cap in-flight subagents at **4 per wave** (grounded: `subagents` config — worker model vLLM `--max-num-seqs 6`, global limit 20; extra todos queue).
4. One subagent prompt per todo:

   ```
   Context: You are implementing todo N of the approved plan .omp/plans/<slug>.md — READ THE FULL PLAN FIRST. Specs: .omp/specs/<slug>/requirements.md + design.md. Requirement IDs for this todo: R<n>, ...
   Goal: <todo What, verbatim>
   Files to create/modify: <Files in scope, explicit list>
   Constraints: <Must NOT list> + existing project conventions (match neighboring code; no scope creep; load stack skills backend-conventions / svelte-code-writer as applicable)
   Verification: <exact Acceptance criteria commands + expected output>
   Done when: <acceptance criteria>; before reporting, run the verification-gate skill checklist (hallucination check, standard compliance, execution gate) and paste the result.
   Completion signal: DONE or FAIL + command output as evidence. Never report DONE without having run the verification commands.
   ```

## Phase 3 — Verify and Record

For each completed todo:

1. Run the todo's **exact acceptance commands** yourself (main agent verifies, never trusts the report).
2. Read every file the subagent created/modified.
3. Flip the checkbox: `- [ ] N.` → `- [x] N.` in the plan.
4. Append the `T<n>_DONE` Progress line with evidence (command + result).
5. Update the status count: `IN PROGRESS (k/N)`.
6. Continue to the next wave immediately — never ask "should I continue?".

### Failures

Subagent reports FAIL or the acceptance check fails → re-delegate that specific todo (with the failure evidence in the prompt), max 3 attempts, then escalate to `task(agent="oracle")`. Log `T<n>_REDO(k)`.

### Spec drift

Implementation reveals a requirement is wrong/missing → STOP that todo; update `requirements.md` AND the plan's `## Requirements` section AND `## Spec Coverage` in the same edit; log a `SPEC_DRIFT` Progress line; surface the change to the user (requirement changes are owner decisions — never silent).

## Phase 4 — Final Verification Wave

All todos checked → run the `## Final Verification Wave` tasks **in parallel**, all must APPROVE:

- `F1` — build + full test suite (exact commands from the plan's Verification Strategy).
- `F2` — **spec-coverage audit**: a subagent maps every R-id to concrete evidence (a test, a command, an observed behavior); any R-id without evidence = FAIL with the gap named.
- `F3` (architecture tier) — adversarial code review: `task(agent="code-reviewer")` over the full diff for security, quality, and contract conformance against requirements.md.

Any FAIL → fix loop (re-delegate the specific failing area), re-run only the failed F tasks. Log `F<n>_APPROVE` per task.

## Completion

All APPROVE → status `COMPLETE`; final `COMPLETE` Progress line; `retain` the milestone (feature + key decisions, per memory-discipline); print the completion block:

```
START-WORK COMPLETE
Plan: <slug>
Todos: N/N complete
Final wave: F1 APPROVE | F2 APPROVE | F3 APPROVE
```

## Multi-session

Context heavy → `/continue` (native handoff); the plan file + Progress is the continuity artifact. A resumed session re-reads the plan and continues at the first unchecked todo.
