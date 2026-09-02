#!/usr/bin/env bash
# link-gitconfig.sh — Establish persistent .gitconfig via volume-backed directory
# The omp-devcontainer-base-persisted-git volume mounts at ~/.persisted-git/
# Docker volumes can't target a single file, so we store gitconfig in a dir and symlink.
set -euo pipefail

PERSISTED_DIR="${HOME}/.persisted-git"
GITCONFIG_FILE="${PERSISTED_DIR}/gitconfig"
GITCONFIG_LINK="${HOME}/.gitconfig"

mkdir -p "${PERSISTED_DIR}"

# Seed an empty gitconfig if none exists yet
if [[ ! -f "${GITCONFIG_FILE}" ]]; then
  touch "${GITCONFIG_FILE}"
  echo "link-gitconfig.sh: created empty ${GITCONFIG_FILE}"
fi

# Seed safe.directory=* (idempotent). Devcontainer workspaces arrive root-owned
# (WSL2 9p/drvfs forces uid=0), which trips git's dubious-ownership check; the
# workspace path is unknown at build time, so the wildcard is the robust
# single-user-devcontainer fix.
if ! git config -f "${GITCONFIG_FILE}" --get-all safe.directory 2>/dev/null | grep -qx '\*'; then
  git config -f "${GITCONFIG_FILE}" --add safe.directory '*'
  echo "link-gitconfig.sh: set safe.directory=* (devcontainer workspaces are root-owned via 9p/drvfs uid=0)"
fi

# Create symlink (idempotent — skip if already correct symlink)
if [[ -L "${GITCONFIG_LINK}" && "$(readlink "${GITCONFIG_LINK}")" == "${GITCONFIG_FILE}" ]]; then
  echo "link-gitconfig.sh: symlink already correct, skipping"
else
  rm -f "${GITCONFIG_LINK}"
  ln -s "${GITCONFIG_FILE}" "${GITCONFIG_LINK}"
  echo "link-gitconfig.sh: linked ${GITCONFIG_LINK} -> ${GITCONFIG_FILE}"
fi
