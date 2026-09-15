#!/usr/bin/env bash
# Self-test for scripts/run_frontend_suites.sh — with a FAKE npm on PATH, so the
# cases run in milliseconds and can script failures the real runner can't.
#
# The cases that matter are the two that could weaken the gate:
#   * a REAL test failure must NOT be retried and must fail (case 2/3);
#   * the teardown flake must be retried at most ONCE and must fail if it recurs
#     (case 5).
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/run_frontend_suites.sh"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n     %s\n' "$1" "$2"; }

TEARDOWN='Unhandled Error: [vitest-worker]: Closing rpc while "onUserConsoleLog" is pending'

# Build a fake npm. $1=dir  $2=script body deciding per-target behaviour.
mk_npm() {
  d="$1"; mkdir -p "$d/bin"
  { echo '#!/usr/bin/env bash'
    echo 'target="$2"'                     # npm run <target>
    echo 'state="$FAKE_STATE_DIR/$target"'
    echo 'n=$(( $(cat "$state" 2>/dev/null || echo 0) + 1 ))'
    echo 'echo "$n" > "$state"'
    printf '%s\n' "$2"
  } > "$d/bin/npm"
  chmod +x "$d/bin/npm"
}

# Sets OUT (captured output) and RC in the CURRENT shell — a command
# substitution would run this in a subshell and RC would never come back.
run() { # run <npm-body>
  LAST_DIR="$(mktemp -d)"; mk_npm "$LAST_DIR" "$1"
  OUT="$(FAKE_STATE_DIR="$LAST_DIR" NPM_BIN="$LAST_DIR/bin/npm" FRONTEND_DIR="$LAST_DIR" \
    bash "$SCRIPT" 2>&1)"
  RC=$?
}

# --- 1. All three projects green -------------------------------------------
run 'echo "$target: 10 passed"; exit 0'
[ "$RC" -eq 0 ] && ok "all green -> rc 0" || bad "all green" "rc=$RC"
printf '%s' "$OUT" | grep -q 'test:shared' && printf '%s' "$OUT" | grep -q 'test:admin' \
  && ok "all three projects ran" || bad "all three ran" "$OUT"
rm -rf "$LAST_DIR"

# --- 2. A REAL failure fails, and is NOT retried -----------------------------
run 'if [ "$target" = "test:public" ]; then echo "1 failed | 9 passed"; exit 1; fi; echo ok; exit 0'
[ "$RC" -eq 1 ] && ok "a real test failure fails the run" || bad "real failure fails" "rc=$RC"
printf '%s' "$OUT" | grep -q 'FLAKE' && bad "real failure was retried" "$OUT" \
  || ok "…and is not retried (no FLAKE line)"

# --- 3. Later projects STILL RUN after an earlier one fails ------------------
#     (`npm test`'s && chain is exactly what hid the admin suite twice)
printf '%s' "$OUT" | grep -q 'test:admin' \
  && ok "admin still ran after public failed" || bad "admin ran after failure" "$OUT"
rm -rf "$LAST_DIR"

# --- 4. The teardown flake with 0 failed tests is retried ONCE and survives ---
run 'if [ "$target" = "test:public" ] && [ "$n" -eq 1 ]; then
  echo "Test Files 42 passed (42)"; echo "Tests 337 passed (337)";
  echo "'"$TEARDOWN"'"; exit 1; fi; echo "ok"; exit 0'
[ "$RC" -eq 0 ] && ok "teardown flake + 0 failed -> retried and passes" || bad "flake retried" "rc=$RC out=$OUT"
printf '%s' "$OUT" | grep -q 'FLAKE SURVIVED' \
  && ok "…and the flake is reported LOUDLY, not absorbed" || bad "flake reported" "$OUT"
[ "$(cat "$LAST_DIR/test:public" 2>/dev/null)" = "2" ] \
  && ok "…exactly two invocations of that project" || bad "retry count" "$(cat "$LAST_DIR/test:public" 2>/dev/null)"
rm -rf "$LAST_DIR"

# --- 5. The flake RECURRING still fails (retry is once, not until green) ------
run 'if [ "$target" = "test:public" ]; then
  echo "Tests 337 passed (337)"; echo "'"$TEARDOWN"'"; exit 1; fi; echo ok; exit 0'
[ "$RC" -eq 1 ] && ok "flake on BOTH attempts still fails" || bad "recurring flake fails" "rc=$RC"
[ "$(cat "$LAST_DIR/test:public" 2>/dev/null)" = "2" ] \
  && ok "…and retries at most once" || bad "retry bound" "$(cat "$LAST_DIR/test:public" 2>/dev/null)"
rm -rf "$LAST_DIR"

# --- 6. Teardown signature WITH failed tests is a real failure, not a flake ---
run 'if [ "$target" = "test:public" ]; then
  echo "Tests 3 failed | 334 passed"; echo "'"$TEARDOWN"'"; exit 1; fi; echo ok; exit 0'
[ "$RC" -eq 1 ] && ok "teardown text + failed tests -> real failure" || bad "signature+failures" "rc=$RC"
[ "$(cat "$LAST_DIR/test:public" 2>/dev/null)" = "1" ] \
  && ok "…and is not retried" || bad "not retried" "$(cat "$LAST_DIR/test:public" 2>/dev/null)"
rm -rf "$LAST_DIR"

# --- 7. A non-teardown crash is not retried ---------------------------------
run 'if [ "$target" = "test:admin" ]; then echo "Error: Cannot find module x"; exit 2; fi; echo ok; exit 0'
[ "$RC" -eq 1 ] && ok "an unrelated crash fails" || bad "unrelated crash" "rc=$RC"
[ "$(cat "$LAST_DIR/test:admin" 2>/dev/null)" = "1" ] \
  && ok "…and is not retried" || bad "crash not retried" "$(cat "$LAST_DIR/test:admin" 2>/dev/null)"
rm -rf "$LAST_DIR"

# --- 8. THE CI INVOCATION PATH (#319): one project + --coverage --------------
#     deploy.yml calls this as `FRONTEND_PROJECTS=public … --coverage`, which is
#     a different code path from the gate's all-three default: it must target
#     `test:coverage:<p>` (not `test:<p>`) and must run ONLY that project.
run_one() { # run_one <project> <npm-body>
  LAST_DIR="$(mktemp -d)"; mk_npm "$LAST_DIR" "$2"
  OUT="$(FAKE_STATE_DIR="$LAST_DIR" NPM_BIN="$LAST_DIR/bin/npm" FRONTEND_DIR="$LAST_DIR" \
    FRONTEND_PROJECTS="$1" bash "$SCRIPT" --coverage 2>&1)"
  RC=$?
}
run_one public 'echo "$target: 10 passed"; exit 0'
[ "$RC" -eq 0 ] && ok "CI path: single project + --coverage -> rc 0" || bad "CI path green" "rc=$RC out=$OUT"
printf '%s' "$OUT" | grep -q 'test:coverage:public' \
  && ok "…targets test:coverage:public (the coverage script, not the bare one)" \
  || bad "CI path target" "$OUT"
printf '%s' "$OUT" | grep -qE 'test:(coverage:)?(shared|admin)' \
  && bad "CI path ran other projects" "$OUT" \
  || ok "…and runs ONLY that project (CI parallelises the other two)"
rm -rf "$LAST_DIR"

# The retry must protect the CI path too — that is the whole point of #319.
run_one public 'if [ "$n" -eq 1 ]; then
  echo "Tests 337 passed (337)"; echo "'"$TEARDOWN"'"; exit 1; fi; echo ok; exit 0'
[ "$RC" -eq 0 ] && ok "CI path: teardown flake is retried and survives" || bad "CI path retry" "rc=$RC out=$OUT"
[ "$(cat "$LAST_DIR/test:coverage:public" 2>/dev/null)" = "2" ] \
  && ok "…exactly two invocations" || bad "CI retry count" "$(cat "$LAST_DIR/test:coverage:public" 2>/dev/null)"
rm -rf "$LAST_DIR"

# …and a REAL failure on the CI path still fails (the gate is not weakened).
run_one public 'echo "Tests 3 failed | 334 passed"; exit 1'
[ "$RC" -eq 1 ] && ok "CI path: a real failure still fails the job" || bad "CI path real failure" "rc=$RC"
[ "$(cat "$LAST_DIR/test:coverage:public" 2>/dev/null)" = "1" ] \
  && ok "…and is not retried" || bad "CI real failure retried" "$(cat "$LAST_DIR/test:coverage:public" 2>/dev/null)"
rm -rf "$LAST_DIR"

# ---------------------------------------------------------------------------
# Mutation contract (#393): neuter ONE arm of the wrapper at a time in a COPY
# and require the pinned case to go red. Every assert runs against the FAKE
# npm — no mutant ever invokes real Vitest. INVALID (rotted needle / no diff /
# unparseable / assertion false on the unmodified script) counts separately
# and fails the run (#388).
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  MT="$(mktemp -d)"; trap 'rm -rf "$MT"' EXIT
  runm() { # script npm-body [env: MPROJ, MCOV]
    local d; d="$(mktemp -d "$MT/f.XXXXXX")"; mk_npm "$d" "$2"
    OUT="$(FAKE_STATE_DIR="$d" NPM_BIN="$d/bin/npm" FRONTEND_DIR="$d" \
      FRONTEND_PROJECTS="${MPROJ:-shared public admin}" bash "$1" ${MCOV:-} 2>&1)"
    RC=$?; LAST_DIR="$d"
  }
  mutate() { # name needle replacement assert-fn
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$MT/mut.sh"
    if ! grep -qF -- "$(printf '%s' "$needle" | head -1)" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return
    fi
    python3 - "$SCRIPT" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
t = open(src).read()
if needle not in t:
    sys.exit(3)
open(dst, "w").write(t.replace(needle, repl, 1))
PY
    [ $? -eq 3 ] && { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — full needle not found (rotted)"; return; }
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
  assert_real_failure_fails() { runm "$1" 'if [ "$target" = "test:public" ]; then echo "1 failed | 9 passed"; exit 1; fi; echo ok; exit 0'
    [ "$RC" -eq 1 ]; }
  assert_all_run() { runm "$1" 'if [ "$target" = "test:public" ]; then echo "1 failed | 9 passed"; exit 1; fi; echo ok; exit 0'
    [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q 'test:admin'; }
  assert_failed_not_retried() { runm "$1" 'if [ "$target" = "test:public" ]; then
      echo "Tests 3 failed | 334 passed"; echo "'"$TEARDOWN"'"; exit 1; fi; echo ok; exit 0'
    [ "$RC" -eq 1 ] && [ "$(cat "$LAST_DIR/test:public" 2>/dev/null)" = "1" ]; }
  assert_crash_not_retried() { runm "$1" 'if [ "$target" = "test:admin" ]; then echo "Error: Cannot find module x"; exit 2; fi; echo ok; exit 0'
    [ "$RC" -eq 1 ] && [ "$(cat "$LAST_DIR/test:admin" 2>/dev/null)" = "1" ]; }
  assert_recurring_flake_fails() { runm "$1" 'if [ "$target" = "test:public" ]; then
      echo "Tests 337 passed (337)"; echo "'"$TEARDOWN"'"; exit 1; fi; echo ok; exit 0'
    [ "$RC" -eq 1 ]; }
  assert_flake_loud() { runm "$1" 'if [ "$target" = "test:public" ] && [ "$n" -eq 1 ]; then
      echo "Tests 337 passed (337)"; echo "'"$TEARDOWN"'"; exit 1; fi; echo ok; exit 0'
    [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q 'FLAKE SURVIVED'; }
  assert_coverage_target() { MPROJ=public MCOV=--coverage runm "$1" 'echo "$target: 10 passed"; exit 0'
    [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q 'test:coverage:public'; }

  mutate "failure propagation removed (a failed project exits 0)" \
    '  overall=1' '  overall=0' assert_real_failure_fails
  mutate "loop exits on first failure (later projects hidden — the npm-test chain bug)" \
    '  printf '"'"'  ✗ %s FAILED (exit %d)\n'"'"' "$target" "$rc"' \
    '  printf '"'"'  ✗ %s FAILED (exit %d)\n'"'"' "$target" "$rc"; break' assert_all_run
  mutate "zero-failed guard removed (a run WITH failures gets retried)" \
    '     && ! printf '"'"'%s'"'"' "$out" | grep -qE '"'"'[1-9][0-9]* failed'"'"'; then' \
    '     && true; then' assert_failed_not_retried
  mutate "teardown signature widened to everything (any crash gets retried)" \
    '  if printf '"'"'%s'"'"' "$out" | grep -qE "$TEARDOWN_RE" \' \
    '  if true \' assert_crash_not_retried
  mutate "retry-success requirement removed (a recurring flake passes)" \
    '    if [ "$rc" -eq 0 ]; then
      printf '"'"'  ⚠ FLAKE SURVIVED' \
    '    if true; then
      printf '"'"'  ⚠ FLAKE SURVIVED' assert_recurring_flake_fails
  mutate "loud flake report removed (the retry absorbs silently)" \
    "printf '  ⚠ FLAKE SURVIVED: %s passed on the retry. Not a code failure — record it, do not ignore it.\\n' \"\$target\"" \
    ': "$target"' assert_flake_loud
  mutate "--coverage routing removed (CI targets the bare script)" \
    '[ "${1-}" = "--coverage" ] && SUFFIX="coverage:"' 'true' assert_coverage_target

  echo "run_frontend_suites mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fail=$((fail+1))
fi

printf '\nrun_frontend_suites self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
