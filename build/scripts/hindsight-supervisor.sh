#!/usr/bin/env bash
# hindsight-supervisor.sh — Self-healing, single-instance Hindsight supervisor
#
# Design:
#   - Single instance via flock(1): the lock is tied to this process's open file
#     description and released automatically on exit. The lock file lives on the
#     persistent ~/.hindsight volume, so a recreated container still has a stale
#     lock file on disk — but no process holds it (old PID namespace is gone),
#     so `flock -n` succeeds.
#   - Liveness is decided with `pgrep -f <hindsight-binary-path>`, NOT a pidfile,
#     so a stale pidfile or a reused PID can never make a dead instance look alive.
#     The pattern is specific so it never matches this supervisor script.
#   - Each cycle (POLL_SECS): healthy -> idle; alive-but-unhealthy -> wait up to
#     RECOVERY_TIMEOUT_SECS, then declare hung and restart; not running -> start
#     and wait up to STARTUP_TIMEOUT_SECS for first health.
#   - Logs to ~/.hindsight/hindsight.log with size-based rotation.
#
# Launch (postStartCommand in devcontainer.json):
#   tmux new-session -d -s hindsight 'bash /usr/local/share/omp-scripts/hindsight-supervisor.sh'
#   (or: nohup bash /usr/local/share/omp-scripts/hindsight-supervisor.sh >/dev/null 2>&1 &)
#
# Note: with the tmux launch, `tmux kill-session hindsight` stops the supervisor
# (it's the pane command) but `nohup` keeps hindsight itself alive, so the memory
# server survives and gets re-adopted on the next `devcontainer up`.
set -euo pipefail

# --- Configuration (all overridable via env) ---
HINDSIGHT_DIR="${HOME}/.hindsight"
PGDATA_DIR="${HINDSIGHT_DIR}/pgdata"
LOG_FILE="${HINDSIGHT_DIR}/hindsight.log"
LOCK_FILE="${HINDSIGHT_DIR}/supervisor.lock"
HEALTH_URL="${HINDSIGHT_HEALTH_URL:-http://localhost:8888/health}"

# Locate the hindsight daemon binary
if [[ -z "${HINDSIGHT_BIN:-}" ]]; then
  for candidate in \
    "${HOME}/.local/share/hindsight/bin/hindsight-api" \
    "${HOME}/.local/share/hindsight/bin/hindsight" \
    "${HOME}/.local/bin/hindsight-api" \
    "${HOME}/.local/bin/hindsight" \
    "$(command -v hindsight-api 2>/dev/null || true)" \
    "$(command -v hindsight 2>/dev/null || true)"; do
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
      HINDSIGHT_BIN="${candidate}"
      break
    fi
  done
  HINDSIGHT_BIN="${HINDSIGHT_BIN:-${HOME}/.local/share/hindsight/bin/hindsight-api}"
fi

# Liveness pattern: matches the running hindsight process's full command line
# (its interpreter + this binary path). Deliberately the venv bin path so it
# never matches this supervisor (whose cmdline is .../hindsight-supervisor.sh).
HINDSIGHT_RUN_PATTERN="${HINDSIGHT_BIN}"

POLL_SECS="${HINDSIGHT_POLL_SECS:-15}"
STARTUP_TIMEOUT_SECS="${HINDSIGHT_STARTUP_TIMEOUT_SECS:-180}"
RECOVERY_TIMEOUT_SECS="${HINDSIGHT_RECOVERY_TIMEOUT_SECS:-180}"
MAX_LOG_BYTES="${HINDSIGHT_MAX_LOG_BYTES:-10485760}"    # 10 MiB
HEALTH_TIMEOUT_SECS=5

mkdir -p "${HINDSIGHT_DIR}" "${PGDATA_DIR}"

rotate_log() {
  local size
  size=$(stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)
  if (( size > MAX_LOG_BYTES )); then
    mv -f "${LOG_FILE}" "${LOG_FILE}.1" 2>/dev/null || true
    : > "${LOG_FILE}" 2>/dev/null || true
  fi
  return 0
}

log() {
  rotate_log
  echo "hindsight-supervisor.sh: $1" >> "${LOG_FILE}"
}

# --- Dependency gates: fail LOUDLY, never silently no-op ---
if ! command -v flock >/dev/null 2>&1; then
  echo "hindsight-supervisor.sh: ERROR — flock not found (package: util-linux). Cannot guarantee single-instance; aborting." >&2
  exit 1
fi
if ! command -v pgrep >/dev/null 2>&1 || ! command -v pkill >/dev/null 2>&1; then
  echo "hindsight-supervisor.sh: ERROR — pgrep/pkill not found (package: procps). Aborting." >&2
  exit 1
fi
if [[ ! -x "${HINDSIGHT_BIN}" ]]; then
  echo "hindsight-supervisor.sh: ERROR — hindsight binary not found at ${HINDSIGHT_BIN}." >&2
  echo "hindsight-supervisor.sh: check with: ls ${HINDSIGHT_BIN}  (the venv may not have been built)" >&2
  exit 1
fi

# --- Single-instance guard (flock) ---
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "hindsight-supervisor.sh: another supervisor instance holds the lock. Exiting." >&2
  exit 0
fi
# fd 200 stays open for the process lifetime — the lock is held until we exit.

# --- Helpers ---
health_check() {
  curl -sfm "${HEALTH_TIMEOUT_SECS}" "${HEALTH_URL}" >/dev/null 2>&1
}

is_running() {
  pgrep -f "${HINDSIGHT_RUN_PATTERN}" >/dev/null 2>&1
}

kill_instance() {
  local pids
  pids=$(pgrep -f "${HINDSIGHT_RUN_PATTERN}" 2>/dev/null || true)
  if [[ -z "${pids}" ]]; then
    return 0
  fi
  log "killing hindsight (PIDs: ${pids//$'\n'/ })"
  pkill -f "${HINDSIGHT_RUN_PATTERN}" 2>/dev/null || true
  sleep 2
  if is_running; then
    log "hindsight still alive — sending SIGKILL"
    pkill -9 -f "${HINDSIGHT_RUN_PATTERN}" 2>/dev/null || true
    sleep 2
  fi
  return 0
}

wait_for_healthy() {
  local timeout="${1:-${STARTUP_TIMEOUT_SECS}}"
  local deadline now
  now=$(date +%s); deadline=$(( now + timeout ))
  while (( $(date +%s) < deadline )); do
    if health_check; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_hindsight() {
  if is_running; then
    log "hindsight already running — skipping start"
    return 0
  fi
  log "starting hindsight ($HINDSIGHT_BIN)"
  local llm_key="${HINDSIGHT_API_LLM_API_KEY:-${OPENAI_API_KEY:-${ANTHROPIC_API_KEY:-devcontainer-local-key}}}"
  HINDSIGHT_DATA_DIR="${PGDATA_DIR}" \
  HINDSIGHT_API_LLM_API_KEY="${llm_key}" \
  HINDSIGHT_API_PORT="8888" \
  HINDSIGHT_API_HOST="0.0.0.0" \
  nohup "${HINDSIGHT_BIN}" >> "${LOG_FILE}" 2>&1 &
  log "hindsight launched (PID $!)"
  return 0
}

log "supervisor started (PID $$) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "health=${HEALTH_URL} bin=${HINDSIGHT_BIN}"
log "entering supervision loop (poll=${POLL_SECS}s startup_timeout=${STARTUP_TIMEOUT_SECS}s recovery_timeout=${RECOVERY_TIMEOUT_SECS}s)"

# --- Supervision loop ---
while true; do
  if health_check; then
    : # healthy — nothing to do
  elif is_running; then
    log "unhealthy but process running — waiting up to ${RECOVERY_TIMEOUT_SECS}s for recovery"
    if wait_for_healthy "${RECOVERY_TIMEOUT_SECS}"; then
      log "recovered"
    else
      log "still unhealthy after ${RECOVERY_TIMEOUT_SECS}s — restarting"
      kill_instance
      start_hindsight
    fi
  else
    log "not running — starting"
    start_hindsight
    if wait_for_healthy "${STARTUP_TIMEOUT_SECS}"; then
      log "up and healthy"
    else
      log "not healthy within ${STARTUP_TIMEOUT_SECS}s — will keep retrying"
    fi
  fi
  sleep "${POLL_SECS}"
done