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
# has to be asserted rather than trusted.
#
# The invariant is that every `SF:` path CARRIES ITS OWN PROJECT'S PREFIX, which
# is what makes it resolvable from the repo root the way SonarCloud resolves it
# against `sonar.sources`. A path still relative to its project (`SF:src/...`)
# is the defect itself: two projects then emit the same string, the scanner
# awards the file to one of them and reads 0% for the other.
#
# Named for what it CHECKS, not for the stronger property it implies (#458
# review round 3): this is prefix conformance, and a doubly-prefixed path would
# pass it. That shape is unreachable — the rewrite's `sed` is anchored at
# `^SF:src/`, so it prefixes each path at most once — but the check must not
# claim a guarantee it does not make.
#
# It is deliberately NOT a cross-project uniqueness check (what round 1 of #458
# shipped). Uniqueness cannot fail once each path carries its own project's
# prefix — measured: 100/100 `SF:` lines start with `src/`, so prefixing makes a
# collision impossible by construction — and it is blind in the per-project CI
# jobs, which is where the reports SonarCloud actually consumes are produced.
# Prefix conformance bites in both, and it is what catches a rewrite that was
# skipped on one of the two success paths.
#
# A project whose suite FAILED can trip this on a stale report from an earlier
# run. That is acceptable: the run is already failing, and the alternative —
# only checking projects we believe we rewrote — is blind to exactly the bug
# this exists to catch.
assert_lcov_paths_prefixed() {
  [ -n "$SUFFIX" ] || return 0
  _bad=0
  _seen=0
  for _p in $PROJECTS; do
    _lcov="$FRONTEND/coverage/$_p/lcov.info"
    [ -f "$_lcov" ] || continue
    _seen=1
    _stray="$(grep '^SF:' "$_lcov" | grep -v "^SF:frontend/projects/$_p/" | head -3)"
    if [ -n "$_stray" ]; then
      printf '  ✗ %s reports coverage paths that do not resolve from the repo root — SonarCloud will award the file to another project and read 0%% here:\n%s\n' \
        "$_p" "$_stray"
      _bad=1
    fi
  done
  [ "$_bad" -eq 0 ] || return 1
  # No report at all is NOT a pass. `--coverage` was asked for, so an empty
  # coverage/ directory hands SonarCloud the same 0% this guard exists to
  # prevent — and the only signal would have been an ABSENT ✓ line (#458 review
  # round 3, measured: the run exited 0 in silence).
  if [ "$_seen" -eq 0 ]; then
    printf '  ✗ --coverage produced no lcov report for any of: %s — SonarCloud would read 0%%\n' "$PROJECTS"
    return 1
  fi
  printf '  ✓ lcov paths carry their project prefix\n'
  return 0
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
      # The retry produced the coverage report this run will ship, so it needs
      # the same rewrite the first-attempt path does. Omitted here in review
      # round 1 of #458: `public` is BOTH the project that collides and the one
      # the teardown race is measured on (1 in 25, see the header), so roughly
      # 4% of coverage runs silently re-shipped the unresolvable paths — under a
      # green checkmark, because the guard below could not see it either.
      rewrite_lcov_paths "$p"
      printf '  ⚠ FLAKE SURVIVED: %s passed on the retry. Not a code failure — record it, do not ignore it.\n' "$target"
      flakes=$((flakes+1))
      continue
    fi
    printf '  ✗ %s failed AGAIN on the retry — this is not the tolerated flake.\n' "$target"
  fi
  printf '  ✗ %s FAILED (exit %d)\n' "$target" "$rc"
  overall=1
done

assert_lcov_paths_prefixed || overall=1

[ "$flakes" -gt 0 ] && printf '\n⚠ %d project(s) needed the teardown retry this run.\n' "$flakes"
[ "$overall" -eq 0 ] && printf '\n✓ all frontend projects passed: %s\n' "$PROJECTS"
exit "$overall"
