#!/usr/bin/env bash
# Merge gate (v1.12.0 retrospective): rule 13 and the Closes/AC contract,
# enforced mechanically instead of asked for in prose.
#
# WHY THIS EXISTS — measured over v1.12.0's review verdicts:
#   * Rule 13 (independent APPROVE before merge) is restated across eleven
#     files with zero mechanical enforcement anywhere.
#   * `Closes #NN` against an issue with unticked acceptance criteria was a
#     BLOCKER in four PRs (#254, #257, #258, #284). Every one was caught only
#     because a review read the issue by hand. A `Closes` decides the issue's
#     fate automatically at merge, so an unmet criterion closes silently.
#
# Merging is the sanctioned prod-deploy trigger (rule 8) — the irreversible
# moment this repo already guards elsewhere. Within its boundary this hook
# FAILS CLOSED: anything it cannot analyse or verify is a deny, never an allow.
#
# THE BOUNDARY, stated honestly (#291 review rounds 5-7): this is a
# COMMAND-TEXT gate. It analyses the Bash tool's command string and nothing
# else, so a merge that arrives as FILE CONTENTS or through an opaque transport
# is invisible to it — measured open shapes: `cat script.sh | bash`,
# `bash script.sh`, and `ssh -o "ProxyCommand=..."`. Guarding file execution
# is the destruction guard's territory and a different analysis; pretending
# this hook covers it would be the same false comfort the heredoc comment gave
# (round 2). A further NAMED residual inside the command-text boundary: a
# quote-split command WORD — `gh pr me"rge" N` — reassembles only in the shell,
# and this gate does not model word-level concatenation (measured ALLOW; the
# accepted guard-destructive.sh carries the same residual, #291 round 8). The
# honest promise is therefore: no merge typed as a PLAINLY-SPELLED command
# slips through; an author quoting mid-word is evading, not typing.
#
# Bypass ONE authorized merge with:  PR_MERGE_GATE=0 gh pr merge <N> ...
set -u

DEADLINE_SECONDS="${PR_MERGE_GATE_DEADLINE:-25}"
# The PARSE phase's share of that budget. Defaults to the SAME number, so
# production behaviour is byte-for-byte what it was: one budget, both phases.
# It exists because the two phases are otherwise indistinguishable from a test
# (#377). The self-test needs a `gh` slower than the POST-network deadline while
# the parse phase provably cannot trip — with one knob that case was
# LOAD-SENSITIVE: it denied from the parse loop under parallel load (observed
# failing inside the full pre-push gate, then 100/0 when run alone), and a
# decision-only assertion would have let the deadline mutation survive.
# Splitting the knob makes the case deterministic without moving the default.
PARSE_DEADLINE_SECONDS="${PR_MERGE_GATE_PARSE_DEADLINE:-$DEADLINE_SECONDS}"
START=$SECONDS

allow() { flush_bypass_traces; exit 0; }

# A bypass is AUTHORIZED but must never be INVISIBLE (#392): #321 and #355 each
# merged with zero verdicts across two consecutive releases, and afterwards
# nobody could establish whether the gate was bypassed or never reached. This
# makes the CLI half countable: every PR_MERGE_GATE=0 use appends to a local
# audit log (countable even offline; override the path with PR_MERGE_GATE_LOG)
# and best-effort posts a PR comment — the public trace — fire-and-forget, so
# an offline `gh` can never block a merge the human already authorized. The
# web-UI half (how #321/#355 actually merged: Dependabot + the security-tab
# flow, where no PreToolUse hook exists) is covered by the scheduled
# verdict-audit workflow, not by this hook.
BYPASS_SEGS=()
gate_bypass_trace() { # gate_bypass_trace <pr-or-unknown> <segment>
  local n="$1" seg="$2" ts logf
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown-time)"
  logf="${PR_MERGE_GATE_LOG:-$HOME/.claude/merge-gate-bypass.log}"
  # The log line is unconditional — PR=unknown still counts as one bypass.
  # mkdir -p first: with no ~/.claude the append failed silently and the trace
  # vanished entirely (#399 review, minor 7 — measured).
  { mkdir -p "$(dirname "$logf")" && printf '%s bypass PR=%s cmd=%s\n' "$ts" "$n" "$seg" >> "$logf"; } 2>/dev/null || :
  if [ "$n" != "unknown" ] && [ "${PR_MERGE_GATE_TRACE_COMMENT:-1}" = "1" ]; then
    # NO BACKTICKS in this string (#399 round 2, major 1): the first version
    # wrote \` inside double quotes, bash opened a command substitution, and
    # the PR_MERGE_GATE=0 token VANISHED from the posted audit artifact — and
    # survived because the test asserted only the CALL, never the body. The
    # body assertion now exists; keep this plain text.
    ( gh pr comment "$n" --body "## ⚠️ MERGE-GATE BYPASS — PR_MERGE_GATE=0 was used for this merge at $ts (recorded by pre-merge-gate.sh; rule 13 audit, #392)" >/dev/null 2>&1 & ) || :
  fi
}
flush_bypass_traces() {
  # Runs ONLY from allow(): a denied command must not publish "was used for
  # this merge" on a PR that was never merged (#399 review, major 3).
  local seg n
  for seg in ${BYPASS_SEGS[@]+"${BYPASS_SEGS[@]}"}; do
    # Strip the leading env assignments (incl. PR_MERGE_GATE=0) and re-run the
    # hook's OWN merge parser — not a second sed (#399 review, major 4): it
    # already consumes wrappers, value-taking flags and finds the first bare
    # operand, so `--squash 284`, `--repo X 284`, URLs and branches all land
    # in MERGE_OPERAND. The cleaned segment no longer matches the bypass
    # regex, so this cannot re-stash.
    while [[ "$seg" =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+ ]]; do seg="${seg#* }"; done
    n=unknown
    if segment_invokes_pr_merge "$seg"; then
      case "$MERGE_OPERAND" in
        ''|*[!0-9]*)
          # URL operand: take a trailing /NN. Anything else (branch, empty)
          # stays unknown — the log still records it; only the comment needs N.
          case "$MERGE_OPERAND" in
            *[0-9]) n="${MERGE_OPERAND##*/}"; case "$n" in ''|*[!0-9]*) n=unknown ;; esac ;;
          esac ;;
        *) n="$MERGE_OPERAND" ;;
      esac
      gate_bypass_trace "$n" "$seg"
    fi
    # a bypassed NON-merge segment (PR_MERGE_GATE=0 git merge 42) is not a
    # merge-gate event at all: no log, no comment.
  done
}
deny() {
  # Same JSON contract as the sibling hooks: a structured deny, exit 0.
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"MERGE GATE: $1 | Bypass one authorized command with PR_MERGE_GATE=0\"}}"
  exit 0
}

# The env form only fires when the hook itself was launched with it. A caller
# writes `PR_MERGE_GATE=0 gh pr merge …`, which is a prefix on the COMMAND TEXT
# and never reaches this process — the check below (on each segment) is the one
# that actually implements the documented hatch. Keeping both costs nothing.
if [ "${PR_MERGE_GATE:-1}" = "0" ]; then
  gate_bypass_trace unknown "env:PR_MERGE_GATE=0 (hook launched with the bypass in its own environment)"
  exit 0
fi

# Extract the command with jq, like both siblings. A hand-rolled sed
# over-captured on multi-line payloads and was the root of several bypasses.
INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"

# SIZE BOUND before any parsing — the sibling guard's #219/#225 lesson, which
# this gate skipped and re-learned: quote_split is a character loop, so a large
# enough command outlives the 30s hook cap (3000 segments measured 39s), and a
# timed-out PreToolUse hook does not deny. O(1) fail-closed beats O(n²) timeout.
if [ "${#CMD}" -gt 24576 ]; then
  case "$CMD" in
    *merge*) deny "command too large to analyse (${#CMD} bytes > 24576) — run the merge alone" ;;
    *) : ;;  # no merge can be hiding where the WORD never appears; stay out of big non-merge commands' way
  esac
fi
if [ -z "$CMD" ]; then
  # Degraded path: the command text is invisible, so merge-absence cannot be
  # proven. A merge-looking payload GATES (the sibling hooks' polarity).
  case "$INPUT" in
    *"pr merge"*) CMD="gh pr merge" ;;
    *) allow ;;
  esac
fi

# FAST PATH — this hook self-gates on EVERY Bash call, so a command with no
# merge-like text must return instantly, before sourcing anything.
case "$CMD" in
  *merge*) : ;;
  *) allow ;;
esac

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-parse-lib.sh"
# The verdict-heading grammar is SHARED with scripts/audit_no_verdict_merges.sh
# and scripts/retro_metrics.sh: three copies of "the first line states the
# verdict" drifted apart, and the loosest of them decided merges. The sweep that
# produced the grammar — 229 merged PRs, 361 marker-bearing first lines, 7
# rejected, 3 of them ALLOW->DENY here — is in the library's header.
# $VERDICT_HEADING_LIB lets the mutation harness point a mutant copy at the real
# library instead of dying for the wrong reason.
VERDICT_HEADING_LIB="${VERDICT_HEADING_LIB:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../scripts" 2>/dev/null && pwd)/verdict-heading-lib.sh}"
[ -r "$VERDICT_HEADING_LIB" ] && . "$VERDICT_HEADING_LIB"
[ -n "${VERDICT_HEADING_JQ_DEFS:-}" ] \
  || deny "cannot read the verdict-heading grammar (${VERDICT_HEADING_LIB}) — refusing to merge unverified"
INSPECT_DEADLINE=$((START + PARSE_DEADLINE_SECONDS))

# Does this SEGMENT (separator-split, quote-aware) invoke `gh pr merge`?
# Reuses the SHARED peel model, so wrappers (`env X=1 gh …`, `sudo`, `timeout`),
# compound-command keywords (`do gh pr merge …` in a loop body), alias-suppressed
# spellings and leading assignments are handled exactly as the pre-push gate
# handles `git push` — and `gh pr merge` inside a quoted argument stays DATA
# (#204/#237).
# A quoted argument handed to bash -c / eval / ssh is a SCRIPT: split it like
# the shell would and ask each inner command. Depth-bounded, like the sibling.
PMG_INNER_DEPTH=0
inner_script_invokes_pr_merge() {
  local body="$1" line inner found=1 OLD="$IFS"
  [ "$PMG_INNER_DEPTH" -ge 3 ] && return 0        # cannot analyse further → gate
  PMG_INNER_DEPTH=$((PMG_INNER_DEPTH + 1))
  body="${body//$NL_SENTINEL/$'\n'}"
  while IFS= read -r line; do
    [ "$found" = 0 ] && break
    IFS=$'\n'
    for inner in $(quote_split "$line"); do
      if segment_invokes_pr_merge "$inner"; then found=0; break; fi
    done
    IFS="$OLD"
  done <<< "$body"
  IFS="$OLD"
  PMG_INNER_DEPTH=$((PMG_INNER_DEPTH - 1))
  return $found
}

segment_invokes_pr_merge() {
  local seg="$1"
  # DENY, not "treat as merge" — see the twin comment in the peel loop.
  [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] \
    && deny "command too large to analyse within budget — run the merge alone"
  seg="$(printf '%s' "$seg" | tr '\n\t' '  ' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g')"

  local changed=1 loops=0
  while [ "$changed" = "1" ] && [ "$loops" -lt 8 ]; do
    changed=0; loops=$((loops + 1))
    # DENY outright, not "treat as merge": returning 0 here sent an empty
    # operand into verification, which falls back to the CURRENT branch's PR —
    # a timeout could have allowed a merge by verifying the wrong PR (#291 r7).
    [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] \
      && deny "command too large to analyse within budget — run the merge alone"
    [ "${seg:0:1}" = '\' ] && { seg="${seg#\\}"; changed=1; }
    case "$seg" in
      "do "*|"then "*|"else "*|"elif "*|"{ "*|"( "*) seg="${seg#* }"; changed=1 ;;
    esac
    # The documented bypass lives HERE, not in the hook's own environment: a
    # caller types `PR_MERGE_GATE=0 gh pr merge 291`, so the token is part of
    # the command text and the strip below would eat it unread. Same regex and
    # same position as guard-destructive.sh:242 — one model, two hooks (#237).
    if printf '%s' "$seg" | grep -Eq '^([A-Za-z_][A-Za-z0-9_]*=[^ ]* )*PR_MERGE_GATE=0( |$)'; then
      # STASH, don't trace: the emit happens in allow(), never on a deny path,
      # and only for segments that really are `gh pr merge` (#399 review,
      # major 3 — the inline call here traced DENIED commands and commented
      # on PR numbers from non-merge segments like `git merge 42`).
      BYPASS_SEGS+=("$seg")
      return 1   # authorized: this segment is not gated
    fi
    while [[ "$seg" =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+ ]]; do
      seg="${seg#* }"; changed=1
    done
    if command -v peel_wrapper >/dev/null 2>&1; then
      PEEL_RESULT=""
      if peel_wrapper "$seg" && [ -n "${PEEL_RESULT:-}" ] && [ "$PEEL_RESULT" != "$seg" ]; then
        seg="$PEEL_RESULT"; changed=1
      fi
    fi
    # `xargs [opts] gh pr merge` — same one-pass strip as the siblings (#219).
    # The operand arrives on STDIN, so which PR this merges is unknowable here:
    # record that, and fail closed below rather than silently checking whichever
    # PR the current branch happens to have.
    if printf '%s' "$seg" | grep -Eq '^xargs( |$)'; then
      seg="$(printf '%s' "$seg" | sed -E 's/^xargs +//; s/^((-[^ ]+|\{\}|[A-Za-z]=) )*//')"
      MERGE_OPERAND_UNKNOWABLE=1
      changed=1
    fi
  done

  # `bash -c "…"` / `sh -lc '…'` / `eval …` / `ssh host "…"`: the argument is a
  # SCRIPT, and a merge inside it is a real merge. Same patterns the pre-push
  # gate uses (#291 review round 2 proved all four were open here).
  if printf '%s' "$seg" | grep -Eq '^(bash|sh|zsh|dash) +((-o [^ ]+|-[A-Za-z]+|--[A-Za-z-]+) +)*-[A-Za-z]*c[A-Za-z]* (-- +)?'; then
    seg="$(printf '%s' "$seg" | sed -E "s/^(bash|sh|zsh|dash) +((-o [^ ]+|-[A-Za-z]+|--[A-Za-z-]+) +)*-[A-Za-z]*c[A-Za-z]* +(-- +)?//; s/^\\\$?[\"']//; s/[\"']$//")"
    inner_script_invokes_pr_merge "$seg" && return 0
    return 1
  elif printf '%s' "$seg" | grep -Eq '^eval '; then
    seg="$(printf '%s' "$seg" | sed -E "s/^eval +//; s/^\\\$?[\"']//; s/[\"']$//")"
    inner_script_invokes_pr_merge "$seg" && return 0
    return 1
  elif printf '%s' "$seg" | grep -Eq '^ssh '; then
    # A merge on the remote end merges all the same. Inspect the WHOLE remainder
    # first — protection independent of getting ssh's option grammar right —
    # then walk options and the host off the front so a bare
    # `ssh box gh pr merge N` is seen as the command it is. Handing the raw
    # remainder to the recursion was DEAD CODE: its command word was the host.
    local sshrest="${seg#ssh }" sshflag
    inner_script_invokes_pr_merge "$sshrest" && return 0
    while [ "${sshrest:0:1}" = "-" ]; do
      sshflag="${sshrest%% *}"
      [ "$sshflag" = "$sshrest" ] && break
      sshrest="${sshrest#* }"
      case "$sshflag" in
        # A value-taking letter LAST in a cluster still consumes the next word:
        # `-tp 22` is `-t -p 22`. Matching only `-p` missed `-tp` and read the
        # port as the host.
        -*[bcDEeFIiJLlmOopQRSWw]) sshrest="${sshrest#* }" ;;
      esac
    done
    sshrest="${sshrest#* }"                                    # drop [user@]host
    sshrest="$(printf '%s' "$sshrest" | sed -E "s/^\\\$?[\"']//; s/[\"']$//")"
    inner_script_invokes_pr_merge "$sshrest" && return 0
    return 1
  fi

  # Command word must be `gh`, then the subcommand pair `pr merge` — with gh's
  # value-taking globals consumed in between, so `gh --repo x pr merge 1` is
  # caught exactly like `gh pr merge 1 --repo x`.
  # IFS is $'\n' in the caller's loop, so a bare `set -- $seg` would NOT split
  # on spaces and the whole segment would arrive as one positional parameter —
  # every wrapper and compound case then reads as "not a merge" and the gate
  # allows. Restore word splitting locally.
  # Cheap reject before the O(n) split: the deadline exists because cost is a
  # security property here (#219), and most segments are not merges.
  case "$seg" in *merge*) ;; *) return 1 ;; esac
  argv_split "$seg"
  # A quoted value with a NEWLINE arrives here cut at the line boundary, so the
  # operand after it is missing from this argv. Mark the target unknowable —
  # the deny below — instead of walking a truncated argv and falling back to
  # the current branch's PR (round 5's wrong-PR-allow, one line later).
  [ "${ARGV_SPLIT_UNTERMINATED:-0}" = "1" ] && MERGE_OPERAND_UNKNOWABLE=1
  [ "${#ARGV_SPLIT_RESULT[@]}" -eq 0 ] && return 1
  set -- "${ARGV_SPLIT_RESULT[@]}"
  [ "${1:-}" = "gh" ] || return 1
  shift || return 1
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo|-R|--hostname) shift; shift || return 1 ;;
      --repo=*|-R=*|--hostname=*|-*) shift ;;
      *) break ;;
    esac
  done
  [ "${1:-}" = "pr" ] || return 1
  shift
  [ "${1:-}" = "merge" ] || return 1
  shift
  # The operand may sit after flags (`gh pr merge --squash 291`) or be absent
  # (merge the current branch's PR). Walk the rest the same way, consuming
  # value-taking merge flags, and keep the FIRST bare operand.
  MERGE_OPERAND=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -b|--body|-t|--subject|-F|--body-file|-A|--author-email|-R|--repo|--match-head-commit) \
        shift; shift || break ;;
      -*) shift ;;
      *) MERGE_OPERAND="$1"; break ;;
    esac
  done
  return 0
}

MERGE_SEG=""
MERGE_OPERAND=""
MERGE_OPERAND_UNKNOWABLE=0
MERGE_OPERANDS=()
MERGE_UNKNOWABLE=()
OLD_IFS="$IFS"
IN_HEREDOC_DELIM=""
while IFS= read -r line; do
  # HEREDOC BODIES ARE DATA, NOT COMMANDS. A commit message, a PR body or a
  # review quoted through `git commit -F -`/`gh pr create --body-file` routinely
  # contains the literal text `gh pr merge` — and this gate blocked its own
  # commit that way before this branch existed. The shared lib already models
  # heredocs for exactly this reason (#212/#237); skip a body until its
  # delimiter.
  if [ -n "$IN_HEREDOC_DELIM" ]; then
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [ "$trimmed" = "$IN_HEREDOC_DELIM" ] && IN_HEREDOC_DELIM=""
    continue
  fi
  delim="$(heredoc_delim "$line" 2>/dev/null || true)"
  # ONLY a text-tool heredoc is data. `bash <<'EOF' … gh pr merge N … EOF` is a
  # script the shell EXECUTES, and skipping every heredoc body unconditionally
  # was a live bypass (#291 review round 2) — an earlier comment here argued a
  # merge inside one "is not reachable"; it was, and that rationale is deleted
  # rather than left as an invitation to revert this. `line_is_all_text_tools`
  # is the shared lib's answer to exactly this question (#204/#212): the body is
  # dropped only when every command on the opening line is a text tool.
  if [ -n "$delim" ] && line_is_all_text_tools "$line"; then
    IN_HEREDOC_DELIM="$delim"
  fi
  [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] \
    && deny "command too large to analyse within budget — run the merge alone"
  IFS=$'\n'
  for seg in $(quote_split "$line"); do
    # EVERY merge, not just the last. `gh pr merge 284 && gh pr merge 999`
    # previously kept only the second and let the first through unverified,
    # which contradicted this file's own "never an allow" promise (#291 r5).
    # Per-SEGMENT deadline too: one line can carry thousands of segments
    # (measured: 3000 took 39s, past the 30s hook cap — and a timed-out
    # PreToolUse hook does not deny, #219). Better a false deny on a monster
    # command than a silent timeout-allow.
    [ "$SECONDS" -ge "$INSPECT_DEADLINE" ] \
      && deny "command too large to analyse within budget — run the merge alone"
    MERGE_OPERAND_UNKNOWABLE=0   # per-segment: `ls | xargs rm` must not taint a later merge
    if segment_invokes_pr_merge "$seg"; then
      MERGE_SEG="$seg"
      MERGE_OPERANDS+=("$MERGE_OPERAND")
      MERGE_UNKNOWABLE+=("$MERGE_OPERAND_UNKNOWABLE")
      MERGE_OPERAND=""; MERGE_OPERAND_UNKNOWABLE=0
    fi
  done
  IFS="$OLD_IFS"
done <<< "$CMD"
IFS="$OLD_IFS"

[ -z "$MERGE_SEG" ] && allow

command -v gh >/dev/null 2>&1 || deny "gh is not on PATH, so the review verdict cannot be checked"
command -v jq >/dev/null 2>&1 || deny "jq is not on PATH, so the review verdict cannot be checked"

past_deadline() { [ $((SECONDS - START)) -ge "$DEADLINE_SECONDS" ]; }
past_deadline && deny "could not finish within ${DEADLINE_SECONDS}s — an unanalysed merge must not proceed"

# Which PR? `gh pr merge` with no argument merges the CURRENT BRANCH's PR — the
# most natural invocation, and previously an unconditional bypass. A URL form
# (`gh pr merge https://…/pull/291`) is normalised first.
# MERGE_OPERAND comes from the argv walk, so flags before the number are handled
# (`gh pr merge --squash 291` previously fell through and checked the CURRENT
# branch's PR — a live bypass found in review round 2). A URL operand is
# normalised to its number.
for MERGE_IDX in "${!MERGE_OPERANDS[@]}"; do
MERGE_OPERAND="${MERGE_OPERANDS[$MERGE_IDX]}"
MERGE_OPERAND_UNKNOWABLE="${MERGE_UNKNOWABLE[$MERGE_IDX]}"
[ "${MERGE_OPERAND_UNKNOWABLE:-0}" = "1" ] && deny "the PR this merges cannot be determined from the command (stdin operand, or a quoted value spanning lines) — run the merge alone with an explicit PR number"

# ONE normalisation path for the operand. Two overlapping blocks lived here
# briefly and the second silently rescued what the first dropped, which made the
# "operand ignored" mutation EQUIVALENT — it survived, and a survivor is a
# finding about the code, not a gap to paper over (§33). Strip the quotes once,
# then: a number, a pull URL, or a branch gh can resolve.
PR_NUM=""
if [ -n "${MERGE_OPERAND:-}" ]; then
  # No quote-stripping here: argv_split already removed them AT THE SPLIT,
  # which is the only place it is safe (a strip afterwards forged PR numbers).
  UNQUOTED="$MERGE_OPERAND"
  PR_NUM="$(printf '%s' "$UNQUOTED" \
    | sed -E 's#^https?://[^ ]*/pull/([0-9]+)/?$#\1#' \
    | grep -oE '^[0-9]+$' || true)"
  # `gh pr merge` also accepts a BRANCH; ask gh rather than guess at naming.
  # An unexpanded `$VAR` this hook cannot evaluate is left for the deny below.
  if [ -z "$PR_NUM" ] && [ "${UNQUOTED#*\$}" = "$UNQUOTED" ]; then
    PR_NUM="$(gh pr view "$UNQUOTED" --json number --jq '.number' 2>/dev/null | grep -oE '^[0-9]+$' || true)"
  fi
fi

# Still unreadable — e.g. a quoted flag value that word-split
# (`gh pr merge -b "squash msg" 291`), or an unexpanded `$PR` this hook cannot
# evaluate. Falling back to the current branch would verify a DIFFERENT PR and
# allow the merge (round-2 blocker 3 one level deeper), so refuse instead. The
# `PR_MERGE_GATE=0` prefix is a real escape now that it works.
if [ -n "${MERGE_OPERAND:-}" ] && [ -z "$PR_NUM" ]; then
  deny "could not resolve '${MERGE_OPERAND}' to a pull request — pass an explicit PR number, or prefix PR_MERGE_GATE=0 if this merge is already authorized"
fi
if [ -z "$PR_NUM" ]; then
  PR_NUM="$(gh pr view --json number --jq '.number' 2>/dev/null)"
  [ -z "$PR_NUM" ] && deny "could not determine which PR this merges (no number given, and no PR found for the current branch) — refusing to merge unverified"
fi

# --- Check 1: rule 13 — the LATEST verdict must be an approval --------------
# `gh pr review --approve` is blocked for a same-identity author, so the repo's
# sanctioned path is a COMMENT verdict whose body states APPROVE. Both streams
# count and the NEWEST wins, so a later REQUEST CHANGES overrides an approval.
PR_JSON="$(gh pr view "$PR_NUM" --json reviews,comments,body,commits,mergeable 2>/dev/null)" \
  || deny "could not read PR #$PR_NUM (network or auth) — refusing to merge unverified"
past_deadline && deny "could not finish within ${DEADLINE_SECONDS}s — an unanalysed merge must not proceed"

# NOTE the parenthesised streams. `|` binds looser than `,`, so without them the
# expression silently becomes `.reviews[] | (…, .comments[]) | …`: `at` is always
# null (sort_by a no-op, "newest wins" unimplemented) and comments are never
# read. That bug shipped once and made the gate deny the repo's own sanctioned
# APPROVE path while allowing a later REQUEST CHANGES.
# HEADING POSITION, not "anywhere in the body" (v1.13.0 retrospective). Measured
# on #291: two of that thread's marker-bearing comments are the AUTHOR's
# fix-reports ("## Round 4 — the three blockers, each measured against the
# unfixed hook", "## Round 7 — blocker and all four majors closed"), and the
# FIRST marker inside each is APPROVED / APPROVE. Under the old filter either one
# was "the newest verdict" the moment it was posted, so a merge attempted then
# would have been ALLOWED while the standing reviewer verdict was REQUEST
# CHANGES. In this repo the reviewer and the author post under the SAME identity,
# so author-vs-reviewer is not separable by author — the position of the marker
# separates those. What IS separable by author is trusted-vs-untrusted (#316):
# on a PUBLIC repo any passer-by can post an approval-shaped comment, so a
# verdict candidate must also carry a trusted authorAssociation (OWNER/MEMBER/
# COLLABORATOR); a missing or unknown association is untrusted, fail-closed.
#
# A verdict therefore states itself in its FIRST NON-EMPTY LINE. Decoration
# around it is fine (`## ⛔ REQUEST CHANGES`, `✅ **APPROVED** — round 2`,
# `## VERDICT: APPROVE (round 2)` all qualify); a marker buried in paragraph
# three does not. This is fail-CLOSED in both directions: a reviewer who forgets
# the heading gets "no posted review verdict" (deny), never a false allow.
# `.claude/agents/pr-reviewer.md` mandates the heading form.
#
# It closes a SECOND false-allow too, found by this change's own reviewer: #293's
# `## ⛔ REJECTED` body has no marker in its heading and exactly one anywhere —
# the prose "expect to approve immediately" (line 108) — which the old
# case-insensitive body-wide match read as the verdict and allowed on.
#
# THE RESIDUAL THIS SELECTION CARRIED IS CLOSED (v1.16.0 retrospective; it was
# "KNOWN RESIDUAL, deliberately unpinned", lessons §43). A fix report whose first
# line MENTIONS a marker was selected over the reviewer's verdict. The old note
# argued no lexical rule separates it from a real heading that puts prose before
# the marker (`## Round 3 — ✅ APPROVED`, `PR-REVIEWER VERDICT: APPROVE`);
# measurement refuted that — 361 marker-bearing first lines across 229 merged
# PRs, 354 accepted and 7 rejected — six of them author notes (correct), and one
# a REAL reviewer APPROVE the grammar rejects (#83's July blockquote verdict).
# That seventh is the over-strict failure mode, measured at 1 in 229: rejecting
# a genuine verdict BLOCKS a legitimate merge, which is worse than the
# permissiveness this replaces. It is named rather than averaged away because it
# is the only evidence we have for it. The selection below now uses
# the SHARED grammar in scripts/verdict-heading-lib.sh, which requires the first
# line to BEGIN with the marker; that file carries the measurement.
#
# It stopped being harmless before it was closed: on #458 the author's
# "Round-3 delta — … the round-3 APPROVE covered `70a8cfb4`; … it needs a
# delta-confirm rather than standing" satisfied check 1 (first marker reads
# APPROVE) AND check 1b (posted after the last commit) — a sentence asking for a
# verdict, read as the verdict, for the fourteen minutes before the real one.
#
# Note what the old REVISIT TRIGGER got wrong, because the shape recurs: it said
# "revisit on the first fix report posted while the standing verdict is
# NEGATIVE", which is check 1's failure mode. Check 1b was added to the SAME
# selection one release later (v1.14.0), and against check 1b the dangerous standing
# verdict is a POSITIVE one that no longer covers the head — so the trigger
# could not fire on the case that mattered. A revisit trigger written for one
# consumer of a shared selection does not migrate when a second consumer joins:
# prefer a case that fails to a condition someone has to remember.
SELECTED="$(printf '%s' "$PR_JSON" | jq -c "$VERDICT_HEADING_JQ_DEFS"'
  [ ((.reviews // [])[]  | {at: .submittedAt, body: (.body // ""), assoc: (.authorAssociation // "NONE")}),
    ((.comments // [])[] | {at: .createdAt,   body: (.body // ""), assoc: (.authorAssociation // "NONE")}) ]
  | map(select(.at != null
      and (.assoc == "OWNER" or .assoc == "MEMBER" or .assoc == "COLLABORATOR")
      and (vh_heading | vh_is_verdict)))
  | sort_by(.at) | (last // {at: null, body: ""})' 2>/dev/null)"
VERDICT="$(printf '%s' "$SELECTED" | jq -r '.body // ""' 2>/dev/null)"
# The same selection's TIMESTAMP — check 1b below asks what landed after it.
# Derived from the SAME object rather than a second copy of the filter, because
# two filters that must stay in sync are the duplication §19 is about.
VERDICT_AT="$(printf '%s' "$SELECTED" | jq -r '.at // ""' 2>/dev/null)"

# MESSAGE-ONLY, and deliberately so (#291 review round 2, the #240 answer). An
# empty verdict also yields an empty FIRST_MARKER, so the APPROVE check below
# denies anyway — the two are behaviourally equivalent for every input the jq
# filter admits, and no test can distinguish them. This line exists because
# "no posted review verdict" tells the author what to DO, where "does not state
# APPROVE" would not. It is therefore NOT in the mutation contract: writing a
# case that cannot fail is worse than documenting the equivalence.
[ -z "$VERDICT" ] && deny "PR #$PR_NUM has no posted review verdict whose FIRST LINE states APPROVE or REQUEST CHANGES — rule 13 requires an independent pr-reviewer verdict, and the gate reads the heading (see .claude/agents/pr-reviewer.md)"

# The verdict is the first marker IN THE HEADING (the first non-empty line). A
# body that approves and then quotes the round it supersedes ("the REQUEST
# CHANGES findings are fixed") must not flip to deny; review threads do this
# routinely, including the one that found this. A fixed head -N window got it
# wrong whenever the quote landed inside the window; reading the heading only is
# the same fix as the selection filter above, applied to the decision.
HEADING="$(printf '%s' "$VERDICT" | grep -m1 '[^[:space:]]')"
FIRST_MARKER="$(printf '%s' "$HEADING" | grep -oiE 'REQUEST CHANGES|APPROVED?' | head -1)"

# ONE check is load-bearing here: the APPROVE requirement below. The two denies
# that precede it (empty verdict, explicit REQUEST CHANGES) are MESSAGE-ONLY —
# an empty verdict yields an empty marker, and a REQUEST-CHANGES marker fails
# the APPROVE test, so deleting either changes no decision for any input the jq
# filter admits. Both were mutation-tested and SURVIVED; rather than dress that
# up with cases that cannot fail, the equivalence is documented here (the #240
# answer, applied to my own gate). They earn their place by telling the author
# what to DO — "no posted review verdict" and "fix the findings in this PR
# first" are actionable where "does not state APPROVE" is not.
if printf '%s' "$FIRST_MARKER" | grep -qiE 'REQUEST CHANGES'; then
  deny "PR #$PR_NUM's latest verdict is REQUEST CHANGES — fix the findings in this PR first (rule 11)"
fi
printf '%s' "$FIRST_MARKER" | grep -qiE 'APPROVE' \
  || deny "PR #$PR_NUM's latest verdict does not state APPROVE (rule 13)"

# --- Check 1b: the approval must COVER the head (v1.14.0 retrospective) ------
# Rule 13 asks for a verdict on the CHANGE, not for a verdict at some point in
# the PR's history. Check 1 above only asked "is the newest verdict an APPROVE",
# which is satisfied by an approval of a head that no longer exists.
#
# MEASURED IN v1.14.0 — FOUR of the ten REVIEWED merges (an 11-PR corpus; #321
# merged with no verdict at all) carried commits no approval had seen, and one of
# them was not close:
#   #320  approved 06:57:04Z on b91f908; then 0537a86 (five review findings),
#         54158e8 (merge of main), e6373a4 ("banner links to the repository, not
#         the maintainer's site" — a behaviour change) and 8290bca landed, and it
#         merged 07:43:35Z with no second verdict. The reviewer never saw the
#         fixes to their OWN findings.
#   #315  approved 13:40:54Z; the six-finding fix commit 2a7c1a0 landed 13:45:03Z;
#         merged 14:03:18Z — TWO SECONDS before the delta-confirm was posted.
#   #314  approved 14:00:11Z; be1ffc2 (merge of main + a lesson renumber) landed
#         14:12:38Z; merged 14:17:58Z.
#   #327  the RELEASE PR: approved 12:09:07Z; 882ddae landed 12:10:52Z; merged
#         12:25:17Z — so the v1.14.0 tag sits on a commit no verdict covers.
# "Merge of main" is not a benign case: #325's Alembic head fork was created by
# exactly that, and cost a production-boot blocker one review round later.
#
# The remedy is cheap and the repo already has the habit — #315's reviewer posted
# "## ✅ APPROVE — round 2 (delta-confirm at 2a7c1a0)". This check makes the habit
# the rule.
#
# KNOWN LIMIT, stated rather than implied: `committedDate` is set when the commit
# is CREATED, not when it is pushed, so a commit authored before the verdict and
# pushed after it is invisible here — and a badly skewed committer clock could
# hide one. GitHub exposes no push time on `gh pr view`, and no reviewer-side
# commit oid at all for the COMMENT verdicts this repo's same-identity constraint
# forces. This closes the shape that actually happened three times; it is not a
# proof of coverage.
if [ -n "$VERDICT_AT" ]; then
  NEWER="$(printf '%s' "$PR_JSON" | jq -r --arg at "$VERDICT_AT" '
    [ (.commits // [])[] | select(((.committedDate // "") > $at)) ]
    | map(((.oid // "???????")[0:7]) + " " + ((.messageHeadline // "") | .[0:52]))
    | .[]' 2>/dev/null)"
  if [ -n "$NEWER" ]; then
    NEWER_N="$(printf '%s\n' "$NEWER" | grep -c '.')"
    NEWER_LIST="$(printf '%s\n' "$NEWER" | head -3 | paste -sd '; ' - 2>/dev/null || printf '%s' "$NEWER")"
    deny "PR #$PR_NUM's APPROVE was posted at $VERDICT_AT, but $NEWER_N commit(s) landed after it ($NEWER_LIST) — the approval does not cover the head. Ask pr-reviewer for a delta-confirm verdict on the current head (rule 13), or prefix PR_MERGE_GATE=0 if this merge is already authorized"
  fi
fi

# --- Check 1c: the approval must cover the MERGED RESULT, not just the branch -
# The check above asks whether commits landed on the PR after the verdict. It is
# blind to the other way a reviewed state goes stale: `main` moving underneath.
# An APPROVE at head X, then someone else's merge to `main`, leaves the PR
# BEHIND with no new commit of its own — check 1b sees nothing, and the stale
# APPROVE merges a branch nobody reviewed against the base it will land on.
# That is how #325's Alembic head fork appeared (v1.14.0 retro) and how five
# stale-base blockers reached review in v1.14.1: a branch green in isolation is
# not green merged. `mergeable: CONFLICTING` is the cheap, mechanical signal —
# GitHub computes it against the CURRENT base, so it needs no local clone.
MERGEABLE="$(printf '%s' "$PR_JSON" | jq -r '.mergeable // ""' 2>/dev/null)"
if [ "$MERGEABLE" = "CONFLICTING" ]; then
  deny "PR #$PR_NUM conflicts with its base — the approval covers a branch that cannot merge as-is. Rebase onto origin/main, re-run the gates on the RESULT, and get a delta-confirm verdict (rule 13); prefix PR_MERGE_GATE=0 if this merge is already authorized"
fi

# --- Check 2: `Closes #NN` must not point at unticked criteria ---------------
BODY="$(printf '%s' "$PR_JSON" | jq -r '.body // ""')"
CLOSES="$(printf '%s' "$BODY" | grep -oiE '(closes|fixes|resolves)[[:space:]]+#[0-9]+' | grep -oE '[0-9]+' | sort -u)"

for issue in $CLOSES; do
  past_deadline && deny "could not finish within ${DEADLINE_SECONDS}s — an unanalysed merge must not proceed"
  # FAIL CLOSED: an unreadable issue is not evidence that its criteria are met.
  IBODY="$(gh issue view "$issue" --json body --jq '.body // ""' 2>/dev/null)" \
    || deny "PR #$PR_NUM says it closes #$issue but that issue could not be read — refusing to close an issue whose criteria are unverified"
  # Heading match is `#`-anchored and tolerates all-caps; a **bold** pseudo-heading
  # is NOT matched (measured) — the issue template always uses a real heading.
  # BWK-awk portable: no IGNORECASE (macOS ships BWK awk).
  UNCHECKED="$(printf '%s' "$IBODY" \
    | awk '/^#+.*([Aa]cceptance|ACCEPTANCE).*([Cc]riteria|CRITERIA)/{f=1;next} f&&/^#+ /{f=0} f' \
    | grep -cE '^[[:space:]]*[-*][[:space:]]*\[[[:space:]]\]' || true)"
  if [ "${UNCHECKED:-0}" -gt 0 ]; then
    deny "PR #$PR_NUM says it closes #$issue, but #$issue has $UNCHECKED unticked acceptance criteria — use 'Refs #$issue' and name the unmet criterion, or tick them with what you ran"
  fi
done

done   # every merge in this command has now been verified

exit 0
