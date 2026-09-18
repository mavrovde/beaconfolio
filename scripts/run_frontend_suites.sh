#!/usr/bin/env bash
# run_frontend_suites.sh — run the three Vitest projects INDEPENDENTLY, and
# survive one specific upstream flake without ever weakening the gate.
#
# WHY THIS EXISTS (v1.13.0 retrospective, two occurrences):
#   Vitest can end a fully passing run with an unhandled WORKER-TEARDOWN
#   error — `[vitest-worker]: Closing rpc while "onUserConsoleLog" is pending`
#   (upstream vitest-dev/vitest#8649 / #9872: "Closing rpc while 'fetch' was
#   pending", EnvironmentTeardownError). Measured here: `337/337 tests passed`
#   and a non-zero exit. It hard-failed the whole pre-push gate — once while
#   pushing the v1.13.0 release tag.
#   STILL PRESENT ON VITEST 5.0.0 (#309, measured): 1 occurrence in 25
#   consecutive `npm run test:public` runs, byte-identical signature. The
#   runner bump did NOT fix the race — this harness stays.
#   Worse, `npm test` is `test:shared && test:public && test:admin`, so the
#   teardown flake in `public` meant `admin` NEVER RAN. One upstream race hid
#   two entire suites.
#
# WHAT THIS CHANGES, and what it deliberately does NOT:
#   * every project runs, even if an earlier one failed — you see all three
#     results, and the exit code is still non-zero if ANY project failed;
#   * a project is retried AT MOST ONCE, and only when its output carries the
#     teardown signature AND reports zero failed tests. The retry must pass
#     completely; a second occurrence, a real test failure, or any other error
#     still fails. This is not "retry until green": a genuine failure never
#     matches the signature, and a genuinely flaky TEST does not either.
#   * a survived flake is reported LOUDLY (`⚠ FLAKE`), never silently absorbed.
#   The runner was bumped to Vitest 5 in #309 and the race survived it; do not
#   loosen the gate instead.
#
# Usage: bash scripts/run_frontend_suites.sh [--coverage]
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
FRONTEND="${FRONTEND_DIR:-$ROOT/frontend}"
NPM="${NPM_BIN:-npm}"
PROJECTS="${FRONTEND_PROJECTS:-shared public admin}"
SUFFIX=""
[ "${1-}" = "--coverage" ] && SUFFIX="coverage:"

# The ONE tolerated signature. Keep it narrow and keep the issue numbers with it.
TEARDOWN_RE='Closing rpc while|EnvironmentTeardownError'

overall=0
# Vitest emits `SF:` paths relative to each PROJECT (`root: __dirname` in every
# vitest.config.ts), so `public` and `admin` both report `src/app/app.component.ts`
# — and SonarCloud, resolving each path once against `sonar.sources`, awards the
# file to one project and reads 0% for the other. Both apps are at 100% locally
# and in CI the whole time; the published number is simply attributed to the
# wrong file. `shared` never collided (its sources live under `src/lib/`), which
# is why two of three projects looked fine and this stayed invisible.
#
# Setting `coverage.root` does NOT fix it — measured: the emitted paths are
# unchanged. So the paths are rewritten here, in the one wrapper both CI and the
# pre-push gate already run, rather than in three configs that a direct
# `npx vitest run --coverage` would bypass anyway.
rewrite_lcov_paths() {
  [ -n "$SUFFIX" ] || return 0          # no --coverage, no report to rewrite
  _lcov="$FRONTEND/coverage/$1/lcov.info"
  [ -f "$_lcov" ] || return 0
  sed "s|^SF:src/|SF:frontend/projects/$1/src/|" "$_lcov" > "$_lcov.tmp" \
    && mv "$_lcov.tmp" "$_lcov"
}

# The failure mode this guards is a silently WRONG number, not an error, so it
# has to be asserted rather than trusted. Only meaningful when one run produced
# all three reports — CI runs one project per job.
assert_unique_lcov_paths() {
  [ -n "$SUFFIX" ] || return 0
  for _p in shared public admin; do
    [ -f "$FRONTEND/coverage/$_p/lcov.info" ] || return 0
  done
  _dupes="$(grep -h '^SF:' "$FRONTEND"/coverage/*/lcov.info | sort | uniq -d)"
  if [ -n "$_dupes" ]; then
    printf '  ✗ two projects report the same coverage path — SonarCloud will award it to one and read 0%% for the other:\n%s\n' "$_dupes"
    return 1
  fi
  printf '  ✓ lcov paths are unique across projects\n'
}

flakes=0
for p in $PROJECTS; do
  target="test:${SUFFIX}${p}"
  out="$( (cd "$FRONTEND" && "$NPM" run "$target" 2>&1) )"; rc=$?
  printf '%s\n' "$out"
  if [ "$rc" -eq 0 ]; then
    rewrite_lcov_paths "$p"
    printf '  ✓ %s\n' "$target"
    continue
  fi
  # Retry ONLY the upstream teardown race, and only with no failed tests.
  if printf '%s' "$out" | grep -qE "$TEARDOWN_RE" \
     && ! printf '%s' "$out" | grep -qE '[1-9][0-9]* failed'; then
    printf '  ⚠ FLAKE: %s exited %d with the Vitest worker-teardown race and ZERO failed tests — retrying ONCE (env-gotchas, #309)\n' \
      "$target" "$rc"
    out="$( (cd "$FRONTEND" && "$NPM" run "$target" 2>&1) )"; rc=$?
    printf '%s\n' "$out"
    if [ "$rc" -eq 0 ]; then
      printf '  ⚠ FLAKE SURVIVED: %s passed on the retry. Not a code failure — record it, do not ignore it.\n' "$target"
      flakes=$((flakes+1))
      continue
    fi
    printf '  ✗ %s failed AGAIN on the retry — this is not the tolerated flake.\n' "$target"
  fi
  printf '  ✗ %s FAILED (exit %d)\n' "$target" "$rc"
  overall=1
done

assert_unique_lcov_paths || overall=1

[ "$flakes" -gt 0 ] && printf '\n⚠ %d project(s) needed the teardown retry this run.\n' "$flakes"
[ "$overall" -eq 0 ] && printf '\n✓ all frontend projects passed: %s\n' "$PROJECTS"
exit "$overall"
