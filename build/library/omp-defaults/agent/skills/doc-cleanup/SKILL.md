---
name: doc-cleanup
description: "Audit and clean a repo's markdown docs for agent-context rot — completed-work logs, stale facts, contradictions, dead paths."
---

# Doc cleanup

## When to use

- User asks to evaluate/clean up docs, mentions "doc debt", "stale docs", or "docs cleanup".
- Agent-entry docs (`CLAUDE.md`, `AGENTS.md` and their required readings) have grown fat with history.
- Internal contradictions, stale facts, or dead paths are suspected in the repo's documentation.

## Rules

1. **Two-phase contract**: diagnose first, report findings, execute only after user approval. Never silently rewrite.
2. Use real tools (`read`, `glob`, `lsp`) — never `ls` or shell globbing for discovery.
3. **Archive, don't delete**: move completed work logs and executed plans to archive.
4. Rewrite live docs down to current facts; point at sources of truth.
5. Collapse done checklists; banner superseded authorities; fix entry docs.

## Phase Contract

| Phase | Action |
| ------- | -------- |
| 1. Inventory | `glob` all `.md` files; weight agent-entry docs highest (they cost context every session). |
| 2. Diagnose | Hunt six rot patterns: completed-work logs, executed plans never rewritten, contradictions, stale facts, dead paths, authority drift. |
| 3. Report | Present findings worst-first; propose cleanup plan for approval. |
| 4. Execute | Archive, rewrite, collapse, banner, fix — after user approves. |
| 5. Verify | Check links and git status. |

## Checklist

- [ ] Are agent-entry docs lean and current?
- [ ] Are completed-work logs archived, not left in live docs?
- [ ] Are executed plans rewritten or archived?
- [ ] Are internal contradictions resolved?
- [ ] Are stale facts updated to current code?
- [ ] Are dead paths removed or bannered?
