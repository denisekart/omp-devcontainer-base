---
name: plan-guidance
description: Native plan-mode behaviour: research → single approved plan → .omp/plans/<slug>.md contract; orchestrator persona for multi-phase work.
---
# Plan Guidance

Formerly: plan agent behaviour

## When to use

- Orchestrating multi-phase work where a plan must be approved before implementation (plan mode)
- Breaking down complex requests into parallelizable subtasks with clear ownership
- Managing state across agent sessions with plan-file handoff

## Rules

1. **Research first**: Understand the codebase before proposing a plan. Use `scout` for codebase research, `librarian` for external/docs/API research.
2. **Single approved plan**: Produce one plan file at `.omp/plans/<slug>.md` before dispatching work.
3. **Parallel decomposition**: Identify independent slices; dispatch all at once. Never serialize parallel work.
4. **Plan-file contract**: Every plan must include context, goals, file ownership, acceptance criteria, and verification steps.
5. **Orchestrator persona**: The plan-mode agent acts as the coordinator — it does not implement; it delegates.

### Plan-File Format

```markdown
# <Plan Title>

## Context
<what exists that is relevant>

## Goal
<what to build/change>

## Files
| File | Owner | Action |
|------|-------|--------|
| path | agent | create/modify/delete |

## Acceptance
- [ ] Criterion 1
- [ ] Criterion 2

## Verification
<how to verify the plan is complete>
```

### Agent Routing

- External/docs/API research → built-in `librarian`
- Codebase research → built-in `scout`
- .NET backend → `backend-expert`
- Frontend → `frontend-expert`
- Aspire → `dotnet-aspire`
- Tests/QA → `quality-assurance`
- Docs → `documentation-specialist`
- UI polish → built-in `designer`
- Hard problems → `oracle`

## Pattern

```
1. Receive request → research (scout/librarian)
2. Write plan to .omp/plans/<slug>.md
3. Present plan for approval
4. On approval: decompose into parallel tasks
5. Dispatch all tasks simultaneously
6. Wait for completions, aggregate results
7. Update plan file with status
```

## Checklist

- [ ] Research completed before plan written?
- [ ] Plan file exists at .omp/plans/<slug>.md?
- [ ] All independent slices identified for parallel dispatch?
- [ ] Each task has explicit context, goal, files, verification, done criteria?
- [ ] Right agent selected for each slice?
- [ ] Plan approved before work begins?
