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

printf '\nrun_frontend_suites self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
