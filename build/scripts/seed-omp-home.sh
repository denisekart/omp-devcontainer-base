#!/usr/bin/env bash
# seed-omp-home.sh — First-boot seeding of omp config from immutable image defaults
# Uses ~/.omp/.seeded-v1 as sentinel to avoid overwriting user edits on rebuild.
set -euo pipefail

DEFAULTS_SRC="/usr/local/share/omp-defaults/agent"
OMP_AGENT_DIR="${HOME}/.omp/agent"
SENTINEL="${HOME}/.omp/.seeded-v1"

# Validate the immutable source exists
if [[ ! -d "${DEFAULTS_SRC}" ]]; then
  echo "seed-omp-home.sh: ERROR — defaults source not found at ${DEFAULTS_SRC}" >&2
  echo "seed-omp-home.sh: The image may not have been built correctly. Cannot seed." >&2
  exit 1
fi

# Check if source has actual content (not just empty dirs from Dockerfile RUN mkdir)
if [[ ! -f "${DEFAULTS_SRC}/config.yml" ]]; then
  echo "seed-omp-home.sh: ERROR — ${DEFAULTS_SRC}/config.yml missing from image defaults" >&2
  exit 1
fi

# Idempotency check — skip if already seeded
if [[ -f "${SENTINEL}" ]]; then
  echo "seed-omp-home.sh: volume already seeded (sentinel ${SENTINEL} exists), skipping"
  exit 0
fi

# First boot — seed defaults
echo "seed-omp-home.sh: seeding omp defaults from ${DEFAULTS_SRC} to ${OMP_AGENT_DIR}..."
mkdir -p "${OMP_AGENT_DIR}"
cp -r "${DEFAULTS_SRC}/." "${OMP_AGENT_DIR}/"

# Create sentinel AFTER successful copy only
touch "${SENTINEL}"
echo "seed-omp-home.sh: seeding complete — sentinel created at ${SENTINEL}"
