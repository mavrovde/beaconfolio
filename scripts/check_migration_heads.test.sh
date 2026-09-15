#!/usr/bin/env bash
# Self-test for scripts/check_migration_heads.sh.
#
# The house rule (lessons §18, §16): a gate that has never been observed to fail
# is indistinguishable from a gate that cannot fail. So every case here asserts a
# DIRECTION, the negative cases outnumber the positive ones, and the last case
# replays the real #323/#325 fork out of this repository's own history.
#
# CASE COUNT DIFFERS BY ENVIRONMENT, and that is deliberate: **26 locally, 23 in
# CI**. `actions/checkout` clones at depth 1, so the three real-history cases
# cannot resolve `aef2938`/`2cf326f` and skip with a printed `~ skipped:` line
# rather than failing. The contract they illustrate is fully covered by the
# synthetic `--against` fixtures, so buying them back with `fetch-depth: 0` would
# cost a full clone on every run for no additional coverage. Stated here because a
# self-test that quietly reports a different number in CI is exactly the kind of
# unexplained gap this suite exists to catch. The MIN_CASES floor at the bottom
# makes that note enforceable rather than descriptive (#329 review, nit 8).
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="$SCRIPT_DIR/check_migration_heads.sh"

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  ✗ %s\n' "$1"; }

# run <expected-rc> <description> -- <args…>   (working dir: a scratch versions dir)
expect_rc() {
  local want="$1" desc="$2"; shift 2
  local out rc
  out="$("$CHECKER" "$@" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ]; then ok "$desc"
  else bad "$desc — expected rc=$want, got rc=$rc"; printf '%s\n' "$out" | sed 's/^/      /'; fi
}

expect_output() {
  local pattern="$1" desc="$2"; shift 2
  local out
  out="$("$CHECKER" "$@" 2>&1)"
  if printf '%s' "$out" | grep -q "$pattern"; then ok "$desc"
  else bad "$desc — output did not contain '$pattern'"; printf '%s\n' "$out" | sed 's/^/      /'; fi
}

mig() { # mig <dir> <revision> <down_revision-literal>
  cat > "$1/${2}_x.py" <<EOF
"""Some migration.

revision. It creates things — this sentence must NOT be read as an assignment.
"""

revision: str = "$2"
down_revision: str | None = $3
EOF
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== working-tree checks =="

A="$TMP/linear"; mkdir -p "$A"
mig "$A" baseline0001 None
mig "$A" second0002 '"baseline0001"'
mig "$A" third0003 '"second0002"'
expect_rc 0 "a linear chain has exactly one head" --dir "$A"
expect_output "3 revisions" "the pass line reports the revision count" --dir "$A"

B="$TMP/forked"; mkdir -p "$B"
mig "$B" baseline0001 None
mig "$B" left0002 '"baseline0001"'
mig "$B" right0002 '"baseline0001"'
expect_rc 1 "two children of one parent are two heads (FAILING-FIRST: this is the #325 shape)" --dir "$B"
expect_output "left0002" "the failure names the first head" --dir "$B"
expect_output "right0002" "the failure names the second head" --dir "$B"
expect_output "docker-entrypoint" "the failure explains WHY it is a boot failure, not a lint opinion" --dir "$B"

C="$TMP/merge"; mkdir -p "$C"
mig "$C" baseline0001 None
mig "$C" left0002 '"baseline0001"'
mig "$C" right0002 '"baseline0001"'
mig "$C" merge0003 '("left0002", "right0002")'
expect_rc 0 "an alembic MERGE revision (tuple down_revision) rejoins two heads" --dir "$C"

D="$TMP/orphan"; mkdir -p "$D"
mig "$D" baseline0001 None
mig "$D" second0002 '"typo0001"'
expect_rc 1 "a down_revision naming a revision that does not exist fails" --dir "$D"
expect_output "unknown parent" "the orphan failure says which parent is missing" --dir "$D"

E="$TMP/single"; mkdir -p "$E"
mig "$E" baseline0001 None
expect_rc 0 "a single baseline revision is one head" --dir "$E"

F="$TMP/empty"; mkdir -p "$F"
expect_rc 1 "an empty versions directory fails rather than reporting success" --dir "$F"

expect_rc 1 "a missing versions directory fails" --dir "$TMP/does-not-exist"

G="$TMP/quotes"; mkdir -p "$G"
cat > "$G/a.py" <<'EOF'
revision: str = 'single0001'
down_revision: str | None = None
EOF
cat > "$G/b.py" <<'EOF'
revision = "second0002"
down_revision = 'single0001'
EOF
expect_rc 0 "single quotes and un-annotated assignments parse" --dir "$G"

H="$TMP/docstring"; mkdir -p "$H"
cat > "$H/a.py" <<'EOF'
"""Baseline.

revision = "not-an-assignment-it-is-prose"
down_revision = "also prose"
"""

revision: str = "real0001"
down_revision: str | None = None
EOF
expect_rc 0 "prose inside a docstring is not read as an assignment" --dir "$H"

echo "== --against (the union with the branch's base) =="

# The whole point of the mode: each side alone is single-head, the union is not.
BASE_REPO="$TMP/repo"
mkdir -p "$BASE_REPO/backend/migrations/versions"
(
  cd "$BASE_REPO" || exit 1
  git init -q .
  git config user.email t@example.com
  git config user.name t
  mig "$BASE_REPO/backend/migrations/versions" baseline0001 None
  mig "$BASE_REPO/backend/migrations/versions" trans0009 '"baseline0001"'
  git add -A && git commit -qm base
  mig "$BASE_REPO/backend/migrations/versions" tailored0010 '"trans0009"'
  git add -A && git commit -qm "the other PR landed first"
) >/dev/null 2>&1

# The branch as it really looks: it was cut BEFORE the other PR landed, so it
# carries the whole chain up to the shared parent and its own new revision —
# and no trace of the sibling that is about to collide with it.
BRANCH="$TMP/branch-versions"; mkdir -p "$BRANCH"
mig "$BRANCH" baseline0001 None
mig "$BRANCH" trans0009 '"baseline0001"'
mig "$BRANCH" engage0010 '"trans0009"'
CLAUDE_PROJECT_DIR="$BASE_REPO" expect_rc 0 \
  "the branch's own tree is single-head — which is exactly why the branch gates were green" --dir "$BRANCH"
CLAUDE_PROJECT_DIR="$BASE_REPO" expect_rc 1 \
  "UNIONED with the base that moved, the same tree is two heads (FAILING-FIRST)" --dir "$BRANCH" --against HEAD
# Assert something ONLY the failure emits (#329 review, minor 5): the success
# line also ends "(working tree unioned with HEAD)", so matching that phrase
# survived the head-count mutation while its neighbours died — a case that
# cannot fail is worse than no case (lessons §16/§18).
CLAUDE_PROJECT_DIR="$BASE_REPO" expect_output "expected exactly 1 head" \
  "the union failure says how many heads it found" --dir "$BRANCH" --against HEAD
CLAUDE_PROJECT_DIR="$BASE_REPO" expect_output "unioned with HEAD" \
  "…and that it measured the MERGED result, not the branch alone" --dir "$BRANCH" --against HEAD

BRANCH_FIXED="$TMP/branch-fixed"; mkdir -p "$BRANCH_FIXED"
mig "$BRANCH_FIXED" engage0010 '"tailored0010"'
CLAUDE_PROJECT_DIR="$BASE_REPO" expect_rc 0 \
  "re-chaining onto the other head resolves the union" --dir "$BRANCH_FIXED" --against HEAD

# The working tree must WIN on a revision id both sides carry, or a branch that
# RE-CHAINS an already-pushed revision would still be reported as forked and the
# fix would be unmergeable. This fixture is the hotfix shape: the fork is already
# on the base, and the branch repoints exactly the one revision.
FORKED_REPO="$TMP/repo-forked"
mkdir -p "$FORKED_REPO/backend/migrations/versions"
(
  cd "$FORKED_REPO" || exit 1
  git init -q .
  git config user.email t@example.com
  git config user.name t
  V="$FORKED_REPO/backend/migrations/versions"
  mig "$V" baseline0001 None
  mig "$V" trans0009 '"baseline0001"'
  mig "$V" tailored0010 '"trans0009"'
  mig "$V" engage0010 '"trans0009"'   # the fork, already on the base
  git add -A && git commit -qm "the fork reached the base branch"
) >/dev/null 2>&1

BRANCH_RECHAIN="$TMP/branch-rechain"; mkdir -p "$BRANCH_RECHAIN"
mig "$BRANCH_RECHAIN" engage0010 '"tailored0010"'   # the branch's one-line fix
CLAUDE_PROJECT_DIR="$FORKED_REPO" expect_rc 0 \
  "on a conflicting revision id the WORKING TREE wins over the ref (the fix must be mergeable)" \
  --dir "$BRANCH_RECHAIN" --against HEAD
CLAUDE_PROJECT_DIR="$FORKED_REPO" expect_rc 1 \
  "…and that base, measured on its own, really is forked (so the case above discriminates)" \
  --dir "$FORKED_REPO/backend/migrations/versions"

CLAUDE_PROJECT_DIR="$BASE_REPO" expect_rc 1 \
  "an unresolvable --against ref fails closed" --dir "$BRANCH_FIXED" --against no/such/ref

echo "== the real incident, replayed from this repository's history =="

if git -C "$ROOT" cat-file -e aef2938:backend/migrations/versions/engage0010_engagement_events.py 2>/dev/null \
   && git -C "$ROOT" rev-parse --verify --quiet 2cf326f >/dev/null 2>&1; then
  REAL="$TMP/real"; mkdir -p "$REAL"
  git -C "$ROOT" show aef2938:backend/migrations/versions/engage0010_engagement_events.py \
    > "$REAL/engage0010_engagement_events.py"
  expect_rc 1 "#325's real pre-fix head, unioned with the real main that #323 had just moved" \
    --dir "$REAL" --against 2cf326f
  expect_output "tailored0010" "…and it names #323's revision as the colliding head" \
    --dir "$REAL" --against 2cf326f

  REALFIX="$TMP/realfix"; mkdir -p "$REALFIX"
  git -C "$ROOT" show 9d6afcb:backend/migrations/versions/engage0010_engagement_events.py \
    > "$REALFIX/engage0010_engagement_events.py"
  expect_rc 0 "#325's real FIX commit passes the same union" --dir "$REALFIX" --against 2cf326f
else
  printf '  ~ skipped: the #323/#325 commits are not in this clone\n'
fi

echo "== the repository as it stands =="
expect_rc 0 "the committed migration chain has exactly one head"

# ---------------------------------------------------------------------------
# Mutation contract (#393): neuter ONE arm of the checker at a time in a COPY
# and require the pinned case to go red. Reuses the fixtures built above.
# INVALID (rotted needle / no diff / unparseable / assertion false on the
# unmodified script) counts separately and fails the run (#388).
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  MDIR="$(mktemp -d)"
  mutate() { # name needle replacement assert-fn
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$MDIR/mut.sh"
    python3 - "$CHECKER" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
t = open(src).read()
if needle not in t:
    sys.exit(3)
open(dst, "w").write(t.replace(needle, repl, 1))
PY
    case $? in 3) INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return ;; esac
    cmp -s "$CHECKER" "$M" && { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — no change"; return; }
    bash -n "$M" 2>/dev/null || { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — not parseable"; return; }
    chmod +x "$M"
    if ! "$assertfn" "$CHECKER"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — assertion fails on the UNMODIFIED script"; return
    fi
    if "$assertfn" "$M"; then
      SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: '$name' — the case stays green with the arm removed"
    else
      KILLED=$((KILLED+1)); echo "  ✓ killed: $name"
    fi
  }
  assert_fork() { local o; o="$("$1" --dir "$B" 2>&1)"
    [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'expected exactly 1 head'; }
  assert_orphan() { local o; o="$("$1" --dir "$D" 2>&1)"
    [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'unknown parent'; }
  assert_empty() { "$1" --dir "$F" 2>&1 | grep -q 'no revisions found'; }
  assert_anchor() { local o; o="$("$1" --dir "$A" 2>&1)"
    [ $? -eq 0 ] && printf '%s' "$o" | grep -q 'exactly one head'; }
  assert_union() { local o; o="$(CLAUDE_PROJECT_DIR="$BASE_REPO" "$1" --dir "$BRANCH" --against HEAD 2>&1)"
    [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'expected exactly 1 head'; }
  assert_worktree_wins() { CLAUDE_PROJECT_DIR="$FORKED_REPO" "$1" --dir "$BRANCH_RECHAIN" --against HEAD >/dev/null 2>&1; }
  assert_badref() { CLAUDE_PROJECT_DIR="$BASE_REPO" "$1" --dir "$BRANCH_FIXED" --against no/such/ref 2>&1 \
    | grep -q 'cannot resolve git ref'; }

  mutate "multi-head arm removed (the #325 fork passes)" \
    'if [ "${HEAD_COUNT:-0}" != "1" ]; then' 'if false; then' assert_fork
  mutate "orphan arm removed (a down_revision to nowhere passes)" \
    'if [ -n "$ORPHANS" ]; then' 'if false; then' assert_orphan
  mutate "empty-directory guard removed (zero revisions has no verdict of its own)" \
    'if [ ! -s "$TMP/edges" ]; then' 'if false; then' assert_empty
  mutate "column-0 anchor dropped (down_revision lines are consumed as revision lines)" \
    '/^revision[[:space:]]*(:[^=]*)?=/' '/revision[[:space:]]*(:[^=]*)?=/' assert_anchor
  mutate "union with the base removed (--against silently becomes worktree-only)" \
    '[ -n "$AGAINST" ] && collect_ref "$AGAINST"' ':' assert_union
  mutate "collection order reversed (the ref beats the worktree — a re-chain fix is unmergeable)" \
    '[ -n "$AGAINST" ] && collect_ref "$AGAINST"
collect_worktree' 'collect_worktree
[ -n "$AGAINST" ] && collect_ref "$AGAINST"' assert_worktree_wins
  mutate "ref resolution check removed (a typo ref fails without saying why)" \
    'git -C "$ROOT" rev-parse --verify --quiet "$ref^{commit}" >/dev/null 2>&1 || {' \
    'true || {' assert_badref

  rm -rf "$MDIR"
  echo "check_migration_heads mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fail=$((fail+1))
fi

printf '\nmigration-heads self-test: %d passed, %d failed\n' "$pass" "$fail"

# A FLOOR on the case count (#329 review, nit 8). Without it a suite that skipped
# everything would exit 0 and the "25 local / 22 CI" note above would be
# descriptive rather than enforceable. 22 is the CI figure — the three
# real-history cases cannot run in a depth-1 clone.
MIN_CASES=23
if [ "$pass" -lt "$MIN_CASES" ]; then
  printf '  ✗ only %d cases ran; expected at least %d — did the harness skip?\n' "$pass" "$MIN_CASES"
  fail=$((fail+1))
fi

[ "$fail" -eq 0 ]
