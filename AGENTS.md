# Project Context (omp-devcontainer-base bootstrap)

## Stack

generic

## Active omp Profiles

- dotnet-aspire
- svelte

## Profiles Location

User-level core skills and agents are active from ~/.omp/agent/skills/ and ~/.omp/agent/agents/ (baked into the base image).
Project-level overrides can be placed in .omp/skills/ and .omp/agents/.

## Native Workflow

- **Delegation**: Use the `task` tool to delegate work to specialized agents (e.g., `task(agent="backend-expert", task="...")`).
- **Memory**: Use the `recall` tool to check for prior context, and `retain` to save new project-wide learnings (`reflect` for synthesized answers across many memories).
- **Handoff**: Use `/continue` to save state and resume in a fresh session when context becomes too heavy.
- **Plan Mode**: Use the native `--plan` flag (or `Alt+Shift+P` in-session). The agent submits plans via the `xd://propose` approval dialog; approved plan files live in `.omp/plans/`. The `plan-guidance` skill encodes the plan-file contract.

## Orchestration (main agent = orchestrator, not worker)

- The main agent plans, delegates, and verifies. It does NOT do grunt work itself: no bulk reads/greps, no file edits, no long-running commands — it coordinates.
- Delegate independent work to **isolated** subagents via the `task` tool; `task` is fire-and-forget (returns a job id managed via `hub jobs`/`hub wait`); independent items are automatically backgrounded (`forceTopLevelAsync: true`).
- Each subagent runs in its own context (and, where the filesystem allows, an isolated working-tree clone) — results are summarized back, so the orchestrator's context stays lean.
- Route by work type: external/docs/API research → `librarian`, codebase research → `scout`, code review → `reviewer` (project override), .NET → `backend-expert`, frontend → `frontend-expert`, Aspire → `dotnet-aspire`, tests/QA → `quality-assurance`, docs → `documentation-specialist`, UI polish → `designer`, hard problems/architecture → `oracle`.

## Knowledge base

- This workspace has a knowledge base: KB name = repo directory name, store `~/.omp/knowledge/`. On questions about project files/code not open in context, search the KB (`knowledge_search`) before re-reading files. After meaningful edits to indexed content or after new major docs, run `knowledge_update` on the KB.
- Use `knowledge_add` once at session start if `knowledge_show` has no KB for this repo. Never index `~`, `node_modules`, `bin/`, `obj/`, `dist/` (extension defaults already exclude them).

## Project-Scoped Artifacts (always under the project .omp/, never the user home)

- Plans   → .omp/plans/<slug>.md
- Skills  → .omp/skills/
- When producing a plan, write it under the project .omp/ (never the session-local local:// root or the user home ~/.omp/agent) — it must live with the repo so it persists and is reviewable.

## Scaffolding

- Run `/scaffold` to generate the recommended project structure for the current stack.
