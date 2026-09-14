#!/usr/bin/env bash
# Pre-push gate for Beaconfolio.
#
# Runs a local check round — docs + backend pytest + backend lint/type
# (ruff + mypy + bandit) + frontend unit tests + the repo-contract lints and
# hook self-tests — and BLOCKS a `git push` if anything fails. It self-gates by
# inspecting the PreToolUse tool-call JSON on stdin, so it returns "allow"
# instantly for every Bash command that is not a git push (never interferes
# with normal work).
#
# SCOPED TO THE DIFF (#377). The round used to run EVERY leg on EVERY push, so
# a two-file docs commit paid 11m44s (measured) for suites its diff could not
# touch; it now costs 13s.
# The legs are now selected from `git diff --name-only @{push}..HEAD` via
# .claude/hooks/prepush-select-lib.sh. Read that file's header before touching
# the mapping — the polarity (unmapped path / unobtainable diff / unknown
# branch ⇒ run EVERYTHING) is the whole safety argument. main, release/* and
# PREPUSH_FULL=1 always run the full round; the PII/de-brand guard always runs.
# CI (deploy.yml) is untouched and still runs every leg on every push.
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
#   PREPUSH_RUN_BANDIT     1/0 — within the lint leg, run `bandit -r app -ll --skip B101`
#   PREPUSH_FULL           1/0 — force the FULL round regardless of the diff
#                          (#377). The escape hatch when you distrust the
#                          mapping; main/release branches force it anyway.
#   PREPUSH_PRINT_LEGS     1/0 — print the selected legs and exit WITHOUT
#                          running anything and WITHOUT emitting a permission
#                          decision. For the self-test (#377) only; like
#                          PREPUSH_DRY_RUN it cannot be mistaken for an allow.
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
# HARD PUSH BUDGET (owner constraint 2026-09-14, standing): "push cannot be
# longer than 1 minute. Never ever." The DEEP legs — backend pytest, the lint
# leg (ruff/mypy/bandit) and the Vitest projects — therefore no longer run at
# push time by default: CI runs all of them on every push and PR, and the
# rule-13 merge gate + approval-covers-head is where depth belongs. The
# selection still NAMES the legs (the log shows what was deferred), and
# PREPUSH_DEEP=1 opts a push into running them locally.
: "${PREPUSH_DEEP:=0}"
: "${PREPUSH_RUN_BACKEND:=$PREPUSH_DEEP}"
: "${PREPUSH_RUN_LINT:=$PREPUSH_DEEP}"
: "${PREPUSH_RUN_RUFF:=1}"
: "${PREPUSH_RUN_MYPY:=1}"
: "${PREPUSH_RUN_FRONTEND:=$PREPUSH_DEEP}"
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

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
LOG="$PREPUSH_LOG"

# --- FOREIGN REPO PASS-THROUGH (#353) ---------------------------------------
# This hook is registered for the SESSION, not for a directory, so it fires on
# `git push` in ANY checkout — including a different repository entirely. The
# gate then runs THIS project's suites against a push that cannot possibly
# break them. Measured 2026-09-10: a docs-only push of the project WIKI
# (github.com/mavrovde/beaconfolio.wiki, a separate repository) was blocked
# twice by main-repo test results. That is how operators learn to reach for
# PREPUSH_FULL=0-style bypasses, which is the erosion the v1.13.0 retro warned
# about — a gate that fires when it cannot be relevant teaches people to
# disable it when it can.
#
# POLARITY, same as the leg selector (#377): skipping is the exceptional path,
# so it must be POSITIVELY established. Only a repository we can prove is a
# DIFFERENT one passes through. An unobtainable toplevel, an unobtainable
# remote, a matching remote, or any ambiguity runs the full gate.
#
# The question is "whose CODE is being pushed", which is the repository the
# command runs IN — not the destination URL. `git push <some-other-url>` still
# pushes this project's commits and must still be gated.
# IDENTITY is `owner/repo`, and HOST is deliberately discarded (#402 review,
# major 2). Normalising by string-editing the URL made five spellings of OUR
# OWN origin read as five different repositories — `ssh://git@ssh.github.com:
# 443/…` (GitHub's alternate SSH host), an explicit `:22`, a non-`git` user,
# `git+ssh://…`, and a bare local path — and each of those is a SKIP of this
# project's own gate. Two hosts serving the same `owner/repo` now collapse to
# one identity, which GATES: that is the safe direction, and the reverse error
# is not available.
#
# An origin that is not a recognisable REMOTE (a bare filesystem path, a
# `file://` URL, an unknown scheme) yields NO identity, and no identity gates.
prepush_repo_identity() { # prepush_repo_identity <dir> -> owner/repo, or empty
  local url path hostpart
  url="$(git -C "$1" remote get-url origin 2>/dev/null)" || return 0
  [ -n "$url" ] || return 0
  case "$url" in
    *://*)
      case "${url%%://*}" in
        ssh|git+ssh|git|http|https) ;;
        *) return 0 ;;                     # file://, or something we don't know
      esac
      path="${url#*://}"
      path="${path#*@}"                    # [user@]
      case "$path" in */*) path="${path#*/}" ;; *) return 0 ;; esac  # host[:port]
      ;;
    *:*)
      # scp-like `[user@]host:path`. The part before the colon must look like a
      # HOSTNAME; otherwise this is a filesystem path that happens to contain a
      # colon, and a filesystem path is not an identity.
      hostpart="${url%%:*}"
      case "$hostpart" in */*|'') return 0 ;; esac
      case "${hostpart#*@}" in *.*) ;; *) return 0 ;; esac
      path="${url#*:}"
      ;;
    *) return 0 ;;                         # bare filesystem path
  esac
  path="${path#/}"
  path="$(printf '%s' "$path" | sed -E 's#/+$##; s#\.git$##' | tr 'A-Z' 'a-z')"
  # `.wiki` survives the `.git` strip, so beaconfolio.wiki and beaconfolio stay
  # DIFFERENT identities — that is the whole point of #353.
  [ -n "$path" ] || return 0
  printf '%s' "$path"
}

# WHICH directory's repository does this push touch? Not necessarily $PWD:
# `cd <dir> && git push` and `git -C <dir> push` both push a repository the
# hook is not standing in. Resolving identity from $PWD alone was a FAIL-OPEN
# (#402 review, blocker 1) — run from the wiki, `git -C <project> push` read as
# "foreign" and skipped this project's own gate.
#
# Prints one absolute directory per push, or a single `?` when any part of the
# shape cannot be resolved. `?` gates.
prepush_push_dirs() { # prepush_push_dirs <command>
  local cmd="$1" seg masked cur d arg n i OLD
  cur="$PWD"
  masked="$(mask_quotes "$cmd")"
  # A grouping construct SCOPES a `cd`, and this walker models `cd` as global.
  # Rather than mis-model the scope, refuse the shape: in
  # `( cd /elsewhere && git push ) ; git push` the second push is in $PWD, and
  # leaking the subshell's `cd` past the `)` would call it foreign.
  case "$masked" in *'('*|*')'*|*'{'*|*'}'*) printf '?\n'; return 0 ;; esac
  OLD="$IFS"; IFS=$'\n'
  for seg in $(quote_split "$(strip_text_heredocs "$cmd")"); do
    IFS="$OLD"
    seg="${seg//$NL_SENTINEL/ }"
    seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/[[:space:]]+/ /g')"
    if [ -n "$seg" ]; then
      argv_split "$seg"
      [ "$ARGV_SPLIT_UNTERMINATED" = "1" ] && { printf '?\n'; return 0; }
      local -a A=("${ARGV_SPLIT_RESULT[@]}")
      n=${#A[@]}
      case "${A[0]:-}" in
        cd)
          # Only a single LITERAL operand is resolvable. `cd`, `cd -`, `cd ~`,
          # `cd "$D"` and globs all leave the directory unknown.
          [ "$n" -eq 2 ] || { printf '?\n'; return 0; }
          arg="${A[1]}"
          case "$arg" in -|'~'*|*'$'*|*'*'*|*'?'*|*'['*) printf '?\n'; return 0 ;; esac
          cur="$(cd "$cur" 2>/dev/null && cd "$arg" 2>/dev/null && pwd -P)" || cur=""
          [ -n "$cur" ] || { printf '?\n'; return 0; }
          ;;
        pushd|popd) printf '?\n'; return 0 ;;
      esac
      if segment_invokes_git_push "$seg"; then
        i=0
        while [ "$i" -lt "$n" ]; do            # leading env-assignments
          case "${A[$i]}" in *=*) i=$((i + 1)) ;; *) break ;; esac
        done
        # Only a DIRECT `git … push` has a knowable directory. A push reached
        # through bash -c / ssh / xargs may run anywhere — on another HOST,
        # even — so its repository is unknowable and the shape gates.
        case "${A[$i]:-}" in git|'\git') ;; *) printf '?\n'; return 0 ;; esac
        d="$cur"; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          case "${A[$i]}" in
            # --git-dir/--work-tree repoint the repository itself; not modelled.
            --git-dir*|--work-tree*) printf '?\n'; return 0 ;;
            -C|-C?*)
              if [ "${A[$i]}" = "-C" ]; then arg="${A[$((i + 1))]:-}"; i=$((i + 2))
              else arg="${A[$i]#-C}"; i=$((i + 1)); fi
              [ -n "$arg" ] || { printf '?\n'; return 0; }
              case "$arg" in *'$'*|*'*'*|'~'*) printf '?\n'; return 0 ;; esac
              # Successive -C are relative to each other, exactly as git does.
              d="$(cd "$d" 2>/dev/null && cd "$arg" 2>/dev/null && pwd -P)" || d=""
              [ -n "$d" ] || { printf '?\n'; return 0; }
              ;;
            -c|--namespace|--config-env) i=$((i + 2)) ;;
            -*) i=$((i + 1)) ;;
            *) break ;;
          esac
        done
        printf '%s\n' "$d"
      fi
    fi
    IFS=$'\n'
  done
  IFS="$OLD"
}

ROOT_TOP="$(cd "$ROOT" 2>/dev/null && pwd -P || printf '')"
OURS="$(prepush_repo_identity "$ROOT_TOP")"
PUSH_DIRS="$(prepush_push_dirs "$CMD")"
FOREIGN=1
[ -n "$ROOT_TOP" ] && [ -n "$OURS" ] && [ -n "$PUSH_DIRS" ] || FOREIGN=0
if [ "$FOREIGN" = "1" ]; then
  # EVERY push in the command must be provably foreign. One unresolvable or
  # one of ours anywhere in the command runs the whole gate.
  while IFS= read -r PD; do
    [ -n "$PD" ] || continue
    if [ "$PD" = "?" ]; then FOREIGN=0; break; fi
    PTOP="$(git -C "$PD" rev-parse --show-toplevel 2>/dev/null || printf '')"
    [ -n "$PTOP" ] || { FOREIGN=0; break; }
    THEIRS="$(prepush_repo_identity "$PTOP")"
    if [ -z "$THEIRS" ] || [ "$THEIRS" = "$OURS" ]; then FOREIGN=0; break; fi
  done <<EOF
$PUSH_DIRS
EOF
fi
if [ "$FOREIGN" = "1" ]; then
  printf 'pre-push gate: foreign repo (%s), gates not applicable — this project is %s\n' \
    "$THEIRS" "$OURS" >&2
  allow
fi

# --- From here on, this IS a real push: run the gate. -----------------------
if [ "$PREPUSH_DRY_RUN" = "1" ]; then printf 'GATE\n'; exit 0; fi

# --- LEG SELECTION (#377) ---------------------------------------------------
# Run the legs this diff can break, not all of them. The mapping, the
# fail-closed default and the mandatory-full rules all live in
# prepush-select-lib.sh; read its header before changing anything here.
#
# POLARITY, restated where it is easy to break: every path out of this block
# that is not a confident narrow selection must end in `ALL`. A push whose
# range cannot be computed, a branch that cannot be named, a path nobody
# mapped — all of them run everything.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prepush-select-lib.sh"

SELECT_REASON=""
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '')"
if FULL_REASON="$(prepush_force_full_reason "$BRANCH" "$CMD")"; then
  LEGS=" ALL "
  SELECT_REASON="FULL — $FULL_REASON"
else
  if CHANGED="$(prepush_changed_files "$ROOT")"; then
    LEGS="$(printf '%s\n' "$CHANGED" | prepush_select_legs)"
    if [ "$LEGS" = " ALL " ]; then
      SELECT_REASON="FULL — the diff touches an unmapped path (or is empty); fail closed"
    else
      SELECT_REASON="scoped to $(printf '%s\n' "$CHANGED" | grep -c '[^[:space:]]') changed file(s) on $BRANCH"
    fi
  else
    LEGS=" ALL "
    SELECT_REASON="FULL — the changed-file list could not be computed; fail closed"
  fi
fi

LEGS_PRETTY="$(printf '%s' "$LEGS" | sed -E 's/^ +//; s/ +$//')"

# Is this leg selected? `ALL` answers yes to everything.
leg() {
  case "$LEGS" in
    *" ALL "*)   return 0 ;;
    *" $1 "*)    return 0 ;;
  esac
  return 1
}

# Was this leg selected BY NAME — i.e. do we positively know this area changed?
# `ALL` means "could not tell", which is not the same as "this changed", and one
# check below needs the distinction (see the mutation-contract comment).
leg_exact() {
  case "$LEGS" in
    *" ALL "*) return 1 ;;
    *" $1 "*)  return 0 ;;
  esac
  return 1
}

# Self-test seam (same shape as PREPUSH_DRY_RUN above): print the decision and
# exit WITHOUT running any check and WITHOUT emitting a permission decision, so
# this can never be mistaken for an allow.
if [ "${PREPUSH_PRINT_LEGS:-0}" = "1" ]; then
  printf '%s\n' "$LEGS_PRETTY"
  exit 0
fi

# Same seam for the ONE decision that is not visible in the leg list: whether
# this round also runs the mutation contract. That must be driven by `leg_exact`
# and never by `leg` — under `leg`, a full round (` ALL `) would answer yes and
# spend ~543s of extra budget in exactly the round that already runs everything,
# pushing it past the PreToolUse timeout. A timed-out hook does not deny, so the
# cost of getting this wrong is a fail-OPEN gate.
# Without this seam the call site is untestable and the guard survives mutation
# (#388 review, major 2 — the reviewer swapped `leg_exact`→`leg` and all 108
# cases still passed).
#
# The predicate is defined ONCE and consumed by both the seam and the call site.
# An earlier draft of this fix re-implemented the condition here; the contract
# then reported a false kill, because mutating the call site left this copy
# still telling the truth. A seam that re-derives what it claims to observe is
# the same fake-green shape the hooks' self-tests exist to prevent.
# Decided ONCE, into the value the invocation actually uses. Two earlier drafts
# of this got it wrong in the same way at different levels: the first
# re-implemented the condition inside the seam, the second had the seam
# re-EVALUATE the predicate. Both left a mutation of the consumer passing,
# because the seam re-derived the answer instead of observing the decision.
# Now there is one array: the seam prints it and the call site expands it, so a
# mutation anywhere on this path is visible to the self-test.
# MUTATION CONTRACTS ARE CI-ONLY (v1.14.2, owner directive 2026-09-14: a push
# must cost 1-3 minutes, proportional to the diff). The gate used to run
# `--mutations` locally — first in every round that selected a hook leg
# (543s measured for the merge gate's alone), then, after #388, when the diff
# named the hook (still ~9 minutes for any edit to this gate). Both violate
# the budget. deploy.yml now runs all three hook contracts with `--mutations`
# unconditionally on every push, so the contracts stay proven at the layer
# with the time budget; the local rounds run the plain cases only, always.
# The argv-observed stub cases in pre-push-tests.test.sh pin that no call
# site below quietly reintroduces the flag.

run_checks() {
  echo "== leg selection (#377): $SELECT_REASON =="
  echo "== legs: $LEGS_PRETTY =="
  if [ "$PREPUSH_DEEP" != "1" ]; then
    echo "== deep legs (backend/lint/frontend) run in CI, not at push time — PREPUSH_DEEP=1 opts in locally (owner budget: push <= 1 minute) =="
  fi
  if [ "$PREPUSH_CHECK_DOCS" = "1" ]; then
    if leg docs; then
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
    fi
    # PII guard (#66): the demo-persona swap must never silently regress — plus
    # the #313 de-branding contract (the maintainer's domain must not creep back
    # onto surfaces that instruct a forker). Its self-test runs too: check B is a
    # new gate, and a gate nobody proved can fail is no gate (lessons §18).
    # NOT path-selectable (#377): `pii` is added to every non-empty selection,
    # so this runs whatever changed — it is cheap and its failure mode is public.
    if leg pii && [ -f "$ROOT/scripts/check_no_pii.sh" ]; then
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
    if leg compose && [ -f "$ROOT/scripts/check_compose_env.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_compose_env.sh >/dev/null ) || {
        echo "  ✗ check_compose_env.sh failed — run 'bash scripts/check_compose_env.sh' to see which knob never reaches the container"
        return 1
      }
      ( cd "$ROOT" && bash scripts/check_compose_env.test.sh >/dev/null ) || {
        echo "  ✗ check_compose_env.test.sh failed — the compose-env checker itself is broken"
        return 1
      }
    fi
    # The CHANGELOG dedup helper REWRITES release history, so its own self-test
    # is part of the gate (#371 review: it entered the repo with no test and a
    # whitelist that silently deleted unrecognised sections).
    if leg dedup && [ -f "$ROOT/scripts/dedup_changelog_unreleased.test.sh" ]; then
      ( cd "$ROOT" && bash scripts/dedup_changelog_unreleased.test.sh >/dev/null ) || {
        echo "  ✗ dedup_changelog_unreleased.test.sh failed — the CHANGELOG fixer itself is broken"
        return 1
      }
    fi
    # Freshness-contract self-test (#280): the live-vs-released verdict script is
    # shared by the Live Freshness workflow AND deploy.yml's post-rollout gate —
    # if IT breaks, prod verification silently lies. Stubbed curl/jq, no network.
    if leg freshness && [ -f "$ROOT/scripts/check_live_freshness.test.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_live_freshness.test.sh >/dev/null ) || {
        echo "  ✗ check_live_freshness.test.sh failed — the freshness checker itself is broken"
        return 1
      }
    fi
    # AI-config map drift (#246): the CLAUDE.md map is how the next contributor
    # — human or agent — learns what tooling exists. A tool added without a row,
    # or a row naming a deleted file, misleads silently. Cheap, dependency-free.
    if leg aiconfig && [ -f "$ROOT/scripts/check_aiconfig_map.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_aiconfig_map.sh >/dev/null ) || {
        echo "  ✗ check_aiconfig_map.sh failed — run it to see which tool/row drifted"
        echo "    (update the AI-config map in the SAME PR that changed the tooling)"
        return 1
      }
      ( cd "$ROOT" && bash scripts/check_aiconfig_map.test.sh >/dev/null ) || {
        echo "  ✗ check_aiconfig_map.test.sh failed — the drift checker itself is broken"
        return 1
      }
    fi
    # The no-verdict-merge detector's own self-test (#392) — the LIVE audit
    # runs only in the scheduled Verdict Audit workflow (network, and a
    # historical window this gate has no business re-measuring); the gate
    # proves the DETECTOR still detects.
    if leg vaudit && [ -f "$ROOT/scripts/audit_no_verdict_merges.test.sh" ]; then
      ( cd "$ROOT" && bash scripts/audit_no_verdict_merges.test.sh >/dev/null ) || {
        echo "  ✗ audit_no_verdict_merges.test.sh failed — the no-verdict detector itself is broken"
        return 1
      }
    fi
    # Merged-CHANGELOG contract (v1.14.1 retrospective change A, #391). The
    # [Unreleased] collision NEVER exists in the branch and NEVER in main —
    # only in the merged result, which is what this measures (git merge-tree,
    # the same machinery gh pr merge runs). 5 of 16 reviewed v1.14.1 PRs hit
    # it at blocker level; #365's variant DELETED a released heading.
    if leg changelog && [ -f "$ROOT/scripts/check_changelog_merge.sh" ]; then
      ( cd "$ROOT" && bash scripts/check_changelog_merge.sh >/dev/null ) || {
        echo "  ✗ check_changelog_merge.sh failed — run 'bash scripts/check_changelog_merge.sh' to see what the MERGE with origin/main breaks (then rebase + /prep-pr step 2)"
        return 1
      }
      ( cd "$ROOT" && bash scripts/check_changelog_merge.test.sh >/dev/null ) || {
        echo "  ✗ check_changelog_merge.test.sh failed — the merged-changelog checker itself is broken"
        return 1
      }
    fi
    # Alembic single-head contract (v1.14.0 retrospective, #323/#325). Measured
    # AGAINST origin/main, not just the working tree: both of those branches were
    # single-head alone and every gate they ran was green — the fork existed only
    # in the merge, and `alembic upgrade head` then refuses to run on a backend
    # that executes it at every container start.
    if leg migrations && [ -f "$ROOT/scripts/check_migration_heads.sh" ]; then
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
    if leg setup && [ -f "$ROOT/setup.test.sh" ]; then
      ( cd "$ROOT" && bash setup.test.sh >/dev/null ) || {
        echo "  ✗ setup.test.sh failed — run 'bash setup.test.sh' to see which case"
        return 1
      }
    fi
  fi

  # Hook self-tests. Selected PER HOOK (#377) — except that a change to
  # hook-parse-lib.sh selects all four, because they share that parsing model.
  if [ "$PREPUSH_RUN_GUARDTEST" = "1" ]; then
    if leg hook:guard-destructive && [ -f "$ROOT/.claude/hooks/guard-destructive.test.sh" ]; then
      echo "== destruction-guard self-test =="
      bash "$ROOT/.claude/hooks/guard-destructive.test.sh" || return 1
    fi
    if leg hook:pre-push-tests && [ -f "$ROOT/.claude/hooks/pre-push-tests.test.sh" ]; then
      # Plain cases only — the mutation contract that proves this selector can
      # go red (lessons §18/§46) runs in CI on every push, never here (see the
      # CI-only comment above; measured ~9 minutes against the owner's
      # 1-3-minute push budget, and against the 900s PreToolUse timeout a
      # timed-out hook does not DENY, so overspending here risks fail-OPEN).
      echo "== pre-push self-gate + leg-selection self-test (#237/#377) =="
      bash "$ROOT/.claude/hooks/pre-push-tests.test.sh" || return 1
    fi
    if leg hook:guard-stack-resources && [ -f "$ROOT/.claude/hooks/guard-stack-resources.test.sh" ]; then
      # Plain cases only; the mutation contract is CI's (see above).
      echo "== stack-resource guard self-test =="
      bash "$ROOT/.claude/hooks/guard-stack-resources.test.sh" || return 1
    fi
    if leg hook:pre-merge-gate && [ -f "$ROOT/.claude/hooks/pre-merge-gate.test.sh" ]; then
      # The FIRST version of this self-test passed 14/14 against a gate whose
      # blocking had been removed — the mutation contract is what proves the
      # cases can go red, and CI runs it with --mutations on every push
      # (543s measured under load — far past the local push budget).
      echo "== merge-gate self-test =="
      bash "$ROOT/.claude/hooks/pre-merge-gate.test.sh" || return 1
    fi
  fi

  if [ "$PREPUSH_RUN_BACKEND" = "1" ] && leg backend; then
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

  if [ "$PREPUSH_RUN_LINT" = "1" ] && leg lint; then
    echo "== backend lint/type (ruff + mypy + bandit) =="
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
    # bandit, exactly as deploy.yml:101 runs it (#377 mapping). Seconds, and it
    # is the one CI backend leg this gate never mirrored — a backend push could
    # be locally green and fail CI on a security finding.
    if [ "${PREPUSH_RUN_BANDIT:-1}" = "1" ] && [ -x "$ROOT/backend/venv/bin/bandit" ]; then
      echo "-- bandit --"
      ( cd "$ROOT/backend" && ./venv/bin/bandit -r app -ll --skip B101 -q ) || return 1
    fi
  fi

  if [ "$PREPUSH_RUN_FRONTEND" = "1" ] && { leg fe:cdsafety || leg fe:shared || leg fe:public || leg fe:admin || leg fe:runner; }; then
    if leg fe:cdsafety; then
      echo "== frontend cd-safety (zoneless repaint hazards, #118) =="
      ( cd "$ROOT/frontend" && node scripts/check-cd-safety.mjs ) || return 1
    fi
    # PER-PROJECT selection (#377): a projects/public/** change must not pay for
    # `admin`. `shared` is upstream of both apps, so a change there selects all
    # three — see prepush-select-lib.sh.
    FE_PROJECTS=""
    leg fe:shared && FE_PROJECTS="$FE_PROJECTS shared"
    leg fe:public && FE_PROJECTS="$FE_PROJECTS public"
    leg fe:admin  && FE_PROJECTS="$FE_PROJECTS admin"
    FE_PROJECTS="${FE_PROJECTS# }"
    if [ -n "$FE_PROJECTS" ]; then
      echo "== frontend tests ($FE_PROJECTS) =="
      # NOT `npm test`: that chains the three projects with `&&`, so ONE project's
      # failure hides the other two — and twice in v1.13.0 a Vitest worker-
      # teardown race (`Closing rpc while "onUserConsoleLog" is pending`, upstream
      # vitest-dev/vitest#8649/#9872) hard-failed this gate with 337/337 tests
      # PASSING, aborting before `admin` ran at all — once while pushing a release
      # tag. The runner runs every SELECTED project, and retries a project exactly
      # ONCE when the output carries that signature AND reports zero failed tests.
      # A real failure is never retried and always denies (see its self-test).
      # FRONTEND_PROJECTS is the runner's own documented knob — CI passes it too
      # (one project per job, #319), so this is the supported narrowing, not a
      # new code path.
      ( cd "$ROOT" && FRONTEND_PROJECTS="$FE_PROJECTS" bash scripts/run_frontend_suites.sh ) || return 1
    fi
    if leg fe:runner; then
      ( cd "$ROOT" && bash scripts/run_frontend_suites.test.sh >/dev/null ) || {
        echo "  ✗ run_frontend_suites.test.sh failed — the frontend runner's own retry contract is broken"
        return 1
      }
    fi
  fi
}

if run_checks >"$LOG" 2>&1; then
  allow
else
  deny "Pre-push checks FAILED. Legs run this push: $LEGS_PRETTY ($SELECT_REASON). See $LOG. Force the full round with PREPUSH_FULL=1; configure via env: PREPUSH_RUN_BACKEND, PREPUSH_RUN_LINT, PREPUSH_RUN_RUFF, PREPUSH_RUN_MYPY, PREPUSH_RUN_BANDIT, PREPUSH_RUN_FRONTEND, PREPUSH_CHECK_DOCS, TEST_DATABASE_URL."
fi
