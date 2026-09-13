#!/usr/bin/env python3
"""Deduplicate CHANGELOG [Unreleased] entries after a rebase.

Run it after every rebase that touched CHANGELOG.md:

    python3 scripts/dedup_changelog_unreleased.py CHANGELOG.md

WHY IT EXISTS (v1.14.1 cycle): merging two `[Unreleased]` sections duplicates
HEADINGS and ENTRIES independently. A heading-only check passes while entries are
doubled — that shipped to review twice (#354, #362) and cost a round each. This
merges same-named sections into Keep-a-Changelog order AND drops bullets whose
title line already appeared.

Verify afterwards that the branch adds only its OWN bullets:

    diff <(git show origin/main:CHANGELOG.md | awk '/^## \[Unreleased\]/{f=1} /^## \[[0-9]/{f=0} f&&/^- \*\*/') \
         <(awk '/^## \[Unreleased\]/{f=1} /^## \[[0-9]/{f=0} f&&/^- \*\*/' CHANGELOG.md)


A rebase that merges two [Unreleased] sections can leave the SAME top-level
bullet twice (once from the base, once from the branch's copy of it). Section
merging alone does not catch that — the entries sit under different headings.
Keyed on the bullet's first line, which is the entry's title.
"""
import sys, re

p = sys.argv[1]
s = open(p).read()
lines = s.split("\n")
start = next(i for i, l in enumerate(lines) if l.startswith("## [Unreleased]"))
end = next(i for i, l in enumerate(lines) if re.match(r"^## \[\d", l))

secs, cur = [], None
for l in lines[start + 1:end]:
    if l.startswith("### "):
        cur = (l.strip(), []); secs.append(cur)
    elif cur is not None:
        cur[1].append(l)

def bullets(body):
    """Split a section body into top-level bullets (a bullet owns its indented continuation)."""
    out, b = [], None
    for l in body:
        if l.startswith("- "):
            if b: out.append(b)
            b = [l]
        elif b is not None:
            b.append(l)
        elif l.strip():
            out.append([l])
    if b: out.append(b)
    return out

from collections import OrderedDict
merged = OrderedDict()
for name, body in secs:
    merged.setdefault(name, []).extend(bullets(body))

seen, dropped = set(), 0
order = ["### Security", "### Added", "### Changed", "### Fixed", "### Removed"]
out = [""]
for name in order:
    if name not in merged: continue
    kept = []
    for b in merged[name]:
        key = b[0].strip()
        if key in seen:
            dropped += 1; continue
        seen.add(key); kept.append(b)
    if not kept: continue
    out.append(name)
    for b in kept:
        while b and not b[-1].strip(): b.pop()
        out.extend(b)
    out.append("")

open(p, "w").write("\n".join(lines[:start + 1] + out + lines[end:]))
print(f"dropped {dropped} duplicate bullet(s); kept {len(seen)}")
