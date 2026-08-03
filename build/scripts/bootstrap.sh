#!/usr/bin/env bash
# bootstrap.sh — Workspace bootstrap for omp-devcontainer-base
#
# Usage:
#   bash bootstrap.sh [--stack <preset>]
#
# Presets: dotnet-aspire-svelte | dotnet-only | svelte-only | generic
#
# Writes .omp/, AGENTS.md.
# Project structure (src/tests/docs) is handled via `/scaffold` slash command in omp.
set -euo pipefail

STACK="generic"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) STACK="${2:-generic}"; shift 2 ;;
    *) echo "bootstrap.sh: unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Auto-detect stack if not specified
if [[ "$STACK" == "generic" ]]; then
  if find . \( -name "*.csproj" -o -name "*.sln" \) 2>/dev/null | head -1 | grep -q .; then
    if grep -rl "AddProject" . --include="*.cs" 2>/dev/null | head -1 | grep -q .; then
      if find . -name "package.json" 2>/dev/null | xargs grep -l '"svelte"' 2>/dev/null | head -1 | grep -q .; then
        STACK="dotnet-aspire-svelte"
        echo "bootstrap.sh: auto-detected stack: dotnet-aspire-svelte"
      else
        STACK="dotnet-only"
        echo "bootstrap.sh: auto-detected stack: dotnet-only"
      fi
    fi
  elif find . -name "package.json" 2>/dev/null | xargs grep -l '"svelte"' 2>/dev/null | head -1 | grep -q .; then
    STACK="svelte-only"
    echo "bootstrap.sh: auto-detected stack: svelte-only"
  else
    echo "bootstrap.sh: no stack detected, using: generic"
  fi
fi

# Detect profiles from stack
PROFILES=()
case "$STACK" in
  dotnet-aspire-svelte) PROFILES=("dotnet-aspire" "svelte") ;;
  dotnet-only)          PROFILES=("dotnet-aspire") ;;
  svelte-only)          PROFILES=("svelte") ;;
  generic)              PROFILES=() ;;
  *) echo "bootstrap.sh: unknown stack: $STACK" >&2; exit 1 ;;
esac

# Helper: write file only if it does not exist (never overwrite)
write_if_absent() {
  local target="$1"
  local content="$2"
  if [[ -e "$target" ]]; then
    echo "bootstrap.sh: SKIP (exists): $target"
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  printf '%s' "$content" > "$target"
  echo "bootstrap.sh: created: $target"
}

echo "bootstrap.sh: stack=$STACK profiles=${PROFILES[*]:-none}"

# --- Write .omp structure ---
mkdir -p .omp/drafts .omp/plans
touch .omp/drafts/.gitkeep .omp/plans/.gitkeep
echo "bootstrap.sh: created .omp/{drafts,plans}/"

# --- Write AGENTS.md context file ---
AGENTS_CONTENT="# Project Context (omp-devcontainer-base bootstrap)

## Stack
$STACK

## Active omp Profiles
$(for p in "${PROFILES[@]:-}"; do echo "- $p"; done)

## Profiles Location
User-level core skills and agents are active from ~/.omp/agent/skills/ and ~/.omp/agent/agents/ (baked into the base image).
Project-level overrides can be placed in .omp/skills/.

## Native Workflow
- **Delegation**: Use the `task` tool to delegate work to specialized agents (e.g., `task(agent="backend-expert", task="...")`).
- **Memory**: Use the `recall` tool to check for prior context and the `store` tool to save new project-wide learnings.
- **Handoff**: Use `/continue` to save state and resume in a fresh session when context becomes too heavy.
- **Plan Mode**: Use the `--plan` flag to create plans in `.omp/plans/`.

## Scaffolding
- Run \`/scaffold\` to generate the recommended project structure for the current stack.
"
write_if_absent "AGENTS.md" "$AGENTS_CONTENT"

# --- Write .omp/config.yml ---
OMP_CONFIG="# Project-level omp settings
# Extends user-level ~/.omp/agent/config.yml
# Arrays REPLACE (not merge) — restate the full list if overriding extensions

stack: $STACK
"
write_if_absent ".omp/config.yml" "$OMP_CONFIG"

# --- Write .omp/mcp.json (project-level, stack-specific servers) ---
# Note: Core servers (git, fetch, time, filesystem) are already in global ~/.omp/agent/mcp.json
STACK_MCP_SERVERS=""
case "$STACK" in
  dotnet-aspire-svelte|dotnet-only)
    STACK_MCP_SERVERS='"docker": {"command": "uvx", "args": ["mcp-server-docker"]}, "aspire": {"command": "aspire", "args": ["agent", "mcp"]}, "shadcn": {"command": "npx", "args": ["-y", "shadcn@latest", "mcp"]}, "puppeteer": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"]}' ;;
  svelte-only)
    STACK_MCP_SERVERS='"shadcn": {"command": "npx", "args": ["-y", "shadcn@latest", "mcp"]}, "puppeteer": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"]}' ;;
  generic)
    STACK_MCP_SERVERS="" ;;
esac

if [[ -n "$STACK_MCP_SERVERS" ]]; then
  MCP_JSON='{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {'"${STACK_MCP_SERVERS}"'}
}'
  write_if_absent ".omp/mcp.json" "$(echo "$MCP_JSON" | jq . 2>/dev/null || echo "$MCP_JSON")"
fi

# --- Ensure .omp/skills directory exists for project overrides ---
mkdir -p .omp/skills
touch .omp/skills/.gitkeep
echo "bootstrap.sh: created .omp/skills/ for project-level overrides"

echo "bootstrap.sh: done (stack=$STACK)"
