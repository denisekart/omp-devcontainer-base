# Project Context (omp-devcontainer-base bootstrap)

## Stack
generic

## Active omp Profiles
- dotnet-aspire
- svelte

## Profiles Location
User-level core skills and agents are active from ~/.omp/agent/skills/ and ~/.omp/agent/agents/ (baked into the base image).
Project-level overrides can be placed in .omp/skills/.

## Native Workflow
- **Delegation**: Use the `task` tool to delegate work to specialized agents (e.g., `task(agent="backend-expert", task="...")`).
- **Memory**: Use the `recall` tool to check for prior context and the `store` tool to save new project-wide learnings.
- **Handoff**: Use `/continue` to save state and resume in a fresh session when context becomes too heavy.
- **Plan Mode**: Use the `--plan` flag to create plans in `.omp/plans/`.

## Scaffolding
- Run `/scaffold` to generate the recommended project structure for the current stack.
