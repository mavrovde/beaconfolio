#!/bin/bash
# check_e2e_hydration_barrier.sh — after navigating to a PUBLIC (SSR) page, an
# e2e test must cross a hydration barrier before it types into a form.
#
# WHY THIS IS EXECUTABLE AND NOT A COMMENT. The public app is SSR: the form
# exists in the server HTML before Angular attaches to it. Filling an input in
# that window is silently undone — `setUpControl` calls `writeValue` as the
# control binds, so the typed text is wiped, the FormGroup stays pristine and
# invalid, and the submit button never enables. The test then fails at the
# CLICK, retrying a `disabled` button until the 120s timeout, three steps away
# from the cause. It applies to `[(ngModel)]` exactly as to `formControlName`:
# both go through a ControlValueAccessor.
#
# It has now cost two incidents. contact-form.spec.ts gained
# `await page.waitForLoadState('networkidle')` as a REVIEW BLOCKER after the race
# was reproduced 1-in-60, and its comment claims "Every other public spec uses
# this idiom" — which was false. cv.spec.ts filled four inputs with no barrier
# and survived on timing luck until #425's control-flow rewrite changed that
# template's render shape and tipped it, turning a green `main` red and blocking
# a release. A claim in a comment cannot stay true on its own; this is the layer
# that can enforce it (lessons §30).
#
# THE AXIS IS THE NAVIGATION, NOT THE DIRECTORY. The first draft of this check
# keyed on `frontend/e2e/public/**` and produced four false positives in
# blog-display.spec.ts, which lives there but drives the ADMIN app
# (`page.goto(`${config.adminUrl}/login`)`) to seed posts before asserting on the
# public page. The admin app is a CSR SPA — nothing is in the DOM until Angular
# renders it, so there is no pre-hydration window and Playwright's auto-waiting
# is sufficient. So the unit of judgement is each `page.goto(...)`: a PUBLIC
# destination arms the requirement, an ADMIN one does not.
#
# STATED LIMITS:
#   * Textual and linear. A barrier reached through a helper defined elsewhere is
#     not seen — write it inline, as every current spec does.
#   * A `.fill(` reached with NO preceding `goto` in scope is not flagged: the
#     destination is unknown and guessing would manufacture false positives.
#   * A destination built from a variable this check cannot read is treated as
#     PUBLIC (fail-closed) unless the expression names the admin URL or an
#     `/admin` path.
#   * It proves a barrier EXISTS, not that it is sufficient. A test that still
#     races needs a stronger assertion on application state, not a second
#     barrier.
#
# POLARITY: a missing directory exits 0 WITH A NOTE (foreign repo, #353), never
# silently green on a bad glob.
set -u

DIR="${1:-frontend/e2e/public}"

if [ ! -d "$DIR" ]; then
  echo "note: $DIR does not exist — skipping (nothing to check)"
  exit 0
fi

python3 - "$DIR" <<'PY'
import glob
import os
import re
import sys

directory = sys.argv[1]

BARRIER = "waitForLoadState('networkidle')"
# `test(`, `test.only(`, `test.skip(` … start a test block. `test.describe(` does
# NOT — matching it collapsed a whole describe body into one pseudo-test in the
# first draft and mislabelled every finding in it. `test.beforeEach(` is excluded
# by construction: this pattern demands a quoted title right after the paren.
BLOCK = re.compile(r"^[ \t]*test(?:\.(?!describe)\w+)?[ \t]*\(\s*(['\"`])(.+?)\1", re.M)
BEFORE = re.compile(r"^[ \t]*test\.beforeEach[ \t]*\(", re.M)
# Events, in source order.
EVENT = re.compile(r"\.goto\(\s*([^\n]*?)\s*\)|\.fill\(|" + re.escape(BARRIER))
ADMIN = re.compile(r"adminUrl|['\"`]/admin\b|admin\.localhost")


def mask(src):
    """Blank string/template/comment CONTENT, preserving length and offsets.

    Structure is matched on this copy so a brace inside a literal cannot be
    counted. The first draft used a regex (`beforeEach\\s*\\(.*?^\\s*\\}\\);`) and it
    ended the block at the FIRST `});` — the nested `addInitScript` callback in
    llm-interaction.spec.ts — leaving that file's `goto('/llm')` outside the
    block. Its four unguarded fills then read as "destination unknown" and the
    check went GREEN with the bug it exists to catch sitting in the tree.
    """
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            quote, i = c, i + 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    out[i] = " "
                    i += 1
                    if i < n:
                        out[i] = " "
                        i += 1
                    continue
                out[i] = " "
                i += 1
            i += 1
        elif src.startswith("//", i):
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
        elif src.startswith("/*", i):
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            for j in range(i, end):
                if src[j] != "\n":
                    out[j] = " "
            i = end
        else:
            i += 1
    return "".join(out)


def block_end(masked, open_paren):
    """Offset just past the callback whose argument list opens at `open_paren`."""
    depth = 0
    for i in range(open_paren, len(masked)):
        c = masked[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i + 1
    return len(masked)


def scan(text, start_nav, start_barrier):
    """Replay a block linearly. Returns (nav, barrier, [offending offsets])."""
    nav, barrier, bad = start_nav, start_barrier, []
    for m in EVENT.finditer(text):
        token = m.group(0)
        if token.startswith(".goto("):
            nav = "admin" if ADMIN.search(m.group(1) or "") else "public"
            barrier = False
        elif token == BARRIER:
            barrier = True
        else:  # .fill(
            if nav == "public" and not barrier:
                bad.append(m.start())
    return nav, barrier, bad


failures = []
checked = 0

for path in sorted(glob.glob(os.path.join(directory, "*.spec.ts"))):
    src = open(path, encoding="utf-8").read()
    masked = mask(src)
    name = os.path.basename(path)

    def line_of(offset, src=src):
        return src.count("\n", 0, offset) + 1

    # A beforeEach runs before every test, so its end-state is each test's start.
    init_nav, init_barrier = (None, False)
    before = BEFORE.search(masked)
    if before:
        start = before.end() - 1
        body = src[start:block_end(masked, start)]
        init_nav, init_barrier, before_bad = scan(body, None, False)
        for off in before_bad:
            failures.append(
                f"{name}:{line_of(start + off)} (beforeEach): fills a PUBLIC page with no hydration barrier"
            )

    for m in BLOCK.finditer(src):
        open_paren = src.index("(", m.start())
        start = open_paren
        block = src[start:block_end(masked, start)]
        if ".fill(" not in block:
            continue
        checked += 1
        _, _, bad = scan(block, init_nav, init_barrier)
        for off in bad:
            failures.append(
                f"{name}:{line_of(start + off)} › {m.group(2)}: fills a PUBLIC page with no hydration barrier"
            )

if failures:
    print("✗ E2E hydration barrier: a test types into an SSR page before it hydrates:")
    for f in failures:
        print(f"    {f}")
    print("")
    print("  Add `await page.waitForLoadState('networkidle');` after the public")
    print("  page.goto() and BEFORE the first fill. Without it, hydration's")
    print("  writeValue wipes the typed values and the failure surfaces as a")
    print("  click timeout on a disabled button, far from the cause.")
    print("  See contact-form.spec.ts for the idiom.")
    sys.exit(1)

print(
    f"✓ E2E hydration barrier: {checked} form-filling test(s) in {directory}, "
    "every public-page fill crosses a barrier first."
)
PY
