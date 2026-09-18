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
- **HTTP**: NEVER inline curl/wget/fetch in bash; use the `fetch` MCP tool or `ctx_fetch_and_index` (the bash guard blocks inline HTTP).

## Orchestration (main agent = orchestrator, not worker)

- The main agent plans, delegates, and verifies. It may apply trivial single-file edits and single-command checks inline, but delegates anything multi-file or multi-step — spawning an isolated subagent for a one-line edit wastes a second inference pass.
- Delegate independent work to **isolated** subagents via the `task` tool; `task` is fire-and-forget (returns a job id managed via `hub jobs`/`hub wait`); independent items are automatically backgrounded (`forceTopLevelAsync: true`).
- Each subagent runs in its own context (and, where the filesystem allows, an isolated working-tree clone) — results are summarized back, so the orchestrator's context stays lean.
- Route by work type: research (incl. external/docs/API) → `scout` + `web_search`, codebase research → `scout`, code review → `reviewer` (project override), .NET → `backend-expert`, frontend → `frontend-expert`, Aspire → `dotnet-aspire`, tests/QA → `quality-assurance`, docs → `documentation-specialist`, UI polish → `frontend-expert`, hard problems/architecture → `oracle`.

## Knowledge base

- This workspace has a knowledge base: KB name = repo directory name, store `~/.omp/knowledge/`. On questions about project files/code not open in context, search the KB (`knowledge_search`) before re-reading files. After meaningful edits to indexed content or after new major docs, run `knowledge_update` on the KB.
- Use `knowledge_add` once at session start if `knowledge_show` has no KB for this repo. Never index `~`, `node_modules`, `bin/`, `obj/`, `dist/` (extension defaults already exclude them).

## Project-Scoped Artifacts (always under the project .omp/, never the user home)

- Plans   → .omp/plans/<slug>.md
- Skills  → .omp/skills/
- When producing a plan, write it under the project .omp/ (never the session-local local:// root or the user home ~/.omp/agent) — it must live with the repo so it persists and is reviewable.

## Scaffolding

- Run `/scaffold` to generate the recommended project structure for the current stack.

## Self-improvement

- If this file or any `.omp/` file references a tool or agent that is not available in this image, delegate one repair pass: `task(agent="repo-doctor", task="audit and repair this repo's .omp/ layer and AGENTS.md")`. Repeat whenever `sync-omp-defaults.sh` or an image update lands.
- To collect this instance's harness experience: `task(agent="harness-retro", task="7-day retro")` — run after significant field sessions or roughly weekly; it prints a pasteable findings document. `/rsi-export [days]` gives the raw telemetry skeleton without an agent run.
- Intake: when a HARNESS FINDINGS document is pasted, delegate it verbatim to `task(agent="harness-retro", ...)` — it checks the ledger, implements valid `[upstream]` proposals in `build/`, and records dispositions. `/rsi-intake <file>` runs the mechanical validate/dedup pass first.
- All skill changes update existing `SKILL.md` files in place; new skills only when ≥2 distinct findings cannot be mapped into any existing skill.
- Full loop guide: `docs/harness-self-improvement.md`.
