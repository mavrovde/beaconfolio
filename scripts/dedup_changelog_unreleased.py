#!/usr/bin/env python3
"""Merge duplicated `[Unreleased]` sections in CHANGELOG.md after a rebase.

    python3 scripts/dedup_changelog_unreleased.py [CHANGELOG.md]

WHY IT EXISTS (v1.14.1 cycle): rebasing two branches that both wrote to
`[Unreleased]` duplicates HEADINGS and ENTRIES independently. A heading-only
check passes while entries are doubled — that reached review on #354 and #362
and cost a round each.

WHAT IT GUARANTEES — nothing is ever lost. This rewrites the file that holds the
project's release history, so the only acceptable failure mode is "did less than
asked", never "silently dropped something":

  * Sections it does not recognise (`### Docs`, `### Deprecated`, `### Reverted`,
    `### Documentation` — all real in this repo's history) are KEPT, appended
    after the known ones in first-appearance order. An earlier draft carried a
    five-name whitelist and silently deleted the rest; replaying this repo's
    CHANGELOG commits, 66 of them had a heading that whitelist would have
    destroyed.
  * Text between `## [Unreleased]` and its first `### ` heading is KEPT.
  * Fenced code blocks are not scanned for bullets, so a `- ` line inside a
    ``` fence stays with its entry instead of being torn out as a new one.
  * Everything from the first released section (`## [x.y.z]`) down is copied
    **byte-for-byte**; only the `[Unreleased]` block is ever rewritten. The
    blank-line collapse runs over the rebuilt block alone, never the tail — it
    used to run over the whole file and silently dropped blank lines inside
    shipped release notes (#383). A guarantee was weakened once to match that
    bug; the behaviour is fixed instead, so the strong promise holds again and a
    self-test case asserts it against a released section containing a fenced
    block.
  * A file with no `[Unreleased]` section is left untouched (exit 0, says so).

It is idempotent: running it twice changes nothing the second time. Verify after
a rebase that the branch adds only its OWN entries:

    diff <(git show origin/main:CHANGELOG.md | sed -n '/^## \\[Unreleased\\]/,/^## \\[[0-9]/p' | grep '^- ') \\
         <(sed -n '/^## \\[Unreleased\\]/,/^## \\[[0-9]/p' CHANGELOG.md | grep '^- ')
"""

import re
import sys

# Conventional order for the headings we know; anything else keeps its own
# position AFTER these, rather than being dropped.
KNOWN_ORDER = ["### Security", "### Added", "### Changed",
               "### Deprecated", "### Removed", "### Fixed"]

UNRELEASED_RE = re.compile(r"^## \[Unreleased\]", re.I)
RELEASED_RE = re.compile(r"^## \[[0-9]")
FENCE_RE = re.compile(r"^\s*(```|~~~)")


def split_entries(body):
    """Split a section body into top-level entries, fence-aware.

    An entry owns every following line until the next top-level `- ` bullet,
    including indented continuations and fenced code blocks.
    """
    entries, current, in_fence = [], None, False
    lead = None
    for line in body:
        if FENCE_RE.match(line):
            in_fence = not in_fence
            if current is not None:
                current.append(line)
                continue
        if not in_fence and line.startswith("- "):
            if current is not None:
                entries.append(current)
            current = [line]
            continue
        if current is not None:
            current.append(line)
        else:
            # Content under a heading BEFORE the first bullet. It must stay ONE
            # block: splitting it line-by-line fed each line to the dedup, which
            # then deleted a repeated line (e.g. `make build`) and the closing
            # fence with it, leaving an unterminated code block (review finding).
            if not entries or entries[-1] is not lead:
                lead = []
                entries.append(lead)
            lead.append(line)
    if current is not None:
        entries.append(current)
    return entries


def rstrip_block(block):
    out = list(block)
    while out and not out[-1].strip():
        out.pop()
    return out


def main(path):
    text = open(path, encoding="utf-8").read()
    lines = text.split("\n")

    start = next((i for i, l in enumerate(lines) if UNRELEASED_RE.match(l)), None)
    if start is None:
        print(f"{path}: no [Unreleased] section — nothing to do")
        return 0
    # end at the first RELEASED heading after it; if there is none, run to EOF
    end = next((i for i in range(start + 1, len(lines)) if RELEASED_RE.match(lines[i])),
               len(lines))

    preamble, sections, current = [], [], None
    in_fence = False
    for line in lines[start + 1:end]:
        if FENCE_RE.match(line):
            in_fence = not in_fence
        # A `### ` line INSIDE a fenced block is content, not a heading. Without
        # this it was torn out as a section and then deleted on merge (review
        # finding), which is the same loss class as the bullet splitter had.
        if line.startswith("### ") and not in_fence:
            current = (line.strip(), [])
            sections.append(current)
        elif current is not None:
            current[1].append(line)
        else:
            preamble.append(line)

    merged = {}
    order = []
    for name, body in sections:
        if name not in merged:
            merged[name] = []
            order.append(name)
        merged[name].extend(split_entries(body))

    # known headings first, in conventional order; then everything else in the
    # order it first appeared — kept, never dropped.
    ordered = [n for n in KNOWN_ORDER if n in merged]
    ordered += [n for n in order if n not in KNOWN_ORDER]

    dropped = 0
    out = list(rstrip_block(preamble))
    if out:
        out.append("")
    for name in ordered:
        # `seen` is PER SECTION, and the key is the WHOLE entry — not its first
        # line. Both were wrong in the first draft and both lost content: with a
        # global set, an entry under `### Fixed` whose first line matched one
        # under `### Added` was deleted along with its heading; with a first-line
        # key, two genuinely different entries that happen to share a title line
        # collapse into one. A rebase duplicates an entry *within* the section it
        # came from, so per-section is also the only shape that matches the
        # defect this exists for.
        seen = set()
        kept = []
        for entry in merged[name]:
            key = "\n".join(rstrip_block(entry))
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            kept.append(entry)
        if not kept:
            continue
        out.append(name)
        for entry in kept:
            out.extend(rstrip_block(entry))
        out.append("")

    # Collapse runs of blank lines in the REBUILT BLOCK ONLY (#383). This pass
    # used to run over the whole reconstructed file, including `lines[end:]` —
    # the released history this script promises never to touch. That silently
    # rewrote shipped release notes: blank lines vanished inside released
    # sections, visible in #371's own diff. Cosmetic there, but a released
    # section holding a fenced block would have had its internal blank lines
    # collapsed too — a content change, in the file of record.
    block, blank = [], False
    for line in [""] + out:
        if not line.strip():
            if blank:
                continue
            blank = True
        else:
            blank = False
        block.append(line)

    # `lines[end:]` is concatenated untouched, so everything from the first
    # released heading down stays byte-for-byte identical.
    new = lines[:start + 1] + block + lines[end:]

    open(path, "w", encoding="utf-8").write("\n".join(new))
    extra = [n for n in ordered if n not in KNOWN_ORDER]
    note = f"; kept {len(extra)} non-standard heading(s): {', '.join(extra)}" if extra else ""
    kept_total = sum(len(merged[n]) for n in ordered) - dropped
    print(f"{path}: dropped {dropped} duplicate entry(ies); "
          f"{kept_total} kept across {len(ordered)} section(s){note}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "CHANGELOG.md"))
