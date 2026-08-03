---
name: handoff
description: Use this skill to transition state between sessions or agents.
---

# Handoff Skill

## Native Session Handoff
Handoffs in `oh-my-pi` are best handled using native session transitions, the `/continue` command, or the `task` tool for delegation.

1. **Use `/continue`**: When you need to start a fresh session with the current context summarized. This triggers the native handoff generation pipeline.
2. **Use `task()`**: When delegating the next phase to a specialized agent: `task(agent="...", task="...")`.

## Handoff Documentation Block
When handing off (either via `task` or manually), always provide a structured summary of the current state:

```
🔀 HANDOFF
- Completed: <summary of work done>
- Files touched: <list of modified files>
- Current State: <any relevant environment variables or runtime state>
- Next Steps: <explicit instructions for the next agent>
- Verification: <how to verify the next steps are done correctly>
```

## Receiving a Handoff
1. Read the Handoff Block from the previous session/agent.
2. Use `read` on `AGENTS.md` and `.omp/plans/` to understand project context and active plans.
3. **Verification First**: Before starting any work, verify if the previous agent's "Completed" work is actually reflected in the filesystem.
4. **No Redundancy**: Do not re-perform work listed as "Completed".
