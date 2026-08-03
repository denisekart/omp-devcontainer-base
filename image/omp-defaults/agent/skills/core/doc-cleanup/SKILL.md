<!-- ported for oh-my-pi -->
---
name: doc-cleanup
description: Audit and clean a repo's markdown docs for agent-context rot — completed-work logs, executed plans never rewritten, stale facts, internal contradictions, dead paths. Use when the user asks to evaluate/clean up docs, says docs are "hurting agent thinking", mentions "doc debt", "stale docs", "docs cleanup", or when agent-entry docs (CLAUDE.md/AGENTS.md and their required reading) have grown fat with history.
---

# Doc cleanup — remove context rot from agent-facing docs

Docs that agents must read every session are paid for in context tokens and,
worse, in wrong conclusions: a stale fact in an "authoritative" doc beats a
correct fact an agent never looks up. This skill audits, then archives history
and rewrites live docs down to current facts.

**Two-phase contract: diagnose first, report findings, and only execute after
the user approves.** Never silently rewrite docs.

## Phase 1 — Inventory

1. `find . -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs wc -l | sort -rn`
2. Read the agent-entry docs (`CLAUDE.md`, `AGENTS.md`, and every doc they
   instruct agents to read before working). These cost context in *every*
   session — weight them highest.

## Phase 2 — Diagnose (read-only)

Hunt six rot patterns:
1. **Completed-work logs.**
2. **Executed plans never rewritten.**
3. **Internal contradictions.**
4. **Stale facts vs code.**
5. **Dead paths.**
6. **Authority drift.**

## Phase 3 — Report
Present findings worst-first. Propose cleanup plan.

## Phase 4 — Execute (after approval)
- **Archive, don't delete.**
- **Rewrite live doc to current facts.**
- **Point at sources of truth.**
- **Collapse done checklists.**
- **Keep the traps.**
- **Banner superseded authorities.**
- **Fix entry docs.**

## Phase 5 — Verify
Check links and git status.
