#!/usr/bin/env bash
# Self-test for audit_no_verdict_merges.sh (#392; ORDERING cases added by #409).
# Runs in the pre-push gate + CI.
#
#   bash scripts/audit_no_verdict_merges.test.sh              # behaviour cases
#   bash scripts/audit_no_verdict_merges.test.sh --mutations  # prove it can fail
#
# Every fixture carries real timestamps, because since #409 the detector orders
# verdicts against `mergedAt` and an undated body is not counted at all. The
# shared clock below is the v1.14.2 window's shape, which is the permanent
# regression fixture: merge at 14:00Z, a gating verdict at 13:00Z, a back-fill
# at 15:45Z.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/audit_no_verdict_merges.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ $# -gt 1 ] && echo "      $2"; }

MERGED="2026-09-14T14:00:00Z"
BEFORE="2026-09-14T13:00:00Z"
LATER="2026-09-14T13:30:00Z"
AFTER="2026-09-14T15:45:11Z"

T="$(mktemp -d "${TMPDIR:-/tmp}/vaudit.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT

# Every standard case runs against an EMPTY ledger: these cases test the
# detector, and the committed scripts/verdict-audit-acknowledged.txt contains
# real PR numbers (394, 402, 403) that collide with the fixtures on purpose —
# they are the shapes those PRs had. The ledger gets its own cases below.
ACKEMPTY="$T/ack.empty"; : > "$ACKEMPTY"

fix() { mkdir -p "$T/$1"; }
pr()  { cat > "$T/$1/$2.json"; }  # pr <fixture> <n>  (json on stdin)

run() { bash "$SCRIPT" --ack "$ACKEMPTY" --fixture "$T/$1" >"$T/out" 2>&1; echo $?; }

# --- a comment verdict counts (same-identity repos post comment verdicts) ----
fix clean
pr clean 10 <<EOF
{"number":10,"title":"good pr","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"## ✅ APPROVE — round 1 (at abc1234)\n\nAll criteria verified."}]}
EOF
rc=$(run clean)
[ "$rc" = 0 ] && ok || bad "a comment whose first line carries APPROVE must count" "$(cat "$T/out")"

# --- a review verdict counts --------------------------------------------------
# NOTE the shape: a lone REQUEST CHANGES before the merge is now UNAPPROVED, so
# this case pairs it with a later APPROVE — which is also the normal review arc.
fix review
pr review 11 <<EOF
{"number":11,"title":"reviewed pr","mergedAt":"$MERGED",
 "reviews":[{"authorAssociation":"OWNER","submittedAt":"$BEFORE","body":"## ⛔ REQUEST CHANGES — round 1\n\nblockers follow"},
            {"authorAssociation":"OWNER","submittedAt":"$LATER","body":"## ✅ APPROVE — round 2\n\nfixed"}],"comments":[]}
EOF
rc=$(run review)
[ "$rc" = 0 ] && ok || bad "review bodies count, and the NEWEST pre-merge verdict decides" "$(cat "$T/out")"

# --- zero verdicts → red, PR named (#321/#355 shape) --------------------------
fix none
pr none 321 <<EOF
{"number":321,"title":"chore(deps): bump alembic","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"Superseded by #331."}]}
EOF
rc=$(run none)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; then ok
else bad "a merged PR with zero verdicts must go red and be named" "$(cat "$T/out")"; fi

# --- the marker must be on the FIRST non-empty line, not anywhere ------------
fix buried
pr buried 12 <<EOF
{"number":12,"title":"fix report only","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"All four blockers fixed.\n\nThe reviewer can now APPROVE at the new head."}]}
EOF
rc=$(run buried)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #12" "$T/out"; then ok
else bad "APPROVE buried mid-body must NOT count (position is the convention)" "$(cat "$T/out")"; fi

# --- leading blank lines are skipped to find the first non-empty line --------
fix blanks
pr blanks 13 <<EOF
{"number":13,"title":"verdict after blank lines","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"\n\n## ✅ APPROVE — round 2 (delta-confirm at fff0000)\nbody"}]}
EOF
rc=$(run blanks)
[ "$rc" = 0 ] && ok || bad "leading blank lines must be skipped, not counted as line 1" "$(cat "$T/out")"

# --- an UNTRUSTED author's APPROVE must NOT silence the alarm (#316 rule) ----
fix untrusted
pr untrusted 14 <<EOF
{"number":14,"title":"drive-by approval","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"NONE","createdAt":"$BEFORE","body":"## ✅ APPROVE — looks great!"}]}
EOF
rc=$(run untrusted)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #14" "$T/out"; then ok
else bad "a NONE-association APPROVE must not count (the #316 hole)" "$(cat "$T/out")"; fi

# --- case-insensitive heading counts (mirrors the gate's "i" flag) -----------
fix lowercase
pr lowercase 15 <<EOF
{"number":15,"title":"lowercase verdict","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"MEMBER","createdAt":"$BEFORE","body":"## Round 3 — ✅ approved\nall clear"}]}
EOF
rc=$(run lowercase)
[ "$rc" = 0 ] && ok || bad "a lowercase 'approved' first line must count (gate parity)" "$(cat "$T/out")"

# ==========================================================================
# ORDERING — the #409 cases. Each of these PASSED the pre-#409 detector.
# ==========================================================================

# --- a verdict posted AFTER the merge does not gate it (the v1.14.2 shape) ---
fix backfilled
pr backfilled 394 <<EOF
{"number":394,"title":"quiet merge, reviewed later","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$AFTER","body":"## ✅ APPROVE — retrospective review (round 1)"}]}
EOF
rc=$(run backfilled)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #394" "$T/out"; then ok
else bad "a verdict posted after mergedAt must NOT satisfy the audit" "$(cat "$T/out")"; fi

# --- ...and it is reported as informational, not silently dropped ------------
if grep -q "note: PR #394 carries 1 verdict(s) posted AFTER the merge" "$T/out"; then ok
else bad "a back-filled verdict must be surfaced as an informational note" "$(cat "$T/out")"; fi

# --- newest pre-merge verdict is REQUEST CHANGES → UNAPPROVED (#402 shape) ---
fix unapproved
pr unapproved 402 <<EOF
{"number":402,"title":"merged over a standing REQUEST CHANGES","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"## ⛔ REQUEST CHANGES — round 1\n\ntwo blockers"}]}
EOF
rc=$(run unapproved)
if [ "$rc" = 1 ] && grep -q "UNAPPROVED merged PR #402" "$T/out"; then ok
else bad "merging over a standing REQUEST CHANGES must be a distinct UNAPPROVED violation" "$(cat "$T/out")"; fi

# --- and UNAPPROVED must NOT be reported as NO-VERDICT: they need different fixes
if ! grep -q "NO-VERDICT merged PR #402" "$T/out"; then ok
else bad "an UNAPPROVED merge must not be labelled NO-VERDICT (the two are distinct shapes)" "$(cat "$T/out")"; fi

# --- an APPROVE that QUOTES 'REQUEST CHANGES' in its heading is an APPROVE ----
# Mirrors the gate: the FIRST marker in the heading decides, not a contains-test.
fix quoting
pr quoting 16 <<EOF
{"number":16,"title":"approve naming the round it supersedes","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"## ✅ APPROVE — round 2: the REQUEST CHANGES findings are fixed"}]}
EOF
rc=$(run quoting)
if [ "$rc" = 0 ]; then ok
else bad "an APPROVE heading that quotes REQUEST CHANGES must stay APPROVED (first marker wins)" "$(cat "$T/out")"; fi

# --- a verdict with NO timestamp cannot be ordered, so it cannot count --------
fix undated
pr undated 17 <<EOF
{"number":17,"title":"undated verdict","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","body":"## ✅ APPROVE — round 1"}]}
EOF
rc=$(run undated)
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #17" "$T/out"; then ok
else bad "an undated verdict cannot be placed against the merge and must not count" "$(cat "$T/out")"; fi

# --- a verdict AT the merge second counts (inclusive bound, documented) ------
fix samesecond
pr samesecond 315 <<EOF
{"number":315,"title":"verdict in the merge second","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$MERGED","body":"## ✅ APPROVE — round 2 (delta-confirm)"}]}
EOF
rc=$(run samesecond)
[ "$rc" = 0 ] && ok || bad "a verdict at exactly mergedAt must count (inclusive bound)" "$(cat "$T/out")"

# --- a GATED PR that also collected a later verdict is clean, with the note ---
fix gatedplusnote
pr gatedplusnote 18 <<EOF
{"number":18,"title":"gated, then commented again","mergedAt":"$MERGED","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"## ✅ APPROVE — round 1"},
             {"authorAssociation":"OWNER","createdAt":"$AFTER","body":"## ✅ APPROVE — post-merge confirmation"}]}
EOF
rc=$(run gatedplusnote)
if [ "$rc" = 0 ] && grep -q "note: PR #18 carries 1 verdict(s) posted AFTER the merge" "$T/out"; then ok
else bad "a properly gated PR stays clean, and a later verdict is still noted" "$(cat "$T/out")"; fi

# --- a fixture without mergedAt is CANNOT MEASURE, never a pass ---------------
fix nomerged
pr nomerged 19 <<'EOF'
{"number":19,"title":"no merge time","reviews":[],
 "comments":[{"authorAssociation":"OWNER","createdAt":"2026-09-14T13:00:00Z","body":"## ✅ APPROVE — round 1"}]}
EOF
rc=$(run nomerged)
if [ "$rc" = 2 ] && grep -q "no mergedAt" "$T/out"; then ok
else bad "a fixture without mergedAt must be cannot-measure (2), never a pass" "$(cat "$T/out")"; fi

# --- mixed fixture: one clean + one dirty → red, only the dirty named --------
fix mixed
pr mixed 20 <<EOF
{"number":20,"title":"good","mergedAt":"$MERGED","reviews":[],"comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"## ✅ APPROVE — round 1"}]}
EOF
pr mixed 21 <<EOF
{"number":21,"title":"bad","mergedAt":"$MERGED","reviews":[],"comments":[{"authorAssociation":"OWNER","createdAt":"$BEFORE","body":"merged for reasons"}]}
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
live() { PATH="$GSTUB:$PATH" GH_FAKE_LIST="$1" GH_FAKE_PR="${2-}" bash "$SCRIPT" --ack "$ACKEMPTY" ${3-} >"$T/out" 2>&1; echo $?; }

rc=$(live '{"message":"Bad credentials"}')
if [ "$rc" = 2 ] && grep -q "not the expected array" "$T/out"; then ok
else bad "live: a Bad-Credentials object must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"; fi

rc=$(live '')
[ "$rc" = 2 ] && ok || bad "live: empty gh output must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"

rc=$(live "[{\"number\":1,\"title\":\"x\",\"mergedAt\":\"$MERGED\"}]" '' '--limit 1')
if [ "$rc" = 2 ] && grep -q "truncated" "$T/out"; then ok
else bad "live: a window at the limit must be cannot-measure (truncation)" "rc=$rc $(cat "$T/out")"; fi

rc=$(live "[{\"number\":1,\"title\":\"x\",\"mergedAt\":\"$MERGED\"}]" '<html>')
[ "$rc" = 2 ] && ok || bad "live: a malformed pr view must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"

# a pr view WITHOUT mergedAt is cannot-measure on the live path too
rc=$(live "[{\"number\":1,\"title\":\"x\",\"mergedAt\":\"$MERGED\"}]" '{"number":1,"title":"x","reviews":[],"comments":[]}')
if [ "$rc" = 2 ] && grep -q "could not fetch PR #1" "$T/out"; then ok
else bad "live: a pr view lacking mergedAt must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"; fi

# a clean live window end-to-end through the stub
rc=$(live "[{\"number\":7,\"title\":\"ok pr\",\"mergedAt\":\"$MERGED\"}]" "{\"number\":7,\"title\":\"ok pr\",\"mergedAt\":\"$MERGED\",\"reviews\":[{\"authorAssociation\":\"OWNER\",\"submittedAt\":\"$BEFORE\",\"body\":\"## APPROVE — round 1\"}],\"comments\":[]}")
if [ "$rc" = 0 ] && grep -q "all 1 merged PR" "$T/out"; then ok
else bad "live: a clean window must report the all-clear line" "rc=$rc $(cat "$T/out")"; fi

# a non-date --since is cannot-measure, never a quiet green (#399 r2 minor 2)
rc=$(live "[{\"number\":9,\"title\":\"x\",\"mergedAt\":\"$MERGED\"}]" '' '--since banana')
if [ "$rc" = 2 ] && grep -q "not an ISO date" "$T/out"; then ok
else bad "live: --since banana must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"; fi

# a dirty live window goes red through the stub
rc=$(live "[{\"number\":8,\"title\":\"quiet merge\",\"mergedAt\":\"$MERGED\"}]" "{\"number\":8,\"title\":\"quiet merge\",\"mergedAt\":\"$MERGED\",\"reviews\":[],\"comments\":[]}")
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #8" "$T/out"; then ok
else bad "live: a verdict-less merge must go red through the live path" "rc=$rc $(cat "$T/out")"; fi

# the ORDERING bug, reproduced on the LIVE path — this is the workflow's branch
rc=$(live "[{\"number\":403,\"title\":\"back-filled\",\"mergedAt\":\"$MERGED\"}]" "{\"number\":403,\"title\":\"back-filled\",\"mergedAt\":\"$MERGED\",\"reviews\":[],\"comments\":[{\"authorAssociation\":\"OWNER\",\"createdAt\":\"$AFTER\",\"body\":\"## ✅ APPROVE — retrospective review (round 1)\"}]}")
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #403" "$T/out"; then ok
else bad "live: a back-filled verdict must go red on the live path too" "rc=$rc $(cat "$T/out")"; fi


# ==========================================================================
# THE ACKNOWLEDGEMENT LEDGER (#409). It exists so the cutover window's seven
# unrepairable violations do not leave the scheduled workflow red forever — a
# permanently red alarm is a disabled alarm. It must therefore silence EXACTLY
# the PRs named in it and nothing else.
# ==========================================================================
ACKLIST="$T/ack.list"
cat > "$ACKLIST" <<'AEOF'
# a comment line, and a blank one, must be ignored

394  NO-VERDICT  web-UI merge, verdict back-filled
AEOF

runack() { bash "$SCRIPT" --ack "$2" --fixture "$T/$1" >"$T/out" 2>&1; echo $?; }

# --- an acknowledged violation does not turn the run red ---------------------
rc=$(runack backfilled "$ACKLIST")
[ "$rc" = 0 ] && ok || bad "an acknowledged violation must not turn the run red" "$(cat "$T/out")"

# --- ...but it is still PRINTED. Silencing the exit code must never silence
#     the report: the ledger is a record, not an eraser.
if grep -q "NO-VERDICT merged PR #394" "$T/out" && grep -q "acknowledged in" "$T/out"; then ok
else bad "an acknowledged violation must still be printed, and marked as acknowledged" "$(cat "$T/out")"; fi

# --- a violation NOT in the ledger still goes red, in the same window --------
fix ackmix
cp "$T/backfilled/394.json" "$T/ackmix/394.json"
cp "$T/none/321.json"       "$T/ackmix/321.json"
rc=$(runack ackmix "$ACKLIST")
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; then ok
else bad "acknowledging one PR must not amnesty another in the same window" "$(cat "$T/out")"; fi

# --- a missing ledger yields an EMPTY one: redder, never greener -------------
rc=$(runack backfilled "$T/does-not-exist.txt")
if [ "$rc" = 1 ] && grep -q "NO-VERDICT merged PR #394" "$T/out"; then ok
else bad "a missing ledger must acknowledge NOTHING (fail red, never green)" "$(cat "$T/out")"; fi

# --- a stale acknowledgement on a now-clean PR is called out -----------------
STALE="$T/ack.stale"; echo "10  no longer a violation" > "$STALE"
rc=$(runack clean "$STALE")
if [ "$rc" = 0 ] && grep -q "PR #10 is acknowledged but is no longer a violation" "$T/out"; then ok
else bad "a stale acknowledgement must be reported so the ledger can shrink" "$(cat "$T/out")"; fi


# --- the all-clear line must NOT claim an acknowledged PR was gated ----------
# An acknowledged merge was NOT reviewed before it landed. A summary that says
# "every merged PR was gated" while silencing one is the same "claim asserted
# rather than measured" defect the retrospectives keep counting.
rc=$(runack backfilled "$ACKLIST")
if [ "$rc" = 0 ] && grep -q "1 acknowledged" "$T/out" && ! grep -q "every merged PR in the fixture was gated" "$T/out"; then ok
else bad "a green run with acknowledgements must say so, not claim everything was gated" "$(cat "$T/out")"; fi

# --- ...and with NO acknowledgements the plain all-clear line is still used ---
rc=$(runack clean "$ACKEMPTY")
if [ "$rc" = 0 ] && grep -q "every merged PR in the fixture was gated" "$T/out"; then ok
else bad "a genuinely clean run must still report the plain all-clear" "$(cat "$T/out")"; fi

# --- the COMMITTED ledger parses, and names only real, documented PRs --------
REAL="$(cd "$(dirname "$SCRIPT")" && pwd)/verdict-audit-acknowledged.txt"
if [ -r "$REAL" ]; then
  nums="$(sed -e 's/#.*$//' "$REAL" | awk '{print $1}' | grep -E '^[0-9]+$' | tr '\n' ' ')"
  if [ "$nums" = "394 395 396 397 403 402 412 " ]; then ok
  else bad "the committed ledger must hold exactly the 7 documented violations" "got: $nums"; fi
else bad "the committed acknowledgement ledger is missing" "$REAL"; fi

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
  runm() { bash "$1" --ack "${3-$ACKEMPTY}" --fixture "$T/$2" >"$T/out" 2>&1; echo $?; }
  assert_red_on_none()     { [ "$(runm "$1" none)" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; }
  assert_red_on_buried()   { [ "$(runm "$1" buried)" = 1 ] && grep -q "NO-VERDICT" "$T/out"; }
  assert_empty_is_2()      { [ "$(runm "$1" empty)" = 2 ]; }
  assert_untrusted_red()   { [ "$(runm "$1" untrusted)" = 1 ] && grep -q "NO-VERDICT merged PR #14" "$T/out"; }
  # --- the #409 assertions ---
  assert_backfill_red()    { [ "$(runm "$1" backfilled)" = 1 ] && grep -q "NO-VERDICT merged PR #394" "$T/out"; }
  assert_backfill_noted()  { [ "$(runm "$1" backfilled)" = 1 ] && grep -q "note: PR #394 carries 1 verdict" "$T/out"; }
  assert_unapproved_red()  { [ "$(runm "$1" unapproved)" = 1 ] && grep -q "UNAPPROVED merged PR #402" "$T/out"; }
  assert_shapes_distinct() { [ "$(runm "$1" unapproved)" = 1 ] && ! grep -q "NO-VERDICT merged PR #402" "$T/out"; }
  assert_quoting_clean()   { [ "$(runm "$1" quoting)" = 0 ]; }
  assert_undated_red()     { [ "$(runm "$1" undated)" = 1 ] && grep -q "NO-VERDICT merged PR #17" "$T/out"; }
  assert_nomerged_is_2()   { [ "$(runm "$1" nomerged)" = 2 ]; }

  mutate "the red exit is neutered (a no-verdict merge reports green)" \
    'exit "$DIRTY"
fi' 'exit 0
fi' assert_red_on_none
  mutate "the first-line filter widens to the whole body (a fix report counts as a verdict)" \
    'split("\n") | map(select(test("\\S"))) | (.[0] // "")' \
    'split("\n") | join(" ")' assert_red_on_buried
  mutate "the marker test matches everything" \
    'test("APPROVE|APPROVED|REQUEST CHANGES"; "i")' 'test(""; "i")' assert_red_on_none
  mutate "the trust filter is dropped (a drive-by NONE APPROVE silences the alarm)" \
    '(.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR")' \
    '(true)' assert_untrusted_red

  # #409 mutant 1 — the ordering bound itself. THE regression this release fixes.
  mutate "the <= mergedAt bound is dropped (a back-filled verdict gates the merge)" \
    '{ pre: map(select(.at <= $m)), post: map(select(.at > $m)) }' \
    '{ pre: map(select(true)), post: [] }' assert_backfill_red
  # ...and the note must not be what carries the failure: assert it separately.
  mutate "the back-filled note is dropped (the repair becomes invisible)" \
    'note: PR #$n carries $backfilled verdict(s) posted AFTER the merge' \
    'note: PR #$n had something happen' assert_backfill_noted
  # #409 mutant 2 — REQUEST CHANGES accepted as an approval.
  mutate "a newest REQUEST CHANGES is accepted as APPROVED" \
    'if test("APPROVE"; "i") then "APPROVED" else "UNAPPROVED" end' \
    'if test(""; "i") then "APPROVED" else "UNAPPROVED" end' assert_unapproved_red
  # #409 mutant 3 — the two violation shapes collapsed into one.
  mutate "UNAPPROVED is reported as NO-VERDICT (the two shapes collapse)" \
    'echo "UNAPPROVED merged PR #$n:' 'echo "NO-VERDICT merged PR #$n:' assert_shapes_distinct
  # first-marker-wins, not contains
  mutate "the APPROVE/REQUEST-CHANGES decision becomes a contains-test" \
    '[match("REQUEST CHANGES|APPROVED?"; "gi")] | (.[0].string // "")' \
    '[match("REQUEST CHANGES"; "gi")] | (.[0].string // "")' assert_quoting_clean
  # an undated body must stay uncountable
  mutate "the .at != null clause is dropped (an undated body is ordered anyway)" \
    'map(select(.at != null' 'map(select((.at // "1970-01-01T00:00:00Z") != null' assert_undated_red
  # a fixture with no merge time must not silently pass
  mutate "the fixture mergedAt requirement is dropped" \
    'has no mergedAt — cannot measure" >&2; exit 2; }' \
    'has no mergedAt — cannot measure" >&2; exit 0; }' assert_nomerged_is_2

  # --- ledger mutants: it must silence exactly what it names, and nothing else
  assert_ack_not_red()    { [ "$(runm "$1" backfilled "$ACKLIST")" = 0 ]; }
  # Both halves: the violation line stays AND the reason the exit code ignores
  # it is stated. Without the second, a reader sees a NO-VERDICT line beside a
  # green exit and cannot tell an acknowledgement from a broken detector.
  assert_ack_still_shown(){ [ "$(runm "$1" backfilled "$ACKLIST")" = 0 ] \
    && grep -q "NO-VERDICT merged PR #394" "$T/out" && grep -q "acknowledged in" "$T/out"; }
  assert_other_still_red(){ [ "$(runm "$1" ackmix "$ACKLIST")" = 1 ] && grep -q "NO-VERDICT merged PR #321" "$T/out"; }
  mutate "the ledger acknowledges EVERYTHING (a blanket amnesty)" \
    'case "$ACK" in *" $1 "*) return 0 ;; *) return 1 ;; esac' \
    'return 0' assert_other_still_red
  # Single-line needle: a multi-line one silently rots the moment anything is
  # inserted between the lines, and `grep -F` reports a multi-line pattern as
  # FOUND (it ORs the lines), so the rot shows up as "no change", not "rotted".
  mutate "an acknowledged violation stops being printed (the ledger becomes an eraser)" \
    'echo "  ^ acknowledged in $(basename "$ACK_FILE") — on the record, not re-alarming"' \
    'true' assert_ack_still_shown
  mutate "the ledger file test is inverted (a present ledger acknowledges nothing)" \
    'if [ -r "$ACK_FILE" ]; then' 'if [ ! -r "$ACK_FILE" ]; then' assert_ack_not_red

  assert_summary_honest(){ [ "$(runm "$1" backfilled "$ACKLIST")" = 0 ] \
    && grep -q "1 acknowledged" "$T/out" && ! grep -q "every merged PR in the fixture was gated" "$T/out"; }
  mutate "the summary claims everything was gated even when PRs were only acknowledged" \
    'if [ "$ACKED" -gt 0 ]; then' 'if false; then' assert_summary_honest
  mutate "an empty window reports green instead of cannot-measure" \
    'fixture dir empty — cannot measure" >&2; exit 2; }' \
    'fixture dir empty — cannot measure" >&2; exit 0; }' assert_empty_is_2

  runlive() { PATH="$GSTUB:$PATH" GH_FAKE_LIST="$2" GH_FAKE_PR="${3-}" bash "$1" --ack "$ACKEMPTY" >"$T/out" 2>&1; echo $?; }
  assert_badcreds_2() { [ "$(runlive "$1" '{"message":"Bad credentials"}')" = 2 ]; }
  mutate "the strict live parse is dropped (Bad credentials reports green)" \
    "jq -e 'type == \"array\" and all(.[]; has(\"number\") and has(\"mergedAt\"))'" \
    "jq -e 'true'" assert_badcreds_2
  assert_banana_2() { PATH="$GSTUB:$PATH" GH_FAKE_LIST="[{\"number\":9,\"title\":\"x\",\"mergedAt\":\"$MERGED\"}]" bash "$1" --ack "$ACKEMPTY" --since banana >"$T/out" 2>&1; [ $? = 2 ]; }
  mutate "the --since date guard is dropped (banana flows into --search as a quiet green)" \
    "[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]*) SINCE=\"\$2\" ;;" \
    "*) SINCE=\"\$2\" ;;" assert_banana_2
  echo "audit_no_verdict mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || FAIL=$((FAIL+1))
fi

echo "audit_no_verdict self-test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
