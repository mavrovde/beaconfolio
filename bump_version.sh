#!/bin/bash
# bump_version.sh — bump the project version across EVERY version-carrying file,
# or verify that they all already agree (--check). See issue #172.
#
# Usage:
#   ./bump_version.sh [--patch|--minor|--major] [--dry-run]
#   ./bump_version.sh --check
#
# Version carriers (keep this list in sync with the --check block below):
#   VERSION                                          X.Y.Z + exactly one trailing newline
#   backend/app/main.py                              version="X.Y.Z"
#   frontend/package.json                            "version": "X.Y.Z"
#   frontend/package-lock.json                       synced via `npm install --package-lock-only`
#   frontend/projects/shared/package.json            "version": "X.Y.Z"
#   frontend/projects/public/src/app/version.ts      VERSION = 'X.Y.Z'
#   docker-compose.prod.yml                          ${IMAGE_TAG:-X.Y.Z} (4 services)
#   .env                                             IMAGE_TAG=X.Y.Z (local, gitignored — not checked)
set -euo pipefail

# Portable in-place sed (BSD/macOS vs GNU).
sedi() {
    if [[ "$OSTYPE" == darwin* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# --- Argument parsing ---
BUMP_TYPE="--patch"
DRY_RUN=0
CHECK=0
for arg in "$@"; do
    case "$arg" in
        --major|--minor|--patch) BUMP_TYPE="$arg" ;;
        --dry-run) DRY_RUN=1 ;;
        --check) CHECK=1 ;;
        *)
            echo "Usage: ./bump_version.sh [--patch|--minor|--major] [--dry-run]"
            echo "       ./bump_version.sh --check"
            exit 1
            ;;
    esac
done

# Read current version, tolerating a present-or-missing trailing newline.
current_version=$(tr -d '[:space:]' < VERSION)

# --- --check mode: every carrier must agree with VERSION; fail loudly naming
# --- the offending file and both values (#172). No files are modified.
if [ "$CHECK" -eq 1 ]; then
    failed=0

    fail() { # $1 = file, $2 = found value(s)
        echo "❌ VERSION MISMATCH: $1 carries '$2' but VERSION is '$current_version'"
        failed=1
    }

    # VERSION itself: exactly the version plus ONE trailing newline (no churn).
    if ! printf '%s\n' "$current_version" | cmp -s - VERSION; then
        echo "❌ VERSION file is not exactly '$current_version' + one trailing newline (run ./bump_version.sh once to normalize, or fix by hand)"
        failed=1
    fi

    # Anchored to the FastAPI app's `    version="X.Y.Z",` line: an unanchored
    # match also hits the seeded CvDocument literal `version="1.0.0-fallback"`
    # a few lines above (#186).
    v=$(sed -n 's/^    version="\([0-9.]*\)".*/\1/p' backend/app/main.py | head -1)
    [ "$v" = "$current_version" ] || fail "backend/app/main.py" "$v"

    v=$(sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' frontend/package.json | head -1)
    [ "$v" = "$current_version" ] || fail "frontend/package.json" "$v"

    v=$(sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' frontend/projects/shared/package.json | head -1)
    [ "$v" = "$current_version" ] || fail "frontend/projects/shared/package.json" "$v"

    v=$(sed -n "s/.*VERSION = '\([0-9.]*\)'.*/\1/p" frontend/projects/public/src/app/version.ts | head -1)
    [ "$v" = "$current_version" ] || fail "frontend/projects/public/src/app/version.ts" "$v"

    # package-lock.json: the two root "version" entries (top-level + packages[""]).
    v=$(grep -m2 '"version":' frontend/package-lock.json 2>/dev/null | sed 's/.*"version": "\([0-9.]*\)".*/\1/' | sort -u | tr '\n' ' ' | sed 's/ $//' || true)
    [ -n "$v" ] || { echo "❌ frontend/package-lock.json: no root \"version\" entry found (file moved or format changed?)"; failed=1; }
    [ "$v" = "$current_version" ] || fail "frontend/package-lock.json" "$v"

    # docker-compose.prod.yml: every ${IMAGE_TAG:-X.Y.Z} default.
    v=$(grep -o 'IMAGE_TAG:-[0-9.]*' docker-compose.prod.yml 2>/dev/null | cut -d- -f2 | sort -u | tr '\n' ' ' | sed 's/ $//' || true)
    [ -n "$v" ] || { echo "❌ docker-compose.prod.yml: no \${IMAGE_TAG:-X.Y.Z} default found (file moved or format changed?)"; failed=1; }
    [ "$v" = "$current_version" ] || fail "docker-compose.prod.yml" "$v"

    if [ "$failed" -ne 0 ]; then
        echo "❌ Version consistency check FAILED (expected all carriers = $current_version)"
        exit 1
    fi
    echo "✅ Version consistency check PASSED: all carriers = $current_version"
    exit 0
fi

# --- Compute the new version ---
IFS='.' read -r major minor patch <<< "$current_version"

if [[ "$BUMP_TYPE" == "--major" ]]; then
    new_version="$((major + 1)).0.0"
elif [[ "$BUMP_TYPE" == "--minor" ]]; then
    new_version="$major.$((minor + 1)).0"
else
    new_version="$major.$minor.$((patch + 1))"
fi

echo "Bumping version ($BUMP_TYPE): $current_version -> $new_version"

# --- Release-queue gate (v1.15.0 retro) ---------------------------------------
# `release-manager.md` step 1 has said "NEVER cut the release PR while issues
# planned under release:vX.Y.Z are still open" since the v1.14.3 revert cost two
# PRs and a rule-13 violation. v1.15.0 was cut anyway — not by overriding that
# paragraph but by never RUNNING the query: the release was assembled from what
# `[Unreleased]` happened to contain, and the OWNER, not any gate, found #70,
# #265 and #386 still labelled `release:v1.15.0` afterwards. A rule that is only
# prose is not a control (lessons §30: assert at the layer that can enforce), so
# the bump asks GitHub at the moment the version actually moves.
#
# Fails OPEN and says so when `gh` is missing, unauthenticated or offline — a
# release must never be blocked by a network hiccup, but "I could not check" must
# never read as "the queue is empty". Skip a deliberate, owner-de-scoped cut with
# RELEASE_QUEUE_GATE=0 (named, like PR_MERGE_GATE=0, so it is visible in history).
if [ "${RELEASE_QUEUE_GATE:-1}" != "0" ]; then
    queue_label="release:v$new_version"
    if ! command -v gh > /dev/null 2>&1; then
        echo "WARNING: gh not found — release queue for '$queue_label' UNVERIFIED (not empty; unchecked)." >&2
    elif ! queue=$(gh issue list --label "$queue_label" --state open --limit 100 \
                       --json number,title --jq '.[] | "  #\(.number)  \(.title)"' 2>/dev/null); then
        echo "WARNING: could not query GitHub — release queue for '$queue_label' UNVERIFIED (not empty; unchecked)." >&2
    elif [ -n "$queue" ]; then
        echo "REFUSING to cut $new_version: issues are still open under '$queue_label':" >&2
        printf '%s\n' "$queue" >&2
        echo >&2
        echo "De-scope them one by one (move the label to the next release) or, if the owner" >&2
        echo "has explicitly de-scoped them, re-run with RELEASE_QUEUE_GATE=0." >&2
        exit 1
    else
        echo "Release queue for '$queue_label': empty (checked)."
    fi
fi

# --- Previous-release retrospective report (v1.15.1 retro) --------------------
# Rule 8 makes the retrospective a release STEP, not an optional extra — "a
# release is finished when what it taught is written down, not when the tag is
# pushed". Measured: v1.15.0 and v1.15.1 BOTH tagged, closed their issues and ran
# the release-time security check without producing
# docs/retrospectives/vX.Y.Z.md, and #446's own release verdict said so in
# writing ("the v1.15.0 /retro remains outstanding and is a mandatory release
# step in its own right") and shipped anyway. Two prose reminders in two
# consecutive cuts produced zero retrospectives; the release-queue gate sitting
# three lines above produced two `empty (checked)` lines in two release PR
# bodies. So this is the same finding as the queue gate's, one step later —
# assert at the layer that can enforce (lessons §30).
#
# REPORTS, never refuses. A missing retrospective must not block a hotfix, and
# the retro for release N is legitimately written after N is cut. What it must
# not do is be INVISIBLE: the line lands in the cut's output and therefore in the
# release PR body, where the merge reviewer reads it. RELEASE_RETRO_GATE=0
# silences it (named, like RELEASE_QUEUE_GATE=0/PR_MERGE_GATE=0, so a deliberate
# skip is visible in history rather than indistinguishable from a passing check).
if [ "${RELEASE_RETRO_GATE:-1}" != "0" ]; then
    prev_retro="docs/retrospectives/v$current_version.md"
    if [ -f "$prev_retro" ]; then
        echo "Previous release retrospective ($prev_retro): present."
    else
        echo "WARNING: previous release retrospective MISSING ($prev_retro)." >&2
        echo "Rule 8 makes it a release step. Run /retro for v$current_version, or re-run with" >&2
        echo "RELEASE_RETRO_GATE=0 if this cut is deliberately ahead of it." >&2
    fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
    echo "Dry run — no files modified. Would update:"
    echo "  VERSION"
    echo "  backend/app/main.py"
    echo "  frontend/package.json (+ package-lock.json sync)"
    echo "  frontend/projects/shared/package.json"
    echo "  frontend/projects/public/src/app/version.ts"
    echo "  docker-compose.prod.yml"
    echo "  .env (IMAGE_TAG)"
    echo "  CHANGELOG.md (rotate [Unreleased])"
    exit 0
fi

# Update VERSION file — always exactly one trailing newline (idempotent, #172).
printf '%s\n' "$new_version" > VERSION

# Update backend/app/main.py
sedi "s/^    version=\"[0-9.]*\"/    version=\"$new_version\"/" backend/app/main.py

# Update frontend/package.json
sedi "s/\"version\": \"[0-9.]*\"/\"version\": \"$new_version\"/" frontend/package.json

# Update frontend/projects/shared/package.json (was missed for 4 releases, #172)
sedi "s/\"version\": \"[0-9.]*\"/\"version\": \"$new_version\"/" frontend/projects/shared/package.json

# Update frontend/projects/public/src/app/version.ts
sedi "s/VERSION = '.*';/VERSION = '$new_version';/" frontend/projects/public/src/app/version.ts

# Update docker-compose.prod.yml image tag defaults (all 4 services).
# Previously done only in release.sh (with macOS-only sed) — owned here now so a
# standalone bump keeps every tracked carrier in sync.
sedi "s|\${IMAGE_TAG:-[0-9.]*}|\${IMAGE_TAG:-$new_version}|g" docker-compose.prod.yml

# Update .env IMAGE_TAG (local, gitignored)
if [ -f .env ]; then
    if grep -q "^IMAGE_TAG=" .env; then
        sedi "s/^IMAGE_TAG=.*/IMAGE_TAG=$new_version/" .env
    else
        echo "IMAGE_TAG=$new_version" >> .env
    fi
else
    echo "IMAGE_TAG=$new_version" > .env
fi

# Sync package-lock.json with updated package.json
echo "Syncing frontend/package-lock.json..."
(cd frontend && npm install --package-lock-only --legacy-peer-deps > /dev/null 2>&1) \
    || { echo "❌ package-lock.json sync failed — run 'npm install --package-lock-only' in frontend/ to see why"; exit 1; }
echo "package-lock.json synced."

# Rotate CHANGELOG.md: insert the new release header under [Unreleased].
echo "Rotating CHANGELOG.md headers..."
today=$(date +%Y-%m-%d)
# Rotation is done in three explicit steps so it can never split a real list.
# The old placeholder-anchored regex inserted the new header immediately after
# "- Placeholder for next release.", which lands MID-LIST whenever [Unreleased]
# has real "### Added" bullets after the stub (#186).
#
# 1. Drop the placeholder bullet from inside the [Unreleased] block (if present).
perl -0777 -pi -e "s/(## \[Unreleased\]\n(?:(?!\n## \[).)*?)- Placeholder for next release\.\n/\$1/s" CHANGELOG.md
# 2. Drop an "### Added" heading left empty by step 1 (heading followed only by
#    blank lines and then another heading), again only inside [Unreleased].
perl -0777 -pi -e "s/(## \[Unreleased\]\n(?:(?!\n## \[).)*?)### Added\n+(?=###|## \[)/\$1/s" CHANGELOG.md
# 3. Insert the dated release header directly under [Unreleased] with a fresh
#    stub, so everything that was unreleased moves wholesale into the release.
if ! grep -q "^## \[$new_version\]" CHANGELOG.md; then
    perl -pi -e "s/^## \[Unreleased\]/## [Unreleased]\n\n### Added\n- Placeholder for next release.\n\n## [$new_version] - $today/" CHANGELOG.md
fi

echo "Version updated to $new_version"
echo "Ready for verification and tagging."
