#!/usr/bin/env bash
# prepush-select-lib.sh — which legs of the pre-push gate can THIS DIFF break?
#
# WHY THIS EXISTS (#377). `pre-push-tests.sh` ran the ENTIRE gate on every push:
# backend pytest + ruff + mypy, all three Vitest projects, and ~10 script/hook
# self-tests — regardless of what changed. A two-file documentation commit paid
# 11m44s (measured) for suites its diff could not touch, on EVERY push, including
# the many small fix-ups a review round generates. Owner directive, 2026-09-14:
# "only changed code must be validated … no way to be patient anymore".
#
# THE POLARITY IS THE WHOLE DESIGN (lessons §18/§35/§46/§59: a gate nobody proved
# can fail is not a gate). Narrowing a gate is the exact shape of change that
# silently turns it off, so every ambiguity here resolves TOWARDS running more:
#
#   * the DEFAULT arm of the path map is `prepush_unmapped_path` → ALL. A path
#     nobody enumerated — a new top-level directory, a rename, a file this repo
#     does not have yet — selects the full gate. "I could not tell" is never
#     "skip";
#   * an EMPTY changed-file list selects ALL: "nothing changed" and "the diff
#     could not be computed" are indistinguishable here and the safe reading is
#     the second one;
#   * `prepush_always_legs` (the PII/de-brand guard) is added to every
#     selection: it is cheap and its failure mode is public;
#   * `frontend/projects/shared/**` selects ALL THREE Vitest projects, because
#     `public` and `admin` both consume `@beaconfolio/shared`;
#   * `.claude/hooks/hook-parse-lib.sh` selects EVERY hook self-test, because
#     all four hooks share that one parsing model (#237) — a regression there
#     shows up in a DIFFERENT hook's test;
#   * an unnameable branch, `--all`/`--mirror`/`--tags`/`--follow-tags`, and
#     PREPUSH_FULL=1 run everything (prepush_force_full_reason).
#
# PROTECTED BRANCHES SCOPE TOO (owner directive 2026-09-14, v1.14.2): "the push
# cannot be longer than 1-3 minutes — it must be related to the size of the
# committed code, not a README during 40 minutes." `main`/`release/*` used to
# force the full round regardless of the diff, which made every push to main —
# including a one-file text change — pay 30-40 minutes for suites its diff
# could not touch. The delta of a push to main (`@{push}..HEAD`) is EXACT, the
# same map applies, and CI runs every leg on every push to main anyway — the
# local full round duplicated CI 1:1. The fail-closed arms above are untouched.
#
# Every one of those rules is a one-line, individually mutable statement below,
# and `pre-push-tests.test.sh --mutations` kills each of them in turn. If you
# add a rule, add its mutation.
#
# Pure functions, no side effects: sourceable from the hook AND directly from
# the self-test, which is what makes the mapping unit-testable.

# --- leg vocabulary ---------------------------------------------------------
#   docs        CHANGELOG/README presence + version consistency + its self-test
#   pii         scripts/check_no_pii.sh (+ self-test)        — ALWAYS selected
#   compose     scripts/check_compose_env.sh (+ self-test)
#   migrations  scripts/check_migration_heads.sh (+ self-test)
#   freshness   scripts/check_live_freshness.test.sh
#   aiconfig    scripts/check_aiconfig_map.sh (+ self-test)
#   dedup       scripts/dedup_changelog_unreleased.test.sh (the history-rewriter's own test)
#   changelog   scripts/check_changelog_merge.sh (+ self-test) — the MERGED result vs origin/main (#391)
#   vaudit      scripts/audit_no_verdict_merges.test.sh (the no-verdict detector's own test, #392)
#   setup       setup.test.sh
#   edge        infra/edge/apply.test.sh (the shared-edge apply contract, #338)
#   hook:NAME   .claude/hooks/NAME.test.sh
#   backend     backend pytest (-n auto, --cov-fail-under=100)
#   lint        ruff check + ruff format --check + mypy + bandit
#   fe:cdsafety frontend ESLint over all 3 projects (eslint.config.mjs, #234 —
#               carries the cd-safety AST rule) + its mutation self-test
#   fe:shared / fe:public / fe:admin   the three Vitest projects, INDEPENDENTLY
#   fe:runner   scripts/run_frontend_suites.test.sh (the retry contract)
#   ALL         every leg — the fail-closed answer

# One-line rule bodies. Each is a mutation target; keep them one line.
prepush_unmapped_path() { echo ALL; }
prepush_always_legs()   { echo pii; }
prepush_backend_legs()  { printf 'backend\nlint\n'; }
prepush_fe_all_legs()   { printf 'fe:cdsafety\nfe:shared\nfe:public\nfe:admin\n'; }
prepush_fe_public_legs(){ printf 'fe:cdsafety\nfe:public\n'; }
prepush_fe_admin_legs() { printf 'fe:cdsafety\nfe:admin\n'; }
prepush_all_hook_legs() { printf 'aiconfig\nhook:guard-destructive\nhook:guard-stack-resources\nhook:pre-merge-gate\nhook:pre-push-tests\n'; }

# ---------------------------------------------------------------------------
# prepush_contract_legs <path>
#   CROSS-CUTTING contracts: files that feed a repo lint from OUTSIDE that
#   lint's own directory. These are ADDITIVE to whatever the main map returns,
#   and they are the subtlest way a scoped gate can stop noticing a real
#   breakage — the file looks like "just backend code" or "just a compose
#   tweak" while a whole-repo invariant hangs off it.
#
#   * VERSION CARRIERS — `bump_version.sh --check` (the `docs` leg) requires
#     seven files to agree; six of them live under backend/ or frontend/ and
#     would otherwise never run it. A mismatch fails CI's version-consistency
#     job and blocks every image build.
#   * DOCUMENTED-KNOB SOURCES — check_compose_env.sh derives its contract from
#     `backend/app/config.py` AND from the files that PROMISE a knob
#     (`.env.example`, `README.md`, `docs/DEPLOYMENT.md`, `setup.sh`). Adding a
#     Settings field, or documenting one, is exactly when #296/#297/#298
#     happened.
#
#   * LINT SCRIPTS select `aiconfig` too. The earlier reasoning — "the map check
#     asks whether every lint on disk has a row, and editing a lint cannot change
#     that" — holds for an EDIT but not for a DELETE (#388 review, minor): remove
#     `scripts/check_foo.sh` and the map now names a file that does not exist,
#     which is exactly what check_aiconfig_map.sh fails on. A rename is safe
#     because the new path is unmapped and selects ALL, but a pure deletion has
#     no new path to notice. The selector is deliberately pure — it never touches
#     the filesystem — so it cannot tell an edit from a deletion; `aiconfig` is a
#     sub-second bash lint, so it is added to both.
# ---------------------------------------------------------------------------
prepush_contract_legs() {
  case "$1" in
    VERSION|backend/app/main.py|frontend/package.json|frontend/package-lock.json|\
    frontend/projects/shared/package.json|frontend/projects/public/src/app/version.ts|\
    docker-compose.prod.yml)
      echo docs ;;
  esac
  case "$1" in
    backend/app/config.py|.env.example|README.md|docs/DEPLOYMENT.md|setup.sh|\
    docker-compose.yml|docker-compose.prod.yml)
      echo compose ;;
  esac
}

# ---------------------------------------------------------------------------
# prepush_legs_for_path <path>
#   Prints this path's leg tokens, one per line. Unmapped ⇒ ALL.
# ---------------------------------------------------------------------------
prepush_legs_for_path() {
  local p="$1" h
  p="${p#./}"                      # accept either spelling
  [ -n "$p" ] || return 0

  prepush_contract_legs "$p"

  case "$p" in
  # --- AI configuration surfaces (the CLAUDE.md map drift check, #246) ------
  CLAUDE.md) printf 'aiconfig\ndocs\n' ;;
  .claude/settings.json) echo aiconfig ;;
  .claude/agents/*|.claude/commands/*|.claude/skills/*) echo aiconfig ;;
  .claude/hooks/hook-parse-lib.sh) prepush_all_hook_legs ;;
  .claude/hooks/prepush-select-lib.sh) printf 'aiconfig\nhook:pre-push-tests\n' ;;
  .claude/hooks/*.sh)
    h="${p##*/}"; h="${h%.test.sh}"; h="${h%.sh}"
    case "$h" in
      guard-destructive|guard-stack-resources|pre-merge-gate|pre-push-tests)
        printf 'aiconfig\nhook:%s\n' "$h" ;;
      *) prepush_unmapped_path ;;   # a hook file with no self-test we know of
    esac ;;

  # --- repo-contract lints (scripts/) --------------------------------------
  scripts/check_no_pii.sh|scripts/check_no_pii.test.sh) printf 'pii\naiconfig\n' ;;
  scripts/check_compose_env.sh|scripts/check_compose_env.test.sh) printf 'compose\naiconfig\n' ;;
  scripts/check_migration_heads.sh|scripts/check_migration_heads.test.sh) printf 'migrations\naiconfig\n' ;;
  scripts/check_live_freshness.sh|scripts/check_live_freshness.test.sh) printf 'freshness\naiconfig\n' ;;
  scripts/check_aiconfig_map.sh|scripts/check_aiconfig_map.test.sh) echo aiconfig ;;
  scripts/dedup_changelog_unreleased.py|scripts/dedup_changelog_unreleased.test.sh) printf 'dedup\naiconfig\n' ;;
  scripts/check_changelog_merge.sh|scripts/check_changelog_merge.test.sh) printf 'changelog\naiconfig\n' ;;
  scripts/audit_no_verdict_merges.sh|scripts/audit_no_verdict_merges.test.sh) printf 'vaudit\naiconfig\n' ;;
  scripts/run_frontend_suites.sh|scripts/run_frontend_suites.test.sh) printf 'fe:runner\naiconfig\n'; prepush_fe_all_legs ;;
  scripts/check_e2e_hydration_barrier.sh|scripts/check_e2e_hydration_barrier.test.sh) printf 'e2ebarrier\naiconfig\n' ;;

  # --- compose / documented-knob contract ----------------------------------
  docker-compose*.yml|.env.example) echo compose ;;

  # --- version tooling (version consistency lives in the docs leg) ----------
  VERSION|bump_version.sh|test-bump-version.sh) echo docs ;;
  setup.sh|setup.test.sh) echo setup ;;

  # --- backend --------------------------------------------------------------
  backend/migrations/*|backend/alembic.ini) printf 'migrations\n'; prepush_backend_legs ;;
  backend/*.md|backend/docs/*) echo docs ;;
  backend/*) prepush_backend_legs ;;

  # --- frontend: PER PROJECT ------------------------------------------------
  # The lint config and its self-test affect only the eslint leg — running
  # three Vitest projects for a selector tweak buys nothing (#234).
  frontend/eslint.config.mjs|frontend/scripts/eslint-cd-safety.test.mjs) echo fe:cdsafety ;;
  # The e2e specs are not compiled or run by any Vitest project — a different
  # runner over a different tree — so they cannot break one. What they CAN break
  # is the SSR hydration-barrier contract, which reads exactly these files.
  frontend/e2e/*) echo e2ebarrier ;;
  frontend/projects/shared/*) prepush_fe_all_legs ;;
  frontend/projects/public/*) prepush_fe_public_legs ;;
  frontend/projects/admin/*) prepush_fe_admin_legs ;;
  frontend/*.md) echo docs ;;
  # Everything else under frontend/ — package.json, angular.json, tsconfig, the
  # e2e specs, the build scripts, a fourth project someday — can affect every
  # project, so it runs every project. Conservative on purpose.
  frontend/*) prepush_fe_all_legs ;;

  # --- infra: the shared edge as code (#338) --------------------------------
  # apply.sh's fail-closed contract (read-only default, stdin refusal, diff-
  # and-confirm, restore-on-failure) is pinned by its own stub-based self-test;
  # ~1s, no sudo/caddy/systemd needed, so it runs wherever the diff selects it.
  infra/edge/*) echo edge ;;

  # --- importer: the LinkedIn -> backend importer (#417) ---------------------
  # Its own suite is 15 tests in 0.04s, fully mocked (httpx patched, no network,
  # rule 10 clean), so it is cheap enough to run wherever the diff selects it.
  # Before #417 `importer/**` fell through to the unmapped default, which is the
  # worst of both outcomes: the push paid the FULL round AND never ran the one
  # suite that covers the diff. PR #415 shipped five regression tests for a
  # measured prod incident onto exactly that blind spot.
  importer/*) echo importer ;;

  # --- documentation --------------------------------------------------------
  # CHANGELOG.md is the one doc whose defect lives in the MERGED result, not the
  # branch (#391) — it selects the merged-changelog lint on top of the docs leg.
  CHANGELOG.md) printf 'changelog\ndocs\n' ;;
  docs/*|*.md) echo docs ;;

  # --- files no LOCAL leg can exercise (owner directive 2026-09-14) ---------
  # CI is the only test surface for a workflow file or a scanner/config text
  # file — running backend pytest and three Vitest projects for a
  # `sonar-project.properties` edit validates NOTHING about what changed (it
  # cost the owner a 40-minute round on a one-file push). These are ENUMERATED,
  # not unmapped: each still runs docs (doc presence + version consistency,
  # seconds) plus the always-on pii guard; `.mcp.json` is an AI-config surface,
  # so it runs the drift check instead.
  .github/*) echo docs ;;
  sonar-project.properties|.gitignore) echo docs ;;
  .mcp.json) echo aiconfig ;;

  # --- ANYTHING ELSE: fail closed ------------------------------------------
  # proxy/**, scraper/**, a brand-new top-level directory … none has a leg that
  # can exercise it, none is ENUMERATED above, and guessing "nothing" is how a
  # narrowed gate stops gating. (`importer/**` left this list in #417, when it
  # gained a leg of its own.)
  *) prepush_unmapped_path ;;
  esac
}

# ---------------------------------------------------------------------------
# prepush_select_legs
#   Reads changed paths on stdin (one per line). Prints the selected legs,
#   sorted and space-separated, WITH a leading and trailing space so callers
#   test membership with a plain `case "$LEGS" in *" backend "*)`.
# ---------------------------------------------------------------------------
prepush_select_legs() {
  local line legs="" any=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    any=1
    legs="$legs$(prepush_legs_for_path "$line")
"
  done
  [ "$any" = "1" ] || { printf ' ALL \n'; return 0; }
  legs="$legs$(prepush_always_legs)
"
  # ALL absorbs everything: one unmapped path in an otherwise narrow diff means
  # the whole gate runs, and the printed selection must SAY so rather than read
  # like a list somebody could mistake for the scoped set.
  case "
$legs" in *"
ALL
"*) printf ' ALL \n'; return 0 ;; esac
  printf ' %s \n' "$(printf '%s' "$legs" | grep -v '^[[:space:]]*$' | sort -u | tr '\n' ' ' | sed -E 's/ +$//')"
}

# ---------------------------------------------------------------------------
# prepush_force_full_reason <branch> <push-command-text>
#   Prints a human reason and returns 0 when the WHOLE gate must run regardless
#   of the diff; returns 1 when path selection may apply.
# ---------------------------------------------------------------------------
prepush_force_full_reason() {
  local branch="$1" cmd="${2-}"
  [ "${PREPUSH_FULL:-0}" = "1" ] && { echo "PREPUSH_FULL=1"; return 0; }
  case "$branch" in
    HEAD|'')     echo "branch could not be determined"; return 0 ;;
  esac
  # `main`/`release/*` — by NAME or by any refspec spelling — deliberately do
  # NOT force a full round any more (owner directive 2026-09-14, v1.14.2; see
  # the header). The delta of a push to main is exact (`@{push}..HEAD`), the
  # same path map applies to it, every fail-closed arm still fails closed, and
  # CI runs every leg on every push to main — the forced local full round
  # duplicated CI 1:1 at 30-40 minutes per push. The structural refspec parser
  # that recognised `+main`/`refs/heads/main` went with the rule it served.
  #
  # A push that publishes MORE than the current branch: --all / --mirror send
  # every branch (main included) and --tags / --follow-tags publish release
  # tags. The diff of ONE branch says nothing about what those carry.
  case "$cmd" in
    *--all*|*--mirror*|*--tags*|*--follow-tags*)
      echo "the push command publishes more than this branch"; return 0 ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------
# prepush_changed_files <repo-root>
#   Prints the paths this push would publish, one per line. Returns non-zero
#   when the range cannot be determined — the caller must then run everything.
#
#   Range preference (the issue's own recipe):
#     1. @{push}     — exactly what this push adds to the remote branch
#     2. @{upstream} — the same thing when there is no separate push ref
#     3. merge-base(origin/main, HEAD)..HEAD — a branch not yet on the remote
#   Anything else (no origin/main, a detached HEAD, not a repo) fails, and the
#   caller runs everything.
#
#   KNOWN LIMIT (#404 review round 1, minor 8): an explicit cross-branch
#   refspec (`git push origin HEAD:main` from a feature branch with some
#   commits already on origin/<feature>) measures what the TRACKED ref lacks,
#   not what the destination receives, so it can under-select. Accepted, not
#   fixed: the common spelling lands on the empty-diff ⇒ ALL arm, rule 3
#   forbids pushing feature work to main at all, and CI + branch protection
#   run every leg on what main actually receives.
# ---------------------------------------------------------------------------
prepush_changed_files() {
  local root="$1" range="" base=""
  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || return 1
  if git -C "$root" rev-parse --verify --quiet '@{push}' >/dev/null 2>&1; then
    range='@{push}..HEAD'
  elif git -C "$root" rev-parse --verify --quiet '@{upstream}' >/dev/null 2>&1; then
    range='@{upstream}..HEAD'
  else
    base="$(git -C "$root" merge-base origin/main HEAD 2>/dev/null)" || return 1
    [ -n "$base" ] || return 1
    range="$base..HEAD"
  fi
  # --no-renames is LOAD-BEARING, not tidiness (#388 review, blocker 1).
  # With rename detection on — git's default, and also whatever `diff.renames`
  # happens to be set to in the developer's config — a rename reports ONLY the
  # destination path:
  #
  #   R100 frontend/projects/admin/…/foo.ts -> frontend/projects/public/…/foo.ts
  #   default     -> frontend/projects/public/…/foo.ts
  #   --no-renames-> BOTH paths
  #
  # So `git mv` from admin/ to public/ would select the public legs and never
  # run `admin` — which has just lost the module its specs import. The same
  # erases the version-consistency leg when a version carrier is renamed. Worse,
  # it is config-dependent: two developers get different coverage from the same
  # diff. Listing both endpoints can only ever select MORE legs, which is the
  # correct direction for a gate.
  git -C "$root" diff --no-renames --name-only "$range" 2>/dev/null || return 1
}
