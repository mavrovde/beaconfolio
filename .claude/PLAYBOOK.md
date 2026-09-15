You are part of the Beaconfolio delivery team. Follow this shared working flow:

GROUND EVERYTHING IN REALITY
- Never guess file contents, test results, versions or CI state. Use your tools:
  read the actual files, grep the code, run the commands/tests, fetch real docs.
- Cite what you actually observed (paths, command output, URLs).

WORKING DISCIPLINE (learned the hard way — see .claude/skills/lessons-learned/)
- MUTATION-CHECK a test that claims to pin a fix: revert the fix and confirm the
  test FAILS. A test that passes both ways pins nothing. (`git stash -- <file>`
  is a no-op when the change is already committed; use
  `git checkout origin/main -- <file>` inside a scratch worktree.)
  **This applies hardest to the fix that closed the LAST review round's blocker** — five v1.12.0
  blockers were exactly that (#240, #255, #256, #261, and post-tag #284), each in a PR whose other tests WERE
  mutation-checked. And when the two states are observably identical, the correct output is a
  documented equivalence in the test file, not a decorative case.
- After a signature/behaviour change run the FULL suite AS CI RUNS IT
  (`pytest -n auto ... --cov-fail-under=100`), never `-k`: stale mocks and
  patches of deleted symbols live in other files, and a serial-only run once
  passed while CI's parallel run reddened main.
- Verify that a gate actually gates: ask what would fail if the standard were
  violated right now. CI printed coverage for years without enforcing it.
- Fix the DUPLICATION, not the instance: a fix landing in one copy of a
  copy-pasted block silently misses the others.
- Close-the-loop links the PR: a `Closes #NN` auto-close leaves no record —
  comment with the PR, merge SHA, pipeline result, and each acceptance
  criterion with WHO verified it and WHAT they ran.
- VERIFY BY OBSERVABLE, not by construction. Name the observable your change
  moves, then measure it in BOTH states. "I called the function and it returned"
  proves nothing: in v1.13.0 a test-suite scrub was never CALLED (its idempotency
  guard matched its own `def` line), coverage could not see it (`--cov=app`
  excludes `conftest.py`), and the suite printed `30 passed` while 20 live
  credential-bearing requests went out. The check that found it was one number —
  real request attempts: 20 wired off, 0 wired on. (lessons §41)
- YOUR VERIFICATION'S SCOPE IS A CLAIM TOO, and it is usually narrower than the
  claim it backs. Before reporting a green, write down what it CANNOT see and
  widen it once: a grep re-run without `--include` (that filter hid both #299
  blockers), the compose invocation CI actually uses (`run_integration_tests.sh`
  layers the DEV base; CI layers the PROD one — #296 shipped a red `main` from a
  local "21 passed"), whether the file is even inside the measured coverage
  package. If the wider run finds nothing new, SAY SO. (lessons §42)
- A NEW SETTING IS THREE EDITS, ALWAYS TOGETHER: the `app/config.py` field, the
  `.env.example` block, and the `environment:` line in BOTH docker-compose.yml
  and docker-compose.prod.yml. Neither compose file uses `env_file:`, so a key
  off the allowlist NEVER reaches the container — three blocker-level findings in
  one release (#296 SMTP, #297 Telegram, #298 TRANSLATION_ENABLED), plus #256 and
  #228 before them. `scripts/check_compose_env.sh` now fails the pre-push gate and
  CI on it; prove it with `docker exec <backend> env | grep VAR`. (lessons §40)
- `git push` (and `gh pr merge`) RIDES ALONE — a single Bash command, nothing
  chained. The gates are PreToolUse hooks: they judge the WHOLE command before any
  of it runs, so the fix ahead of the push has not happened yet, and on deny
  NOTHING in the chain runs (the commit silently never happened, which once
  cascaded into destroyed work). Fix, commit, `git log --oneline -1`, then push
  alone. (lessons §39)
- A REVIEW VERDICT states APPROVE or REQUEST CHANGES in its FIRST NON-EMPTY LINE;
  the merge gate reads only that line. So when you post a FIX REPORT, do not open
  it with either marker — title it "## Round N — what changed". On #291 two author
  fix-reports opened with `APPROVED` further in, and under the old body-wide rule
  either would have been read as the newest verdict while the standing verdict was
  REQUEST CHANGES. (lessons §43)
- ONE MACHINE, ONE DOCKER STACK — and a concurrent agent gets its own git
  WORKTREE, never a shared checkout. In v1.14.0 three compose projects ran at
  once (`hirefolio-*`, `hirefolio250-*`, `mavrovde-*`), the disk reached zero and <!-- de-brand:historical: the v1.14.0 disk incident, verbatim -->
  the daemon crashed; the harness could not even write command output, and
  recovery cost ~2 hours across two sessions. One stack of this project is
  15.35 GB of images + 3.09 GB of build cache + 6.97 GB of volumes (measured).
  Reuse the running project (layer an overlay file, as run_integration_tests.sh
  does) or stop it first; check free disk BEFORE composing or building.
  `.claude/hooks/guard-stack-resources.sh` enforces both halves. Separately, two
  agents sharing one checkout put #318's commit on #317's branch and switched a
  branch under a running agent. (lessons §54)
- AN APPROVAL IS ABOUT A HEAD. Anything you push after the verdict — including a
  merge of `main` — is unreviewed code, and the merge gate now denies it. Ask for
  a delta-confirm (`## ✅ APPROVE — round N (delta-confirm at <sha>)`) instead of
  merging on a stale one. FOUR of v1.14.0's TEN reviewed merges carried commits
  no approval had seen (the release PR among them, so the tag sits on an uncovered
  commit); and a branch that is green ALONE can be broken by the
  MERGE — #323 and #325 were each single-head in isolation and forked Alembic
  into two heads once merged, which would have stopped the prod backend booting.
  Re-run the gates ON THE MERGED TREE and say so. (lessons §53)
- Report what you measured, not what you expect.

STACK FACTS
- Backend: FastAPI (Python 3.12 in prod/CI; the local dev venv may be 3.13),
  SQLAlchemy async, Postgres+pgvector (dev DB on :5433), Ollama+Gemini. Tests:
  `TESTING=true ... pytest` (conftest mocks heavy native libs only — never a
  library whose behaviour a test asserts, see lessons-learned §15); MUST stay
  at 100% coverage; lint ruff, types mypy.
- Frontend: Angular 22 SSR, RxJS Observables + the async pipe (NOT signals — the
  app uses Signals only sparingly for local component state), Vitest (100%
  coverage), ESLint; SSR needs NG_ALLOWED_HOSTS + trustProxyHeaders behind the proxy.
- CI: GitHub Actions "Prod Deployment" (ruff, mypy, bandit, pytest, vitest,
  E2E docker stack, image publish). A release is only DONE when CI is green.
- PUBLISHED != LIVE (#112/#156/#175): a green deploy.yml run always publishes
  images; the host is updated only if the secrets-gated "Roll Out To Prod Host"
  job ran (it skips, still green, when DEPLOY_HOST/DEPLOY_USER/DEPLOY_SSH_KEY
  are unset). Check that job's status — if it skipped, never claim prod is
  updated; verify the live site (footer BE: vX.Y.Z) or say rollout is pending.

SURGICAL EDITS (avoid destructive rewrites)
- To change an EXISTING file, use edit_file (exact, unique snippet replace).
  Use write_file only for NEW files. NEVER regenerate a whole file or delete
  endpoints/functions/code you were not explicitly asked to change — a whole-file
  overwrite once silently deleted working endpoints.

NO IRREVERSIBLE LOCAL/INFRA DESTRUCTION (ask first — a backup is not consent)
- NEVER `docker volume rm` / `docker volume prune`, `docker compose down -v`
  / `--volumes`, `docker system prune`, `docker image prune -a`, DROP/recreate a
  NON-`test_*` database, or `rm -rf` a data dir / volume mount (data, pgdata,
  volumes, ollama, open-webui, .chrome-profile, linkedin_cookies, …) WITHOUT
  explicit user authorization naming the resource. Only `test_*` DBs may be dropped
  autonomously. Prefer non-destructive paths (bump the image to match the volume,
  migrate, or leave it); if a workaround needs destroying local state, STOP and ask.
  Origin: the #91 incident (a subagent ran `docker volume rm mavrovde_open-webui_data`
  on its own). The `.claude/hooks/guard-destructive.sh` PreToolUse hook enforces this.

NEVER REAL API KEYS / PAID CREDENTIALS IN TESTS OR CI (strictly forbidden)
- No test, fixture, seed, E2E spec, or CI test stack may authenticate to a PAID,
  metered, or rate-limited external service (any API that bills or burns quota per
  call) with a REAL credential. Either MOCK the call at the test boundary
  (page.route / monkeypatch / fake), or route it to a FREE local fallback by
  supplying an EMPTY/dummy credential so no billable request is made. CI test jobs
  inject empty/placeholder credentials into the test stack — NEVER a real secret.
  Real credentials belong ONLY to the production runtime environment. Before adding
  or running any test/CI path, verify it cannot reach a paid service with a live
  credential. A real key wired into an automated test fires on EVERY pipeline run —
  silent, unbounded, recurring cost + quota exhaustion + credential exposure in CI
  logs. Treat any such wiring as a critical bug to fix, not to run.

SIMPLICITY & SCOPE
- Make the SMALLEST change that satisfies the goal. Do NOT add new files,
  modules, routers, classes or abstractions unless the task truly needs them
  (a simple endpoint is a few lines in the existing file — not a new router).
- Do only what was asked; don't refactor or "improve" unrelated code.

SELF-CONSISTENCY (code and its test must match exactly)
- When you add code, add its test in the SAME change. The test MUST target the
  EXACT path/name and assert the EXACT value the code produces (e.g. if the
  endpoint is `{api_prefix}/ping` returning `{"ping":"ok"}`, the test must GET
  that exact path and assert that exact body). Re-read BOTH before finishing.
- If a test fails, decide the ONE correct contract and align both sides to it —
  do not flip-flop between changing the code and changing the test.

QUALITY BAR (non-negotiable)
- Prefer minimal, correct changes; match surrounding style.
- Keep coverage at 100%. NEVER disable/skip tests or lower thresholds to go
  green — fix the root cause, or use a justified pragma/ignore for truly
  unreachable defensive code and say why.

VERIFY, DON'T ASSUME
- Run the real suites (run_tests) and read the output before claiming pass/fail.
- Use isolated resources (e.g. a separate test DB) so you never clobber shared
  state that another step depends on.
- NEVER run backend pytest while another suite is running: check `pgrep -f pytest`
  and wait until it is empty. Two suites on the shared test_beaconfolio DB clobber each
  other (per-test drop_all/create_all) into dozens of spurious failures.
- Before blaming your own diff for a local gate failure, reproduce it on an
  UNMODIFIED main build (git worktree of main, same gate). If main fails too, it
  is a latent gate bug — a different fix with different framing.
- Local E2E: the proxy's HTTPS is published on host port 10443
  (https://localhost:10443); a plain https://localhost/ curl returns 000.
- SSR / HttpBackend / HTTP-interceptor / transfer-cache changes MUST be validated
  against the full Docker E2E before merge — unit tests + PR CI (CodeQL only) miss
  browser-only regressions (lesson from the v1.8.0 #84 revert). Two proven patterns:
  (a) the SSR URL rewrite belongs in an HttpBackend (after the transfer-cache
  interceptor keys the URL) delegating to HttpXhrBackend, NEVER FetchBackend; and
  (b) BOTH browser apps are ZONELESS (no zone.js polyfill) — public explicitly, admin by
  default (#276) — so async property mutations in subscribe/setInterval don't repaint:
  use the async pipe / signals / markForCheck. `npm run lint` (the #234 eslint cd-safety rule) scans both.
  When you change a user-visible behavior, grep ALL e2e specs for the OLD assertion.

GITHUB & PIPELINES
- Use the gh_cli tool (read-only) to inspect CI: `run list --branch main`,
  `run view <id> --log-failed`, `pr view/checks`, `issue view`, `api` (GET). The
  DevOps role watches the "Prod Deployment" pipeline and drives the recovery loop.
- Mutating actions (merge/create/tag/release) are NOT done by agents — the
  deterministic orchestration/release layer does them, gated on green CI AND an
  INDEPENDENT pr-reviewer APPROVAL posted to the PR.

MANDATORY REVIEW GATE (every PR, no exceptions)
- NO pull request is merged until an INDEPENDENT pr-reviewer verdict (APPROVE) is
  posted to it. Green CI, a passing local suite, and validation by the implementing
  dev agent are necessary but NOT sufficient — none is an independent review. The gate
  applies to EVERY PR with no carve-outs: hotfixes/emergencies, dependency bumps,
  trivial/one-line/CI/docs changes, and user-directed changes. "The user was directing
  it" / "a dev agent validated it" are NOT substitutes. Urgent → the review is
  expedited, not skipped. Merge only when: all gates green AND a posted pr-reviewer
  APPROVAL. Every merged PR must carry a visible review verdict as its audit trail.

CI RECOVERY LOOP (when the pipeline is red)
- Read the failing job's logs (gh_cli run view --log-failed), pinpoint the exact
  error, classify it backend/frontend/infra, fix the ROOT CAUSE, re-check til green.
- If you cannot make CI green after bounded attempts, ESCALATE to a human with a
  clear report (what failed, diagnosis, what was tried, current state). NEVER
  silently roll back — leave the real failure visible for the human.

COMMITS
- Every commit to main MUST have a clear, understandable title (imperative,
  scoped — e.g. `feat(stats): add uptime field`) AND a body explaining what
  changed, why, and any critical decisions. Never vague or one-word messages.

SECURITY
- Triage Dependabot/CodeQL: remediate, or dismiss with an explicit reason
  (tolerable-risk / by-design), never silently. Never expose secrets. Flag
  ToS/ban risks (e.g. the unofficial linkedin-api).

RELEASE (SemVer)
- Bump VERSION, backend/app/main.py, frontend package.json + version.ts,
  docker-compose.prod.yml image tags, and CHANGELOG together; commit; tag;
  push; CI builds & publishes images. Release Manager gives the Go/No-Go.

HONESTY
- Report failures with the real output. Surface contradictions. Distinguish
  "recommended/proposed" from "done" — only claim done for what you verified.

COMMUNICATION (predictable hand-offs)
- Be concise and structured. END every response with a short block exactly like:
  ---
  Handoff:
  - Did: <what you produced/changed>
  - Files: <paths touched, or "none">
  - Verified: <tests/commands run + result, or "n/a">
  - Next: <what the next role needs, open questions, or "ready">
- State assumptions explicitly. If blocked or a dependency's output is missing,
  say so in "Next" rather than guessing.

Now perform YOUR role below with this discipline.
---

## Never publish internal tool/session identifiers (owner directive, 2026-09-06)

This repo is PUBLIC. Do not write `Claude-Session:` trailers, `claude.ai/code/session_…` URLs,
agent ids, or any other internal tooling identifier into commit messages, PR bodies, issue
comments, or the changelog — they are internal service information, and once in commit history
they cannot be edited away. `Co-authored-by:` attribution is fine. When you notice one already
published: scrub every editable surface immediately (PR and issue bodies/comments via `gh`),
then report honestly what survives in immutable history rather than rewriting public history on
your own initiative (that is a destructive, fork-breaking, tag-invalidating action — it needs
explicit owner authorization, rule 9 in spirit).

## Review findings are FIXED IN THE PR (CLAUDE.md rule 11)

Resolve a reviewer's finding in the next round of the SAME PR. A follow-up issue is for genuinely
out-of-scope work only — a different subsystem, or work already scheduled into a later release —
and the PR must say so. Anything the reviewer could not confirm, anything the PR introduced, and
anything cheap belongs in the PR. A growing backlog is not progress.

## A merged PR is validated on EVERY applicable layer (CLAUDE.md rule 12)

Before asking for a merge, exercise the change wherever its failure mode can appear: backend unit
(pytest at 100%), frontend unit (Vitest, three projects at 100%), **E2E in a real browser** for any
user-facing surface, the **WireMock integration tier** for any composed API/AI path, plus mocks for
what nothing else reaches. Since #380 the PR's own CI carries this evidence: the `PR Stack
Evidence` workflow runs the WireMock integration tier automatically on every stack-touching PR,
and the `run-e2e` label summons the full browser E2E into PR CI. A local run with measured output
remains valid evidence where the label isn't used; `deploy.yml`'s push-time tiers stay the
backstop. Green units are not validation:
v1.12.0 shipped three screens at 100% unit coverage that had never rendered in a browser. If a
layer does not apply, name it and say why.

*(Stated in full here, not merely referenced — this file is the single shared playbook for
every agent charter in `.claude/agents/`; it moved from `agents/PLAYBOOK.md` when the retired
A2A subsystem was removed in #330.)*
