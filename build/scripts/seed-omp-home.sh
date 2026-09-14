#!/usr/bin/env bash
# seed-omp-home.sh — First-boot seeding of omp config from immutable image defaults
#
# User layer receives: agents/, skills/, extensions/, mcp.json, config.yml,
# and the baked ONNX tiny-model cache (agent/cache) for the on-device local
# model (lfm2-1.2b). models.yml is intentionally excluded — model definitions
# are workspace-owned: seed maintains ~/.omp/agent/models.yml as a POINTER
# (symlink) to the current workspace's .omp/models.yml, so the user layer
# never stores model bytes (bootstrap.sh seeds .omp/models.yml per repo).
# Source: /usr/local/share/omp-defaults/agent (baked into the image, immutable)
# Target: ~/.omp/agent (persistent volume — user state, sacred)
#
# Contract:
#   - NEVER overwrites existing files in the target. User edits always win.
#     Single value-matched exception: model-selector keys that still hold the
#     exact retired fleet template values are stripped from an EXISTING
#     ~/.omp/agent/config.yml — state this image wrongly created (see the
#     user-layer config migration below). Customised values are never touched.
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
# covers file names and contents, INCLUDING ./cache so an image rebuild that
# changes the baked local model re-copies missing files into existing volumes
# (the merge is copy-if-absent; this only changes what is hashed).
# xargs -r prevents a hang if the tree were ever empty.
compute_source_hash() {
  ( cd "${DEFAULTS_SRC}" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum ) \
    | sha256sum | awk '{print $1}'
}

SOURCE_HASH="$(compute_source_hash)"
STORED_HASH=""
if [[ -f "${SENTINEL}" ]]; then
  STORED_HASH="$(cat "${SENTINEL}" 2>/dev/null || true)"
fi

# --- Knowledge base (pi-knowledge): model cache + env file ---
# The extension's model cache is <knowledge-dir>/models
# (~/.omp/knowledge/models, volume-backed). Copy the ONNX models baked into
# the image, preserving relative paths and never clobbering existing files
# (idempotent; a user-modified cache file always wins).
# Runs before the fast path on every boot so that resetting the store
# (rm -rf ~/.omp/knowledge) re-seeds models + env on the next container
# creation even when the agent defaults are unchanged.
KMODELS_SRC="${OMP_KNOWLEDGE_MODELS_SRC:-/usr/local/share/omp-defaults/knowledge-models}"
if [[ -d "${KMODELS_SRC}" ]]; then
  mkdir -p "${HOME}/.omp/knowledge/models"
  while IFS= read -r -d '' f; do
    rel="${f#./}"
    dest="${HOME}/.omp/knowledge/models/${rel}"
    if [[ ! -e "${dest}" ]]; then
      mkdir -p "$(dirname "${dest}")"
      cp -p "${KMODELS_SRC}/${rel}" "${dest}"
      echo "seed-omp-home.sh: added knowledge model ${rel}"
    fi
  done < <(cd "${KMODELS_SRC}" && find . -type f -print0 | sort -z)
fi
# Seed the knowledge env file (persistent, user-editable); never overwrite.
KENV_SRC="/usr/local/share/omp-defaults/knowledge.env"
if [[ ! -f "${HOME}/.omp/knowledge.env" && -f "${KENV_SRC}" ]]; then
  cp -p "${KENV_SRC}" "${HOME}/.omp/knowledge.env"
  echo "seed-omp-home.sh: added ~/.omp/knowledge.env from image defaults"
fi

# --- Workspace models.yml pointer (runs on EVERY boot) ---
# omp reads model definitions ONLY from ~/.omp/agent/models.yml, so that path
# is maintained as a symlink to the CURRENT workspace's .omp/models.yml: the
# workspace keeps sole ownership (git-tracked, tailored, single source of
# truth). The ~/.omp volume is shared across workspaces, so the link is
# retargeted whenever another workspace's container starts.
link_workspace_models() {
  local ws_root ws_models agent_models
  ws_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  ws_models="${ws_root}/.omp/models.yml"
  agent_models="${OMP_AGENT_DIR}/models.yml"
  if [[ ! -f "${ws_models}" ]]; then
    return 0
  fi
  if [[ ! -e "${agent_models}" && ! -L "${agent_models}" ]]; then
    mkdir -p "${OMP_AGENT_DIR}"
    ln -s "${ws_models}" "${agent_models}"
    echo "seed-omp-home.sh: linked ~/.omp/agent/models.yml -> ${ws_models}"
  elif [[ -L "${agent_models}" && "$(readlink -f "${agent_models}")" != "$(readlink -f "${ws_models}")" ]]; then
    ln -sfn "${ws_models}" "${agent_models}"
    echo "seed-omp-home.sh: retargeted ~/.omp/agent/models.yml -> ${ws_models} (workspace switch on shared ~/.omp volume)"
  elif [[ -f "${agent_models}" && ! -L "${agent_models}" ]]; then
    echo "seed-omp-home.sh: NOTE — real ~/.omp/agent/models.yml exists; workspace .omp/models.yml will NOT be read (remove it to switch to workspace-owned models)"
  fi
}

# --- User-layer config migration (runs on EVERY boot, before the fast path) ---
# Earlier images wrongly seeded ~/.omp/agent/config.yml WITH the workspace-only
# model-selector keys (defaultProvider/defaultModel/defaultSmallModel/
# modelRoles/retry.fallbackChains) pointing at fleet models. In the user layer
# those stale selectors make omp warn at startup ("retry.fallbackChains key
# references unknown model …") — model selectors now live ONLY in the
# workspace .omp/config.yml. Strip them — but ONLY while a key still holds the
# exact retired template value: comparisons are semantic and order-independent
# (canonical sorted key=value strings), user-customised values are NEVER
# touched and only get a warning naming the key.
CFG="${HOME}/.omp/agent/config.yml"
if [[ -f "${CFG}" ]] && command -v yq >/dev/null 2>&1; then
  strip=()
  if yq -e '.defaultProvider == "litellm"' "${CFG}" >/dev/null 2>&1; then
    strip+=('.defaultProvider')
  fi
  if yq -e '.defaultModel == "litellm/qwen3.8-27b"' "${CFG}" >/dev/null 2>&1; then
    strip+=('.defaultModel')
  fi
  if yq -e '.defaultSmallModel == "litellm/qwen3-coder-4b"' "${CFG}" >/dev/null 2>&1; then
    strip+=('.defaultSmallModel')
  fi
  if yq -e '[.modelRoles | to_entries[] | .key + "=" + (.value | tostring)] | sort | join(";") == "advisor=litellm/qwen3.6-35b;default=litellm/qwen3.8-27b;memory=litellm/qwen3-coder-4b;plan=litellm/qwen3.8-27b;slow=litellm/qwen3.8-27b;smol=litellm/qwen3-coder-4b;task=litellm/qwen3.6-35b;tiny=litellm/qwen3-coder-4b"' "${CFG}" >/dev/null 2>&1; then
    strip+=('.modelRoles')
  fi
  if yq -e '[.retry.fallbackChains | to_entries[] | .key + "=" + (.value | join(","))] | sort | join(";") == "litellm/qwen3-coder-4b=;litellm/qwen3.6-35b=litellm/qwen3-coder-4b;litellm/qwen3.8-27b=litellm/qwen3.6-35b,litellm/qwen3-coder-4b"' "${CFG}" >/dev/null 2>&1; then
    strip+=('.retry.fallbackChains')
  fi
  if ((${#strip[@]} > 0)); then
    del_expr="${strip[0]}"
    for key in "${strip[@]:1}"; do del_expr+=",${key}"; done
    yq -i "del(${del_expr})" "${CFG}"
    echo "seed-omp-home.sh: stripped retired model-selector keys from ~/.omp/agent/config.yml (${del_expr})"
    # Don't leave an empty `retry:` parent behind after dropping fallbackChains.
    for key in "${strip[@]}"; do
      if [[ "${key}" == ".retry.fallbackChains" ]] &&
         [[ "$(yq 'select(has("retry")) | .retry | length' "${CFG}" 2>/dev/null)" == "0" ]]; then
        yq -i 'del(.retry)' "${CFG}"
      fi
    done
  fi
  # Survivors: fleet references the user customised (or that the template
  # comparison did not match) — never auto-stripped; name them for manual
  # tailoring in the workspace .omp/config.yml instead.
  for key in '.defaultModel' '.defaultSmallModel' '.modelRoles' '.retry.fallbackChains'; do
    if yq -e "(${key} // \"\") | tostring | test(\"litellm/qwen3[.]\")" "${CFG}" >/dev/null 2>&1; then
      echo "seed-omp-home.sh: WARNING — ~/.omp/agent/config.yml still sets ${key} to a fleet litellm/qwen3.* model; model selectors belong in the workspace .omp/config.yml (left untouched)" >&2
    fi
  done
fi

# Fast path: already seeded AND source unchanged. Still verify the target is
# intact — a sentinel without the local-model cache (the one model artifact
# that belongs in the user layer; deleted/corrupted volume) must re-merge,
# not skip.
if [[ -n "${STORED_HASH}" && "${STORED_HASH}" == "${SOURCE_HASH}" ]]; then
  if [[ -d "${OMP_AGENT_DIR}/cache/tiny-models" ]]; then
    link_workspace_models
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
  # models.yml is workspace-owned (see header): bootstrap seeds .omp/models.yml;
  # the user layer must not receive model definitions from the image.
  if [[ "${rel}" == "models.yml" ]]; then
    continue
  fi
  if [[ ! -e "${OMP_AGENT_DIR}/${rel}" ]]; then
    mkdir -p "$(dirname "${OMP_AGENT_DIR}/${rel}")"
    cp -p "${DEFAULTS_SRC}/${rel}" "${OMP_AGENT_DIR}/${rel}"
    added=$((added + 1))
    echo "seed-omp-home.sh: added ${rel}"
  fi
done < <(cd "${DEFAULTS_SRC}" && find . -type f -print0 | sort -z)

link_workspace_models

# Record the source hash only after a successful merge
printf '%s\n' "${SOURCE_HASH}" > "${SENTINEL}"

if [[ -z "${STORED_HASH}" ]]; then
  echo "seed-omp-home.sh: first-boot seed complete — ${added} file(s) added, sentinel written at ${SENTINEL}"
else
  echo "seed-omp-home.sh: re-merge complete — ${added} new file(s) added, existing files untouched, sentinel updated"
fi