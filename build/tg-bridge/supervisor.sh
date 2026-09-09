#!/bin/bash
set -euo pipefail

# supervisor.sh — Single-instance supervisor for tg-bridge daemon
# Infinite config wait, mtime-based SIGHUP triggers, orphan kill, linear backoff.

STATE_DIR="${TG_BRIDGE_STATE_DIR:-/home/vscode/.omp/tg-bridge}"
export SOCK="${TG_BRIDGE_SOCK:-${STATE_DIR}/sock}"
export OMP_BIN="${TG_BRIDGE_OMP_BIN:-/usr/local/bin/omp}"
DAEMON_LOG="${STATE_DIR}/daemon.log"
LOCK_FILE="${STATE_DIR}/daemon.lock"

# Resolve DAEMON_BIN relative to this script's directory (not cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_BIN="${SCRIPT_DIR}/daemon.ts"

# Ensure state directory exists
mkdir -p "${STATE_DIR}"

# --- helpers ---------------------------------------------------------------

rotate_log() {
  if [ -f "${DAEMON_LOG}" ]; then
    local size
    size=$(wc -c < "${DAEMON_LOG}" 2>/dev/null || echo 0)
    if [ "${size}" -gt 1048576 ]; then
      mv "${DAEMON_LOG}" "${DAEMON_LOG}.old"
    fi
  fi
}

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "${DAEMON_LOG}"
}

# Kill stale supervisors left by a prior run (lock file holds the supervisor PID).
kill_orphans() {
  if [ -f "${LOCK_FILE}" ]; then
    local old_pid
    old_pid=$(cat "${LOCK_FILE}" 2>/dev/null || true)
    if [ -n "${old_pid}" ] && kill -0 "${old_pid}" 2>/dev/null; then
      log "Killing stale supervisor (pid ${old_pid})"
      kill -TERM "${old_pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${old_pid}" 2>/dev/null || true
    fi
    rm -f "${LOCK_FILE}"
  fi
}

# Wait for config.json to have required fields — infinite, poll every 5 s.
wait_for_config() {
  while true; do
    if [ -f "${STATE_DIR}/config.json" ]; then
      local token group
      token=$(grep -o '"botToken"[[:space:]]*:[[:space:]]*"[^"]*"' "${STATE_DIR}/config.json" 2>/dev/null || true)
      group=$(grep -o '"groupId"[[:space:]]*:[[:space:]]*-[0-9]*' "${STATE_DIR}/config.json" 2>/dev/null || true)
      if [ -n "${token}" ] && [ -n "${group}" ]; then
        return 0
      fi
    fi
    sleep 5
  done
}

# Track the mtime of config.json so SIGHUP can trigger a hot-reload.
CONFIG_MTIME=""
config_mtime() {
  if [ -f "${STATE_DIR}/config.json" ]; then
    stat -c %Y "${STATE_DIR}/config.json" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

# --- signal handling --------------------------------------------------------

DAEMON_PID=""
RESTART=0
EXITING=0

cleanup_lock() {
  flock -u 200 2>/dev/null || true
  exec 200>&- 2>/dev/null || true
}

handle_sighup() {
  local now_mtime
  log "SIGHUP received — checking config mtime"
  now_mtime=$(config_mtime)
  if [ "${now_mtime}" != "${CONFIG_MTIME}" ]; then
    log "Config changed (mtime ${CONFIG_MTIME} → ${now_mtime}) — restarting daemon"
    CONFIG_MTIME="${now_mtime}"
    RESTART=1
    if [ -n "${DAEMON_PID}" ] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
      kill -TERM "${DAEMON_PID}" 2>/dev/null || true
    fi
  else
    log "No config change detected"
  fi
}

handle_sigterm() {
  log "SIGTERM received — shutting down"
  EXITING=1
  RESTART=0
  if [ -n "${DAEMON_PID}" ] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
    kill -TERM "${DAEMON_PID}" 2>/dev/null || true
  fi
  cleanup_lock
}

trap handle_sighup HUP
trap handle_sigterm TERM

# --- loop-restart daemon with linear backoff (cap 30 s) ---------------------

restart_daemon() {
  local backoff=1
  local max_backoff=30

  while true; do
    rotate_log

    # Acquire lock (single instance).
    exec 200>"${LOCK_FILE}"
    if ! flock -n 200; then
      log "Another instance running, exiting"
      exit 0
    fi

    # Record this supervisor's own PID (orphan kill on next start).
    echo "$$" > "${LOCK_FILE}"

    # Start daemon. Output goes straight to the log; no tee pipeline, so
    # wait's status reflects the daemon's exit status.
    log "Starting tg-bridge daemon"
    bun "${DAEMON_BIN}" >> "${DAEMON_LOG}" 2>&1 &
    DAEMON_PID=$!

    # wait returns 128+N when interrupted by trapped signal N; the signal
    # handlers then set EXITING/RESTART. Check those flags; otherwise the
    # daemon exited on its own and the loop restarts after backoff.
    local wait_status=0
    wait "${DAEMON_PID}" 2>/dev/null || wait_status=$?
    local pid="${DAEMON_PID}"
    DAEMON_PID=""

    if [ "${wait_status}" -ge 128 ] || [ -z "${pid}" ]; then
      # Interrupted by a trapped signal.
      log "Signal handled (wait status ${wait_status})"
      if [ "${EXITING}" -eq 1 ]; then
        break
      fi
      if [ "${RESTART}" -eq 1 ]; then
        RESTART=0
        backoff=1
        continue
      fi
      log "Interrupted, exiting"
      break
    fi

    log "Daemon exited (status ${wait_status}), restarting in ${backoff}s"

    # Linear backoff: increment by 1 s up to max 30 s.
    if [ ${backoff} -ge ${max_backoff} ]; then
      backoff=${max_backoff}
    else
      backoff=$((backoff + 1))
    fi
    sleep ${backoff}
  done

  cleanup_lock
}

# --- main -------------------------------------------------------------------

log "Supervisor starting"

# Kill any stale supervisor from a prior run.
kill_orphans

# Acquire single-instance lock before the config wait, so two supervisors can
# never both pass wait_for_config.
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  log "Another instance running, exiting"
  exit 0
fi
echo "$$" > "${LOCK_FILE}"

# Wait for config (infinite).
if ! wait_for_config; then
  log "Timed out waiting for config"
  exit 1
fi

# Record initial config mtime.
CONFIG_MTIME=$(config_mtime)

# Start loop-restart.
restart_daemon
