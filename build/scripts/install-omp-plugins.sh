#!/usr/bin/env bash
# install-omp-plugins.sh — Pinned, idempotent omp plugin installer
#
# Run order (enforced by devcontainer.json postCreateCommand):
#   1. link-gitconfig.sh       — gitconfig symlink
#   2. seed-omp-home.sh        — seeds ~/.omp/agent from immutable image defaults (MUST run first)
#   3. install-omp-plugins.sh  — THIS SCRIPT (requires seed already done)
#
# Idempotency: uses ~/.omp/.plugins-installed-v1 sentinel.
# To force reinstall: rm ~/.omp/.plugins-installed-v1
#
# The lockfile is written ONLY to ~/.omp/plugins.lock.json (persisted .omp
# volume). This script never writes into the workspace: the base image is
# shared across repositories and must not touch the consumer repo.
set -euo pipefail

SENTINEL="${HOME}/.omp/.plugins-installed-v1"
LOCKFILE="${HOME}/.omp/plugins.lock.json"
CONFIG_CHECK="${HOME}/.omp/agent/config.yml"

# Gate 1: verify a CLI binary is present
if ! command -v omp >/dev/null 2>&1 && ! command -v pi >/dev/null 2>&1; then
  echo "install-omp-plugins.sh: ERROR — omp/pi binary not found. Image may not be built correctly." >&2
  exit 1
fi

# Use whichever binary exists (image ships /usr/local/bin/pi as a symlink to omp)
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

# Pinned plugin names. Resolved versions + integrity digests are captured
# into the lockfile at install time.
PLUGINS=(
  "pi-atelier"
  "pi-loop-police"
  "pi-lens"
  "context-mode"
  "@narumitw/pi-btw"
)

# Detect whether the CLI supports the plugin subcommand. If it doesn't (e.g.
# an old binary), degrade to a global npm install — which needs root because
# the NodeSource Node prefix is /usr.
USE_NPM_FALLBACK=0
if ! "${OMP_CMD}" plugin --help >/dev/null 2>&1; then
  echo "install-omp-plugins.sh: WARNING — '${OMP_CMD} plugin' not supported, using npm global install fallback"
  USE_NPM_FALLBACK=1
fi

install_one() {
  local pkg="$1"
  if [[ "${USE_NPM_FALLBACK}" -eq 1 ]]; then
    sudo npm install -g "${pkg}"
  else
    # Verify flags with: omp plugin install --help
    "${OMP_CMD}" plugin install "${pkg}"
  fi
}

# Install all plugins; collect failures instead of silently degrading
FAILED=()
for pkg in "${PLUGINS[@]}"; do
  echo "install-omp-plugins.sh: installing ${pkg}..."
  if ! install_one "${pkg}" 2>&1; then
    echo "install-omp-plugins.sh: ERROR — install failed for ${pkg}" >&2
    FAILED+=("${pkg}")
  fi
done

# Fail loudly: no sentinel, no lockfile. Re-running the script (next
# devcontainer up, or manually) retries all plugins; already-installed
# ones are no-ops.
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "install-omp-plugins.sh: FAILED for: ${FAILED[*]}" >&2
  echo "install-omp-plugins.sh: no sentinel written — next run will retry." >&2
  exit 1
fi

# Capture resolved versions and integrity digests into plugins.lock.json
echo "install-omp-plugins.sh: capturing version and integrity data..."
LOCK_JSON='{}'
for pkg in "${PLUGINS[@]}"; do
  VERSION="$(npm view "${pkg}" version 2>/dev/null || echo unknown)"
  INTEGRITY="$(npm view "${pkg}@${VERSION}" dist.integrity 2>/dev/null || echo unknown)"
  LOCK_JSON="$(jq -c --arg p "${pkg}" --arg v "${VERSION}" --arg i "${INTEGRITY}" \
    '. + {($p): {version: $v, integrity: $i}}' <<<"${LOCK_JSON}")"
done

# Write only to the persisted omp home (volume-backed), never the workspace
jq . <<<"${LOCK_JSON}" > "${LOCKFILE}"
chmod 644 "${LOCKFILE}"

# Sentinel only after a fully successful install + lockfile write
touch "${SENTINEL}"
echo "install-omp-plugins.sh: done. Plugins installed, lockfile written to ${LOCKFILE}, sentinel created."