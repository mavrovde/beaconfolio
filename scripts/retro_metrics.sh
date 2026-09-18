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
# Usage:  scripts/retro_metrics.sh <prev-tag> <release-pr-number>
#   e.g.  scripts/retro_metrics.sh v1.14.3 436
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

PREV="${1:-}"
RELPR="${2:-}"
if [ -z "$PREV" ] || [ -z "$RELPR" ]; then
    echo "usage: $0 <prev-tag> <release-pr-number>" >&2
    exit 1
fi

REPO="${RETRO_REPO:-mavrovde/beaconfolio}"

# Upper bound: the release PR's own merge instant (inclusive).
UPPER="$(gh pr view "$RELPR" --repo "$REPO" --json mergedAt -q '.mergedAt')"
if [ -z "$UPPER" ] || [ "$UPPER" = "null" ]; then
    echo "FATAL: PR #$RELPR is not merged — no upper bound" >&2
    exit 1
fi

# Lower bound: the previous tag's commit date, normalised to UTC. Note 11: a local
# +02:00 stamp string-compared against a Z value silently mis-selects the corpus.
LOWER="$(git log -1 --format=%cI "$PREV" | python3 -c 'import sys, datetime; print(datetime.datetime.fromisoformat(sys.stdin.read().strip()).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"

echo "window: $PREV ($LOWER)  ->  PR #$RELPR ($UPPER)"
echo

# ALWAYS eyeball the corpus against `git log <prev>..<tag>`. Two known asymmetries:
# a PR whose merge commit IS the previous tag belongs to the PREVIOUS release, and a
# PR merged between the tagged commit and the tag's creation is dropped by LOWER.
echo "=== corpus (eyeball against: git log --oneline $PREV..HEAD) ==="
CORPUS="$(gh pr list --repo "$REPO" --state merged --limit 100 \
    --json number,mergedAt,changedFiles,additions,deletions,createdAt \
    -q "[.[] | select(.mergedAt > \"$LOWER\" and .mergedAt <= \"$UPPER\")]")"
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
for n in $(echo "$CORPUS" | jq -r '.[].number' | sort -n); do
    row="$(gh pr view "$n" --repo "$REPO" --json mergedAt,reviews,comments -q '
      .mergedAt as $m
      | [ (.reviews[]? | {t: .submittedAt, b: .body}), (.comments[]? | {t: .createdAt, b: .body}) ]
      | map(select(.b != null and .b != ""))
      | map(. + {first: ((.b | split("\n") | map(select(test("\\S"))) | .[0]) // "")})
      | map(select(.first | test("APPROVE|APPROVED|REQUEST CHANGES|REJECT"; "i")))
      | map(select(.t < $m))
      | sort_by(.t)
      | [ (length | tostring),
          (if (length > 0) and ((.[0].first | test("REQUEST CHANGES|REJECT"; "i")) | not)
             then "r1-approve" else "-" end) ]
      | join(" ")')"
    cnt="${row%% *}"
    r1="${row##* }"
    TOTAL_PRE=$((TOTAL_PRE + cnt))
    if [ "$cnt" -gt 0 ]; then REVIEWED=$((REVIEWED + 1)); fi
    if [ "$r1" = "r1-approve" ]; then R1_APPROVE=$((R1_APPROVE + 1)); fi
    printf '  #%-5s %s pre-merge verdict(s)  %s\n' "$n" "$cnt" "$r1"
done
echo
echo "canonical verdicts (pre-merge): $TOTAL_PRE"
echo "PRs with >=1 pre-merge verdict:  $REVIEWED of $N"
echo "merged with NO valid verdict:    $((N - REVIEWED))"

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
