#!/usr/bin/env bash
# Self-test for check_changelog_merge.sh (#391). Runs in the pre-push gate and CI.
#
#   bash scripts/check_changelog_merge.test.sh              # behaviour cases
#   bash scripts/check_changelog_merge.test.sh --mutations  # + prove each check can FAIL
#
# The mutation contract neuters ONE check at a time in a COPY of the script and
# requires the matching case to go red (lessons-learned §59: a gate must be
# proven able to fail). A mutant whose needle no longer matches, or whose edit
# produces no diff, is reported INVALID and FAILS the run — a rotted needle is
# how #388 published a mutation result that did not reproduce.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check_changelog_merge.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ $# -gt 1 ] && echo "      $2"; }

T="$(mktemp -d "${TMPDIR:-/tmp}/chlogtest.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT

# --------------------------------------------------------------------------
# Fixtures for the file seam (--merged/--base)
# --------------------------------------------------------------------------
mkbase() { cat > "$T/base" <<'EOF'
# Changelog

## [Unreleased]

### Added
- base entry A

### Fixed
- base fix B

## [1.2.0] - 2026-01-02

### Added
- shipped thing

## [1.1.0] - 2026-01-01

### Fixed
- old fix
EOF
}

run() { bash "$1" --merged "$T/merged" --base "$T/base" >"$T/out" 2>&1; echo $?; }

# --- clean pass ------------------------------------------------------------
mkbase; cp "$T/base" "$T/merged"
cat >> /dev/null <<'EOF'
EOF
rc=$(run "$SCRIPT")
[ "$rc" = 0 ] && ok || bad "clean identical file should pass" "$(cat "$T/out")"

# additions-only merge passes
mkbase
sed 's/- base entry A/- base entry A\n- my new entry/' "$T/base" > "$T/merged"
rc=$(run "$SCRIPT")
[ "$rc" = 0 ] && ok || bad "additions-only merge should pass" "$(cat "$T/out")"

# --- check 1: duplicate [Unreleased] heading -------------------------------
mkbase
{ printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- x\n\n## [Unreleased]\n\n### Fixed\n- y\n\n'; sed -n '/^## \[1\.2\.0\]/,$p' "$T/base"; } > "$T/merged"
rc=$(run "$SCRIPT")
if [ "$rc" = 1 ] && grep -q "check 1" "$T/out"; then ok; else bad "check 1: two [Unreleased] headings must fail" "$(cat "$T/out")"; fi

# zero [Unreleased] in merged while base has one → check 1 fails
mkbase
sed '/^## \[Unreleased\]/d' "$T/base" > "$T/merged"
rc=$(run "$SCRIPT")
if [ "$rc" = 1 ] && grep -q "check 1" "$T/out"; then ok; else bad "check 1: [Unreleased] deleted by merge must fail" "$(cat "$T/out")"; fi

# no [Unreleased] on either side → note, pass
sed '/^## \[Unreleased\]/d' "$T/base" > "$T/base2"; mv "$T/base2" "$T/base"; cp "$T/base" "$T/merged"
rc=$(run "$SCRIPT")
if [ "$rc" = 0 ] && grep -q "note:" "$T/out"; then ok; else bad "no [Unreleased] on either side is a pass with a note" "$(cat "$T/out")"; fi

# --- check 2: duplicate ### heading inside [Unreleased] --------------------
mkbase
sed 's/### Fixed/### Added/' "$T/base" > "$T/merged"   # second ### Added
rc=$(run "$SCRIPT")
if [ "$rc" = 1 ] && grep -q 'check 2: duplicate heading.*### Added' "$T/out"; then ok
else bad "check 2: duplicate ### Added must fail" "$(cat "$T/out")"; fi

# a ### line inside a fence is content, not a heading
mkbase
python3 - "$T/base" "$T/merged" <<'PY'
import sys
t = open(sys.argv[1]).read()
t = t.replace("- base fix B", "- base fix B\n  ```\n  ### Added\n  ```")
open(sys.argv[2], "w").write(t)
cp = open(sys.argv[1], "w")  # base must contain the same lines or check 4 fires
cp.write(t)
PY
rc=$(run "$SCRIPT")
[ "$rc" = 0 ] && ok || bad "check 2: fenced ### line is content, must pass" "$(cat "$T/out")"

# --- check 3: released heading deleted by the merge (#365) -----------------
mkbase
sed '/^## \[1\.2\.0\]/d' "$T/base" > "$T/merged"
rc=$(run "$SCRIPT")
if [ "$rc" = 1 ] && grep -q 'check 3: released heading.*1\.2\.0' "$T/out"; then ok
else bad "check 3: deleted released heading must fail (#365)" "$(cat "$T/out")"; fi

# --- check 4: [Unreleased] content line lost -------------------------------
mkbase
sed '/- base entry A/d' "$T/base" > "$T/merged"
rc=$(run "$SCRIPT")
if [ "$rc" = 1 ] && grep -q 'check 4: .*base entry A' "$T/out"; then ok
else bad "check 4: lost [Unreleased] line must fail" "$(cat "$T/out")"; fi

# reordering sections passes (set semantics — the dedup fixer reorders)
mkbase
python3 - "$T/base" "$T/merged" <<'PY'
import sys, re
t = open(sys.argv[1]).read()
head, rest = t.split("## [1.2.0]", 1)
# swap the two ### sections inside [Unreleased]
head = head.replace("### Added\n- base entry A\n\n### Fixed\n- base fix B",
                    "### Fixed\n- base fix B\n\n### Added\n- base entry A")
open(sys.argv[2], "w").write(head + "## [1.2.0]" + rest)
PY
rc=$(run "$SCRIPT")
[ "$rc" = 0 ] && ok || bad "check 4: section reorder must pass (set semantics)" "$(cat "$T/out")"

# --------------------------------------------------------------------------
# End-to-end fixtures: a real throwaway repo through the real merge driver
# --------------------------------------------------------------------------
mkrepo() { # mkrepo <dir>
  git -c init.defaultBranch=main init -q "$1" && cd "$1" \
    && git config user.email t@t && git config user.name t && git config commit.gpgsign false
}
E="$T/e2e"; mkdir "$E"

# duplicate-heading collision: main and branch each add their own ### Added
( mkrepo "$E/r1"
  printf '# C\n\n## [Unreleased]\n\n### Fixed\n- f1\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- s\n' > CHANGELOG.md
  git add -A && git commit -qm base
  git checkout -qb feature
  printf '# C\n\n## [Unreleased]\n\n### Added\n- mine\n\n### Fixed\n- f1\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- s\n' > CHANGELOG.md
  git commit -aqm feat
  git checkout -q main
  printf '# C\n\n## [Unreleased]\n\n### Fixed\n- f1\n\n### Added\n- theirs\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- s\n' > CHANGELOG.md
  git commit -aqm mainadd
  git checkout -q feature
) >/dev/null 2>&1
out=$(cd "$E/r1" && bash "$SCRIPT" --against main 2>&1); rc=$?
if [ "$rc" = 1 ] && echo "$out" | grep -q 'check 2'; then ok
else bad "e2e: two branches adding their own ### Added must fail via the REAL merge" "$out"; fi

# same repo, branch rebased conceptually: branch adds under main's heading → pass
( cd "$E/r1" && git checkout -q main ) >/dev/null 2>&1
out=$(cd "$E/r1" && bash "$SCRIPT" --against main 2>&1); rc=$?
[ "$rc" = 0 ] && ok || bad "e2e: HEAD==REF must trivially pass" "$out"

# conflict case: both sides edit the same line differently
( mkrepo "$E/r2"
  printf '# C\n\n## [Unreleased]\n\n### Added\n- one entry here\n' > CHANGELOG.md
  git add -A && git commit -qm base
  git checkout -qb feature
  printf '# C\n\n## [Unreleased]\n\n### Added\n- one entry here CHANGED BY BRANCH\n' > CHANGELOG.md
  git commit -aqm feat
  git checkout -q main
  printf '# C\n\n## [Unreleased]\n\n### Added\n- one entry here CHANGED BY MAIN\n' > CHANGELOG.md
  git commit -aqm mainedit
  git checkout -q feature
) >/dev/null 2>&1
out=$(cd "$E/r2" && bash "$SCRIPT" --against main 2>&1); rc=$?
if [ "$rc" = 1 ] && echo "$out" | grep -qi 'conflict'; then ok
else bad "e2e: a conflicting merge must FAIL with the rebase-first message" "$out"; fi

# unobtainable ref → pass with a note (the gate's ALL polarity covers it)
out=$(cd "$E/r1" && bash "$SCRIPT" --against origin/nonexistent 2>&1); rc=$?
if [ "$rc" = 0 ] && echo "$out" | grep -q 'note:.*unobtainable'; then ok
else bad "unobtainable REF must skip with a note, not fail or pass silently" "$out"; fi

# not a git repository → pass with a note
out=$(cd "$T" && GIT_CEILING_DIRECTORIES="$T" bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" = 0 ] && echo "$out" | grep -q 'note:'; then ok
else bad "outside a repo must skip with a note" "$out"; fi

# --------------------------------------------------------------------------
# Mutation contract
# --------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  # A mutant is KILLED when the behaviour assertion for its check — rc=1 AND the
  # check's OWN message present — FAILS under the mutant (the suite notices the
  # neutering). If the assertion still holds, another code path is emitting the
  # message or the needle hit the wrong line: SURVIVED. This polarity matters:
  # this harness's first draft had it inverted, and rc-only assertions let
  # OVERLAPPING checks keep rc=1 so three neutered checks looked "killed".
  # Message-anchored assertions are what make each kill attributable.
  mutate() { # mutate <name> <needle> <replacement> <assert-fn>
    local name="$1" needle="$2" repl="$3" assertfn="$4"
    local M="$T/mut.sh"
    if ! grep -qF "$needle" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return
    fi
    python3 - "$SCRIPT" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
t = open(src).read()
open(dst, "w").write(t.replace(needle, repl, 1))
PY
    if cmp -s "$SCRIPT" "$M"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — edit produced no change"; return
    fi
    chmod +x "$M"
    if "$assertfn" "$SCRIPT" >/dev/null 2>&1; then :; else
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — its assertion does not even hold on the UNMODIFIED script"; return
    fi
    if "$assertfn" "$M" >/dev/null 2>&1; then
      SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: '$name' — the assertion still holds with the check removed"
    else
      KILLED=$((KILLED+1)); echo "  ✓ killed: $name"
    fi
  }
  # assert-fns: return 0 when the behaviour assertion HOLDS against script "$1"
  assert_check1() { mkbase
    { printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- x\n\n## [Unreleased]\n\n### Fixed\n- y\n\n'; sed -n '/^## \[1\.2\.0\]/,$p' "$T/base"; } > "$T/merged"
    [ "$(run "$1")" = 1 ] && grep -q 'check 1' "$T/out"; }
  assert_check2() { mkbase; sed 's/### Fixed/### Added/' "$T/base" > "$T/merged"
    [ "$(run "$1")" = 1 ] && grep -q 'check 2' "$T/out"; }
  assert_check3() { mkbase; sed '/^## \[1\.2\.0\]/d' "$T/base" > "$T/merged"
    [ "$(run "$1")" = 1 ] && grep -q 'check 3' "$T/out"; }
  assert_check4() { mkbase; sed '/- base entry A/d' "$T/base" > "$T/merged"
    [ "$(run "$1")" = 1 ] && grep -q 'check 4' "$T/out"; }
  assert_conflict() { local o; o=$(cd "$E/r2" && bash "$1" --against main 2>&1)
    [ $? = 1 ] && echo "$o" | grep -qi 'conflict'; }

  mutate "check 1 removed (duplicate [Unreleased] passes)" \
    'elif n_unrel != 1:' 'elif False:' assert_check1
  mutate "check 2 removed (duplicate ### heading passes)" \
    'if count > 1:' 'if False:' assert_check2
  mutate "check 3 removed (deleted released heading passes — the #365 case)" \
    'if RELEASED.match(l) and l not in merged_released:' 'if False:' assert_check3
  mutate "check 4 removed (lost [Unreleased] line passes)" \
    'if l.strip() and l.rstrip() not in merged_set:' 'if False:' assert_check4
  mutate "conflict deny removed (a CONFLICTING merge passes)" \
    'exit 1
elif [ "$MT_RC" -ne 0 ]; then' 'exit 0
elif [ "$MT_RC" -ne 0 ]; then' assert_conflict

  echo "check_changelog_merge mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || FAIL=$((FAIL+1))
fi

echo "check_changelog_merge self-test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
