#!/bin/bash
set -euo pipefail

# supervisor.sh — Single-instance supervisor for tg-bridge daemon
# Mirrors the hindsight pattern: flock, config-wait, loop-restart with backoff

STATE_DIR="${TG_BRIDGE_STATE_DIR:-/home/vscode/.omp/tg-bridge}"
export SOCK="${TG_BRIDGE_SOCK:-${STATE_DIR}/sock}" # Path for unix socket listener
export OMP_BIN="${TG_BRIDGE_OMP_BIN:-/usr/local/bin/omp}" # Path to omp binary
DAEMON_LOG="${STATE_DIR}/daemon.log"
LOCK_FILE="${STATE_DIR}/daemon.lock"
DAEMON_BIN="build/tg-bridge/daemon.ts"

# Ensure state directory exists
mkdir -p "${STATE_DIR}"

# Rotate log at 1MB
rotate_log() {
  if [ -f "${DAEMON_LOG}" ]; then
    local size
    size=$(wc -c < "${DAEMON_LOG}" 2>/dev/null || echo 0)
    if [ "${size}" -gt 1048576 ]; then
      mv "${DAEMON_LOG}" "${DAEMON_LOG}.old"
    fi
  fi
}

# Wait for config.json to have required fields
wait_for_config() {
  local max_wait=150  # 150 seconds max
  local waited=0

  while [ ${waited} -lt ${max_wait} ]; do
    if [ -f "${STATE_DIR}/config.json" ]; then
      # Check if botToken and groupId exist
      local token group
      token=$(grep -o '"botToken"[[:space:]]*:[[:space:]]*"[^"]*"' "${STATE_DIR}/config.json" 2>/dev/null || true)
      group=$(grep -o '"groupId"[[:space:]]*:[[:space:]]*-[0-9]*' "${STATE_DIR}/config.json" 2>/dev/null || true)
      if [ -n "${token}" ] && [ -n "${group}" ]; then
        return 0
      fi
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Loop-restart daemon with exponential backoff
restart_daemon() {
  local backoff=1
  local max_backoff=30

  while true; do
    rotate_log

    # Acquire lock (single instance)
    exec 200>"${LOCK_FILE}"
    flock -n 200 || {
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Another instance running, exiting" >> "${DAEMON_LOG}"
      exit 0
    }

    # Write our PID to lock file
    echo "${PPID}" > "${LOCK_FILE}"

    # Start daemon
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Starting tg-bridge daemon" >> "${DAEMON_LOG}"
    bun "${DAEMON_BIN}" 2>&1 | tee -a "${DAEMON_LOG}" &
    local daemon_pid=$!

    # Wait for daemon to exit
    wait "${daemon_pid}" 2>/dev/null || true

    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Daemon exited (code $?), restarting in ${backoff}s" >> "${DAEMON_LOG}"

    # Release lock
    flock -u 200
    exec 200>&-

    # Backoff
    if [ ${backoff} -gt ${max_backoff} ]; then
      backoff=${max_backoff}
    fi
    sleep ${backoff}
    backoff=$((backoff * 2))
  done
}

# Main
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Supervisor starting" >> "${DAEMON_LOG}"

# Wait for config
if ! wait_for_config; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Timed out waiting for config" >> "${DAEMON_LOG}"
  exit 1
fi

# Start loop-restart
restart_daemon
