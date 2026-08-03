<!-- ported for oh-my-pi -->
---
name: memory-discipline
description: Discipline for reading and writing memory — what makes a good learning, tag conventions, and the handoff firewall. Load this when writing or reading memory as part of a worker agent's workflow.
---

# Memory Discipline

## When to Use

Loaded by any agent that writes or reads memory — worker agents (backend, frontend, QA, aspire, code-review) capturing learnings, or any agent searching prior knowledge before starting a task.

## The Learning Rubric

A learning is a durable, reusable fact that should survive across sessions and help future agents avoid rediscovering the same thing.

**GOOD learning:**
- Reusable across future tasks, not just this one
- Non-obvious — something you had to discover by reading code, hitting an error, or investigating
- Domain-general (a pattern, gotcha, or API contract), not tied to one specific file's current content
- Concise — states the conclusion, not the investigation story

Examples:
- "EF Core migrations fail silently if the DbContext isn't registered as scoped in Aspire test host — always check `AddDbContext` lifetime first."
- "Aspire `WithReference` must precede `WithEnvironment` calls referencing the same resource, or the env var resolves empty."
- "Svelte 5 `$effect` cleanup functions run before the next effect re-run, not after component unmount — matters for interval/timeout cleanup."

**BAD learning (do NOT write these as learnings):**
- Task state ("I changed Links.cs to add a new field") — this is handoff info, not a learning
- Secrets, credentials, tokens, connection strings
- Handoff info — file lists, "what I did this session" — belongs in the handoff skill, not learning-capture
- One-off observations specific to a single call site with no generalizable insight
- Milestone markers ("Phase 1 complete") — those belong to `state,milestone`, written by planners

## Tag Discipline

| Tag | Meaning | Written by | Never written by |
|-----|---------|-----------|-------------------|
| `learning,<domain>` | Reusable, durable knowledge (backend/frontend/qa/aspire/review) | Worker agents, via learning-capture step | Handoff skill |
| `handoff` | Task-transfer state between agents | ONLY the handoff skill | Learning-capture step |
| `state,milestone` | Short-lived milestone markers | Planners (Prometheus, Sisyphus) | Worker learning-capture |

### FIREWALL (critical, non-negotiable)

- Learning-capture writes MUST NEVER include the `handoff` tag.
- Handoff writes MUST NEVER include the `learning` tag.
- `memory(mode="forget")` and any consolidation/pruning process MUST NEVER target memories tagged `handoff`. Handoff memories are transient by nature of the workflow (consumed by the next agent), not by deletion policy — do not let automated cleanup remove them before they're read.
- These are two entirely separate memory streams serving different purposes: `learning` accumulates project knowledge over time; `handoff` transfers point-in-time task state. Do not blend them.

## Search Before Writing

Always search before adding a new learning:

```
memory(mode="search", query="<topic>", scope="project")
```

- If a near-duplicate exists, prefer `memory(mode="update", memoryId="...", content="...")` to add detail rather than creating a duplicate entry.
- If no match exists, write a new one with `mode="add"`.
- Skip writing if the "learning" is trivial, already well-documented in a skill file, or a one-off.

## Format

- Keep learnings under 150 words.
- Lead with the CONCLUSION first, then (optionally) a short "because" clause. Do not narrate the investigation.
- Good: "Aspire health checks time out at 30s by default — increase via `WithHealthCheck` timeout param for slow-starting containers."
- Bad: "I was debugging why the container kept restarting, and after checking the logs and the Aspire docs I found that the default health check timeout is 30 seconds, so I had to increase it."
