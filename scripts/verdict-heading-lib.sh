#!/usr/bin/env bash
# THE verdict-heading grammar — one definition, three consumers.
#
# A review verdict in this repo is a COMMENT (same-identity `gh pr review
# --approve` is blocked), so nothing but the TEXT separates the reviewer's
# verdict from the author's fix report: both are posted by the same GitHub
# account. Since the v1.13.0 retrospective the separator has been POSITION —
# "the marker must be in the first non-empty line" — and three places
# implemented that sentence independently:
#
#   .claude/hooks/pre-merge-gate.sh       decides whether a merge may proceed
#   scripts/audit_no_verdict_merges.sh    decides whether a merged PR was gated
#   scripts/retro_metrics.sh              counts review rounds for the retro
#
# All three read `test("APPROVE|REQUEST CHANGES"; "i")` over that first line,
# which is not "the line STATES the verdict" but "the line MENTIONS it
# somewhere". A fix report that opens "Round-3 delta — … the round-3 APPROVE
# covered `70a8cfb4`; … it needs a delta-confirm rather than standing." is
# selected as the newest verdict and read as an APPROVE.
#
# MEASURED, v1.16.0 retrospective — 229 merged PRs, 361 marker-bearing first
# lines from trusted associations. Seven do not state a verdict; six of those
# seven are the AUTHOR's own notes (#181, #281, #373, #400, #421, #458) and the
# seventh is #83's July blockquote verdict, which predates every audit window.
# Replaying `pre-merge-gate.sh` at the instant each was posted, THREE flip the
# gate's decision from ALLOW to DENY once this grammar is applied:
#
#   #181  the author's "Approved-with-findings applied before merge:" covers a
#         head the reviewer's APPROVE (100 seconds earlier) had not seen;
#   #281  same shape, "Round-1 APPROVE findings applied on `1abb0fe`";
#   #458  (v1.16.0) "…the round-3 APPROVE covered `70a8cfb4`; two things moved
#         since, so it needs a delta-confirm rather than standing" — a sentence
#         that asks for a new verdict, read by the gate as the new verdict, and
#         post-dating the head, so check 1b's approval-covers-head test passed
#         on the author's timestamp. Between 00:08:23Z and the real round-4
#         APPROVE at 00:22:36Z the gate would have allowed that merge.
#
# The hook's own note said the residual stayed unpinned because "no lexical rule
# separates it from a REAL reviewer heading that also puts prose BEFORE the
# marker", naming `## Round 3 — ✅ APPROVED`, `## Round 2 — ⛔ REJECTED (…)` and
# `PR-REVIEWER VERDICT: APPROVE`. Measurement refutes that: a whitelist of those
# two prefixes plus a word boundary after the marker accepts 354 of the 361 and
# rejects exactly the seven above. Only #83's classification changes anywhere in
# recorded history (APPROVED -> NONE, 2026-07-26, outside every audit window).
#
# The hook also carried a REVISIT TRIGGER — "the first fix report with a leading
# marker posted while the standing verdict is NEGATIVE". It never fired, and the
# hole went live anyway: check 1b (approval-covers-head, v1.14.0) was added to
# the SAME selection a year of comments later, and against check 1b a POSITIVE
# standing verdict is exactly the dangerous case. A revisit trigger written
# against one check does not migrate when a second check joins it — so this
# grammar is enforced by cases, not by a trigger anyone has to remember.
#
# THE GRAMMAR (fail-closed: anything it does not recognise is NOT a verdict, and
# every consumer's "no verdict" branch denies, reports or refuses to count):
#   * strip leading non-letters — `#`, `>`, `*`, backticks, spaces, emoji;
#   * allow at most one of two measured prefixes:
#       `[PR-REVIEWER ]VERDICT:`      (#171)
#       `Round N —`                   (#255) — the dash is load-bearing: it is
#       what separates the heading `## Round 3 — ✅ APPROVED` from the prose
#       `Round-1 APPROVE findings applied on …`;
#   * strip decoration again (`✅`, `**`);
#   * then the line must BEGIN with APPROVE/APPROVED/REQUEST CHANGES/REJECT/
#     REJECTED, followed by end-of-line or a non-word, non-hyphen character —
#     the hyphen clause is what rejects `Approved-with-findings applied …`.
#
# TWO ENGINES EVALUATE THIS. jq (Oniguruma) runs it in the hook and the audit;
# `gh … -q` (gojq, Go's RE2) runs it in retro_metrics.sh, and RE2 has no
# lookahead. Measured 2026-09-19: the first draft expressed the trailing
# boundary as `(?![A-Za-z0-9-])`, passed every self-test under jq, and died at
# runtime under gh with "invalid or unsupported Perl syntax: `(?!`". The
# boundary is therefore spelled `([^A-Za-z0-9-].*)?$`, and the self-test has a
# case that fails if a lookahead/lookbehind/backreference is reintroduced —
# because the suite cannot reach gojq offline, and "it passed my jq" is exactly
# the claim-not-measured defect this grammar came out of.
#
# Consumers source this file and splice $VERDICT_HEADING_JQ_DEFS into their jq
# program; $VERDICT_HEADING_LIB overrides the path so a mutation harness can
# point a mutant copy at the real library instead of dying for the wrong reason.
#
# Self-test: scripts/verdict-heading-lib.test.sh (real headings, mutation
# contract 6/0/0). Every accepted case names the PR it was measured on.

# shellcheck disable=SC2034  # consumed by callers after sourcing
VERDICT_HEADING_JQ_DEFS='
def vh_norm:
  reduce range(0; 3) as $_ (.;
      sub("^[^A-Za-z]+"; "")
    | sub("^(?:PR-REVIEWER[^A-Za-z]{0,3})?VERDICT[^A-Za-z]*"; ""; "i")
    | sub("^ROUND[ \t-]*[0-9]+[ \t]*[-–—:][ \t]*"; ""; "i"));
def vh_heading: (.body // "") | split("\n") | map(select(test("\\S"))) | (.[0] // "");
def vh_is_verdict:
  vh_norm | test("^(APPROVED?|REQUEST[ \t]+CHANGES|REJECTED?)([^A-Za-z0-9-].*)?$"; "i");
'
