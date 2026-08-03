<!-- ported for oh-my-pi -->
---
name: subagent-orchestration
description: Guidelines for delegating tasks to subagents, coordinating their efforts, and merging their results.
---

# Subagent Orchestration

## Core Principle: Parallel First

Fire independent tasks simultaneously. Sequential execution is only justified when task B genuinely requires output from task A.

```
// Good: parallel
task(category="backend-dotnet", prompt="...", run_in_background=true)
task(category="quality-assurance", prompt="...", run_in_background=true)

// Only sequential when B depends on A's output
result_a = task(category="backend-dotnet", prompt="create API endpoint...")
task(category="frontend-svelte", prompt="implement form calling ${result_a.endpoint}")
```

## Delegation Checklist

Before delegating, confirm:
- [ ] Task is self-contained (has all context it needs)
- [ ] Done criteria are explicit and verifiable
- [ ] No circular dependency with another in-flight task
- [ ] The right category/subagent_type is selected

## Task Prompt Structure

Every delegated task prompt must include:

```
Context: <what already exists that is relevant>
Goal: <exactly what to build/change>
Files to create/modify: <explicit list>
Verification command: <dotnet test / pnpm check / aspire_list_resources>
Done when: <concrete success criteria>
```

## Completion Aggregation

When collecting results from parallel background tasks:
1. Wait for all `bg_...` task notifications before aggregating.
2. Check each agent's Completion Signal block for pass/fail.
3. If any agent reports a build/test failure, re-delegate that specific subtask (not the whole plan).
4. After 3 failures on the same subtask — escalate to `task(subagent_type="oracle")`.

## State Continuity

- Use `task_id="ses_..."` to continue a previous agent session with full context when following up on an incomplete result.
- Use the handoff skill (see `handoff/SKILL.md`) to pass state between different agents.
- Write milestones to memory: `memory(mode="add", content="...", tags="milestone,<feature>")` so future sessions don't re-discover.

## Loop Budget

| Situation | Max retries | Escalation |
|-----------|------------|------------|
| Build failure | 2 | Oracle |
| Test failure | 2 | Oracle |
| Ambiguous result | 1 clarification | Ask user |
| Environment issue | 1 | `aspire_doctor` then Oracle |

