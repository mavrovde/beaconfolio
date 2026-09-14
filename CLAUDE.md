# CLAUDE.md — Beaconfolio (repo: mavrovde/beaconfolio; the maintainer deploys it at beaconfolio.com)

Primary AI configuration for this repository. **Claude (Claude Code) is the main AI tool for
this project.** This file is the single source of truth for how AI assistants work here; the
legacy per-tool rule files (`.cursorrules`, `.windsurfrules`, `.cline.md`, `.geminirules`,
`AI.md`, `.clauderules`) now just point back here.

---

## What this project is

Personal portfolio + blog with semantic search and local AI. A LinkedIn → beaconfolio.com content
pipeline moves posts (and profile data) into the site.

- **Frontend**: Angular 22 (standalone components, **RxJS Observables + `async` pipe** for state,
  native SSR via `server.ts`), TailwindCSS 4, Vitest 5 (unit), Playwright (E2E).
- **Backend**: FastAPI (runs on **Python 3.12** in prod/CI; local dev venv may be 3.13),
  SQLAlchemy 2 async, PostgreSQL 16 + `pgvector`, Ollama (local LLM/embeddings).
- **Infra**: Docker Compose (`db`, `ollama`, `backend`, `frontend`, `proxy`, `open-webui`),
  GitHub Actions (`.github/workflows/deploy.yml`) which is the **prod deploy** (push to `main`).

## Repository map

```
backend/    FastAPI app (app/api, app/services, app/models); tests/; conftest.py mocks heavy native libs
frontend/   Angular 22 workspace — projects/public (SSR visitor app), projects/admin (CSR admin SPA),
            projects/shared (@beaconfolio/shared lib); Vitest (per-project) + Playwright (public-e2e/admin-e2e)
scraper/    LinkedIn scrapers — scrape-linkedin.js (profile) + scrape-posts.js (posts) → *_data.json
importer/   Standalone LinkedIn → backend importer (POSTs to /api/app/linkedin/import-post)
proxy/      Reverse proxy config
scripts/    Repo-contract self-checks (live-freshness gate, PII guard) shared by pre-push + CI
```

## Commands (run these; don't guess)

**Backend** (`cd backend`, venv at `backend/venv`):
- Tests: `pytest` (needs Postgres on `127.0.0.1:5433`; `TEST_DATABASE_URL`/`DATABASE_URL` → a `test_*` DB)
- Lint/format: `ruff check .` && `ruff format --check .`
- Types: `mypy app --ignore-missing-imports --no-error-summary`
- Security: `bandit -r app -ll --skip B101`

**Frontend** (`cd frontend`) — Angular workspace, 3 projects (`public`, `admin`, `shared`):
- Tests (100% coverage each): `npm run test:coverage` (all) or `npm run test:{shared,public,admin}`
- Build: `npm run build` (all) or `npm run build:{shared,public,admin}`. `shared` must build before the apps.
- Serve: `npm start` (public, :4200) · `npm run start:admin` (admin, :4300)
- Shared code lives in `@beaconfolio/shared`; apps consume it via the `SHARED_ENVIRONMENT` +
  `AUTH_TOKEN_PROVIDER` injection tokens (public passes a null token; admin wires it to AuthService).

**Full stack / verify / release**:
- `./manage.sh start|stop|logs` — Docker stack
- `./verify_all.sh` — full suite incl. Docker E2E (runs backend pytest via `backend/venv` → `python3`;
  override the interpreter with `PYTEST_PYTHON`)
- `./run_integration_tests.sh` — black-box integration tier (#260): dev compose +
  `docker-compose.inttest.yml` (the `ollama` service becomes **WireMock**), real-HTTP tests in
  `backend/tests_integration/` incl. AI fault injection; volumes never touched
- `./backend/perf/run_jmeter.sh` — JMeter performance smoke with EXECUTABLE latency budgets
  (Dockerized, no local Java; non-zero exit on budget violation); see `README_TESTING.md`
- Deploy = **push to `main`** → GitHub Actions builds + publishes images; the host is rolled
  **only** by the secrets-gated `Roll Out To Prod Host` job (`DEPLOY_*` secrets — absent = green run,
  nothing rolled; #112/#169). The scheduled `Live Freshness` workflow goes red whenever live ≠
  released. `release.sh --patch|--minor|--major` bumps version + tags + pushes.

**LinkedIn pipeline** (see `importer/README.md`, `scraper/WORKFLOW.md`):
- Scrape: `cd scraper && PLAYWRIGHT_CHANNEL=chrome HEADLESS=false node scrape-linkedin.js` (profile)
  and `node scrape-posts.js` (posts). Session lives in `scraper/.chrome-profile/` (gitignored).
- Import: `BEACONFOLIO_API_URL=... LINKEDIN_IMPORT_TOKEN=... python -m importer [--dry-run] [--publish]`.
  Upserts by LinkedIn URN (idempotent); imported posts are drafts by default.

## Claude Code tooling in this repo

**AI-config map** (#121) — the tooling surface at one glance (update this table in the same PR
that adds or removes a tool; the #232 drift-check pattern is the model if it keeps going stale):

| Kind | Name | Purpose |
|---|---|---|
| agent | `backend-dev` | reproduce → fix → verify backend (Python/FastAPI) diagnoses; delivers via PR |
| agent | `frontend-dev` | same for Angular/TS frontend |
| agent | `devops-pipeline` | babysit the prod pipeline after a merge; classify failures, brief dev agents |
| agent | `pr-reviewer` | independent review verdict on every PR (rule 13 merge gate) |
| agent | `release-manager` | assemble + ship a release end-to-end (SemVer by content, green pipeline, tag) |
| agent | `security-triage` | CodeQL/Dependabot/secret-scanning triage every release |
| agent | `issue-author` | turn a rough idea into a grounded, criteria-complete GitHub issue |
| agent | `ai-integration` | Claude expert: mines agent-run evidence, teaches the other agents, keeps the AI config + AI product surface current |
| command | `/verify` | full local gates the way CI runs them (backend + frontend + Docker E2E) |
| command | `/release` | release runbook mirroring `release.sh` |
| command | `/issue-triage` | sweep the backlog for orphan issues (milestone/priority/area) |
| command | `/linkedin-sync` | scrape LinkedIn profile+posts → import into the backend |
| command | `/deploy-status` | true deploy state: pipeline + published + LIVE version + verdict (#120) |
| command | `/e2e` | the known-good Docker E2E loop (#117) |
| command | `/retro` | release retrospective: turn the shipped release's evidence into config changes (mandatory release step) |
| command | `/prep-pr` | pre-PR hygiene gate: stale-main, CHANGELOG dup, stale assertions (#119) |
| skill | `issue-workflow` | issue/PR/milestone/label flow with copy-paste `gh` commands |
| skill | `lessons-learned` | committed do-not-repeat KB — consult before SSR/pytest/CI-cache/release/destructive work |
| skill | `release-retro` | the retrospective method: five questions, finding→action classification, the no-change-must-say-why rule |
| skill | `ssh-deploy` | panel-free rollout loop on the SHARED prod host: failure→diagnosis per rollout step, cert renewal, multi-tenant do-not-touch (#310) |
| skill | `e2e-validation` | the E2E loop + its traps, for agents (#117) |
| skill | `env-gotchas` | macOS/BSD/gh platform pitfalls (#119) |
| skill | `ssr-cd-safety` | zoneless repaint + SSR HTTP contract (#118) |
| hook | `pre-push-tests.sh` | PreToolUse Bash: fast diff-scoped contract checks + formatting/compilation confirmation (ruff, per-project `tsc --noEmit`) before every real `git push`, HARD sub-minute budget — deep suites (pytest/mypy/bandit/Vitest) run in CI + at merge time, `PREPUSH_DEEP=1` opts in locally (command-position aware, #237), SCOPED TO THE DIFF since #377 — and since v1.14.2 on EVERY branch including `main` (owner directive 2026-09-14: push cost tracks the diff; CI runs every leg on every `main` push and is the full backstop); `PREPUSH_FULL=1` forces the full round; since #353 a push of a DIFFERENT repository (the wiki) passes through, but only when that is positively established; since #406 a real push CHAINED after a HEAD-moving git command (`commit`/`merge`/`rebase`/…) is DENIED outright — the hook fires before the chain runs, so it would vet the WRONG commit (lessons §65) |
| hook | `guard-destructive.sh` | PreToolUse Bash: blocks irreversible local/infra destruction (rule 9) |
| hook | `pre-merge-gate.sh` | PreToolUse Bash: refuses `gh pr merge` without an APPROVE verdict, with an APPROVE that predates the head, or with `Closes #NN` against unticked criteria (rule 13 enforced, not asked); a `PR_MERGE_GATE=0` bypass is allowed but never invisible — it appends to a local audit log and posts a PR comment (#392) |
| hook | `guard-stack-resources.sh` | PreToolUse Bash: free-disk floor + ONE Docker compose project before any `up`/`build`/`run`/`pull` (v1.14.0 retro — three parallel stacks crashed the daemon) |
| hook | `hook-parse-lib.sh` | the ONE quote-aware command-parsing model, sourced by all four hooks (#237) |
| hook | `prepush-select-lib.sh` | the diff→leg map the pre-push gate selects with; the default arm, an empty diff and an unobtainable range all select ALL, and every rule is killed by `pre-push-tests.test.sh --mutations` (#377) |
| tooling | `scripts/dedup_changelog_unreleased.py` | run after ANY rebase touching `CHANGELOG.md` (via `/prep-pr` step 2): merges duplicated `[Unreleased]` sections and drops repeated ENTRIES — a heading-only check passes while entries are doubled (#354/#362 each cost a round). Never loses content: unrecognised headings, preamble text and fenced code are preserved; self-test in the pre-push gate |
| lint | `scripts/check_compose_env.sh` | every documented `Settings` knob must reach the backend container in BOTH compose files — pre-push + CI (v1.13.0 retro; #296/#297/#298 each shipped this bug) |
| lint | `scripts/run_frontend_suites.sh` | runs the Vitest projects independently and retries ONCE on the worker-teardown race (present on 4.x AND 5.x, #309); replaces `npm test` in the pre-push gate AND wraps each frontend job in CI (#319) |
| lint | `scripts/check_live_freshness.test.sh` | self-test for the one live-vs-released verdict script shared by Live Freshness + the post-rollout gate; pins the 3-way verdict and staleness-beats-outage precedence — pre-push + CI (#280) |
| lint | `scripts/check_migration_heads.sh` | exactly ONE Alembic head in the working tree UNIONED with `origin/main` — pre-push + CI (v1.14.0 retro; #323/#325 forked the chain only in the merged result, which would have stopped the prod backend booting) |
| lint | `scripts/sonar_local.sh` | LOCAL SonarQube quality gate — dockerized Sonar + scanner as a plain named container (no compose, so the one-stack guard is uninvolved), exits by the gate verdict; `--down` removes only its own container (#359) |
| lint | `scripts/check_no_pii.sh` | no real PII and no retired brand/domain may reach the public repo — pre-push + CI; the exclude-list fails CLOSED, and `de-brand:canonical`/`de-brand:historical` markers exempt deliberate records (#330) |
| lint | `scripts/check_changelog_merge.sh` | the `[Unreleased]` collision exists only in the MERGED result — this validates the REAL merge (`git merge-tree`, the machinery `gh pr merge` runs) of HEAD with `origin/main`: one `[Unreleased]`, no duplicate `### ` heading, no released heading deleted (#365), no lost entry line; conflicts fail with rebase-first. Pre-push (`changelog` leg, selected by `CHANGELOG.md` diffs) + CI; mutation contract 5/0/0 (#391, v1.14.1 retro change A) |
| lint | `scripts/audit_no_verdict_merges.sh` | rule-13 detector for the half no hook can reach: finds merged PRs with NO canonical verdict (first-non-empty-line APPROVE/REQUEST CHANGES over reviews+comments). Run red-when-dirty by the scheduled `Verdict Audit` workflow since the 2026-09-14 cutover (#321/#355 merged verdict-less via the WEB UI, where PreToolUse hooks don't exist); self-test with live-path stub cases and a mutation contract in the pre-push gate + CI (#392) |
| lint | `scripts/check_live_freshness.sh` | the ONE live-vs-released verdict (0 fresh / 1 stale / 2 unreachable, staleness beats outage) shared by the Live Freshness workflow and deploy.yml's post-rollout gate (#169/#254) |
| lint | `scripts/check_aiconfig_map.sh` | the AI-config map below must describe the tooling that actually EXISTS — every agent/command/skill/hook/lint has a row, every row names a real file, every enabled plugin has a row AND a rationale, prose counts match the table; pre-push + CI + `verify_all.sh` (#246 — the map had no guard and drifted silently) |
| plugin | `context7`, `pyright-lsp`, `typescript-lsp`, `security-guidance` | per-plugin keep-rationale in "Plugins" below (#122); `frontend-design` and `playwright` were dropped |
| MCP | `postgres`, `playwright`, `github`, `sonarqube` | read-only SQL / browser automation / PRs+issues / quality-gate + issue lookup without leaving the terminal |

- **MCP servers** (`.mcp.json`): `postgres` (read-only SQL on the pgvector DB), `playwright`
  (browser automation), `github` (PRs/issues), `sonarqube` (quality gate + issue lookup against
  SonarCloud, so a Sonar finding can be read and fixed without leaving the terminal). Approve on
  first use. Three things about the Sonar entry are deliberate and easy to get wrong:
  - **It needs a SonarCloud USER token.** A project or global analysis token — the kind generated
    for CI — is rejected by the MCP server. The CI `SONAR_TOKEN` secret and this one may therefore
    have to be different tokens even though both live under the same name locally.
  - **No token is committed.** The values expand from the SHELL environment
    (`SONAR_TOKEN`, `SONAR_ORGANISATION`), reusing the names `.env` already defines rather than
    introducing `SONARQUBE_*` duplicates. `.env` is not auto-loaded into Claude Code's environment,
    so they must be exported (shell profile, direnv, or `set -a; . ./.env; set +a`) before the
    server can start.
  - **It runs a container with `--pull=always`.** That is a plain `docker run`, not compose, so
    `guard-stack-resources.sh` is uninvolved (same reasoning as `scripts/sonar_local.sh`) — but it
    does re-pull on every start, which is a disk cost the one-stack guard will not warn about.
- **Subagents** (`.claude/agents/`): all eight — `backend-dev`, `frontend-dev`, `devops-pipeline`,
  `pr-reviewer`, `release-manager`, `security-triage`, `issue-author`, `ai-integration` — see the
  AI-config map above for one-line purposes. **`ai-integration` is the improvement loop**: run it
  after a release or a painful incident to turn measured agent behavior (review rounds, effort
  telemetry, incidents) into edits to the charters/skills/hooks themselves.
- **Hooks** (`.claude/hooks/`, via committed `.claude/settings.json`, all `PreToolUse Bash`):
  `pre-push-tests.sh` gates every real `git push` under a **HARD sub-minute budget** (owner
  constraint 2026-09-14: "push cannot be longer than 1 minute. Never ever."): it runs the fast,
  diff-scoped contract checks (docs/version, PII, repo lints, hook self-tests) **plus a
  formatting/compilation confirmation on the code the diff touches** (owner directive
  2026-09-14: "for simple push … formatting, compilation, something easy"): ruff check/format
  on backend Python (~0.1s) and per-selected-project `tsc --noEmit` on frontend TS (~1s each),
  while the deep legs — backend pytest, mypy/bandit, the Vitest projects — run in CI on every
  push/PR and at merge time instead; `PREPUSH_DEEP=1` opts a push into running them locally
  (env-configurable: `PREPUSH_RUN_LINT`/`PREPUSH_RUN_RUFF`/`PREPUSH_RUN_TSC`/`PREPUSH_RUN_MYPY`/
  `PREPUSH_RUN_BANDIT` …, self-gating).
  Since **#377 it runs only
  the legs the DIFF can break**, selected by `.claude/hooks/prepush-select-lib.sh` from
  `git diff --name-only @{push}..HEAD` (falling back to `@{upstream}`, then to
  merge-base(`origin/main`)): measured on one machine, a docs-only push went **11m44s → 13s**, a
  backend-only push **11m44s → 1m21s**, and a `projects/public/**` push **11m44s → 15s**.
  **Since v1.14.2 the scope applies on EVERY branch, `main` and `release/*` included** (owner
  directive 2026-09-14: "the push cannot be longer than 1-3 minutes — it must be related to the
  size of the committed code, not a README during 40 minutes") — the forced full round on `main`
  had grown to 30-40 minutes and duplicated CI 1:1, since CI runs every leg on every `main` push
  anyway. The polarity is otherwise unchanged — an unmapped path, an empty or unobtainable diff, an
  unnameable branch, `--all`/`--mirror`/`--tags`/`--follow-tags` and `PREPUSH_FULL=1` all run
  EVERYTHING, and the PII/de-brand guard is never selectable away. Workflow files
  (`.github/**`), `sonar-project.properties`, `.gitignore` and `.mcp.json` are ENUMERATED as
  no-local-leg paths (CI is their only test surface) rather than unmapped, so a scanner-config edit
  no longer buys the full round. Frontend selection is per Vitest project (`projects/shared/**` fans
  out to all three because both apps consume it; `projects/public/**` never runs `admin`), and a
  change to `hook-parse-lib.sh` runs all four hook self-tests. **CI is unchanged and still runs
  every leg.**
  `pre-push-tests.test.sh --mutations` neuters one selection rule at a time — including "select
  nothing at all" — and requires the cases to go red, because a selector that silently selects
  nothing would pass every "X must not be selected" case; `guard-destructive.sh` blocks irreversible
  local/infra destruction (rule 9) — bypass one command with `GUARD_DESTRUCTIVE=0`;
  `guard-stack-resources.sh` refuses a `docker compose up`/`build`/`run`/`pull` below a free-disk
  floor (`DOCKER_DISK_FLOOR_GB`, default 5) or one that would start a SECOND compose project beside a
  running one — bypass with `DOCKER_STACK_GUARD=0`. It reads `down`/`ps`/`logs`/`exec`/`builder prune`
  as always allowed, because those are what you run to RECOVER from a full disk (v1.14.0 retro:
  three concurrent stacks filled the disk, crashed the daemon and cost ~2 hours; one stack of this
  project measures 15.35 GB of images + 3.09 GB of build cache + 6.97 GB of volumes). All four hooks are
  **command-position aware** (quoted prose is data, #204/#237) and share ONE parsing model,
  `.claude/hooks/hook-parse-lib.sh`; each has a self-test (`*.test.sh`) beside it, and the gate runs a hook's self-test only when the diff selects it — **plain cases only: no `--mutations` contract ever runs locally** (v1.14.2, owner's 1-3-minute push budget; the merge gate's contract alone measured 543s and this gate's own ~9 minutes). CI runs the merge-gate, stack-guard and pre-push contracts with `--mutations` unconditionally on every push, because the merge gate's first self-test passed every case against a gate whose blocking had been removed and that class of fake-green must stay pinned somewhere unconditional; argv-observed stub cases keep the local call sites from quietly reintroducing the flag.
  `pre-merge-gate.sh` blocks `gh pr merge` unless the newest posted verdict states APPROVE, that APPROVE is newer than every commit on the PR, and every `Closes #NN` points at an issue with all acceptance criteria ticked; bypass one authorized command with `PR_MERGE_GATE=0`. **An approval covers the head it reviewed** (v1.14.0 retro): replaying the real threads at merge time, **four of the ten reviewed merges** carried commits no approval had seen (an 11-PR corpus; #321 merged with no verdict at all) — #320 merged four commits after its only verdict (including the fixes to the reviewer's own findings and a behaviour change), #315 merged two seconds before its delta-confirm was posted, #314 merged a `main` merge, and the release PR #327 merged a CHANGELOG commit, so the `v1.14.0` tag sits on an uncovered commit. A merge of `main` is not benign: that is how #325's Alembic head fork appeared. The remedy is a `## ✅ APPROVE — round N (delta-confirm at <sha>)`, not a bypass. **A verdict is a body whose FIRST NON-EMPTY LINE states `APPROVE` or `REQUEST CHANGES`** (v1.13.0 retro): reading the whole body let an author's fix-report on #291 count as the newest verdict and would have allowed a merge against a standing REQUEST CHANGES — reviewer and author share one identity here, so only the marker's position separates them. Fix reports must not open with a marker.
  Four repo-contract lints run in the pre-push gate: `scripts/check_compose_env.sh` (a documented knob must reach the container — #296/#297/#298) and `scripts/check_migration_heads.sh` (exactly one Alembic head, measured on the working tree UNIONED with `origin/main` — #323/#325), both of which **also run in CI** (`deploy.yml`, Version Consistency job); `scripts/check_aiconfig_map.sh` (the AI-config map matches the filesystem and `enabledPlugins`), which runs in the gate, in CI and in `verify_all.sh` — a map nobody diffs stops being true, which is why this one is executable rather than a review checklist item (#246); and `scripts/run_frontend_suites.sh` (one signature-narrow retry for the upstream worker-teardown race), which now runs in **BOTH** the pre-push gate and CI (#319). It solves **two distinct failure modes**, and only the first is CI-exempt: (a) the `&&`-chain problem — `npm test` chains the three projects, so a flake in `public` meant `admin` never ran — which CI genuinely does not have, since it runs the three as separate jobs; and (b) **the teardown race itself**, which hits CI exactly as it hits the gate and made the pipeline *less* robust than the local check. The earlier "gate-only" claim conflated the two. In CI each frontend job invokes it as `FRONTEND_PROJECTS=<one> … --coverage`, so the wrapper retries that single project and the other two stay parallel. Each lint has a `*.test.sh` beside it that also runs in the gate. Note what the migration lint's CI half canNOT see: GitHub does not re-run a PR's checks when its base moves, so the pre-push run against `origin/main` and the merge gate's approval-covers-head check are the layers that actually catch a fork opened by someone else's merge.
- **Plugins** (project scope; curation rationale + review cadence per #122 — re-review each
  release alongside the security check):
  - `context7` — KEEP: live library docs beat training-data recall for Angular 22 / FastAPI /
    Tailwind 4 API questions; used routinely for upgrade work (rule 6).
  - `playwright` — **DROPPED** by this pass: the plugin ships nothing but an MCP server
    (`npx @playwright/mcp@latest`) identical to the committed `.mcp.json` `playwright` entry, so
    enabling both loaded every browser tool twice and spawned a duplicate server process. The
    project `.mcp.json` entry stays (explicit, on the AI-config map); browser automation for the
    LinkedIn scraper session and interactive E2E reproduction is unchanged.
  - `pyright-lsp` / `typescript-lsp` — KEEP: precise go-to-definition/type errors across
    backend `app/` and the 3-project Angular workspace; cheaper than grep-navigation at this size.
  - `security-guidance` — KEEP: inline flags on risky patterns (it fired usefully this cycle on a
    `shell=True` mention); supports security-triage.
  - `frontend-design` — **DROPPED at v1.14.0.** It was carried as a conditional KEEP through two
    releases with, in both retrospectives, "no new evidence either way" — and v1.14.0 shipped the
    cycle's only design-shaped work (#311's cover artwork, PR #320) through a hand-written
    `frontend/scripts/make-social-image.mjs` renderer without touching it. An enabled plugin costs
    tokens on every load; two releases of non-use is the evidence. Restoring it is one line in
    `.claude/settings.json`, so the trigger is explicit: re-enable when the #67 theming work
    actually starts shaping new public-site UI.
  - **Evaluated and NOT added** (record per #122 so it isn't re-researched) — marketplace
    candidates reviewed against this stack: `commit-commands` (the repo's rule-3 branch→PR flow,
    `/prep-pr`, and the `issue-workflow` skill already cover commit/PR hygiene with repo context),
    `claude-md-management` (CLAUDE.md is curated by hand; the #232 drift-check pattern guards it),
    `code-review` (rule 13's `pr-reviewer` agent is the merge gate — a generic reviewer has less
    repo context and no standing in the gate). Nothing filled a gap the in-repo toolkit doesn't;
    revisit only when a concrete gap surfaces in practice.
  - **Project plugin (`mavrovde-toolkit`) — DEFERRED, deliberately**: packaging the agents,
    commands, skills and hooks **in the map above** as one installable plugin is the right end-state for the
    template product (#61/#88), but today every consumer of this config is this repo itself —
    packaging would add a version-sync surface with zero second consumers. Tracked as follow-up
    issue **#244**; trigger = the first real fork/template user (milestone #2).
- **Skills** (`.claude/skills/`): all seven — `issue-workflow` (issue/PR/milestone/label flow),
  **`ssh-deploy`** (#310 — the panel-free deployment loop on the **shared, multi-project** prod host:
  failure→diagnosis for every `Roll Out To Prod Host` step, the certificate-renewal runbook, and the
  multi-tenant do-not-touch list; consult before ANY host-side action, and see
  `docs/wiki/production-deployment.md` for the host lifecycle + shared-edge/TLS design),
  `release-retro` (the release retrospective method — rule 8's mandatory step),
  `e2e-validation` (#117), `env-gotchas` (#119), `ssr-cd-safety` (#118), and
  **`lessons-learned`** — the committed "do-not-repeat" knowledge base (zoneless-CD + SSR-HttpBackend
  traps, pytest local-DB isolation, GHA multi-GB-cache net-negative, SemVer-by-content, green-pipeline
  release rule, destruction guardrail). **Consult `lessons-learned` before** SSR/HTTP/CD changes,
  local pytest, adding a CI cache, a release, or destructive local commands — it exists so we don't
  re-research what we already know.
- **Slash commands** (`.claude/commands/`): all eight — `/verify`, `/release`, `/retro`, `/issue-triage`,
  `/linkedin-sync`, `/deploy-status` (#120), `/e2e` (#117), `/prep-pr` (pre-PR hygiene gate:
  stale-main, CHANGELOG duplicates, stale
  old-behavior assertions — #119). The **`env-gotchas` skill** (`.claude/skills/env-gotchas/`)
  documents the macOS/BSD/gh platform pitfalls (no `timeout`, BSD `grep -E`/`sed -i ''`,
  same-identity `gh pr review --approve` block) — consult it before writing cross-platform shell.

## Engineering rules (non-negotiable)

1. **Root cause, no band-aids.** Trace a bug to its origin (component → service → API → SQL). No
   arbitrary `setTimeout`, no silently swallowed exceptions, no suppressed type/lint errors.
2. **Tests with every change.** Keep coverage **≥95%** (the project standard is 100%). Cover error
   paths (400/500/timeouts), not just happy paths. Add a regression test for every bug fixed.
3. **Deliver via PR; the PUSH is fast, the MERGE is deep.** **Never push feature work directly to
   `main`** — always branch → pull request → merge (the merge is the sanctioned prod trigger).
   **A push costs under one minute — never ever more** (owner constraint 2026-09-14): the shared
   pre-push hook (`.claude/hooks/pre-push-tests.sh`) runs only the fast, diff-scoped contract
   checks plus a formatting/compilation confirmation of the changed code (ruff on backend,
   `tsc --noEmit` per frontend project — seconds); the deep suites — backend (mypy + pytest),
   all frontend project tests,
   Docker E2E — run in CI on every push/PR and MUST be green (plus rule 12's local E2E evidence
   where it applies) **before the merge**, which rule 13's review gate enforces. `PREPUSH_DEEP=1`
   opts a push into running the deep legs locally. Never merge code that fails a gate; keep the PR
   description's checklist current.
4. **Typing is law.** Pydantic models for backend schemas; explicit TypeScript interfaces (no `any`)
   mirroring them. All backend I/O is async.
5. **Frontend discipline.** State via RxJS Observables rendered with the `async` pipe (components
   expose `Observable` fields composed with `switchMap`/`catchError`/`shareReplay`, consumed as
   `value$ | async` in templates); RxJS is the **primary** state/streams mechanism. Signals are
   used only sparingly for local component state where they fit (e.g. `blog-post`), not as the
   default. Guard all DOM access with `isPlatformBrowser()` (SSR-safe). Components stay dumb; logic
   lives in injected services.
6. **Dependency policy.** Upgrade to latest **within current majors** by default; breaking majors
   (e.g. Angular, TypeScript) are separate, deliberate efforts. `linkedin-api` stays `2.2.1` (prod
   installs a patched wheel). Update both `requirements.txt` and `requirements-dev.txt` together.
7. **Docs + changelog with code.** Update `README.md` and `CHANGELOG.md` (`[Unreleased]`) as part of
   the change. Conventional Commits (`feat:`/`fix:`/`chore:`/`docs:`), atomic. **Commit durable
   lessons, don't hoard them:** when you learn a hard-won, reusable lesson (a footgun, a non-obvious
   root cause, a "don't do X"), record it in the **in-repo** `.claude/skills/lessons-learned/` as part
   of the change — not only in machine-local private memory, which fresh contexts and teammates can't
   see. Uncommitted knowledge doesn't compound.
8. **No rogue prod actions.** Deploy only via the sanctioned path (merge to `main` / `release.sh`).
   A release is **confirmed only when the `deploy.yml` pipeline is green end-to-end** — and note
   that green means *published AND (once the `deploy` rollout job is active via the `DEPLOY_*`
   secrets) rolled out + health-gated on the live host*; while those secrets are absent, live
   state must be verified manually (`docs/DEPLOYMENT.md`, issues #112/#156). Babysit the
   run and react to results (fix forward on red), then tag `vX.Y.Z`. **Check GitHub security reports
   (CodeQL + Dependabot + secret scanning, plus the Security-tab SARIF from Snyk Code, Snyk Open
   Source, Snyk Container and Bandit) every release** and triage them. Each scanner uploads under
   its own SARIF `category`, so they coexist rather than overwrite — triage them per category, and
   note that **Snyk Code requires `sastEnabled` on the Snyk org**; when it is off the scan returns
   HTTP 403 and the workflow reports that rather than failing (#358). **Then run the release retrospective
   (`/retro`, owner directive 2026-09-06): analyse the release's issues, PRs, review threads and
   effort telemetry, and turn what happened into committed changes to the agents/skills/hooks/rules
   — a release is finished when what it taught is written down, not when the tag is pushed.**
   Every retrospective is archived as `docs/retrospectives/vX.Y.Z.md` with the trend table in that
   directory's README updated, so the series can be compared release over release. A
   retrospective that produces no configuration change must say why, in writing. Confirm before anything irreversible or
   outward-facing (merging to `main` triggers a prod deploy).
9. **No irreversible local/infra destruction.** Never `docker volume rm`, `docker volume prune`,
   `docker compose down -v/--volumes`, `docker system prune`, `docker image prune -a`, `DROP`/recreate
   a **non-`test_*`** database, or a recursive `rm` of a data dir / volume mount (`data`, `pgdata`, `volumes`,
   `ollama`, `open-webui`, `.chrome-profile`, `linkedin_cookies`, …) **without explicit user
   authorization that names the resource**. A backup is **not** a substitute for authorization. Prefer
   non-destructive paths (bump the image to match the volume schema, migrate, or leave it). Only
   `test_*` databases may be dropped autonomously (pytest teardown). Defense-in-depth: the
   `.claude/hooks/guard-destructive.sh` PreToolUse hook blocks these patterns (bypass a single
   authorized command with `GUARD_DESTRUCTIVE=0` prefixed). Origin: the #91 incident (a subagent ran
   `docker volume rm mavrovde_open-webui_data` on its own initiative).
10. **NEVER use real API keys or paid-service credentials in tests or CI — STRICTLY FORBIDDEN.** No
    unit test, integration/E2E test, fixture, seed, or CI test stack may authenticate to a paid,
    metered, or rate-limited external service (any API that bills or consumes quota per call) with a
    **real** credential. Every such call MUST be either **(a) mocked/stubbed at the test boundary**
    (e.g. `page.route` in Playwright, monkeypatch/fake in pytest) **or (b) routed to a free local
    fallback** by supplying an **empty or dummy** credential so no billable request is made. CI test
    jobs MUST inject empty/placeholder credentials into the test stack — **never** a real secret
    (`${{ secrets.* }}`). Real credentials belong **only** to the production runtime environment,
    never to a test or CI job. Before writing or running any test/CI path, verify it cannot reach a
    paid service with a live credential. **Rationale:** a real key wired into an automated test fires
    on *every* pipeline run — causing silent, unbounded, recurring cost and quota exhaustion — and
    needlessly exposes the credential to CI logs. Treat any such wiring as a critical bug to fix, not
    to run. (In this repo: CI passes `BEACONFOLIO_GEMINI_API_KEY: ""` so the E2E falls back to the local Ollama;
    paid-API specs are also mocked.)
11. **Fix review findings IN the PR — do not convert them into new issues.** (Owner directive
    2026-09-06: "if the behavior was not confirmed by the reviewer during the review — do not
    open a new issue, resolve it immediately during the work on the PR. I do not need the amount
    of issues growing, I need clear progress.") A finding is deferred to an issue ONLY when it is
    genuinely out of the PR's scope (a different subsystem, or work the owner has scheduled for a
    later release) — and then say so explicitly in the PR. Anything the reviewer could not
    confirm, anything the PR itself introduced, and anything cheap to fix gets fixed in the next
    round. Backlog growth is not progress.

12. **A merged PR means VALIDATED ON EVERY APPLICABLE LAYER.** (Owner directive 2026-09-06.)
    Before merge, the change must be exercised at every layer that can see its failure mode:
    backend unit (pytest, 100%), frontend unit (Vitest ×3 projects, 100%), **E2E in a real
    browser** for any user-facing surface, the **WireMock integration tier** for any composed
    API/AI path, and plain mocks/stubs for boundaries the others cannot reach. "The units are
    green" is not validation — v1.12.0 shipped three screens at 100% unit coverage that had never
    rendered in a browser (lessons §29). **CI runs E2E and the integration tier on PUSH only**
    (`deploy.yml`), so a PR cannot carry CI-run evidence for them: run them LOCALLY against a real
    stack and state the measured result in the PR — that is what satisfies this rule. If a layer
    genuinely does not apply, say WHICH and WHY; if it applies and is missing, the PR is not
    ready.

13. **Independent review gate — EVERY PR requires a `pr-reviewer` verdict before merge. NO
    EXCEPTIONS.** No pull request is merged until an **independent** `pr-reviewer` review (an APPROVE
    verdict) is **posted to the PR**. Green CI, a passing local/pre-push suite, and validation by the
    implementing dev agent (`backend-dev`/`frontend-dev`) are **necessary but NOT sufficient** — none
    of them is an independent review. This gate applies to **every** PR with **no carve-outs**:
    hotfixes and emergencies, dependency bumps, trivial/one-line/CI/docs changes, and changes the user
    directed in real time. **"The user was directing it" and "a dev agent validated it" are NOT
    substitutes** for the review verdict. If a change is urgent, the review is **expedited, not
    skipped**. The only state that authorizes a merge is: **all gates green AND a posted `pr-reviewer`
    APPROVAL**. Therefore every merged PR must carry a visible review verdict as its audit trail; if
    one was ever merged without it, post a retrospective review and fix-forward on any finding.
    (`pr-reviewer` posts a `gh pr review`/`gh pr comment` verdict; same-identity `--approve` may be
    blocked, so a clear COMMENT verdict counts.)

    **REBASE BEFORE YOU REQUEST A REVIEW, and request ONE PR per review.** (Owner directive
    2026-09-13: *"Never starting review before rebase and pulling the code from main branch, this
    unacceptable spending resources"*, and *"Never use the review agent for multiple PRs — one for
    one PR"*.) Before asking for any verdict: `git fetch origin main && git rebase origin/main`,
    resolve, confirm `gh pr view <N> --json mergeable` is `MERGEABLE` and
    `git rev-list --count <head>..origin/main` is **0**. A review of a stale branch is wasted
    twice over — it burns a full analysis to produce "rebase first" as its blocker, and it clears
    code against a base that will never merge. **Measured in the v1.14.1 cycle: five stale-base
    blockers across five PRs (#357, #364, #365, #366, #367), two of which consumed a review round
    and nothing else** — #364's verdict states verbatim that the stale, conflicting base was the
    *only* thing blocking it. The reviewer now checks this first and posts a short REQUEST CHANGES
    naming the gap (not a chat message: the merge gate compares a verdict only against commits on
    the PR, so it cannot see `main` move, and an un-posted refusal leaves a stale APPROVE standing). The same
    applies to the `[Unreleased]` CHANGELOG section, which is where these collisions land —
    **`/prep-pr` step 2 is where both halves are checked**, so run it rather than re-deriving the
    commands here. Merging two `[Unreleased]` sections duplicates *headings* and *entries*
    independently, and a heading-only check passes while entries are doubled.

## Issue tracking, milestones & labels (development flow)

The repo is **PUBLIC** (`github.com/mavrovde/beaconfolio`). This flow is the shared source of truth
for issue-driven work — humans and AI agents both follow it.

1. **Issues are the project notebook.** Every idea, plan, bug, deferred fix, shipped milestone, and
   research decision lives as a GitHub issue on `mavrovde/beaconfolio` — never only in chat or personal
   memory. Register work as an issue up front; **close-the-loop** when it lands (see rule 7).
2. **Full issue template (every issue):** Summary → Why it matters → Impact (project / developers /
   visitors) → Current state (grounded, cite `path:line`) → Proposed action → **Acceptance criteria**
   (checkable list) → **How to verify (test steps)** → Links.
3. **No orphan issues.** Every issue MUST carry a **milestone** (theme), a **priority** label
   (`P0-critical` / `P1-high` / `P2-medium` / `P3-low`), and **≥1 area label**.
4. **Milestones are reusable thematic buckets, NOT per-version.** Reuse an existing theme for similar
   work (e.g. every dependency task → *Dependency modernization*); add a new theme milestone only for
   a genuinely new theme. Current buckets:
   - **Dependency modernization** — dep upgrades + upstream-blocked bumps.
   - **Security & hardening** — vuln remediation, rate-limiting, secret hygiene.
   - **Reliability & bug fixes** — flakes, schema/data drift, session bugs.
   - **CI/CD, tooling & docs** — pipeline, gates, tooling, doc accuracy.
   - **Content & localization** — content + translations.
   - **Transfer to general portfolio** — the product/template transformation.
   - **AI-assisted development & agents** — subagents, commands, skills, hooks, plugins, MCP,
     and AI-process improvements (milestone #7, area label `ai-config`).
5. **Label scheme** = type + area + priority:
   - type: `bug` / `enhancement` / `documentation` / `dependencies` / `security`
   - area: `backend` / `frontend` / `infra` / `ci-cd` / `performance` / `tech-debt` /
     `architecture` / `content` / `i18n`
   - priority: `P0-critical` / `P1-high` / `P2-medium` / `P3-low`
6. **PRs link issues — and carry the SAME labels + milestone, AT CREATION.** Use `Closes #NN` /
   `Fixes #NN` for issues a merge resolves, `Refs #NN` for partial/related work. State how the PR
   satisfies each of the issue's **acceptance criteria**; keep the PR checklist current. Every PR
   gets its issue's milestone, type/area/priority labels, **and the `release:vX.Y.Z` label of the
   release it targets** when it is opened — not retro-fitted (owner, 2026-09-14: two unlabeled
   PRs in one day; the release label is how the cycle's work is queried at retro time).
7. **Close-the-loop (verify before closing).** When work lands, comment on the issue with what was
   done + links, **verify against its acceptance criteria / test steps**, then close it (or note the
   remaining status if partial). Never close on assumption. **A `Closes #NN` auto-close is NOT
   close-the-loop** — it leaves no visible record, so the issue reads as "just closed" to anyone
   later. Always post a comment naming **the PR, the merge SHA, the pipeline result, and each
   acceptance criterion with how it was verified**; if a criterion is unmet, say so and keep the
   issue open rather than closing optimistically.
   **Report what you measured, not what you expect.** Several claims in this repo's history were
   wrong until checked: "the release deploys correctly" (the images were private), "a regression
   fails the suite" (it passed both ways), "15 cases" (there were 18), "dependency-free" (it needed
   npm). If you assert a number or an outcome, run the thing that produces it first.
8. **No secrets — and no internal service identifiers — in public issues/PRs/commits.** Never
   paste credentials, tokens, private keys, or step-by-step live-exploit instructions. Reference
   config locations (`path:line`) instead of the secret values. **This includes AI-tooling session
   identifiers: never write a `Claude-Session:` trailer, a `claude.ai/code/session_…` URL, or any
   other internal tool/session id into a commit message, PR body, issue, or changelog** (owner
   directive 2026-09-06 — they are internal service information and this repo is PUBLIC).
   `Co-authored-by:` attribution is fine; the session link is not. If one is published, scrub
   every editable surface (PR/issue bodies and comments) immediately and report what remains in
   immutable commit history rather than rewriting public history unilaterally.
9. **Tooling.** The `github` MCP server + `gh` CLI manage issues/PRs/milestones/labels; the
   `security-guidance` plugin supports security triage. The **`issue-workflow` skill**
   (`.claude/skills/issue-workflow/`) captures this end-to-end flow with copy-paste `gh` commands;
   `/issue-triage` sweeps the backlog for orphan issues.

## Execution protocol

Reconnaissance (read the target + its deps + its tests) → blast-radius analysis → define types
first → implement defensively → write/update tests → verify locally (format, lint, type, test).
