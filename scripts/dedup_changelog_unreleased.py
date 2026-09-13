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
    byte-for-byte; only the `[Unreleased]` block is ever rewritten.
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
        elif line.strip():
            # prose sitting under a heading before any bullet — keep it as its
            # own block so it cannot be lost
            entries.append([line])
    if current is not None:
        entries.append(current)
    return entries


def rstrip_block(block):
    out = list(block)
    while out and not out[-1].strip():
        out.pop()
    return out


def main(path):
    text = open(path).read()
    lines = text.split("\n")

    start = next((i for i, l in enumerate(lines) if UNRELEASED_RE.match(l)), None)
    if start is None:
        print(f"{path}: no [Unreleased] section — nothing to do")
        return 0
    # end at the first RELEASED heading after it; if there is none, run to EOF
    end = next((i for i in range(start + 1, len(lines)) if RELEASED_RE.match(lines[i])),
               len(lines))

    preamble, sections, current = [], [], None
    for line in lines[start + 1:end]:
        if line.startswith("### "):
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

    seen, dropped = set(), 0
    out = list(rstrip_block(preamble))
    if out:
        out.append("")
    for name in ordered:
        kept = []
        for entry in merged[name]:
            key = entry[0].strip()
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

    new = lines[:start + 1] + [""] + out + lines[end:]
    # collapse any run of blank lines introduced above
    collapsed, blank = [], False
    for line in new:
        if not line.strip():
            if blank:
                continue
            blank = True
        else:
            blank = False
        collapsed.append(line)

    open(path, "w").write("\n".join(collapsed))
    extra = [n for n in ordered if n not in KNOWN_ORDER]
    note = f"; kept {len(extra)} non-standard heading(s): {', '.join(extra)}" if extra else ""
    print(f"{path}: dropped {dropped} duplicate entry(ies); "
          f"{len(seen)} kept across {len(ordered)} section(s){note}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "CHANGELOG.md"))
