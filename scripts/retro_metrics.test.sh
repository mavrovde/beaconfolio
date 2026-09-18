#!/usr/bin/env bash
# Self-test for retro_metrics.sh (PR #452 round 2). CI only — this is an analysis
# instrument, not a lint or a gate, so it is deliberately NOT in the pre-push gate's
# sub-minute budget.
#
#   bash scripts/retro_metrics.test.sh              # behaviour cases
#   bash scripts/retro_metrics.test.sh --mutations  # prove each refusal can fail
#
# WHY a script that only prints numbers gets a self-test (the #452 round-2 ruling):
# rule 4c does not literally bind — no `check_*` lint, no hook, no CI gate. What
# changed is that the script now has FIVE ARMS THAT REFUSE (truncation guard, strict
# array parse, ambiguity refusal, malformed `pr:`, the two unmerged-bound refusals),
# its output is cited in a permanent trend table, and the evidence that nobody
# notices when one rots is the script's own history: a bare `--limit 100` sat in it
# from creation until a reviewer typed a grep, silently returning 7 of the v1.12.0
# window's 10 PRs. `-ge` drifting to `-gt`, or `--search` dropped in a later edit,
# restores exactly that defect.
#
# Hermetic: `gh` is a stub on PATH driven by env vars, and the cases run inside
# throwaway git repos in $TMPDIR. Nothing touches the network or this checkout.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/retro_metrics.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ $# -gt 1 ] && echo "      $2"; }

T="$(mktemp -d "${TMPDIR:-/tmp}/retrometrics.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT

LOW_MERGE="2026-09-17T11:09:20Z"    # the previous release PR's mergedAt
UPPER="2026-09-18T15:10:57Z"        # this release PR's mergedAt
IN1="2026-09-17T12:00:00Z"
IN2="2026-09-18T09:00:00Z"
BEFORE="2026-09-17T10:00:00Z"       # earlier than LOW_MERGE — must be excluded
AFTER="2026-09-19T01:00:00Z"        # later than UPPER      — must be excluded

# --- gh stub ----------------------------------------------------------------
# Records its argv so a case can assert on the QUERY, not only on the numbers:
# "--search is present" is exactly the property that rotted, and it is invisible
# in the output.
GSTUB="$T/gstub"; mkdir -p "$GSTUB"
cat > "$GSTUB/gh" <<'GHEOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${GH_ARGV_LOG:-/dev/null}"
case "$*" in
  "pr list"*)
      printf '%s' "${GH_FAKE_LIST-}" ;;
  *"--json mergedAt,reviews,comments"*)
      # the per-PR verdict replay: the script reads "<count> <r1flag>"
      printf '%s' "${GH_FAKE_VERDICT-1 r1-approve}" ;;
  "pr view"*)
      # GH_FAKE_VIEWS is newline-separated "<pr>=<mergedAt>"
      printf '%s\n' "${GH_FAKE_VIEWS-}" | sed -n "s/^$3=//p" | head -1 | tr -d '\n' ;;
esac
GHEOF
chmod +x "$GSTUB/gh"

# --- git fixtures -----------------------------------------------------------
# REPO: a plain repo carrying a tag whose commit date has a NON-UTC offset, so the
# ref arm's UTC normalisation (note 11) is exercised rather than assumed.
mkrepo() { # mkrepo <dir> <tagname> <commit-date>
  mkdir -p "$1" && (
    cd "$1" || exit 1
    git init -q .
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" \
      git -c user.name=t -c user.email=t@t commit -q --allow-empty -m fixture
    git tag "$2"
  )
}
mkrepo "$T/repo"  v9.9.9 "2026-09-17 13:09:19 +0200"   # == 11:09:19Z
mkrepo "$T/ambig" 436    "2026-09-17 13:09:19 +0200"   # a REF literally named 436

LIST_OK="[{\"number\":437,\"mergedAt\":\"$IN1\",\"changedFiles\":9,\"additions\":10,\"deletions\":2,\"createdAt\":\"$IN1\"},
          {\"number\":438,\"mergedAt\":\"$IN2\",\"changedFiles\":5,\"additions\":3,\"deletions\":1,\"createdAt\":\"$IN2\"}]"
LIST_WIDE="[{\"number\":400,\"mergedAt\":\"$BEFORE\",\"changedFiles\":1,\"additions\":1,\"deletions\":0,\"createdAt\":\"$BEFORE\"},
            {\"number\":437,\"mergedAt\":\"$IN1\",\"changedFiles\":9,\"additions\":10,\"deletions\":2,\"createdAt\":\"$IN1\"},
            {\"number\":438,\"mergedAt\":\"$IN2\",\"changedFiles\":5,\"additions\":3,\"deletions\":1,\"createdAt\":\"$IN2\"},
            {\"number\":499,\"mergedAt\":\"$AFTER\",\"changedFiles\":1,\"additions\":1,\"deletions\":0,\"createdAt\":\"$AFTER\"}]"
VIEWS_OK="436=$LOW_MERGE
441=$UPPER"

# run <script> <repo-dir> <arg1> <arg2>   (env overrides via the caller)
run() {
  local s="$1" dir="$2"; shift 2
  ( cd "$dir" && PATH="$GSTUB:$PATH" \
      GH_FAKE_LIST="${GH_FAKE_LIST-$LIST_OK}" \
      GH_FAKE_VIEWS="${GH_FAKE_VIEWS-$VIEWS_OK}" \
      GH_ARGV_LOG="${GH_ARGV_LOG-}" \
      bash "$s" "$@" ) >"$T/out" 2>&1
  echo $?
}

# ============================================================================
# Behaviour cases
# ============================================================================

# --- the PR form bounds on the previous release PR's mergedAt ----------------
rc=$(run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 0 ] && grep -q "previous release PR mergedAt" "$T/out" \
   && grep -q "^PRs merged: 2$" "$T/out"; then ok
else bad "pr: form bounds on the PR's mergedAt and counts the window" "rc=$rc $(cat "$T/out")"; fi

# --- a BARE all-digit arg means the same thing when it names no commit -------
rc=$(run "$SCRIPT" "$T/repo" 436 441)
if [ "$rc" = 0 ] && grep -q "previous release PR mergedAt" "$T/out"; then ok
else bad "a bare numeric arg is a PR number when it names no git commit" "rc=$rc $(cat "$T/out")"; fi

# --- the ref form bounds on the tag COMMIT date, normalised to UTC -----------
# The fixture tag's commit is 13:09:19+02:00. Note 11: printing the local string
# would silently mis-select the corpus against Z-stamped mergedAt values.
rc=$(run "$SCRIPT" "$T/repo" ref:v9.9.9 441)
if [ "$rc" = 0 ] && grep -q "tag commit date" "$T/out" \
   && grep -q "2026-09-17T11:09:19Z" "$T/out"; then ok
else bad "ref: form bounds on the tag commit date, rendered in UTC" "rc=$rc $(cat "$T/out")"; fi

# --- the corpus is filtered to the window on BOTH edges ----------------------
rc=$(GH_FAKE_LIST="$LIST_WIDE" run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 0 ] && grep -q "^PRs merged: 2$" "$T/out" \
   && ! grep -q "#400" "$T/out" && ! grep -q "#499" "$T/out"; then ok
else bad "PRs outside the window are excluded on both edges" "rc=$rc $(cat "$T/out")"; fi

# --- the listing is bounded SERVER-SIDE (argv-observed) ----------------------
# The defect this script shipped with is invisible in the output: the numbers
# look fine, they are just computed over the wrong set. So assert the QUERY.
: > "$T/argv"
rc=$(GH_ARGV_LOG="$T/argv" run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 0 ] && grep -q 'pr list .*--search merged:>=2026-09-17' "$T/argv" \
   && grep -q 'pr list .*--limit 400' "$T/argv"; then ok
else bad "the pr list call must carry --search merged:>= and a limit" "$(cat "$T/argv")"; fi

# --- truncation guard: a filled limit is CANNOT MEASURE, never a short corpus -
rc=$(RETRO_PR_LIMIT=2 run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 2 ] && grep -q "filled --limit 2" "$T/out"; then ok
else bad "a listing that fills --limit must exit 2, not print a number" "rc=$rc $(cat "$T/out")"; fi

# --- strict parse: a Bad-Credentials object is not a corpus ------------------
rc=$(GH_FAKE_LIST='{"message":"Bad credentials"}' run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 2 ] && grep -q "not return the expected array" "$T/out"; then ok
else bad "a non-array gh response must be cannot-measure (2)" "rc=$rc $(cat "$T/out")"; fi

# --- the release PR must be merged -------------------------------------------
rc=$(GH_FAKE_VIEWS="436=$LOW_MERGE
441=null" run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 1 ] && grep -q "PR #441 is not merged" "$T/out"; then ok
else bad "an unmerged release PR must refuse (no upper bound)" "rc=$rc $(cat "$T/out")"; fi

# --- ...and so must the previous release PR ----------------------------------
rc=$(GH_FAKE_VIEWS="436=null
441=$UPPER" run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 1 ] && grep -q "PR #436 is not merged" "$T/out"; then ok
else bad "an unmerged previous release PR must refuse (no lower bound)" "rc=$rc $(cat "$T/out")"; fi

# --- the ambiguity refusal (nit 7) -------------------------------------------
# Same argument, a repo where `436` ALSO names a commit: refuse, do not guess.
rc=$(run "$SCRIPT" "$T/ambig" 436 441)
if [ "$rc" = 1 ] && grep -q "ambiguous" "$T/out"; then ok
else bad "an all-digit arg that also names a commit must refuse" "rc=$rc $(cat "$T/out")"; fi

# ...and the explicit forms resolve it in BOTH directions, in that same repo.
rc=$(run "$SCRIPT" "$T/ambig" pr:436 441)
if [ "$rc" = 0 ] && grep -q "previous release PR mergedAt" "$T/out"; then ok
else bad "pr:436 resolves the ambiguity to the PR" "rc=$rc $(cat "$T/out")"; fi
rc=$(run "$SCRIPT" "$T/ambig" ref:436 441)
if [ "$rc" = 0 ] && grep -q "tag commit date" "$T/out"; then ok
else bad "ref:436 resolves the ambiguity to the git ref" "rc=$rc $(cat "$T/out")"; fi

# --- a malformed pr: argument refuses rather than querying PR "abc" ----------
rc=$(run "$SCRIPT" "$T/repo" pr:abc 441)
if [ "$rc" = 1 ] && grep -q "is not a PR number" "$T/out"; then ok
else bad "pr:abc must refuse" "rc=$rc $(cat "$T/out")"; fi
rc=$(run "$SCRIPT" "$T/repo" pr: 441)
if [ "$rc" = 1 ] && grep -q "is not a PR number" "$T/out"; then ok
else bad "an empty pr: must refuse" "rc=$rc $(cat "$T/out")"; fi

# --- missing arguments --------------------------------------------------------
rc=$(run "$SCRIPT" "$T/repo" 436)
if [ "$rc" = 1 ] && grep -q "usage:" "$T/out"; then ok
else bad "a missing release PR must print usage and exit 1" "rc=$rc $(cat "$T/out")"; fi

# --- the figures themselves ---------------------------------------------------
rc=$(GH_FAKE_VERDICT="2 -" run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 0 ] && grep -q "canonical verdicts (pre-merge): 4" "$T/out" \
   && grep -q "mean rounds:  *2.00" "$T/out" \
   && grep -q "round-1 approvals: *0/2 = 0%" "$T/out" \
   && grep -q "rework share of verdicts: *50%" "$T/out"; then ok
else bad "the derived figures are computed from the corpus + verdicts" "rc=$rc $(cat "$T/out")"; fi

# median of an even-sized corpus is the mean of the two middles (9, 5 -> 7)
rc=$(run "$SCRIPT" "$T/repo" pr:436 441)
if [ "$rc" = 0 ] && grep -q "^7$" "$T/out"; then ok
else bad "median files/PR averages the two middles on an even corpus" "rc=$rc $(cat "$T/out")"; fi

# ============================================================================
# Mutation contract — killed = the case's assertion FAILS under the mutant
# ============================================================================
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  mutate() { # <name> <needle> <replacement> <assert-fn>  (assert holds on the real script)
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$T/mut.sh"
    # `-e` matters: a needle that starts with `-` (the --search mutant) is read as
    # an option by BSD grep and the mutant silently reports INVALID.
    if ! grep -qF -e "$needle" "$SCRIPT"; then
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

  # Each assertion names the script's OWN message, not just an exit code: several
  # arms share rc=1, so an exit-code-only assertion would let one arm's mutant be
  # "killed" by a different arm firing.
  assert_truncation()  { [ "$(RETRO_PR_LIMIT=2 run "$1" "$T/repo" pr:436 441)" = 2 ] \
                         && grep -q "filled --limit 2" "$T/out"; }
  assert_badarray()    { [ "$(GH_FAKE_LIST='{"message":"Bad credentials"}' run "$1" "$T/repo" pr:436 441)" = 2 ] \
                         && grep -q "not return the expected array" "$T/out"; }
  assert_ambiguous()   { [ "$(run "$1" "$T/ambig" 436 441)" = 1 ] && grep -q "ambiguous" "$T/out"; }
  assert_badpr()       { [ "$(run "$1" "$T/repo" pr:abc 441)" = 1 ] && grep -q "is not a PR number" "$T/out"; }
  assert_no_upper()    { [ "$(GH_FAKE_VIEWS="436=$LOW_MERGE
441=null" run "$1" "$T/repo" pr:436 441)" = 1 ] && grep -q "PR #441 is not merged" "$T/out"; }
  assert_no_lower()    { [ "$(GH_FAKE_VIEWS="436=null
441=$UPPER" run "$1" "$T/repo" pr:436 441)" = 1 ] && grep -q "PR #436 is not merged" "$T/out"; }
  assert_searched()    { : > "$T/argv"
                         [ "$(GH_ARGV_LOG="$T/argv" run "$1" "$T/repo" pr:436 441)" = 0 ] \
                         && grep -q 'pr list .*--search merged:>=2026-09-17' "$T/argv"; }
  assert_utc()         { [ "$(run "$1" "$T/repo" ref:v9.9.9 441)" = 0 ] \
                         && grep -q "2026-09-17T11:09:19Z" "$T/out"; }
  assert_window()      { [ "$(GH_FAKE_LIST="$LIST_WIDE" run "$1" "$T/repo" pr:436 441)" = 0 ] \
                         && grep -q "^PRs merged: 2$" "$T/out"; }

  # 1. the truncation guard's comparison — the drift that restores the defect
  mutate "the truncation guard becomes -gt (a listing that exactly fills the limit passes)" \
    'if [ "$NRAW" -ge "$LIMIT" ]; then' 'if [ "$NRAW" -gt "$LIMIT" ]; then' assert_truncation
  # 2. ...or is removed outright
  mutate "the truncation guard is removed entirely" \
    'if [ "$NRAW" -ge "$LIMIT" ]; then' 'if false; then' assert_truncation
  # 3. the strict array parse
  mutate "the strict array parse is weakened (a Bad-Credentials object reads as a corpus)" \
    "jq -e 'type == \"array\" and all(.[]; has(\"number\") and has(\"mergedAt\"))'" \
    "jq -e 'true'" assert_badarray
  # 4. the server-side bound — invisible in the output, which is why it rotted
  mutate "the server-side --search bound is dropped (default order returns a prefix)" \
    '--search "merged:>=${LOWER%%T*}" \' \
    '\' assert_searched
  # 5. the ambiguity refusal
  mutate "the ambiguity refusal is neutered (a numeric git ref is read as a PR)" \
    'if git rev-parse --verify --quiet "$PREV^{commit}" >/dev/null 2>&1; then' \
    'if false; then' assert_ambiguous
  # 6. the malformed pr: guard
  mutate "the malformed pr: guard stops matching (pr:abc is queried as a PR)" \
    'pr:|pr:*[!0-9]*)' 'pr:__never__)' assert_badpr
  # 7 + 8. the two unmerged-bound refusals, separately
  mutate "the unmerged UPPER bound is accepted (a null mergedAt bounds the window)" \
    'if [ -z "$UPPER" ] || [ "$UPPER" = "null" ]; then' 'if false; then' assert_no_upper
  mutate "the unmerged LOWER bound is accepted" \
    'if [ -z "$LOWER" ] || [ "$LOWER" = "null" ]; then' 'if false; then' assert_no_lower
  # 9. note 11's UTC normalisation on the ref arm
  mutate "the ref arm stops normalising to UTC (a local +02:00 stamp bounds the window)" \
    '.astimezone(datetime.timezone.utc)' '' assert_utc
  # 10. the window filter itself
  mutate "the corpus window filter is dropped (every listed PR is counted)" \
    'select(.mergedAt > \"$LOWER\" and .mergedAt <= \"$UPPER\")' \
    'select(true)' assert_window

  echo "retro_metrics mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || FAIL=$((FAIL+1))
fi

echo "retro_metrics self-test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
