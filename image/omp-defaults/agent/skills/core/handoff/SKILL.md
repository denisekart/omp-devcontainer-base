<!-- ported for oh-my-pi -->
---
name: handoff
description: Use this skill to transfer state between agents cleanly. Load it whenever you are completing a task that another agent will continue, or when you are receiving a task from another agent.
---

# Handoff Skill

Handoffs are the primary mechanism for state transfer between agents. A handoff that omits context forces the receiving agent to re-survey from scratch — causing the looping you want to avoid.

## Sending Agent: Before You Hand Off

1. **Write a memory** — persist key decisions so they survive context compaction:
   ```
   memory(mode="add", content="<what was done, key files, decisions>", tags="handoff,<feature-name>")
   ```
2. **Emit the Handoff Block** in your response (required).
3. **Do not leave the task in an ambiguous state** — either it is done (emit Completion Signal) or it is in-progress (emit Handoff Block).

## Handoff Block Format

```
🔀 HANDOFF TO: <agent category or subagent_type>
- Completed: <what this agent finished>
- Files touched: <list with brief description of each change>
- State: <any runtime state, env vars, resource names relevant to the next agent>
- Memory written: <yes — tag: <tag>>
- Next agent must: <explicit instruction — what to do, where to start, how to verify done>
- Done criteria: <how the receiving agent knows it finished successfully>
```

## Receiving Agent: When You Get a Handoff

1. **Read injected memories** — `opencode-mem` will have injected relevant memories. Trust them; skip re-reading files they already cover.
2. **Read the Handoff Block** — it is your source of truth for current state.
3. **Do not re-survey** files listed as already completed in the Handoff Block.
4. Start from the "Next agent must" instruction directly.

## Interrupt/Resume Verification

How to verify the handoff survived an interruption:

1. **Before interrupting**: confirm the Handoff Block was written (check session via `session_read`, look for the Handoff Block fields: what was done, key files, decisions, next steps).
2. **After resume**: the incoming agent MUST read injected memories and find the `handoff`-tagged memory from step 1.
3. **Verification command**: `memory(mode="search", query="handoff <feature-name>", scope="project")` → must return the Handoff Block content.
4. **If NOT found**: the handoff failed — re-read `.omo/boulder.json` and `.omo/plans/` as fallback, then write a new Handoff Block before proceeding.

### Memory firewall confirmation

The `learning` tag (written by worker agents) and the `handoff` tag (written by this skill) are strictly separate. A learning write (`tags="learning,<domain>"`) MUST NEVER use `tags="handoff"` and vice versa. Consolidation routines MUST NOT target `handoff` memories. This is enforced by the memory-discipline skill.

## Example

```
🔀 HANDOFF TO: category="frontend-svelte"
- Completed: POST /api/items endpoint — returns ItemDto record
- Files touched:
  - the API endpoints file — new endpoint, auth required
  - the application service — CreateItem(CreateItemRequest) method
  - the unit test project — 3 passing unit tests
- State: API base URL injected via Aspire env ITEMS_API_URL
- Memory written: yes — tag: handoff,items-feature
- Next agent must: implement CreateItemForm.svelte in the frontend components dir that POSTs to /api/items using fetch. Show success toast on 201. Show field errors on 422.
- Done criteria: pnpm check passes, data-testid on all inputs, form submits and shows toast in browser.
```
