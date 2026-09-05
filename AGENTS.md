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
- **Memory**: Use the `recall` tool to check for prior context and the `store` tool to save new project-wide learnings.
- **Handoff**: Use `/continue` to save state and resume in a fresh session when context becomes too heavy.
- **Plan Mode**: Use the native `--plan` flag (or `Alt+Shift+P` in-session). The agent submits plans via the `xd://propose` approval dialog; approved plan files live in `.omp/plans/`.

## Orchestration (main agent = orchestrator, not worker)
- The main agent plans, delegates, and verifies. It does NOT do grunt work itself: no bulk reads/greps, no file edits, no long-running commands — it coordinates.
- Delegate independent work to **isolated** subagents via the `task` tool; fire independent items in parallel, sequence only on true dependencies. Track via `hub jobs` / `hub wait`.
- Each subagent runs in its own context (and, where the filesystem allows, an isolated working-tree clone) — results are summarized back, so the orchestrator's context stays lean.
- Route by work type: external docs/API research→`librarian`; codebase research→`scout`; code review→`reviewer`; .NET→`backend-expert`; frontend→`frontend-expert`; Aspire→`dotnet-aspire`; tests/QA→`quality-assurance`; docs→`documentation-specialist`; UI polish→`designer`; hard problems/architecture→`oracle`.
- Re-delegate a failing subtask (max 3×) before escalating to `oracle`.

## Project-Scoped Artifacts (always under the project .omp/, never the user home)
- Plans   → .omp/plans/<slug>.md
- Skills  → .omp/skills/
- When producing a plan, write it under the project .omp/ (never the session-local local:// root or the user home ~/.omp/agent) — it must live with the repo so it persists and is reviewable.

## Scaffolding
- Run `/scaffold` to generate the recommended project structure for the current stack.
