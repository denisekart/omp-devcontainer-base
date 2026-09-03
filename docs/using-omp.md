# Using omp — Day-to-Day

Day-to-day reference for working with `omp` inside the container. Setup and onboarding are in [getting-started.md](getting-started.md).

## Starting a Session

- `omp` starts the TUI. `pi` is a symlink to the same binary; `oc` is a zsh alias for it.
- `omp --profile <name>` starts a session under a named profile (see [Profiles](#profiles)).
- Plan mode: launch with `--plan` — planning follows the plan workflow below and plan artifacts land in `.omp/plans/`.

## Plan Workflow

The baked `plan-workflow` skill governs how significant changes are planned. It is a planning-only workflow: it never implements, and it never starts work on its own.

1. **Draft** — the agent writes a draft at `.omp/drafts/<slug>.md` (components ledger, open assumptions, scope IN/OUT).
2. **Gap analysis** — a mandatory read-only sub-session checks the draft for contradictions, missing constraints, and unvalidated assumptions; findings are folded in.
3. **Approval gate** — the brief is presented once and waits for your explicit approval. Approval authorizes plan creation only, never implementation.
4. **Plan file** — after approval, `.omp/plans/<slug>.md` is written: every todo is a column-zero checkbox carrying references, executable acceptance criteria, QA scenarios (happy + failure), and a commit message.
5. **Dual high-accuracy review** (for ambiguous requests or on request) — two concurrent review sub-sessions (a plan critic and an independent architecture reviewer) run until both approve.
6. **Execution** — only the `start-work` skill executes an approved plan, and it is invoked by the **user**, never by the agent.

Architecture-tier plans — those meeting 2+ of: a new durable service, 5+ modules touched, a new external contract, multi-session scope — additionally get SDD-lite companion docs at `.omp/specs/<slug>/requirements.md` and `.omp/specs/<slug>/design.md`.

For spec-driven work (drafts → approved plan with full spec + task dependency matrix → wave-parallel execution with tracked progress), follow the SDD workflow: [docs/spec-driven-development.md](spec-driven-development.md). The `plan-workflow` and `start-work` skills implement it.

## Delegation & the Agent Fleet

The `task` tool spawns subagents that work in parallel: `task(agent="backend-expert", task="...")`. Seeded concurrency in `~/.omp/agent/config.yml`: `globalConcurrencyLimit: 20`, `parallel.concurrency: 4`, `maxSubagentDepth: 2`, `forceTopLevelAsync: true`.

Nine agents are baked into the image (`build/library/omp-defaults/agent/agents/`):

| Agent | Role |
|-------|------|
| `backend-expert` | Specialist for .NET 10, EF Core, and ASP.NET Core Minimal APIs |
| `code-reviewer` | Specialist for read-only code reviews and impact analysis |
| `documentation-specialist` | Specialist for technical documentation, diagrams, and CHANGELOG |
| `dotnet-aspire` | Specialist for .NET Aspire orchestration, service discovery, and distributed observability |
| `frontend-expert` | Specialist for Svelte 5, Tailwind, and shadcn/ui |
| `librarian` | Fast, precise info retrieval from codebase and docs |
| `oracle` | Fleet's architectural reasoning engine for complex decisions and debugging |
| `plan` | Lead Architect and orchestrator of the agent fleet |
| `quality-assurance` | Specialist for xUnit, Playwright .NET, and Aspire testing |

## Memory (Hindsight)

Memory runs on the Hindsight server (port 8888, see [tmux.md](tmux.md) for the self-healing session). Seeded configuration: `memory.backend: hindsight`, `hindsight.apiUrl: http://localhost:8888`, `scoping: per-project-tagged`, `autoRecall: true`, `autoRetain: true`, `recallBudget: high`, `retainMode: last-turn`.

- `recall` — searches prior context before answering or acting
- `store` — persists durable facts (decisions, conventions, learnings)
- `reflect` — synthesized answers across many memories

Memory lives on the persistent `~/.hindsight` volume, so it is shared across your projects but scoped per project tag. Lightweight mode: set `memory.backend: mnemopi` (SQLite) in `~/.omp/agent/config.yml`.

## Profiles

`omp --profile work` runs a session under the `work` profile. A named profile isolates user-level configuration (MCP, skills, agents, history) under `~/.omp/profiles/<name>/agent/`; project-level `.omp/` is shared across all profiles, so everyone on the project sees the same project config regardless of profile.

## Slash Commands

| Command | What it does |
|---------|--------------|
| `/scaffold` | Creates the directory skeleton for the detected stack |
| `/scaffold --stack <preset>` | Forces a specific preset instead of detection |
| `/continue` | Native handoff — starts a fresh session with the current context summarized |
| `/mcp add\|enable\|disable\|reauth` | MCP server management (see [mcp.md](mcp.md)) |

`/scaffold` presets and the structures they create:

| Preset | Structure |
|--------|-----------|
| `dotnet-aspire-svelte` | `src/App.AppHost`, `src/App.Web`, `src/App.ServiceDefaults`, `tests/App.Tests.Unit`, `tests/App.Tests.E2E`, `src/frontend`, `docs` |
| `dotnet-only` | `src/App.AppHost`, `src/App.Web`, `src/App.ServiceDefaults`, `tests/App.Tests.Unit`, `docs` |
| `svelte-only` / `generic` | `src`, `tests`, `docs` |

Skills do not need manual invocation: they load automatically when their description matches the current work.

## Baked Skills

All 33 skills are baked into the image (`build/library/omp-defaults/agent/skills/`):

**Workflow**

| Skill | Description |
|-------|-------------|
| `plan-workflow` | Spec-driven planning workflow: specify (local:// drafts with revision log, EARS requirements, tier rubric), gap analysis, approval via `xd://propose`, materialization to `.omp/plans` + `.omp/specs` + `.omp/drafts`, plan-file contract (full spec + todos + dependency matrix), adversarial review loops |
| `start-work` | Executes an approved `.omp/plans/<slug>.md` via the SDD implement stage: wave-parallel dispatch from the dependency matrix, per-todo verification, automatic progress tracking, spec-drift handling, final verification wave with spec-coverage audit; invoked only explicitly by the user |
| `handoff` | Transitions state between sessions or agents (native `/continue` and `task` blocks) |
| `verification-gate` | Final verification steps to ensure code quality and mitigate AI hallucinations |
| `subagent-orchestration` | Guidelines for delegating tasks to agents, coordinating their efforts, and merging results |
| `agent-gotchas` | Common pitfalls and mistakes to avoid when generating or modifying .NET code |
| `memory-discipline` | Discipline for reading and writing memory — what makes a good learning, tag conventions, handoff firewall |
| `solution-navigation` | Efficiently navigating and understanding large .NET solutions, project structures, and dependency graphs |

**.NET**

| Skill | Description |
|-------|-------------|
| `backend-conventions` | Guidelines for ASP.NET Core 10, C# 14, Clean Architecture, and EF Core |
| `background-services` | Hosted services, background jobs, outbox patterns, and graceful shutdown |
| `caching-strategies` | Output caching, memory caching, distributed caching with Redis, and HybridCache |
| `ci-cd-patterns` | GitHub Actions, project building, testing, and deployment workflows for .NET and SvelteKit |
| `concurrency-patterns` | Choosing the right concurrency abstraction: async/await, Channels, Parallel.ForEachAsync, synchronization primitives |
| `dotnet-architecture-patterns` | Organizing APIs at scale: vertical slices, request pipelines, caching, error handling, idempotency |
| `dotnet-aspire` | Guidelines for .NET Aspire orchestration, resource management, and distributed application patterns |
| `ef-core-specialist` | Advanced EF Core patterns: architecture, performance, migrations, clean data modeling |
| `exception-handling` | Global error handling, ProblemDetails mapping, and resilience patterns |

**Frontend**

| Skill | Description |
|-------|-------------|
| `svelte-code-writer` | Svelte 5 code writing guidance; consults Svelte 5/SvelteKit docs before writing components |
| `svelte-core-bestpractices` | Best practices for writing fast, robust Svelte 5 code |
| `ui-ux-design-language` | Design system enforcement: colour tokens, typography, spacing, component conventions, accessibility, motion |
| `frontend-expert` | Comprehensive guidelines for Svelte 5, design system, and modern UI/UX |
| `playwright-testing` | End-to-end (E2E) testing with Playwright for .NET under Aspire orchestration |

**Quality & Analysis**

| Skill | Description |
|-------|-------------|
| `test-quality` | Measuring and improving test effectiveness: coverage, CRAP score analysis, mutation testing |
| `validation-patterns` | Input validation patterns using .NET 10 AddValidation, FluentValidation, and ProblemDetails |
| `performance-analyst` | .NET performance tuning, allocation reduction, async optimization, type design, database access |
| `security-auditor` | ASP.NET Core security, authentication patterns, secrets management, OWASP mitigation |
| `crap-analysis` | Coverage and CRAP (Change Risk Anti-Patterns) scores via OpenCover/ReportGenerator risk hotspots |
| `doc-cleanup` | Audits and cleans repo markdown docs for agent-context rot: stale facts, dead paths, history bloat |
| `technical-writer` | Guidelines for high-quality technical documentation, CHANGELOG management, and code commenting |

**Utilities**

| Skill | Description |
|-------|-------------|
| `csharp-scripts` | Writing and running single-file C# programs via top-level statements and `dotnet <file>.cs` |
| `coding-standards` | Modern, high-performance C# standards: records, pattern matching, value objects, async/await |
| `file-handling` | Best practices for file I/O, streaming, and large file processing in .NET |
| `scaffold-workspace` | Provides the `/scaffold` command to generate recommended project structures |

## Models & Roles

Models use a two-tier system: `models.yml` defines where models are (providers, endpoints, keys); `config.yml` maps them to the native roles (`default`, `smol`, `slow`, `plan`, `task`, `memory`, `tiny`). Local tiny models can run on-device for background tasks. Full reference: [models.md](models.md).

## MCP

MCP servers connect the agent to external tools. Two layers exist — user-level (`~/.omp/agent/mcp.json`, seeded from the image) and project-level (`.omp/mcp.json`, generated per stack) — with project-wins precedence and no same-name merging. Reference: [mcp.md](mcp.md).

## Plugins

Four plugins are installed by default at first boot: `pi-loop-police` (infinite-loop detection), `pi-lens` (real-time LSP/linter feedback), `context-mode` (context-window savings via MCP), and `pi-simplify` (output simplification). Adoption decisions and the deferred/considered lists: [plugins.md](plugins.md).
