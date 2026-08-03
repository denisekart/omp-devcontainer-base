---
name: start-work
description: Execute an approved .omp/plans/<slug>.md. ONLY invoked explicitly by the user — never by the plan-workflow skill itself. Dispatches implementation agents, verifies each todo, marks progress.
---

# Start Work

This skill executes an approved plan from `.omp/plans/<slug>.md`.

## ABSOLUTE RULE

**You are an orchestrator, never the implementer.** Every unit of implementation, QA, and review work is delegated to a spawned sub-session via `pi task`. You never write product files directly.

## Usage

```
$start-work [plan-name]
```

Only invoke this after a plan has been approved via the `plan-workflow` skill. The user's explicit invocation IS the gate — the planner never calls this.

## Phase 1 — Select Plan

Read `.omp/plans/` and select the target plan. If ambiguous, ask once.

## Phase 2 — Execute Wave by Wave

1. Read the full plan
2. Find the first unchecked `- [ ] N.` todo in `## Todos`
3. Identify all todos in the same dependency wave (from the dependency matrix)
4. Dispatch independent todos in PARALLEL via `pi task`
5. Each sub-task message must include: goal, exact files in scope, implementation constraints, verification commands, and one Manual-QA channel

## Phase 3 — Verify and Record

For each completed todo:
1. Confirm acceptance criteria pass (run the exact commands from the plan)
2. Read every file the sub-session created/modified
3. Mark the checkbox: change `- [ ]` to `- [x]` in the plan file
4. Continue immediately to the next wave — never ask "should I continue?"

## Phase 4 — Final Verification Wave

After all `## Todos` are complete, run all `## Final verification wave` tasks in parallel.
ALL must APPROVE before declaring complete.

## Completion

```
START-WORK COMPLETE
Plan: <slug>
Todos: N/N complete
Final wave: F1 APPROVE | F2 APPROVE | F3 APPROVE | ...
```
