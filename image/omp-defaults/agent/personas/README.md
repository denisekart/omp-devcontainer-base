# Personas Wiring

Wire these persona files in `config.yml` under the `agents` section. Point each agent name at the matching markdown file in this directory.

Recommended local model aliases:
- `nemotron-super-120b`
- `qwen-4b-instruct`

Use them first, then fall back to any provider already configured in omp. Example:

```yaml
agents:
  plan:
    model: nemotron-super-120b
    persona: personas/plan-personality.md
  oracle:
    model: qwen-4b-instruct
    persona: personas/oracle-personality.md
  librarian:
    model: nemotron-super-120b
    persona: personas/librarian-personality.md
  backend-dotnet:
    model: nemotron-super-120b
    persona: personas/backend-expert-personality.md
  frontend-svelte:
    model: qwen-4b-instruct
    persona: personas/frontend-expert-personality.md
  quality-assurance:
    model: qwen-4b-instruct
    persona: personas/quality-assurance-personality.md
  code-review:
    model: nemotron-super-120b
    persona: personas/code-reviewer-personality.md
  documentation:
    model: nemotron-super-120b
    persona: personas/documentation-specialist-personality.md
  dotnet-aspire:
    model: qwen-4b-instruct
    persona: personas/dotnet-aspire-personality.md
```
