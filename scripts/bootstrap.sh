#!/usr/bin/env bash
# bootstrap.sh — Workspace bootstrap for omp-devcontainer-base
#
# Usage:
#   bash scripts/bootstrap.sh existing-repo [--stack <preset>]
#   bash scripts/bootstrap.sh new-project --stack <preset>
#
# Presets: dotnet-aspire-svelte | dotnet-only | svelte-only | generic
#
# existing-repo: writes .omp/, .omo/, AGENTS.md, copies profile skills — NEVER creates src/tests/docs
# new-project:   same as existing-repo PLUS scaffolds src/, tests/, docs/ skeleton
set -euo pipefail

MODE="${1:-}"
STACK="generic"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse args
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) STACK="${2:-generic}"; shift 2 ;;
    *) echo "bootstrap.sh: unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Usage: bootstrap.sh existing-repo|new-project [--stack <preset>]" >&2
  exit 1
fi

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

echo "bootstrap.sh: mode=$MODE stack=$STACK profiles=${PROFILES[*]:-none}"

# --- Write .omo structure ---
mkdir -p .omo/drafts .omo/plans
touch .omo/drafts/.gitkeep .omo/plans/.gitkeep
echo "bootstrap.sh: created .omo/{drafts,plans}/"

# --- Write AGENTS.md context file ---
AGENTS_CONTENT="# Project Context (omp-devcontainer-base bootstrap)

## Stack
$STACK

## Active omp Profiles
$(for p in "${PROFILES[@]:-}"; do echo "- $p"; done)

## Skills Location
Project-level skills are in \`.omp/skills/\` (copied from ~/.omp/agent/profiles/ by bootstrap.sh).
User-level core skills are always active from ~/.omp/agent/skills/core/.

## Plan Workflow
- Use omp's plan mode (--plan flag) to create plans in \`.omo/plans/<slug>.md\`
- Approve the plan, then use the start-work skill to execute it
- See ~/.omp/agent/skills/core/plan-workflow/SKILL.md for the full workflow
"
write_if_absent "AGENTS.md" "$AGENTS_CONTENT"

# --- Write .omp/config.yml ---
OMP_CONFIG="# Project-level omp config
# Extends user-level ~/.omp/agent/config.yml
# Arrays REPLACE (not merge) — restate the full list if overriding extensions

stack: $STACK
"
write_if_absent ".omp/config.yml" "$OMP_CONFIG"

# --- Write .omp/mcp.json (project-level, stack-specific servers) ---
CORE_MCP_SERVERS='"git": {"command": "uvx", "args": ["mcp-server-git"]}, "fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}, "time": {"command": "uvx", "args": ["mcp-server-time"]}'
STACK_MCP_SERVERS=""
case "$STACK" in
  dotnet-aspire-svelte|dotnet-only)
    STACK_MCP_SERVERS=', "docker": {"command": "uvx", "args": ["mcp-server-docker"]}, "aspire": {"command": "aspire", "args": ["agent", "mcp"]}, "shadcn": {"command": "npx", "args": ["-y", "shadcn@latest", "mcp"]}, "puppeteer": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"]}' ;;
  svelte-only)
    STACK_MCP_SERVERS=', "shadcn": {"command": "npx", "args": ["-y", "shadcn@latest", "mcp"]}, "puppeteer": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"]}' ;;
  generic)
    STACK_MCP_SERVERS="" ;;
esac

MCP_JSON="{"mcpServers": {${CORE_MCP_SERVERS}${STACK_MCP_SERVERS}}}"
write_if_absent ".omp/mcp.json" "$(echo $MCP_JSON | jq . 2>/dev/null || echo $MCP_JSON)"

# --- Copy profile skills ---
OMP_PROFILES_SRC="${HOME}/.omp/agent/profiles"
for profile in "${PROFILES[@]:-}"; do
  if [[ -n "$profile" ]] && [[ -d "${OMP_PROFILES_SRC}/${profile}/skills" ]]; then
    mkdir -p ".omp/skills/${profile}"
    cp -r "${OMP_PROFILES_SRC}/${profile}/skills/." ".omp/skills/${profile}/"
    echo "bootstrap.sh: copied profile skills: $profile"
  elif [[ -n "$profile" ]]; then
    echo "bootstrap.sh: WARN — profile skills not found at ${OMP_PROFILES_SRC}/${profile}/skills (install omp first)"
    mkdir -p ".omp/skills/${profile}"
  fi
done

# --- Scaffold project structure (new-project mode only) ---
if [[ "$MODE" == "new-project" ]]; then
  echo "bootstrap.sh: scaffolding project structure for stack=$STACK..."
  case "$STACK" in
    dotnet-aspire-svelte)
      mkdir -p src/App.AppHost src/App.Web src/App.ServiceDefaults tests/App.Tests.Unit tests/App.Tests.E2E src/frontend docs
      touch src/App.AppHost/.gitkeep src/App.Web/.gitkeep src/App.ServiceDefaults/.gitkeep
      touch tests/App.Tests.Unit/.gitkeep tests/App.Tests.E2E/.gitkeep
      touch src/frontend/.gitkeep docs/.gitkeep
      ;;
    dotnet-only)
      mkdir -p src/App.AppHost src/App.Web src/App.ServiceDefaults tests/App.Tests.Unit docs
      touch src/App.AppHost/.gitkeep src/App.Web/.gitkeep src/App.ServiceDefaults/.gitkeep
      touch tests/App.Tests.Unit/.gitkeep docs/.gitkeep
      ;;
    svelte-only)
      mkdir -p src tests docs
      touch src/.gitkeep tests/.gitkeep docs/.gitkeep
      ;;
    generic)
      mkdir -p src tests docs
      touch src/.gitkeep tests/.gitkeep docs/.gitkeep
      ;;
  esac
  echo "bootstrap.sh: project structure scaffolded"
fi

echo "bootstrap.sh: done (mode=$MODE stack=$STACK)"
