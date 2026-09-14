#!/usr/bin/env bash
# Self-test for audit_no_verdict_merges.sh (#392). Runs in the pre-push gate + CI.
#
#   bash scripts/audit_no_verdict_merges.test.sh              # behaviour cases
#   bash scripts/audit_no_verdict_merges.test.sh --mutations  # prove it can fail
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/audit_no_verdict_merges.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ $# -gt 1 ] && echo "      $2"; }

T="$(mktemp -d "${TMPDIR:-/tmp}/vaudit.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT

fix() { mkdir -p "$T/$1"; }
pr()  { cat > "$T/$1/$2.json"; }  # pr <fixture> <n>  (json on stdin)

run() { bash "$SCRIPT" --fixture "$T/$1" >"$T/out" 2>&1; echo $?; }

# --- a comment verdict counts (same-identity repos post comment verdicts) ----
fix clean
pr clean 10 <<'EOF'
{"number":10,"title":"good pr","reviews":[],
 "comments":[{"body":"## ✅ APPROVE — round 1 (at abc1234)\n\nAll criteria verified."}]}
EOF
rc=$(run clean)
[ "$rc" = 0 ] && ok || bad "a comment whose first line carries APPROVE must count" "$(cat "$T/out")"

# --- a review verdict counts -------------------------------------------------
fix review
pr review 11 <<'EOF'
{"number":11,"title":"reviewed pr",
 "reviews":[{"body":"## ⛔ REQUEST CHANGES — round 1\n\nblockers follow"}],"comments":[]}
EOF
rc=$(run review)
[ "$rc" = 0 ] && ok || bad "a review body verdict must count" "$(cat "$T/out")"

# --- zero verdicts → red, PR named (#321/#355 shape) --------------------------
fix none
pr none 321 <<'EOF'
{"number":321,"title":"chore(deps): bump alembic","reviews":[],
 "comments":[{"body":"Superseded by #331."}]}
EOF
rc=$(run none)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; then ok
else bad "a merged PR with zero verdicts must go red and be named" "$(cat "$T/out")"; fi

# --- the marker must be on the FIRST non-empty line, not anywhere ------------
fix buried
pr buried 12 <<'EOF'
{"number":12,"title":"fix report only","reviews":[],
 "comments":[{"body":"All four blockers fixed.\n\nThe reviewer can now APPROVE at the new head."}]}
EOF
rc=$(run buried)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #12" "$T/out"; then ok
else bad "APPROVE buried mid-body must NOT count (position is the convention)" "$(cat "$T/out")"; fi

# --- leading blank lines are skipped to find the first non-empty line --------
fix blanks
pr blanks 13 <<'EOF'
{"number":13,"title":"verdict after blank lines","reviews":[],
 "comments":[{"body":"\n\n## ✅ APPROVE — round 2 (delta-confirm at fff0000)\nbody"}]}
EOF
rc=$(run blanks)
[ "$rc" = 0 ] && ok || bad "leading blank lines must be skipped, not counted as line 1" "$(cat "$T/out")"

# --- mixed fixture: one clean + one dirty → red, only the dirty named --------
fix mixed
pr mixed 20 <<'EOF'
{"number":20,"title":"good","reviews":[],"comments":[{"body":"## ✅ APPROVE — round 1"}]}
EOF
pr mixed 21 <<'EOF'
{"number":21,"title":"bad","reviews":[],"comments":[{"body":"merged for reasons"}]}
EOF
rc=$(run mixed)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #21" "$T/out" && ! grep -q "#20" "$T/out"; then ok
else bad "mixed fixture must name exactly the dirty PR" "$(cat "$T/out")"; fi

# --- empty fixture dir → CANNOT MEASURE (2), never green ----------------------
fix empty
rc=$(run empty)
[ "$rc" = 2 ] && ok || bad "an empty fixture must be 'cannot measure' (2), never green" "$(cat "$T/out")"

# --------------------------------------------------------------------------
# Mutation contract — killed = the case's assertion FAILS under the mutant
# --------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  mutate() { # <name> <needle> <replacement> <assert-fn>  (assert holds on real script)
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$T/mut.sh"
    if ! grep -qF "$needle" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return
    fi
    python3 - "$SCRIPT" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
open(dst, "w").write(open(src).read().replace(needle, repl, 1))
PY
    cmp -s "$SCRIPT" "$M" && { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — no change"; return; }
    chmod +x "$M"
    if ! "$assertfn" "$SCRIPT" >/dev/null 2>&1; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — assertion fails on the UNMODIFIED script"; return
    fi
    if "$assertfn" "$M" >/dev/null 2>&1; then
      SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: '$name'"
    else
      KILLED=$((KILLED+1)); echo "  ✓ killed: $name"
    fi
  }
  runm() { bash "$1" --fixture "$T/$2" >"$T/out" 2>&1; echo $?; }
  assert_red_on_none()   { [ "$(runm "$1" none)" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; }
  assert_red_on_buried() { [ "$(runm "$1" buried)" = 1 ] && grep -q "NO-VERDICT" "$T/out"; }
  assert_empty_is_2()    { [ "$(runm "$1" empty)" = 2 ]; }

  mutate "the red exit is neutered (a no-verdict merge reports green)" \
    'exit "$DIRTY"
fi' 'exit 0
fi' assert_red_on_none
  mutate "the first-line filter widens to the whole body (a fix report counts as a verdict)" \
    '| first // ""' '| join("\\n")' assert_red_on_buried
  mutate "the marker test matches everything" \
    'any(test("APPROVE|REQUEST CHANGES"))' 'any(test(""))' assert_red_on_none
  mutate "an empty window reports green instead of cannot-measure" \
    'fixture dir empty — cannot measure" >&2; exit 2; }' \
    'fixture dir empty — cannot measure" >&2; exit 0; }' assert_empty_is_2

  echo "audit_no_verdict mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || FAIL=$((FAIL+1))
fi

echo "audit_no_verdict self-test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
