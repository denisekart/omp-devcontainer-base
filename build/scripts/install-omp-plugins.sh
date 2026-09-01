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
# WHY ROOT: omp plugins are global bun packages installed into the image's
# global bun prefix (BUN_INSTALL=/usr/local, root-owned — see Dockerfile).
# The vscode user cannot write there ("bun is unable to write files to
# tempdir: EACCES"), so installs run via sudo (passwordless for vscode).
# HOME and BUN_INSTALL are passed through explicitly (sudo resets the
# environment) so per-user state stays under /home/vscode and bun keeps
# using the /usr/local prefix; affected user trees are chowned back at the end.
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
  "pi-loop-police"
  "pi-lens"
  "context-mode"
)

# Detect whether the CLI supports the plugin subcommand. If it doesn't (e.g.
# an old binary), degrade to a global npm install — which also needs root
# (NodeSource Node prefix is /usr).
USE_NPM_FALLBACK=0
if ! "${OMP_CMD}" plugin --help >/dev/null 2>&1; then
  echo "install-omp-plugins.sh: WARNING — '${OMP_CMD} plugin' not supported, using npm global install fallback"
  USE_NPM_FALLBACK=1
fi

# Ensure legacy compatibility shims have required exports for plugin validation
ensure_shims() {
  sudo node -e '
const fs = require("fs");
const path = require("path");
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  let files = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files = files.concat(walk(full));
      else files.push(full);
    }
  } catch (e) {}
  return files;
}
for (const dir of ["/usr/local", "/home/vscode/.bun", "/home/vscode/.omp"]) {
  for (const file of walk(dir)) {
    if (file.includes("legacy-pi-tui-shim")) {
      let content = fs.readFileSync(file, "utf8");
      if (!content.includes("stripTerminalSequences")) {
        content += "\nexport function stripTerminalSequences(text) { return (text || \"\").replace(/\\x1B(?:\\[[0-?]*[ -/]*[@-~]|[@-Z\\\\-_])/g, \"\"); }\n";
        fs.writeFileSync(file, content);
      }
    }
    if (file.includes("legacy-pi-ai-shim")) {
      let content = fs.readFileSync(file, "utf8");
      if (!content.includes("getSupportedThinkingLevels")) {
        content += "\nexport function getSupportedThinkingLevels(model) { if (model && model.thinkingLevels && Array.isArray(model.thinkingLevels)) return model.thinkingLevels; if (model && model.thinkingLevelMap && typeof model.thinkingLevelMap === \"object\") return Object.keys(model.thinkingLevelMap); return [\"off\", \"low\", \"medium\", \"high\", \"xhigh\"]; }\nexport function clampThinkingLevel(model, level) { const s = getSupportedThinkingLevels(model); return s.includes(level) ? level : (s[0] || \"off\"); }\n";
        fs.writeFileSync(file, content);
      }
    }
  }
}
' 2>/dev/null || true
}

ensure_shims

# Run as root while keeping the user's HOME and bun prefix (sudo resets both).
run_as_root_with_user_home() {
  sudo HOME="${HOME}" BUN_INSTALL="${BUN_INSTALL:-/usr/local}" "$@"
}

install_one() {
  local pkg="$1"
  if [[ "${USE_NPM_FALLBACK}" -eq 1 ]]; then
    sudo npm install -g "${pkg}"
  else
    # Verify flags with: omp plugin install --help
    run_as_root_with_user_home "${OMP_CMD}" plugin install "${pkg}"
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

# Return ownership of any user-home trees the root install touched
# (omp state, bun/npm caches).
sudo chown -R vscode:vscode "${HOME}/.omp" "${HOME}/.bun" "${HOME}/.cache" 2>/dev/null || true

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

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "install-omp-plugins.sh: WARNING — partial plugin install failure for: ${FAILED[*]}" >&2
  echo "install-omp-plugins.sh: continuing devcontainer initialization..."
else
  # Sentinel only after a fully successful install + lockfile write
  touch "${SENTINEL}"
  echo "install-omp-plugins.sh: done. All plugins installed, lockfile written to ${LOCKFILE}, sentinel created."
fi