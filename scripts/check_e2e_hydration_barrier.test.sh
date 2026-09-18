#!/usr/bin/env bash
# Self-test for scripts/check_e2e_hydration_barrier.sh.
#
# The house rule (lessons §18, §16): a gate that has never been observed to fail
# is indistinguishable from a gate that cannot fail. So the negative cases come
# first and outnumber the positives.
#
# CASE 1 IS THE ONE THAT MATTERS, and it is here because the checker ALREADY
# SHIPPED THIS BUG once, in the hour before it was committed. The first draft
# found the beforeEach body with a regex that ended at the first `});` — which in
# llm-interaction.spec.ts is a nested `addInitScript` callback, three lines ABOVE
# the `page.goto('/llm')`. The navigation fell outside the block, five genuinely
# unguarded fills were classified "destination unknown", and the checker printed
# a green tick over the exact defect it exists to catch. Structure is now matched
# by counting braces on a string/comment-masked copy, and this case pins it.
#
# The other axis worth pinning is CASE 5: a spec that lives in e2e/public/ but
# drives the ADMIN app must PASS. The admin app is a CSR SPA with no
# pre-hydration window, and an earlier directory-scoped draft produced four false
# positives in blog-display.spec.ts this way. A check that cries wolf on the
# admin seeding path gets a blanket exclusion added to it within a release, and
# then it protects nothing.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$SCRIPT_DIR/check_e2e_hydration_barrier.sh"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n' "$1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# fixture <name> <<'EOF' … EOF   → writes a spec into a FRESH directory and sets $d.
#
# It sets a variable rather than echoing the path because `fixture x <<'EOF'
# … EOF)"` is BROKEN in bash: the `$( )` scanner counts parentheses through the
# heredoc body, so a fixture containing `});` on a line with other text closes
# the substitution early and the directory name comes out as
# `<name>;\nEOF\n)`. The checker then reports "does not exist — skipping" and
# the case passes vacuously. Spec fixtures are made of `});`, so this is not a
# corner to route around.
fixture() {
  d="$TMP/$1"
  mkdir -p "$d"
  cat > "$d/fixture.spec.ts"
}

# expect <rc> <description> <dir> [grep-pattern]
expect() {
  local want="$1" desc="$2" dir="$3" pattern="${4:-}"
  local out rc
  out="$(bash "$CHECKER" "$dir" 2>&1)"; rc=$?
  if [ "$rc" != "$want" ]; then
    bad "$desc — expected rc=$want, got rc=$rc"
    printf '%s\n' "$out" | sed 's/^/      /'
    return
  fi
  if [ -n "$pattern" ] && ! printf '%s' "$out" | grep -q "$pattern"; then
    bad "$desc — rc ok but output lacked '$pattern'"
    printf '%s\n' "$out" | sed 's/^/      /'
    return
  fi
  ok "$desc"
}

echo "== it must FAIL when a public page is typed into unhydrated =="

fixture nested_beforeeach <<'EOF'
test.describe('Terminal', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
        await page.goto('/llm');
    });

    test('types a message', async ({ page }) => {
        await page.locator('input').fill('hello');
    });
});
EOF
expect 1 "beforeEach whose goto sits AFTER a nested callback's }); (the shipped bug)" "$d" "types a message"

fixture plain <<'EOF'
test('fills the contact form', async ({ page }) => {
    await page.goto('/contact');
    await page.locator('#name').fill('A');
});
EOF
expect 1 "public goto then fill, no barrier" "$d"

fixture barrier_after <<'EOF'
test('fills then waits', async ({ page }) => {
    await page.goto('/contact');
    await page.locator('#name').fill('A');
    await page.waitForLoadState('networkidle');
});
EOF
expect 1 "barrier present but AFTER the fill" "$d"

fixture renavigates <<'EOF'
test('second navigation drops the barrier', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
    await page.locator('#name').fill('A');
    await page.goto('/cv');
    await page.locator('#name').fill('B');
});
EOF
expect 1 "a SECOND public goto re-arms the requirement" "$d"

echo "== it must PASS when the hazard is absent =="

fixture guarded <<'EOF'
test('fills after hydrating', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
    await page.locator('#name').fill('A');
});
EOF
expect 0 "barrier before the fill" "$d"

fixture admin <<'EOF'
test('seeds a post through the admin app', async ({ page }) => {
    await page.goto(`${config.adminUrl}/login`);
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'pw');
});
EOF
expect 0 "admin (CSR) destination — the false positive that forced the re-scope" "$d"

fixture beforeeach_barrier <<'EOF'
test.describe('Contact', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/contact');
        await page.waitForLoadState('networkidle');
    });

    test('fills', async ({ page }) => {
        await page.locator('#name').fill('A');
    });
});
EOF
expect 0 "a barrier in beforeEach covers every test in the describe" "$d"

fixture describe_only <<'EOF'
test.describe('a suite that never fills anything', () => {
    test('asserts only', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toBeVisible();
    });
});
EOF
expect 0 "test.describe( is not itself a test block" "$d"

fixture no_goto <<'EOF'
test('fills with no navigation in scope', async ({ page }) => {
    await page.locator('#name').fill('A');
});
EOF
expect 0 "unknown destination is NOT flagged (documented limit)" "$d"

# Commented-out code is the everyday source of an UNBALANCED brace: this comment
# closes a callback that no longer exists. Unmasked, its `});` ends the beforeEach
# two lines early, the goto falls outside, and the unguarded fill below is
# silently reclassified "destination unknown" — a false NEGATIVE, so the case has
# to be a failing one to be able to catch it.
fixture brace_in_comment <<'EOF'
test.describe('Terminal', () => {
    test.beforeEach(async ({ page }) => {
        // TODO(#391): restore the seeded fixture — it used to close with });
        await page.goto('/llm');
    });

    test('types', async ({ page }) => {
        await page.locator('input').fill('hi');
    });
});
EOF
expect 1 "an unbalanced brace in a COMMENT does not end the block early" "$d"

echo "== stated limits, pinned so they stay deliberate =="

expect 0 "missing directory exits 0 with a note (polarity, #353)" "$TMP/does-not-exist" "does not exist"

echo "== the repository's own specs =="
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
expect 0 "frontend/e2e/public is clean" "$ROOT/frontend/e2e/public"

if [ "${1:-}" = "--mutations" ]; then
  echo ""
  echo "== mutations: each neutered rule must be KILLED by a case above =="
  KILLED=0; SURVIVED=0; INVALID=0
  MUT="$TMP/mutant.sh"

  # mutate <description> <old> <new> <dir-that-must-change-verdict> <expected-rc-when-healthy>
  mutate() {
    local desc="$1" old="$2" new="$3" dir="$4" want="$5"
    python3 - "$CHECKER" "$MUT" "$old" "$new" <<'PY' || { INVALID=$((INVALID+1)); printf '  ! %s — patch did not apply\n' "$desc"; return; }
import sys
src = open(sys.argv[1]).read()
old, new = sys.argv[3], sys.argv[4]
if src.count(old) != 1:
    sys.exit(1)
open(sys.argv[2], "w").write(src.replace(old, new))
PY
    local rc
    bash "$MUT" "$dir" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "$want" ]; then
      SURVIVED=$((SURVIVED+1)); printf '  ✗ SURVIVED: %s\n' "$desc"
    else
      KILLED=$((KILLED+1)); printf '  ✓ killed: %s\n' "$desc"
    fi
  }

  mutate "masking removed — an unbalanced brace in a comment ends the block early" \
    'return "".join(out)' 'return src' "$TMP/brace_in_comment" 1
  mutate "admin destinations classified as public" \
    'ADMIN = re.compile(r"adminUrl|[' "'" '\\"`]/admin\\b|admin\\.localhost")' \
    'ADMIN = re.compile(r"(?!x)x")' "$TMP/admin" 0
  mutate "a goto no longer clears the barrier flag" \
    'nav = "admin" if ADMIN.search(m.group(1) or "") else "public"
            barrier = False' \
    'nav = "admin" if ADMIN.search(m.group(1) or "") else "public"' \
    "$TMP/renavigates" 1
  mutate "the fill check can never fire" \
    'if nav == "public" and not barrier:' 'if False:' "$TMP/plain" 1
  mutate "barrier detected regardless of position" \
    'elif token == BARRIER:
            barrier = True' \
    'elif token == BARRIER:
            pass
        if BARRIER in text:
            barrier = True' \
    "$TMP/barrier_after" 1

  echo "hydration-barrier mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fail=$((fail+1))
fi

printf '\nhydration-barrier self-test: %d passed, %d failed\n' "$pass" "$fail"

# A FLOOR on the case count: without it a harness that skipped every fixture
# would exit 0 and this suite would be decoration.
MIN_CASES=12
if [ "$pass" -lt "$MIN_CASES" ]; then
  printf '  ✗ only %d cases ran; expected at least %d — did the harness skip?\n' "$pass" "$MIN_CASES"
  fail=$((fail+1))
fi

[ "$fail" -eq 0 ]
