#!/usr/bin/env bash
# install-omp-plugins.sh — Unpinned, idempotent omp plugin installer/upgrader
#
# Run order (enforced by devcontainer.json postCreateCommand):
#   1. link-gitconfig.sh       — gitconfig symlink
#   2. seed-omp-home.sh        — seeds ~/.omp/agent from immutable image defaults (MUST run first)
#   3. install-omp-plugins.sh  — THIS SCRIPT (requires seed already done)
#
# Idempotency: uses ~/.omp/.plugins-installed-v1 sentinel, which records the
# omp version that installed the current plugins (a version change re-runs the install).
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

# Detect whether the CLI supports the plugin subcommand. If it doesn't (e.g.
# an old binary), degrade to global npm installs — which also needs root
# (NodeSource Node prefix is /usr). Set before any upgrade_plugins call.
USE_NPM_FALLBACK=0
if ! "${OMP_CMD}" plugin --help >/dev/null 2>&1; then
  echo "install-omp-plugins.sh: WARNING — '${OMP_CMD} plugin' not supported, using npm global install fallback"
  USE_NPM_FALLBACK=1
fi

# Rebuild reconciliation: capture the omp version now (OMP_CMD resolved above);
# the sentinel written at the end records "<omp version>|<plugin-set sha256>", so
# a rebuilt image (new omp or changed PLUGINS) triggers a plugin reinstall.
CURRENT_OMP_VER="$("${OMP_CMD}" --version 2>/dev/null | head -1 || echo unknown)"

# Gate 2: verify seed-omp-home.sh already ran (config.yml must exist)
if [[ ! -f "${CONFIG_CHECK}" ]]; then
  echo "install-omp-plugins.sh: ERROR — ${CONFIG_CHECK} not found." >&2
  echo "install-omp-plugins.sh: seed-omp-home.sh must run before this script." >&2
  exit 1
fi

# Plugin names (unpinned). Resolved versions + integrity digests are captured
# into the lockfile at install time.
#
# WHY UNPINNED: freshness comes from the bare-name reinstall refresh in
# upgrade_plugins below, run on EVERY container-create, matching the unpinned
# `dotnet tool install -g csharp-ls` convention in the Dockerfile — latest
# plugin releases land without an image rebuild. A pin would freeze the
# version until someone remembers to bump + rebuild.
# pi-knowledge provides the local-first RAG knowledge base (knowledge_* tools);
# its local embedder needs Node 22+ (PI_KNOWLEDGE_NODE_PATH, seeded by
# seed-omp-home.sh) and pre-seeded ONNX models under ~/.omp/knowledge/models.
PLUGINS=(
  "pi-loop-police"
  "pi-lens"
  "context-mode"
  "pi-simplify"
  "pi-knowledge"
)

# Capture resolved versions + integrity digests of the installed set into
# plugins.lock.json (written only to the persisted omp home, never the
# workspace). Called from BOTH the fast and slow paths so the lockfile — and
# with it the harness_report fingerprint — reflects post-upgrade versions.
capture_lock() {
  echo "install-omp-plugins.sh: capturing version and integrity data..."
  local lock='{}' pkg bare pjson version integrity
  for pkg in "${PLUGINS[@]}"; do
    bare="${pkg%@*}"
    pjson="${HOME}/.omp/plugins/node_modules/${bare}/package.json"
    version="$(node -p "require('${pjson}').version" 2>/dev/null || echo unknown)"
    integrity="$(sha256sum "${pjson}" 2>/dev/null | awk '{print $1}' || true)"
    [[ -n "${integrity}" ]] || integrity="unknown"
    lock="$(jq -c --arg p "${bare}" --arg v "${version}" --arg i "${integrity}" \
      '. + {($p): {version: $v, integrity: $i}}' <<<"${lock}")"
  done
  jq . <<<"${lock}" > "${LOCKFILE}"
  chmod 644 "${LOCKFILE}"
}

# Run as root while keeping the user's HOME and bun prefix (sudo resets both).
# PATH is passed explicitly with npm's node-gyp shim dir prepended: bun runs
# native-addon install scripts via `node`, and node-gyp is absent from the
# default PATH (spawn ENOENT kills pi-knowledge's tree-sitter postinstall).
NODEGYP_BIN="/usr/lib/node_modules/npm/bin/node-gyp-bin"
run_as_root_with_user_home() {
  sudo PATH="${NODEGYP_BIN}:${PATH}" HOME="${HOME}" BUN_INSTALL="${BUN_INSTALL:-/usr/local}" "$@"
}

# Refresh every plugin to its latest npm release by reinstalling the bare
# name (installs resolve latest). `omp plugin upgrade` is NOT used: with no
# marketplace registered it is a no-op that reports "All marketplace plugins
# are up to date" while the plugins lag. Reinstall is idempotent (~4 s when
# already current) and covers the no-marketplace reality of this image.
# Best-effort: a registry/network outage must not break container-create.
upgrade_plugins() {
  echo "install-omp-plugins.sh: refreshing plugins to latest..."
  local pkg
  for pkg in "${PLUGINS[@]}"; do
    if [[ "${USE_NPM_FALLBACK:-0}" -eq 1 ]]; then
      sudo npm update -g "${pkg}" >/dev/null 2>&1 || \
        echo "install-omp-plugins.sh: WARNING — npm update failed for ${pkg}" >&2
    elif ! run_as_root_with_user_home "${OMP_CMD}" plugin install "${pkg}" >/dev/null 2>&1; then
      echo "install-omp-plugins.sh: WARNING — refresh failed for ${pkg} (continuing)" >&2
    fi
  done
}

# Exempt `hub` from loop-police's TOOL CALL LOOP detector.
# WHY: post-mortems of this instance's telemetry show every blocked-loop event
# (7 to date) is a legitimate hub wait/poll on a peer — loop-police 1.14.1 has
# no per-op exemption (no hub_ops_exempt knob), so TOOL_LOOP_EXEMPT (comma-
# separated tool names) is the available knob; exempt hub calls still enter
# loop history and break adjacency for other tools. The file is image-managed,
# so overriding a manual `save` here is the accepted tradeoff. One-line revert:
# set TOOL_LOOP_EXEMPT back to "".
ensure_loop_police_exempt() {
  local lpjson="${HOME}/.omp/plugins/node_modules/pi-loop-police/extensions/loop-police.json"
  [[ -f "${lpjson}" ]] || return 0  # absent → plugin auto-creates it with defaults
  if [[ "$(jq -r '.TOOL_LOOP_EXEMPT // empty' "${lpjson}" 2>/dev/null)" == "hub" ]]; then
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  if jq '.TOOL_LOOP_EXEMPT = "hub"' "${lpjson}" > "${tmp}" 2>/dev/null; then
    run_as_root_with_user_home mv -f "${tmp}" "${lpjson}" || rm -f "${tmp}"
  else
    rm -f "${tmp}"
  fi
}

# Idempotency check: skip the INSTALL only when the sentinel exists AND records
# the current omp version AND the plugin name set is unchanged. The sentinel
# stores "<omp version>|<sha256 of plugin specs>" so a rebuild that adds or
# drops a plugin triggers reinstall on existing volumes (reinstall is
# idempotent: `omp plugin install` of an already-installed name is a fast no-op).
# A legacy sentinel (bare version) differs from the new format and triggers
# exactly one reinstall.
CURRENT_SENTINEL="${CURRENT_OMP_VER}|$(printf '%s\n' "${PLUGINS[@]}" | sha256sum | awk '{print $1}')"
if [[ -f "${SENTINEL}" ]]; then
  RECORDED="$(cat "${SENTINEL}" 2>/dev/null || echo '')"
  if [[ "${RECORDED}" == "${CURRENT_SENTINEL}" ]]; then
    # Fast path: plugin set already installed — still refresh versions + knobs.
    upgrade_plugins
    ensure_loop_police_exempt
    sudo chown -R vscode:vscode "${HOME}/.npm" "${HOME}/.omp" "${HOME}/.bun" "${HOME}/.cache" "${HOME}/.pi-lens" 2>/dev/null || true
    capture_lock
    echo "install-omp-plugins.sh: plugins already installed (omp ${CURRENT_OMP_VER}, plugin set unchanged). Skipped install; upgrade + knobs applied."
    exit 0
  fi
  echo "install-omp-plugins.sh: state changed ('${RECORDED:-<none>}' -> '${CURRENT_SENTINEL}'); reinstalling plugins."
fi

echo "install-omp-plugins.sh: installing omp plugins..."

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

# Bring the freshly installed set to latest too (no-op when already current).
upgrade_plugins
ensure_loop_police_exempt

# Return ownership of any user-home trees the root install touched
# (omp state, bun/npm caches).
sudo chown -R vscode:vscode "${HOME}/.npm" "${HOME}/.omp" "${HOME}/.bun" "${HOME}/.cache" "${HOME}/.pi-lens" 2>/dev/null || true

capture_lock

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "install-omp-plugins.sh: WARNING — partial plugin install failure for: ${FAILED[*]}" >&2
  echo "install-omp-plugins.sh: continuing devcontainer initialization..."
else
  # Sentinel only after a fully successful install + lockfile write
  printf '%s\n' "${CURRENT_SENTINEL}" > "${SENTINEL}"
  echo "install-omp-plugins.sh: done. All plugins installed, lockfile written to ${LOCKFILE}, sentinel created."
fi