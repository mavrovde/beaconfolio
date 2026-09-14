#!/usr/bin/env bash
# check_changelog_merge.sh — validate the MERGED CHANGELOG against a base ref,
# not the branch in isolation (#391, v1.14.1 retrospective change A).
#
#   bash scripts/check_changelog_merge.sh [--against REF] [FILE]
#   bash scripts/check_changelog_merge.sh --merged FILE --base FILE   # test seam
#
# WHY: the v1.14.1 retrospective measured the `[Unreleased]` merge collision as
# the release's dominant blocker class — 5 of 16 reviewed PRs at blocker level
# (7 counting #367/#371), and 4 of the 5 were ALSO stale-base blockers, because
# `[Unreleased]` is the one file every concurrent branch writes to. The defect
# NEVER exists in the branch and NEVER exists in main; it exists only in the
# merged result, which is the state nothing validated. Same shape as the Alembic
# head fork that check_migration_heads.sh --against origin/main closed at
# v1.14.0. The repository already owned the FIXER (dedup_changelog_unreleased.py,
# invoked by /prep-pr step 2) — what it lacked was a GATE that runs mechanically.
#
# WHAT IT CHECKS, on the three-way merge of the working-tree file with REF
# (defaults: origin/main, CHANGELOG.md):
#
#   1. exactly one `## [Unreleased]` heading;
#   2. no duplicate `### ` heading inside `[Unreleased]` (fence-aware — a `### `
#      line inside a ``` fence is content, not a heading);
#   3. no released `## [X.Y.Z]` heading present on REF but absent from the merge
#      — the #365 case, where a merge DELETED the `## [1.14.0]` section and a
#      heading-count check passed;
#   4. no `[Unreleased]` content line present on REF but absent from the merge —
#      a lost line means the rebase dropped someone else's entry. Set semantics,
#      so reordering sections (which the dedup fixer legitimately does) passes.
#
# STATED LIMITS (#398 review — documented, not hidden):
#   * check 3 guards released HEADINGS, not released section bodies — a merge
#     that mangles a released section's content without touching its heading
#     passes here; the dedup self-test's byte-identity contract is the layer
#     that owns released-content integrity.
#   * check 4's set semantics cannot see MULTIPLICITY loss (two identical lines
#     collapsing to one) — accepted, because the dedup fixer legitimately
#     collapses exact duplicates.
#   * checks 1 and 3 are not fence-aware (check 2 is): a fenced `## [x.y.z]`
#     line would be miscounted. This repo's CHANGELOG has never carried a
#     fenced release heading; revisit if one ever appears.
#   * the pre-push run measures against the LOCAL origin/main, which is as
#     fresh as the last fetch — a collision landed on main seconds ago is
#     caught by the CI run and the merge gate's approval-covers-head check.
#
# A CONFLICTED merge is reported as its own failure (rebase first) — that is the
# same signal the merge gate denies on, surfaced at push time instead.
#
# THE MERGE IS FORMED WITH `git merge-tree`, NOT `git merge-file` — measured, not
# stylistic: replaying #357's ORIGINAL pre-rebase head (3093750, recovered from
# the PR timeline) against the main tip it faced (#364's merge, 379273c),
# merge-file reports a CONFLICT while merge-tree — the machinery `gh pr merge`
# actually runs — auto-merges CLEANLY and produces the duplicate `### Added` x2
# the reviewer measured. A file-level 3-way merge is a different algorithm and
# validates a merge that never happens. Committed-tree semantics are also the
# right ones for a push gate: the push pushes HEAD, not the working tree (an
# uncommitted CHANGELOG edit is noted, not measured).
#
# POLARITY (the #377 rule — a check that cannot run must not pass silently by
# accident of environment): if REF is unobtainable this exits 0 WITH A NOTE,
# because the pre-push gate maps that situation to "run everything" elsewhere
# and a foreign repo (#353) has no origin/main to measure against.
set -u

FILE="CHANGELOG.md"
REF="origin/main"
HEADREF="HEAD"
MERGED=""
BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --against) REF="$2"; shift 2 ;;
    --head)    HEADREF="$2"; shift 2 ;;   # replay seam: measure a historical head
    --merged)  MERGED="$2"; shift 2 ;;
    --base)    BASE="$2"; shift 2 ;;
    *)         FILE="$1"; shift ;;
  esac
done

# ---------------------------------------------------------------------------
# The four checks, on two plain files: $1 = merged result, $2 = base (REF) copy.
# Factored to a seam so the self-test can drive every branch without a repo;
# the mutation contract in check_changelog_merge.test.sh neuters each check in
# a COPY and requires its case to go red (lessons-learned §59: a gate must be
# proven able to fail).
# ---------------------------------------------------------------------------
run_checks() {
  python3 - "$1" "$2" <<'PY'
import re, sys

merged_path, base_path = sys.argv[1], sys.argv[2]
merged = open(merged_path, encoding="utf-8", newline="").read().split("\n")
base = open(base_path, encoding="utf-8", newline="").read().split("\n")

UNREL = re.compile(r"^## \[Unreleased\]", re.I)
RELEASED = re.compile(r"^## \[[0-9][^\]]*\]")
FENCE = re.compile(r"^\s*(```|~~~)")

def unreleased_block(lines):
    """Lines between `## [Unreleased]` and the first released heading."""
    start = next((i for i, l in enumerate(lines) if UNREL.match(l)), None)
    if start is None:
        return []
    end = next((i for i in range(start + 1, len(lines)) if RELEASED.match(lines[i])),
               len(lines))
    return lines[start + 1:end]

failures = []

# 1. exactly one `## [Unreleased]`
n_unrel = sum(1 for l in merged if UNREL.match(l))
n_base = sum(1 for l in base if UNREL.match(l))
if n_unrel == 0 and n_base == 0:
    print("note: no [Unreleased] section on either side — nothing to check")
elif n_unrel != 1:
    failures.append(f"check 1: {n_unrel} `## [Unreleased]` headings in the merged result (want exactly 1)")

# 2. no duplicate `### ` heading inside [Unreleased] (fence-aware)
seen, in_fence = {}, False
for line in unreleased_block(merged):
    if FENCE.match(line):
        in_fence = not in_fence
        continue
    if not in_fence and line.startswith("### "):
        name = line.strip()
        seen[name] = seen.get(name, 0) + 1
for name, count in seen.items():
    if count > 1:
        failures.append(f"check 2: duplicate heading in [Unreleased]: `{name}` x{count}")

# 3. every released heading on the base must survive the merge (#365).
# Compared RSTRIPPED on both sides, like check 4 — the first draft compared raw
# lines, so a CRLF base against an LF merge false-FAILED here while check 4
# shrugged (#398 review): a lint that cries wolf on line endings gets bypassed.
merged_released = {l.rstrip() for l in merged if RELEASED.match(l)}
for l in base:
    if RELEASED.match(l) and l.rstrip() not in merged_released:
        failures.append(f"check 3: released heading on base is ABSENT from the merge: `{l.strip()}`")

# 4. no [Unreleased] content line lost (set semantics: reorder and dedup pass)
merged_set = {l.rstrip() for l in unreleased_block(merged) if l.strip()}
for l in unreleased_block(base):
    if l.strip() and l.rstrip() not in merged_set:
        failures.append(f"check 4: [Unreleased] line on base is LOST in the merge: `{l.strip()[:80]}`")

if failures:
    for f in failures:
        print(f"FAIL {f}")
    sys.exit(1)
print(f"ok: merged CHANGELOG passes all 4 checks "
      f"({len(merged_released)} released headings, "
      f"{sum(1 for l in unreleased_block(merged) if l.strip())} [Unreleased] lines)")
PY
}

# --- test seam: both files supplied, no git involved -----------------------
if [ -n "$MERGED" ] && [ -n "$BASE" ]; then
  run_checks "$MERGED" "$BASE"
  exit $?
fi

# --- default driver: REAL merge (merge-tree) of HEADREF with REF -----------
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "note: not a git repository — skipping (nothing to merge against)"
  exit 0
}
cd "$ROOT" || exit 1

if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null 2>&1; then
  echo "note: $REF is unobtainable — skipping (foreign repo or no remote; the gate's ALL polarity covers this)"
  exit 0
fi
if ! git rev-parse --verify --quiet "$HEADREF^{commit}" >/dev/null 2>&1; then
  echo "note: $HEADREF is unobtainable — skipping"
  exit 0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/chlogmerge.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

if ! git merge-base "$REF" "$HEADREF" >/dev/null 2>&1; then
  echo "note: no merge-base between $HEADREF and $REF — skipping"
  exit 0
fi

git show "$REF:$FILE" > "$TMP/theirs" 2>/dev/null || {
  echo "note: $FILE does not exist on $REF — skipping"
  exit 0
}

# The REAL merge, same machinery as `gh pr merge`. Exit 0 = clean (tree oid on
# stdout line 1); exit 1 = conflicted; >1 = error.
MT_OUT="$TMP/mt"; MT_RC=0
git merge-tree --write-tree "$REF" "$HEADREF" > "$MT_OUT" 2>/dev/null || MT_RC=$?
if [ "$MT_RC" -eq 1 ]; then
  echo "FAIL $HEADREF conflicts with $REF — the merged result cannot even be formed."
  echo "     Rebase onto $REF and re-run /prep-pr step 2 (this is the same state"
  echo "     the merge gate denies on, caught at push time instead)."
  exit 1
elif [ "$MT_RC" -ne 0 ]; then
  echo "note: git merge-tree unavailable or failed (rc=$MT_RC) — skipping (needs git >= 2.38)"
  exit 0
fi
TREE="$(head -1 "$MT_OUT")"
git cat-file -p "$TREE:$FILE" > "$TMP/mergedfile" 2>/dev/null || {
  echo "note: $FILE absent from the merged tree — skipping"
  exit 0
}

# The push pushes HEAD; an uncommitted edit is invisible to the merge. Say so.
if [ "$HEADREF" = "HEAD" ] && [ -f "$FILE" ] && ! git diff --quiet -- "$FILE" 2>/dev/null; then
  echo "note: $FILE has uncommitted changes — measuring the COMMITTED version (the push pushes HEAD)"
fi

run_checks "$TMP/mergedfile" "$TMP/theirs"
