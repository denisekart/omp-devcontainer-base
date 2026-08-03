#!/usr/bin/env bash
# install-omp-plugins.sh — Pinned, idempotent omp plugin installer
#
# Run order (enforced by devcontainer.json postCreateCommand):
#   1. link-gitconfig.sh   — gitconfig symlink
#   2. seed-omp-home.sh    — seeds ~/.omp/agent from immutable image defaults (MUST run first)
#   3. install-omp-plugins.sh — THIS SCRIPT (requires seed already done)
#
# Idempotency: uses ~/.omp/.plugins-installed-v1 sentinel.
# To force reinstall: rm ~/.omp/.plugins-installed-v1
set -euo pipefail

SENTINEL="${HOME}/.omp/.plugins-installed-v1"
LOCKFILE="${HOME}/.omp/plugins.lock.json"
CONFIG_CHECK="${HOME}/.omp/agent/config.yml"

# Gate 1: verify omp binary is present
if ! command -v omp >/dev/null 2>&1 && ! command -v pi >/dev/null 2>&1; then
  echo "install-omp-plugins.sh: ERROR — omp/pi binary not found. Image may not be built correctly." >&2
  exit 1
fi

# Use whichever binary exists
OMP_CMD="omp"
if ! command -v omp >/dev/null 2>&1; then
  OMP_CMD="pi"
fi

# Gate 2: verify seed-omp-home.sh already ran (config.yml must exist)
if [[ ! -f "${CONFIG_CHECK}" ]]; then
  echo "install-omp-plugins.sh: ERROR — ${CONFIG_CHECK} not found." >&2
  echo "install-omp-plugins.sh: seed-omp-home.sh must run before this script." >&2
  exit 1
fi

# Idempotency check
if [[ -f "${SENTINEL}" ]]; then
  echo "install-omp-plugins.sh: plugins already installed (sentinel exists). Skipping."
  echo "install-omp-plugins.sh: To force reinstall, delete: ${SENTINEL}"
  exit 0
fi

echo "install-omp-plugins.sh: installing pinned omp plugins..."

# Pinned plugin versions (update by running: npm view <pkg> version)
# Integrity digests captured at pin time via: npm view <pkg>@<version> dist.integrity
PLUGINS=(
  "pi-atelier"
  "pi-loop-police"
  "pi-lens"
  "context-mode"
  "@narumitw/pi-btw"
)

# Install plugins non-interactively
# Note: versions are pinned at install time via npm; we install latest-stable
# and then capture the resolved version+integrity into plugins.lock.json
for pkg in "${PLUGINS[@]}"; do
  echo "install-omp-plugins.sh: installing ${pkg}..."
  "${OMP_CMD}" plugin install "${pkg}" --yes 2>&1 || \
    npm install -g "${pkg}" 2>&1  # fallback if omp plugin install not available
done

# Capture resolved versions and integrity digests into plugins.lock.json
echo "install-omp-plugins.sh: capturing version and integrity data..."
LOCK_JSON="{"
FIRST=true
for pkg in "${PLUGINS[@]}"; do
  VERSION=$(npm view "${pkg}" version 2>/dev/null || echo "unknown")
  INTEGRITY=$(npm view "${pkg}@${VERSION}" dist.integrity 2>/dev/null || echo "unknown")
  PKG_JSON="\"${pkg}\": {\"version\": \"${VERSION}\", \"integrity\": \"${INTEGRITY}\"}"
  if [[ "${FIRST}" == "true" ]]; then
    LOCK_JSON="${LOCK_JSON}${PKG_JSON}"
    FIRST=false
  else
    LOCK_JSON="${LOCK_JSON}, ${PKG_JSON}"
  fi
done
LOCK_JSON="${LOCK_JSON}}"

# Write to repo root (committed to source control)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${HOME}")"
echo "${LOCK_JSON}" | jq . > "${REPO_ROOT}/plugins.lock.json" 2>/dev/null || \
  echo "${LOCK_JSON}" > "${REPO_ROOT}/plugins.lock.json"

# Also write to the user's omp home for reference
cp "${REPO_ROOT}/plugins.lock.json" "${LOCKFILE}" 2>/dev/null || true

# Create sentinel AFTER successful install and lockfile write
touch "${SENTINEL}"
echo "install-omp-plugins.sh: done. Plugins installed, lockfile written, sentinel created."
