#!/usr/bin/env bash
# audit_no_verdict_merges.sh — find merged PRs that carry NO canonical review
# verdict (#392, v1.14.1 retrospective change B).
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
# as Live Freshness (a scheduled workflow that goes red whenever the invariant
# is broken), because a red workflow gets looked at and a log line does not.
#
# THE VERDICT DEFINITION IS THE REPOSITORY'S CANONICAL ONE (docs/retrospectives/
# README.md): a posted body whose FIRST NON-EMPTY LINE contains `APPROVE` or
# `REQUEST CHANGES`. Reviews AND issue comments count (same-identity repos post
# comment verdicts). Known hole, footnoted there: position is not authorship —
# an author body opening with a marker is counted. This detector inherits the
# convention rather than forking it; fixing the convention is the next retro's
# item, and this script's filter is one grep to change.
#
# Exit: 0 = every merged PR in the window carries a verdict; 1 = at least one
# does not (each is printed); 2 = cannot measure (API/jq failure) — fail LOUD,
# never silently green (the #398 lesson: a check that skips is a fake green).
set -u

SINCE=""
LIMIT=40
FIXTURE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --since)   SINCE="$2"; shift 2 ;;
    --limit)   LIMIT="$2"; shift 2 ;;
    --fixture) FIXTURE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO="mavrovde/beaconfolio"

# has_verdict <json-file> — the canonical first-non-empty-line filter over the
# union of review bodies and comment bodies. jq does the line work so the
# definition lives in ONE expression.
has_verdict() {
  jq -e '
    ([.reviews[]?.body] + [.comments[]?.body])
    | map(
        split("\n")
        | map(select((. | gsub("^\\s+|\\s+$";"")) != ""))
        | first // ""
      )
    | any(test("APPROVE|REQUEST CHANGES"))
  ' "$1" >/dev/null 2>&1
}

# --- test seam: a fixture dir of <n>.json files, each {number,title,reviews,comments}
if [ -n "$FIXTURE" ]; then
  DIRTY=0
  for f in "$FIXTURE"/*.json; do
    [ -e "$f" ] || { echo "audit: fixture dir empty — cannot measure" >&2; exit 2; }
    n="$(jq -r '.number' "$f")" || { echo "audit: bad fixture $f" >&2; exit 2; }
    if ! has_verdict "$f"; then
      echo "NO-VERDICT merged PR #$n: $(jq -r '.title // ""' "$f")"
      DIRTY=1
    fi
  done
  [ "$DIRTY" = 0 ] && echo "audit: every merged PR in the fixture carries a canonical verdict"
  exit "$DIRTY"
fi

# --- live path --------------------------------------------------------------
command -v gh >/dev/null 2>&1 || { echo "audit: gh unavailable — cannot measure" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "audit: jq unavailable — cannot measure" >&2; exit 2; }

LIST="$(gh pr list --repo "$REPO" --state merged --limit "$LIMIT" \
          --json number,title,mergedAt 2>/dev/null)" \
  || { echo "audit: gh pr list failed — cannot measure" >&2; exit 2; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/verdictaudit.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

DIRTY=0
CHECKED=0
for n in $(printf '%s' "$LIST" | jq -r --arg since "$SINCE" \
             '.[] | select($since == "" or .mergedAt >= $since) | .number'); do
  if ! gh pr view "$n" --repo "$REPO" --json number,title,reviews,comments > "$TMP/$n.json" 2>/dev/null; then
    echo "audit: could not fetch PR #$n — cannot measure" >&2; exit 2
  fi
  CHECKED=$((CHECKED+1))
  if ! has_verdict "$TMP/$n.json"; then
    echo "NO-VERDICT merged PR #$n: $(jq -r '.title // ""' "$TMP/$n.json") (merged $(printf '%s' "$LIST" | jq -r --argjson n "$n" '.[] | select(.number == $n) | .mergedAt'))"
    DIRTY=1
  fi
done

if [ "$CHECKED" = 0 ]; then
  echo "audit: no merged PRs in the window — nothing to measure"
  exit 0
fi
if [ "$DIRTY" = 0 ]; then
  echo "audit: all $CHECKED merged PR(s) in the window carry a canonical verdict"
fi
exit "$DIRTY"
