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

# EVERY case must assert the script SUCCEEDED, not merely that the file still
# looks right. A crashing script leaves the file byte-for-byte untouched, so
# "nothing was lost" passes trivially — measured: a mutant with a NameError
# scored 16/18 green because the two cases it broke never noticed it had died.
# `run` therefore fails the case itself on a non-zero exit.
run() {
  RUN_OUT="$(python3 "$SCRIPT" "$1" 2>&1)"; RUN_RC=$?
  if [ "$RUN_RC" -ne 0 ]; then
    bad "script exited $RUN_RC (a crash leaves the file untouched — do not read that as success)" "$RUN_OUT"
  fi
  printf '%s' "$RUN_OUT"
}

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

# --- 4. LOSS CASE: an UNINDENTED '- ' inside a fence, WITH a repeat ---------
#     Two things had to be fixed here before this case discriminated at all.
#     (a) The fence bullets must be UNINDENTED — indented ones are protected by
#         the plain `startswith("- ")` check on its own.
#     (b) The same fenced line must appear in TWO entries. Without that, ripping
#         out the fence logic still yields byte-identical output (measured), so
#         the case was fake-green: every torn-out fence line was unique, stayed
#         in order, and nothing was visibly lost.
#     With (b), removing fence-awareness makes the second `- name: a step` look
#     like a repeat of the first and DELETES it, corrupting the code block.
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Added
- **first entry** — uses this snippet:

```yaml
- name: a step
```
- **second entry** — uses the very same snippet:

```yaml
- name: a step
```

## [1.0.0] - 2026-01-01
- old
MD
out="$(run "$f")"
[ "$(grep -c '^- name: a step' "$f")" = 2 ] \
  && ok "an identical line inside TWO fences survives in both (fence-aware)" \
  || bad "fenced line deduped away" "$(cat "$f")"
[ "$(grep -c '^```' "$f")" = 4 ] && ok "…all four fence markers survive" \
  || bad "fence markers lost" "count=$(grep -c '^```' "$f")"
grep -q "second entry" "$f" && ok "…and the second entry survives" \
  || bad "second entry lost" "$(cat "$f")"
rm -f "$f"

# --- 4b. LOSS CASE: the SAME TITLE LINE under two different headings -------
#     The first draft keyed dedup on the entry's FIRST LINE with a set shared
#     across sections. So an entry under `### Fixed` whose title line matched
#     one under `### Added` was deleted — with its heading — and reported only
#     as "dropped 1 duplicate entry(ies)".
#     The title lines below are BYTE-IDENTICAL and the difference is on the
#     continuation line; that is the only shape that exercises the bug. An
#     earlier fixture put the differing text on the title line itself, so the
#     keys differed and the mutant survived (measured).
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Added
- **Thing (#1)** —
  the added half.

### Fixed
- **Thing (#1)** —
  the fixed half, genuinely different content.

## [1.0.0] - 2026-01-01
- old
MD
out="$(run "$f")"
if grep -q "the added half" "$f" && grep -q "the fixed half" "$f" \
   && grep -qF "### Added" "$f" && grep -qF "### Fixed" "$f"; then
  ok "identical title under two headings: BOTH kept, both headings kept"
else bad "cross-section deletion" "$(cat "$f")"; fi
[ "$(grep -c 'Thing (#1)' "$f")" = 2 ] && ok "…both entries present, not collapsed" \
  || bad "entry collapsed" "count=$(grep -c 'Thing (#1)' "$f")"
rm -f "$f"

# --- 4c. a TRUE duplicate (identical text, same section) is still dropped ---
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Fixed
- **Dup (#9)** — identical body.

### Fixed
- **Dup (#9)** — identical body.

## [1.0.0] - 2026-01-01
- old
MD
out="$(run "$f")"
[ "$(grep -c 'Dup (#9)' "$f")" = 1 ] && ok "a TRUE duplicate is still dropped (the whole point)" \
  || bad "dedup stopped working" "$(cat "$f")"
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
