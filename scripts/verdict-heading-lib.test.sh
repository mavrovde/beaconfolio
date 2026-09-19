#!/usr/bin/env bash
# Self-test for the ONE verdict-heading grammar (scripts/verdict-heading-lib.sh).
#
# Every case below is a REAL first line, copied from a merged PR in this repo and
# labelled with the PR it came from — the sweep behind them is recorded in the
# library's header (229 merged PRs, 361 marker-bearing first lines, 7 rejected).
# Cases invented to flatter a regex are how #240's "a case that cannot fail" gets
# written, so none are invented here.
#
# Usage:
#   bash scripts/verdict-heading-lib.test.sh             # the cases
#   bash scripts/verdict-heading-lib.test.sh --mutations # prove they can fail
set -u

LIB="${VERDICT_HEADING_LIB:-$(cd "$(dirname "$0")" && pwd)/verdict-heading-lib.sh}"
[ -r "$LIB" ] || { echo "FATAL: cannot read $LIB"; exit 2; }
# shellcheck disable=SC1090
. "$LIB"
[ -n "${VERDICT_HEADING_JQ_DEFS:-}" ] || { echo "FATAL: $LIB defines no grammar"; exit 2; }

PASS=0; FAIL=0
verdict() { jq -rn --arg h "$1" "$VERDICT_HEADING_JQ_DEFS"'($h | vh_is_verdict)' 2>/dev/null; }

case_is() { # case_is <yes|no> <heading> <provenance>
  local want="$1" head="$2" why="$3" got
  got="$(verdict "$head")"
  [ "$want" = yes ] && want=true || want=false
  if [ "$got" = "$want" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  ✗ expected %s, got %s — %s\n      %s\n' "$want" "${got:-<error>}" "$why" "${head:0:90}"; fi
}

# --- verdicts: the reviewer states the decision in the first line -----------
case_is yes '## ✅ APPROVE — round 3 (at `70a8cfb4`)'                          '#458 round 3 — the mandated form'
case_is yes '## ⛔ REQUEST CHANGES — round 1'                                   '#458 round 1'
case_is yes '## ✅ APPROVE — round 4 (delta-confirm at 89e05b78)'              '#458 round 4'
case_is yes '## ✅ APPROVE — round 1 (independent review at `95e4fa43`)'       '#449 — rule 13 disclosure in the heading'
case_is yes '## ⛔ REQUEST CHANGES — round 2 (delta-confirm attempted at `b7783417`)' '#449 round 2'
case_is yes '## ✅ APPROVED'                                                    '#281 — bare marker'
case_is yes '✅ **APPROVED** — round 2'                                         '#181 — bold, no heading level'
case_is yes '## Round 3 — ✅ APPROVED'                                          '#255 — the `Round N —` prefix the gate named as unfixable'
case_is yes '## Round 2 — ⛔ REJECTED (…)'                                      '#255 — same prefix, negative marker'
case_is yes 'PR-REVIEWER VERDICT: APPROVE'                                     '#171 — the `VERDICT:` prefix'
case_is yes '## VERDICT: APPROVE (round 2)'                                    'the form pre-merge-gate.sh documents as valid'

# --- NOT verdicts: the author, writing about a verdict ----------------------
# Each of these is selected as "the newest verdict" by the loose filter these
# three scripts shared before v1.16.0.
case_is no  'Approved-with-findings applied before merge:'                     '#181 author note — hyphen-glued marker; ALLOW->DENY when applied'
case_is no  'Round-1 APPROVE findings applied on `1abb0fe` (wording only, per the verdict’s own phrasings)' '#281 author note — ALLOW->DENY when applied'
case_is no  '## Round-2 APPROVE noted — and the head moved, so this needs a round 3' '#373 author note — asks for a round 3'
case_is no  "Round-2 findings fixed at \`d5314ef\`. Author's fix report — not a verdict. Delta-confirm requested, since the round-2 APPROVE covers \`a270a4e\` only." '#400 author note — says in words that it is not a verdict'
case_is no  'Round-3 delta — head is now `89e05b78`. The round-3 APPROVE covered `70a8cfb4`; two things moved since, so it needs a delta-confirm rather than standing.' '#458 (v1.16.0) — the instance that made this grammar necessary'
case_is no  '### :white_check_mark: **Snyk checks have passed. No issues have been found so far.**' 'scanner comment on #458 — no verdict anywhere in it'
case_is no  'Fix report for round 1 — head is now `b7783417`.'                  '#449 author note — the charter form, which carries no marker at all'


# --- RE2 portability: retro_metrics.sh evaluates this grammar with `gh … -q`,
# which is gojq on Go's regexp engine — no lookahead, no lookbehind, no
# backreferences. The suite cannot reach gojq offline, so it pins the INPUT
# instead: measured 2026-09-19, `(?!` passed every case under jq and died at
# runtime under gh ("invalid or unsupported Perl syntax").
re2_unsupported="$(printf '%s' "$VERDICT_HEADING_JQ_DEFS" | grep -oE '\(\?[!=<]|\\[1-9]' | head -1)"
if [ -z "$re2_unsupported" ]; then PASS=$((PASS+1));
else FAIL=$((FAIL+1)); printf '  ✗ the grammar uses %s — gojq (gh -q) cannot compile it\n' "$re2_unsupported"; fi

printf '%s\n' "cases: $PASS passed, $FAIL failed"
RC=0
[ "$FAIL" -eq 0 ] || RC=1

# --- mutation contract ------------------------------------------------------
# A grammar is a pile of clauses, and a clause nobody kills is a clause that can
# be deleted. Each mutant removes ONE clause and must make at least one case go
# red; the identity mutant must stay green, or the harness is measuring its own
# plumbing rather than the grammar (the #291 fake-green shape).
if [ "${1-}" = "--mutations" ]; then
  echo
  echo "== mutation contract =="
  T="$(mktemp -d "${TMPDIR:-/tmp}/vhlib.XXXXXX")" || exit 2
  trap 'rm -rf "$T"' EXIT
  KILLED=0; SURVIVED=0; INVALID=0
  mutate() { # mutate <expect: die|survive> <name> <needle> <replacement>
    local expect="$1" name="$2" needle="$3" repl="$4" M="$T/lib.sh" rc
    if [ "$expect" = die ] && ! grep -qF -- "$needle" "$LIB"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID '$name' — needle not found (the grammar moved)"; return
    fi
    python3 - "$LIB" "$M" "$needle" "$repl" <<'PYMUT'
import sys
src, dst, needle, repl = sys.argv[1:5]
open(dst, "w").write(open(src).read().replace(needle, repl, 1))
PYMUT
    if [ "$expect" = die ] && cmp -s "$LIB" "$M"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID '$name' — no diff, so it tests nothing"; return
    fi
    VERDICT_HEADING_LIB="$M" bash "$0" >/dev/null 2>&1; rc=$?
    if [ "$rc" -eq 2 ]; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID '$name' — mutant unloadable; that is not a kill"; return
    fi
    if [ "$expect" = die ]; then
      if [ "$rc" -ne 0 ]; then KILLED=$((KILLED+1)); else SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: $name"; fi
    else
      if [ "$rc" -eq 0 ]; then KILLED=$((KILLED+1)); else SURVIVED=$((SURVIVED+1)); echo "  ✗ identity mutant failed: $name"; fi
    fi
  }

  # 1. the word boundary after the marker — what rejects `Approved-with-findings`
  mutate die 'marker boundary' 'test("^(APPROVED?|REQUEST[ \t]+CHANGES|REJECTED?)([^A-Za-z0-9-].*)?$"; "i")' 'test("^(APPROVED?|REQUEST[ \t]+CHANGES|REJECTED?)"; "i")'
  # 2. the start anchor — without it the grammar IS the loose filter again
  mutate die 'start anchor' 'test("^(APPROVED?' 'test("(APPROVED?'
  # 3. the leading-decoration strip — `## ✅ ` must not defeat the anchor
  mutate die 'decoration strip' 'sub("^[^A-Za-z]+"; "")' '.'
  # 4. the `VERDICT:` prefix (#171)
  mutate die 'VERDICT prefix' 'sub("^(?:PR-REVIEWER[^A-Za-z]{0,3})?VERDICT[^A-Za-z]*"; ""; "i")' '.'
  # 5. the `Round N —` prefix (#255)
  mutate die 'Round-N prefix' 'sub("^ROUND[ \t-]*[0-9]+[ \t]*[-–—:][ \t]*"; ""; "i")' '.'
  # 6. the dash that separates `Round 3 — APPROVED` from `Round-1 APPROVE findings`
  mutate die 'Round-N dash is required' '[0-9]+[ \t]*[-–—:][ \t]*' '[0-9]+[ \t]*[-–—:]?[ \t]*'
  # 7. normalisation repeats until stable — one pass leaves `✅ APPROVED`
  mutate die 'normalisation repeats' 'reduce range(0; 3)' 'reduce range(0; 1)'
  # 8. the RE2-portability case must bite: a lookahead is what actually shipped
  #    and broke retro_metrics.sh at runtime.
  mutate die 'RE2 portability' 'test("^(APPROVED?|REQUEST[ \t]+CHANGES|REJECTED?)([^A-Za-z0-9-].*)?$"; "i")' 'test("^(APPROVED?|REQUEST[ \t]+CHANGES|REJECTED?)(?![A-Za-z0-9-])"; "i")'
  # 9. identity: the harness must not report a kill for a file it did not change
  mutate survive 'identity' 'NO-SUCH-NEEDLE-IN-THIS-FILE' 'x'

  printf 'mutants: %s killed, %s survived, %s invalid\n' "$KILLED" "$SURVIVED" "$INVALID"
  { [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ]; } || RC=1
fi

exit "$RC"
