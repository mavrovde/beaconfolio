#!/bin/bash
set -eo pipefail

# On ANY failure (backend, frontend, proxy verification, Playwright, ...) print
# an unmistakable final FAILED banner instead of dying mid-log.
on_exit() {
    status=$?
    if [ "$status" -ne 0 ]; then
        echo ""
        echo "========================================"
        echo "❌ VERIFICATION FAILED (exit $status) ❌"
        echo "========================================"
    fi
}
trap on_exit EXIT

echo "========================================"
echo "🚀 STARTING FULL VERIFICATION SUITE 🚀"
echo "========================================"

# Ensure DOCKER_HOST is set for Podman (no-op when podman is not installed)
if [ -z "${DOCKER_HOST:-}" ] && command -v podman >/dev/null 2>&1; then
    PODMAN_SOCKET=$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null || true)
    if [ -n "$PODMAN_SOCKET" ]; then
        export DOCKER_HOST="unix://$PODMAN_SOCKET"
        echo "✅ Set DOCKER_HOST to Podman socket: $DOCKER_HOST"
    fi
fi

# 0. Repo-contract lint: the CLAUDE.md AI-config map must describe the tooling
# that actually exists (#246). Dependency-free and instant, so it runs first —
# a stale map misleads every later reader, human or agent.
echo ""
echo "========================================"
echo "[1/4] repo: 🗺️  AI-config map drift"
echo "========================================"
bash "$(dirname "$0")/scripts/check_aiconfig_map.sh" || exit 1

# 1. Backend Checks (via Docker to ensure consistent environment)
echo ""
echo "========================================"
echo "[2/4] backend: 🐍 Static Analysis & Tests"
echo "========================================"
# Start DB if not running
# Start DB with DEV config to ensure ports are exposed
docker-compose -f docker-compose.yml up -d --force-recreate db
# Run checks
cd backend
# Portable interpreter: prefer the project venv, else python3. Override with PYTEST_PYTHON.
# shellcheck disable=SC2015  # A && B || C is intentional here: B is a bare echo that cannot fail.
PYTEST_PYTHON="${PYTEST_PYTHON:-$([ -x venv/bin/python ] && echo venv/bin/python || command -v python3)}"
BEACONFOLIO_GEMINI_API_KEY="" "$PYTEST_PYTHON" -m pytest tests
cd ..

# 2. Frontend Checks
echo ""
echo "========================================"
echo "[3/4] frontend: 🅰️  Lint, Tests & Build"
echo "========================================"
cd frontend
echo "Running Lint..."
npm run lint --if-present
echo "Running Tests (shared + public + admin, 100% coverage each)..."
npm run test:coverage
echo "Building Production (shared + public + admin)..."
npm run build
cd ..

# 3. E2E Checks
echo ""
echo "========================================"
echo "[4/4] e2e: 🎭 Docker Stack + E2E Tests"
echo "========================================"
# Ensure full stack is running
echo "Starting full stack..."
docker-compose -f docker-compose.prod.yml -f docker-compose.e2e.yml up -d --build backend frontend admin-frontend proxy open-webui

echo "🔄 Restarting Frontend, Admin & Proxy to ensure fresh DNS resolution..."
docker-compose -f docker-compose.prod.yml -f docker-compose.e2e.yml restart frontend admin-frontend proxy

# Waiting for Health with timeouts instead of fixed sleeps
echo "Waiting for Backend to be ready..."
# Portable wait function
count=0
until curl -s -f http://localhost/health > /dev/null || [ $count -eq 90 ]; do
    sleep 1
    count=$((count + 1))
done

if [ $count -eq 90 ]; then
    echo "Backend failed to start"
    exit 1
fi

echo "Waiting for Frontend to be ready..."
count=0
until curl -s -f http://localhost > /dev/null || [ $count -eq 60 ]; do
    sleep 1
    count=$((count + 1))
    if [ $((count % 10)) -eq 0 ]; then
        echo "Still waiting for Frontend... ($count/60)"
        docker-compose logs --tail=10 proxy frontend
    fi
done

# NOTE: this check must run right after the frontend wait loop — it previously
# sat below the Open WebUI loop and tested THAT loop's counter against 60.
if [ $count -eq 60 ]; then
    echo "❌ Frontend failed to start on http://localhost"
    docker-compose ps
    docker-compose logs proxy frontend
    exit 1
fi

echo "Waiting for Open WebUI to be ready..."
count=0
# Wait longer for Open WebUI (can be slow)
until curl -s -f http://localhost/open/health > /dev/null || [ $count -eq 90 ]; do
    sleep 2
    count=$((count + 1))
    if [ $((count % 5)) -eq 0 ]; then
        echo "Still waiting for Open WebUI... ($((count * 2))/180s)"
    fi
done

if [ $count -eq 90 ]; then
    echo "❌ Open WebUI failed to start on http://localhost/open/health"
    docker-compose ps
    docker-compose logs --tail=20 open-webui
    # We don't exit here, we let the python script fail with more details if needed, or exit?
    # Better to exit to save time.
    exit 1
fi


echo "🌱 Seeding E2E data..."
docker-compose -f docker-compose.prod.yml -f docker-compose.e2e.yml exec -T backend python scripts/seed_e2e_user.py

# Admin access-control generator unit test (real_ip + allowlist; #86). Pure shell,
# stack-independent — asserts the CLOSED-by-default allowlist, valid-CIDR opening,
# malformed-entry rejection, and never a blanket allow.
echo "🛡️  Verifying admin access-config generator..."
sh proxy/test-generate-admin-config.sh

# Version tooling self-test (#186): bump_version.sh --check gates every push and
# the pipeline, and its rotation writes the release notes — so the checker itself
# is tested here, not only in CI.
echo "🛡️  Verifying version tooling (bump_version.sh)..."
bash test-bump-version.sh

# Destructive-command guard self-test (#116/#188).
echo "🛡️  Verifying destructive-command guard..."
bash .claude/hooks/guard-destructive.test.sh

# Run Playwright
echo "🛡️  Verifying Proxy Routes..."
python3 -m pip install httpx --quiet --break-system-packages || true
PROXY_PORT=80 python3 verify_proxy_routes.py

echo "Running Playwright..."
cd frontend
export BASE_URL=http://localhost
echo "Running Standard E2E Tests..."
CI=true npx playwright test --grep-invert "profile"

# echo "Running Destructive E2E Tests (Profile/Password)..."
# CI=true npx playwright test profile.spec.ts
cd ..

echo ""
echo "========================================"
echo "✅ ALL CHECKS PASSED SUCCESSFULLY! ✅"
echo "========================================"
