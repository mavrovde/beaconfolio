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
#     unnameable branch, main/release and PREPUSH_FULL=1 all select ALL.
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
check "push at end of && chain"      "git add -A && git commit -m \"x\" && $P" GATE
check "push after semicolon"         "git commit -m \"done\"; $P origin HEAD"  GATE
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
check "prose AND a real push"        "git commit -m \"then $P\" && $P origin HEAD" GATE

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
    "docs pii" docs/wiki/x.md CHANGELOG.md
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
sel "compose + .env.example select the documented-knob contract" \
    "compose docs pii" docker-compose.prod.yml .env.example
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
    "backend docs fe:cdsafety fe:public lint pii" \
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

# --- fail-closed ------------------------------------------------------------
sel "an UNMAPPED path selects ALL (fail closed)" "ALL" importer/ledger.py
sel "a new top-level directory selects ALL" "ALL" brand-new-thing/x.txt
sel "a CI workflow change selects ALL (no leg can exercise it)" "ALL" .github/workflows/deploy.yml
sel "ONE unmapped path in an otherwise docs-only diff still selects ALL" \
    "ALL" docs/a.md .gitignore
sel "an EMPTY changed-file list selects ALL" "ALL" ""

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

R="$(mkfixture main main docs/guide.md)"
e2e "a push on main runs EVERYTHING regardless of the diff" \
    "ALL" "$R" "$P origin HEAD"

R="$(mkfixture release/1.14.2 main docs/guide.md)"
e2e "a push on a release branch runs EVERYTHING" \
    "ALL" "$R" "$P origin HEAD"

R="$(mkfixture fix/docs2 main docs/guide.md)"
e2e "a refspec targeting main runs EVERYTHING from a feature branch" \
    "ALL" "$R" "$P origin HEAD:main"

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

# --- the mutation contract must NOT run in a full round (#388 review, major 2) -
# `pre-merge-gate.test.sh --mutations` measured 543s alone under load; the hook
# legs subtotal 646s before pytest/Vitest. Spending that in a fail-closed ALL
# round would push the round past the 900s PreToolUse timeout -- and a timed-out
# hook does NOT deny, so it would trade a slow gate for an OPEN one.
# These cases pin the call site to `leg_exact`; with `leg` the ALL case flips.
mut_decision() { # mut_decision <repo> <push command>
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$2" '$c')" \
    | CLAUDE_PROJECT_DIR="$1" PREPUSH_PRINT_MUTATION_DECISION=1 PREPUSH_FULL=0 bash "$HOOK"
}
chk_decision() { # chk_decision <desc> <want> <repo> <cmd>
  local got; got="$(mut_decision "$3" "$4" | tr -d '\n')"
  if [ "$got" = "$2" ]; then printf 'PASS  [%s]  %s\n' "$got" "$1"
  else printf 'FAIL  got="%s" want="%s"  %s\n' "$got" "$2" "$1"; fails=$((fails + 1)); fi
}

R="$(mkfixture fix/hookchange main .claude/hooks/pre-push-tests.sh)"
chk_decision "a diff that NAMES this hook runs the mutation contract" \
  "MUTATIONS" "$R" "$P origin HEAD"

R="$(mkfixture fix/unmapped-full main importer/ledger.py)"
chk_decision "a fail-closed ALL round runs the PLAIN cases, not the mutations" \
  "PLAIN" "$R" "$P origin HEAD"

R="$(mkfixture fix/mainpush main docs/guide.md)"
chk_decision "a push to main (full round) runs the PLAIN cases, not the mutations" \
  "PLAIN" "$R" "$P origin HEAD:main"

# The structural probe expands $cmd, so it must not inherit the caller's IFS or
# globbing (#388 review round 2). Both are pinned inside the function; these
# cases fail if either is ever dropped.
sel_env_ifs() { # run one selection with a hostile IFS and globbing ON
  ( IFS=:; set +f
    R2="$(mkfixture fix/ifs main docs/guide.md)"
    printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$P origin HEAD:main" '$c')" \
      | CLAUDE_PROJECT_DIR="$R2" PREPUSH_PRINT_LEGS=1 PREPUSH_FULL=0 bash "$HOOK" )
}
got="$(norm "$(sel_env_ifs)")"
if [ "$got" = "ALL" ]; then
  printf 'PASS  [%s]  a hostile IFS=: and globbing ON do not break protected-branch detection\n' "$got"
else
  printf 'FAIL  got="%s" want="ALL"  hostile IFS/glob broke protected-branch detection\n' "$got"
  fails=$((fails + 1))
fi

# --- the call site must actually PASS the flag (#388 review round 2) ---------
# A decision-only case cannot see this: if the invocation stops expanding
# MUT_ARGS, the seam still prints MUTATIONS while the round silently runs the
# plain cases. So OBSERVE the real argv -- plant a stub self-test inside the
# fixture (the hook resolves it from $ROOT) that records what it was called with.
mkstubfixture() { # mkstubfixture <branch> <path...>
  local br="$1"; shift
  local d; d="$(mkfixture "$br" main "$@")"
  mkdir -p "$d/.claude/hooks"
  cat > "$d/.claude/hooks/pre-push-tests.test.sh" <<'EOSTUB'
#!/usr/bin/env bash
printf '%s\n' "ARGV:$*" >> "${PREPUSH_STUB_LOG:?}"
exit 0
EOSTUB
  chmod +x "$d/.claude/hooks/pre-push-tests.test.sh"
  printf '%s\n' "$d"
}
observe_argv() { # observe_argv <repo> <cmd> -> prints the recorded argv line
  local log; log="$(mktemp)"
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$2" '$c')" \
    | CLAUDE_PROJECT_DIR="$1" PREPUSH_STUB_LOG="$log" PREPUSH_FULL=0 \
      PREPUSH_CHECK_DOCS=0 PREPUSH_RUN_BACKEND=0 PREPUSH_RUN_LINT=0 \
      PREPUSH_RUN_FRONTEND=0 PREPUSH_RUN_GUARDTEST=1 \
      PREPUSH_LOG=/tmp/prepush-selftest-argv.log bash "$HOOK" >/dev/null 2>&1
  grep '^ARGV:' "$log" 2>/dev/null | head -1; rm -f "$log"
}

R="$(mkstubfixture fix/hookargv .claude/hooks/pre-push-tests.sh)"
got="$(observe_argv "$R" "$P origin HEAD")"
if [ "$got" = "ARGV:--mutations" ]; then
  printf 'PASS  [%s]  the call site really passes --mutations when the hook changed\n' "$got"
else
  printf 'FAIL  got="%s" want="ARGV:--mutations"  call site did not pass the flag\n' "$got"
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

# The discriminating half: a fail-closed ALL round DOES invoke the self-test, and
# must invoke it WITHOUT the flag. This is the case that catches "just always
# pass --mutations", which is the change that reintroduces the fail-open risk.
R="$(mkstubfixture fix/allargv importer/ledger.py)"
got="$(observe_argv "$R" "$P origin HEAD")"
if [ "$got" = "ARGV:" ]; then
  printf 'PASS  [%s]  an ALL round invokes the self-test WITHOUT --mutations\n' "$got"
else
  printf 'FAIL  got="%s" want="ARGV:"  ALL round passed the mutation flag (fail-open risk)\n' "$got"
  fails=$((fails + 1))
fi

# --- refspec spellings that still target main (#388 review, minor) ----------
# The substring probe missed `+main` (the `+` sits where it wants a space) and
# `refs/heads/main` (ends `/main`, not `:main`). Both are pushes to the
# prod-deploy trigger; both used to get a SCOPED gate.
R="$(mkfixture fix/refspec-plus main docs/guide.md)"
e2e "a force refspec '+main' runs EVERYTHING" \
    "ALL" "$R" "$P origin +main"
e2e "a fully-qualified 'HEAD:refs/heads/main' runs EVERYTHING" \
    "ALL" "$R" "$P origin HEAD:refs/heads/main"
e2e "a force + fully-qualified '+HEAD:refs/heads/main' runs EVERYTHING" \
    "ALL" "$R" "$P origin +HEAD:refs/heads/main"
e2e "a fully-qualified release branch runs EVERYTHING" \
    "ALL" "$R" "$P origin HEAD:refs/heads/release/1.2.3"
# ...and the structural probe must not over-match a branch merely NAMED for main
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
mutate die "$LIBF" "main/master no longer forces the full round" \
  'replace::    main|master) echo=>    mainXX|masterXX) echo'
mutate die "$LIBF" "release/* no longer forces the full round" \
  'replace::    release/*)   echo=>    releaseXX/*)   echo'
mutate die "$LIBF" "an unnameable branch (detached HEAD) no longer forces the full round" \
  "replace::    HEAD|'')     echo=>    HEADXX)      echo"
mutate die "$LIBF" "PREPUSH_FULL=1 is ignored" \
  'replace::[ "${PREPUSH_FULL:-0}" = "1" ] && { echo=>[ "${PREPUSH_FULL:-0}" = "9" ] && { echo'
# The protected-branch check now has TWO layers: a substring probe and a
# structural one that parses each word as a refspec. The structural layer
# SUBSUMES the substring layer, so mutating the substring probe alone can no
# longer kill -- and a mutation that cannot kill is not evidence. The contract
# therefore targets the structural layer, which alone carries `+main` and
# `refs/heads/main`. The substring probe is retained as deliberate redundancy on
# a control whose failure mode is running a SCOPED gate on a prod-deploy trigger.
mutate die "$LIBF" "the structural refspec probe stops recognising a protected branch" \
  'replace::      main|master|release/*)=>      mainXX|masterXX|releaseXX/*)'
mutate die "$LIBF" "--all/--tags no longer force the full round" \
  'replace::    *--all*|*--mirror*|*--tags*|*--follow-tags*)=>    *--allXX*|*--mirrorXX*)'
mutate die "$LIBF" "an unobtainable git range reports success instead of failing" \
  'replace::  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || return 1=>  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || { echo docs/fake.md; return 0; }'
mutate die "$LIBF" "rename detection hides the SOURCE path of a git mv (#388 blocker 1)" \
  'replace::  git -C "$root" diff --no-renames --name-only "$range" 2>/dev/null || return 1=>  git -C "$root" diff --name-only "$range" 2>/dev/null || return 1'
mutate die "$HOOKF" "the mutation contract leaks into every full round (fail-open risk, #388 major 2)" \
  'replace::if leg_exact hook:pre-push-tests; then MUT_ARGS=(--mutations); fi=>if leg hook:pre-push-tests; then MUT_ARGS=(--mutations); fi'
# ...and the CONSUMER, which round 2 showed a decision-only mutation misses: if
# the invocation stops expanding MUT_ARGS, the seam still prints MUTATIONS while
# the round silently runs the plain cases.
mutate die "$HOOKF" "the call site stops passing the mutation flag (seam would still claim it did)" \
  'replace::  bash "$ROOT/.claude/hooks/pre-push-tests.test.sh" ${MUT_ARGS[@]+"${MUT_ARGS[@]}"} || return 1=>  bash "$ROOT/.claude/hooks/pre-push-tests.test.sh" || return 1'
mutate die "$HOOKF" "the hook ignores the selector and prints a fixed narrow set" \
  'replace::| prepush_select_legs)=>| true; echo " docs ")'
mutate die "$HOOKF" "the hook no longer fails closed when the range is unobtainable" \
  'replace::    SELECT_REASON="FULL — the changed-file list could not be computed; fail closed"=>    LEGS=" docs "'

echo "mutation contract: $MPASS killed, $MFAIL survived, $MBAD invalid"
[ "$MFAIL" -eq 0 ] && [ "$MBAD" -eq 0 ] || exit 1
