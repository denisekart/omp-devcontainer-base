#!/usr/bin/env bash
# hindsight-supervisor.sh — Self-healing, single-instance Hindsight supervisor loop
#
# Design:
#   - Uses flock(1) to prevent duplicate loops from concurrent postStart/restart runs
#   - The container's PID namespace resets on restart, naturally clearing stale locks
#   - Loops every 15s checking health; restarts hindsight if down
#   - Uses a pidfile to prevent double-starting hindsight within the loop
#   - Logs to ~/.hindsight/hindsight.log
#
# Launch (from postStartCommand in devcontainer.json):
#   nohup bash .devcontainer/scripts/hindsight-supervisor.sh >/dev/null 2>&1 & disown
set -euo pipefail

HINDSIGHT_DIR="${HOME}/.hindsight"
PGDATA_DIR="${HINDSIGHT_DIR}/pgdata"
LOG_FILE="${HINDSIGHT_DIR}/hindsight.log"
PIDFILE="${HINDSIGHT_DIR}/hindsight.pid"
LOCK_FILE="${HINDSIGHT_DIR}/supervisor.lock"
HEALTH_URL="http://localhost:8888/health"

mkdir -p "${HINDSIGHT_DIR}" "${PGDATA_DIR}"

# Single-instance guard: exit immediately if another supervisor loop holds the lock.
# flock -n = non-blocking; if lock is held, exit 0 (not an error).
# The container's PID namespace resets on true restart, clearing stale locks automatically.
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "hindsight-supervisor.sh: another supervisor instance is already running (lock held). Exiting." >&2
  exit 0
fi
# fd 200 stays open for the lifetime of this process — lock is held until we exit

echo "hindsight-supervisor.sh: supervisor started (PID $$) at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${LOG_FILE}"

start_hindsight() {
  # Check if already running via pidfile to avoid double-start within a loop cycle
  if [[ -f "${PIDFILE}" ]]; then
    local existing_pid
    existing_pid=$(cat "${PIDFILE}" 2>/dev/null || echo "")
    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      echo "hindsight-supervisor.sh: hindsight already running (PID ${existing_pid})" >> "${LOG_FILE}"
      return 0
    fi
    rm -f "${PIDFILE}"
  fi

  echo "hindsight-supervisor.sh: starting hindsight at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${LOG_FILE}"

  # hindsight-all is installed in a venv at ~/.local/share/hindsight (see Dockerfile).
  # The CLI binary is symlinked to ~/.local/bin/hindsight.
  # Data directory is set via HINDSIGHT_DATA_DIR env var.
  # NOTE: if the entrypoint name differs after install, check:
  #   ls ~/.local/share/hindsight/bin/
  # and update the command below accordingly.
  HINDSIGHT_DATA_DIR="${PGDATA_DIR}" \
  nohup hindsight \
    >> "${LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${PIDFILE}"
  echo "hindsight-supervisor.sh: hindsight started with PID ${pid}" >> "${LOG_FILE}"

  # Wait briefly for startup before first health check
  sleep 5
}

# Main supervision loop — runs forever, one supervisor per container
echo "hindsight-supervisor.sh: entering supervision loop" >> "${LOG_FILE}"
while true; do
  if curl -sf "${HEALTH_URL}" >/dev/null 2>&1; then
    : # Healthy — no action needed
  else
    echo "hindsight-supervisor.sh: health check failed at $(date -u +%Y-%m-%dT%H:%M:%SZ), restarting..." >> "${LOG_FILE}"
    start_hindsight
  fi
  sleep 15
done
