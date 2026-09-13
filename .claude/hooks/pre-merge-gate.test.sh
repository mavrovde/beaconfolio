#!/usr/bin/env bash
# Self-test for the merge gate.
#
# The FIRST version of this file passed 14/14 against a gate whose blocking had
# been removed — it asserted the process exit code, but these hooks deny via a
# JSON permissionDecision and exit 0, so exit status carries no information.
# Only 4 of 10 mutations bit. That is the exact fake-green class the retrospective
# this hook came from is about, so every case here now asserts the DECISION
# (parsed out of the JSON) and the mutation list below is part of the contract:
# `bash pre-merge-gate.test.sh --mutations` re-runs them and must report 21 killed.
set -u

HOOK="${HOOK:-$(cd "$(dirname "$0")" && pwd)/pre-merge-gate.sh}"
PASS=0; FAIL=0
STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT

# --- gh stub: hermetic, no network, no real PRs -----------------------------
cat > "$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
args="$*"
case "$args" in
  "pr view --json number"*) printf '%s' "${GH_STUB_CURRENT_PR-}" ;;
  # `gh pr view <branch> --json number` -- how the hook resolves a branch operand.
  "pr view "*"--json number"*) printf '%s' "${GH_STUB_BRANCH_PR-}" ;;
  "issue view "*)
    [ "${GH_STUB_ISSUE_FAIL-0}" = "1" ] && exit 1
    printf '%s' "${GH_STUB_ISSUE_BODY-}" ;;
  "pr view "*)
    [ -n "${GH_STUB_SLEEP-}" ] && sleep "$GH_STUB_SLEEP"
    [ "${GH_STUB_PR_FAIL-0}" = "1" ] && exit 1
    # PR-AWARE ON PURPOSE. A stub that answers the same for every PR cannot tell
    # "verified the right PR" from "fell back to the current branch and verified
    # a different one" — the wrong-PR cases below would pass either way. Set
    # GH_STUB_PR_JSON_<n> to give PR <n> its own verdict.
    # Find the PR number wherever it sits in argv — it is `gh pr view <n> --json
    # …`, i.e. $3, and keying this on $2 read the literal word "view", which
    # made the whole PR-awareness silently inert (measured, #291 round 4).
    _n=""; for _a in "$@"; do case "$_a" in ''|*[!0-9]*) ;; *) _n="$_a"; break ;; esac; done
    _alt="GH_STUB_PR_JSON_${_n}"
    if [ -n "${!_alt-}" ]; then printf '%s' "${!_alt}"
    elif [ -n "${GH_STUB_PR_JSON-}" ]; then printf '%s' "$GH_STUB_PR_JSON"
    else printf '%s' '{"reviews":[],"comments":[],"body":""}'; fi ;;
esac
STUBEOF
chmod +x "$STUB/gh"
export PATH="$STUB:$PATH"

# Decision, not exit code: these hooks deny with JSON and exit 0.
decide() {
  local out
  out="$(printf '%s' "$1" | bash "$HOOK" 2>/dev/null)"
  case "$out" in
    *'"permissionDecision":"deny"'*) echo deny ;;
    *) echo allow ;;
  esac
}

payload() { printf '{"tool_input":{"command":%s}}' "$(printf '%s' "$1" | jq -Rs .)"; }

run() { # run <name> <expected> <command>
  local name="$1" expect="$2" got
  got="$(decide "$(payload "$3")")"
  if [ "$got" = "$expect" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  ✗ %s — expected %s, got %s\n' "$name" "$expect" "$got"; fi
}

# WHICH deny, not merely "a deny". This hook has several deny paths and two of
# them are reachable from the same input under different machine load — the
# parse loop's own budget and the post-network `past_deadline`, which share
# `PR_MERGE_GATE_DEADLINE`. Asserting only the decision let the "deadline denies
# removed" mutation SURVIVE on a loaded machine (v1.14.0): the mutant still
# denied, from the other path, and the suite could not tell. Asserting the reason
# kills it in both load regimes.
run_reason() { # run_reason <name> <expected-substring> <command>
  local name="$1" want="$2" out reason
  out="$(printf '%s' "$(payload "$3")" | bash "$HOOK" 2>/dev/null)"
  reason="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)"
  if printf '%s' "$reason" | grep -qF "$want"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); printf '  ✗ %s — deny reason did not contain %s (got: %s)\n' "$name" "$want" "${reason:-<allow>}"; fi
}

# --- verdict fixtures --------------------------------------------------------
# Every fixture entry carries authorAssociation OWNER: that is what a real
# reviewer/owner entry looks like, and since #316 an entry WITHOUT a trusted
# association is not a verdict candidate at all (untrusted cases below build
# their JSON explicitly).
rev()  { printf '{"reviews":[{"submittedAt":"%s","body":"%s","authorAssociation":"OWNER"}],"comments":[],"body":"%s"}' "$1" "$2" "${3:-Refs #1}"; }
both() { # review at $1 body $2 ; comment at $3 body $4
  printf '{"reviews":[{"submittedAt":"%s","body":"%s","authorAssociation":"OWNER"}],"comments":[{"createdAt":"%s","body":"%s","authorAssociation":"OWNER"}],"body":"%s"}' "$1" "$2" "$3" "$4" "${5:-Refs #1}"; }
stranger() { # comment-only fixture with an EXPLICIT association: at $1 body $2 assoc $3
  printf '{"reviews":[],"comments":[{"createdAt":"%s","body":"%s","authorAssociation":"%s"}],"body":"Refs #1"}' "$1" "$2" "$3"; }

AC_UNTICKED='## Acceptance criteria
- [x] done
- [ ] not done
- [ ] also not done'
AC_TICKED='## Acceptance criteria
- [x] done
- [x] also done'

echo "== merge gate self-test =="

# 1. Rule 13 — the reason the gate exists.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "latest verdict REQUEST CHANGES" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" \
  run "latest verdict APPROVED" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON='{"reviews":[],"comments":[],"body":"Refs #1"}' \
  run "no verdict at all" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z 'Looks good, nice work')" \
  run "verdict without the word APPROVE" deny "gh pr merge 284 --squash"

# 2. NEWEST wins, across BOTH streams — the jq-precedence bug that shipped once.
GH_STUB_PR_JSON="$(both 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T11:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "later REQUEST-CHANGES *comment* overrides an approval" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(both 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES' 2026-09-06T11:00:00Z '## ✅ APPROVED')" \
  run "later APPROVE comment overrides REQUEST CHANGES" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON='{"reviews":[],"comments":[{"createdAt":"2026-09-06T10:00:00Z","body":"## ✅ APPROVED","authorAssociation":"OWNER"}],"body":"Refs #1"}' \
  run "APPROVE posted as a COMMENT (the sanctioned path)" allow "gh pr merge 284 --squash"

# 2c. Trusted-author filter (#316): on a PUBLIC repo any passer-by can post an
#     approval-shaped comment. Only OWNER/MEMBER/COLLABORATOR entries are verdict
#     candidates; a missing or unknown association is untrusted, fail-closed.
GH_STUB_PR_JSON="$(stranger 2026-09-06T10:00:00Z '## ✅ APPROVED' NONE)" \
  run "stranger (NONE) approval is not a verdict" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(stranger 2026-09-06T10:00:00Z '## ✅ APPROVED' CONTRIBUTOR)" \
  run "CONTRIBUTOR approval is not a verdict" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON='{"reviews":[],"comments":[{"createdAt":"2026-09-06T10:00:00Z","body":"## ✅ APPROVED"}],"body":"Refs #1"}' \
  run "ABSENT association is untrusted (fail-closed)" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(stranger 2026-09-06T10:00:00Z '## ✅ APPROVED' COLLABORATOR)" \
  run "COLLABORATOR verdict counts (trusted set unchanged)" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(stranger 2026-09-06T10:00:00Z '## ✅ APPROVED' NONE)" \
  run_reason "untrusted-only stream yields the no-verdict deny" "no posted review verdict" "gh pr merge 284 --squash"
# Newest-wins holds WITHIN the trusted set: a later untrusted approval cannot
# supersede the standing trusted REQUEST CHANGES.
GH_STUB_PR_JSON='{"reviews":[{"submittedAt":"2026-09-06T10:00:00Z","body":"## ⛔ REQUEST CHANGES","authorAssociation":"OWNER"}],"comments":[{"createdAt":"2026-09-06T11:00:00Z","body":"## ✅ APPROVED","authorAssociation":"NONE"}],"body":"Refs #1"}' \
  run "later untrusted approval cannot supersede trusted REQUEST CHANGES" deny "gh pr merge 284 --squash"

# 2b. A verdict states itself in its FIRST LINE (v1.13.0 retrospective).
# EVIDENCE: on #291 the author posted two fix-report comments — "## Round 4 — the
# three blockers, each measured against the unfixed hook" and "## Round 7 —
# blocker and all four majors closed" — each newer than the reviewer's standing
# REQUEST CHANGES, and the first marker inside each body is APPROVED/APPROVE.
# Under the old body-wide filter each was "the newest verdict" and the gate would
# have ALLOWED the merge. Reviewer and author post under the SAME identity here,
# so only the marker's POSITION can tell them apart. The first case below FAILS
# against the pre-v1.13.0 hook.
AUTHOR_FIXUP='## Round 4 — the three blockers, each measured against the unfixed hook\n\n**Blocker 1** is closed; the reviewer APPROVED this approach in round 3.'
GH_STUB_PR_JSON="$(both 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES' 2026-09-06T11:00:00Z "$AUTHOR_FIXUP")" \
  run "author fix-report with APPROVE in the BODY is not a verdict" deny "gh pr merge 284 --squash"
AUTHOR_NOTE='## Round 5 — what I changed\n\nThe REQUEST CHANGES findings from round 4 are all fixed in-PR.'
GH_STUB_PR_JSON="$(both 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T11:00:00Z "$AUTHOR_NOTE")" \
  run "author note quoting REQUEST CHANGES does not revoke an approval" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z 'Round 2 review — head abc1234\n\nI checked the migration.\n\nVerdict: APPROVE')" \
  run "marker buried below the heading is not a verdict (fail CLOSED)" deny "gh pr merge 284 --squash"
# A SECOND real false-allow on `main`, found by the reviewer of this change, not
# by its author. #293's second `## ⛔ REJECTED` body contains no marker in its
# heading and exactly one anywhere: the prose "…I will re-run the mutation and
# the suite and expect to approve immediately" (line 108). The old filter matched
# case-INSENSITIVELY anywhere in the body, so that sentence became the verdict and
# the gate ALLOWED the merge while the standing verdict was a rejection.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REJECTED\n\nOne blocker below.\n\nPing me on the new head; I expect to approve immediately.')" \
  run "prose 'expect to approve' is not a verdict (the #293 false-allow)" deny "gh pr merge 284 --squash"
# Heading forms this repo has actually used must all still be recognised.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '⛔ **REQUEST CHANGES** (VERDICT: REQUEST CHANGES)')" \
  run "heading form: bold marker with a parenthetical" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## VERDICT: APPROVE (round 2)')" \
  run "heading form: ## VERDICT: APPROVE" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## Round 3 — ✅ APPROVED')" \
  run "heading form: round number before the marker" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '\n\n## ✅ APPROVED\n\nBody follows.')" \
  run "leading blank lines before the heading" allow "gh pr merge 284 --squash"

# 3. Closes vs unticked acceptance criteria — a blocker four times in v1.12.0.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED' 'Closes #279')" GH_STUB_ISSUE_BODY="$AC_UNTICKED" \
  run "Closes an issue with unticked criteria" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED' 'Refs #279 — AC1 split to #999')" GH_STUB_ISSUE_BODY="$AC_UNTICKED" \
  run "Refs (not Closes) with unticked criteria" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED' 'Closes #279')" GH_STUB_ISSUE_BODY="$AC_TICKED" \
  run "Closes with every criterion ticked" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED' 'Closes #279')" \
GH_STUB_ISSUE_BODY='## Acceptance criteria
- [x] all done

## Follow-ups
- [ ] someday' \
  run "unticked box OUTSIDE the AC section" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED' 'Closes #279')" GH_STUB_ISSUE_FAIL=1 \
  run "issue unreadable -> fail CLOSED" deny "gh pr merge 284 --squash"

# 4. Invocation shapes that used to bypass the gate entirely.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=284 \
  run "no PR number (merges current branch)" deny "gh pr merge --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "--repo before the number" deny "gh --repo mavrovde/beaconfolio pr merge 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "URL form" deny "gh pr merge https://github.com/mavrovde/beaconfolio/pull/284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "env wrapper" deny "env FOO=1 gh pr merge 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "leading assignment" deny "FOO=1 gh pr merge 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "second segment of a compound command" deny "git status && gh pr merge 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "loop-body keyword" deny "for i in 1; do gh pr merge 284; done"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "multi-line command" deny "git status
gh pr merge 284 --squash"

# 4b. Shapes proven to bypass the gate in review round 2.
# An EXECUTED heredoc body is a script, not a document — skipping it
# unconditionally let `bash <<'EOF' … gh pr merge N … EOF` through.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "bash heredoc whose BODY merges" deny "bash <<'EOF'
gh pr merge 284 --squash
EOF"
# The operand can follow flags; the old regex required digits right after
# `merge`, so this fell through to current-branch resolution and checked a
# DIFFERENT PR — the worst failure mode, because it looks like it worked.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "flags before the operand" deny "gh pr merge --squash 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "several flags before the operand" deny "gh pr merge --admin --squash 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "-R and flags before the operand" deny "gh -R o/r pr merge --squash 284"
# Indirection through a shell / xargs / ssh.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "bash -c indirection" deny "bash -c 'gh pr merge 284 --squash'"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "sh -c indirection" deny "sh -c \"gh pr merge 284\""
GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "xargs indirection (PR number comes from stdin -> unknowable)" deny "echo 284 | xargs gh pr merge"
# ssh: the previous version handed `box gh pr merge N` to the recursion, whose
# command word was the HOST — dead code that never matched. MEASURED against the
# pre-round-4 hook: these three ssh shapes, the xargs case above, and the quoted
# -b case below all ALLOWED a REQUEST-CHANGES PR (5 of the 7 cases added here).
# `eval` and the no-operand case already denied; they pin that they still do.
GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "ssh bare host" deny "ssh box gh pr merge 284"
GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "ssh user@host" deny "ssh user@host gh pr merge 284"
GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "ssh with a flag and a quoted script" deny "ssh -p 22 box 'gh pr merge 284'"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "eval indirection" deny "eval 'gh pr merge 284 --squash'"
# A quoted flag VALUE word-splits, so the operand parse yields something that is
# not a PR number. Falling back to the current branch verified a DIFFERENT PR
# and allowed the merge — round-2 blocker 3 one level deeper.
GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "quoted flag value before the operand" deny "gh pr merge -b \"squash msg\" 284"
# The DOCUMENTED BYPASS, tested the way a caller actually writes it: as a
# command PREFIX. The old case set the variable in the HARNESS environment,
# which a real caller cannot do -- it certified a path nobody can take, this
# PR's own fake-green class (round-4 review, lessons §34).
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "bypass as a command prefix (the documented form)" allow "PR_MERGE_GATE=0 gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "bypass after other assignments" allow "FOO=1 PR_MERGE_GATE=0 gh pr merge 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "a DIFFERENT variable set to 0 does not bypass" deny "OTHER_GATE=0 gh pr merge 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "PR_MERGE_GATE=1 does not bypass" deny "PR_MERGE_GATE=1 gh pr merge 284"
# LEGITIMATE shapes. Ground truth `gh help pr merge`: the operand is
# `[<number> | <url> | <branch>]`, and -A/-F/-R/-t/-b/--match-head-commit take
# values. Round 4 read those VALUES as the operand and denied an APPROVED PR --
# a hard stop on the sanctioned deploy trigger, with a bypass that did not work.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "--repo before the operand" allow "gh pr merge --repo mavrovde/beaconfolio 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "-R before the operand" allow "gh pr merge -R mavrovde/beaconfolio 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "--body-file before the operand" allow "gh pr merge --body-file notes.md 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "-F before the operand" allow "gh pr merge -F notes.md 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "-A author-email before the operand" allow "gh pr merge -A me@example.com 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "a QUOTED number is still that PR" allow "gh pr merge \"284\" --squash"
# ...and those same flags must not become a way to smuggle a bad merge past.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "--repo before the operand, REQUEST CHANGES" deny "gh pr merge --repo mavrovde/beaconfolio 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_CURRENT_PR=999 \
  run "-F before the operand, REQUEST CHANGES" deny "gh pr merge -F notes.md 284"
# A BRANCH is valid gh input. Expect ALLOW, and only the RESOLVED PR is the
# approved one: had the branch failed to resolve, the hook would fail closed and
# deny -- so this case tells "resolved the branch" from "gave up", which is the
# round-4 lesson (§34) applied to its own fix.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
GH_STUB_PR_JSON_284="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" \
GH_STUB_CURRENT_PR=999 GH_STUB_BRANCH_PR=284 \
  run "a branch operand resolves to its PR" allow "gh pr merge feat/release-retro --squash"
# An operand this hook cannot evaluate still fails closed.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "an unresolvable operand fails closed" deny "gh pr merge \$PR --squash"
# ROUND-5 REGRESSION, and the worst kind: the gate ALLOWED while verifying the
# wrong PR. `set -- $seg` split `-b "squash 999" 284` into `-b` `"squash` `999"`
# `284`, and the quote-strip sed turned `999"` into a valid PR number — so the
# gate read 999 (APPROVED) and merged 284 (REQUEST CHANGES). argv_split models
# the quoting AT THE SPLIT, which is the only place it is safe.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "quoted flag value ENDING IN DIGITS cannot forge the operand" deny "gh pr merge -b \"squash 999\" 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "quoted subject ending in digits" deny "gh pr merge -t \"release v1.13.0\" 284"
# ...and the same quoting must not deny a LEGITIMATE merge of an approved PR.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "quoted body with spaces, approved PR" allow "gh pr merge -b \"squash msg\" 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "single-quoted multi-word body" allow "gh pr merge -b 'multi word body' 284"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "quoted subject, approved PR" allow "gh pr merge -t \"release v1.13.0\" 284"
# TWO merges in one command: the first was kept unverified because only the LAST
# segment survived. Every merge is checked now.
GH_STUB_PR_JSON_284="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "two merges, the FIRST one unapproved" deny "gh pr merge 284 && gh pr merge 999"
GH_STUB_PR_JSON_284="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=284 \
  run "two merges, the SECOND one unapproved" deny "gh pr merge 284 && gh pr merge 999"
GH_STUB_PR_JSON_284="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=284 \
  run "two merges, both approved" allow "gh pr merge 284 && gh pr merge 999"
# An unknowable operand on ONE merge must not poison an unrelated later merge.
GH_STUB_PR_JSON_284="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=284 \
  run "xargs on an unrelated command, then a legitimate merge" deny "echo 1 | xargs gh pr merge && gh pr merge 284"
# ROUND-7 BLOCKER: a quoted flag value containing a NEWLINE, before the
# operand. The main loop reads line-at-a-time, so argv_split saw a fragment
# with an open quote, lost the operand, and fell back to the CURRENT branch's
# PR (approved) while merging a REQUEST-CHANGES one -> ALLOW. Unterminated
# quote now marks the target unknowable and denies.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "newline inside a quoted flag value before the operand" deny "gh pr merge --squash -b \"line one
line two\" 284"
# ...operand BEFORE the flag: ALSO a deny, via the unknowable-target path — the
# cut still truncates the argv, and the gate refuses rather than trusting an
# operand read from a fragment. (This case also denied at `8142166`, by a
# different path, so it pins the fail-closed OUTCOME, not a round-7 regression —
# stated so nobody later cites it as one. The regression pin is the case above.)
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" GH_STUB_PR_JSON_999="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=999 \
  run "newline in a quoted flag value after the operand" deny "gh pr merge 284 --squash -b \"one
two\""
# The reviewer's exact poisoning shape: an xargs that is NOT a merge must not
# taint a later legitimate merge (round 6 claimed this; the case tested the
# wrong shape).
GH_STUB_PR_JSON_284="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=284 \
  run "non-merge xargs then a legitimate merge" allow "ls /tmp | xargs echo && gh pr merge 284"
# COST: a monster command must fail CLOSED inside the deadline, because a
# timed-out PreToolUse hook does not deny (#219). 3000 segments measured 39s
# against a 30s cap before this round.
# Over the 24KB bound WITH a merge word -> instant deny, never a timeout-allow.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" \
  run "oversized command containing a merge fails closed in O(1)" deny "$(python3 -c "print(' ; '.join(['echo merge x']*3000))")"
# ...and that deny must be O(1), not a deadline crawl: without the size bound
# the same command parses for ~39s — past the 30s PreToolUse cap, where a
# timeout is an ALLOW. The decision alone cannot pin this (the deadline denies
# eventually either way), so the LATENCY is asserted — which is also what kills
# the size-bound mutation.
COST_T0=$SECONDS
decide "$(payload "$(python3 -c "print(' ; '.join(['echo merge x']*3000))")")" >/dev/null
if [ $((SECONDS - COST_T0)) -gt 10 ]; then
  FAIL=$((FAIL+1)); printf '  ✗ oversized-merge deny took %ss (must be O(1), <=10s)\n' "$((SECONDS - COST_T0))"
else
  PASS=$((PASS+1))
fi
# Over the bound with NO merge word anywhere -> not this gate's business.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "oversized command with no merge word stays allowed" allow "$(python3 -c "print(' ; '.join(['true x']*4000))")"
# Under the bound, thousands of segments parse INSIDE the deadline (cheap
# per-segment reject) and the verdict still gates the real merge at the end.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "600 cheap segments then a real merge still denies" deny "$(python3 -c "print(' ; '.join(['true']*600) + ' && gh pr merge 284')")"
# ...but a genuinely absent operand still resolves the current branch's PR.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_CURRENT_PR=284 \
  run "no operand still resolves the current branch" allow "gh pr merge --squash"
# An APPROVE that merely QUOTES the phrase must not deny (this review thread
# does exactly that). Measured base rate across v1.12.0's PRs: zero verdicts
# change meaning under the windowed check.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED — round 3\n\nThe round-2 REQUEST CHANGES findings are all fixed.')" \
  run "approval that mentions REQUEST CHANGES later in its body" allow "gh pr merge 284 --squash"

# 4b. The approval must COVER the head (v1.14.0 retrospective).
# EVIDENCE, measured by replaying the real threads as they stood at merge time:
# four of v1.14.0's ten reviewed merges carried commits no approval had seen —
# #320 (four commits, including five review-finding fixes and a behaviour change,
# after its only verdict), #315 (the six-finding fix commit; merged two seconds
# before the delta-confirm was posted) and #314 (a merge of `main`). The gate as
# it stood allowed all three: it asked whether the newest verdict says APPROVE,
# never whether it had seen the code. Every case below FAILS against that hook.
revc() { # revc <verdict-at> <verdict-body> <commit-date> <headline>
  printf '{"reviews":[{"submittedAt":"%s","body":"%s","authorAssociation":"OWNER"}],"comments":[],"body":"Refs #1","commits":[{"committedDate":"%s","oid":"abcdef1234567890","messageHeadline":"%s"}]}' \
    "$1" "$2" "$3" "$4"
}
GH_STUB_PR_JSON="$(revc 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T09:00:00Z 'the reviewed commit')" \
  run "approval NEWER than every commit still merges" allow "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(revc 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T11:00:00Z 'fix: the five review findings')" \
  run "a commit landing AFTER the approval blocks the merge (the #320 shape)" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(revc 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T11:00:00Z 'Merge remote-tracking branch origin/main')" \
  run_reason "…and the deny names the commit, so the author knows what to re-confirm" \
    "Merge remote-tracking branch" "gh pr merge 284 --squash"
# A merge of `main` is NOT a benign exception: #325's Alembic head fork — a
# backend that would not have booted in production — was created by exactly that,
# on a branch whose own gates were all green.
GH_STUB_PR_JSON="$(revc 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T11:00:00Z 'Merge branch main (the #314 shape)')" \
  run "a merge-of-main commit after the approval is not exempt" deny "gh pr merge 284 --squash"
# Equal timestamps are NOT "after" — an approval posted in the same second as the
# commit it reviews must not deadlock the author.
GH_STUB_PR_JSON="$(revc 2026-09-06T10:00:00Z '## ✅ APPROVED' 2026-09-06T10:00:00Z 'same instant')" \
  run "a commit at exactly the verdict's timestamp is covered" allow "gh pr merge 284 --squash"
# Check 1 runs first: a stale REQUEST CHANGES must still report rule 13, not
# staleness, or the author fixes the wrong thing.
GH_STUB_PR_JSON="$(revc 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES' 2026-09-06T11:00:00Z 'fix attempt')" \
  run_reason "a REQUEST CHANGES with newer commits still reports rule 13 first" \
    "latest verdict is REQUEST CHANGES" "gh pr merge 284 --squash"
# The delta-confirm is the remedy and this repo already posts it (#315 round 2,
# "APPROVE — round 2 (delta-confirm at 2a7c1a0)"). It must actually unblock.
GH_STUB_PR_JSON='{"reviews":[{"submittedAt":"2026-09-06T10:00:00Z","body":"## ✅ APPROVED","authorAssociation":"OWNER"}],"comments":[{"createdAt":"2026-09-06T12:00:00Z","body":"## ✅ APPROVE — round 2 (delta-confirm at abcdef1)","authorAssociation":"OWNER"}],"body":"Refs #1","commits":[{"committedDate":"2026-09-06T11:00:00Z","oid":"abcdef1234567890","messageHeadline":"fix: findings"}]}' \
  run "a delta-confirm verdict on the new head unblocks the merge" allow "gh pr merge 284 --squash"
# A PR whose `commits` field is absent (older gh, or a stub) is not evidence of
# staleness — documented as fail-OPEN here because the field comes from the same
# call that carried the verdict, so its absence means gh answered nothing, and
# denying every merge on that would make the gate unusable rather than safer.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" \
  run "no commits field at all does not block" allow "gh pr merge 284 --squash"

# 5. Quoted prose is DATA (#204/#237) — the false-positive direction.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "phrase quoted in a comment body" allow "gh pr comment 284 --body 'do not gh pr merge 284 yet'"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "echo of the phrase" allow "echo 'next: gh pr merge 284'"
run "unrelated command" allow "git status"
run "gh pr view is not a merge" allow "gh pr view 284 --json state"
run "git merge is not a PR merge" allow "git merge origin/main"

# The gate blocked its OWN commit before this case existed: a commit message
# quoting `gh pr merge` inside a heredoc read as a command. Heredoc bodies are
# DATA (#212/#237) — this is the false-positive direction, and it is the one
# that stops work rather than merely failing to stop it.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "commit message heredoc quoting the phrase" allow "git commit -q -F - <<EOF
fix: ten shapes ALLOWED a REQUEST-CHANGES PR, including gh pr merge with no number
EOF"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "quoted heredoc body quoting the phrase" allow "cat > /tmp/body.md <<'MD'
Do not gh pr merge 284 until the review lands.
MD"
# ...but a REAL merge on the line that OPENS a heredoc is still a merge.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "merge on the heredoc-opening line still gates" deny "gh pr merge 284 --body-file - <<EOF
notes
EOF"

# 6. Fail closed on anything unverifiable.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" PR_MERGE_GATE_DEADLINE=0 \
  run "deadline exceeded" deny "gh pr merge 284 --squash"
# A SLOW gh, not a zero deadline: this reaches the `past_deadline && deny` lines
# after the network call, which the zero-deadline case short-circuits before.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_SLEEP=2 PR_MERGE_GATE_DEADLINE=1 \
  run "gh slower than the deadline" deny "gh pr merge 284 --squash"
# ...and it must be THAT deny, not the parse loop's. See run_reason's header:
# under load the loop's budget fires first, both paths deny, and a
# decision-only assertion let the deadline mutation survive.
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ✅ APPROVED')" GH_STUB_SLEEP=2 PR_MERGE_GATE_DEADLINE=1 \
  run_reason "gh slower than the deadline denies from the POST-NETWORK budget" \
    "could not finish within" "gh pr merge 284 --squash"
GH_STUB_PR_FAIL=1 \
  run "PR unreadable" deny "gh pr merge 284 --squash"
GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "no PR number and no current-branch PR" deny "gh pr merge --squash"

# 7. The documented bypass.
# The SESSION-ENV form (the hook process itself inherits the variable) -- a
# different path from the command-prefix form above, which is what the deny
# message advertises and what a caller can actually type.
PR_MERGE_GATE=0 GH_STUB_PR_JSON="$(rev 2026-09-06T10:00:00Z '## ⛔ REQUEST CHANGES')" \
  run "PR_MERGE_GATE=0 in the hook's own environment" allow "gh pr merge 284 --squash"

echo "merge gate self-test: $PASS passed, $FAIL failed"

# --- Mutation contract -------------------------------------------------------
# `--mutations` proves the cases above actually bite. The FIRST version of this
# section was itself fake-green: mutants were written to a temp dir WITHOUT
# `hook-parse-lib.sh`, so every mutant died on a missing library — a
# byte-identical copy "died" too, and the honest score was 4 of 10. The harness
# now defends against that specific failure:
#   * the shared lib is copied beside the mutant, so a mutant fails for its OWN
#     reason;
#   * an IDENTITY mutation must SURVIVE — if it dies, the harness is broken and
#     every other result is meaningless, so the run aborts;
#   * a mutation that produces NO diff, or that leaves the script unparseable
#     (`bash -n`), is an invalid experiment and fails the contract rather than
#     counting as a kill.
if [ "${1-}" = "--mutations" ]; then
  echo
  echo "== mutation contract =="
  MPASS=0; MFAIL=0; MBAD=0
  MDIR="$STUB/mut"; mkdir -p "$MDIR"
  cp "$(dirname "$HOOK")/hook-parse-lib.sh" "$MDIR/" 2>/dev/null || {
    echo "  ✗ HARNESS: cannot copy hook-parse-lib.sh — mutants would die for the wrong reason"; exit 1; }
  WORK="$MDIR/pre-merge-gate.sh"

  apply() { # apply <python-expr-file-content> -> writes WORK, echoes changed?
    python3 - "$HOOK" "$WORK" "$1" <<'PY'
import sys, re
src, dst, spec = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src).read()
kind, _, arg = spec.partition("::")
if kind == "identity":
    out = text
elif kind == "replace":
    a, _, b = arg.partition("=>")
    out = text.replace(a, b)
elif kind == "delete_block":
    # delete from the line containing arg up to (not including) the next line
    # that is a closing `fi`/`}` at the same indent, keeping the script parseable
    lines = text.split("\n")
    out_lines, i = [], 0
    while i < len(lines):
        if arg in lines[i]:
            indent = len(lines[i]) - len(lines[i].lstrip())
            i += 1
            while i < len(lines):
                stripped = lines[i].strip()
                cur = len(lines[i]) - len(lines[i].lstrip())
                if stripped in ("fi", "}", "done") and cur <= indent:
                    i += 1
                    break
                if stripped and cur <= indent and not stripped.startswith(("|", "&", "#")):
                    break
                i += 1
            continue
        out_lines.append(lines[i]); i += 1
    out = "\n".join(out_lines)
else:
    raise SystemExit("unknown mutation kind: " + kind)
open(dst, "w").write(out)
print("CHANGED" if out != text else "SAME")
PY
  }

  mutate() { # mutate <expect: die|survive> <name> <spec>
    local expect="$1" name="$2" spec="$3" changed rc
    changed="$(apply "$spec")" || { echo "  ✗ INVALID: $name (mutation script failed)"; MBAD=$((MBAD+1)); return; }
    if [ "$expect" = "die" ] && [ "$changed" = "SAME" ]; then
      echo "  ✗ INVALID: $name — produced NO diff, so it tests nothing"; MBAD=$((MBAD+1)); return
    fi
    chmod +x "$WORK"
    if ! bash -n "$WORK" 2>/dev/null; then
      echo "  ✗ INVALID: $name — mutant is not parseable; a syntax error is not a kill"; MBAD=$((MBAD+1)); return
    fi
    HOOK="$WORK" bash "$0" >/dev/null 2>&1; rc=$?
    if [ "$expect" = "survive" ]; then
      if [ $rc -eq 0 ]; then echo "  ✓ control survived: $name"
      else echo "  ✗ HARNESS BROKEN: $name should survive but died — every other result is meaningless"; MBAD=$((MBAD+1)); fi
      return
    fi
    if [ $rc -ne 0 ]; then MPASS=$((MPASS+1)); printf '  ✓ killed: %s\n' "$name"
    else MFAIL=$((MFAIL+1)); printf '  ✗ SURVIVED: %s\n' "$name"; fi
  }

  # CONTROL FIRST: an unmodified copy must pass. If this dies, the harness is
  # lying and nothing below can be trusted.
  mutate survive "identity (byte-identical copy)" "identity::"
  [ "$MBAD" -eq 0 ] || { echo "mutation contract: HARNESS INVALID"; exit 1; }

  mutate die "deny() emits allow instead of deny" \
    'replace::permissionDecision\":\"deny=>permissionDecision\":\"allow'
  # NOT a mutation, for the same reason as the empty-verdict deny: a
  # REQUEST-CHANGES marker also fails the APPROVE test, so deleting this check
  # changes no decision. Both were mutation-tested, both SURVIVED, and both are
  # documented as message-only in the hook rather than pinned by cases that
  # cannot fail. Exactly one check here is load-bearing: APPROVE.
  mutate die "APPROVE requirement inverted" \
    "replace::grep -qiE 'APPROVE'=>grep -qivE 'APPROVE'"
  # NOT a mutation: the empty-verdict deny is message-only — an empty verdict
  # also yields an empty FIRST_MARKER, so the APPROVE check denies anyway. The
  # two are behaviourally equivalent for every input the jq filter admits, so a
  # case for it could not fail. Documented in the hook instead - the #240 answer.
  mutate die "newest-verdict selection reversed" \
    'replace::sort_by(.at) | (last=>sort_by(.at) | (first'
  mutate die "verdict selection falls back to marker-anywhere-in-body" \
    'replace::(heading | test("APPROVE|APPROVED|REQUEST CHANGES"; "i"))=>((.body // "") | test("APPROVE|APPROVED|REQUEST CHANGES"; "i"))'
  # NOT a mutation: reading FIRST_MARKER from $VERDICT instead of $HEADING is
  # behaviourally EQUIVALENT once the selection filter above requires a marker in
  # the heading — the heading IS the body's first line, so the first marker in the
  # whole body is the heading's marker for every input the filter admits. Tried it;
  # it produced no behavioural difference, so a case for it could not fail. Same
  # answer as the empty-verdict deny above (#240): document the equivalence, do not
  # dress it up as a passing case. The load-bearing half is the SELECTION mutation
  # directly above, which is killed.
  mutate die "comments stream dropped" \
    'replace::((.comments // [])[] | {at: .createdAt,   body: (.body // ""), assoc: (.authorAssociation // "NONE")}) =>'
  # #316: the trusted-author filter must actually gate. Removing it lets an
  # untrusted (NONE) approval-shaped comment count as a verdict — the
  # "stranger approval is not a verdict" case above fails without it.
  mutate die "trusted-author filter removed (any public commenter can approve)" \
    'replace::and (.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR")=>'
  mutate die "approval-covers-head check removed (the #320 shape merges again)" \
    'delete_block::if [ -n "$NEWER" ]; then'
  mutate die "staleness comparison flipped (older commits would block instead)" \
    'replace::select(((.committedDate // "") > $at))=>select(((.committedDate // "") < $at))'
  mutate die "Closes/AC check removed" \
    'delete_block::if [ "${UNCHECKED:-0}" -gt 0 ]'
  mutate die "unreadable issue fails OPEN" \
    'replace::|| deny "PR #$PR_NUM says it closes #$issue but that issue could not be read=>|| true # '
  mutate die "heredoc bodies always treated as data" \
    'replace::[ -n "$delim" ] && line_is_all_text_tools "$line"=>[ -n "$delim" ]'
  mutate die "operand-after-flags ignored (falls back to current branch)" \
    "replace::UNQUOTED=\"\$MERGE_OPERAND\"=>UNQUOTED=\"\""
  mutate die "deadline denies removed" \
    "replace::past_deadline && deny=>false && deny"
  mutate die "unterminated-quote signal ignored (newline in a flag value)" \
    'replace::[ "${ARGV_SPLIT_UNTERMINATED:-0}" = "1" ] && MERGE_OPERAND_UNKNOWABLE=1=>false && MERGE_OPERAND_UNKNOWABLE=1'
  mutate die "size bound removed (oversized merge would timeout-allow)" \
    'replace::[ "${#CMD}" -gt 24576 ]=>[ "${#CMD}" -gt 99999999 ]'
  mutate die "the command-prefix bypass stops being recognised" \
    "replace::PR_MERGE_GATE=0( |\$)'=>PR_MERGE_GATE=0_NEVER( |\$)'"
  mutate die "value-taking gh flags dropped from the operand walk" \
    'replace::-b|--body|-t|--subject|-F|--body-file|-A|--author-email|-R|--repo|--match-head-commit=>-b|--body|-t|--subject|--match-head-commit'
  mutate die "branch operands no longer resolved (valid input fails closed)" \
    "replace::PR_NUM=\"\$(gh pr view \"\$UNQUOTED\" --json number=>PR_NUM=\"\$(true \"\$UNQUOTED\" --json number"
  mutate die "argv_split replaced by IFS word-splitting (the round-5 regression)" \
    "replace::set -- \"\${ARGV_SPLIT_RESULT[@]}\"=>local IFS=' '; set -- \$seg"
  mutate die "only the LAST merge in a command is verified" \
    'replace::MERGE_OPERANDS+=("$MERGE_OPERAND")=>MERGE_OPERANDS=("$MERGE_OPERAND")'
  mutate die "indirection (bash -c / eval / ssh) no longer inspected" \
    'replace::inner_script_invokes_pr_merge "$seg" && return 0=>false && return 0'

  echo "mutation contract: $MPASS killed, $MFAIL survived, $MBAD invalid"
  [ "$MFAIL" -eq 0 ] && [ "$MBAD" -eq 0 ] || exit 1
fi

[ "$FAIL" -eq 0 ]
