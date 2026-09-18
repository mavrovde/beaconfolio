#!/bin/bash
# Self-test for bump_version.sh — the version-carrier consistency check (#172) and
# the CHANGELOG rotation (#186). Both are load-bearing: `--check` gates every push
# (pre-push hook) and the pipeline (#193), and the rotation writes the release notes.
#
# Runs against a THROWAWAY copy of the repo's version carriers in a temp dir — it
# never mutates the working tree. Run: bash test-bump-version.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
FIXTURES=()
trap 'for d in "${FIXTURES[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done' EXIT

ok()   { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf 'FAIL  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# --- fixture: a minimal tree with every carrier bump_version.sh --check reads ----
make_fixture() {
    local dir="$1" ver="$2"
    FIXTURES+=("$dir")
    mkdir -p "$dir"/{backend/app,frontend/projects/shared,frontend/projects/public/src/app}
    printf '%s\n' "$ver" > "$dir/VERSION"
    cat > "$dir/backend/app/main.py" <<PY
doc = CvDocument(
                version="0.0.9",
)
app = FastAPI(
    title="Beaconfolio API",
    version="$ver",
)
PY
    printf '{\n  "name": "frontend",\n  "version": "%s"\n}\n' "$ver" > "$dir/frontend/package.json"
    printf '{\n  "name": "@beaconfolio/shared",\n  "version": "%s"\n}\n' "$ver" > "$dir/frontend/projects/shared/package.json"
    printf "export const VERSION = '%s';\n" "$ver" > "$dir/frontend/projects/public/src/app/version.ts"
    printf '{\n  "version": "%s",\n  "packages": {\n    "": {\n      "version": "%s"\n    }\n  }\n}\n' \
        "$ver" "$ver" > "$dir/frontend/package-lock.json"
    cat > "$dir/docker-compose.prod.yml" <<YML
services:
  backend:
    image: \${IMAGE_REPO:-x}-backend:\${IMAGE_TAG:-$ver}
  frontend:
    image: \${IMAGE_REPO:-x}-frontend:\${IMAGE_TAG:-$ver}
YML
    printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- Placeholder for next release.\n\n## [0.0.1] - 2020-01-01\n' \
        > "$dir/CHANGELOG.md"
    cp "$REPO_ROOT/bump_version.sh" "$dir/"
}

run_check() { (cd "$1" && ./bump_version.sh --check 2>&1); }

# The rotation cases run a real bump, which syncs package-lock.json via npm.
# Without npm those cases fail with empty diagnostics — say so instead (#186 review).
command -v npm > /dev/null 2>&1 || {
    echo "FAIL  npm is required for the rotation cases (bump_version.sh syncs package-lock.json)"
    exit 1
}

# === 1. --check passes on a consistent tree ===================================
D=$(mktemp -d); make_fixture "$D" 1.9.0
out=$(run_check "$D"); rc=$?
[ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'PASSED' \
    && ok "--check passes when all carriers agree" \
    || bad "--check passes when all carriers agree" "rc=$rc out=$out"

# === 2. every carrier is actually checked =====================================
# Each mutation must be caught, and the message must NAME the offending file.
for spec in \
    "VERSION:printf '1.8.0\n' > \$D/VERSION:VERSION" \
    "backend:sed -i.bak 's/version=\"1.9.0\"/version=\"1.8.0\"/' \$D/backend/app/main.py:backend/app/main.py" \
    "frontend pkg:sed -i.bak 's/\"version\": \"1.9.0\"/\"version\": \"1.8.0\"/' \$D/frontend/package.json:frontend/package.json" \
    "shared pkg:sed -i.bak 's/\"version\": \"1.9.0\"/\"version\": \"1.8.0\"/' \$D/frontend/projects/shared/package.json:shared/package.json" \
    "version.ts:sed -i.bak \"s/'1.9.0'/'1.8.0'/\" \$D/frontend/projects/public/src/app/version.ts:version.ts" \
    "compose tag:sed -i.bak 's/IMAGE_TAG:-1.9.0/IMAGE_TAG:-1.8.0/' \$D/docker-compose.prod.yml:docker-compose.prod.yml" \
; do
    name=${spec%%:*}; rest=${spec#*:}; cmd=${rest%:*}; expect=${rest##*:}
    D=$(mktemp -d); make_fixture "$D" 1.9.0
    eval "$cmd"
    out=$(run_check "$D"); rc=$?
    if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "$expect"; then
        ok "--check catches drift in $name (names the file)"
    else
        bad "--check catches drift in $name" "rc=$rc out=$out"
    fi
done

# === 3. a nested version="X.Y.Z" literal must NOT be read as the app version ====
# The fixture's CvDocument literal is NUMERIC on purpose: with the real
# "1.0.0-fallback" string an unanchored `version="[0-9.]*"` could never match it,
# so this case passed even against the unanchored script (#186 review).
D=$(mktemp -d); make_fixture "$D" 1.9.0
out=$(run_check "$D"); rc=$?
[ $rc -eq 0 ] \
    && ok "backend check reads the app version, not a nested literal" \
    || bad "backend check reads the app version, not a nested literal" "rc=$rc out=$out"

# ...and the WRITE side must leave the nested literal alone.
D=$(mktemp -d); make_fixture "$D" 1.9.0
(cd "$D" && RELEASE_QUEUE_GATE=0 ./bump_version.sh --patch > /dev/null 2>&1)
if grep -q 'version="0.0.9"' "$D/backend/app/main.py" \
   && grep -q '^    version="1.9.1"' "$D/backend/app/main.py"; then
    ok "bump rewrites the app version and leaves the nested literal intact"
else
    bad "bump rewrites the app version and leaves the nested literal intact" \
        "$(grep -n 'version=' "$D/backend/app/main.py")"
fi

# === 3b. a carrier whose PATTERN vanishes must fail loudly, not silently ========
# Guards the `[ -n "$v" ] ||` checks: under `set -euo pipefail` a non-matching
# grep used to exit 1 with zero output, which is undebuggable from a hook (#186).
D=$(mktemp -d); make_fixture "$D" 1.9.0
printf '{\n  "name": "frontend"\n}\n' > "$D/frontend/package-lock.json"   # no "version" key
out=$(run_check "$D"); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q 'package-lock.json'; then
    ok "--check reports a package-lock.json whose version key vanished"
else
    bad "--check reports a package-lock.json whose version key vanished" "rc=$rc out=$out"
fi

D=$(mktemp -d); make_fixture "$D" 1.9.0
printf 'services:\n  backend:\n    image: x\n' > "$D/docker-compose.prod.yml"  # no IMAGE_TAG default
out=$(run_check "$D"); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q 'docker-compose.prod.yml'; then
    ok "--check reports a compose file whose IMAGE_TAG default vanished"
else
    bad "--check reports a compose file whose IMAGE_TAG default vanished" "rc=$rc out=$out"
fi

# === 4. VERSION must carry exactly one trailing newline =======================
D=$(mktemp -d); make_fixture "$D" 1.9.0
printf '1.9.0' > "$D/VERSION"                    # no trailing newline
out=$(run_check "$D"); rc=$?
[ $rc -ne 0 ] && ok "--check rejects a VERSION without a trailing newline" \
              || bad "--check rejects a VERSION without a trailing newline" "rc=$rc"

D=$(mktemp -d); make_fixture "$D" 1.9.0
printf '1.9.0\n\n' > "$D/VERSION"                # two newlines
out=$(run_check "$D"); rc=$?
[ $rc -ne 0 ] && ok "--check rejects a VERSION with extra newlines" \
              || bad "--check rejects a VERSION with extra newlines" "rc=$rc"

# === 5. CHANGELOG rotation never splits a real ### Added list (#186) ==========
D=$(mktemp -d); make_fixture "$D" 1.9.0
cat > "$D/CHANGELOG.md" <<'MD'
# Changelog

## [Unreleased]

### Added
- Placeholder for next release.
- **A real feature** that must stay in the released section.
- **A second real feature.**

### Fixed
- A real fix.

## [0.0.1] - 2020-01-01
MD
(cd "$D" && RELEASE_QUEUE_GATE=0 ./bump_version.sh --minor > /dev/null 2>&1)
body=$(cd "$D" && sed -n '/^## \[1.10.0\]/,/^## \[0.0.1\]/p' CHANGELOG.md)
unrel=$(cd "$D" && sed -n '/^## \[Unreleased\]/,/^## \[1.10.0\]/p' CHANGELOG.md)
if printf '%s' "$body" | grep -q 'A real feature' \
   && printf '%s' "$body" | grep -q 'A second real feature' \
   && printf '%s' "$body" | grep -q 'A real fix' \
   && ! printf '%s' "$body" | grep -q 'Placeholder for next release'; then
    ok "rotation moves the whole [Unreleased] body into the release"
else
    bad "rotation moves the whole [Unreleased] body into the release" "$body"
fi
# The released section must keep its OWN "### Added" heading: the old
# placeholder-anchored rotation left that heading behind in [Unreleased] and
# emitted the real bullets bare under the version header (#186).
printf '%s' "$body" | grep -q '^### Added' \
    && ok "released section keeps its ### Added heading (list not split)" \
    || bad "released section keeps its ### Added heading (list not split)" "$body"
printf '%s' "$unrel" | grep -q 'Placeholder for next release' \
    && ok "rotation leaves a fresh [Unreleased] stub" \
    || bad "rotation leaves a fresh [Unreleased] stub" "$unrel"
[ "$(cd "$D" && grep -c '^## \[1.10.0\]' CHANGELOG.md)" = "1" ] \
    && ok "rotation inserts exactly one release header (no double rotation)" \
    || bad "rotation inserts exactly one release header"

# === 5b. rotating an already-rotated version is a no-op (#196 review) =========
D=$(mktemp -d); make_fixture "$D" 1.9.0
cat > "$D/CHANGELOG.md" <<'MD'
# Changelog

## [Unreleased]

### Added
- Placeholder for next release.
- A real unreleased feature.

## [1.9.1] - 2026-01-01

### Fixed
- Already released.

## [0.0.1] - 2020-01-01
MD
printf '1.9.0\n' > "$D/VERSION"
(cd "$D" && RELEASE_QUEUE_GATE=0 ./bump_version.sh --patch > /dev/null 2>&1)   # target 1.9.1 — already present
unrel=$(cd "$D" && sed -n '/^## \[Unreleased\]/,/^## \[1.9.1\]/p' CHANGELOG.md)
if printf '%s' "$unrel" | grep -q 'A real unreleased feature' \
   && [ "$(cd "$D" && grep -c '^## \[1.9.1\]' CHANGELOG.md)" = "1" ]; then
    ok "re-bumping an already-rotated version leaves [Unreleased] intact"
else
    bad "re-bumping an already-rotated version leaves [Unreleased] intact" "$unrel"
fi

# === 6. --dry-run must not modify anything ====================================
D=$(mktemp -d); make_fixture "$D" 1.9.0
before=$(cd "$D" && cat VERSION CHANGELOG.md)
(cd "$D" && RELEASE_QUEUE_GATE=0 ./bump_version.sh --patch --dry-run > /dev/null 2>&1)
after=$(cd "$D" && cat VERSION CHANGELOG.md)
[ "$before" = "$after" ] && ok "--dry-run leaves every carrier untouched" \
                         || bad "--dry-run leaves every carrier untouched"

# === 7. the release-queue gate (v1.15.0 retro) ================================
# A STUB `gh` on PATH, never the network: these cases must be hermetic, and a
# test that silently depends on a live GitHub query is the fake-green class this
# repo keeps paying for. The stub is what `gh issue list --jq` really returns:
# one line per open issue, EMPTY (not "[]") when the queue is clear.
stub_gh() {                      # $1 = fixture dir, $2 = stdout, $3 = exit code
    mkdir -p "$1/stubbin"
    cat > "$1/stubbin/gh" <<STUB
#!/bin/bash
printf '%s' "\$(cat <<'PAYLOAD'
$2
PAYLOAD
)"
exit $3
STUB
    chmod +x "$1/stubbin/gh"
}

# 7a. FAILING-FIRST: an open issue under release:vX.Y.Z must BLOCK the cut.
D=$(mktemp -d); make_fixture "$D" 1.9.0
stub_gh "$D" '  #70  Interview scheduling & calendar integration' 0
out=$(cd "$D" && PATH="$D/stubbin:$PATH" ./bump_version.sh --patch 2>&1); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q 'REFUSING to cut 1.9.1' \
   && printf '%s' "$out" | grep -q '#70' \
   && [ "$(tr -d '[:space:]' < "$D/VERSION")" = "1.9.0" ]; then
    ok "release-queue gate blocks a cut with an open release:vX.Y.Z issue (and writes nothing)"
else
    bad "release-queue gate blocks a cut with an open release:vX.Y.Z issue" "rc=$rc out=$out"
fi

# 7b. an EMPTY queue must let the cut through, and say it checked.
D=$(mktemp -d); make_fixture "$D" 1.9.0
stub_gh "$D" '' 0
out=$(cd "$D" && PATH="$D/stubbin:$PATH" ./bump_version.sh --patch 2>&1); rc=$?
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q "empty (checked)" \
   && [ "$(tr -d '[:space:]' < "$D/VERSION")" = "1.9.1" ]; then
    ok "release-queue gate passes on an empty queue and reports that it checked"
else
    bad "release-queue gate passes on an empty queue" "rc=$rc out=$out"
fi

# 7c. a FAILING query fails OPEN — but must never read as "the queue is empty".
D=$(mktemp -d); make_fixture "$D" 1.9.0
stub_gh "$D" '' 1                       # gh present, query fails (offline / unauthenticated)
out=$(cd "$D" && PATH="$D/stubbin:$PATH" ./bump_version.sh --patch 2>&1); rc=$?
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'UNVERIFIED' \
   && ! printf '%s' "$out" | grep -q 'empty (checked)'; then
    ok "release-queue gate fails OPEN on a failed query, and says UNVERIFIED not empty"
else
    bad "release-queue gate fails OPEN on a failed query" "rc=$rc out=$out"
fi

# 7d. the documented bypass really bypasses (it is the owner's de-scope path).
D=$(mktemp -d); make_fixture "$D" 1.9.0
stub_gh "$D" '  #70  Interview scheduling & calendar integration' 0
out=$(cd "$D" && PATH="$D/stubbin:$PATH" RELEASE_QUEUE_GATE=0 ./bump_version.sh --patch 2>&1); rc=$?
if [ $rc -eq 0 ] && [ "$(tr -d '[:space:]' < "$D/VERSION")" = "1.9.1" ]; then
    ok "RELEASE_QUEUE_GATE=0 cuts past a non-empty queue"
else
    bad "RELEASE_QUEUE_GATE=0 cuts past a non-empty queue" "rc=$rc out=$out"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "All bump_version cases passed."
