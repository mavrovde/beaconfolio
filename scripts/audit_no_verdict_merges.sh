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
# THE VERDICT DEFINITION MIRRORS pre-merge-gate.sh EXACTLY (#399 review,
# major 5 — the first draft claimed to inherit it and silently dropped two
# clauses): a posted body whose FIRST NON-EMPTY LINE matches
# APPROVE|APPROVED|REQUEST CHANGES case-insensitively, AND whose author
# carries a trusted association (OWNER/MEMBER/COLLABORATOR — the #316 rule;
# without it a drive-by NONE commenter's "## APPROVE" silences the alarm).
# Reviews AND issue comments count (same-identity repos post comment
# verdicts). Known hole, footnoted in docs/retrospectives/README.md: position
# is not authorship. One jq expression; change it beside the gate's or not at
# all. One deliberate omission from the gate's expression: `.at != null` — the
# gate orders candidates by time to find the NEWEST verdict; this detector
# asks only whether ANY verdict exists, so recency plays no part.
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
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO="mavrovde/beaconfolio"

# has_verdict <json-file> — the canonical first-non-empty-line filter over the
# union of review bodies and comment bodies. jq does the line work so the
# definition lives in ONE expression.
has_verdict() {
  jq -e '
    ([(.reviews // [])[]  | {body: (.body // ""), assoc: (.authorAssociation // "NONE")}]
     + [(.comments // [])[] | {body: (.body // ""), assoc: (.authorAssociation // "NONE")}])
    | map(select(.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR"))
    | map(
        .body | split("\n")
        | map(select((. | gsub("^\\s+|\\s+$";"")) != ""))
        | first // ""
      )
    | any(test("APPROVE|APPROVED|REQUEST CHANGES"; "i"))
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
  if ! gh pr view "$n" --repo "$REPO" --json number,title,reviews,comments > "$TMP/$n.json" 2>/dev/null \
     || ! jq -e 'has("reviews") and has("comments")' "$TMP/$n.json" >/dev/null 2>&1; then
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
