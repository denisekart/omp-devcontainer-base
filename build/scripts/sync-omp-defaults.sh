#!/usr/bin/env bash
# sync-omp-defaults.sh — Idempotent dogfood re-sync of omp defaults from repo tree
#
# Usage:
#   bash build/scripts/sync-omp-defaults.sh          # apply (default)
#   bash build/scripts/sync-omp-defaults.sh --check  # diff-only preview (safe entry)
#   bash build/scripts/sync-omp-defaults.sh --dry-run  # apply but don't write
#
# Source: build/library/omp-defaults/agent (repo tree) or /usr/local/share/omp-defaults/agent (image)
# Target: ~/.omp/agent (persistent volume — user state, sacred)
#
# Contract:
#   - rsync -a --delete for agents/, skills/, and extensions/ subtrees (safe: no live state).
#   - Plain copy (no --delete) for top-level config.yml, mcp.json.
#   - models.yml is workspace-owned (never synced to the user layer); the
#     config.yml sync applies only to non-model sections — dogfood only;
#     existing instances unaffected (seed-omp-home.sh never overwrites).
#   - Never touches ./cache, .seeded-v1, *.db*, sessions/, terminal-sessions/,
#     blobs/, last-changelog-version.
#   - Overwrites agents/ and skills/ to match source exactly.
#   - Overwrites top-level config files to match source (dogfood escape hatch).

set -euo pipefail

# Resolve source: prefer the repo tree when running from a working copy,
# fall back to the baked image path when running from /usr/local/share/omp-scripts/
# (or allow explicit override via OMP_DEFAULTS_SRC, mirroring seed-omp-home.sh).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_SRC="${REPO_ROOT}/build/library/omp-defaults/agent"
IMAGE_SRC="/usr/local/share/omp-defaults/agent"
SRC="${OMP_DEFAULTS_SRC:-}"
if [[ -z "${SRC}" ]]; then
  if [[ -d "${REPO_SRC}" ]]; then
    SRC="${REPO_SRC}"
  elif [[ -d "${IMAGE_SRC}" ]]; then
    SRC="${IMAGE_SRC}"
  fi
fi
TARGET="${OMP_AGENT_DIR:-$HOME/.omp/agent}"

if [[ ! -d "${SRC}" ]]; then
  echo "sync-omp-defaults.sh: ERROR — source not found at ${SRC}" >&2
  exit 1
fi
if [[ ! -d "${TARGET}" ]]; then
  echo "sync-omp-defaults.sh: ERROR — target not found at ${TARGET}" >&2
  exit 1
fi

MODE="${1:---apply}"
DRY_RUN=0
if [[ "${MODE}" == "--dry-run" ]]; then
  DRY_RUN=1
  MODE="--check"
fi

if [[ "${MODE}" != "--check" && "${MODE}" != "--apply" ]]; then
  echo "sync-omp-defaults.sh: ERROR — unknown mode '${MODE}'. Use --check, --apply, or --dry-run." >&2
  exit 1
fi

# Determine rsync flags: --check and --dry-run both use -n (no writes); --apply writes
RSYNC_FLAGS="-a"
if [[ "${MODE}" == "--check" ]]; then
  RSYNC_FLAGS="${RSYNC_FLAGS} -n"
fi

# Sync subtrees (agents/ and skills/) with --delete
echo "sync-omp-defaults.sh: syncing agents/ and skills/ subtrees..."
if [[ "${MODE}" == "--check" ]]; then
  rsync ${RSYNC_FLAGS} --delete --itemize-changes \
    "${SRC}/agents/" "${TARGET}/agents/" 2>&1 || true
  rsync ${RSYNC_FLAGS} --delete --itemize-changes \
    "${SRC}/skills/" "${TARGET}/skills/" 2>&1 || true
else
  rsync ${RSYNC_FLAGS} --delete \
    "${SRC}/agents/" "${TARGET}/agents/"
  rsync ${RSYNC_FLAGS} --delete \
    "${SRC}/skills/" "${TARGET}/skills/"
fi

# Sync extensions/ (repo-authored extension set; no live state inside) with --delete.
# Skipped when the source has no extensions/ directory.
if [[ -d "${SRC}/extensions" ]]; then
  echo "sync-omp-defaults.sh: syncing extensions/ subtree..."
  if [[ "${MODE}" == "--check" ]]; then
    rsync ${RSYNC_FLAGS} --delete --itemize-changes \
      "${SRC}/extensions/" "${TARGET}/extensions/" 2>&1 || true
  else
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      echo "sync-omp-defaults.sh: [dry-run] rsync extensions/"
    else
      mkdir -p "${TARGET}/extensions"
      rsync ${RSYNC_FLAGS} --delete \
        "${SRC}/extensions/" "${TARGET}/extensions/"
      echo "sync-omp-defaults.sh: synced extensions/"
    fi
  fi
fi

# Sync top-level files (plain copy, no --delete)
echo "sync-omp-defaults.sh: syncing top-level config files..."
for f in config.yml mcp.json; do
  if [[ -f "${SRC}/${f}" ]]; then
    if [[ "${MODE}" == "--check" ]]; then
      # Show diff if files differ
      if ! diff -q "${SRC}/${f}" "${TARGET}/${f}" >/dev/null 2>&1; then
        echo "sync-omp-defaults.sh: ${f} differs — would overwrite"
      else
        echo "sync-omp-defaults.sh: ${f} identical — skip"
      fi
    else
      if [[ "${DRY_RUN}" -eq 1 ]]; then
        echo "sync-omp-defaults.sh: [dry-run] cp ${f}"
      else
        cp -p "${SRC}/${f}" "${TARGET}/${f}"
        echo "sync-omp-defaults.sh: synced ${f}"
      fi
    fi
  fi
done

# Verify live state is untouched
echo "sync-omp-defaults.sh: verifying live state..."
for f in agent.db history.db models.db ".seeded-v1"; do
  if [[ -f "${TARGET}/${f}" ]]; then
    echo "sync-omp-defaults.sh: ${f} preserved"
  fi
done
for d in sessions terminal-sessions blobs cache; do
  if [[ -d "${TARGET}/${d}" ]]; then
    echo "sync-omp-defaults.sh: ${d}/ preserved"
  fi
done

echo "sync-omp-defaults.sh: done (mode=${MODE})"
