#!/usr/bin/env bash
# seed-omp-home.sh — First-boot seeding of omp config from immutable image defaults
#
# Source: /usr/local/share/omp-defaults/agent (baked into the image, immutable)
# Target: ~/.omp/agent (persistent volume — user state, sacred)
#
# Contract:
#   - NEVER overwrites existing files in the target. User edits always win.
#   - First boot: copies all defaults.
#   - Image update with changed defaults: auto re-merges — new default files are
#     added, existing files are left alone. Detected by comparing a content hash
#     of the source tree, stored inside the sentinel file.
#   - Sentinel: ~/.omp/.seeded-v1 (contains the source hash, not just a marker).
#
# Manual operations:
#   - Pick up new default files while keeping edits: happens automatically.
#   - Sentinel deleted / lost: just re-run this script (safe re-merge, no clobber).
#   - Full reset INCLUDING user edits (DANGEROUS — wipes ~/.omp/agent):
#       rm -rf ~/.omp/agent ~/.omp/.seeded-v1
#
# Note: symlinks inside the defaults tree are not handled (avoid them — keep the
# tree self-contained). Regular files and directories only.
set -euo pipefail

DEFAULTS_SRC="${OMP_DEFAULTS_SRC:-/usr/local/share/omp-defaults/agent}"
OMP_AGENT_DIR="${HOME}/.omp/agent"
SENTINEL="${HOME}/.omp/.seeded-v1"

# --- Validate the immutable source ---
if [[ ! -d "${DEFAULTS_SRC}" ]]; then
  echo "seed-omp-home.sh: ERROR — defaults source not found at ${DEFAULTS_SRC}" >&2
  echo "seed-omp-home.sh: The image may not have been built correctly. Cannot seed." >&2
  exit 1
fi
if [[ ! -f "${DEFAULTS_SRC}/config.yml" ]]; then
  echo "seed-omp-home.sh: ERROR — ${DEFAULTS_SRC}/config.yml missing from image defaults" >&2
  exit 1
fi

# Content hash of the defaults tree: relative paths (location-independent),
# covers file names and contents (excluding ./cache to avoid hashing binary models on every boot).
# xargs -r prevents a hang if the tree were ever empty.
compute_source_hash() {
  ( cd "${DEFAULTS_SRC}" && find . -path './cache' -prune -o -type f -print0 | sort -z | xargs -0 -r sha256sum ) \
    | sha256sum | awk '{print $1}'
}

SOURCE_HASH="$(compute_source_hash)"
STORED_HASH=""
if [[ -f "${SENTINEL}" ]]; then
  STORED_HASH="$(cat "${SENTINEL}" 2>/dev/null || true)"
fi

# Fast path: already seeded AND source unchanged. Still verify the target is
# intact — a sentinel without a target (deleted/corrupted) must re-merge, not skip.
if [[ -n "${STORED_HASH}" && "${STORED_HASH}" == "${SOURCE_HASH}" ]]; then
  if [[ -f "${OMP_AGENT_DIR}/config.yml" ]]; then
    echo "seed-omp-home.sh: volume already seeded, defaults unchanged (hash ${STORED_HASH:0:12}…), skipping"
    exit 0
  fi
  echo "seed-omp-home.sh: WARNING — sentinel present but target incomplete; re-merging defaults"
fi

# --- Merge: create missing dirs/files, never overwrite existing ---
mkdir -p "${OMP_AGENT_DIR}"

added=0

# Directories first (preserves empty scaffolding dirs from the defaults)
while IFS= read -r -d '' d; do
  rel="${d#./}"
  mkdir -p "${OMP_AGENT_DIR}/${rel}"
done < <(cd "${DEFAULTS_SRC}" && find . -mindepth 1 -type d -print0 | sort -z)

# Then files, with explicit per-file skip semantics
while IFS= read -r -d '' f; do
  rel="${f#./}"
  if [[ ! -e "${OMP_AGENT_DIR}/${rel}" ]]; then
    mkdir -p "$(dirname "${OMP_AGENT_DIR}/${rel}")"
    cp -p "${DEFAULTS_SRC}/${rel}" "${OMP_AGENT_DIR}/${rel}"
    added=$((added + 1))
    echo "seed-omp-home.sh: added ${rel}"
  fi
done < <(cd "${DEFAULTS_SRC}" && find . -type f -print0 | sort -z)

# Record the source hash only after a successful merge
printf '%s\n' "${SOURCE_HASH}" > "${SENTINEL}"

if [[ -z "${STORED_HASH}" ]]; then
  echo "seed-omp-home.sh: first-boot seed complete — ${added} file(s) added, sentinel written at ${SENTINEL}"
else
  echo "seed-omp-home.sh: re-merge complete — ${added} new file(s) added, existing files untouched, sentinel updated"
fi