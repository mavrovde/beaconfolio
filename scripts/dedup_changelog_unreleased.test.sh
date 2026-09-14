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
# CALL AS:  run "$f"      then read "$RUN_OUT"
# NEVER as: run "$f"; out="$RUN_OUT"
# The second form puts the whole function in a SUBSHELL, so the `bad` below
# increments a counter that dies with it and prints into the captured string.
# Measured in review: a mutant that raised on every fenced input scored
# 19 passed / 0 failed / exit 0 — the fourth fake-green in this file. The rc
# check only works if it runs in the PARENT shell.
run() {
  RUN_OUT="$(python3 "$SCRIPT" "$1" 2>&1)"; RUN_RC=$?
  if [ "$RUN_RC" -ne 0 ]; then
    bad "script exited $RUN_RC (a crash leaves the file untouched — do not read that as success)" "$RUN_OUT"
  fi
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
run "$f"; out="$RUN_OUT"
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
run "$f"; out="$RUN_OUT"
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
run "$f"; out="$RUN_OUT"
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
run "$f"; out="$RUN_OUT"
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
run "$f"; out="$RUN_OUT"
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
run "$f"; out="$RUN_OUT"
[ "$(grep -c 'Dup (#9)' "$f")" = 1 ] && ok "a TRUE duplicate is still dropped (the whole point)" \
  || bad "dedup stopped working" "$(cat "$f")"
rm -f "$f"

# --- 4d. LOSS CASE: a fenced block BEFORE the first bullet (review round 3) --
#     The pre-bullet path split content one line per entry and then ran it
#     through dedup, so a repeated line inside a fence (`make build`) was
#     deleted along with the closing fence, leaving the block unterminated.
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Changed
Run these before pushing:

```sh
make build
make test
make build
```

- **an entry after the block** — normal.

## [1.0.0] - 2026-01-01
- old
MD
run "$f"; out="$RUN_OUT"
[ "$(grep -c '^make build' "$f")" = 2 ] \
  && ok "a repeated line inside a pre-bullet fence is kept (both copies)" \
  || bad "pre-bullet fence content deleted" "$(cat "$f")"
[ "$(grep -c '^```' "$f")" = 2 ] && ok "…and the block stays terminated" \
  || bad "fence unterminated" "markers=$(grep -c '^```' "$f")"
grep -q "Run these before pushing" "$f" && ok "…and its lead-in prose survives" \
  || bad "lead-in lost" "$(cat "$f")"
rm -f "$f"

# --- 4e. LOSS CASE: a '### ' line INSIDE a fenced block is CONTENT ----------
f="$(mktemp)"; cat > "$f" <<'MD'
# Changelog

## [Unreleased]

### Added
- **documents the changelog format** — like so:

```markdown
### Added
- an example entry
```

## [1.0.0] - 2026-01-01
- old
MD
run "$f"; out="$RUN_OUT"
[ "$(grep -c '^### Added' "$f")" = 2 ] \
  && ok "a '### ' inside a fence is content, not a heading" \
  || bad "fenced heading torn out" "$(cat "$f")"
grep -q "an example entry" "$f" && ok "…and the fenced example survives" \
  || bad "fenced example lost" "$(cat "$f")"
rm -f "$f"

# --- 5. EDGE: no [Unreleased] at all — leave the file alone ----------------
f="$(mktemp)"; printf '# Changelog\n\n## [1.0.0] - 2026-01-01\n- only a release\n' > "$f"
before="$(cat "$f")"
run "$f"; out="$RUN_OUT"; rc=$?
[ "$rc" -eq 0 ] && [ "$before" = "$(cat "$f")" ] \
  && ok "no [Unreleased]: exits 0 and changes nothing" || bad "no-unreleased" "rc=$rc; $out"
printf '%s' "$out" | grep -qi "nothing to do" || bad "no-unreleased message" "$out"
rm -f "$f"

# --- 6. EDGE: [Unreleased] with no released section under it ---------------
f="$(mktemp)"; printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- **a** — x.\n\n### Added\n- **b** — y.\n' > "$f"
run "$f"; out="$RUN_OUT"; rc=$?
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
run "$f"
once="$(cat "$f")"
run "$f"
[ "$once" = "$(cat "$f")" ] && ok "idempotent — a second run is a no-op" \
  || bad "not idempotent" "$(diff <(printf '%s' "$once") "$f")"
rm -f "$f"

# --- 8. NO WARNINGS on stderr (the SyntaxWarning the first draft emitted) ---
f="$(mktemp)"; printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- **a** — x.\n\n## [1.0.0] - 2026-01-01\n- old\n' > "$f"
warn="$(python3 -W error::SyntaxWarning "$SCRIPT" "$f" 2>&1 >/dev/null)"
[ -z "$warn" ] && ok "no SyntaxWarning / stderr noise" || bad "stderr noise" "$warn"
rm -f "$f"

# --- 8b. #383: the tail below the first released heading is BYTE-FOR-BYTE ----
# The blank-line collapse used to run over the whole reconstructed file, so it
# silently removed blank lines inside SHIPPED release notes. Cosmetic in prose,
# but a released section holding a fenced block has its internal blank lines
# collapsed too — a content change in the file of record.
# This case fails if the collapse ever runs over the tail again.
f="$(mktemp)"
cat > "$f" <<'EOSNIP'
# Changelog

## [Unreleased]

### Added
- one


### Added
- two

## [1.2.0] - 2026-01-01

### Fixed


- a released entry after TWO blank lines

```bash
echo one

echo two
```


- trailing released entry   
- entry with a tab	

## [1.1.0] - 2025-12-01

### Added
- older
EOSNIP
# Compare BYTES, not lines (#390 review). `tail_before="$(sed -n ...)"` cannot
# see this: command substitution strips trailing newlines and sed is
# line-oriented, so trailing whitespace, a missing final newline and CR bytes are
# all structurally invisible to a string compare. Two mutants survived that
# assertion at a green 26/0 — an rstrip over the tail, and dropping the final
# newline. Extract the tail as raw bytes and `cmp`.
cut_tail() { # cut_tail <file> <out> — raw bytes from the FIRST released heading
  # Finds the heading by pattern, and EXITS NON-ZERO if there is none. The first
  # draft hardcoded `## [1.2.0]` and wrote a `<MISSING>` sentinel on miss — so if
  # a fixture heading ever changed, both snapshots became the same sentinel and
  # `cmp` compared nothing while printing a green tick. Measured: renaming the
  # fixture heading and reintroducing the #383 bug gave 28 passed / 0 failed with
  # a ✓ on the very case meant to catch it (#390 review). A helper that silently
  # passes is the exact defect class this file exists to detect.
  python3 -c 'import re, sys
b = open(sys.argv[1], "rb").read()
m = re.search(rb"^## \[[0-9]", b, re.M)
if not m:
    sys.stderr.write("cut_tail: no released heading in %s\n" % sys.argv[1])
    sys.exit(1)
open(sys.argv[2], "wb").write(b[m.start():])' "$1" "$2" || return 1
}
tb="$(mktemp)"; ta="$(mktemp)"
cut_tail "$f" "$tb"
run "$f"; out="$RUN_OUT"
cut_tail "$f" "$ta"
# `[ -s ]` on both: cut_tail's non-zero exit does NOT propagate (the call sites
# ignore it and the file runs without `set -e`), so a failed extraction leaves
# two EMPTY snapshots -- and `cmp -s` calls two empty files equal (#390 review,
# round 3). An empty snapshot is never legitimate here.
if [ -s "$tb" ] && [ -s "$ta" ] && cmp -s "$tb" "$ta"; then
  ok "#383: released tail is BYTE-identical (blank lines, fence, trailing space, final newline)"
else
  bad "#383: released tail was rewritten" "$(cmp "$tb" "$ta" 2>&1 | head -3)"
fi
rm -f "$tb" "$ta"
# and the fix must not cost the actual job: the duplicate ### Added still merges
[ "$(grep -c '^### Added' "$f")" = 2 ] \
  && ok "#383: [Unreleased] still deduped (one ### Added there, one in 1.1.0)" \
  || bad "#383: dedup broke" "$(grep -n '^### Added' "$f")"
rm -f "$f"

# --- 8c. #383/#390: LINE ENDINGS survive the round trip ---------------------
# `open(path, encoding="utf-8")` does universal-newline translation, so CRLF and
# a lone CR were silently rewritten to LF and the write-back made it permanent.
# A lone \r inside a released entry is a CONTENT change, not whitespace -- and
# it falsified the docstring's byte-for-byte promise. Both opens pass newline="".
for _mode in crlf lonecr; do
  f="$(mktemp)"
  python3 -c '
import sys
mode = sys.argv[2]
base = ("# Changelog\n\n## [Unreleased]\n\n### Added\n- one\n\n\n### Added\n- two\n\n"
        "## [1.2.0] - 2026-01-01\n\n### Fixed\n- a released entry\n\n```bash\necho one\n\necho two\n```\n")
if mode == "crlf":
    data = base.replace("\n", "\r\n")
else:
    data = base.replace("- a released entry", "- a released\rentry")
open(sys.argv[1], "w", encoding="utf-8", newline="").write(data)' "$f" "$_mode"
  tb="$(mktemp)"; ta="$(mktemp)"
  cut_tail "$f" "$tb"
  run "$f"; out="$RUN_OUT"
  cut_tail "$f" "$ta"
  if [ -s "$tb" ] && [ -s "$ta" ] && cmp -s "$tb" "$ta"; then
    ok "#390: released tail byte-identical with $_mode line endings"
  else
    bad "#390: $_mode line endings were rewritten" "$(cmp "$tb" "$ta" 2>&1 | head -3)"
  fi
  rm -f "$f" "$tb" "$ta"
done

# --- 9. THE REAL FILE: running it on the repo's own CHANGELOG loses nothing -
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -f "$ROOT/CHANGELOG.md" ]; then
  f="$(mktemp)"; cp "$ROOT/CHANGELOG.md" "$f"
  before_entries="$(grep -c '^- ' "$f")"
  before_rel="$(grep -c '^## \[[0-9]' "$f")"
  run "$f"
  after_entries="$(grep -c '^- ' "$f")"
  after_rel="$(grep -c '^## \[[0-9]' "$f")"
  [ "$before_rel" = "$after_rel" ] \
    && ok "real CHANGELOG: every release heading survives ($after_rel)" \
    || bad "release headings lost" "$before_rel -> $after_rel"
  [ "$after_entries" -eq "$before_entries" ] \
    && ok "real CHANGELOG: entry count UNCHANGED ($before_entries) — not 'within 20'" \
    || bad "entry count moved unexpectedly" "$before_entries -> $after_entries"
  rm -f "$f"
fi

printf '\ndedup_changelog_unreleased self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
