#!/usr/bin/env bash
# Self-test for scripts/check_live_freshness.sh (#280).
#
# The freshness contract has THREE distinct verdicts (0 fresh · 1 stale ·
# 2 unreachable) and one precedence rule: staleness EVIDENCE beats an outage
# verdict (#254 — a pre-split frontend answering /admin/login proves stale even
# while the stats endpoint is down). The failing-first case here is that mixed
# state: revert the `*)` branch to a conditional `[ $fail -eq 0 ] && fail=1`
# and case 5 exits 2 instead of 1 — this file goes red.
#
# curl and jq are stubbed via a PATH shim (no network, no jq dependency):
#   STUB_STATS      = body the stats endpoint returns ('' = unreachable)
#   STUB_ADMIN_CODE = http_code for /admin/login (000 = unreachable)
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check_live_freshness.sh"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n     %s\n' "$1" "$2"; }

STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT

cat > "$STUB/curl" <<'SH'
#!/usr/bin/env bash
# admin-route probe carries -w; the stats probe does not
for a in "$@"; do
  if [ "$a" = "-w" ]; then printf '%s' "${STUB_ADMIN_CODE:-000}"; exit 0; fi
done
[ -n "${STUB_STATS:-}" ] && printf '%s' "$STUB_STATS"
exit 0
SH
cat > "$STUB/jq" <<'SH'
#!/usr/bin/env bash
# minimal jq -r '.backend_version // empty' over the test JSON shapes
sed -n 's/.*"backend_version" *: *"\([^"]*\)".*/\1/p'
SH
chmod +x "$STUB/curl" "$STUB/jq"

run() { # $1 stats body, $2 admin code
  PATH="$STUB:$PATH" STUB_STATS="$1" STUB_ADMIN_CODE="$2" \
    bash "$SCRIPT" "https://example.test" "1.14.0" 2>&1
}

check() { # $1 name, $2 want_rc, $3 got_rc, $4 want_line, $5 out
  if [ "$3" -eq "$2" ] && printf '%s' "$5" | grep -qF "$4"; then
    ok "$1"
  else
    bad "$1" "rc=$3 (want $2); out: $5"
  fi
}

# 1. fresh: right version, admin route already 404
out="$(run '{"backend_version":"1.14.0"}' 404)"; rc=$?
check "fresh → 0" 0 "$rc" "backend_version 1.14.0 fresh" "$out"
printf '%s' "$out" | grep -qF "admin_route 404 fresh" || bad "fresh admin line" "$out"

# 2. version-stale: live backend answers an older version
out="$(run '{"backend_version":"1.13.0"}' 404)"; rc=$?
check "version-stale → 1" 1 "$rc" "backend_version 1.13.0 STALE(want=1.14.0)" "$out"

# 3. admin-route-stale: version fresh but the pre-split frontend still serves /admin
out="$(run '{"backend_version":"1.14.0"}' 200)"; rc=$?
check "admin-route-stale → 1" 1 "$rc" "admin_route 200 STALE(want=404,pre-split-frontend)" "$out"

# 4. down: nothing answers anywhere — outage, not staleness
out="$(run '' 000)"; rc=$?
check "down → 2" 2 "$rc" "backend_version unreachable DOWN" "$out"
printf '%s' "$out" | grep -qF "admin_route unreachable DOWN" || bad "down admin line" "$out"

# 5. FAILING-FIRST / precedence: stats down BUT a pre-split frontend answers →
#    staleness evidence beats the outage verdict (#254). A conditional
#    `[ $fail -eq 0 ] && fail=1` regression exits 2 here and turns this red.
out="$(run '' 200)"; rc=$?
check "mixed down+stale → 1 (staleness beats outage)" 1 "$rc" "admin_route 200 STALE" "$out"

# ---------------------------------------------------------------------------
# Mutation contract (#393): neuter ONE verdict arm at a time in a COPY and
# require the pinned case to go red. INVALID (rotted needle / no diff /
# unparseable mutant / assertion false on the unmodified script) counts
# separately and fails the run (#388).
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  runx() { # script, stats body, admin code
    PATH="$STUB:$PATH" STUB_STATS="$2" STUB_ADMIN_CODE="$3" \
      bash "$1" "https://example.test" "1.14.0" 2>&1
  }
  mutate() { # name needle replacement assert-fn
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$STUB/mut.sh"
    if ! grep -qF "$needle" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return
    fi
    python3 - "$SCRIPT" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
open(dst, "w").write(open(src).read().replace(needle, repl, 1))
PY
    cmp -s "$SCRIPT" "$M" && { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — no change"; return; }
    bash -n "$M" 2>/dev/null || { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — not parseable"; return; }
    if ! "$assertfn" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — assertion fails on the UNMODIFIED script"; return
    fi
    if "$assertfn" "$M"; then
      SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: '$name' — the case stays green with the arm removed"
    else
      KILLED=$((KILLED+1)); echo "  ✓ killed: $name"
    fi
  }
  assert_stale() { local o; o="$(runx "$1" '{"backend_version":"1.13.0"}' 404)"
    [ $? -eq 1 ] && printf '%s' "$o" | grep -qF "STALE(want=1.14.0)"; }
  assert_down() { local o; o="$(runx "$1" '' 000)"
    [ $? -eq 2 ] && printf '%s' "$o" | grep -qF "backend_version unreachable DOWN"; }
  assert_precedence() { local o; o="$(runx "$1" '' 200)"
    [ $? -eq 1 ] && printf '%s' "$o" | grep -qF "admin_route 200 STALE"; }
  assert_admin_down() { local o; o="$(runx "$1" '{"backend_version":"1.14.0"}' 000)"
    [ $? -eq 2 ] && printf '%s' "$o" | grep -qF "admin_route unreachable DOWN"; }
  assert_admin_stale() { local o; o="$(runx "$1" '{"backend_version":"1.14.0"}' 200)"
    [ $? -eq 1 ] && printf '%s' "$o" | grep -qF "admin_route 200 STALE"; }

  mutate "version comparison removed (an old backend reads fresh)" \
    'elif [ "$live" != "$RELEASED" ]; then' 'elif false; then' assert_stale
  mutate "stats-unreachable arm removed (a down backend is not DOWN)" \
    'if [ -z "$live" ]; then' 'if false; then' assert_down
  mutate "staleness-beats-outage becomes conditional (the #254 regression verbatim)" \
    'fail=1 ;;' '{ [ "$fail" -eq 0 ] && fail=1; } ;;' assert_precedence
  mutate "admin-unreachable escalation removed (admin outage reads fresh)" \
    '[ "$fail" -eq 0 ] && fail=2 ;;' ': ;;' assert_admin_down
  mutate "404 pattern widened to catch-all (a pre-split frontend reads fresh)" \
    '404) echo "admin_route 404 fresh" ;;' '*) echo "admin_route 404 fresh" ;;' assert_admin_stale

  echo "check_live_freshness mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fail=$((fail+1))
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
