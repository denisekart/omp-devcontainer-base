---
name: qwen-tuning
description: Qwen3.8 effort levels (low|medium|xhigh), when to drop xhigh→medium in agent loops, Qwen3.6 A3B binary thinking, and sampling expectations.
---
# Qwen Tuning

## When to use

- Selecting effort levels for Qwen3.8 agents in multi-agent loops
- Understanding Qwen3.6 A3B binary-thinking constraints
- Optimizing sampling strategies for agent fleet performance

## Rules

1. **Qwen3.8 effort levels** (set via frontmatter `thinking-level:`):
   - `low`: Fast, cheap. Use for simple lookups, formatting, single-file edits.
   - `medium`: Balanced. Default for most agent work — code changes, research, multi-file tasks.
   - `xhigh`: Deep reasoning. Use for architecture decisions, debugging, complex multi-file refactors.
2. **Drop xhigh→medium in loops**: If an agent loops more than 3 times at `xhigh`, re-dispatch at `medium`. Diminishing returns after ~5 iterations.
3. **Qwen3.6 A3B binary thinking**: No effort levels — thinking is either on or off. Effort keywords (`ultrathink`, `thinking-level`) are no-ops on the worker model. Safe only in frontmatter for `@slow`/`@plan` agents.
4. **No effort in bodies**: For `@task`-mapped agents, omit effort keywords from task bodies. Effort belongs in frontmatter only.
5. **Keep prompts imperative, XML-sectioned, short**: Avoid verbose explanations. Use `##` headers, bullet lists, checkboxes.
6. **Ground claims in tools**: Qwen3.8 is weaker on knowledge-intensive recall. Always reference `read`/`glob`/`lsp`/`web_search` results, not model knowledge.

### Sampling Expectations

- `@task` agents → Qwen3.8 (effort levels apply)
- `@smol` agents → Qwen3.6 A3B (binary thinking, no effort)
- `@slow` agents → Qwen3.8 xhigh-capable model (effort levels apply)

## Pattern

```yaml
# Frontmatter: effort for @task agents
---
name: backend-expert
model: "@task"
thinking-level: medium   # balanced for most work
---

# Frontmatter: effort for @slow agents
---
name: oracle
model: "@slow"
thinking-level: xhigh    # deep reasoning for architecture
---
```

## Checklist

- [ ] Effort level matches task complexity?
- [ ] xhigh agents capped at 3 loops before dropping to medium?
- [ ] No effort keywords in @task agent task bodies?
- [ ] Prompts imperative, XML-sectioned, short?
- [ ] Claims grounded in tools, not model knowledge?
- [ ] Correct model assigned to each agent type?
