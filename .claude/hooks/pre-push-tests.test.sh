#!/usr/bin/env bash
# Self-test for pre-push-tests.sh's SELF-GATE (issue #237) and its
# DIFF→LEG SELECTION (issue #377).
# Run: bash pre-push-tests.test.sh [--mutations]
#      exits non-zero if any case regresses.
#
# PART 2 (#377) starts at "LEG SELECTION" below. It pins both directions of the
# scoping change, because narrowing a gate is the exact shape of change that
# silently turns it off (lessons §18/§46/§59):
#   - RELEVANCE: a backend diff still selects backend+lint, a public diff still
#     selects public, a shared diff still selects all three, a hook-parse-lib
#     diff still selects all four hook self-tests;
#   - NARROWNESS: a docs diff selects docs+pii and NOTHING else, a backend diff
#     selects no frontend project, a public diff selects no admin;
#   - FAIL-CLOSED: an unmapped path, an empty diff, an unobtainable range, an
#     unnameable branch and PREPUSH_FULL=1 all select ALL. Protected branches
#     scope to their delta since v1.14.2 (owner directive 2026-09-14: push cost
#     must track the diff — CI runs every leg on every main push regardless).
# `--mutations` then proves those cases CAN go red: it neuters one selection
# rule at a time (including "select nothing at all") and requires this file to
# fail for each. A selector that silently selects nothing would otherwise pass
# every case above.
#
# Each case feeds a PreToolUse-shaped JSON on stdin with PREPUSH_DRY_RUN=1, so
# the hook prints its self-gate decision — GATE (a real push: run the check
# round) or ALLOW (not a push: pass through instantly) — WITHOUT running any
# suite. Both directions of #237 are pinned:
#   - a real push GATES, including inside loops / compounds / wrappers /
#     shell -c bodies (the observed false-negative);
#   - quoted PROSE mentioning a push ALLOWS — PR-review bodies, commit
#     messages, heredoc documents (the #204 false-positive class).
#
# The push phrase is assembled from parts (P below, §21.8 of lessons-learned)
# so this file's own text never contains it contiguously — the OLD substring
# matcher would otherwise gate on any tool-call that touches this file.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# HOOK is overridable so the mutation harness can point every case at a mutated
# COPY of the hooks directory (the hook sources its libs from its own dirname,
# so the whole directory travels together).
HOOK="${HOOK:-$HERE/pre-push-tests.sh}"
HOOKDIR="$(cd "$(dirname "$HOOK")" && pwd)"
SELECT_LIB="$HOOKDIR/prepush-select-lib.sh"
fails=0
MUTATIONS=0
[ "${1-}" = "--mutations" ] && MUTATIONS=1
# Mutant re-runs execute only the SELECTION half. Every mutation below edits a
# selection rule, so the #237 self-gate cases add ~2.5s per mutant and can kill
# nothing — skipping them roughly halves the mutation phase. The identity
# control runs under the same restriction, so it still proves the harness.
SELECTION_ONLY="${PREPUSH_TEST_SELECTION_ONLY:-0}"

P="git pu""sh"          # "git <push>" — assembled so it never appears verbatim
PU="pu""sh"             # the bare subcommand

check() { # desc cmd expect(GATE|ALLOW)
  local desc="$1" cmd="$2" expect="$3" out
  out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
        | PREPUSH_DRY_RUN=1 bash "$HOOK")"
  if [ "$out" = "$expect" ]; then
    printf 'PASS  [%s]  %s\n' "$out" "$desc"
  else
    printf 'FAIL  got=%s want=%s  %s\n' "$out" "$expect" "$desc"
    fails=$((fails + 1))
  fi
}

# Wall-clock assertion: the hook self-gates on EVERY Bash call, so the
# non-candidate path must stay near-instant (no parsing, no forks) and even
# candidates must decide well inside the harness timeout.
check_fast() { # desc cmd max_seconds
  local desc="$1" cmd="$2" max="$3" t0 t1 el
  t0=$(date +%s)
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
    | PREPUSH_DRY_RUN=1 bash "$HOOK" >/dev/null
  t1=$(date +%s); el=$((t1 - t0))
  if [ "$el" -le "$max" ]; then
    printf 'PASS  [%ss<=%ss]  %s\n' "$el" "$max" "$desc"
  else
    printf 'FAIL  took=%ss max=%ss  %s\n' "$el" "$max" "$desc"
    fails=$((fails + 1))
  fi
}

# Like check(), but NEVER stubbed under SELECTION_ONLY: the push-rides-alone
# mutations (#406) edit the HOOK, so their kill cases must run on every mutant.
# Kept to a handful of cases — each costs one hook invocation per mutant.
chain_check() { # desc cmd expect(DENY|GATE|ALLOW)
  local desc="$1" cmd="$2" expect="$3" out
  out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
        | PREPUSH_DRY_RUN=1 bash "$HOOK")"
  if [ "$out" = "$expect" ]; then
    printf 'PASS  [%s]  %s\n' "$out" "$desc"
  else
    printf 'FAIL  got=%s want=%s  %s\n' "$out" "$expect" "$desc"
    fails=$((fails + 1))
  fi
}

if [ "$SELECTION_ONLY" = "1" ]; then
  check()      { :; }
  check_fast() { :; }
  raw_check()  { :; }
fi

# --- direction 1: a REAL push must GATE -------------------------------------
check "bare push"                    "$P origin main"                          GATE
check "push, no args"                "$P"                                      GATE
check "push with flags"              "$P --force-with-lease origin HEAD"       GATE
check "git -C dir push"              "git -C /some/worktree $PU origin main"   GATE
check "git -c val push"              "git -c push.default=current $PU"         GATE
check "push after cd &&"             "cd frontend && $P origin HEAD"           GATE
check "push at end of && chain"      "git add -A && $P"                        GATE
check "push after semicolon"         "git fetch origin; $P origin HEAD"        GATE
check "push in for-loop body"        "for b in a b; do $P origin \$b; done"    GATE
check "push in while-loop body"      "while true; do $P; done"                 GATE
check "backgrounded compound loop"   "(for b in x; do $P origin \$b; done) &"  GATE
check "push in if-condition"         "if $P; then echo ok; fi"                 GATE
check "sudo push"                    "sudo $P origin main"                     GATE
check "env wrapper push"             "env GIT_TRACE=1 $P"                      GATE
check "timeout wrapper push"         "timeout 600 $P origin main"              GATE
check "env-assignment prefix push"   "GIT_SSH_COMMAND=ssh $P origin main"      GATE
check "alias-suppressed push"        "\\$P origin main"                        GATE
check "bash -c push"                 "bash -c \"$P origin main\""              GATE
check "sh -lc push"                  "sh -lc '$P origin main'"                 GATE
check "eval push"                    "eval \"$P origin main\""                 GATE
check "ssh remote push"              "ssh host \"cd /srv/repo && $P\""         GATE
check "xargs push"                   "echo origin | xargs $P"                  GATE
check "heredoc fed to bash"          "bash <<'EOF'
$P origin main
EOF"                                                                           GATE
check "push on 2nd line of script"   "git add -A
$P origin main"                                                                GATE

# --- direction 2: PROSE mentioning a push must ALLOW ------------------------
check "pr comment quoting push"      "gh pr comment 1 --body \"run $P origin main afterwards\""  ALLOW
check "review body, multiline quote" "gh pr review 211 --approve --body \"looks good
$P origin main
ship it\""                                                                     ALLOW
check "quoted line STARTS with push" "gh pr comment 1 --body \"$P origin main is the deploy trigger\"" ALLOW
check "issue comment quoting push"   "gh issue comment 9 --body \"the fix: $P --force-with-lease\""    ALLOW
check "heredoc prose quoting push"   "cat > /tmp/review.md <<'EOF'
Then run: $P origin main
EOF"                                                                           ALLOW
check "heredoc line IS the phrase"   "cat > notes.md <<'EOF'
$P origin main
EOF"                                                                           ALLOW
check "heredoc body-file combo"      "cat > /tmp/b.md <<'EOF'
quoting $P here for the record
EOF
gh pr comment 5 --body-file /tmp/b.md"                                         ALLOW
check "echo quoted push"             "echo \"$P\""                             ALLOW
check "echo unquoted push words"     "echo $P origin main"                     ALLOW
check "printf quoting push"          "printf '%s' 'about $P origin'"           ALLOW
check "commit msg mentions push"     "git commit -m \"then $P\""               ALLOW
check "commit msg IS the phrase"     "git commit -m \"$P origin main\""        ALLOW
check "commit prose then status"     "git commit -m \"docs: how to $P\" && git status" ALLOW
check "grep for the phrase"          "grep -rn \"$P\" docs/"                   ALLOW
check "git log --grep push"          "git log --grep=\"$P --force\""           ALLOW
check "push substring, no push cmd"  "npm run build && echo pushed to registry" ALLOW
check "git pull is not push"         "git pull origin main"                    ALLOW
check "plain command, no push text"  "ls -la"                                  ALLOW
check "body-file, no push text"      "gh pr review 211 --body-file /tmp/review.md" ALLOW

# --- both directions at once ------------------------------------------------
check "prose AND a real push"        "echo \"then $P\" && $P origin HEAD"      GATE

# --- direction 3: a push CHAINED after a HEAD-mover must DENY (#406) --------
# The hook fires BEFORE the command body executes, so `git commit … && git
# push` is vetted against the PRE-COMMIT HEAD — the gate certifies a commit it
# never saw (measured 2026-09-14: an empty diff read as trivially green and a
# broken CHANGELOG went red in CI instead). These cases pin the structural
# deny; chain_check (never stubbed) so the mutation contract can kill it.
chain_check "chained commit + push"        "git add -A && git commit -m \"x\" && $P"      DENY
chain_check "commit; push via semicolon"   "git commit -m \"done\"; $P origin HEAD"       DENY
chain_check "checkout -b then push"        "git checkout -b topic && $P origin topic"     DENY
chain_check "merge then push"              "git merge --ff-only origin/main && $P"        DENY
chain_check "commit prose AND real chain"  "git commit -m \"then $P\" && $P origin HEAD"  DENY
chain_check "fetch then push (HEAD fixed)" "git fetch origin && $P origin b"              GATE
chain_check "plain push, no chain"         "$P origin main"                               GATE
chain_check "quoted prose chain is data"   "gh pr comment 1 --body \"run git commit -m x && $P\"" ALLOW
# round-2 minors: the deny is ORDER-AWARE (a head-mover AFTER the push cannot
# mis-vet it — the pushed HEAD was already examined) and unquoted-heredoc PROSE
# must not escalate a GATE to a hard DENY (strip_text_heredocs keeps those
# bodies inspected by design; the deny uses strip_all_heredoc_bodies instead).
chain_check "push THEN amend (order-aware)" "$P origin b && git commit --amend --no-edit" GATE
chain_check "push THEN pull (order-aware)"  "$P origin b; git pull origin main"           GATE
# round-3 major: order-awareness is per PUSH, not first-push-wins — the SECOND
# push here follows the amend and ships a HEAD the gate never examined (the
# 9303b40 incident shape verbatim).
chain_check "push, amend, push --force"     "$P origin b && git commit --amend --no-edit && $P --force-with-lease origin b" DENY
chain_check "unquoted-heredoc prose + push" "cat > notes.md <<EOF
git commit -m draft
EOF
$P origin main"                                                                           GATE

# round-2 major: an oversized command must stay GATE — a hard DENY must never
# issue from a parse the size bound already declared untrusted (the reviewer
# measured a 24716-char commit-prose command with NO push in it being denied).
# Bespoke case because it needs PREPUSH_MAX_CMD_LEN; live under SELECTION_ONLY
# so its mutation can be killed.
# commit-prose THEN a push, so the only thing standing between the oversized
# parse and a DENY is the size guard itself (the per-push order rule would
# otherwise absolve a command with no push after the mover).
big_prose="git commit -m '$(printf 'about the %s %.0s' "$PU" $(seq 1 40))'; $P origin main"
out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$big_prose" '$c')" \
      | PREPUSH_DRY_RUN=1 PREPUSH_MAX_CMD_LEN=50 bash "$HOOK")"
if [ "$out" = "GATE" ]; then
  printf 'PASS  [GATE]  oversized commit-prose command stays GATE (chain deny stands down)\n'
else
  printf 'FAIL  got=%s want=GATE  oversized commit-prose command must stay GATE\n' "$out"
  fails=$((fails + 1))
fi

# --- degraded path: unparseable payload (no .tool_input.command) ------------
# Without a command field the real text is invisible; push-looking payloads
# keep the old conservative substring behaviour (GATE), others pass.
raw_check() { # desc raw_stdin expect
  local desc="$1" raw="$2" expect="$3" out
  out="$(printf '%s' "$raw" | PREPUSH_DRY_RUN=1 bash "$HOOK")"
  if [ "$out" = "$expect" ]; then
    printf 'PASS  [%s]  %s\n' "$out" "$desc"
  else
    printf 'FAIL  got=%s want=%s  %s\n' "$out" "$expect" "$desc"
    fails=$((fails + 1))
  fi
}
[ "$SELECTION_ONLY" = "1" ] && raw_check() { :; }
raw_check "degraded: raw push text"  "not json but $P is in here"              GATE
raw_check "degraded: raw, no push"   "not json, nothing push-shaped beyond the word pushkin" ALLOW

# --- bounds: too big to analyse must GATE, never fast-allow -----------------
if [ "$SELECTION_ONLY" != "1" ]; then
big="gh pr comment 1 --body \"$(printf 'prose %.0s' $(seq 1 40)) $P quoted\""
out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$big" '$c')" \
      | PREPUSH_DRY_RUN=1 PREPUSH_MAX_CMD_LEN=50 bash "$HOOK")"
if [ "$out" = "GATE" ]; then
  printf 'PASS  [GATE]  size bound exceeded gates (conservative polarity)\n'
else
  printf 'FAIL  got=%s want=GATE  size bound exceeded gates\n' "$out"
  fails=$((fails + 1))
fi

# --- hook-JSON contract (no dry run) ----------------------------------------
# Not-a-push emits the allow decision JSON…
out="$(printf '{"tool_input":{"command":"ls -la"}}' | bash "$HOOK")"
dec="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')"
if [ "$dec" = "allow" ]; then
  printf 'PASS  [allow]  JSON contract: non-push fast path\n'
else
  printf 'FAIL  got=%s want=allow  JSON contract: non-push fast path\n     -> %s\n' "$dec" "$out"
  fails=$((fails + 1))
fi
# …and a REAL push reaches the check round: with every leg switched off the
# round trivially passes and the allow JSON is emitted end-to-end.
out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$P origin main" '$c')" \
      | PREPUSH_CHECK_DOCS=0 PREPUSH_RUN_GUARDTEST=0 PREPUSH_RUN_BACKEND=0 \
        PREPUSH_RUN_LINT=0 PREPUSH_RUN_FRONTEND=0 PREPUSH_LOG=/tmp/prepush-selftest.log \
        bash "$HOOK")"
dec="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')"
if [ "$dec" = "allow" ]; then
  printf 'PASS  [allow]  JSON contract: gated push runs the (emptied) round\n'
else
  printf 'FAIL  got=%s want=allow  JSON contract: gated push runs the round\n     -> %s\n' "$dec" "$out"
  fails=$((fails + 1))
fi

# --- cost: the self-gate runs on EVERY Bash call ----------------------------
check_fast "cost: non-candidate is instant"  "npm run test:coverage"           2
bulk="$(printf 'echo prose line %.0s' $(seq 1 300))"
check_fast "cost: 5KB non-candidate"         "$bulk"                          2
check_fast "cost: 4KB prose candidate"       "gh pr comment 1 --body \"$(printf 'words %.0s' $(seq 1 500)) $P quoted\"" 8
fi   # SELECTION_ONLY

# ===========================================================================
# LEG SELECTION (#377) — which legs does a given diff select?
# ===========================================================================
# Two layers, deliberately:
#   (a) UNIT — source the selector and drive prepush_select_legs directly. Fast,
#       and it pins the mapping table itself.
#   (b) INTEGRATION — build a REAL throwaway git repository, commit the files,
#       and run the hook end-to-end with PREPUSH_PRINT_LEGS=1 so the git range
#       resolution (@{push} → @{upstream} → merge-base) is exercised too, not
#       mocked. Assert the control at the seam (lessons §49): a unit test of the
#       map alone would pass even if the hook never called it.
# shellcheck source=/dev/null
. "$SELECT_LIB"

norm() { printf '%s' "$1" | tr -s ' ' | sed -E 's/^ +//; s/ +$//'; }

sel() { # sel <desc> <expected legs, space separated & sorted> <path...>
  local desc="$1" want="$2"; shift 2
  local got
  got="$(norm "$(printf '%s\n' "$@" | prepush_select_legs)")"
  if [ "$got" = "$want" ]; then
    printf 'PASS  [%s]  select: %s\n' "$got" "$desc"
  else
    printf 'FAIL  got="%s" want="%s"  select: %s\n' "$got" "$want" "$desc"
    fails=$((fails + 1))
  fi
}

sel_lacks() { # sel_lacks <desc> <leg that must NOT appear> <path...>
  local desc="$1" forbidden="$2"; shift 2
  local got
  got=" $(norm "$(printf '%s\n' "$@" | prepush_select_legs)") "
  case "$got" in
    *" ALL "*|*" $forbidden "*)
      printf 'FAIL  got="%s" must not contain "%s"  select: %s\n' "$got" "$forbidden" "$desc"
      fails=$((fails + 1)) ;;
    *) printf 'PASS  [no %s]  select: %s\n' "$forbidden" "$desc" ;;
  esac
}

# --- (a) the mapping table ---------------------------------------------------
sel "docs-only diff selects docs + pii and NOTHING else" \
    "docs pii" docs/wiki/x.md docs/notes.md
sel "CHANGELOG.md selects the merged-changelog lint ON TOP of docs (#391)" \
    "changelog docs pii" CHANGELOG.md
sel "backend code selects backend + lint (+ pii)" \
    "backend lint pii" backend/app/api/blog.py
sel_lacks "backend diff selects NO frontend project" "fe:public" backend/app/api/blog.py
sel_lacks "backend diff selects NO shared project" "fe:shared" backend/app/api/blog.py
sel "backend migration also selects the single-head lint" \
    "backend lint migrations pii" backend/migrations/versions/abc_add_col.py
sel "frontend public selects public only" \
    "fe:cdsafety fe:public pii" frontend/projects/public/src/app/blog/blog.ts
sel_lacks "a projects/public change does NOT select admin" "fe:admin" \
    frontend/projects/public/src/app/blog/blog.ts
sel_lacks "a projects/public change does NOT select shared" "fe:shared" \
    frontend/projects/public/src/app/blog/blog.ts
sel_lacks "a projects/public change does NOT select backend" "backend" \
    frontend/projects/public/src/app/blog/blog.ts
sel "frontend admin selects admin only" \
    "fe:admin fe:cdsafety pii" frontend/projects/admin/src/app/login/login.ts
sel_lacks "a projects/admin change does NOT select public" "fe:public" \
    frontend/projects/admin/src/app/login/login.ts
sel "shared fans out to ALL THREE projects (both apps consume it)" \
    "fe:admin fe:cdsafety fe:public fe:shared pii" frontend/projects/shared/src/lib/api.service.ts
sel "a frontend workspace file runs every project" \
    "fe:admin fe:cdsafety fe:public fe:shared pii" frontend/angular.json
sel "the eslint config selects only the eslint leg (#234)" \
    "fe:cdsafety pii" frontend/eslint.config.mjs
sel_lacks "an eslint-config change does NOT run the Vitest projects" "fe:public" \
    frontend/eslint.config.mjs
sel "the cd-safety mutation self-test selects only the eslint leg (#234)" \
    "fe:cdsafety pii" frontend/scripts/eslint-cd-safety.test.mjs
sel "compose + .env.example select the documented-knob contract" \
    "compose docs pii" docker-compose.prod.yml .env.example
sel "the shared-edge files select the edge apply contract and NOTHING heavier (#338)" \
    "edge pii" infra/edge/apply.sh infra/edge/Caddyfile
sel "the edge self-test selects its own leg (#338)" \
    "edge pii" infra/edge/apply.test.sh
sel_lacks "an edge diff does NOT select backend" "backend" infra/edge/apply.sh
sel_lacks "an edge diff does NOT select a Vitest project" "fe:public" infra/edge/apply.sh
# A lint script selects its own leg AND `aiconfig` (#388 review, minor): the
# selector is pure and cannot tell an EDIT from a DELETION, and a deleted lint
# leaves the AI-config map naming a file that no longer exists — precisely what
# check_aiconfig_map.sh fails on. A rename is already safe (the new path is
# unmapped ⇒ ALL); a pure deletion has no new path to notice.
sel "a script's self-test is selected by that script, plus the map check" \
    "aiconfig compose pii" scripts/check_compose_env.sh
sel "the PII checker itself selects the pii leg, plus the map check" \
    "aiconfig pii" scripts/check_no_pii.test.sh
sel "the CHANGELOG history-rewriter selects its own self-test, plus the map check" \
    "aiconfig dedup pii" scripts/dedup_changelog_unreleased.py
sel "the merged-changelog lint selects its own leg, plus the map check (#391)" \
    "aiconfig changelog pii" scripts/check_changelog_merge.sh
sel "the no-verdict auditor selects its own leg, plus the map check (#392)" \
    "aiconfig pii vaudit" scripts/audit_no_verdict_merges.sh
sel "one hook selects ONLY that hook's self-test" \
    "aiconfig hook:pre-merge-gate pii" .claude/hooks/pre-merge-gate.sh
sel "a hook's self-test selects the same hook" \
    "aiconfig hook:guard-destructive pii" .claude/hooks/guard-destructive.test.sh
sel "hook-parse-lib selects ALL FOUR hook self-tests (shared model, #237)" \
    "aiconfig hook:guard-destructive hook:guard-stack-resources hook:pre-merge-gate hook:pre-push-tests pii" \
    .claude/hooks/hook-parse-lib.sh
sel "a skill/agent edit selects the AI-config drift check" \
    "aiconfig pii" .claude/skills/lessons-learned/SKILL.md
sel "CLAUDE.md selects the drift check AND docs" "aiconfig docs pii" CLAUDE.md
sel "VERSION selects the version-consistency (docs) leg" "docs pii" VERSION
sel "setup.sh selects its own self-test (and the knob contract it promises)" \
    "compose pii setup" setup.sh
sel "a mixed diff unions the legs of its parts" \
    "backend changelog docs fe:cdsafety fe:public lint pii" \
    backend/app/main.py frontend/projects/public/src/main.ts CHANGELOG.md

# --- cross-cutting contracts: a file can feed a lint from OUTSIDE its dir ----
# These are the subtle holes a per-directory map leaves. Each one is a real
# invariant that a "just backend"/"just compose" change can break.
sel "backend/app/main.py is a VERSION CARRIER, so it also runs version consistency" \
    "backend docs lint pii" backend/app/main.py
sel "frontend version.ts is a VERSION CARRIER" \
    "docs fe:cdsafety fe:public pii" frontend/projects/public/src/app/version.ts
sel "frontend/package.json is a VERSION CARRIER" \
    "docs fe:admin fe:cdsafety fe:public fe:shared pii" frontend/package.json
sel "docker-compose.prod.yml carries the image tag, so it runs docs too" \
    "compose docs pii" docker-compose.prod.yml
sel "backend config.py defines Settings, so it runs the documented-knob contract" \
    "backend compose lint pii" backend/app/config.py
sel "README promises knobs, so it runs the documented-knob contract" \
    "compose docs pii" README.md
sel "docs/DEPLOYMENT.md promises knobs too" "compose docs pii" docs/DEPLOYMENT.md

# --- files no LOCAL leg can exercise (owner directive 2026-09-14) -----------
# CI is their only test surface; the full local round validated nothing about
# them while costing 30-40 minutes (`sonar-project.properties` was the measured
# case). Enumerated ⇒ docs + pii, not ALL.
sel "a CI workflow change selects docs only — CI itself is its only test surface" \
    "docs pii" .github/workflows/deploy.yml
sel "scanner/config text files select docs, not the full round" \
    "docs pii" sonar-project.properties .gitignore
sel ".mcp.json is an AI-config surface, so it selects the drift check" \
    "aiconfig pii" .mcp.json

# --- fail-closed ------------------------------------------------------------
sel "an UNMAPPED path selects ALL (fail closed)" "ALL" importer/ledger.py
sel "a new top-level directory selects ALL" "ALL" brand-new-thing/x.txt
sel "ONE unmapped path in an otherwise docs-only diff still selects ALL" \
    "ALL" docs/a.md importer/ledger.py
sel "an EMPTY changed-file list selects ALL" "ALL" ""

# --- deep/fast defaults (#404 review round 1, blocker 1) --------------------
# Observe the CONSUMED leg values through the PREPUSH_PRINT_DEEP seam (which,
# like PREPUSH_PRINT_LEGS, exits without a permission decision). The default
# flip — deep legs OFF at push time unless PREPUSH_DEEP=1 — is a polarity
# inversion, lessons §59's exact shape, and it survived the entire mutation
# contract until these cases existed: reverting all three defaults to `:=1`
# left the suite green. The fast halves (ruff, tsc) must stay ON by default:
# a simple push confirms formatting + compilation (owner directive 2026-09-14).
deep() { # deep <desc> <expected line> [VAR=VAL ...]
  local desc="$1" want="$2"; shift 2
  local got
  got="$(env -u PREPUSH_DEEP -u PREPUSH_RUN_BACKEND -u PREPUSH_RUN_LINT \
             -u PREPUSH_RUN_FRONTEND -u PREPUSH_RUN_RUFF -u PREPUSH_RUN_TSC \
             "$@" PREPUSH_PRINT_DEEP=1 bash "$HOOK" </dev/null 2>/dev/null)"
  if [ "$got" = "$want" ]; then
    printf 'PASS  [%s]  %s\n' "$got" "$desc"
  else
    printf 'FAIL  got="%s" want="%s"  %s\n' "$got" "$want" "$desc"
    fails=$((fails + 1))
  fi
}
deep "deep legs default OFF at push time; fast halves (ruff/tsc) default ON" \
     "BACKEND=0 LINT=0 FRONTEND=0 RUFF=1 TSC=1"
deep "PREPUSH_DEEP=1 opts the push into every deep leg" \
     "BACKEND=1 LINT=1 FRONTEND=1 RUFF=1 TSC=1" PREPUSH_DEEP=1
# The exact-match on the seam's single output line doubles as the no-decision
# proof: any emitted hook JSON would land in stdout and fail the comparison.

# --- CI carries the mutation contracts (#404 review round 1, major 4) -------
# The four `--mutations` flags live in deploy.yml, where no shell self-test
# used to see them — deleting one left every check green (a `.github/**` edit
# selects docs+pii by design). This case is their executable guard: the
# hook-mutation-contracts job must name all FOUR hooks AND pass --mutations.
DEPLOY_YML="$HERE/../../.github/workflows/deploy.yml"
ci_block="$(awk '/^  hook-mutation-contracts:/{f=1;print;next} f&&/^  [a-z][a-z-]*:$/{exit} f{print}' "$DEPLOY_YML")"
ci_ok=1
for h in pre-push-tests pre-merge-gate guard-stack-resources guard-destructive; do
  printf '%s\n' "$ci_block" | grep -q "$h" || ci_ok=0
done
printf '%s\n' "$ci_block" | grep -q -- '--mutations' || ci_ok=0
if [ "$ci_ok" = "1" ]; then
  printf 'PASS  [CI]  deploy.yml hook-mutation-contracts job covers all four hooks with --mutations\n'
else
  printf 'FAIL  deploy.yml no longer runs all four hook mutation contracts with --mutations\n'
  fails=$((fails + 1))
fi

# --- (b) end to end, through the hook, against REAL git repositories --------
FIXTURES=()
cleanup_fixtures() { local d; for d in ${FIXTURES+"${FIXTURES[@]}"}; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup_fixtures EXIT

# Builds a repo whose origin/main sits at a base commit and whose current
# branch carries ONE commit touching exactly the given files.
#   upstream=main : branch tracks origin/main (a branch never pushed yet)
#   upstream=self : branch tracks origin/<branch> at HEAD~1 (a pushed branch,
#                   so @{push} resolves and the range is the new commit)
#   upstream=none : no tracking at all — the merge-base(origin/main) fallback
#   upstream=orphan: no tracking AND no origin/main — range unobtainable
mkfixture() { # mkfixture <branch> <upstream mode> <path...>
  local br="$1" ups="$2"; shift 2
  local d f
  d="$(mktemp -d)"
  FIXTURES+=("$d")
  git init -q -b main "$d" >/dev/null 2>&1
  git -C "$d" config user.email selftest@example.com
  git -C "$d" config user.name  selftest
  git -C "$d" config commit.gpgsign false
  printf 'base\n' > "$d/BASE"
  git -C "$d" add -A >/dev/null; git -C "$d" commit -qm base >/dev/null
  [ "$ups" = "orphan" ] || git -C "$d" update-ref refs/remotes/origin/main HEAD
  [ "$br" = "main" ] || git -C "$d" checkout -q -b "$br"
  for f in "$@"; do
    [ -n "$f" ] || continue
    mkdir -p "$d/$(dirname "$f")"
    printf 'x\n' > "$d/$f"
  done
  if [ "$#" -gt 0 ] && [ -n "${1-}" ]; then
    git -C "$d" add -A >/dev/null; git -C "$d" commit -qm change >/dev/null
  fi
  case "$ups" in
    main) git -C "$d" config "branch.$br.remote" origin
          git -C "$d" config "branch.$br.merge" refs/heads/main ;;
    self) git -C "$d" update-ref "refs/remotes/origin/$br" \
            "$(git -C "$d" rev-parse --verify -q HEAD~1 || git -C "$d" rev-parse --verify -q HEAD)"
          git -C "$d" config "branch.$br.remote" origin
          git -C "$d" config "branch.$br.merge" "refs/heads/$br" ;;
  esac
  printf '%s\n' "$d"
}

hook_legs() { # hook_legs <repo> <push command> -> prints the selected legs
  local repo="$1" cmd="$2"
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
    | CLAUDE_PROJECT_DIR="$repo" PREPUSH_PRINT_LEGS=1 PREPUSH_FULL="${PREPUSH_FULL:-0}" \
      bash "$HOOK"
}

e2e() { # e2e <desc> <expect legs> <repo> <push command>
  local desc="$1" want="$2" repo="$3" cmd="$4" got
  got="$(norm "$(hook_legs "$repo" "$cmd")")"
  if [ "$got" = "$want" ]; then
    printf 'PASS  [%s]  e2e: %s\n' "$got" "$desc"
  else
    printf 'FAIL  got="%s" want="%s"  e2e: %s\n' "$got" "$want" "$desc"
    fails=$((fails + 1))
  fi
}

R="$(mkfixture fix/docs main docs/guide.md CHANGELOG.md)"
e2e "docs push touching CHANGELOG.md adds the merged-changelog leg (#391)" \
    "changelog docs pii" "$R" "$P origin HEAD"
R="$(mkfixture fix/docsonly main docs/guide2.md docs/notes.md)"
e2e "docs-only push (branch tracks origin/main) runs docs + pii only" \
    "docs pii" "$R" "$P origin HEAD"

R="$(mkfixture fix/api main backend/app/api/blog.py)"
e2e "backend-only push runs backend + lint + pii, no frontend" \
    "backend lint pii" "$R" "$P origin HEAD"

R="$(mkfixture fix/public main frontend/projects/public/src/app/x.ts)"
e2e "public-only push does not run admin or shared" \
    "fe:cdsafety fe:public pii" "$R" "$P origin HEAD"

R="$(mkfixture fix/pushed self docs/guide.md)"
e2e "a branch already on the remote scopes to the NEW commits (@{push})" \
    "docs pii" "$R" "$P"

R="$(mkfixture fix/untracked none docs/guide.md)"
e2e "an unpushed, untracked branch falls back to merge-base(origin/main)" \
    "docs pii" "$R" "$P -u origin HEAD"

# Protected branches SCOPE since v1.14.2 (owner directive 2026-09-14): the
# delta of a push to main is exact, CI runs every leg on that push anyway, and
# the forced full round cost 30-40 minutes for a one-file text change.
R="$(mkfixture main main docs/guide.md)"
e2e "a push on main scopes to its delta (CI is the full backstop)" \
    "docs pii" "$R" "$P origin HEAD"

R="$(mkfixture release/1.14.2 main docs/guide.md)"
e2e "a push on a release branch scopes to its delta too" \
    "docs pii" "$R" "$P origin HEAD"

R="$(mkfixture fix/docs2 main docs/guide.md)"
e2e "a refspec targeting main scopes to the delta from a feature branch" \
    "docs pii" "$R" "$P origin HEAD:main"

e2e "--tags publishes release tags, so it runs EVERYTHING" \
    "ALL" "$R" "$P --tags origin"
e2e "--all publishes every branch, so it runs EVERYTHING" \
    "ALL" "$R" "$P --all origin"

# --- RENAMES: both endpoints must select (#388 review, blocker 1) -----------
# git's DEFAULT rename detection reports only the DESTINATION path, so a
# `git mv` across a project boundary would select the destination's legs and
# silently skip the source's -- exactly where the breakage is, since the source
# project just lost a module its specs import. It is also `diff.renames`-config
# dependent, so two developers would get different coverage from one diff.
# (Case 2 discriminates: without --no-renames it yields only `docs pii`, losing
# every backend leg for a file that moved OUT of backend/.)
# The selector passes --no-renames; these cases fail if that is ever dropped.
mkrenamefixture() { # mkrenamefixture <branch> <from> <to>
  local br="$1" from="$2" to="$3" d
  d="$(mktemp -d)"; FIXTURES+=("$d")
  git init -q -b main "$d" >/dev/null 2>&1
  git -C "$d" config user.email selftest@example.com
  git -C "$d" config user.name  selftest
  git -C "$d" config commit.gpgsign false
  # rename detection is ON by default; set it explicitly so the case also proves
  # the flag beats a hostile local config, not merely the default.
  git -C "$d" config diff.renames true
  mkdir -p "$d/$(dirname "$from")"
  printf 'export const x = 1;\n' > "$d/$from"
  git -C "$d" add -A >/dev/null; git -C "$d" commit -qm base >/dev/null
  git -C "$d" update-ref refs/remotes/origin/main HEAD
  git -C "$d" checkout -q -b "$br"
  mkdir -p "$d/$(dirname "$to")"
  git -C "$d" mv "$from" "$to" >/dev/null
  git -C "$d" commit -qm move >/dev/null
  git -C "$d" config "branch.$br.remote" origin
  git -C "$d" config "branch.$br.merge" refs/heads/main
  printf '%s\n' "$d"
}

R="$(mkrenamefixture fix/mv-admin-to-public \
      frontend/projects/admin/src/app/foo.ts \
      frontend/projects/public/src/app/foo.ts)"
e2e "a rename from admin/ to public/ still runs ADMIN (both endpoints select)" \
    "fe:admin fe:cdsafety fe:public pii" "$R" "$P origin HEAD"

R="$(mkrenamefixture fix/mv-backend-to-docs backend/app/main.py docs/moved.md)"
e2e "a rename out of backend/ still runs the BACKEND legs" \
    "backend docs lint pii" "$R" "$P origin HEAD"

# --- FOREIGN REPO PASS-THROUGH (#353) ---------------------------------------
# The hook is registered for the SESSION, so it fires on `git push` in ANY
# checkout. Measured 2026-09-10: a docs-only push of the project WIKI (a
# separate repository) was blocked twice by MAIN-REPO test results.
#
# POLARITY: skipping must be POSITIVELY established. Only a provably different
# repository passes through; everything ambiguous still runs the gate. The
# cases below pin BOTH directions, because a pass-through that fires too widely
# silently disables the gate for this project too.
# CLAUDE_PROJECT_DIR is supplied exactly as the real hook receives it from
# .claude/settings.json — and it is REQUIRED here, not decoration: the mutation
# harness points $HOOK at a COPY in a temp dir, where the hook's own
# `dirname "$0"/../..` no longer lands on this project, so it cannot know which
# repo it guards. Without this the identity control dies and the whole contract
# reports HARNESS INVALID (measured while writing these cases). The hook still
# fails CLOSED in that situation — unknown identity gates — which is why the
# symptom was a spurious GATE and not a spurious skip.
PROJECT="$(cd "$HERE/../.." && pwd)"
check_in() { # check_in <desc> <dir> <cmd> <expect>
  local desc="$1" dir="$2" cmd="$3" expect="$4" out
  out="$(cd "$dir" && printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" \
        | CLAUDE_PROJECT_DIR="$PROJECT" PREPUSH_DRY_RUN=1 bash "$HOOK" 2>/dev/null)"
  if [ "$out" = "$expect" ]; then printf 'PASS  [%s]  %s\n' "$out" "$desc"
  else printf 'FAIL  got=%s want=%s  %s\n' "$out" "$expect" "$desc"; fails=$((fails + 1)); fi
}
mkrepo() { # mkrepo <origin-url|-> -> prints dir
  local d; d="$(mktemp -d)"; git -C "$d" init -q
  [ "$1" != "-" ] && git -C "$d" remote add origin "$1"
  printf '%s' "$d"
}

FR="$(mkrepo https://github.com/mavrovde/beaconfolio.wiki.git)"
check_in "#353: a push from the project WIKI passes through (it is a different repo)" \
         "$FR" "$P" ALLOW
rm -rf "$FR"

FR="$(mkrepo git@github.com:someone/unrelated.git)"
check_in "#353: a push from an unrelated repo passes through" "$FR" "$P" ALLOW
rm -rf "$FR"

# …and every ambiguous shape must still GATE.
FR="$(mkrepo -)"
check_in "#353: a repo with NO origin still GATES (identity unprovable)" "$FR" "$P" GATE
rm -rf "$FR"

FR="$(mkrepo git@github.com:mavrovde/beaconfolio.git)"
check_in "#353: the SAME origin in another directory still GATES (worktree shape)" \
         "$FR" "$P" GATE
rm -rf "$FR"

# ssh and https spellings of the same remote are the SAME repository — if
# normalisation missed this, every worktree would silently skip the gate.
FR="$(mkrepo https://github.com/mavrovde/beaconfolio.git)"
check_in "#353: https vs ssh spelling of our origin is NOT a foreign repo" \
         "$FR" "$P" GATE
rm -rf "$FR"

# The wiki remote ends in .wiki.git; stripping .git must leave .wiki intact, or
# the wiki would read as the main repo and keep being gated.
FR="$(mkrepo https://github.com/mavrovde/beaconfolio.wiki)"
check_in "#353: a .wiki remote without the .git suffix is still foreign" "$FR" "$P" ALLOW
rm -rf "$FR"

# A non-push command in a foreign repo was already allowed; prove the new block
# did not change that path's reason for allowing.
FR="$(mkrepo https://github.com/mavrovde/beaconfolio.wiki.git)"
check_in "#353: a non-push command in a foreign repo is still ALLOW" "$FR" "git status" ALLOW
rm -rf "$FR"

# round-2 blocker: the push-rides-alone deny must NOT fire on a chained push of
# a DIFFERENT repository — `add && commit && push` is exactly the wiki workflow
# #353 exists for, and this gate does not vet that repository at all. The deny
# therefore sits AFTER the foreign-repo pass-through.
FR="$(mkrepo https://github.com/mavrovde/beaconfolio.wiki.git)"
check_in "#406 r2: a CHAINED commit+push of the WIKI still passes through" \
         "$FR" "git add -A && git commit -m notes && $P" ALLOW
rm -rf "$FR"
# …while the same chain in THIS project is exactly what the deny exists for.
check_in "#406 r2: the same chained commit+push in THIS project is DENIED" \
         "$PROJECT" "git add -A && git commit -m notes && $P" DENY

# --- the push directory is the COMMAND's, not the hook's cwd (#402 blocker 1)
# The hook stands in some ambient cwd, but `cd <dir> &&` and `git -C <dir>`
# both push a repository it is not standing in. Reading identity from $PWD
# alone was a FAIL-OPEN: from the wiki, a push of THIS project skipped THIS
# project's gate. Both directions are pinned, because the fix has to move the
# verdict for BOTH shapes without moving it for the plain one.
FR="$(mkrepo https://github.com/mavrovde/beaconfolio.wiki.git)"
check_in "#402: \`git -C <project> ${P#git }\` from a foreign cwd GATES (it is OUR code)" \
         "$FR" "git -C $PROJECT ${P#git }" GATE
check_in "#402: \`cd <project> && ${P}\` from a foreign cwd GATES (it is OUR code)" \
         "$FR" "cd $PROJECT && $P" GATE
check_in "#402: \`cd <wiki> && ${P}\` from the PROJECT cwd passes through" \
         "$PROJECT" "cd $FR && $P" ALLOW
check_in "#402: \`git -C <wiki> ${P#git }\` from the PROJECT cwd passes through" \
         "$PROJECT" "git -C $FR ${P#git }" ALLOW
# A grouping construct scopes the `cd`; the walker models `cd` as global, so it
# must refuse the shape rather than leak /wiki past the `)` onto the second push.
check_in "#402: a subshell-scoped cd does not leak onto a later push" \
         "$PROJECT" "( cd $FR && $P ) ; $P" GATE
# Indirection can land on another HOST entirely — the directory is unknowable
# even when the ambient cwd is provably foreign.
check_in "#402: a push reached through bash -c gates even from a foreign cwd" \
         "$FR" "bash -c '$P'" GATE
rm -rf "$FR"

# --- identity is owner/repo; HOST and spelling are not identity (#402 major 2)
# Every case here is a spelling of OUR OWN origin. Each one that reads as
# "different" is a silent skip of this project's gate, so all of them GATE.
for spelling in \
  "ssh://git@ssh.github.com:443/mavrovde/beaconfolio.git" \
  "ssh://git@github.com:22/mavrovde/beaconfolio.git" \
  "ssh://maverick@github.com/mavrovde/beaconfolio.git" \
  "git+ssh://git@github.com/mavrovde/beaconfolio.git" \
  "https://GitHub.com/MavrovDe/Beaconfolio.git" \
  "https://github.com/mavrovde/beaconfolio.git/" ; do
  FR="$(mkrepo "$spelling")"
  check_in "#402: \`$spelling\` is OUR origin, not a foreign repo" "$FR" "$P" GATE
  rm -rf "$FR"
done
# A bare filesystem path names no repository we can compare, so it is not an
# identity — and no identity gates.
FR="$(mkrepo "$PROJECT")"
check_in "#402: a local-path origin yields NO identity and GATES" "$FR" "$P" GATE
rm -rf "$FR"
FR="$(mkrepo "file://$PROJECT")"
check_in "#402: a file:// origin yields NO identity and GATES" "$FR" "$P" GATE
rm -rf "$FR"

# The operator-facing note is the only evidence a skip happened at all; assert
# it, rather than trusting that an ALLOW came from the intended branch.
FR="$(mkrepo https://github.com/mavrovde/beaconfolio.wiki.git)"
note="$( (cd "$FR" && printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$P" '$c')" \
        | CLAUDE_PROJECT_DIR="$PROJECT" PREPUSH_DRY_RUN=1 bash "$HOOK" 2>&1 >/dev/null) )"
case "$note" in
  *"foreign repo (mavrovde/beaconfolio.wiki)"*"this project is mavrovde/beaconfolio"*)
    printf 'PASS  [NOTE]  #402: the skip names BOTH identities on stderr\n' ;;
  *) printf 'FAIL  #402: the skip note is missing or unnamed: %s\n' "$note"
     fails=$((fails + 1)) ;;
esac
rm -rf "$FR"

# --- NO mutation contract runs locally, ever (v1.14.2) -----------------------
# Owner directive 2026-09-14: a push costs 1-3 minutes, proportional to the
# diff. `--mutations` measured 543s for the merge gate alone and ~9 minutes for
# this file's own contract — CI runs all three unconditionally (deploy.yml);
# the local gate must never pass the flag, INCLUDING when the diff names the
# hook (the pre-v1.14.2 rule). OBSERVE the real argv — plant stub self-tests
# inside the fixture (the hook resolves them from $ROOT) that record what they
# were called with, so "quietly reintroduces the flag" has a red case.
mkstubfixture() { # mkstubfixture <branch> <path...>
  local br="$1"; shift
  local d; d="$(mkfixture "$br" main "$@")"
  mkdir -p "$d/.claude/hooks"
  # One stub per self-test the hook can invoke, each logging under its own
  # prefix — the merge-gate/stack-guard call sites carry the same
  # mutations-only-when-the-diff-names-the-hook rule (v1.14.2) and need the
  # same argv observation.
  local stub prefix
  for stub in pre-push-tests:ARGV pre-merge-gate:GATE guard-stack-resources:STACK; do
    prefix="${stub##*:}"
    cat > "$d/.claude/hooks/${stub%%:*}.test.sh" <<EOSTUB
#!/usr/bin/env bash
printf '%s\n' "$prefix:\$*" >> "\${PREPUSH_STUB_LOG:?}"
exit 0
EOSTUB
    chmod +x "$d/.claude/hooks/${stub%%:*}.test.sh"
  done
  printf '%s\n' "$d"
}
observe_argv() { # observe_argv <repo> <cmd> [prefix] -> prints the recorded line
  local pref="${3:-ARGV}" log; log="$(mktemp)"
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$2" '$c')" \
    | CLAUDE_PROJECT_DIR="$1" PREPUSH_STUB_LOG="$log" PREPUSH_FULL=0 \
      PREPUSH_CHECK_DOCS=0 PREPUSH_RUN_BACKEND=0 PREPUSH_RUN_LINT=0 \
      PREPUSH_RUN_FRONTEND=0 PREPUSH_RUN_GUARDTEST=1 \
      PREPUSH_LOG=/tmp/prepush-selftest-argv.log bash "$HOOK" >/dev/null 2>&1
  grep "^$pref:" "$log" 2>/dev/null | head -1; rm -f "$log"
}

# The discriminating direction: every round that invokes a self-test invokes
# it WITHOUT the flag — including the round whose diff NAMES the hook, which
# under the pre-v1.14.2 rule was exactly the round that ran mutations locally.
R="$(mkstubfixture fix/hookargv .claude/hooks/pre-push-tests.sh)"
got="$(observe_argv "$R" "$P origin HEAD")"
if [ "$got" = "ARGV:" ]; then
  printf 'PASS  [%s]  a diff naming this hook still runs the PLAIN cases only\n' "$got"
else
  printf 'FAIL  got="%s" want="ARGV:"  a hook-change round passed the mutation flag (budget breach)\n' "$got"
  fails=$((fails + 1))
fi

R="$(mkstubfixture fix/docsargv docs/guide.md)"
got="$(observe_argv "$R" "$P origin HEAD")"
if [ "$got" = "ARGV:" ] || [ -z "$got" ]; then
  printf 'PASS  [%s]  a docs-only round does not pass --mutations\n' "${got:-not-invoked}"
else
  printf 'FAIL  got="%s" want="ARGV:" (or no invocation)  plain round leaked --mutations\n' "$got"
  fails=$((fails + 1))
fi

R="$(mkstubfixture fix/allargv importer/ledger.py)"
got="$(observe_argv "$R" "$P origin HEAD")"
if [ "$got" = "ARGV:" ]; then
  printf 'PASS  [%s]  an ALL round invokes the self-test WITHOUT --mutations\n' "$got"
else
  printf 'FAIL  got="%s" want="ARGV:"  ALL round passed the mutation flag (fail-open risk)\n' "$got"
  fails=$((fails + 1))
fi

# --- the merge-gate/stack-guard call sites follow the same rule (v1.14.2) ----
R="$(mkstubfixture fix/gateargv .claude/hooks/pre-merge-gate.sh)"
got="$(observe_argv "$R" "$P origin HEAD" GATE)"
if [ "$got" = "GATE:" ]; then
  printf 'PASS  [%s]  a diff naming the merge gate still runs its PLAIN cases only\n' "$got"
else
  printf 'FAIL  got="%s" want="GATE:"  merge-gate call site passed the mutation flag\n' "$got"
  fails=$((fails + 1))
fi

R="$(mkstubfixture fix/allgate importer/ledger.py)"
got="$(observe_argv "$R" "$P origin HEAD" GATE)"
if [ "$got" = "GATE:" ]; then
  printf 'PASS  [%s]  an ALL round runs the merge-gate cases WITHOUT mutations\n' "$got"
else
  printf 'FAIL  got="%s" want="GATE:"  ALL round leaked the merge-gate mutation flag\n' "$got"
  fails=$((fails + 1))
fi

R="$(mkstubfixture fix/allstack importer/ledger.py)"
got="$(observe_argv "$R" "$P origin HEAD" STACK)"
if [ "$got" = "STACK:" ]; then
  printf 'PASS  [%s]  an ALL round runs the stack-guard cases WITHOUT mutations\n' "$got"
else
  printf 'FAIL  got="%s" want="STACK:"  ALL round leaked the stack-guard mutation flag\n' "$got"
  fails=$((fails + 1))
fi

# --- refspec spellings that target main all SCOPE now (v1.14.2) -------------
# Under the pre-v1.14.2 contract these forced a full round; the owner directive
# scopes every branch, so every spelling must land on the same scoped answer —
# these cases pin that no half-removed probe still special-cases one of them.
R="$(mkfixture fix/refspec-plus main docs/guide.md)"
e2e "a force refspec '+main' scopes to the delta" \
    "docs pii" "$R" "$P origin +main"
e2e "a fully-qualified 'HEAD:refs/heads/main' scopes to the delta" \
    "docs pii" "$R" "$P origin HEAD:refs/heads/main"
e2e "a force + fully-qualified '+HEAD:refs/heads/main' scopes to the delta" \
    "docs pii" "$R" "$P origin +HEAD:refs/heads/main"
e2e "a fully-qualified release branch scopes to the delta" \
    "docs pii" "$R" "$P origin HEAD:refs/heads/release/1.2.3"
e2e "a feature branch whose NAME contains 'main' still scopes" \
    "docs pii" "$R" "$P origin HEAD:feature-main-nav"

R="$(mkfixture fix/unmapped main importer/ledger.py)"
e2e "an unmappable path runs EVERYTHING (fail closed)" \
    "ALL" "$R" "$P origin HEAD"

R="$(mkfixture fix/empty self)"
e2e "nothing to push (empty range) runs EVERYTHING (fail closed)" \
    "ALL" "$R" "$P origin HEAD"

R="$(mkfixture fix/orphan orphan docs/guide.md)"
e2e "an unobtainable range runs EVERYTHING (fail closed)" \
    "ALL" "$R" "$P origin HEAD"

NOTAREPO="$(mktemp -d)"; FIXTURES+=("$NOTAREPO")
e2e "a root that is not a git repository runs EVERYTHING (fail closed)" \
    "ALL" "$NOTAREPO" "$P origin HEAD"

# ...and the same thing asserted AT THE SEAM (lessons §49). The e2e case above
# is satisfied by the empty-branch rule before prepush_changed_files is ever
# reached, so it cannot tell whether that function reports failure. Ask it
# directly: "I could not compute a range" must be a NON-ZERO return, never an
# empty success that a caller would read as "nothing changed".
if prepush_changed_files "$NOTAREPO" >/dev/null 2>&1; then
  printf 'FAIL  prepush_changed_files succeeded on a non-repository\n'
  fails=$((fails + 1))
else
  printf 'PASS  [rc!=0]  prepush_changed_files FAILS on a non-repository\n'
fi
R="$(mkfixture fix/seam main backend/app/main.py)"
got="$(prepush_changed_files "$R" 2>/dev/null)"
if [ "$got" = "backend/app/main.py" ]; then
  printf 'PASS  [%s]  prepush_changed_files returns the pushed range\n' "$got"
else
  printf 'FAIL  got="%s" want="backend/app/main.py"  prepush_changed_files range\n' "$got"
  fails=$((fails + 1))
fi

R="$(mkfixture fix/detached main docs/guide.md)"
git -C "$R" checkout -q --detach HEAD
e2e "a detached HEAD cannot be named, so it runs EVERYTHING" \
    "ALL" "$R" "$P origin HEAD"

# The PREPUSH_FULL case needs the variable in the hook's environment, so run it
# explicitly rather than through e2e's fixed env.
R="$(mkfixture fix/fullflag main docs/guide.md)"
got="$(norm "$(PREPUSH_FULL=1 hook_legs "$R" "$P origin HEAD")")"
if [ "$got" = "ALL" ]; then
  printf 'PASS  [ALL]  e2e: PREPUSH_FULL=1 forces the full round\n'
else
  printf 'FAIL  got="%s" want="ALL"  e2e: PREPUSH_FULL=1 forces the full round\n' "$got"
  fails=$((fails + 1))
fi

# PRINT_LEGS must NOT be mistakable for an allow: it prints legs, emits no
# permission JSON, and therefore cannot smuggle a push past the gate.
out="$(hook_legs "$R" "$P origin HEAD")"
if printf '%s' "$out" | grep -q 'permissionDecision'; then
  printf 'FAIL  PREPUSH_PRINT_LEGS emitted a permission decision\n'
  fails=$((fails + 1))
else
  printf 'PASS  [no JSON]  PREPUSH_PRINT_LEGS cannot be mistaken for an allow\n'
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails pre-push self-gate/selection case(s) FAILED."
  exit 1
fi
echo "All pre-push self-gate + leg-selection cases passed."

# ===========================================================================
# MUTATION CONTRACT (#377) — prove the selection cases CAN go red
# ===========================================================================
# A selector that silently selects NOTHING passes every "X must not be
# selected" case above and skips the entire gate. That is the anti-pattern
# lessons §18/§46/§59 describe, and it is the one this change could plausibly
# ship. So: neuter one selection rule at a time in a COPY of the hooks
# directory, re-run this file against the copy, and require it to FAIL.
#
#   bash pre-push-tests.test.sh --mutations
#
# A mutation that produces no textual diff, or an unparseable mutant, is
# reported INVALID — a syntax error is not a kill.
[ "$MUTATIONS" = "1" ] || exit 0

echo
echo "== mutation contract: each rule below must make the cases above FAIL =="
MPASS=0; MFAIL=0; MBAD=0
WORKDIR="$(mktemp -d)"
trap 'cleanup_fixtures; rm -rf "$WORKDIR"' EXIT

apply() { # apply <file in the hooks dir> <spec>
  rm -rf "${WORKDIR:?}"/*
  cp "$HERE"/*.sh "$WORKDIR"/ 2>/dev/null
  python3 - "$HERE/$1" "$WORKDIR/$1" "$2" <<'PY'
import sys
src, dst, spec = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src).read()
kind, _, arg = spec.partition("::")
if kind == "identity":
    out = text
elif kind == "replace":
    a, _, b = arg.partition("=>")
    out = text.replace(a, b)
else:
    raise SystemExit("unknown mutation kind: " + kind)
open(dst, "w").write(out)
print("CHANGED" if out != text else "SAME")
PY
}

mutate() { # mutate <die|survive> <file> <name> <spec>
  local expect="$1" file="$2" name="$3" spec="$4" changed rc
  changed="$(apply "$file" "$spec")" || {
    printf '  ✗ INVALID: %s (mutation script failed)\n' "$name"; MBAD=$((MBAD+1)); return; }
  if [ "$expect" = "die" ] && [ "$changed" = "SAME" ]; then
    printf '  ✗ INVALID: %s — produced NO diff, so it tests nothing\n' "$name"
    MBAD=$((MBAD+1)); return
  fi
  if ! bash -n "$WORKDIR/$file" 2>/dev/null; then
    printf '  ✗ INVALID: %s — mutant is not parseable; a syntax error is not a kill\n' "$name"
    MBAD=$((MBAD+1)); return
  fi
  HOOK="$WORKDIR/pre-push-tests.sh" PREPUSH_TEST_SELECTION_ONLY=1 bash "$0" >/dev/null 2>&1; rc=$?
  if [ "$expect" = "survive" ]; then
    if [ $rc -eq 0 ]; then printf '  ✓ control survived: %s\n' "$name"
    else printf '  ✗ HARNESS BROKEN: %s should survive but died — every result below is meaningless\n' "$name"
         MBAD=$((MBAD+1)); fi
    return
  fi
  if [ $rc -ne 0 ]; then MPASS=$((MPASS+1)); printf '  ✓ killed: %s\n' "$name"
  else MFAIL=$((MFAIL+1)); printf '  ✗ SURVIVED: %s\n' "$name"; fi
}

LIBF="prepush-select-lib.sh"
HOOKF="pre-push-tests.sh"

# CONTROL FIRST: a byte-identical copy must pass. If this dies, the harness is
# lying and nothing below can be trusted.
mutate survive "$LIBF" "identity (byte-identical copy)" "identity::"
[ "$MBAD" -eq 0 ] || { echo "mutation contract: HARNESS INVALID"; exit 1; }

# THE headline mutation: the selector selects nothing at all. This is what a
# "fast" gate that silently stopped gating would look like.
mutate die "$LIBF" "the selector returns an EMPTY selection (the silent-skip shape)" \
  'replace::  [ "$any" = "1" ] || { printf=>  return 0; [ "$any" = "1" ] || { printf'
mutate die "$LIBF" "unmapped paths no longer fail closed" \
  'replace::prepush_unmapped_path() { echo ALL; }=>prepush_unmapped_path() { echo; }'
mutate die "$LIBF" "an empty changed-file list no longer selects ALL" \
  "replace::[ \"\$any\" = \"1\" ] || { printf ' ALL \\n'; return 0; }=>[ \"\$any\" = \"1\" ] || { printf ' pii \\n'; return 0; }"
mutate die "$LIBF" "the always-on PII guard becomes path-selectable" \
  'replace::prepush_always_legs()   { echo pii; }=>prepush_always_legs()   { echo; }'
mutate die "$LIBF" "ALL stops absorbing a narrow selection" \
  'replace::*"
ALL
"*) printf=>*"
NEVER_MATCHES
"*) printf'
mutate die "$LIBF" "version carriers stop selecting the version-consistency leg" \
  'replace::      echo docs ;;
  esac
  case "$1" in
    backend/app/config.py=>      echo ;;
  esac
  case "$1" in
    backend/app/config.py'
mutate die "$LIBF" "documented-knob sources stop selecting the compose contract" \
  'replace::    backend/app/config.py|.env.example|README.md=>    backend/app/config.pyXX|.env.exampleXX|README.mdXX'
mutate die "$LIBF" "the no-verdict auditor stops selecting its own leg (#392)" \
  'replace::scripts/audit_no_verdict_merges.sh|scripts/audit_no_verdict_merges.test.sh) printf '"'"'vaudit\naiconfig\n'"'"' ;;=>scripts/audit_no_verdict_merges.shXX) printf '"'"'vaudit\naiconfig\n'"'"' ;;'
mutate die "$LIBF" "the merged-changelog lint stops selecting its own leg (#391)" \
  'replace::scripts/check_changelog_merge.sh|scripts/check_changelog_merge.test.sh) printf '"'"'changelog\naiconfig\n'"'"' ;;=>scripts/check_changelog_merge.shXX) printf '"'"'changelog\naiconfig\n'"'"' ;;'
mutate die "$LIBF" "CHANGELOG.md stops selecting the merged-changelog leg (#391)" \
  'replace::  CHANGELOG.md) printf '"'"'changelog\ndocs\n'"'"' ;;=>  CHANGELOG.md) printf '"'"'docs\n'"'"' ;;'
mutate die "$LIBF" "the CHANGELOG rewriter stops selecting its own self-test" \
  'replace::scripts/dedup_changelog_unreleased.py|scripts/dedup_changelog_unreleased.test.sh) printf '"'"'dedup\naiconfig\n'"'"' ;;=>scripts/dedup_changelog_unreleased.pyXX) printf '"'"'dedup\naiconfig\n'"'"' ;;'
mutate die "$LIBF" "a backend diff stops selecting the backend legs" \
  'replace::  backend/*) prepush_backend_legs ;;=>  backend/*) prepush_always_legs ;;'
mutate die "$LIBF" "a shared-library diff stops fanning out to all three projects" \
  'replace::frontend/projects/shared/*) prepush_fe_all_legs ;;=>frontend/projects/shared/*) echo fe:shared ;;'
mutate die "$LIBF" "a public-app diff leaks into admin (the per-project promise)" \
  'replace::prepush_fe_public_legs(){ printf=>prepush_fe_public_legs(){ prepush_fe_all_legs; printf'
mutate die "$LIBF" "hook-parse-lib stops selecting all four hook self-tests" \
  'replace::.claude/hooks/hook-parse-lib.sh) prepush_all_hook_legs ;;=>.claude/hooks/hook-parse-lib.sh) echo hook:pre-push-tests ;;'
mutate die "$LIBF" "an unnameable branch (detached HEAD) no longer forces the full round" \
  "replace::    HEAD|'')     echo=>    HEADXX)      echo"
mutate die "$LIBF" "PREPUSH_FULL=1 is ignored" \
  'replace::[ "${PREPUSH_FULL:-0}" = "1" ] && { echo=>[ "${PREPUSH_FULL:-0}" = "9" ] && { echo'
# main/release no longer force a full round (v1.14.2, owner directive), so
# those rules — and the structural refspec probe that served them — are gone
# and carry no mutations. What REMAINS protected-branch-shaped is the
# multi-ref publish check, and the enumerated no-local-leg mappings must not
# quietly widen into selecting nothing:
mutate die "$LIBF" "--all/--tags no longer force the full round" \
  'replace::    *--all*|*--mirror*|*--tags*|*--follow-tags*)=>    *--allXX*|*--mirrorXX*)'
mutate die "$LIBF" ".github/ stops selecting its docs leg (silently selects pii alone)" \
  'replace::  .github/*) echo docs ;;=>  .github/*) echo ;;'
mutate die "$LIBF" "scanner/config text files stop selecting their docs leg" \
  'replace::  sonar-project.properties|.gitignore) echo docs ;;=>  sonar-project.properties|.gitignore) echo ;;'
mutate die "$LIBF" ".mcp.json stops selecting the AI-config drift check" \
  'replace::  .mcp.json) echo aiconfig ;;=>  .mcp.json) echo ;;'
mutate die "$LIBF" "the shared-edge files stop selecting the apply contract (#338)" \
  'replace::  infra/edge/*) echo edge ;;=>  infra/edge/*) echo ;;'
mutate die "$LIBF" "an unobtainable git range reports success instead of failing" \
  'replace::  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || return 1=>  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || { echo docs/fake.md; return 0; }'
mutate die "$LIBF" "rename detection hides the SOURCE path of a git mv (#388 blocker 1)" \
  'replace::  git -C "$root" diff --no-renames --name-only "$range" 2>/dev/null || return 1=>  git -C "$root" diff --name-only "$range" 2>/dev/null || return 1'
# Mutation contracts are CI-only (v1.14.2, owner budget). The one direction a
# call site can now fail is REINTRODUCING the flag locally — pin each of the
# three call sites against it (killed by the argv-observed stub cases).
mutate die "$HOOKF" "the pre-push call site starts running --mutations locally again" \
  'replace::      bash "$ROOT/.claude/hooks/pre-push-tests.test.sh" || return 1=>      bash "$ROOT/.claude/hooks/pre-push-tests.test.sh" --mutations || return 1'
mutate die "$HOOKF" "the merge-gate call site starts running --mutations locally again" \
  'replace::      bash "$ROOT/.claude/hooks/pre-merge-gate.test.sh" || return 1=>      bash "$ROOT/.claude/hooks/pre-merge-gate.test.sh" --mutations || return 1'
mutate die "$HOOKF" "the stack-guard call site starts running --mutations locally again" \
  'replace::      bash "$ROOT/.claude/hooks/guard-stack-resources.test.sh" || return 1=>      bash "$ROOT/.claude/hooks/guard-stack-resources.test.sh" --mutations || return 1'
# The deep-defaults flip (#404 review round 1, blocker 1): the single line
# that decides whether pytest/mypy/Vitest run at push time. Killed by the
# PREPUSH_PRINT_DEEP cases, which observe the CONSUMED values.
mutate die "$HOOKF" "the deep legs start running at push time again (defaults revert to always-on)" \
  'replace:::=$PREPUSH_DEEP}=>:=1}'
mutate die "$HOOKF" "the backend fast half (ruff) silently defaults OFF" \
  'replace::PREPUSH_RUN_RUFF:=1}=>PREPUSH_RUN_RUFF:=0}'
mutate die "$HOOKF" "the frontend fast compile (tsc) silently defaults OFF" \
  'replace::PREPUSH_RUN_TSC:=1}=>PREPUSH_RUN_TSC:=0}'
# --- #406: the push-rides-alone deny must be able to fail BOTH ways ----------
# Killed by the chain_check cases (never stubbed under SELECTION_ONLY).
mutate die "$HOOKF" "the push-rides-alone chain deny is removed (#406 blocker 2 regressed)" \
  'replace::if command_chains_head_mover; then=>if false && command_chains_head_mover; then'
mutate die "$HOOKF" "the chain deny fires on EVERY push (deny-everything polarity)" \
  'replace::if command_chains_head_mover; then=>if command_is_git_push; then'
mutate die "$HOOKF" "commit drops out of the head-mover list" \
  'replace::    commit|merge|rebase|cherry-pick=>    xcommitx|merge|rebase|cherry-pick'
mutate die "$HOOKF" "the chain deny ignores the size bound (denies from an untrusted parse)" \
  'replace::  [ "${#CMD}" -gt "$PREPUSH_MAX_CMD_LEN" ] && return 1=>  :'
mutate die "$HOOKF" "the chain deny goes order-blind (push-then-amend denied again)" \
  'replace::if [ "$mover" = "1" ] && segment_invokes_git_push=>if segment_invokes_git_push'
mutate die "$HOOKF" "the deny stops seeing a push AFTER the head-mover (first-push short-circuit back)" \
  'replace::if segment_invokes_head_mover "$seg"; then mover=1; continue; fi=>if segment_invokes_head_mover "$seg"; then mover=1; break; fi'
mutate die "$HOOKF" "the chain deny reads unquoted-heredoc prose as commands again" \
  'replace::quote_split "$(strip_all_heredoc_bodies "$CMD")"=>quote_split "$(strip_text_heredocs "$CMD")"'
mutate die "$HOOKF" "the hook ignores the selector and prints a fixed narrow set" \
  'replace::| prepush_select_legs)=>| true; echo " docs ")'
mutate die "$HOOKF" "the hook no longer fails closed when the range is unobtainable" \
  'replace::    SELECT_REASON="FULL — the changed-file list could not be computed; fail closed"=>    LEGS=" docs "'

# --- #353: the foreign-repo pass-through must be able to fail BOTH ways ------
# A pass-through is a hole by construction: too narrow and the wiki keeps being
# gated (the bug), too wide and this project's OWN pushes skip the gate
# silently. So both directions get a mutation, not just the one the fix was
# written for.
mutate die "$HOOKF" "the foreign-repo check passes through for ANY other directory (identity ignored)" \
  'replace::    if [ -z "$THEIRS" ] || [ "$THEIRS" = "$OURS" ]; then FOREIGN=0; break; fi=>    :'
mutate die "$HOOKF" "the foreign-repo pass-through never fires (the #353 bug restored)" \
  'replace::[ -n "$ROOT_TOP" ] && [ -n "$OURS" ] && [ -n "$PUSH_DIRS" ] || FOREIGN=0=>FOREIGN=0'
# Identity must come from the REMOTE, not the path: comparing directories alone
# would make every git worktree of this project skip the gate.
mutate die "$HOOKF" "repo identity falls back to the directory path instead of the remote" \
  'replace::    THEIRS="$(prepush_repo_identity "$PTOP")"=>    THEIRS="$PTOP"'

# --- #402 blocker 1: the push directory is the COMMAND's, not the hook's cwd -
# This is the mutation that would have caught the fail-open the first round
# shipped: identity read from $PWD while the command names another repo.
mutate die "$HOOKF" "the push directory is taken from the cwd instead of the command" \
  'replace::PUSH_DIRS="$(prepush_push_dirs "$CMD")"=>PUSH_DIRS="$PWD"'
mutate die "$HOOKF" "a grouping construct no longer scopes the cd (subshell leak)" \
  "replace::  case \"\$masked\" in *'('*|*')'*|*'{'*|*'}'*) printf '?\\n'; return 0 ;; esac=>  :"
mutate die "$HOOKF" "a push reached through indirection is treated as a direct one" \
  "replace::        case \"\${A[\$i]:-}\" in git|'\\git') ;; *) printf '?\\n'; return 0 ;; esac=>        :"

# --- #402 major 2: every normalisation rule is load-bearing for POLARITY -----
# Each rule below decides whether a spelling of OUR OWN origin reads as ours.
# Losing one is a silent skip of this project's gate, so none may be unpinned.
mutate die "$HOOKF" "origin identity stops case-folding (an uppercase spelling reads as foreign)" \
  "replace::  path=\"\$(printf '%s' \"\$path\" | sed -E 's#/+\$##; s#\\.git\$##' | tr 'A-Z' 'a-z')\"=>  path=\"\$(printf '%s' \"\$path\" | sed -E 's#/+\$##; s#\\.git\$##')\""
mutate die "$HOOKF" "origin identity stops stripping a trailing slash (\`…/beaconfolio.git/\`)" \
  "replace::  path=\"\$(printf '%s' \"\$path\" | sed -E 's#/+\$##; s#\\.git\$##' | tr 'A-Z' 'a-z')\"=>  path=\"\$(printf '%s' \"\$path\" | sed -E 's#\\.git\$##' | tr 'A-Z' 'a-z')\""
mutate die "$HOOKF" "a bare filesystem path is accepted as a repository identity" \
  'replace::    *) return 0 ;;                         # bare filesystem path=>    *) path="$url" ;;'

echo "mutation contract: $MPASS killed, $MFAIL survived, $MBAD invalid"
[ "$MFAIL" -eq 0 ] && [ "$MBAD" -eq 0 ] || exit 1
