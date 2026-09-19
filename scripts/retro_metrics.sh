#!/usr/bin/env bash
# retro_metrics.sh — emit a release window's retrospective figures as MEASUREMENTS.
#
# Why this exists (v1.15.0 retro): "a claim asserted rather than measured" (class F)
# has been the top or joint-top defect class in five consecutive retrospectives, and
# the instances are overwhelmingly HAND-COUNTED FIGURES in the retro and wiki docs
# themselves — #430's blocker was a published "series' best rounds figure" that was
# false; #429's two majors were a wall-clock that did not reproduce (23 min claimed,
# 9m14s measured) and a headline verdict count produced by an undocumented filter.
# A number produced by an executable can be re-derived by anyone; a number typed by
# hand cannot, and five releases of charter prose have not stopped the recurrence.
#
# Usage:  scripts/retro_metrics.sh <prev-tag | prev-release-PR> <release-pr-number>
#   e.g.  scripts/retro_metrics.sh v1.14.3 436     (lower bound = the tag's commit date)
#   e.g.  scripts/retro_metrics.sh 436 441         (lower bound = THAT PR's mergedAt)
#   e.g.  scripts/retro_metrics.sh pr:436 441      (explicit — never guessed)
#   e.g.  scripts/retro_metrics.sh ref:v1.14.3 436 (explicit — never guessed)
#
# Env:  RETRO_PR_LIMIT (default 400) — the listing's TRUNCATION GUARD, not a page
#       size. Filling it exits 2 with "cannot measure"; it never audits a prefix.
#
# PREFER THE SECOND FORM. The tag form bounds the window on the previous tag's
# COMMIT date, which is not the same instant as the previous release PR's merge: at
# v1.15.1 the tag commit read 11:09:19Z and its own release PR #436 merged at
# 11:09:20Z, so #436 — already counted by the v1.15.0 retro — appeared in v1.15.1's
# corpus as a seventh PR. The header used to name that asymmetry and tell the reader
# to eyeball it, which is precisely where a hand-correction re-enters a document
# whose whole purpose is to remove hand-counted figures (class F). Passing the
# previous release PR makes both edges the same kind of instant, measured the same
# way, and the lower edge EXCLUSIVE.
#
# Bounding rules are encoded here rather than re-remembered each release
# (docs/retrospectives/README.md notes 11-13): the corpus is bounded on the RELEASE
# PR's mergedAt — not the tag commit's committer date, which drops the release PR
# from its own release by one second — timestamps are compared in UTC, and every
# verdict is REPLAYED at its PR's mergedAt so a back-filled retrospective verdict
# cannot be miscounted as a gate.
#
# What it deliberately does NOT do: decide anything. It prints figures; the
# retrospective reads them. It also cannot tell an INDEPENDENT verdict from a
# self-review — reviewer and author share one GitHub identity in this repo, so that
# distinction is unmeasurable here and is tracked by disclosure convention instead
# (see the v1.15.0 record, and the same structural limit noted at lessons §43).
set -euo pipefail

# BASH_SOURCE guard (lessons §67): `bash -s < script` leaves it unset, and the
# failure is swallowed inside $( ), so "script dir" silently becomes the cwd.
if [ -z "${BASH_SOURCE[0]:-}" ]; then
    echo "FATAL: run this as a file (BASH_SOURCE is empty — piped via 'bash -s'?)" >&2
    exit 1
fi

# The verdict-heading grammar is SHARED with .claude/hooks/pre-merge-gate.sh and
# scripts/audit_no_verdict_merges.sh (scripts/verdict-heading-lib.sh, v1.16.0
# retrospective). This script's copy was the loosest of the three — a marker
# anywhere in the first line, and no trusted-association filter at all — and it
# counted #458's author note as a fifth review round. Rounds published before
# v1.16.0 were measured with the loose filter; the "non-verdict bodies skipped"
# line below makes the difference visible instead of silently restating a
# smaller number. The association filter is measured as a no-op on this repo's
# history: across 229 merged PRs no untrusted body has a conforming heading.
VERDICT_HEADING_LIB="${VERDICT_HEADING_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verdict-heading-lib.sh}"
# shellcheck disable=SC1090
[ -r "$VERDICT_HEADING_LIB" ] && . "$VERDICT_HEADING_LIB"
[ -n "${VERDICT_HEADING_JQ_DEFS:-}" ] || {
    echo "FATAL: cannot read the verdict-heading grammar ($VERDICT_HEADING_LIB) — cannot measure" >&2
    exit 2
}

PREV="${1:-}"
RELPR="${2:-}"
if [ -z "$PREV" ] || [ -z "$RELPR" ]; then
    echo "usage: $0 <prev-tag | prev-release-PR> <release-pr-number>" >&2
    exit 1
fi

REPO="${RETRO_REPO:-mavrovde/beaconfolio}"

# Upper bound: the release PR's own merge instant (inclusive).
UPPER="$(gh pr view "$RELPR" --repo "$REPO" --json mergedAt -q '.mergedAt')"
if [ -z "$UPPER" ] || [ "$UPPER" = "null" ]; then
    echo "FATAL: PR #$RELPR is not merged — no upper bound" >&2
    exit 1
fi

# Lower bound. Two KINDS, and they are NOT equivalent — see the header.
#
#   PR number -> the previous RELEASE PR's mergedAt, the same instant kind as
#                UPPER, and the bound is exclusive on both reads. Preferred.
#   git ref   -> the previous tag's commit date, normalised to UTC. Note 11: a
#                local +02:00 stamp string-compared against a Z value silently
#                mis-selects the corpus.
#
# Which kind a BARE argument means was decided by "is it all digits?", and a
# heuristic that guesses in silence is the exact class this script exists to
# remove (PR #452, nit 7): a 7-hex SHA prefix that happens to be all decimal
# (`4361234`) or a tag literally named `436` reads as a PR number and the window
# is measured against the wrong instant with no warning. Two changes: the
# explicit `pr:N` / `ref:X` forms say which you meant with no guessing at all,
# and a bare all-digit argument that ALSO names a git commit now REFUSES instead
# of picking one. `436` does not name a commit in this repo today, so every
# published invocation (`retro_metrics.sh 436 441`, `retro_metrics.sh v1.14.3 436`)
# is unchanged.
PREV_REF="$PREV"
case "$PREV" in
    pr:*)   PREV_KIND=pr;  PREV_REF="${PREV#pr:}" ;;
    ref:*)  PREV_KIND=ref; PREV_REF="${PREV#ref:}" ;;
    *[!0-9]*) PREV_KIND=ref ;;
    *)
        PREV_KIND=pr
        if git rev-parse --verify --quiet "$PREV^{commit}" >/dev/null 2>&1; then
            echo "FATAL: '$PREV' is all digits AND names a git commit — ambiguous." >&2
            echo "       Say which: 'pr:$PREV' (previous release PR) or 'ref:$PREV' (git ref)." >&2
            exit 1
        fi
        ;;
esac
case "$PREV_KIND:$PREV_REF" in
    pr:|pr:*[!0-9]*)
        echo "FATAL: 'pr:$PREV_REF' is not a PR number" >&2
        exit 1
        ;;
esac

case "$PREV_KIND" in
    ref)
        LOWER="$(git log -1 --format=%cI "$PREV_REF" | python3 -c 'import sys, datetime; print(datetime.datetime.fromisoformat(sys.stdin.read().strip()).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
        BOUND_KIND="tag commit date"
        ;;
    pr)
        LOWER="$(gh pr view "$PREV_REF" --repo "$REPO" --json mergedAt -q '.mergedAt')"
        if [ -z "$LOWER" ] || [ "$LOWER" = "null" ]; then
            echo "FATAL: PR #$PREV_REF is not merged — no lower bound" >&2
            exit 1
        fi
        BOUND_KIND="previous release PR mergedAt"
        ;;
esac

echo "window: $PREV ($LOWER, $BOUND_KIND)  ->  PR #$RELPR ($UPPER)"
echo

# ALWAYS eyeball the corpus against `git log <prev>..<tag>`. One asymmetry remains
# in the TAG form and is the reason to prefer the PR form: a PR merged between the
# tagged commit and the tag's creation is dropped by LOWER.
echo "=== corpus (eyeball against: git log --oneline $PREV_REF..HEAD) ==="

# The listing is bounded SERVER-SIDE and guarded against truncation. Both halves
# of this were missing until PR #452's review (major 1), and both are exactly what
# audit_no_verdict_merges.sh:229,248-252 already fixed at #399/#439:
#
#   (a) `gh pr list` without --search returns merged PRs in DEFAULT order, which
#       is not merge order, so a fixed --limit takes an arbitrary prefix and the
#       mergedAt filter then runs over a set that need not contain the window.
#       MEASURED on this repo: `retro_metrics.sh v1.11.1 281` (the v1.12.0 window)
#       returned 7 PRs at --limit 100 and 9 at --limit 400, against a published
#       row of 10 — silently, with a confident mean printed under it.
#   (b) A filled limit must be "cannot measure", never a quietly short corpus.
#       The sibling exits 2 and says so; this one printed a number.
#
# `merged:>=DATE` bounds the SEARCH by merge date at day granularity — a superset
# of the window, which the jq filter below then trims to the exact instants — so
# the listing order no longer has to agree with the filter.
LIMIT="${RETRO_PR_LIMIT:-400}"
RAW="$(gh pr list --repo "$REPO" --state merged --limit "$LIMIT" \
    --search "merged:>=${LOWER%%T*}" \
    --json number,mergedAt,changedFiles,additions,deletions,createdAt)"
printf '%s' "$RAW" | jq -e 'type == "array" and all(.[]; has("number") and has("mergedAt"))' >/dev/null 2>&1 \
    || { echo "FATAL: gh pr list did not return the expected array — cannot measure" >&2; exit 2; }
NRAW="$(printf '%s' "$RAW" | jq 'length')"
if [ "$NRAW" -ge "$LIMIT" ]; then
    echo "FATAL: the listing filled --limit $LIMIT ($NRAW rows) — possibly truncated." >&2
    echo "       Raise RETRO_PR_LIMIT. Cannot measure." >&2
    exit 2
fi
CORPUS="$(printf '%s' "$RAW" \
    | jq "[.[] | select(.mergedAt > \"$LOWER\" and .mergedAt <= \"$UPPER\")]")"
# Sorted in jq, numerically. `sort -n -k1.3` looks right and is not: it keys on the
# substring after "#4", so a corpus spanning #99 and #433 comes out misordered.
echo "$CORPUS" | jq -r 'sort_by(.number) | .[]
    | "  #\(.number)\tfiles=\(.changedFiles)\tlines=\(.additions + .deletions)"'
N="$(echo "$CORPUS" | jq 'length')"
echo "PRs merged: $N"
echo

echo "=== median files/PR ==="
echo "$CORPUS" | jq -r '[.[].changedFiles] | sort
    | if length == 0 then "n/a"
      elif length % 2 == 1 then (.[(length / 2) | floor] | tostring)
      else (((.[length / 2 - 1] + .[length / 2]) / 2) | tostring)
      end'
echo

# Verdicts: heading-anchored (the FIRST non-empty line states the marker — a marker
# in paragraph three is not a verdict, lessons §43) AND replayed at mergedAt.
echo "=== verdicts (heading-anchored, replayed at mergedAt) ==="
TOTAL_PRE=0
R1_APPROVE=0
REVIEWED=0
SKIPPED=0
for n in $(echo "$CORPUS" | jq -r '.[].number' | sort -n); do
    row="$(gh pr view "$n" --repo "$REPO" --json mergedAt,reviews,comments -q "$VERDICT_HEADING_JQ_DEFS"'
      .mergedAt as $m
      | [ (.reviews[]?  | {t: .submittedAt, body: .body, assoc: .authorAssociation}),
          (.comments[]? | {t: .createdAt,   body: .body, assoc: .authorAssociation}) ]
      | map(select(.body != null and .body != "" and .t != null and .t < $m))
      | map(select(.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR"))
      | map(. + {first: vh_heading})
      | map(select(.first | test("APPROVE|APPROVED|REQUEST CHANGES|REJECT"; "i")))
      | length as $marker_bearing
      | map(select(.first | vh_is_verdict))
      | sort_by(.t)
      | [ (length | tostring),
          (if (length > 0) and ((.[0].first | test("REQUEST CHANGES|REJECT"; "i")) | not)
             then "r1-approve" else "-" end),
          (($marker_bearing - length) | tostring) ]
      | join(" ")')"
    # Three fields, read positionally: a ${row##* } that used to mean "the r1
    # flag" silently becomes "the skipped count" the moment a field is appended.
    read -r cnt r1 skipped <<<"$row"
    SKIPPED=$((SKIPPED + skipped))
    TOTAL_PRE=$((TOTAL_PRE + cnt))
    if [ "$cnt" -gt 0 ]; then REVIEWED=$((REVIEWED + 1)); fi
    if [ "$r1" = "r1-approve" ]; then R1_APPROVE=$((R1_APPROVE + 1)); fi
    printf '  #%-5s %s pre-merge verdict(s)  %s\n' "$n" "$cnt" "$r1"
done
echo
echo "canonical verdicts (pre-merge): $TOTAL_PRE"
echo "PRs with >=1 pre-merge verdict:  $REVIEWED of $N"
echo "merged with NO valid verdict:    $((N - REVIEWED))"
# Reported, not hidden: bodies whose first line MENTIONS a marker without
# stating one — author fix reports and delta requests. Figures published before
# v1.16.0 counted these as rounds (scripts/verdict-heading-lib.sh).
echo "non-verdict bodies skipped:      $SKIPPED  (marker mentioned, not stated)"

if [ "$N" -gt 0 ]; then
    python3 - "$TOTAL_PRE" "$N" "$R1_APPROVE" "$REVIEWED" <<'PY'
import sys

pre, n, r1, reviewed = (int(x) for x in sys.argv[1:5])
print(f"mean rounds:                     {pre / n:.2f}  (over all {n} PRs)")
if reviewed:
    print(f"mean rounds (reviewed only):     {pre / reviewed:.2f}")
print(f"round-1 approvals:               {r1}/{n} = {100 * r1 / n:.0f}%")
if pre:
    print(f"rework share of verdicts:        {100 * (pre - n) / pre:.0f}%  ((verdicts - PRs) / verdicts)")
PY
fi
