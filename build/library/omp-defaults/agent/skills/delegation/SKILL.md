---
name: delegation
description: Task/hub/job contract, spawn-vs-inline, /continue handoff, retain/recall/reflect memory, and Completion Signal format for agent orchestration.
---
# Delegation

Formerly: subagent-orchestration, handoff, memory-discipline

## When to use

- Delegating tasks to agents, coordinating parallel work (subagent-orchestration)
- Transitioning state between sessions or agents (handoff)
- Writing or reading memory — what makes a good learning, tag conventions, handoff firewall (memory-discipline)

## Rules

1. **Parallel first**: Fire independent tasks simultaneously. Sequential only when B genuinely needs A's output.
2. **No `background=true`**: `task()` returns a job id. Use `hub jobs/wait` for coordination.
3. **No `task_id`**: Use `hub` messaging to address peers; no `task_id` parameter exists.
4. **Self-contained tasks**: Every delegated task must include context, goal, files, verification command, done criteria.

### Task Prompt Structure

```
Context: <what already exists that is relevant>
Goal: <exactly what to build/change>
Files to create/modify: <explicit list>
Verification command: <dotnet test / pnpm check / aspire_list_resources>
Done when: <concrete success criteria>
```

### Completion Aggregation

1. Wait for background task completion notifications.
2. Check each agent's Completion Signal block for pass/fail.
3. Re-delegate only the failing subtask, not the whole plan.
4. After 3 failures on the same subtask → escalate to `task(agent="oracle", task="...")`.

### Loop Budget

| Situation | Max retries | Escalation |
| ----------- | ------------ | ------------ |
| Build failure | 2 | Oracle |
| Test failure | 2 | Oracle |
| Ambiguous result | 1 clarification | Ask user |
| Environment issue | 1 | `aspire_doctor` then Oracle |

## Native Handoff

1. **Use `/continue`**: Start a fresh session with current context summarized.
2. **Use `task()`**: Delegate the next phase to a specialized agent.

### Handoff Block Format

```
🔀 HANDOFF
- Completed: <summary of work done>
- Files touched: <list of modified files>
- Current State: <relevant env vars or runtime state>
- Next Steps: <explicit instructions for the next agent>
- Verification: <how to verify next steps are done correctly>
```

## Memory Discipline

- **GOOD learning**: Reusable, non-obvious, domain-general, concise (≤150 words).
- **BAD learning**: Task state, secrets, handoff info, one-off observations, milestone markers.
- **Tags**: `learning,<domain>` (worker agents), `handoff` (ONLY handoff skill), `state,milestone` (planners).
- **FIREWALL**: Learning-capture writes MUST NOT include `handoff` tag. Handoff writes MUST NOT include `learning` tag.
- **Search before writing**: `recall(query="<topic>")` → update if near-duplicate exists, add if not, skip if trivial.

## Pattern

```javascript
// Parallel: independent tasks
const a = task(agent="backend-expert", task="create API endpoint...")
const b = task(agent="frontend-expert", task="implement form component...")

// Sequential: B depends on A
const result = await hub.wait(a);
task(agent="frontend-expert", task=`implement form calling ${result.endpoint}`)
```

## Checklist

- [ ] Tasks self-contained with explicit done criteria?
- [ ] Parallel where possible, sequential only for real dependencies?
- [ ] No `background=true` or `task_id` references?
- [ ] Handoff block format followed?
- [ ] Memory search before writing new learnings?
- [ ] Learning/handoff firewall respected?
