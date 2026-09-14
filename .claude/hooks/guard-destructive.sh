#!/usr/bin/env bash
# Guardrail against irreversible LOCAL/infra destruction (issue #116).
#
# A PreToolUse `Bash` hook: it inspects the command JSON on stdin and BLOCKS
# (permissionDecision: "deny") a small, high-blast-radius set of destructive
# commands that would wipe stateful local resources the user never explicitly
# authorized destroying — Docker volumes, whole non-`test_*` databases, or data
# directories. Defense-in-depth BEYOND the generic permission classifier, which
# only blocked the #91 incident (`docker volume rm mavrovde_open-webui_data`) by
# luck.
#
# COMMAND-POSITION AWARE: it matches only when a destructive command is actually
# being *invoked* — not when the same text merely appears as an argument (a
# `git commit -m "...docker volume rm..."` message, a `grep`/`echo` of the
# pattern, docs). It splits the command on shell separators and inspects the
# FIRST token of each segment; segments whose command is a text/VCS tool
# (git/grep/echo/cat/sed/awk/…) are skipped. It also transparently unwraps common
# indirection — `sudo`/`env`/`nohup`/`time`, `xargs [opts]`, and `bash -c` /
# `sh -c` / `eval "…"` — so `… | xargs docker volume rm` (the "remove ALL volumes"
# idiom) and `bash -c "docker volume rm x"` are still caught. It never interferes
# with normal work (build, test, `verify_all.sh`, `manage.sh`, `test_*` teardown).
#
# A backup is NOT consent: to run one of these deliberately, either export
# GUARD_DESTRUCTIVE=0 for an authorized session, or prefix that ONE command's
# segment with the bypass token, e.g.  GUARD_DESTRUCTIVE=0 docker volume rm <name>
# (the bypass is honored only as a LEADING env-assignment of the segment being
# guarded — a stray `GUARD_DESTRUCTIVE=0` elsewhere in the line does not disarm it).
set -uo pipefail
# Segments are iterated via unquoted command substitution (word-splitting on
# newlines is exactly what we want there). Without `-f`, a segment containing a
# glob character would additionally be rewritten by whatever files happen to sit
# in the working directory — so what the guard inspects could differ from what
# was typed. Disable pathname expansion for the whole script.
set -f

# Byte-wise scanning (#219). Under a UTF-8 locale, bash's ${s:i:1} indexing is
# O(n) per access (it re-counts multibyte characters from the start), which made
# the character loops below quadratic — a 24 KB command cost ~8 s against a 15 s
# hook timeout, and a hook that times out does NOT deny. Every character this
# guard dispatches on (quotes, backslash, separators, `<<`, `#`, `$`) is ASCII,
# and UTF-8 continuation bytes always have the high bit set, so they can never
# alias any of them: scanning bytes is semantically identical and ~3.5x faster
# (measured: 24 KB 7.9 s → 2.2 s).
export LC_ALL=C

# Session master switch (inherited from the hook's environment / settings env).
: "${GUARD_DESTRUCTIVE:=1}"

allow() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
}
deny() {
  # $1 = reason (plain text, no double quotes — it is embedded in JSON)
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$1\"}}"
  exit 0
}

[ "$GUARD_DESTRUCTIVE" = "1" ] || allow

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$CMD" ] && CMD="$INPUT"

# Input-size bound (#219). The quoting scan below is O(n^2)-ish in pure bash and
# runs BEFORE the wall-clock deadline can see anything, so a large enough command
# used to outlive the hook's 15 s timeout — and a hook that times out does not
# deny, meaning bulk alone defeated the guard regardless of parsing correctness.
# Refusing to analyse must never mean allowing: above the bound we DENY.
#
# The default is measured, not guessed: with byte-wise scanning a 24 KB command
# costs ~2.2 s to split on this class of machine, which together with the 8 s
# inspection deadline stays well inside the 15 s hook timeout. Ordinary work is
# far below it — a multi-paragraph `gh pr comment --body` is 3–6 KB and a full
# `verify_all.sh` invocation a few hundred bytes. Overridable for slower/faster
# machines; a non-numeric override falls back to the default rather than
# becoming a way to switch the bound off.
GUARD_MAX_CMD_LEN="${GUARD_MAX_CMD_LEN:-24000}"
case "$GUARD_MAX_CMD_LEN" in
  ''|*[!0-9]*) GUARD_MAX_CMD_LEN=24000 ;;
esac
if [ "${#CMD}" -gt "$GUARD_MAX_CMD_LEN" ]; then
  deny "BLOCKED: this command is ${#CMD} characters, above the ${GUARD_MAX_CMD_LEN}-character bound the guard can analyse within its time budget — and a command that was never analysed must not be allowed. Split it into smaller commands (e.g. write long content to a file first), or prefix it with GUARD_DESTRUCTIVE=0 if it is authorized."
fi

# The shared command-parsing model — quote-aware segmentation (quote_split),
# the transparent-wrapper peel (peel_wrapper), the text-tool list, and the
# text-tool heredoc exemption (strip_text_heredocs + helpers) — lives in
# hook-parse-lib.sh, sourced by BOTH this guard and pre-push-tests.sh (#237).
# One model of the input: a parsing fix or hole cannot diverge between hooks.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-parse-lib.sh"

REASON=""

# Does the ORIGINAL command contain a line continuation (backslash immediately
# before a newline)? bash joins those lines into ONE command, but the inner pass
# splits on the newline, so a single invocation is fragmented and the
# multi-condition rules see only halves.
#
# Computed once, here, because inspect_segment normalises newlines to spaces
# before the wrapper branch runs — by then the continuation is unrecoverable, and
# testing for a bare backslash instead would fire on every nested `eval "…\"…\""`
# and bring back the exponential cost this bound exists to prevent.
case "$CMD" in
  *\\$'\n'*) HAS_CONTINUATION=1 ;;
  *) HAS_CONTINUATION=0 ;;
esac

# Nesting depth of shell-wrapper unwrapping (see inspect_inner_script).
INNER_DEPTH=0

# Wall-clock budget, in seconds, for the whole analysis.
#
# The hook is registered with a 15 s timeout in .claude/settings.json, and a hook
# that times out does NOT deny — so an unbounded analysis is itself a bypass: pad
# a command with enough inner commands and the guard never gets to answer.
#
# This is a TIME bound rather than a count of segments, deliberately. Per-segment
# cost varies with machine speed and with how much text each segment carries, so
# any fixed count is simultaneously too small on a fast machine (false denials on
# legitimately long commands) and too large on a slow one (timeouts). `SECONDS`
# is a bash builtin counting from process start, so this costs nothing to read.
#
# Exceeding it DENIES: refusing to analyse must never mean allowing.
#
# Overridable so the self-test can force the deadline path in milliseconds rather
# than shipping an 8-second test case. A non-numeric override falls back to the
# default instead of making `[ "$SECONDS" -ge "$INSPECT_DEADLINE" ]` error out —
# on a guard, a malformed setting must not become a way to switch it off.
INSPECT_DEADLINE="${GUARD_INSPECT_DEADLINE:-8}"
case "$INSPECT_DEADLINE" in
  ''|*[!0-9]*) INSPECT_DEADLINE=8 ;;
esac

# A quoted argument that turns out to be shell code: put the newlines back, split
# it like a real script, and inspect every command in it. Returns 0 (and leaves
# REASON set) when something in there is blocked.
inspect_inner_script() {
  local body="$1" line inner
  # Recursion guard: wrappers can nest (`bash -c "bash -c '…'"`). The depth is
  # bounded so a pathological input cannot spin here; hitting the bound is
  # treated as "cannot analyse", and the caller's normal path still applies.
  # Depth bound. It must fail CLOSED: returning "nothing found" at the bound
  # would mean 8 stacked wrappers deny and 9 allow, i.e. the bypass is simply
  # "nest one level deeper". At the bound we stop analysing and say so.
  # Depth bound, and it must DENY rather than report "nothing found".
  #
  # This was reverted once, on the argument that the flattened fall-through
  # already caught deep destructive nests so the deny only cost a false denial on
  # benign deep nesting. That argument was made purely on the deny axis and was
  # wrong on two counts. The fall-through is now conditional (see
  # needs_flat_pass), so returning "nothing found" here fails OPEN. And the deny
  # was also the only cap on analysis cost: without it, cost is 2^depth — 25 s at
  # depth 9 against a 15 s hook timeout, and a hook that times out does not deny.
  #
  # So a command nested this deep is refused rather than analysed. Nesting shell
  # wrappers 8 deep is not something ordinary work does; the escape hatch is the
  # usual explicit one.
  if [ "$INNER_DEPTH" -ge 8 ]; then
    REASON="BLOCKED: command nests shell wrappers 8+ deep, which this guard refuses to analyse (the analysis cost grows exponentially and an unanalysed command must not be allowed). Simplify it, or prefix that command with GUARD_DESTRUCTIVE=0 if it is authorized."
    return 0
  fi
  INNER_DEPTH=$((INNER_DEPTH + 1))

  # Restore any quoted newlines, then split on them. A body with NO newline is
  # still processed: `bash -c "echo hi; <destroy>"` packs its commands with a
  # semicolon, and because that separator sat inside the wrapper's quotes the
  # outer quote_split protected it — leaving one segment whose benign first
  # token hid the rest (#210).
  body="${body//$NL_SENTINEL/$'\n'}"

  # Split on the restored NEWLINES FIRST, then apply quote_split within each
  # line. Order matters: re-running quote_split over the whole body would see
  # those newlines still sitting inside the wrapper's quotes and protect them all
  # over again, collapsing the script back into one segment — which is how
  # `ssh -p 2222 host "echo hi ↵ <destroy>"` slipped through. Splitting per line
  # also means an unbalanced quote on one line cannot shield the next.
  local OLD="$IFS"
  while IFS= read -r line; do
    [ -n "$REASON" ] && break
    IFS=$'\n'
    for inner in $(quote_split "$line"); do
      [ -n "$REASON" ] && break
      inspect_segment "$inner"
    done
    IFS="$OLD"
  done <<< "$body"
  IFS="$OLD"
  INNER_DEPTH=$((INNER_DEPTH - 1))
  [ -n "$REASON" ]
}

# Does this body need the SECOND, flattened pass as well?
#
# The flattened pass exists for exactly one reason: `quote_split` treats `(`, `)`
# and backtick as separators, so a command substitution in the middle of an
# invocation fragments it and the multi-condition rules never see all their
# conditions at once. If none of those characters is present, no fragmentation is
# possible and the inner pass has already covered the body.
#
# Running it unconditionally cost 2^depth: inspect_inner_script recurses into
# inspect_segment, and then `changed=1` made the enclosing loop descend the SAME
# subtree a second time. Measured 25 s at depth 9 against a 15 s hook timeout —
# and a hook that times out does not deny, so the cost was itself a bypass.
needs_flat_pass() {
  case "$1" in
    *"("*|*")"*|*'`'*) return 0 ;;
  esac
  # A LINE CONTINUATION also fragments a single invocation. bash joins
  # `<cmd> \` + newline + `<args>` into one command, but the inner pass splits on
  # that newline, so the multi-condition rules see the halves separately. A bare
  # newline is different: it really does terminate the command, so splitting
  # there is correct and needs no flattened pass.
  [ "$HAS_CONTINUATION" = 1 ] && return 0
  return 1
}

# Inspect one command segment (already separator-split). Sets REASON on a hit.
inspect_segment() {
  local seg="$1" _dbargs

  if [ "$SECONDS" -ge "$INSPECT_DEADLINE" ]; then
    REASON="BLOCKED: this command is too large for the guard to finish analysing within its time budget, and a command that was never analysed must not be allowed. Split it into smaller commands, or prefix that command with GUARD_DESTRUCTIVE=0 if it is authorized."
    return 0
  fi

  seg="$(printf '%s' "$seg" | tr '\n\t' '  ' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g')"

  # A leading backslash on the command word only suppresses alias expansion —
  # `\docker volume rm` runs docker all the same — but it defeated the anchored
  # rules below (#213). Strip exactly one: `\\docker` names a command literally
  # called `\docker`, which is not the guarded binary.
  seg="${seg#\\}"

  # Peel leading env-assignments; a leading GUARD_DESTRUCTIVE=0 authorizes THIS
  # segment specifically (deliberate, scoped bypass). ONE pass, not a loop: the
  # per-token loop forked 3 processes per assignment, and a ~19 KB run of them
  # outlived the 15 s hook timeout under the 24 KB size bound (round-3 review
  # of #225 — cost is a security property, #219). The bypass check looks for
  # GUARD_DESTRUCTIVE=0 anywhere in the LEADING assignment run, which is
  # exactly the set the loop used to test one head at a time.
  if printf '%s' "$seg" | grep -Eq '^([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*GUARD_DESTRUCTIVE=0( |$)'; then
    return 0
  fi
  seg="$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*//')"

  # Transparently unwrap indirection so wrapped invocations are still inspected.
  # Loop because wrappers stack (e.g. `sudo env FOO=bar xargs docker volume rm`).
  local changed=1 guard=0
  while [ "$changed" = "1" ] && [ "$guard" -lt 8 ]; do
    changed=0; guard=$((guard + 1))
    # The unwrap loop itself must respect the budget: $SECONDS is a builtin, so
    # this costs nothing, and every branch below forks (round-3 review, #219).
    if [ "$SECONDS" -ge "$INSPECT_DEADLINE" ]; then
      REASON="BLOCKED: this command is too large for the guard to finish analysing within its time budget, and a command that was never analysed must not be allowed. Split it into smaller commands, or prefix that command with GUARD_DESTRUCTIVE=0 if it is authorized."
      return 0
    fi
    # sudo/command/nohup/time/exec/env/nice/ionice/stdbuf/setsid/timeout/… — one
    # shared wrapper model (#217), options and their values consumed.
    if peel_wrapper "$seg"; then
      seg="$PEEL_RESULT"; changed=1
    fi
    # A wrapper can hand its argv to an alias-suppressed spelling too (#213).
    if [ "${seg:0:1}" = '\' ]; then seg="${seg#\\}"; changed=1; fi
    # more env-assignments after a wrapper — same single-pass shape as above
    if printf '%s' "$seg" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*='; then
      if printf '%s' "$seg" | grep -Eq '^([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*GUARD_DESTRUCTIVE=0( |$)'; then
        return 0
      fi
      seg="$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*//')"; changed=1
    fi
    # xargs [options...] <cmd> — drop `xargs` and its option/replacement tokens.
    if printf '%s' "$seg" | grep -Eq '^xargs( |$)'; then
      # strip xargs + its leading options (-0, -n1, -P4, -I{}, --max-args=1, {})
      # in ONE sed pass — the per-token loop forked twice per option and a 12 KB
      # option run outlived the hook timeout (round-3 review, #219).
      seg="$(printf '%s' "$seg" | sed -E 's/^xargs +//; s/^((-[^ ]+|\{\}|[A-Za-z]=) )*//; s/^(-[^ ]+|\{\}|[A-Za-z]=)$//')"
      changed=1
    fi
    # bash -c "…" / sh -c '…' / zsh -c … / eval … / ssh host "…" — the quoted
    # argument is a SCRIPT, so inspect the command(s) inside it.
    #
    # Two passes are needed, and BOTH matter. `inspect_inner_script` re-splits the
    # body so packed separators are seen (#210) — but `quote_split` also treats
    # `(`, `)` and backtick as separators, so a command substitution in the middle
    # of an invocation FRAGMENTS it, and the multi-condition rules (compose +
    # `down` + `-v`; `rm` + recursive + data path) never see all their conditions
    # in one piece. Falling through afterwards re-inspects the FLATTENED body as a
    # single segment, which is what catches those. Returning early here made the
    # guard strictly weaker than before on six protected paths.
    # The `-c` may hide inside a cluster (`-lc`), behind other options
    # (`-e -c`, `--login -c`) — all the same script argument (#220).
    if printf '%s' "$seg" | grep -Eq '^(bash|sh|zsh|dash) +((-o [^ ]+|--rcfile [^ ]+|--init-file [^ ]+|-[A-Za-z]+|--[A-Za-z-]+) +)*-[A-Za-z]*c[A-Za-z]* (-- +)?'; then
      seg="$(printf '%s' "$seg" | sed -E "s/^(bash|sh|zsh|dash) +((-o [^ ]+|--rcfile [^ ]+|--init-file [^ ]+|-[A-Za-z]+|--[A-Za-z-]+) +)*-[A-Za-z]*c[A-Za-z]* +(-- +)?//; s/^\\\$?[\"']//")"
      inspect_inner_script "$seg" && return 0
      needs_flat_pass "$seg" || return 0
      changed=1
    # A here-string feeds its word to the shell as its script — same object as
    # `-c`, different spelling (#220). heredoc_delim already refuses `<<<`, so
    # nothing upstream has stripped it.
    elif printf '%s' "$seg" | grep -Eq '^(bash|sh|zsh|dash)( +-[A-Za-z-]+)* +<<<'; then
      seg="$(printf '%s' "$seg" | sed -E "s/^(bash|sh|zsh|dash)( +-[A-Za-z-]+)* +<<< *//; s/^\\\$?[\"']//")"
      inspect_inner_script "$seg" && return 0
      needs_flat_pass "$seg" || return 0
      changed=1
    elif printf '%s' "$seg" | grep -Eq '^eval '; then
      seg="$(printf '%s' "$seg" | sed -E "s/^eval +//; s/^\\\$?[\"']//")"
      inspect_inner_script "$seg" && return 0
      needs_flat_pass "$seg" || return 0
      changed=1
    elif printf '%s' "$seg" | grep -Eq '^ssh '; then
      # `ssh host "…"` runs its argument on the remote shell. Same reasoning, and
      # the blast radius there is someone else's machine.
      #
      # Inspect the WHOLE remainder first, before any attempt to parse options
      # and host. ssh's option grammar is a swamp (`-p 2222`, `-p2222`,
      # `-o Port=22`, `-i key`, `user@host`), and a parser that guesses wrong
      # eats the flag's value as the host and the real host as the command —
      # which silently skips inspection. Inspecting first makes the body's
      # protection independent of getting that grammar right.
      local rest="${seg#ssh }"
      inspect_inner_script "$rest" && return 0

      # Then best-effort strip options (consuming the values of value-taking
      # flags) and the host, so a SINGLE-LINE `ssh host <destroy>` is inspected
      # as a command rather than as an argument.
      while [ "${rest:0:1}" = "-" ]; do
        local flag="${rest%% *}"
        [ "$flag" = "$rest" ] && break
        rest="${rest#* }"
        case "$flag" in
          -[bcDEeFIiJLlmOopQRSWw]) rest="${rest#* }" ;;  # flag took a separate value
        esac
      done
      seg="$(printf '%s' "$rest" | sed -E "s/^[^ ]+ +//; s/^\\\$?[\"']//")"
      changed=1
    fi
  done

  # `find … -exec <cmd> …` — inspect the command that follows
  # -exec/-execdir/-ok/-okdir (all four execute it; -ok merely prompts first).
  # The old pattern was ' -execdir? ': in ERE the `?` binds to the single
  # preceding character, so it matched `-execdir` and `-execdi` but never the
  # common plain `-exec` (#218). Gated on the segment's command being `find`
  # itself — without the gate, widening the pattern would make a commit message
  # that merely QUOTES a `find -exec …` invocation deny (the #204 class).
  if [ "${seg%% *}" = "find" ] && printf '%s' "$seg" | grep -Eq ' -(exec|ok)(dir)? '; then
    local post
    post="$(printf '%s' "$seg" | sed -E 's/^.* -(exec|ok)(dir)? +//')"
    [ -n "$post" ] && [ "$post" != "$seg" ] && inspect_segment "$post"
    [ -n "$REASON" ] && return 0
  fi

  # Anything still carrying sentinels is NOT shell code (the branches above would
  # have recursed), so those newlines really were data: flatten them to spaces so
  # the segment reads as the one quoted argument it is.
  seg="${seg//$NL_SENTINEL/ }"
  seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g')"

  local first="${seg%% *}"
  [ -z "$first" ] && return 0
  is_text_tool "$first" && return 0

  # 1. Docker volume destruction: `docker volume rm|prune`
  if printf '%s' "$seg" | grep -Eq '^docker +volume +(rm|prune)\b'; then
    REASON="BLOCKED: 'docker volume rm/prune' destroys named Docker volumes (DB / open-webui / model data). Irreversible and not authorized. If the user named this volume to delete, prefix that command with GUARD_DESTRUCTIVE=0."
    return 0
  fi
  # 2. Compose teardown that also removes volumes: `docker compose ... down -v`
  if printf '%s' "$seg" | grep -Eq '^docker(-compose| +compose)\b' \
     && printf '%s' "$seg" | grep -Eq '\bdown\b' \
     && printf '%s' "$seg" | grep -Eq '(-v\b|--volumes\b)'; then
    REASON="BLOCKED: 'docker compose down -v/--volumes' deletes the stack's named volumes (Postgres, ollama, open-webui). Use 'down' without -v to stop containers while keeping data. Prefix GUARD_DESTRUCTIVE=0 only if wiping these volumes was authorized."
    return 0
  fi
  # 3. System / image prune
  if printf '%s' "$seg" | grep -Eq '^docker +system +prune\b'; then
    REASON="BLOCKED: 'docker system prune' mass-deletes stopped containers / networks / build cache (and volumes with --volumes). Not authorized as an autonomous action. Prefix GUARD_DESTRUCTIVE=0 if explicitly asked."
    return 0
  fi
  if printf '%s' "$seg" | grep -Eq '^docker +image +prune\b' \
     && printf '%s' "$seg" | grep -Eq '(-a\b|--all\b)'; then
    REASON="BLOCKED: 'docker image prune -a' removes ALL images not used by a running container (slow to recover). Prefix GUARD_DESTRUCTIVE=0 if explicitly authorized."
    return 0
  fi
  # 4. Dropping a non-`test_*` database.
  if printf '%s' "$seg" | grep -Eq '^dropdb\b'; then
    # Boundaries accept a surrounding QUOTE only — deliberately narrower than
    # rule 5's class, which also accepts `=` and `/`.
    #
    # POLARITY IS THE POINT. Rule 5's class sits on a DENY condition, where a
    # wider class denies more and is therefore conservative. This one sits on an
    # EXEMPTION, where a wider class ALLOWS more — so the same widening inverts.
    # Adding `=` here let any `--dbname=test_x` anywhere in the segment disarm the
    # rule while the actual operand was the production database. When copying a
    # boundary between rules, check which way its polarity runs.
    #
    # The fix this class exists for: a
    # wrapper's LEADING quote is stripped when it is unwrapped but the trailing
    # one is not, so an inner body arrives ending in a stray quote. A boundary of
    # ([ ]|$) then fails to recognise a quoted test-database name as a test
    # database, and DENIES the one destructive operation rule 9 explicitly
    # authorises: tearing down a scratch DB at the end of a wrapped test run.
    # That is this repo's own prescribed loop, so the false denial lands on
    # exactly the workflow the exemption exists for.
    # Option VALUES are not the operand. `--dbname=test_x <prod>` names a test
    # database in a flag while dropping production, so `=`-joined flags are
    # stripped before asking whether a test database is being dropped.
    #
    # SCOPE: `=`-joined only. A SPACE-separated value (`--maintenance-db test_x
    # <prod>`, `-U test_admin <prod>`) still grants the exemption — tracked in
    # #217 along with the same bug in the wrapper unwrap and in
    # pipes_into_shell. Stating the limit here rather than implying the flag
    # class is fully handled.
    _dbargs="$(printf '%s' "$seg" | sed -E 's/(^| )--?[A-Za-z][A-Za-z-]*=[^ ]*//g')"
    if ! printf '%s' "$_dbargs" | grep -Eq '(^|[ "'"'"'])test_[A-Za-z0-9_]+([ "'"'"']|$)'; then
      REASON="BLOCKED: 'dropdb' on a non-test database is irreversible data loss. Only 'test_*' databases may be dropped autonomously. Prefix GUARD_DESTRUCTIVE=0 if the user named this DB to drop."
      return 0
    fi
  fi
  # 4b. SQL DROP DATABASE/SCHEMA via a DB client (psql/docker exec ... psql, etc).
  if printf '%s' "$seg" | grep -Eiq 'DROP +(DATABASE|SCHEMA)\b'; then
    if ! printf '%s' "$seg" | grep -Eiq 'DROP +(DATABASE|SCHEMA)( +IF +EXISTS)? +"?test_[A-Za-z0-9_]+'; then
      REASON="BLOCKED: 'DROP DATABASE/SCHEMA' on a non-test target is irreversible. Only 'test_*' targets are allowed autonomously. Prefix GUARD_DESTRUCTIVE=0 if authorized."
      return 0
    fi
  fi
  # 5. RECURSIVE rm targeting a persistent data / volume / mount path.
  #    `-f` is deliberately NOT required (#188): `rm -R ./data` destroys the
  #    directory just as irreversibly — the force flag only suppresses prompts
  #    for write-protected files, it is not what makes the delete dangerous.
  #    Flag-order and spelling agnostic: short clusters (-rf, -fr, -Rf, -R, -r),
  #    separated flags in any order, and the long form --recursive.
  if printf '%s' "$seg" | grep -Eq '^rm ' \
     && printf '%s' "$seg" | grep -Eq '(^|[ ])(-[A-Za-z]*[rR][A-Za-z]*|--recursive)([ ]|$)'; then
    # Boundaries accept a surrounding quote too: `rm -R "./data"` is the same
    # delete as `rm -R ./data`, but a trailing `"` used to defeat the `([/ ]|$)`
    # terminator and slip through (found reviewing #188).
    if printf '%s' "$seg" | grep -Eiq '(^|[ =/"'"'"'])(data|pgdata|postgres[-_]?data|db[-_]?data|volumes?|ollama|open-webui|\.chrome-profile|linkedin_cookies)([/ "'"'"']|$)'; then
      REASON="BLOCKED: recursive 'rm' targeting a persistent data/volume path (data/pgdata/volumes/ollama/open-webui/.chrome-profile/…). Irreversible and unauthorized. Prefix GUARD_DESTRUCTIVE=0 only for a path the user explicitly told you to delete."
      return 0
    fi
  fi
  return 0
}

# Is any segment a BARE shell — i.e. a shell reading its script from stdin?
# `… | bash`, `… | sh -s`, `… | sudo bash`. That construct means "execute the
# text that reaches me", so quoted text earlier in the pipeline is CODE, however
# innocent its producing command looks (#210).
pipes_into_shell() {
  local seg first rest optless via_xargs before
  local _TAB=$'\t' _CR=$'\r' _VT=$'\v' _FF=$'\f'
  local OLD="$IFS"; IFS=$'\n'
  for seg in $1; do
    # BUDGET, checked per segment with a costless builtin (#235): this loop
    # runs once per separator-split segment, and a command made of thousands
    # of tiny segments used to spend ~3 forks on each — 36.8 s on a 10 KB
    # command, past the 15 s hook timeout. Past the budget we return 1: NOT
    # "this is safe" but "stop paying for this pass" — the unconditional main
    # pass below runs next and inspect_segment's own deadline check DENIES it.
    # Returning 0 here would be equally fail-closed in principle but routes
    # thousands of segments through the payload pass, which forks ~3× per
    # segment and can only reach the same deadline deny: measured 17.6 s vs
    # 7.9 s on the double-space shape. Cheapest path to the same denial wins.
    if [ "$SECONDS" -ge "$INSPECT_DEADLINE" ]; then IFS="$OLD"; return 1; fi
    # Fork-free fast paths (#235). Every dispatch below used to fork
    # (sed normalise, grep xargs-test, $(peel_wrapper)); now a segment pays a
    # fork only when it actually needs one:
    # - ltrim + skip blank segments with pure bash;
    # - collapse inner whitespace only when there is whitespace the parsing
    #   below (which assumes single spaces) would otherwise trip over;
    # - the xargs test is a case pattern; peel_wrapper returns via a global.
    # The trigger set must be EXACTLY what the sed it replaced normalised, i.e.
    # all of [[:space:]] — testing only for a doubled space/tab left a lone
    # \r/\v/\f in place, so `… | bash\r` no longer read as `bash` and a deny
    # became an ALLOW (round-3 review of #240). Unexploitable (bash does not
    # word-split on those) but a real decision change, and exact parity costs
    # nothing: ordinary input contains none of them and never forks here.
    seg="${seg#"${seg%%[![:space:]]*}"}"
    case "$seg" in "") continue ;; esac
    case "$seg" in
      *"  "*|*"$_TAB"*|*"$_CR"*|*"$_VT"*|*"$_FF"*)
        seg="$(printf '%s' "$seg" | sed -E 's/[[:space:]]+/ /g')" ;;
    esac
    # Peel wrappers, including ones that take their own options (`sudo -E`,
    # `xargs -0`, `timeout 60`, `stdbuf -o0`), then an absolute path —
    # `/bin/bash` is as much a shell as `bash`. Matching two exact spellings
    # made this an allowlist of the first two forms that came to mind; every
    # other spelling executed unguarded. The wrapper set itself is the SHARED
    # peel_wrapper model (#217) so this cannot drift from inspect_segment's.
    via_xargs=0
    while :; do
      # QUOTED spellings of the shell reduce by the ONE quoting model (#370):
      # `"bash"`, `'bash'`, `ba"sh"` and `$'bash'` are the same binary as
      # `bash`, and matching the raw segment text made the shell list an
      # allowlist of unquoted spellings — all four piped a destruction payload
      # unguarded (measured on main@32555b3). argv_split is the existing
      # quote-aware splitter (fork-free, linear), paid only when the segment
      # still carries a quote character; a case-arm unquoter here would be a
      # fourth quoting model, which is the #217/#237 drift class. Rejoining
      # with single spaces matches the whitespace-collapsed shape the parsing
      # below assumes. An UNTERMINATED quote means this segment is a fragment
      # cut at a newline — leave it raw, exactly as before this change.
      case "$seg" in
        *[\"\']*)
          argv_split "$seg"
          if [ "$ARGV_SPLIT_UNTERMINATED" = 0 ] && [ "${#ARGV_SPLIT_RESULT[@]}" -gt 0 ]; then
            # printf -v, not "${arr[*]}": IFS is newline inside this loop, so
            # [*] would join tokens with newlines, not spaces. No fork either way.
            printf -v first '%s ' "${ARGV_SPLIT_RESULT[@]}"
            first="${first% }"
            if [ "$first" != "$seg" ]; then seg="$first"; continue; fi
          fi ;;
      esac
      case "$seg" in
        xargs|"xargs "*)
          via_xargs=1
          # one pass — a per-token strip loop here has the same fork-per-option
          # cost profile the round-3 review measured in inspect_segment (#219)
          seg="$(printf '%s' "$seg" | sed -E 's/^xargs *//; s/^(-[^ ]+ )*//; s/^-[^ ]*$//')"
          continue ;;
      esac
      # NORMALISE BEFORE MATCHING, and do it INSIDE the loop (#253). Both of
      # these used to run once, AFTER the loop had already given up — so an
      # absolute-path wrapper was never peeled at all: `/usr/bin/env bash`
      # became `env bash` with nothing left to peel it, and `\bash` never
      # matched the shell list. Measured bypasses on the pre-fix hook:
      # `\bash`, `/usr/bin/env bash`, `/usr/bin/sudo bash`,
      # `/usr/bin/timeout 60 bash` all ALLOWED a destruction payload.
      # Peeling is iterative, so normalisation must be too.
      before="$seg"
      # absolute path: /bin/bash is as much a shell as bash, and
      # /usr/bin/env is as much a wrapper as env. Builtins only, no fork.
      case "$seg" in
        /*) first="${seg%% *}"; seg="${first##*/}${seg#"$first"}" ;;
      esac
      # a leading backslash suppresses alias/function lookup but runs the SAME
      # binary — inspect_segment has stripped it since #204; this path had not.
      case "$seg" in
        '\'*) seg="${seg#\\}" ;;
      esac
      [ "$seg" != "$before" ] && continue
      if peel_wrapper "$seg"; then seg="$PEEL_RESULT"; continue; fi
      break
    done
    first="${seg%% *}"
    case "$first" in
      bash|sh|zsh|dash)
        # Behind xargs the piped text becomes the `-c` argument, so it is code
        # arriving by pipe however the rest of the line reads.
        if [ "$via_xargs" = 1 ]; then IFS="$OLD"; return 0; fi

        # Which forms actually read the PIPE? Match them EXPLICITLY. Phrasing this
        # as "anything that is not -c" made it a negation, and negations here are
        # how this guard grows false denials: `bash ci.sh` takes its script from a
        # FILE operand, reads nothing from the pipe, and was being treated as a
        # shell executing the pipeline — which reclassified every quoted string on
        # the line as code and denied this repo's own
        # `bash …test.sh && git commit -m "…"` flow.
        rest="${seg#"$first"}"
        rest="${rest# }"
        case "$rest" in
          "")            IFS="$OLD"; return 0 ;;   # bare `bash` — reads stdin
          "-"|"-s"|"-s "*|"- "*)                    # explicit stdin forms
                         IFS="$OLD"; return 0 ;;
          -*)            # Options only, no operand: still stdin (`bash -x`, `bash -e -x`).
                         # `-o`/`--rcfile`/`--init-file` take a VALUE, which would
                         # otherwise read as a script operand — `bash -o posix`
                         # still reads stdin.
                         optless="$(printf '%s' "$rest" | sed -E 's/(^| )(-o|--rcfile|--init-file) +[^ ]+//g')"
                         case "$optless" in
                           *" "[!-]*) ;;            # ...unless a real operand follows
                           *) IFS="$OLD"; return 0 ;;
                         esac
                         ;;
        esac
        ;;
    esac
  done
  IFS="$OLD"; return 1
}

# The contents of each quoted region in a segment, one per line.
quoted_payloads() {
  local s="$1" cur="" i c q="" n=${#1}
  for (( i=0; i<n; i++ )); do
    c="${s:i:1}"
    if [ "$c" = '\' ] && [ "$q" != "'" ] && [ $((i + 1)) -lt "$n" ]; then
      # In ANSI-C quoting `\n` expands to a real newline before execution; the
      # payload is later split on newlines, so emit one (#213).
      if [ "$q" = "$ANSI_Q" ] && [ "${s:i+1:1}" = "n" ]; then cur+=$'\n'
      elif [ -n "$q" ]; then cur+="${s:i+1:1}"; fi
      i=$((i + 1)); continue
    fi
    if [ -n "$q" ]; then
      if [ "$c" = "$q" ] || { [ "$q" = "$ANSI_Q" ] && [ "$c" = "'" ]; }; then
        q=""; printf '%s\n' "$cur"; cur=""
      else cur+="$c"; fi
      continue
    fi
    # ANSI-C quoting $'…' — same third quoting model as in quote_split (#213).
    if [ "$c" = '$' ] && [ $((i + 1)) -lt "$n" ] && [ "${s:i+1:1}" = "'" ]; then
      q="$ANSI_Q"; i=$((i + 1)); continue
    fi
    case "$c" in \'|\") q="$c" ;; esac
  done
  [ -n "$q" ] && [ -n "$cur" ] && printf '%s\n' "$cur"
}

SEGMENTS="$(quote_split "$(strip_text_heredocs "$CMD")")"

# When the command feeds a shell from stdin, re-read every quoted argument in it
# as a script before the normal pass. Without this, `printf "%s" "<destroy>" |
# bash` is two segments — one led by a text tool, one that is just `bash` — and
# neither looks destructive on its own.
if pipes_into_shell "$SEGMENTS"; then
  OLDIFS="$IFS"; IFS=$'\n'
  for seg in $SEGMENTS; do
    [ -n "$REASON" ] && break
    # This pass forks ~3× per segment ($(quoted_payloads), $(mask_quotes), a
    # sed), so it needs the same budget check the other pre-inspection loops
    # already have (strip_text_heredocs, heredoc_target_executed): past the
    # deadline it can no longer find anything anyway — every path in it that
    # sets REASON goes through inspect_segment, which just denies on the
    # deadline — so stopping here is fail-closed AND far cheaper (#235).
    [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] && break
    # PREFILTER WITH BUILTINS BEFORE FORKING (#253). A segment containing no
    # quote character has no quoted payloads to extract and nothing for
    # mask_quotes to mask — both forks are pure waste on it, and in a long
    # pipeline most segments are exactly that shape. #235 bounded this loop
    # with a deadline; below the deadline the per-segment cost was unchanged.
    # `case` is a builtin: no fork, no subshell.
    _has_quote=0
    case "$seg" in *'"'*|*"'"*) _has_quote=1 ;; esac
    # mask_quotes is NOT the identity on quote-free input, and assuming it was
    # opened a REAL BYPASS in review (round 1 of #253): it also de-escapes `\X`
    # (hook-parse-lib.sh:184) and blanks an unquoted `#` comment (:200), neither
    # of which needs a quote. Measured on the first draft:
    #   echo docker\ volume\ rm\ <vol> | bash   deny -> ALLOW
    #   echo rm\ -rf\ ./data | bash             deny -> ALLOW
    # So the masking predicate must be WIDER than the payload one: any character
    # mask_quotes reacts to. Keep the two flags separate — `quoted_payloads`
    # genuinely has nothing to extract without a quote.
    _needs_mask=0
    case "$seg" in *'"'*|*"'"*|*'\'*|*'#'*) _needs_mask=1 ;; esac
    if [ "$_has_quote" -eq 1 ]; then
      for payload in $(quoted_payloads "$seg"); do
        [ -n "$REASON" ] && break
        inspect_inner_script "$payload"
      done
    fi
    # An UNQUOTED payload is code too (#220): `echo <destroy> | bash` executes
    # identically to the quoted spelling, but produced no quoted payload at all,
    # so nothing above inspected it. When the segment's command is a text tool
    # (the producer whose arguments become the piped text), inspect its unquoted
    # remainder as a command. Quoted regions are masked out first — they were
    # already inspected as payloads, and leaving them in would re-read prose as
    # code and bring back the #204 false denials.
    if [ -z "$REASON" ]; then
      # Skip the fork only when mask_quotes provably cannot change the string —
      # i.e. no quote, no backslash, no `#`. See the _needs_mask note above.
      if [ "$_needs_mask" -eq 1 ]; then _unq="$(mask_quotes "$seg")"; else _unq="$seg"; fi
      # …and the whitespace squeeze only needs a sed when there IS irregular
      # whitespace. Trimming the ends is builtin-only (the same `${var#...}`
      # pattern the segment loop above already uses).
      _unq="${_unq#"${_unq%%[![:space:]]*}"}"
      _unq="${_unq%"${_unq##*[![:space:]]}"}"
      # NOTE the distinct names: _TAB/_CR/_VT/_FF are `local` to
      # pipes_into_shell and unset out here. Under this script's `set -u` that
      # is an ABORT, not an empty match (measured in review — the original
      # "matches empty, so it always seds" rationale was wrong; the real
      # consequence was worse). Either way the fix is the same: own copies.
      _wsTAB=$'\t'; _wsCR=$'\r'; _wsVT=$'\v'; _wsFF=$'\f'
      case "$_unq" in
        *"  "*|*"$_wsTAB"*|*"$_wsCR"*|*"$_wsVT"*|*"$_wsFF"*)
          _unq="$(printf '%s' "$_unq" | sed -E 's/[[:space:]]+/ /g')" ;;
      esac
      _unq_first="${_unq%% *}"
      if [ "$_unq_first" != "$_unq" ] && is_text_tool "$_unq_first"; then
        inspect_segment "${_unq#* }"
      fi
    fi
  done
  IFS="$OLDIFS"
fi

OLDIFS="$IFS"; IFS=$'\n'
for seg in $SEGMENTS; do
  [ -n "$REASON" ] && break
  inspect_segment "$seg"
done
IFS="$OLDIFS"

[ -n "$REASON" ] && deny "$REASON"
allow
