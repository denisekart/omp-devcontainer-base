#!/usr/bin/env bash
# bootstrap.sh — Workspace bootstrap for omp-devcontainer-base
#
# Usage:
#   bash bootstrap.sh [--stack <preset>]
#
# Presets: dotnet-aspire-svelte | dotnet-only | svelte-only | generic
#
# Writes AGENTS.md and .omp/ configuration into the workspace root
# (git toplevel if available, otherwise the current directory).
# Existing files are never overwritten.
# Project structure (src/tests/docs) is handled via the /scaffold slash command.
set -euo pipefail

STACK_SET=0
STACK=""

usage() {
  echo "Usage: bootstrap.sh [--stack <preset>]"
  echo ""
  echo "Presets: dotnet-aspire-svelte | dotnet-only | svelte-only | generic"
  echo "  --stack <preset>  Force a stack preset instead of auto-detecting"
  echo "  -h, --help        Show this help"
}

# --- Args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "bootstrap.sh: --stack requires a value" >&2
        usage >&2
        exit 1
      fi
      STACK="$2"
      STACK_SET=1
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "bootstrap.sh: unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# --- Resolve the workspace root once; every write below is anchored to it ---
if WORKSPACE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  WORKSPACE_ROOT="$(pwd)"
fi
cd "$WORKSPACE_ROOT"
echo "bootstrap.sh: workspace root: $WORKSPACE_ROOT"

# --- Stack detection: pruned, first-match, no xargs-empty-input trap ---
find_pruned() {
  # Find relative to CWD, skipping VCS/build/dependency trees
  find . \( -name node_modules -o -name .git -o -name bin -o -name obj \
            -o -name dist -o -name .omp \) -prune -o "$@" 2>/dev/null
}

has_dotnet() {
  find_pruned \( -name '*.sln' -o -name '*.csproj' \) -print -quit | grep -q .
}

has_aspire() {
  # AppHost projects are conventionally named *AppHost*.csproj and/or
  # reference the Aspire.Hosting.AppHost package
  if [[ -n "$(find_pruned -name '*AppHost*.csproj' -print -quit)" ]]; then
    return 0
  fi
  find_pruned -name '*.csproj' -print0 \
    | xargs -0 -r grep -l 'Aspire\.Hosting\.AppHost' 2>/dev/null | grep -q .
}

has_svelte() {
  find_pruned -name package.json -print0 \
    | xargs -0 -r grep -l '"svelte"' 2>/dev/null | grep -q .
}

if [[ "$STACK_SET" -eq 1 ]]; then
  echo "bootstrap.sh: using stack: $STACK"
else
  if has_dotnet; then
    if has_aspire; then
      if has_svelte; then
        STACK="dotnet-aspire-svelte"
      else
        STACK="dotnet-only"
      fi
    else
      STACK="dotnet-only"
    fi
  elif has_svelte; then
    STACK="svelte-only"
  else
    STACK="generic"
  fi
  echo "bootstrap.sh: detected stack: $STACK"
fi

# --- Map stack to profiles ---
PROFILES=()
case "$STACK" in
  dotnet-aspire-svelte|generic) PROFILES=("dotnet-aspire" "svelte") ;;
  dotnet-only)                  PROFILES=("dotnet-aspire") ;;
  svelte-only)                  PROFILES=("svelte") ;;
  *)
    echo "bootstrap.sh: unknown stack: $STACK (expected: dotnet-aspire-svelte | dotnet-only | svelte-only | generic)" >&2
    exit 1
    ;;
esac

# --- Helpers ---
write_if_absent() {
  local target="$1" content="$2"
  if [[ -e "$target" ]]; then
    echo "bootstrap.sh: SKIP (exists): $target"
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  printf '%s' "$content" > "$target"
  echo "bootstrap.sh: created: $target"
}

profile_bullets() {
  if [[ ${#PROFILES[@]} -eq 0 ]]; then
    echo "(none)"
  else
    local p
    for p in "${PROFILES[@]}"; do
      echo "- $p"
    done
  fi
}

echo "bootstrap.sh: stack=$STACK profiles=${PROFILES[*]:-none}"

# --- .omp directory skeleton ---
mkdir -p .omp/drafts .omp/plans .omp/skills .omp/specs .omp/agents
touch .omp/drafts/.gitkeep .omp/plans/.gitkeep .omp/skills/.gitkeep .omp/specs/.gitkeep .omp/agents/.gitkeep
echo "bootstrap.sh: ensured .omp/{drafts,plans,skills,specs,agents}/"

# --- AGENTS.md project context file ---
AGENTS_CONTENT="# Project Context (omp-devcontainer-base bootstrap)

## Stack
${STACK}

## Active omp Profiles
$(profile_bullets)

## Profiles Location
User-level core skills and agents are active from ~/.omp/agent/skills/ and ~/.omp/agent/agents/ (baked into the base image).
Project-level overrides can be placed in .omp/skills/ and .omp/agents/.

## Native Workflow
- **Delegation**: Use the \`task\` tool to delegate work to specialized agents (e.g., \`task(agent=\"backend-expert\", task=\"...\")\`).
- **Memory**: Use the \`recall\` tool to check for prior context and the \`store\` tool to save new project-wide learnings.
- **Handoff**: Use \`/continue\` to save state and resume in a fresh session when context becomes too heavy.
- **Plan Mode**: Use the \`--plan\` flag to create plans in \`.omp/plans/\`.

## Orchestration (main agent = orchestrator, not worker)
- The main agent plans, delegates, and verifies. It does NOT do grunt work itself: no bulk reads/greps, no file edits, no long-running commands — it coordinates.
- Delegate independent work to **isolated** subagents via the \`task\` tool; fire independent items in parallel (\`background=true\`), sequence only on true dependencies.
- Each subagent runs in its own context (and, where the filesystem allows, an isolated working-tree clone) — results are summarized back, so the orchestrator's context stays lean.
- Route by work type: research/lookups→\`librarian\`, C#/backend→\`backend-expert\`, Svelte/frontend→\`frontend-expert\`, tests/QA→\`quality-assurance\`, Aspire wiring→\`dotnet-aspire\`, docs→\`documentation-specialist\`, hard problems/architecture→\`oracle\`.
- Re-delegate a failing subtask (max 3×) before escalating to \`oracle\`.

## Project-Scoped Artifacts (always under the project .omp/, never the user home)
- Plans   → .omp/plans/<slug>.md
- Drafts  → .omp/drafts/<slug>.md
- Specs   → .omp/specs/<slug>/  (requirements.md, design.md)
- Skills  → .omp/skills/
- When producing a plan/draft, write it under the project .omp/ (via the plan-workflow skill). Do NOT leave session artifacts in a session-local (local://) root or the user home (~/.omp/agent) — they must live with the repo so they persist and are reviewable.

## Scaffolding
- Run \`/scaffold\` to generate the recommended project structure for the current stack.
"
write_if_absent "AGENTS.md" "$AGENTS_CONTENT"

OMP_CONFIG="# Project-level omp settings
# Mirrors user-level ~/.omp/agent/config.yml (baked defaults) — keep in sync.
# Arrays REPLACE (not merge) — restate the full list if overriding extensions

stack: ${STACK}
defaultThinkingLevel: \"xhigh\"

# Model Role Mapping
#   qwen3.8-27b = primary (agentic reasoning; default/slow/plan)
#   qwen3.6-35b = worker (35B-A3B MoE; delegated subagent tasks) + advisor (binary thinking, on by default)
#   qwen3-coder-4b = smol (background/utility tasks)
modelRoles:
  default: \"litellm/qwen3.8-27b\"
  smol: \"litellm/qwen3-coder-4b\"
  slow: \"litellm/qwen3.8-27b\"
  plan: \"litellm/qwen3.8-27b\"
  task: \"litellm/qwen3.6-35b\"     # Worker model: strong coder/specialist given detailed instructions
  memory: \"litellm/qwen3-coder-4b\" # Used for mnemopi extraction (online fallback)
  tiny: \"litellm/qwen3-coder-4b\"   # Used for lightweight background tasks (online fallback)
  advisor: \"litellm/qwen3.6-35b\"     # Passive reviewer; binary thinking, on by default (no effort levels)

# Advisor (passive reviewer)
# A second model reviews the primary transcript as it happens and can inject
# advice (nits / concerns / blockers) into the session. Runs the qwen3.6 worker
# (binary thinking — on by default, no effort levels). OFF by default:
#   per session:    /advisor on          (also: /advisor off | status | dump)
#   single run:     omp -p --advisor 'task'
#   persistently:   flip advisor.enabled to true
# Reviewer guidance: add WATCHDOG.md (.omp/ or the user agent dir) for review
# priorities, or WATCHDOG.yml for a named advisor roster.
advisor:
  enabled: false

# Retry / Fallback Chains (retry.fallbackChains)
# Model-oriented keys: every role running qwen3.8-27b (default/slow/plan) falls
# back to the qwen3.6-35b worker; every role running qwen3-coder-4b
# (smol/memory/tiny) falls back to the worker too. The offline path for the
# small online models is the on-device lfm2-1.2b (task-specific providers below).
retry:
  fallbackChains:
    \"litellm/qwen3.8-27b\":
      - \"litellm/qwen3.6-35b\"
    \"litellm/qwen3-coder-4b\":
      - \"litellm/qwen3.6-35b\"

# Local Tiny-Model Providers (Task-specific)
# Reference: https://github.com/can1357/oh-my-pi/blob/main/docs/local-models.md
# Side tasks (titles, mnemopi extraction/consolidation, auto-thinking difficulty)
# run on the baked-in local model lfm2-1.2b — most capable of the models
# pre-downloaded into the image (gemma-270m, lfm2-350m, lfm2-1.2b) and the
# fastest warm load (~0.4s). Offline-resilient path for the small online
# models; set an entry back to \"online\" to route through the online role model.
providers:
  tinyModel: \"lfm2-1.2b\"          # e.g., \"gemma-270m\" or \"lfm2-350m\" for faster titles
  memoryModel: \"lfm2-1.2b\"        # recommended local memory model
  autoThinkingModel: \"lfm2-1.2b\"  # dynamic thinking-difficulty classifier
  tinyModelDevice: \"cpu\"     # cpu (default), gpu, auto, metal, cuda, dml, wasm
  tinyModelDtype: \"q4\"       # q4 (default), fp16

# Subagent Concurrency & Parallelism
# Engine limits: qwen3.8-27b serves --max-num-seqs 2 (big-model slots); the
# qwen3.6-35b worker serves --max-num-seqs 6 (vLLM queues overflow beyond 6).
subagents:
  globalConcurrencyLimit: 20    # Combined limit (2 big + 18 small sessions)
  maxSubagentDepth: 2           # Prevent unbounded nesting
  forceTopLevelAsync: true      # Background tasks by default
  parallel:
    concurrency: 2              # Max parallel slots for 'big' model tasks (qwen3.8 --max-num-seqs 2)

task:
  isolation:
    mode: \"auto\"
"
write_if_absent ".omp/config.yml" "$OMP_CONFIG"

# --- .omp/models.yml (workspace-level models configuration) ---
USER_MODELS="${HOME}/.omp/agent/models.yml"
DEFAULT_MODELS="/usr/local/share/omp-defaults/agent/models.yml"
if [[ -e ".omp/models.yml" ]]; then
  echo "bootstrap.sh: SKIP (exists): .omp/models.yml"
else
  if [[ -f "$USER_MODELS" ]]; then
    mkdir -p .omp
    cp -p "$USER_MODELS" ".omp/models.yml"
    echo "bootstrap.sh: created: .omp/models.yml (copied from $USER_MODELS)"
  elif [[ -f "$DEFAULT_MODELS" ]]; then
    mkdir -p .omp
    cp -p "$DEFAULT_MODELS" ".omp/models.yml"
    echo "bootstrap.sh: created: .omp/models.yml (copied from $DEFAULT_MODELS)"
  fi
fi

# --- .omp/mcp.json (project-level, stack-specific servers) ---
# Core servers (git, fetch, time, etc.) are already in ~/.omp/agent/mcp.json.
# Built with jq -n so the file is guaranteed valid JSON; aborts if jq fails.
MCP_SCHEMA="https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json"
MCP_JSON=""
case "$STACK" in
  dotnet-aspire-svelte|dotnet-only|generic)
    MCP_JSON="$(jq -n --arg schema "$MCP_SCHEMA" '{
      "$schema": $schema,
      mcpServers: {
        docker:    {command: "mcp-server-docker"},
        aspire:    {command: "aspire", args: ["agent", "mcp"]},
        shadcn:    {command: "npx",    args: ["-y", "shadcn@latest", "mcp"]},
        puppeteer: {command: "npx",    args: ["-y", "@modelcontextprotocol/server-puppeteer"]}
      }
    }')"
    ;;
  svelte-only)
    MCP_JSON="$(jq -n --arg schema "$MCP_SCHEMA" '{
      "$schema": $schema,
      mcpServers: {
        shadcn:    {command: "npx", args: ["-y", "shadcn@latest", "mcp"]},
        puppeteer: {command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"]}
      }
    }')"
    ;;
esac

if [[ -n "$MCP_JSON" ]]; then
  write_if_absent ".omp/mcp.json" "$MCP_JSON"
fi

echo "bootstrap.sh: done (stack=$STACK)"