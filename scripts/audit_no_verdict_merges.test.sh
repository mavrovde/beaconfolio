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
 "comments":[{"authorAssociation":"OWNER","body":"## ✅ APPROVE — round 1 (at abc1234)\n\nAll criteria verified."}]}
EOF
rc=$(run clean)
[ "$rc" = 0 ] && ok || bad "a comment whose first line carries APPROVE must count" "$(cat "$T/out")"

# --- a review verdict counts -------------------------------------------------
fix review
pr review 11 <<'EOF'
{"number":11,"title":"reviewed pr",
 "reviews":[{"authorAssociation":"OWNER","body":"## ⛔ REQUEST CHANGES — round 1\n\nblockers follow"}],"comments":[]}
EOF
rc=$(run review)
[ "$rc" = 0 ] && ok || bad "a review body verdict must count" "$(cat "$T/out")"

# --- zero verdicts → red, PR named (#321/#355 shape) --------------------------
fix none
pr none 321 <<'EOF'
{"number":321,"title":"chore(deps): bump alembic","reviews":[],
 "comments":[{"authorAssociation":"OWNER","body":"Superseded by #331."}]}
EOF
rc=$(run none)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; then ok
else bad "a merged PR with zero verdicts must go red and be named" "$(cat "$T/out")"; fi

# --- the marker must be on the FIRST non-empty line, not anywhere ------------
fix buried
pr buried 12 <<'EOF'
{"number":12,"title":"fix report only","reviews":[],
 "comments":[{"authorAssociation":"OWNER","body":"All four blockers fixed.\n\nThe reviewer can now APPROVE at the new head."}]}
EOF
rc=$(run buried)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #12" "$T/out"; then ok
else bad "APPROVE buried mid-body must NOT count (position is the convention)" "$(cat "$T/out")"; fi

# --- leading blank lines are skipped to find the first non-empty line --------
fix blanks
pr blanks 13 <<'EOF'
{"number":13,"title":"verdict after blank lines","reviews":[],
 "comments":[{"authorAssociation":"OWNER","body":"\n\n## ✅ APPROVE — round 2 (delta-confirm at fff0000)\nbody"}]}
EOF
rc=$(run blanks)
[ "$rc" = 0 ] && ok || bad "leading blank lines must be skipped, not counted as line 1" "$(cat "$T/out")"

# --- an UNTRUSTED author's APPROVE must NOT silence the alarm (#316 rule) ----
fix untrusted
pr untrusted 14 <<'EOF'
{"number":14,"title":"drive-by approval","reviews":[],
 "comments":[{"authorAssociation":"NONE","body":"## ✅ APPROVE — looks great!"}]}
EOF
rc=$(run untrusted)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #14" "$T/out"; then ok
else bad "a NONE-association APPROVE must not count (the #316 hole)" "$(cat "$T/out")"; fi

# --- case-insensitive heading counts (mirrors the gate's "i" flag) -----------
fix lowercase
pr lowercase 15 <<'EOF'
{"number":15,"title":"lowercase verdict","reviews":[],
 "comments":[{"authorAssociation":"MEMBER","body":"## Round 3 — ✅ approved\nall clear"}]}
EOF
rc=$(run lowercase)
[ "$rc" = 0 ] && ok || bad "a lowercase 'approved' first line must count (gate parity)" "$(cat "$T/out")"

# --- mixed fixture: one clean + one dirty → red, only the dirty named --------
fix mixed
pr mixed 20 <<'EOF'
{"number":20,"title":"good","reviews":[],"comments":[{"authorAssociation":"OWNER","body":"## ✅ APPROVE — round 1"}]}
EOF
pr mixed 21 <<'EOF'
{"number":21,"title":"bad","reviews":[],"comments":[{"authorAssociation":"OWNER","body":"merged for reasons"}]}
EOF
rc=$(run mixed)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #21" "$T/out" && ! grep -q "#20" "$T/out"; then ok
else bad "mixed fixture must name exactly the dirty PR" "$(cat "$T/out")"; fi

# --- empty fixture dir → CANNOT MEASURE (2), never green ----------------------
fix empty
rc=$(run empty)
[ "$rc" = 2 ] && ok || bad "an empty fixture must be 'cannot measure' (2), never green" "$(cat "$T/out")"

# --------------------------------------------------------------------------
# LIVE-PATH cases via a gh stub (#399 review, blocker 2): the live branch is
# the only one the workflow runs, and its first draft returned rc=0 — a quiet
# green — on a Bad-Credentials object, empty stdout, and truncation. Every
# "cannot measure" must be rc=2 and loud.
# --------------------------------------------------------------------------
GSTUB="$T/gstub"; mkdir -p "$GSTUB"
cat > "$GSTUB/gh" <<'GHEOF'
#!/usr/bin/env bash
case "$*" in
  "pr list"*) printf '%s' "${GH_FAKE_LIST-}" ;;
  "pr view"*) printf '%s' "${GH_FAKE_PR-}" ;;
esac
GHEOF
chmod +x "$GSTUB/gh"
live() { PATH="$GSTUB:$PATH" GH_FAKE_LIST="$1" GH_FAKE_PR="${2-}" bash "$SCRIPT" ${3-} >"$T/out" 2>&1; echo $?; }

rc=$(live '{"message":"Bad credentials"}')
if [ "$rc" = 2 ] && grep -q "not the expected array" "$T/out"; then ok
else bad "live: a Bad-Credentials object must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"; fi

rc=$(live '')
[ "$rc" = 2 ] && ok || bad "live: empty gh output must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"

rc=$(live '[{"number":1,"title":"x","mergedAt":"2026-09-14T01:00:00Z"}]' '' '--limit 1')
if [ "$rc" = 2 ] && grep -q "truncated" "$T/out"; then ok
else bad "live: a window at the limit must be cannot-measure (truncation)" "rc=$rc $(cat "$T/out")"; fi

rc=$(live '[{"number":1,"title":"x","mergedAt":"2026-09-14T01:00:00Z"}]' '<html>')
[ "$rc" = 2 ] && ok || bad "live: a malformed pr view must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"

# a clean live window end-to-end through the stub
rc=$(live '[{"number":7,"title":"ok pr","mergedAt":"2026-09-14T01:00:00Z"}]' '{"number":7,"title":"ok pr","reviews":[{"authorAssociation":"OWNER","body":"## APPROVE — round 1"}],"comments":[]}')
if [ "$rc" = 0 ] && grep -q "all 1 merged PR" "$T/out"; then ok
else bad "live: a clean window must report the all-clear line" "rc=$rc $(cat "$T/out")"; fi

# a non-date --since is cannot-measure, never a quiet green (#399 r2 minor 2)
rc=$(live '[{"number":9,"title":"x","mergedAt":"2026-09-14T01:00:00Z"}]' '' '--since banana')
if [ "$rc" = 2 ] && grep -q "not an ISO date" "$T/out"; then ok
else bad "live: --since banana must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"; fi

# a dirty live window goes red through the stub
rc=$(live '[{"number":8,"title":"quiet merge","mergedAt":"2026-09-14T01:00:00Z"}]' '{"number":8,"title":"quiet merge","reviews":[],"comments":[]}')
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #8" "$T/out"; then ok
else bad "live: a verdict-less merge must go red through the live path" "rc=$rc $(cat "$T/out")"; fi

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
    'any(test("APPROVE|APPROVED|REQUEST CHANGES"; "i"))' 'any(test(""; "i"))' assert_red_on_none
  assert_untrusted_red() { [ "$(runm "$1" untrusted)" = 1 ] && grep -q "NO-VERDICT merged PR #14" "$T/out"; }
  mutate "the trust filter is dropped (a drive-by NONE APPROVE silences the alarm)" \
    'map(select(.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR"))' \
    'map(select(true))' assert_untrusted_red
  mutate "an empty window reports green instead of cannot-measure" \
    'fixture dir empty — cannot measure" >&2; exit 2; }' \
    'fixture dir empty — cannot measure" >&2; exit 0; }' assert_empty_is_2

  runlive() { PATH="$GSTUB:$PATH" GH_FAKE_LIST="$2" GH_FAKE_PR="${3-}" bash "$1" >"$T/out" 2>&1; echo $?; }
  assert_badcreds_2() { [ "$(runlive "$1" '{"message":"Bad credentials"}')" = 2 ]; }
  mutate "the strict live parse is dropped (Bad credentials reports green)" \
    "jq -e 'type == \"array\" and all(.[]; has(\"number\") and has(\"mergedAt\"))'" \
    "jq -e 'true'" assert_badcreds_2
  assert_banana_2() { PATH="$GSTUB:$PATH" GH_FAKE_LIST='[{"number":9,"title":"x","mergedAt":"2026-09-14T01:00:00Z"}]' bash "$1" --since banana >"$T/out" 2>&1; [ $? = 2 ]; }
  mutate "the --since date guard is dropped (banana flows into --search as a quiet green)" \
    "[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]*) SINCE=\"\$2\" ;;" \
    "*) SINCE=\"\$2\" ;;" assert_banana_2
  echo "audit_no_verdict mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || FAIL=$((FAIL+1))
fi

echo "audit_no_verdict self-test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
