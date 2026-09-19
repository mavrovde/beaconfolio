#!/usr/bin/env bash
# audit_no_verdict_merges.sh — find merged PRs whose rule-13 gate did not
# actually gate (#392, v1.14.1 retrospective change B; ORDERING added by #409).
#
#   bash scripts/audit_no_verdict_merges.sh [--since ISO8601] [--limit N]
#   bash scripts/audit_no_verdict_merges.sh --fixture DIR        # test seam
#
# WHY: rule 13 admits no carve-out, yet #321 (v1.14.0, a Dependabot PR) and
# #355 (v1.14.1, GitHub's security-tab "set up this workflow" flow) each merged
# with ZERO verdicts. Mechanism, established for the record: both flows merge in
# the GitHub WEB UI, where a PreToolUse hook does not exist — the gate guards
# `gh pr merge` from this CLI and nothing else. Merge provenance is unmeasurable
# here (owner and agents share one identity), so the web-UI path cannot be
# hooked; it can only be DETECTED afterwards. This script is the detector, run
# red-when-dirty by .github/workflows/verdict-audit.yml — the same alarm shape
# as Live Freshness (a scheduled workflow that is red whenever the invariant is
# broken), because a red workflow gets looked at and a log line does not.
#
# ORDERING IS THE POINT, and for three releases it was missing (#409). The
# first version asked only whether a merged PR CARRIES a verdict. A verdict
# back-filled after the merge satisfied that exactly as well as a review that
# gated it — so the v1.14.2 window, containing five zero-verdict merges and one
# merge against a standing REQUEST CHANGES, was reported CLEAN. Measured: #394,
# #395, #396, #397 and #403 merged 14:23:19-14:41:56Z with nothing posted
# before `mergedAt`, and #402 merged 14:36:08Z over a `## ⛔ REQUEST CHANGES —
# round 1` from 13:34:49Z; all six then received `APPROVE — retrospective
# review (round 1)` between 15:45:11Z and 15:45:30Z. A retrospective verdict is
# an honest fix-forward record and it is NOT a gate; a detector that cannot
# tell the two apart reports a release as reviewed when it was not.
#
# So a PR is judged on the NEWEST verdict posted at or before `mergedAt`, and
# the two failure shapes are reported DISTINCTLY, because they call for
# different actions:
#   NO-VERDICT  — nothing gated the merge at all (post a retrospective review).
#   UNAPPROVED  — the newest pre-merge verdict was REQUEST CHANGES: the gate
#                 ran, said no, and the merge happened anyway. No prior release
#                 had this shape and nothing detected it before #409.
# Verdicts posted AFTER the merge are surfaced as an informational `back-filled`
# note. Never as a pass — that is the bug this replaces — and never as a
# violation of its own: back-filling is the right thing to do once the merge has
# already happened.
#
# THE VERDICT DEFINITION IS NOW LITERALLY SHARED WITH pre-merge-gate.sh (#399
# review, major 5 — the first draft claimed to inherit it and silently dropped
# two clauses; the v1.16.0 retro found the three copies had drifted anyway):
# a posted body whose FIRST NON-EMPTY LINE **states** a verdict per
# scripts/verdict-heading-lib.sh, AND whose author carries a trusted
# association (OWNER/MEMBER/COLLABORATOR — the #316 rule; without it a drive-by
# NONE commenter's "## APPROVE" silences the alarm). Reviews AND issue comments
# count (same-identity repos post comment verdicts). Known limit, footnoted in
# docs/retrospectives/README.md: position is not authorship. Since #409 the gate's `.at != null` clause is inherited too — this
# detector now orders by time, so an undated body cannot be placed relative to
# the merge and must not be counted.
#
# APPROVE-vs-REQUEST-CHANGES is decided by the FIRST marker in the heading, not
# by "does the heading contain REQUEST CHANGES" — mirroring the gate's
# `grep -oiE 'REQUEST CHANGES|APPROVED?' | head -1`. Review threads routinely
# approve while naming the round they supersede ("the REQUEST CHANGES findings
# are fixed"), and a contains-test would score that heading UNAPPROVED.
#
# Timestamps are compared as ISO-8601 strings, which is only valid because the
# GitHub API returns them Z-normalised and fixed-width. Feed this local-offset
# times and the comparison is nonsense — normalise first (scripts/retro_metrics.sh
# does the same and says so).
#
# Exit: 0 = every merged PR in the window was gated; 1 = at least one was not
# (each is printed); 2 = cannot measure (API/jq failure) — fail LOUD, never
# silently green (the #398 lesson: a check that skips is a fake green).
set -u

SINCE=""
LIMIT=40
FIXTURE=""
ACK_FILE="$(cd "$(dirname "$0")" && pwd)/verdict-audit-acknowledged.txt"
# The verdict-heading grammar is SHARED with .claude/hooks/pre-merge-gate.sh and
# scripts/retro_metrics.sh — see scripts/verdict-heading-lib.sh for the sweep
# that produced it (v1.16.0 retrospective). This detector used the loose form
# too, so an author's note whose first line merely MENTIONS a marker could be
# the "newest pre-merge verdict" that silences the alarm. Measured over all 229
# merged PRs, tightening changes exactly ONE classification: #83 (2026-07-26,
# a blockquoted verdict) goes APPROVED -> NONE, which is outside every window
# this runs on. $VERDICT_HEADING_LIB lets the mutation harness point a mutant
# copy at the real library instead of dying for the wrong reason.
VERDICT_HEADING_LIB="${VERDICT_HEADING_LIB:-$(cd "$(dirname "$0")" && pwd)/verdict-heading-lib.sh}"
# shellcheck disable=SC1090
[ -r "$VERDICT_HEADING_LIB" ] && . "$VERDICT_HEADING_LIB"
[ -n "${VERDICT_HEADING_JQ_DEFS:-}" ] || {
  echo "audit: cannot read the verdict-heading grammar ($VERDICT_HEADING_LIB) — cannot measure" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --since)   [ $# -ge 2 ] || { echo "audit: --since needs a value — cannot measure" >&2; exit 2; }
               # A non-date here would flow into --search "merged:>=banana",
               # which GitHub answers with an EMPTY window — a quiet green
               # (#399 round 2, minor 2). Fail loud instead.
               case "$2" in
                 [0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]*) SINCE="$2" ;;
                 *) echo "audit: --since '$2' is not an ISO date — cannot measure" >&2; exit 2 ;;
               esac
               shift 2 ;;
    --limit)   [ $# -ge 2 ] || { echo "audit: --limit needs a value — cannot measure" >&2; exit 2; }
               LIMIT="$2"; shift 2 ;;
    --fixture) FIXTURE="$2"; shift 2 ;;
    --ack)     [ $# -ge 2 ] || { echo "audit: --ack needs a value — cannot measure" >&2; exit 2; }
               ACK_FILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO="mavrovde/beaconfolio"

# --- acknowledged violations (#409) -----------------------------------------
# Merges already on the record, named ONE BY ONE in scripts/verdict-audit-acknowledged.txt.
# Making the audit order-aware turned the cutover window from "clean" into seven
# real violations that cannot be repaired — back-filling is explicitly not a
# gate. Without a ledger the workflow would be red forever, and a permanently
# red alarm is a disabled alarm: the exact failure this control exists to avoid.
#
# NOT a date amnesty. Moving --since forward would hide every violation in the
# range, including ones nobody has read; this hides exactly the PRs listed, so a
# NEW violation in the SAME window still goes red.
#
# A missing/unreadable file yields an EMPTY ledger — the audit can only get
# redder, never greener, if it disappears. That polarity is deliberate.
ACK=""
if [ -r "$ACK_FILE" ]; then
  ACK=" $(sed -e 's/#.*$//' "$ACK_FILE" | awk '{print $1}' | grep -E '^[0-9]+$' | tr '\n' ' ')"
fi
is_acknowledged() { case "$ACK" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
ACKED=0   # counted so the summary line cannot claim every PR was gated

# summarise <where> <checked-or-empty> — the all-clear line. It must NOT say
# "all … were gated" when some were merely acknowledged: an acknowledged PR was
# NOT gated, and a summary that blurs the two is the "claim asserted rather than
# measured" defect this repository keeps paying for. Green here means "nothing
# NEW is wrong", which is a different sentence and has to read like one.
summarise() {
  local where="$1" checked="$2" n
  if [ "$ACKED" -gt 0 ]; then
    if [ -n "$checked" ]; then
      n=$((checked - ACKED))
      echo "audit: $checked merged PR(s) in the $where — $n gated by a pre-merge verdict, $ACKED acknowledged (already on the record, NOT gated)"
    else
      echo "audit: no NEW violations in the $where — $ACKED acknowledged (already on the record, NOT gated)"
    fi
  elif [ -n "$checked" ]; then
    echo "audit: all $checked merged PR(s) in the $where were gated by a pre-merge verdict"
  else
    echo "audit: every merged PR in the $where was gated by a pre-merge verdict"
  fi
}

# classify <json-file> — prints "<STATUS>\t<back-filled count>" where STATUS is
# APPROVED | UNAPPROVED | NONE, judged on the newest verdict at or before
# .mergedAt. The line work lives in ONE jq expression so the definition cannot
# drift between the two call sites (fixture and live).
#
# `.at <= $m` is deliberately inclusive: a verdict posted in the same second as
# the merge counts as having gated it. The generous reading is the right one —
# #315 (v1.14.0) merged two seconds BEFORE its delta-confirm was posted, and
# second-level granularity cannot distinguish "posted as the merge landed" from
# "posted just after". An inclusive bound is honest about that limit; it does
# not admit the 15-45-minutes-later back-fills this script exists to catch.
classify() {
  jq -er "$VERDICT_HEADING_JQ_DEFS"'
    . as $pr
    | ($pr.mergedAt) as $m
    | [ (($pr.reviews  // [])[] | {at: .submittedAt, body: (.body // ""), assoc: (.authorAssociation // "NONE")}),
        (($pr.comments // [])[] | {at: .createdAt,   body: (.body // ""), assoc: (.authorAssociation // "NONE")}) ]
    | map(select(.at != null
        and (.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR")
        and (vh_heading | vh_is_verdict)))
    | { pre: map(select(.at <= $m)), post: map(select(.at > $m)) }
    | ((.pre | sort_by(.at) | last) // null) as $newest
    | (if $newest == null then "NONE"
       else ($newest | vh_heading | [match("REQUEST CHANGES|APPROVED?"; "gi")] | (.[0].string // ""))
            | (if test("APPROVE"; "i") then "APPROVED" else "UNAPPROVED" end)
       end) as $status
    | "\($status)\t\(.post | length)\t\($newest.at // "")"
  ' "$1" 2>/dev/null
}

# report <json-file> <number> <title> <mergedAt> — prints any violation and any
# informational note; returns 1 when the PR is a violation, 0 when it is clean.
report() {
  local f="$1" n="$2" title="$3" merged="$4" line status backfilled at rc=0
  line="$(classify "$f")" || { echo "audit: could not classify PR #$n — cannot measure" >&2; exit 2; }
  # Tab-separated, read explicitly: an invisible separator spelled out in a
  # ${var%%...} pattern is unreadable and silently wrong if it ever becomes a space.
  IFS=$'\t' read -r status backfilled at <<< "$line"
  case "$status" in
    NONE)
      echo "NO-VERDICT merged PR #$n: $title (merged $merged)"; rc=1 ;;
    UNAPPROVED)
      echo "UNAPPROVED merged PR #$n: $title (merged $merged; newest pre-merge verdict is REQUEST CHANGES, posted $at)"; rc=1 ;;
    APPROVED) ;;
    *) echo "audit: PR #$n classified as '$status' — cannot measure" >&2; exit 2 ;;
  esac
  # An acknowledged violation is still PRINTED — it never disappears from the
  # report — it just does not turn the run red. The line above is what a reader
  # sees; this one says why the exit code does not reflect it.
  if [ "$rc" = 1 ] && is_acknowledged "$n"; then
    echo "  ^ acknowledged in $(basename "$ACK_FILE") — on the record, not re-alarming"
    ACKED=$((ACKED+1))
    rc=0
  elif [ "$rc" = 0 ] && is_acknowledged "$n"; then
    echo "  note: PR #$n is acknowledged but is no longer a violation — remove the stale entry"
  fi
  # Informational, on a clean PR as well as a dirty one: a back-fill is the
  # right response to an ungated merge, and seeing it beside the violation is
  # what tells a reader the record was repaired rather than ignored.
  [ "${backfilled:-0}" != 0 ] \
    && echo "  note: PR #$n carries $backfilled verdict(s) posted AFTER the merge (back-filled — a record, not a gate)"
  return "$rc"
}

# --- test seam: a fixture dir of <n>.json files, each
#     {number,title,mergedAt,reviews,comments}. mergedAt is REQUIRED: without it
#     nothing can be ordered, and a fixture that silently skipped the ordering
#     check would be the exact hole #409 closes.
if [ -n "$FIXTURE" ]; then
  DIRTY=0
  for f in "$FIXTURE"/*.json; do
    [ -e "$f" ] || { echo "audit: fixture dir empty — cannot measure" >&2; exit 2; }
    n="$(jq -r '.number' "$f")" || { echo "audit: bad fixture $f" >&2; exit 2; }
    jq -e '(.mergedAt // null) | type == "string"' "$f" >/dev/null 2>&1 \
      || { echo "audit: fixture $f has no mergedAt — cannot measure" >&2; exit 2; }
    m="$(jq -r '.mergedAt' "$f")"
    report "$f" "$n" "$(jq -r '.title // ""' "$f")" "$m" || DIRTY=1
  done
  [ "$DIRTY" = 0 ] && summarise "fixture" ""
  exit "$DIRTY"
fi

# --- live path --------------------------------------------------------------
command -v gh >/dev/null 2>&1 || { echo "audit: gh unavailable — cannot measure" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "audit: jq unavailable — cannot measure" >&2; exit 2; }

# --search "merged:>=SINCE" queries by MERGE date. The first draft listed by
# creation order and filtered on mergedAt client-side — measured non-monotonic
# (#390 merged 05:01 listed before #389 merged 06:29), so a fixed --limit
# could silently truncate exactly the PR that mattered (#399 review, major 6).
GH_LIST=(gh pr list --repo "$REPO" --state merged --limit "$LIMIT" --json number,title,mergedAt)
[ -n "$SINCE" ] && GH_LIST+=(--search "merged:>=${SINCE%%T*}")
LIST="$("${GH_LIST[@]}" 2>/dev/null)"
[ -n "$LIST" ] || { echo "audit: gh pr list returned nothing — cannot measure" >&2; exit 2; }

# STRICT parse (#399 review, blocker 2): a Bad-Credentials JSON object, HTML,
# or truncated output must be "cannot measure", never a quiet green. The
# fixture branch already had this polarity; the live branch — the only one the
# workflow runs — did not.
printf '%s' "$LIST" | jq -e 'type == "array" and all(.[]; has("number") and has("mergedAt"))' >/dev/null 2>&1 \
  || { echo "audit: gh pr list output is not the expected array — cannot measure" >&2; exit 2; }

# The window grows without bound (--since is pinned at the cutover and never
# moves forward), and the loop below spends one `gh pr view` per PR in it. So
# --limit has to be raised from time to time, and it is a TRUNCATION GUARD, not
# a page size: filling it is "cannot measure", never a prefix audited quietly.
# The number is not raisable forever — GITHUB_TOKEN allows roughly 1000 GraphQL
# calls per hour, so a window past ~900 PRs needs a bounded window instead, with
# verdict-audit-acknowledged.txt carrying the history the bound would drop.
NLIST="$(printf '%s' "$LIST" | jq 'length')"
if [ "$NLIST" -ge "$LIMIT" ]; then
  echo "audit: window holds >= $LIMIT PRs — possibly truncated; raise --limit. Cannot measure" >&2
  exit 2
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/verdictaudit.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

DIRTY=0
CHECKED=0
for n in $(printf '%s' "$LIST" | jq -r --arg since "$SINCE" \
             '.[] | select($since == "" or .mergedAt >= $since) | .number'); do
  # mergedAt is fetched WITH the bodies rather than carried over from the list,
  # so the timestamp and the things it orders come from one response.
  if ! gh pr view "$n" --repo "$REPO" --json number,title,mergedAt,reviews,comments > "$TMP/$n.json" 2>/dev/null \
     || ! jq -e 'has("reviews") and has("comments") and ((.mergedAt // null) | type == "string")' "$TMP/$n.json" >/dev/null 2>&1; then
    echo "audit: could not fetch PR #$n — cannot measure" >&2; exit 2
  fi
  CHECKED=$((CHECKED+1))
  report "$TMP/$n.json" "$n" "$(jq -r '.title // ""' "$TMP/$n.json")" "$(jq -r '.mergedAt' "$TMP/$n.json")" || DIRTY=1
done

if [ "$CHECKED" = 0 ]; then
  echo "audit: no merged PRs in the window — nothing to measure"
  exit 0
fi
if [ "$DIRTY" = 0 ]; then
  summarise "window" "$CHECKED"
fi
exit "$DIRTY"
