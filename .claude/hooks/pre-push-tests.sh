#!/usr/bin/env bash
# Pre-push gate for Beaconfolio.
#
# Runs a full local check round — docs + backend pytest + backend lint/type
# (ruff + mypy) + frontend unit tests — and BLOCKS a `git push` if anything
# fails. It self-gates by inspecting the
# PreToolUse tool-call JSON on stdin, so it returns "allow" instantly for every
# Bash command that is not a git push (never interferes with normal work).
#
# COMMAND-POSITION AWARE (#237): "is this a push?" is decided by parsing, not
# by substring. The old matcher (*"git push"*) treated quoted PROSE as a
# command — a `gh pr review --body-file` whose review text merely QUOTED
# `git push origin main` tripped the full test gate (the #204 class, alive in
# this second hook) — and missed real pushes whose top-level text didn't read
# literally "git push". The gate now fires only when some SEGMENT'S COMMAND is
# `git` with a `push` subcommand, using the ONE parsing model shared with
# guard-destructive.sh (hook-parse-lib.sh): quote-aware segmentation, the
# transparent-wrapper peel, and the text-tool heredoc exemption. Quoted text
# is data.
set -uo pipefail

# ---------------------------------------------------------------------------
# Configurable knobs — override via your shell env or, per-developer, in
# .claude/settings.local.json under "env": { ... } (gitignored, personal).
#   TEST_DATABASE_URL      Postgres URL for the backend pytest run
#   PREPUSH_LOG            where the combined log is written
#   PREPUSH_CHECK_DOCS     1/0 — run the docs check (CHANGELOG [Unreleased] + README)
#   PREPUSH_RUN_GUARDTEST  1/0 — run the destruction-guard hook self-test (#116)
#   PREPUSH_RUN_BACKEND    1/0 — run backend pytest (needs the DB above)
#   PREPUSH_RUN_LINT       1/0 — run backend lint/type leg (ruff + mypy), mirroring CI
#   PREPUSH_RUN_RUFF       1/0 — within the lint leg, run `ruff check .` + `ruff format --check .`
#   PREPUSH_RUN_MYPY       1/0 — within the lint leg, run `mypy app --ignore-missing-imports`
#   PREPUSH_RUN_FRONTEND   1/0 — run frontend shared/public/admin unit tests
#   PREPUSH_DRY_RUN        1/0 — print GATE or ALLOW (the self-gate decision)
#                          and exit WITHOUT running any checks or emitting hook
#                          JSON. For the self-test (#237) only.
#   PREPUSH_INSPECT_DEADLINE  seconds of analysis budget (default 8); past it
#                          the decision is GATE — on this hook, "could not
#                          analyse" must run the checks, never skip them.
#   PREPUSH_MAX_CMD_LEN    input-size bound (default 24000, matching the
#                          guard's measured budget); above it: GATE.
# ---------------------------------------------------------------------------
: "${TEST_DATABASE_URL:=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/test_beaconfolio}"
: "${PREPUSH_LOG:=/tmp/beaconfolio-prepush-tests.log}"
: "${PREPUSH_CHECK_DOCS:=1}"
: "${PREPUSH_RUN_GUARDTEST:=1}"
: "${PREPUSH_RUN_BACKEND:=1}"
: "${PREPUSH_RUN_LINT:=1}"
: "${PREPUSH_RUN_RUFF:=1}"
: "${PREPUSH_RUN_MYPY:=1}"
: "${PREPUSH_RUN_FRONTEND:=1}"
: "${PREPUSH_DRY_RUN:=0}"
export TEST_DATABASE_URL

allow() {
  if [ "$PREPUSH_DRY_RUN" = "1" ]; then printf 'ALLOW\n'; exit 0; fi
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
}
deny() {
  # $1 = reason (plain text, no double quotes)
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$1\"}}"
  exit 0
}

INPUT="$(cat)"
# Extract the command being run.
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
if [ -z "$CMD" ]; then
  # No jq / unparseable payload: the real command text is invisible, so
  # push-absence cannot be proven. Keep the old conservative substring
  # behaviour for this degraded path only: a push-looking payload GATES.
  case "$INPUT" in
    *"git push"*) CMD="git push" ;;
    *) allow ;;
  esac
fi

# FAST PATH — cheap substring probe BEFORE any parsing. This hook self-gates
# on EVERY Bash call, so a command without push-like text anywhere must return
# instantly: no lib sourcing, no forks, no segmentation. Only candidates (any
# occurrence of "push", which covers `git push`, `git -C dir push`, wrapped
# and compound spellings) pay for the parse below.
case "$CMD" in
  *push*) : ;;
  *) allow ;;
esac

# --- Command-position analysis (#237) — shared model with the guard ---------
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-parse-lib.sh"

# Same parsing environment as the guard: byte-wise ASCII scanning (#219 — the
# dispatch characters are all ASCII, and UTF-8 continuation bytes cannot alias
# them) and no pathname expansion of segments (a glob in a segment must not be
# rewritten by whatever files sit in the cwd).
export LC_ALL=C
set -f

# Analysis budget. POLARITY: this is a TEST GATE, not a destruction guard — a
# command it cannot finish analysing may be a real push, and the conservative
# outcome is a redundant check round (GATE), never a skipped one. A non-numeric
# override falls back to the default rather than disabling the bound.
INSPECT_DEADLINE="${PREPUSH_INSPECT_DEADLINE:-8}"
case "$INSPECT_DEADLINE" in ''|*[!0-9]*) INSPECT_DEADLINE=8 ;; esac
PREPUSH_MAX_CMD_LEN="${PREPUSH_MAX_CMD_LEN:-24000}"
case "$PREPUSH_MAX_CMD_LEN" in ''|*[!0-9]*) PREPUSH_MAX_CMD_LEN=24000 ;; esac

# Nesting depth of shell-wrapper unwrapping (mirrors the guard's bound).
PREPUSH_INNER_DEPTH=0

# A quoted argument handed to bash -c / eval / ssh is a SCRIPT: restore its
# quoted newlines, split it like the shell would, and ask each inner command.
# Returns 0 when some command in it is a git push. Past the depth bound the
# body cannot be analysed — GATE (see polarity note above).
inner_script_has_push() {
  local body="$1" line inner found=1 OLD="$IFS"
  [ "$PREPUSH_INNER_DEPTH" -ge 8 ] && return 0
  PREPUSH_INNER_DEPTH=$((PREPUSH_INNER_DEPTH + 1))
  body="${body//$NL_SENTINEL/$'\n'}"
  while IFS= read -r line; do
    [ "$found" = 0 ] && break
    IFS=$'\n'
    for inner in $(quote_split "$line"); do
      if segment_invokes_git_push "$inner"; then found=0; break; fi
    done
    IFS="$OLD"
  done <<< "$body"
  IFS="$OLD"
  PREPUSH_INNER_DEPTH=$((PREPUSH_INNER_DEPTH - 1))
  return $found
}

# Does this SEGMENT (already separator-split, quote-aware) invoke `git push`?
# Peels compound-command keywords (`do git push ...` in a for-loop body — the
# false-NEGATIVE direction of #237), leading env-assignments, transparent
# wrappers (the SHARED peel_wrapper model, #217), xargs, and bash -c / eval /
# ssh indirection; then requires the command word to be `git` and its first
# non-option token — git's value-taking globals (-C/-c/--git-dir/--work-tree/
# --namespace/--config-env) consumed — to be `push`. Everything else,
# including `git push` sitting inside a quoted argument, is DATA.
segment_invokes_git_push() {
  local seg="$1" first rest tok
  [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] && return 0   # cannot analyse → gate
  seg="$(printf '%s' "$seg" | tr '\n\t' '  ' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g')"

  local changed=1 loops=0
  while [ "$changed" = "1" ] && [ "$loops" -lt 8 ]; do
    changed=0; loops=$((loops + 1))
    [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] && return 0
    # Alias-suppressed spelling: `\git push` pushes all the same (#213).
    if [ "${seg:0:1}" = '\' ]; then seg="${seg#\\}"; changed=1; fi
    # Compound-command keywords: quote_split cuts `for b in x; do git push;
    # done` at the `;`, leaving a segment whose first word is `do` — the
    # observed unGATED real push. Same for then/else/if/while/… bodies.
    first="${seg%% *}"
    case "$first" in
      do|then|else|elif|if|while|until|'{'|'!')
        [ "$first" = "$seg" ] && return 1
        seg="${seg#* }"; changed=1; continue ;;
    esac
    # Leading env-assignments (`GIT_TRACE=1 git push`).
    if printf '%s' "$seg" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*='; then
      seg="$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*//')"
      changed=1
    fi
    # Transparent wrappers — sudo/env/nohup/time/… (shared model, #217).
    # peel_wrapper returns via the PEEL_RESULT global, not stdout (#235).
    if peel_wrapper "$seg"; then
      seg="$PEEL_RESULT"; changed=1
    fi
    # xargs [opts] git push — same one-pass strip as the guard's (#219).
    if printf '%s' "$seg" | grep -Eq '^xargs( |$)'; then
      seg="$(printf '%s' "$seg" | sed -E 's/^xargs +//; s/^((-[^ ]+|\{\}|[A-Za-z]=) )*//; s/^(-[^ ]+|\{\}|[A-Za-z]=)$//')"
      changed=1
    fi
    # bash -c "…" / sh -lc '…' / eval … / ssh host "…": the argument is a
    # script — a push inside it is a real push (same patterns as the guard).
    if printf '%s' "$seg" | grep -Eq '^(bash|sh|zsh|dash) +((-o [^ ]+|--rcfile [^ ]+|--init-file [^ ]+|-[A-Za-z]+|--[A-Za-z-]+) +)*-[A-Za-z]*c[A-Za-z]* (-- +)?'; then
      seg="$(printf '%s' "$seg" | sed -E "s/^(bash|sh|zsh|dash) +((-o [^ ]+|--rcfile [^ ]+|--init-file [^ ]+|-[A-Za-z]+|--[A-Za-z-]+) +)*-[A-Za-z]*c[A-Za-z]* +(-- +)?//; s/^\\\$?[\"']//")"
      inner_script_has_push "$seg" && return 0
      return 1
    elif printf '%s' "$seg" | grep -Eq '^eval '; then
      seg="$(printf '%s' "$seg" | sed -E "s/^eval +//; s/^\\\$?[\"']//")"
      inner_script_has_push "$seg" && return 0
      return 1
    elif printf '%s' "$seg" | grep -Eq '^ssh '; then
      # A push on the remote end pushes all the same. Inspect the WHOLE
      # remainder first — protection independent of parsing ssh's option
      # grammar right (§21.6) — then best-effort strip options and host so a
      # single-line `ssh host "cd /srv && <push>"` is read as the script it
      # is (its quoted `&&` was protected by the outer quote_split).
      local sshrest="${seg#ssh }" sshflag
      inner_script_has_push "$sshrest" && return 0
      while [ "${sshrest:0:1}" = "-" ]; do
        sshflag="${sshrest%% *}"
        [ "$sshflag" = "$sshrest" ] && break
        sshrest="${sshrest#* }"
        case "$sshflag" in
          -[bcDEeFIiJLlmOopQRSWw]) sshrest="${sshrest#* }" ;;  # flag took a separate value
        esac
      done
      sshrest="$(printf '%s' "$sshrest" | sed -E "s/^[^ ]+ +//; s/^\\\$?[\"']//")"
      inner_script_has_push "$sshrest" && return 0
      return 1
    fi
  done

  # Remaining sentinels are quoted-newline DATA (prose bodies): flatten them,
  # exactly as the guard does for non-script segments.
  seg="${seg//$NL_SENTINEL/ }"
  seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g')"

  first="${seg%% *}"
  [ "$first" = "git" ] || return 1
  [ "$first" = "$seg" ] && return 1     # bare `git` — no subcommand at all
  rest="${seg#* }"
  # Skip git's global options to find the SUBCOMMAND; consume the separate
  # values of the value-taking globals so `git -C /some/dir push` gates and
  # `git -c core.editor=vi commit …` does not misread its value as one.
  while :; do
    tok="${rest%% *}"
    case "$tok" in
      -C|-c|--git-dir|--work-tree|--namespace|--config-env)
        [ "$tok" = "$rest" ] && return 1
        rest="${rest#* }"
        tok="${rest%% *}"
        [ "$tok" = "$rest" ] && return 1
        rest="${rest#* }" ;;
      -*)
        [ "$tok" = "$rest" ] && return 1
        rest="${rest#* }" ;;
      *) break ;;
    esac
  done
  tok="${rest%% *}"
  # A stray quote can survive an unwrapped `bash -c '…'` body; `git "push"`
  # is the same subcommand.
  tok="${tok#\"}"; tok="${tok#\'}"; tok="${tok%\"}"; tok="${tok%\'}"
  [ "$tok" = "push" ]
}

# The whole-command decision: strip text-tool heredoc bodies (prose documents
# quoting a push are not pushes), split quote-awarely, ask every segment.
command_is_git_push() {
  local seg OLD="$IFS"
  # Above the size bound the analysis cannot be trusted to finish inside the
  # hook timeout — GATE (a redundant check round, never a skipped one).
  [ "${#CMD}" -gt "$PREPUSH_MAX_CMD_LEN" ] && return 0
  IFS=$'\n'
  for seg in $(quote_split "$(strip_text_heredocs "$CMD")"); do
    if segment_invokes_git_push "$seg"; then IFS="$OLD"; return 0; fi
  done
  IFS="$OLD"
  return 1
}

command_is_git_push || allow

# --- From here on, this IS a real push: run the full gate. ------------------
if [ "$PREPUSH_DRY_RUN" = "1" ]; then printf 'GATE\n'; exit 0; fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
LOG="$PREPUSH_LOG"

run_checks() {
  if [ "$PREPUSH_CHECK_DOCS" = "1" ]; then
    echo "== docs check =="
    grep -q "Unreleased" "$ROOT/CHANGELOG.md" || { echo "CHANGELOG.md is missing an [Unreleased] section"; return 1; }
    test -s "$ROOT/README.md" || { echo "README.md is missing or empty"; return 1; }
    echo "== version-consistency check (#172) =="
    ( cd "$ROOT" && ./bump_version.sh --check ) || return 1
    # ...and the checker's own self-test, so an edit to the version tooling fails
    # here rather than first at deploy time (#186).
    ( cd "$ROOT" && bash test-bump-version.sh >/dev/null ) || {
      echo "  ✗ test-bump-version.sh failed — run 'bash test-bump-version.sh' to see which case"
      return 1
    }
    # setup.sh's .env helpers hold the user's secrets file to an idempotency
    # contract — pinned by its own self-test (#61/#256), same pattern.
    # PII guard (#66): the demo-persona swap must never silently regress — plus
    # the #313 de-branding contract (the maintainer's domain must not creep back
    # onto surfaces that instruct a forker). Its self-test runs too: check B is a
    # new gate, and a gate nobody proved can fail is no gate (lessons §18).
    if [ -f "$ROOT/scripts/check_no_pii.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_no_pii.sh >/dev/null ) || {
        echo "  ✗ check_no_pii.sh failed — run 'bash scripts/check_no_pii.sh' to see the hits"
        return 1
      }
      if [ -f "$ROOT/scripts/check_no_pii.test.sh" ]; then
        ( cd "$ROOT" && bash scripts/check_no_pii.test.sh >/dev/null ) || {
          echo "  ✗ check_no_pii.test.sh failed — the PII/de-brand checker itself is broken"
          return 1
        }
      fi
    fi
    # Documented-knob contract (#296/#297/#298 all shipped this bug in round 1):
    # a Settings key the docs promise must reach the backend container in BOTH
    # compose files. Self-test runs too — a checker nobody proved can fail is
    # indistinguishable from no checker (lessons §18).
    if [ -f "$ROOT/scripts/check_compose_env.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_compose_env.sh >/dev/null ) || {
        echo "  ✗ check_compose_env.sh failed — run 'bash scripts/check_compose_env.sh' to see which knob never reaches the container"
        return 1
      }
      ( cd "$ROOT" && bash scripts/check_compose_env.test.sh >/dev/null ) || {
        echo "  ✗ check_compose_env.test.sh failed — the compose-env checker itself is broken"
        return 1
      }
    fi
    # Freshness-contract self-test (#280): the live-vs-released verdict script is
    # shared by the Live Freshness workflow AND deploy.yml's post-rollout gate —
    # if IT breaks, prod verification silently lies. Stubbed curl/jq, no network.
    if [ -f "$ROOT/scripts/check_live_freshness.test.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_live_freshness.test.sh >/dev/null ) || {
        echo "  ✗ check_live_freshness.test.sh failed — the freshness checker itself is broken"
        return 1
      }
    fi
    # Alembic single-head contract (v1.14.0 retrospective, #323/#325). Measured
    # AGAINST origin/main, not just the working tree: both of those branches were
    # single-head alone and every gate they ran was green — the fork existed only
    # in the merge, and `alembic upgrade head` then refuses to run on a backend
    # that executes it at every container start.
    if [ -f "$ROOT/scripts/check_migration_heads.sh" ]; then
      if git -C "$ROOT" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
        ( cd "$ROOT" && bash scripts/check_migration_heads.sh --against origin/main >/dev/null ) || {
          echo "  ✗ check_migration_heads.sh failed — run 'bash scripts/check_migration_heads.sh --against origin/main' to see the fork"
          return 1
        }
      else
        ( cd "$ROOT" && bash scripts/check_migration_heads.sh >/dev/null ) || {
          echo "  ✗ check_migration_heads.sh failed — run 'bash scripts/check_migration_heads.sh' to see the fork"
          return 1
        }
      fi
      ( cd "$ROOT" && bash scripts/check_migration_heads.test.sh >/dev/null ) || {
        echo "  ✗ check_migration_heads.test.sh failed — the migration-heads checker itself is broken"
        return 1
      }
    fi
    if [ -f "$ROOT/setup.test.sh" ]; then
      ( cd "$ROOT" && bash setup.test.sh >/dev/null ) || {
        echo "  ✗ setup.test.sh failed — run 'bash setup.test.sh' to see which case"
        return 1
      }
    fi
  fi

  if [ "$PREPUSH_RUN_GUARDTEST" = "1" ] && [ -f "$ROOT/.claude/hooks/guard-destructive.test.sh" ]; then
    echo "== destruction-guard self-test =="
    bash "$ROOT/.claude/hooks/guard-destructive.test.sh" || return 1
    if [ -f "$ROOT/.claude/hooks/pre-push-tests.test.sh" ]; then
      echo "== pre-push self-gate self-test (#237) =="
      bash "$ROOT/.claude/hooks/pre-push-tests.test.sh" || return 1
    fi
    if [ -f "$ROOT/.claude/hooks/guard-stack-resources.test.sh" ]; then
      # --mutations for the same reason as the merge gate below: this guard's
      # value is entirely in the denies, and a guard nobody proved can deny is
      # documentation (lessons §18).
      echo "== stack-resource guard self-test + mutation contract =="
      bash "$ROOT/.claude/hooks/guard-stack-resources.test.sh" --mutations || return 1
    fi
    if [ -f "$ROOT/.claude/hooks/pre-merge-gate.test.sh" ]; then
      # --mutations is the point: the FIRST version of that self-test passed
      # 14/14 against a gate whose blocking had been removed. Running the cases
      # without the mutation contract would repeat exactly that.
      echo "== merge-gate self-test + mutation contract =="
      bash "$ROOT/.claude/hooks/pre-merge-gate.test.sh" --mutations || return 1
    fi
  fi

  if [ "$PREPUSH_RUN_BACKEND" = "1" ]; then
    echo "== backend pytest =="
    # ISOLATION, not arbitration (2026-09-06). This gate used to run SERIALLY against
    # the shared `test_beaconfolio` and refuse to start whenever any other pytest was
    # alive. That guard only sampled at start, so an agent beginning a suite one
    # second later still clobbered the run: drop_all/create_all from two suites on
    # one database produces dozens of spurious ERRORs that read like real failures,
    # and it cost several blind retries before anyone read the log.
    #
    # Remove the common collision instead of merely detecting it:
    #   * this gate gets a database of its own (`test_beaconfolio_prepush`), so parallel
    #     agents on `test_beaconfolio` cannot touch it — conftest creates it on demand;
    #     note it drops TABLES per test and, under xdist, DROPS the per-worker
    #     `_gwN` databases at teardown. Two concurrent pre-push runs would still
    #     share this name, which is acceptable because only one push runs at a
    #     time; parallel AGENTS were the real collision and they are now separated;
    #   * `-n auto` is how CI actually runs the suite (lessons: run the suite as CI
    #     runs it) and additionally gives every xdist worker its own `_gwN` database.
    #
    # --cov-fail-under=100 matches deploy.yml's Backend Tests job exactly — without it
    # this gate prints a coverage number and passes regardless, letting a red-CI push
    # through green locally (#69 review round 2: "verify that gates actually gate").
    PREPUSH_DB="${PREPUSH_TEST_DATABASE_URL:-postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/test_beaconfolio_prepush}"
    ( cd "$ROOT/backend" && BEACONFOLIO_GEMINI_API_KEY="" TEST_DATABASE_URL="$PREPUSH_DB" \
        ./venv/bin/pytest -q -n auto --cov-fail-under=100 ) || return 1
  fi

  if [ "$PREPUSH_RUN_LINT" = "1" ]; then
    echo "== backend lint/type (ruff + mypy) =="
    if [ "$PREPUSH_RUN_RUFF" = "1" ]; then
      echo "-- ruff check --"
      ( cd "$ROOT/backend" && ./venv/bin/ruff check . ) || return 1
      echo "-- ruff format --check --"
      ( cd "$ROOT/backend" && ./venv/bin/ruff format --check . ) || return 1
    fi
    if [ "$PREPUSH_RUN_MYPY" = "1" ]; then
      echo "-- mypy --"
      ( cd "$ROOT/backend" && ./venv/bin/mypy app --ignore-missing-imports --no-error-summary ) || return 1
    fi
  fi

  if [ "$PREPUSH_RUN_FRONTEND" = "1" ]; then
    echo "== frontend cd-safety (zoneless repaint hazards, #118) =="
    ( cd "$ROOT/frontend" && node scripts/check-cd-safety.mjs ) || return 1
    echo "== frontend tests (shared + public + admin) =="
    # NOT `npm test`: that chains the three projects with `&&`, so ONE project's
    # failure hides the other two — and twice in v1.13.0 a Vitest worker-
    # teardown race (`Closing rpc while "onUserConsoleLog" is pending`, upstream
    # vitest-dev/vitest#8649/#9872) hard-failed this gate with 337/337 tests
    # PASSING, aborting before `admin` ran at all — once while pushing a release
    # tag. The runner below runs every project, and retries a project exactly
    # ONCE when the output carries that signature AND reports zero failed tests.
    # A real failure is never retried and always denies (see its self-test).
    ( cd "$ROOT" && bash scripts/run_frontend_suites.sh ) || return 1
    ( cd "$ROOT" && bash scripts/run_frontend_suites.test.sh >/dev/null ) || {
      echo "  ✗ run_frontend_suites.test.sh failed — the frontend runner's own retry contract is broken"
      return 1
    }
  fi
}

if run_checks >"$LOG" 2>&1; then
  allow
else
  deny "Pre-push checks FAILED (docs / backend pytest / backend lint+type ruff+mypy / frontend tests). See $LOG. Configure via env: PREPUSH_RUN_BACKEND, PREPUSH_RUN_LINT, PREPUSH_RUN_RUFF, PREPUSH_RUN_MYPY, PREPUSH_RUN_FRONTEND, PREPUSH_CHECK_DOCS, TEST_DATABASE_URL."
fi
