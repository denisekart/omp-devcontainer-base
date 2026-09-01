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
mkdir -p .omp/drafts .omp/plans .omp/skills
touch .omp/drafts/.gitkeep .omp/plans/.gitkeep .omp/skills/.gitkeep
echo "bootstrap.sh: ensured .omp/{drafts,plans,skills}/"

# --- AGENTS.md project context file ---
AGENTS_CONTENT="# Project Context (omp-devcontainer-base bootstrap)

## Stack
${STACK}

## Active omp Profiles
$(profile_bullets)

## Profiles Location
User-level core skills and agents are active from ~/.omp/agent/skills/ and ~/.omp/agent/agents/ (baked into the base image).
Project-level overrides can be placed in .omp/skills/.

## Native Workflow
- **Delegation**: Use the \`task\` tool to delegate work to specialized agents (e.g., \`task(agent=\"backend-expert\", task=\"...\")\`).
- **Memory**: Use the \`recall\` tool to check for prior context and the \`store\` tool to save new project-wide learnings.
- **Handoff**: Use \`/continue\` to save state and resume in a fresh session when context becomes too heavy.
- **Plan Mode**: Use the \`--plan\` flag to create plans in \`.omp/plans/\`.

## Scaffolding
- Run \`/scaffold\` to generate the recommended project structure for the current stack.
"
write_if_absent "AGENTS.md" "$AGENTS_CONTENT"

# --- .omp/config.yml ---
OMP_CONFIG="# Project-level omp settings
# Extends user-level ~/.omp/agent/config.yml
# Arrays REPLACE (not merge) — restate the full list if overriding extensions

stack: ${STACK}

# Model Role Mapping (optional project overrides)
# modelRoles:
#   default: \"litellm/qwen3.8-27b\"
#   tiny: \"litellm/qwen3-coder-4b\"

# Local Tiny-Model Providers (Task-specific project overrides)
# Reference: https://github.com/can1357/oh-my-pi/blob/main/docs/local-models.md
# Set to 'online' to use role-mapped models, or specify a local tiny model (e.g. gemma-270m, lfm2-350m, lfm2-1.2b).
# Minimum footprint options:
#   - tinyModel (titles/sub-1B): \"gemma-270m\" (smallest footprint) or \"lfm2-350m\" (~212MB q4)
#   - memoryModel / autoThinkingModel (1B-1.7B): \"lfm2-1.2b\" (recommended ~700MB q4)
providers:
  tinyModel: \"online\"        # e.g., \"gemma-270m\" or \"lfm2-350m\" for fast titles
  memoryModel: \"online\"      # e.g., \"lfm2-1.2b\" for extraction/consolidation
  autoThinkingModel: \"online\" # e.g., \"lfm2-1.2b\" for auto thinking difficulty
  tinyModelDevice: \"cpu\"     # cpu (default), gpu, auto, metal, cuda, dml, wasm
  tinyModelDtype: \"q4\"       # q4 (default), fp16
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
        docker:    {command: "uvx",    args: ["mcp-server-docker"]},
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