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

# Create symlink (idempotent — skip if already correct symlink)
if [[ -L "${GITCONFIG_LINK}" && "$(readlink "${GITCONFIG_LINK}")" == "${GITCONFIG_FILE}" ]]; then
  echo "link-gitconfig.sh: symlink already correct, skipping"
else
  rm -f "${GITCONFIG_LINK}"
  ln -s "${GITCONFIG_FILE}" "${GITCONFIG_LINK}"
  echo "link-gitconfig.sh: linked ${GITCONFIG_LINK} -> ${GITCONFIG_FILE}"
fi
