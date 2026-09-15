# Copilot instructions — Beaconfolio

**`CLAUDE.md` at the repo root is the single source of truth for how AI assistants work here.**
This file summarizes it for GitHub Copilot; if anything below seems to conflict with `CLAUDE.md`,
`CLAUDE.md` wins. Path-scoped detail lives in `.github/instructions/*.instructions.md`; durable
operational lessons live in `.claude/skills/lessons-learned/SKILL.md` — read the matching section
before touching SSR/HTTP code, running backend pytest, adding CI caching, or preparing a release.

## What this project is

Personal portfolio + blog with semantic search and local AI, plus a LinkedIn → Beaconfolio content
pipeline. **Public repo** (`github.com/mavrovde/beaconfolio`) — never commit or paste secrets.

- `backend/` — FastAPI (Python 3.12 in prod/CI), SQLAlchemy 2 async, PostgreSQL 16 + pgvector, Ollama.
- `frontend/` — Angular 22 workspace: `projects/public` (SSR), `projects/admin` (CSR), `projects/shared`
  (`@beaconfolio/shared` lib). TailwindCSS 4, Vitest 5, Playwright E2E.
- `scraper/`, `importer/` — LinkedIn scraping + import pipeline. `agents/` — A2A multi-agent team.
- `proxy/` — reverse proxy config. Infra: Docker Compose; deploy via `.github/workflows/deploy.yml`.

## Build & test commands (run these; don't guess)

Backend (`cd backend`, venv at `backend/venv`):
- `pytest` — needs Postgres on `127.0.0.1:5433` and `TEST_DATABASE_URL` pointing at a `test_*` DB
  (e.g. `test_beaconfolio`) plus `BEACONFOLIO_GEMINI_API_KEY=""`. Without those it hangs on / would wipe the live dev DB.
- `ruff check .` && `ruff format --check .` · `mypy app --ignore-missing-imports --no-error-summary`
  · `bandit -r app -ll --skip B101`

Frontend (`cd frontend`):
- `npm run test:coverage` (all projects, 100% coverage each) or `npm run test:{shared,public,admin}`
- `npm run build` — build `shared` before `public`/`admin`.

Full stack: `./manage.sh start|stop|logs` · `./verify_all.sh` (full suite incl. Docker E2E).

## Non-negotiable rules (from CLAUDE.md — enforced)

1. **Root cause, no band-aids.** No arbitrary `setTimeout`, swallowed exceptions, or suppressed
   type/lint errors. Trace bugs to their origin.
2. **Tests with every change.** Coverage stays at 100% (backend pytest and every frontend project).
   Cover error paths (400/500/timeouts). Add a regression test for every bug fixed.
3. **Deliver via PR; never push to `main` directly.** Branch → PR → merge; the merge to `main` IS
   the prod deploy trigger. Run the full local suite before pushing.
4. **Typing is law.** Pydantic models on the backend; explicit TypeScript interfaces (no `any`)
   mirroring them. All backend I/O is async.
5. **Frontend discipline.** State via RxJS Observables + the `async` pipe (primary); signals only
   sparingly for local component state — do NOT refactor RxJS to signals. Guard DOM access with
   `isPlatformBrowser()`. Components stay dumb; logic lives in injected services.
6. **Dependencies.** Upgrade within current majors only; breaking majors are separate deliberate
   efforts. `linkedin-api` stays `2.2.1`. Update `requirements.txt` and `requirements-dev.txt` together.
7. **Docs + changelog with code.** Update `README.md` and `CHANGELOG.md` `[Unreleased]` as part of
   every change. Conventional Commits (`feat:`/`fix:`/`chore:`/`docs:`), atomic.
8. **No rogue prod actions.** Deploy only via merge to `main`. A release is confirmed only when
   `deploy.yml` is green end-to-end — and note **green always = images PUBLISHED, but live-on-host
   only if the secrets-gated `deploy` job ran** (#175; it skips, still green, when `DEPLOY_*`
   secrets are unset — #112/#156). Check that job before claiming the site is updated.
9. **No irreversible local/infra destruction.** Never `docker volume rm`/`prune`,
   `docker compose down -v`, `docker system prune`, `docker image prune -a`, DROP a non-`test_*`
   database, or `rm -rf` a data/volume dir (`data`, `pgdata`, `ollama`, `open-webui`,
   `.chrome-profile`, …) without explicit user authorization naming the resource. A backup is NOT
   consent. Only `test_*` databases may be dropped autonomously.
10. **NEVER use real API keys or paid-service credentials in tests or CI.** Mock paid calls at the
    test boundary (`page.route`, monkeypatch) or supply an empty/dummy credential so the code takes
    a free local fallback (Ollama). CI test jobs inject `BEACONFOLIO_GEMINI_API_KEY: ""` — never `secrets.*`.
    Real credentials belong only to the production runtime environment.
11. **Every PR needs an independent review verdict before merge — no exceptions.** Green CI and the
    author's own validation are necessary but not sufficient. Hotfixes get an expedited review, not
    a skipped one.

## Operational lessons (hard-won — do not re-learn)

- **Never run backend pytest while another suite runs.** `pgrep -f pytest` first and wait; two
  suites on the shared `test_beaconfolio` DB clobber each other into spurious failures.
- **Before blaming your diff for a local gate failure, reproduce it on an unmodified `main` build**
  (git worktree of `main`, same gate). If `main` fails too, it's a latent gate bug.
- **Local proxy HTTPS is on host port 10443** (`https://localhost:10443`); `https://localhost/`
  returns `000`.
- **Both browser apps are zoneless** (no zone.js at runtime) — public explicitly, admin by default
  (#276): async property mutations in `subscribe`/`setInterval` don't repaint — use the `async`
  pipe, signals, or `markForCheck()`. `npm run lint` (the #234 eslint cd-safety rule) scans both roots; unit tests hide
  this unless the TestBed opts into `provideZonelessChangeDetection()`.
- **SSR URL rewrite lives in `SsrHttpBackend` delegating to `HttpXhrBackend`** — never an
  interceptor, never `FetchBackend`. Any SSR/HTTP/transfer-cache change must pass the full Docker
  E2E before merge (PR CI runs CodeQL only).

## Issue & PR flow

- Every piece of work is a GitHub issue with a **milestone**, one **priority** label
  (`P0-critical`…`P3-low`), and ≥1 **area** label (`backend`/`frontend`/`infra`/`ci-cd`/…).
- Issues follow the template: Summary → Why it matters → Impact → Current state (cite `path:line`) →
  Proposed action → Acceptance criteria → How to verify → Links.
- PRs link issues (`Closes #NN` / `Refs #NN`) and state how each acceptance criterion is met.
  Verify against acceptance criteria before closing an issue — never close on assumption.
- **Label every PR** with ≥1 type label (`bug`/`enhancement`/`documentation`/`dependencies`/
  `security`) + ≥1 area label — same scheme as issues (`gh pr create --label` / `gh pr edit --add-label`).

## Working discipline (learned the hard way — see `.claude/skills/lessons-learned/`)

- **Mutation-check tests that pin a fix**: revert the fix and confirm the test fails — a test that
  passes both ways pins nothing (`git stash -- <file>` is a no-op for committed changes; use
  `git checkout origin/main -- <file>`).
- **Signature/behaviour changes need the FULL suite *as CI runs it*** (`pytest -n auto … --cov-fail-under=100`),
  never `-k` — stale mocks and patches of deleted symbols live in other files; caught twice in review,
  once only after reddening `main`, where it had passed every serial local run.
- **Verify gates actually gate**: ask what would fail if the standard were violated right now.
- **Close-the-loop links the PR**: a `Closes #NN` auto-close leaves no record — comment with the PR,
  merge SHA, pipeline result and each acceptance criterion.
- **Report what you measured, not what you expect.**

## Execution protocol

Reconnaissance (read the target + its deps + its tests) → blast-radius analysis → define types
first → implement defensively → write/update tests → verify locally (format, lint, type, test).
