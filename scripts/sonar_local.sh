#!/usr/bin/env bash
# sonar_local.sh — LOCAL SonarQube quality-gate check (#359).
#
# Brings up a SonarQube Community container (plain `docker run`, NOT compose —
# so the one-stack guard is never involved), runs sonar-scanner for both stacks
# using the committed sonar-project.properties, prints the quality-gate verdict,
# and exits by it (0 = OK, 1 = gate failed / error).
#
# Residue policy (rule 9): the ONLY resources this script creates or removes are
# its own named container ($CONTAINER) and named volumes ($VOLUME_*). It never
# touches project compose stacks or their volumes.
#
# Usage:
#   bash scripts/sonar_local.sh          # start (or reuse) Sonar, analyze, verdict
#   bash scripts/sonar_local.sh --down   # stop + remove the sonar container only
#                                        # (volumes kept for fast next run)
#
# Env overrides:
#   SONAR_PORT (default 9000)         host loopback port
#   SONAR_ADMIN_PASSWORD              if you changed the admin password in the UI
#   SONAR_IMAGE / SCANNER_IMAGE       image pins
#
# Coverage is REUSED, not produced here — run beforehand for coverage-aware gates:
#   backend:  cd backend && pytest --cov-report=xml   (→ backend/coverage.xml)
#   frontend: cd frontend && npm run test:coverage    (→ coverage/<proj>/lcov.info)
# Missing reports only degrade coverage metrics; the analysis still runs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SONAR_PORT="${SONAR_PORT:-9000}"
SONAR_IMAGE="${SONAR_IMAGE:-sonarqube:community}"
SCANNER_IMAGE="${SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:11}"
CONTAINER="beaconfolio-sonarqube"
VOLUME_DATA="beaconfolio-sonarqube-data"
VOLUME_EXT="beaconfolio-sonarqube-extensions"
BASE_URL="http://127.0.0.1:${SONAR_PORT}"
ADMIN_USER="admin"
ADMIN_PASS="${SONAR_ADMIN_PASSWORD:-admin}"
TOKEN_NAME="beaconfolio-local-scan"

log() { printf '[sonar-local] %s\n' "$*"; }
die() { printf '[sonar-local] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v curl   >/dev/null 2>&1 || die "curl is required"

# --- teardown mode -----------------------------------------------------------
if [ "${1:-}" = "--down" ]; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker rm -f "$CONTAINER" >/dev/null
    log "removed container $CONTAINER (volumes $VOLUME_DATA/$VOLUME_EXT kept)"
  else
    log "container $CONTAINER not present — nothing to do"
  fi
  exit 0
fi

# --- 1. start or reuse the SonarQube container -------------------------------
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "reusing running container $CONTAINER"
elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "starting existing container $CONTAINER"
  docker start "$CONTAINER" >/dev/null
else
  log "creating container $CONTAINER on 127.0.0.1:${SONAR_PORT} (image $SONAR_IMAGE)"
  docker run -d --name "$CONTAINER" \
    -p "127.0.0.1:${SONAR_PORT}:9000" \
    -v "${VOLUME_DATA}:/opt/sonarqube/data" \
    -v "${VOLUME_EXT}:/opt/sonarqube/extensions" \
    -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
    "$SONAR_IMAGE" >/dev/null
fi

# --- 2. wait for readiness (no `timeout` on macOS — plain loop) --------------
log "waiting for SonarQube to report UP (first boot can take ~2-3 min)"
elapsed=0
until [ "$(curl -sf "${BASE_URL}/api/system/status" 2>/dev/null \
           | grep -o '"status":"[A-Z]*"' | head -1)" = '"status":"UP"' ]; do
  [ "$elapsed" -ge 300 ] && die "SonarQube not UP after ${elapsed}s — check: docker logs $CONTAINER"
  sleep 5; elapsed=$((elapsed + 5))
done
log "SonarQube UP after ${elapsed}s"

# --- 3. mint a scan token (revoke stale one first — idempotent) --------------
auth() { curl -sf -u "${ADMIN_USER}:${ADMIN_PASS}" "$@"; }
auth -X POST "${BASE_URL}/api/user_tokens/revoke" -d "name=${TOKEN_NAME}" >/dev/null 2>&1 || true
TOKEN_JSON="$(auth -X POST "${BASE_URL}/api/user_tokens/generate" -d "name=${TOKEN_NAME}")" \
  || die "cannot authenticate as ${ADMIN_USER} — if you changed the admin password, set SONAR_ADMIN_PASSWORD"
TOKEN="$(printf '%s' "$TOKEN_JSON" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)"
[ -n "$TOKEN" ] || die "token generation returned no token: $TOKEN_JSON"

# --- 4. coverage report presence (informational) -----------------------------
[ -f "${REPO_ROOT}/backend/coverage.xml" ] \
  || log "note: backend/coverage.xml missing — run 'cd backend && pytest --cov-report=xml' for coverage metrics"
[ -f "${REPO_ROOT}/frontend/coverage/public/lcov.info" ] \
  || log "note: frontend lcov reports missing — run 'cd frontend && npm run test:coverage'"

# --- 5. run the scanner ------------------------------------------------------
# From a git WORKTREE, .git is a pointer file to the main repo's .git/worktrees/*
# which is not mounted in the container — JGit cannot open it, so disable SCM
# integration there (loses blame/new-code precision locally; CI keeps full git).
SCM_DISABLED=false
if [ -f "${REPO_ROOT}/.git" ]; then
  log "note: git worktree detected — SCM/blame integration disabled for this scan"
  SCM_DISABLED=true
fi

log "running sonar-scanner (${SCANNER_IMAGE})"
# scanner-cli:11 pins its working dir to /tmp/.scannerwork INSIDE the container
# (measured), so report-task.txt never reaches the mount — take the CE task id
# from the scanner's own output instead. Bonus: zero residue in the repo.
SCAN_LOG="$(mktemp)"
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e SONAR_HOST_URL="http://host.docker.internal:${SONAR_PORT}" \
  -e SONAR_TOKEN="$TOKEN" \
  -v "${REPO_ROOT}:/usr/src" \
  "$SCANNER_IMAGE" "-Dsonar.scm.disabled=${SCM_DISABLED}" > "$SCAN_LOG" 2>&1 \
  || { tail -30 "$SCAN_LOG" >&2; die "scanner failed (full log: $SCAN_LOG)"; }

CE_TASK_ID="$(grep -o 'api/ce/task?id=[A-Za-z0-9_-]*' "$SCAN_LOG" | head -1 | cut -d= -f2)"
[ -n "$CE_TASK_ID" ] || { tail -30 "$SCAN_LOG" >&2; die "no CE task id in scanner output (log: $SCAN_LOG)"; }
rm -f "$SCAN_LOG"

# --- 6. wait for server-side processing, then read the quality gate ----------
log "waiting for analysis processing (task $CE_TASK_ID)"
elapsed=0
while :; do
  TASK_JSON="$(auth "${BASE_URL}/api/ce/task?id=${CE_TASK_ID}")"
  STATUS="$(printf '%s' "$TASK_JSON" | grep -o '"status":"[A-Z_]*"' | head -1 | cut -d'"' -f4)"
  case "$STATUS" in
    SUCCESS) break ;;
    FAILED|CANCELED) die "analysis processing $STATUS" ;;
  esac
  [ "$elapsed" -ge 180 ] && die "analysis processing stuck after ${elapsed}s"
  sleep 3; elapsed=$((elapsed + 3))
done
ANALYSIS_ID="$(printf '%s' "$TASK_JSON" | grep -o '"analysisId":"[^"]*"' | cut -d'"' -f4)"

GATE_JSON="$(auth "${BASE_URL}/api/qualitygates/project_status?analysisId=${ANALYSIS_ID}")"
GATE="$(printf '%s' "$GATE_JSON" | grep -o '"status":"[A-Z_]*"' | head -1 | cut -d'"' -f4)"

log "dashboard: ${BASE_URL}/dashboard?id=mavrovde_beaconfolio"
if [ "$GATE" = "OK" ]; then
  log "QUALITY GATE: OK"
  exit 0
fi
log "QUALITY GATE: ${GATE:-UNKNOWN}"
printf '%s\n' "$GATE_JSON" | grep -o '"metricKey":"[^"]*","comparator":"[^"]*","errorThreshold":"[^"]*","actualValue":"[^"]*"' || true
exit 1
