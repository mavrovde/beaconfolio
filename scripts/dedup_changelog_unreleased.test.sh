#!/usr/bin/env bash
# Self-test for scripts/dedup_changelog_unreleased.py.
#
# This script REWRITES the file holding the project's release history, so the
# cases that matter are the LOSS cases: every one below was a real defect in the
# first draft, found in review, not invented afterwards.
#   * a heading outside the whitelist was silently DELETED (`### Docs`,
#     `### Deprecated`, `### Reverted`, `### Documentation` — 66 commits in this
#     repo's own history carry one);
#   * text between `## [Unreleased]` and the first `###` was DROPPED;
#   * a `- ` line inside a fenced code block was torn out as a new entry;
#   * a missing `[Unreleased]`, or one with no released section under it, raised
#     StopIteration instead of doing something sensible.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/dedup_changelog_unreleased.py"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n     %s\n' "$1" "$2"; }

run() { python3 "$SCRIPT" "$1" 2>&1; }

echo "== dedup_changelog_unreleased self-test =="

# --- 1. the defect it exists for: duplicate headings merge, entries dedup ----
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Fixed
- **A (#1)** — first.

### Added
- **B (#2)** — second.

### Fixed
- **A (#1)** — first.
- **C (#3)** — third.

## [1.0.0] - 2026-01-01
### Added
- old release entry
MD
out="$(run "$f")"
[ "$(grep -c '^### Fixed' "$f")" = 1 ] && ok "duplicate headings merge into one" \
  || bad "heading merge" "$(grep '^### ' "$f")"
[ "$(grep -c 'A (#1)' "$f")" = 1 ] && ok "a repeated entry is dropped once" \
  || bad "entry dedup" "$out"
grep -q 'C (#3)' "$f" && grep -q 'B (#2)' "$f" && ok "…and the unique entries survive" \
  || bad "unique entries lost" "$(cat "$f")"
grep -q '^## \[1.0.0\] - 2026-01-01' "$f" && ok "the released section is untouched" \
  || bad "release heading lost" "$(cat "$f")"
rm -f "$f"

# --- 2. LOSS CASE: a non-standard heading must be KEPT ----------------------
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Docs
- **doc entry** — keep me.

### Deprecated
- **dep entry** — keep me too.

### Documentation
- **another doc** — and me.

### Added
- **added entry** — normal.

## [1.0.0] - 2026-01-01
- old
MD
out="$(run "$f")"
missing=""
for t in "doc entry" "dep entry" "another doc" "added entry"; do
  grep -q "$t" "$f" || missing="$missing $t"
done
[ -z "$missing" ] && ok "non-standard sections are KEPT (the data-loss bug)" \
  || bad "SILENT DELETION" "lost:$missing"
for h in "### Docs" "### Deprecated" "### Documentation"; do
  grep -qF "$h" "$f" || bad "heading $h deleted" "$(grep '^### ' "$f")"
done
grep -qF "### Docs" "$f" && ok "…and their headings survive too" || true
rm -f "$f"

# --- 3. LOSS CASE: preamble before the first ### heading --------------------
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]
Nothing released yet; see the sections below.

### Added
- **x** — y.

## [1.0.0] - 2026-01-01
- old
MD
out="$(run "$f")"
grep -q "Nothing released yet" "$f" && ok "preamble text before the first heading is KEPT" \
  || bad "preamble dropped" "$(cat "$f")"
rm -f "$f"

# --- 4. LOSS CASE: a '- ' line inside a fenced code block ------------------
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Added
- **entry with code** — see below:
  ```yaml
  - name: a step
  - name: another step
  ```
  trailing prose.

## [1.0.0] - 2026-01-01
- old
MD
out="$(run "$f")"
[ "$(grep -c '^- \*\*' "$f")" = 1 ] && ok "a '- ' inside a fence is not torn out as an entry" \
  || bad "fence split" "$(cat "$f")"
grep -q "trailing prose" "$f" && ok "…and the entry's trailing prose survives" \
  || bad "prose after fence lost" "$(cat "$f")"
rm -f "$f"

# --- 5. EDGE: no [Unreleased] at all — leave the file alone ----------------
f="$(mktemp)"; printf '# Changelog\n\n## [1.0.0] - 2026-01-01\n- only a release\n' > "$f"
before="$(cat "$f")"
out="$(run "$f")"; rc=$?
[ "$rc" -eq 0 ] && [ "$before" = "$(cat "$f")" ] \
  && ok "no [Unreleased]: exits 0 and changes nothing" || bad "no-unreleased" "rc=$rc; $out"
printf '%s' "$out" | grep -qi "nothing to do" || bad "no-unreleased message" "$out"
rm -f "$f"

# --- 6. EDGE: [Unreleased] with no released section under it ---------------
f="$(mktemp)"; printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- **a** — x.\n\n### Added\n- **b** — y.\n' > "$f"
out="$(run "$f")"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(grep -c '^### Added' "$f")" = 1 ] \
   && grep -q '\*\*a\*\*' "$f" && grep -q '\*\*b\*\*' "$f"; then
  ok "[Unreleased] with no release below it still merges, keeps both"
else bad "unreleased-only" "rc=$rc; $(cat "$f")"; fi
rm -f "$f"

# --- 7. IDEMPOTENT: a second run must change nothing -----------------------
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Fixed
- **A (#1)** — first.

### Fixed
- **B (#2)** — second.

## [1.0.0] - 2026-01-01
- old
MD
run "$f" >/dev/null
once="$(cat "$f")"
run "$f" >/dev/null
[ "$once" = "$(cat "$f")" ] && ok "idempotent — a second run is a no-op" \
  || bad "not idempotent" "$(diff <(printf '%s' "$once") "$f")"
rm -f "$f"

# --- 8. NO WARNINGS on stderr (the SyntaxWarning the first draft emitted) ---
f="$(mktemp)"; printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- **a** — x.\n\n## [1.0.0] - 2026-01-01\n- old\n' > "$f"
warn="$(python3 -W error::SyntaxWarning "$SCRIPT" "$f" 2>&1 >/dev/null)"
[ -z "$warn" ] && ok "no SyntaxWarning / stderr noise" || bad "stderr noise" "$warn"
rm -f "$f"

# --- 9. THE REAL FILE: running it on the repo's own CHANGELOG loses nothing -
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -f "$ROOT/CHANGELOG.md" ]; then
  f="$(mktemp)"; cp "$ROOT/CHANGELOG.md" "$f"
  before_entries="$(grep -c '^- ' "$f")"
  before_rel="$(grep -c '^## \[[0-9]' "$f")"
  run "$f" >/dev/null
  after_entries="$(grep -c '^- ' "$f")"
  after_rel="$(grep -c '^## \[[0-9]' "$f")"
  [ "$before_rel" = "$after_rel" ] \
    && ok "real CHANGELOG: every release heading survives ($after_rel)" \
    || bad "release headings lost" "$before_rel -> $after_rel"
  [ "$after_entries" -le "$before_entries" ] && [ "$after_entries" -ge $((before_entries - 20)) ] \
    && ok "real CHANGELOG: entries only ever removed as duplicates ($before_entries -> $after_entries)" \
    || bad "entry count moved unexpectedly" "$before_entries -> $after_entries"
  rm -f "$f"
fi

printf '\ndedup_changelog_unreleased self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
