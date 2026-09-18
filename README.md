[![Beaconfolio — fork-and-go portfolio + recruiter communications for job-seeking engineers, rendered as a green-phosphor terminal card](docs/assets/social-preview.png)](https://github.com/mavrovde/beaconfolio)

# Beaconfolio

**A fork-and-go, self-hostable portfolio + recruiter-communication platform for job-seeking software
engineers** — semantic blog search, local-AI tagging, and an admin console, deployable under *your*
own name and domain.

> **Name change (#88 → #330):** the project is now **Beaconfolio**, the repository is
> [`mavrovde/beaconfolio`](https://github.com/mavrovde/beaconfolio), and the product domain is
> [`beaconfolio.com`](https://beaconfolio.com). GitHub redirects the old URLs and `git remote` keeps
> working, but update your remote when convenient:
> `git remote set-url origin https://github.com/mavrovde/beaconfolio.git`.
> **Beaconfolio is the product**; any single deployment of it — including the maintainer's — is just
> one instance, and this documentation is written for *yours*.
>
> ⚠️ **Image paths moved with the rename.** `IMAGE_NAME` derives from the repository slug, so builds
> publish to `ghcr.io/mavrovde/beaconfolio-*` **from v1.14.1 onward**. Every tag up to and including
> **`1.14.0` exists only at the pre-rename path** `ghcr.io/mavrovde/hirefolio-*`. The compose default
> targets the new path, so to deploy a pre-rename tag you must pin it explicitly:
> `IMAGE_REPO=ghcr.io/mavrovde/hirefolio IMAGE_TAG=1.14.0`.
> **One-time owner action:** the new GHCR packages are created **private** — package visibility does
> not follow a repository rename — so make them public once after the first post-rename build, or the
> host, which pulls without a login, cannot fetch them. See
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#registry-notes).

## 🚀 Features

**Portfolio**
- **Modern Portfolio**: Showcase experience, skills, education, and recommendations
- **Projects Showcase**: A `projects` array in your profile JSON becomes a home-page section,
  a `/projects` list and a `/projects/:slug` detail page per project — title, summary, stack,
  role, dates, screenshot and repo/demo links, each detail page emitting `SoftwareSourceCode`
  (or `CreativeWork`) structured data. Omit the array and the section simply is not there.
- **Multilingual**: Full support for English and German with real-time switching
- **Blog with Semantic Search**: AI-powered content discovery using `nomic-embed-text` embeddings
- **AI Tag Generation**: Auto-suggest tags for posts using a local `llama3.2:1b` model
- **Responsive Design**: Works seamlessly on desktop and mobile
- **Admin Dashboard**: Secure interface for managing posts (rich editor, drafting, publishing)

**Job search** (v1.12.0)
- **Recruiter inbox** (#69): every inbound touch — public contact form, CV requests, **voice
  messages** (#264) — lands as one indexable interaction with a status workflow (new → contacted
  → in_progress → closed) and an email alert to the owner. The public writes are rate-limited per
  client IP and normalized server-side.
- **Opportunity pipeline** (#247 phase 1): a stage board (lead → … → closed), a notes timeline per
  opportunity, and one-click **promote** turning an inbox message into a pipeline card that keeps
  the original text as its first note.
- **Engagement analytics** (#249): a private admin dashboard counting the events the portfolio
  already creates — CV requests, **every** CV download, contact submissions — as totals, a per-week
  trend and a recent-activity feed, plus a weekly digest email. First-party and owner-only: no
  third-party analytics, no new personal data (events point at the existing records).

**Make it yours**
- **Runtime configuration** (#65): identity — site name/URL, owner name/headline/description,
  social links, analytics id — comes from `.env` and the admin panel at runtime, so a fork runs
  the prebuilt images without rebuilding.
- **Guided setup** (#61): `./setup.sh` generates secrets, writes `.env`, boots the stack and seeds
  the admin user.
- **Demo persona by default** (#66): the repo ships fictional content, never a real résumé; a PII
  guard fails the pipeline if personal identifiers reappear. **Set your identity in the host
  `.env` before deploying** — see `docs/DEPLOYMENT.md`.
- **Recruiter-discovery SEO** (#71): schema.org `Person` structured data (`hasOccupation`,
  `knowsAbout`, `alumniOf`, `worksFor`, `address`, `sameAs`, plus a `seeks` open-to-work signal),
  a unique title/description/canonical + Open Graph/Twitter card per route, and `sitemap.xml` /
  `robots.txt` **rendered per request** from your `SITE_URL` and your published posts — all
  server-rendered, so crawlers read them without executing JavaScript. An unmatched URL gets the
  site's own terminal-styled 404 page with a real HTTP 404 status, `noindex, nofollow` and no
  canonical (#324) — never a framework error page.
- **Readable by AI assistants** (#252): recruiters increasingly ask an assistant instead of a
  search engine, so the profile is published in a form agents can ingest — see below.
- **Type-Safe**: Full TypeScript/Python type coverage

### How AI assistants read this site (#252)

Classic SEO wins the search result; these three surfaces win the *answer*. All of them are
generated from your runtime config and your live data — there is nothing to author or rebuild.

| Surface | What it is |
|---|---|
| `GET /llms.txt` | The [llmstxt.org](https://llmstxt.org) map of the site: who the owner is, the availability signal, and a curated link list (structured profile, CV, contact, blog posts) an assistant can follow. Rendered by SSR from `GET /api/app/config/site` + your published posts. |
| `GET /api/app/profile/resume.json` | The whole candidate in ONE request as [JSON Resume](https://jsonresume.org) v1.0.0 — experience, education, skills, languages, certificates, references, plus `meta.availability` and `meta.contactUrl`. Built from the active profile version (admin → Profile Data), so an upload changes it immediately. It passes through the SAME public allowlist as the HTML profile, so it cannot expose a field the site does not already show. Validated in CI against the pinned schema with **format assertion on** (`uri`, `email`, `date`); a credential whose date is only a year keeps that year on the CV page but omits the schema's `date` field rather than inventing a day. |
| `GET /robots.txt` | Names the AI crawlers explicitly (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, Applebot-Extended, …). `AI_CRAWLER_POLICY=allow` (default) welcomes them; `deny` gives **only** those agents `Disallow: /` and leaves classic search untouched. `/for/` (tailored recruiter links) and `/admin` are excluded for everyone — as path *prefixes*, deliberately. Under `deny`, robots.txt stops pointing crawlers at `/llms.txt`; the file itself is still served, because it is an on-demand map an assistant reads while helping a person, not a crawl permission. |

Every page's `<head>` also carries `<link rel="alternate" type="application/json">` to the JSON
Resume and `<link rel="describedby">` to `/llms.txt`, server-rendered so an agent finds them
without executing JavaScript.

```bash
curl https://<your-domain>/llms.txt
curl https://<your-domain>/api/app/profile/resume.json | jq .meta
```

## 🏗️ Architecture

### Frontend

- **Framework**: Angular 22 (Standalone Components, RxJS + `async` pipe for state — Signals only for local component state, Native SSR `server.mjs`)
- **Styling**: TailwindCSS 4.x, Dark/Light mode
- **State Management**: RxJS 7.8 Observables
- **Testing**: Vitest 5.0 (Unit, replaced Jasmine/Karma), Playwright 1.63 (E2E)
- **i18n**: Custom translation service

### Backend

- **Framework**: FastAPI 0.141 (Python 3.12 — the version the Docker images and CI run)
- **Database**: PostgreSQL 16 with `pgvector` extension
- **AI**: Ollama (Local LLM & Embeddings)
  - Embeddings: `nomic-embed-text`
  - Chat/generation: `llama3.2`
  - Fast metadata/tags: `llama3.2:1b`
- **ORM**: SQLAlchemy 2.0.52 (async)
- **Testing**: pytest + Vitest (100% line & branch coverage)

### CI/CD Pipeline

- **Platform**: GitHub Actions
- **Quality Gates**:
  - Linting (Ruff 0.16 for the backend; no frontend linter is configured — the CI
    frontend-lint job runs `npm run lint --if-present`, which is currently a no-op)
  - Type Checking (MyPy)
  - Security Scanning (Bandit)
  - Unit Tests (Frontend & Backend)
  - E2E Tests (Playwright with real Ollama integration)
- **When each gate runs** (#208):

  | stage | pull request | push to `main` |
  |---|---|---|
  | Lint · types · security · unit tests · migrations · version consistency | ✅ | ✅ |
  | Build images · Docker E2E · publish to GHCR · roll out to prod | — | ✅ |

  Every build/publish/deploy job is gated on `github.event_name == 'push'`, so a pull request runs
  the verification jobs and **cannot** publish an image or touch the prod host. No job that runs on a
  pull request reads a repository secret, which also keeps fork PRs working. The Docker E2E stays on
  `main` because it needs the built images; run it locally with `./verify_all.sh` before merging
  anything that touches SSR, HTTP wiring, or change detection (see
  `.claude/skills/lessons-learned/SKILL.md`).

- **Optimization**: Playwright-browser caching in CI — deliberately **no** multi-GB caches for Docker base images or AI model weights (measured net-negative; see `.claude/skills/lessons-learned/SKILL.md` §5)

## 📋 Prerequisites

- **Node.js** 22 (what CI uses; npm 10+)
- **Python** 3.12 (what the Docker images and CI use; a newer local venv may work but is not the reference)
- **PostgreSQL** 16+
- **Docker/Podman** (Recommended for local dev)
- **Ollama** (If running locally without Docker)

## 🚀 Quick Start

### One command (recommended — LOCAL quickstart)

> **Scope:** `setup.sh` boots the **dev** compose stack — local builds, dev ports
> (4200/8000/11434/5433 on all interfaces) and default Postgres credentials;
> `setup.sh` always ensures a real JWT secret in `.env` (generating one when absent) (the ephemeral JWT
> is the dev-compose escape hatch when you bypass setup, not the default). Perfect for trying the product and local
> development. **For a real server** follow
> [`docs/DEPLOYMENT.md` → "First deploy (clean server)"](docs/DEPLOYMENT.md) —
> prod compose, prebuilt images, hardened settings.

```bash
git clone https://github.com/mavrovde/beaconfolio.git
cd beaconfolio
./setup.sh          # prompts for your name/site; --defaults for a demo persona
```

`setup.sh` creates `.env` from the sample, **generates strong secrets** (JWT signing key + admin
password — printed once, stored only in your gitignored `.env`), records your identity for the
runtime site config (#65 — change it later in `.env`, no rebuild), starts the Docker stack, and
waits for the backend health gate. Re-running is safe: values already set are never overwritten.

Then open <http://localhost:4200> (public site) and <http://admin.localhost:4200> (admin, user
`admin`). **Make it yours** — the whole checklist is config + admin uploads, zero code edits:

1. `.env`: `OWNER_NAME`, `OWNER_HEADLINE`, `SITE_NAME`, `SITE_URL`, `SOCIAL_LINKS` (one list
   feeding both the rendered contact links and JSON-LD `sameAs` — any code host works, #93),
   `BEACONFOLIO_ANALYTICS_ID` **or** `BEACONFOLIO_GTM_CONTAINER_ID` (identity, #65/#447 — a
   container id wins and the gtag install stands down, so you never send two copies of the same
   pageview) · `PUBLIC_SERVER_NAME`/`ADMIN_SERVER_NAME` (your
   domain) · `IMAGE_REPO` (your registry, for prod).
2. **Look and feel — no template edits, no rebuild** (#339/#67). The *theme* is an admin choice:
   Settings → Theme picks one of `terminal` (default), `dark`, `light`, `modern`, `classic`, and
   the name is stamped into `data-theme` during SSR, so the first byte already carries it. The
   *assets* are five `.env` knobs, and **every one is empty by default, where empty means "keep
   the bundled asset"** — set none and the site looks exactly as it does now:

   | Knob | What it replaces | Empty = |
   |---|---|---|
   | `BEACONFOLIO_BRAND_FAVICON_URL` | the tab icon on BOTH the public site and the admin console | the shipped `assets/favicon.png` |
   | `BEACONFOLIO_BRAND_LOGO_URL` | the header brand mark | a text wordmark built from `OWNER_NAME`'s initials |
   | `BEACONFOLIO_BRAND_OG_IMAGE_URL` | `og:image`/`twitter:image` on every share preview | the shipped `assets/og-image.png` (1200×630) |
   | `BEACONFOLIO_BRAND_FONT_CSS_URL` | the webfont **stylesheet** `index.html` links | the preset's own face |
   | `BEACONFOLIO_BRAND_FONT_FAMILY` | the CSS `font-family` list that actually paints | the preset's own family |

   Each takes an absolute URL or a site-relative path (`/assets/…`); a relative social card is
   resolved against `SITE_URL`, because a relative `og:image` is invalid for every crawler. The
   last two are a **pair**: a stylesheet loads a face, a family selects one, and setting only the
   first changes nothing visible. They are served on `GET /api/app/config/site` with the rest of
   the identity, so a **prebuilt image rebrands on restart** — the reason they are env vars rather
   than files in the bundle. The terminal preset's shell chrome (`user@your-site:~$`, the `>_`
   wordmark prefix) is derived from `SITE_NAME`/`OWNER_NAME` and disappears entirely under the
   four document presets.
3. Admin panel: upload your **Profile Data** JSON and your **CV** (Content → replaces the demo).
   Your **portrait** is a runtime upload too (#333), but has **no panel button yet** — it is one
   authenticated API call: `POST /api/app/admin/profile/photo` (JPEG/PNG ≤ 5 MB, checked by
   content) — the hero swaps to it immediately, it lives in the DB (survives every rollout), and
   with no upload the bundled placeholder renders. `/linkedin-sync` step 3 wraps the call and can
   source the image from your LinkedIn avatar; remove with `DELETE` on the same route.
4. Optional: LinkedIn import (`importer/README.md`), Gemini key (`BEACONFOLIO_GEMINI_API_KEY` —
   empty keeps the free local Ollama).

### Manual start (the same stack, no wizard)

```bash
# Start all services (incl. Mailpit — every notification email lands in the
# catch-all inbox at http://localhost:8025, nothing leaves the machine; #262)
./manage.sh start

# View logs
./manage.sh logs

# Stop services
./manage.sh stop
```

### Manual Setup (Local Dev)

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start DB (using Docker is easiest for PGVector)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16

# Run Migrations
alembic upgrade head

# Start Server
uvicorn app.main:app --reload
```

> **Alembic is the single, authoritative schema-management mechanism** — the backend no longer
> calls `Base.metadata.create_all` at startup. Docker images run `alembic upgrade head` via
> `backend/docker-entrypoint.sh` before the app starts (idempotent — a no-op once the DB is at
> head); running it manually is only needed for local dev outside Docker. See
> [`backend/migrations/`](./backend/migrations/) and
> [How to write a migration](#how-to-write-a-migration) below.

#### How to write a migration

```bash
cd backend
# 1. Change a model in app/models/*.py
# 2. Generate a migration from the diff (review it — autogenerate misses some things,
#    e.g. data backfills, column renames it sees as drop+add, and check constraints):
alembic revision --autogenerate -m "describe the change"
# 3. Apply it locally and confirm it's the diff you expect:
alembic upgrade head
# 4. Guard against drift — this must report "No new upgrade operations detected.":
alembic check
```

A non-additive change (column type change, `NOT NULL` backfill, rename, new constraint) goes
through the same `alembic revision --autogenerate` + hand-edit workflow — Alembic (unlike
`create_all`) can express and apply these safely.

**If your migration CREATES a table or index, start it with the self-adopt guard:**

```python
if sa.inspect(op.get_bind()).has_table("your_table"):
    return  # pre-Alembic install already has it (create_all) — adopt, don't crash
```

Long-lived deployments got their schema from `create_all` before Alembic existed (the entrypoint
stamps `baseline0001` over whatever is there), so a plain `op.create_table` explodes with
`DuplicateTable` on them. `inbox0003` is the reference example; the lessons-learned skill has the
full story. Test both directions: clean DB → creates; `create_all` DB → no-ops.

#### Frontend

```bash
cd frontend
npm install
npm start
```

### Access Application

- **Frontend**: <http://localhost:4200>
- **Backend API**: <http://localhost:8000>
- **API Docs**: <http://localhost:8000/docs>
- **Ollama**: <http://localhost:11434>

## 🤖 AI Assistant (Claude Code)

**Claude Code is the primary AI tool for this project.** All assistant guidance lives in
[`CLAUDE.md`](./CLAUDE.md) (stack facts, commands, the LinkedIn pipeline, engineering rules, and the
configured MCP servers / subagents / plugins / slash commands). Legacy per-tool files
(`.cursorrules`, `.windsurfrules`, `.cline.md`, `.geminirules`, `AI.md`, `.clauderules`) are thin
pointers to `CLAUDE.md`.

Project-scoped Claude Code tooling: subagents under `.claude/agents/` (`devops-pipeline`,
`backend-dev`, `frontend-dev`), slash commands under `.claude/commands/` (`/verify`, `/release`,
`/linkedin-sync`), and the plugins listed in `CLAUDE.md`.

### MCP Servers

A project-scoped `.mcp.json` configures Model Context Protocol servers to speed up development with Claude Code. On first use, Claude Code will ask you to approve the project's MCP servers.

| Server | Purpose | Requirements |
| --- | --- | --- |
| `postgres` | Read-only SQL queries against the `pgvector` database (inspect posts, embeddings, CV data) | DB running on `127.0.0.1:5433`; override URL via `MCP_POSTGRES_URL` |
| `playwright` | Drive a real browser for interactive UI debugging / E2E authoring | none (browser auto-installed) |
| `github` | Manage PRs, issues and Dependabot alerts | export `GITHUB_PERSONAL_ACCESS_TOKEN` (never committed) |

```bash
# Optional overrides before launching Claude Code
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx        # for the github server
export MCP_POSTGRES_URL=postgresql://user:pass@host:5433/beaconfolio  # non-default DB
```

Secrets are supplied only via environment variables — `.mcp.json` contains no credentials.

## 🧪 Testing

We verify the application at four levels, and a merged PR must be validated on every one that
applies to it (CLAUDE.md rule 12):

| Layer | Where | What it proves |
|---|---|---|
| Unit — backend | `backend/tests/` | handler/service logic, error paths; **100% required** |
| Unit — frontend | `projects/*/src/**/*.spec.ts` | component/service logic; **100% required** on all three projects |
| Black-box integration | `backend/tests_integration/` | the composed stack over real HTTP, with **WireMock standing in for the model server** (credential-free by construction) |
| End-to-end | `frontend/e2e/` | the product in a real browser — SSR, hydration, zoneless repaints, and the flows a visitor or operator actually walks |

Coverage percentage is not quality: v1.12.0 shipped three screens at 100% unit coverage that had
never rendered in a browser. Ask what breaks that every unit test would still pass through, and
write *that* test.

### 1. Unit tests (backend + frontend)

```bash
# Backend (needs Postgres on 127.0.0.1:5433; point TEST_DATABASE_URL at a test_* DB —
# see README_TESTING.md for the isolation rules)
cd backend && pytest

# Frontend (all three workspace projects: shared, public, admin)
cd frontend && npm test
```

### 2. End-to-End (E2E)

**Prerequisite:** the E2E suite runs against a live stack — start it first
(`./manage.sh start`, or the dedicated compose E2E stack that `./verify_all.sh` uses).

```bash
cd frontend
npx playwright test                        # both suites
npx playwright test --project=public-e2e   # public app only
npx playwright test --project=admin-e2e    # admin app only
npx playwright test e2e/admin/inbox.spec.ts # one spec file
```

The suite covers the public site (SSR + hydration, blog, CV, i18n switching, the contact form
incl. a phone viewport and an accessibility pass) and the admin console (auth, posts, tags, SQL,
profile, **Inbox** with pagination and failure states, **Pipeline board** with stage moves and
quick-create, the promote hand-off from Inbox to pipeline, and the **interview Calendar** —
zoneless repaint, the authenticated `.ics` download with the Authorization header asserted on the
wire, and the rejected-outcome snap-back).

### 3. Black-box integration tier (WireMock)

```bash
./run_integration_tests.sh          # boots the stack with ollama replaced by WireMock
./backend/perf/run_jmeter.sh        # JMeter smoke with executable latency budgets
```

Real HTTP against a running stack, with deterministic AI stubs and fault injection
(`__wiremock_slow__` / `__wiremock_error__`). It gates publishing in CI — the four publish jobs
`need` it. Details are in `README_TESTING.md`. **Note:** the stack currently publishes Postgres
on the same host port as your local test database (5433), so booting it evicts that DB and the
next `pytest` fails with a confusing authentication error — stop the stack first.

### 4. Verification Script

Run the entire test suite (Lint, Type Check, Unit, E2E) in one go:

```bash
./verify_all.sh
```

### 5. Tooling self-tests

The scripts that *guard* the repo are themselves tested — they run on throwaway
fixtures and never touch your working tree:

```bash
bash test-bump-version.sh                      # version carriers + CHANGELOG rotation (#186/#193)
bash setup.test.sh                             # the onboarding wizard's guards (11 cases, #61)
bash .claude/hooks/guard-destructive.test.sh   # destructive-command guard (#116/#188)
bash .claude/hooks/pre-push-tests.test.sh      # the pre-push gate's parsing (#237) + diff→leg selection (#377)
bash .claude/hooks/pre-push-tests.test.sh --mutations   # ...and proof those selection cases can go red
sh proxy/test-generate-admin-config.sh         # admin allowlist / real_ip generator (#86)
bash scripts/check_no_pii.sh                   # no personal identifiers (#66) + no maintainer-domain
                                               #   branding on guidance surfaces (#313)
bash scripts/check_no_pii.test.sh              # that checker's own 60 cases, both directions (#313)
```

`scripts/check_live_freshness.sh <url> <version>` is the same family — it powers the daily
Live Freshness workflow and answers `0 fresh / 1 stale / 2 unreachable`, so a green pipeline can
never be mistaken for a live site (#169). A self-test for it is tracked in #280.

### 6. What the pre-push gate actually runs (#377, #404)

The `pre-push-tests.sh` hook no longer runs the whole suite on every push — it runs **the legs the
diff can break**, selected by `.claude/hooks/prepush-select-lib.sh` from
`git diff --name-only @{push}..HEAD` (falling back to `@{upstream}`, then to
merge-base(`origin/main`)), **on every branch, `main` and `release/*` included** (#404, owner
constraint 2026-09-14: a push costs under one minute — CI runs every leg on every push anyway, so
a local full round on `main` duplicated CI 1:1 and measured 30-40 minutes). The push runs the
fast, diff-scoped contract checks plus a **formatting/compilation confirmation** of the changed
code — `ruff check` + `ruff format --check` for backend Python (~0.1s), a per-selected-project
`tsc --noEmit` for frontend TS (~1s each). The **deep** suites — pytest, mypy, bandit, the Vitest
projects — run in CI on every push/PR and at merge time; `PREPUSH_DEEP=1` opts a push into
running them locally.
Measured on one machine, and **the two published sets describe different gates — read the head,
not just the number** (v1.14.2 retro §3, where this ambiguity was itself a class-F finding):

| push shape | after #377 (`e203eb6a`, deep legs still local) | after #404 (`9303b40b`, deep legs moved to CI) |
|---|---|---|
| docs-only | 11m44s → **13s** | → **~3s** |
| backend-only | 11m44s → **1m21s** | → **seconds** (ruff + PII + selection) |
| `projects/public/**` | 11m44s → **15s** | → **~15s** |

The second column is lower for backend because pytest/mypy/bandit left the push entirely; the
`CHANGELOG.md` entry for #377 records the first column, which is why the two files differ.

| changed paths | legs at push time (deep legs in CI, or locally with `PREPUSH_DEEP=1`) |
|---|---|
| `backend/**` | ruff check + format (fast); pytest + mypy + bandit (deep) |
| `backend/migrations/**`, `backend/alembic.ini` | the above + the single-Alembic-head lint |
| `frontend/projects/public/**` | `tsc --noEmit` public (fast); cd-safety + the **public** Vitest project (deep) |
| `frontend/projects/admin/**` | `tsc --noEmit` admin (fast); cd-safety + the **admin** Vitest project (deep) |
| `frontend/projects/shared/**`, any other `frontend/**` | `tsc --noEmit` ×3 (fast); cd-safety + **all three** Vitest projects (deep — both apps consume `shared`) |
| `docs/**`, `*.md`, `CHANGELOG.md`, `README.md` | docs + version consistency |
| `docker-compose*.yml`, `.env.example` | the documented-knob contract |
| `CLAUDE.md`, `.claude/agents|commands|skills/**` | the AI-config map drift check |
| `.claude/hooks/<name>.sh` | that hook's self-test (plain cases — the mutation contracts are CI-only) + the AI-config map drift check |
| `.claude/hooks/hook-parse-lib.sh` | **all four** hook self-tests (they share one parsing model) |
| `.claude/hooks/prepush-select-lib.sh` | this selector's own self-test + the map drift check |
| `scripts/<lint>.sh` | that lint + its self-test + the map drift check¹ |
| `.github/**`, `sonar-project.properties`, `.gitignore` | docs only — CI is the only surface that can test a workflow or scanner config |
| `.mcp.json` | the AI-config map drift check |
| **version carriers** — `VERSION`, `backend/app/main.py`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/projects/shared/package.json`, `frontend/projects/public/src/app/version.ts`, `docker-compose.prod.yml` | **also** version consistency, wherever else they map² |
| **documented-knob sources** — `backend/app/config.py`, `.env.example`, `README.md`, `docs/DEPLOYMENT.md`, `setup.sh`, `docker-compose*.yml` | **also** the documented-knob contract² |
| **anything else** (genuinely unmapped paths) | **everything** |

¹ A lint selects the map check because the selector is pure and cannot tell an EDIT from a
DELETION — and deleting a lint leaves the AI-config map naming a file that no longer exists, which
is exactly what `check_aiconfig_map.sh` fails on. A *rename* is already safe: the new path is
unmapped, so it selects everything.
² These are ADDITIVE, and they are the subtlest way a scoped gate stops noticing a real breakage —
the file looks like "just backend code" while a whole-repo invariant hangs off it.

**Renames select BOTH endpoints.** The diff is taken with `--no-renames`, because git's default
rename detection reports only the *destination*: without it, `git mv frontend/projects/admin/…/x.ts
frontend/projects/public/…/x.ts` would run the public legs and never `admin` — the project that just
lost a module its specs import — and the behaviour would vary with each developer's `diff.renames`
setting.

The safety rules are not conveniences — they are the reason this is allowed to be fast:

- **`PREPUSH_FULL=1`, and any push that publishes more than one branch
  (`--all`/`--mirror`/`--tags`/`--follow-tags`), runs the FULL round**, whatever the diff says.
- **An unmapped path, an empty diff, a range that cannot be computed, or a branch that cannot be
  named runs the FULL round.** "I could not tell" never means "skip".
- **The PII/de-brand guard always runs**, whatever changed.
- **CI (`deploy.yml`) still runs every leg on every push** — including the three hook
  `--mutations` contracts, which are CI-only (the merge gate's alone measures ~9 minutes) and run
  in a parallel job off the build path. Branch protection on `main` requires the full QA set, so
  depth is enforced where the merge happens, not on every keystroke's push.

`bash .claude/hooks/pre-push-tests.test.sh --mutations` neuters one selection rule at a time —
including "select nothing at all" — and requires the selection cases to go red; a selector that
silently selected nothing would otherwise pass every "X must not be selected" case.

`test-bump-version.sh` also runs in CI: the `version-consistency` job executes it
plus `./bump_version.sh --check`, and every image-build job depends on that job, so
a version-carrier mismatch fails the pipeline before anything is published.

## 📁 Project Structure

```text
beaconfolio/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/                 # API endpoints
│   │   ├── models/              # Database models
│   │   ├── services/            # Business logic
│   │   ├── config.py            # Configuration
│   │   ├── database.py          # Database setup
│   │   └── main.py              # FastAPI app
│   ├── migrations/              # Alembic migrations (the schema authority)
│   ├── tests/                   # Backend tests
│   ├── scripts/                 # Utility scripts
│   └── requirements.txt         # Python dependencies
├── frontend/                    # Angular 22 workspace (3 projects)
│   ├── projects/
│   │   ├── public/              # Visitor app — native SSR (src/server.ts), zoneless
│   │   ├── admin/               # Admin console — CSR SPA
│   │   └── shared/              # @beaconfolio/shared library used by both apps
│   ├── e2e/                     # Playwright suites (public-e2e / admin-e2e)
│   ├── Dockerfile               # public (SSR) image
│   ├── Dockerfile.admin         # admin-frontend image
│   └── playwright.config.ts
├── proxy/                       # Reverse proxy (nginx) config + entrypoint
├── scraper/                     # LinkedIn scrapers (profile + posts → *_data.json)
├── importer/                    # LinkedIn → backend post importer
├── docker-compose.yml           # Dev stack
├── docker-compose.prod.yml      # Prod stack (pulls published images)
└── README.md                    # This file
```

## 🔧 Configuration

### Backend Environment Variables

The Docker stack takes everything from the ROOT `.env` (created by
`./setup.sh`; full samples in `.env.example` and `backend/.env.example`).
A `backend/.env` is only for running the backend BARE-METAL outside compose:

```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/beaconfolio
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
BEACONFOLIO_GEMINI_API_KEY=your_api_key_here

# Fernet key that encrypts the per-user Gemini API key at rest (issue #143).
# Empty = plaintext passthrough (backward compatible); set in prod to encrypt.
# Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
BEACONFOLIO_GEMINI_ENCRYPTION_KEY=                          # default: "" (encryption disabled)
#
# NOTE (encrypting EXISTING keys): the `encrypt0002` migration runs once at
# deploy. If BEACONFOLIO_GEMINI_ENCRYPTION_KEY was still empty when it ran, existing keys
# stay plaintext — setting the key later does NOT retroactively encrypt them.
# After enabling the key, encrypt existing rows by either (a) re-saving the key
# in the admin profile UI, or (b) running the idempotent backfill once:
#   cd backend && BEACONFOLIO_GEMINI_ENCRYPTION_KEY=... python -m scripts.backfill_encrypt_gemini_key
# (Regardless of encryption, `/auth/me` never returns the raw key — the network
# EXPOSURE is closed independently of encryption-at-rest.)

# LinkedIn import (optional — leave blank to disable the import endpoint)
LINKEDIN_IMPORT_TOKEN=your_machine_token_here   # default: "" (disabled)
IMPORT_MAX_IMAGE_MB=10                          # default: 10 MB

# Where the saved LinkedIn login session is stored. Defaults to
# /data/linkedin_cookies, backed by the `linkedin_cookies` named volume so the
# session survives container recreates/deploys.
LINKEDIN_COOKIES_DIR=/data/linkedin_cookies    # default: /data/linkedin_cookies

# Operational tuning (issue #207). Each default equals the literal it replaced,
# so omitting the whole block keeps the previous behaviour. These are the values
# whose correct setting depends on the host rather than on the application —
# pagination sizes and API-contract bounds are deliberately NOT here, since they
# are already per-request parameters.
LLM_REQUEST_TIMEOUT_SECONDS=300            # default: 300 — a full LLM completion
LLM_STREAM_TIMEOUT_SECONDS=30              # default: 30  — streamed chat POST
EMBEDDING_REQUEST_TIMEOUT_SECONDS=30       # default: 30
OLLAMA_HEALTHCHECK_TIMEOUT_SECONDS=2       # default: 2   — drives the AI-status probe
OLLAMA_STARTUP_CHECK_TIMEOUT_SECONDS=10    # default: 10  — one-shot startup check
OLLAMA_PREFLIGHT_TIMEOUT_SECONDS=5         # default: 5   — multi-agent conversation pre-flight
PROFILE_DATA_TIMEOUT_SECONDS=5             # default: 5
DB_RESTORE_TIMEOUT_SECONDS=300             # default: 300 — psql restore ceiling
IMPORT_MAX_POSTS_JSON_MB=10                # default: 10 MB
IMPORT_MAX_POSTS_PER_REQUEST=500           # default: 500 entries

# Transparent translation (#248) — forwarded by both compose files.
TRANSLATION_ENABLED=true                   # default: true — false disables cleanly
OWNER_LANGUAGE=en                          # default: en — ISO 639-1; casing/region normalized

# Engagement analytics (#249) — forwarded by both compose files.
ENGAGEMENT_ANALYTICS_ENABLED=true          # default: true — false writes no events and 404s the dashboard
ENGAGEMENT_RETENTION_DAYS=365              # default: 365 — 0 keeps nothing; negative disables purging
ENGAGEMENT_MAX_CONCURRENT_WRITES=4         # default: 4 — size of analytics' OWN connection pool (#326)
ENGAGEMENT_MAX_PENDING_EVENTS=1000         # default: 1000 — beyond this an emit is dropped, counted and logged

# Database connection pool (#326) — forwarded by both compose files.
DB_POOL_SIZE=20                            # default: 20 steady connections for REQUESTS
DB_MAX_OVERFLOW=40                         # default: 40 burst on top → hard ceiling 60 (Postgres allows 100)
DB_ECHO=false                              # default: false — true logs every statement and parameter
```

### Root Environment (Docker Compose)

Docker Compose auto-loads `.env` from the project root — it configures the
compose stacks (image registry/tag, hostnames, admin allowlist, ports, …).
Copy [`.env.example`](.env.example) to `.env` and adjust; every knob is
documented there and has a safe default.

### Deploying as a new owner (fork & go)

All owner-specific deployment/infra settings are externalized behind env/config — a forker
deploys by editing **only** [`.env`](.env.example) (and, for CI publishing, GitHub repository
variables), never tracked source. Copy [`.env.example`](.env.example) to `.env` and set what
identifies you. Every knob has a safe default that preserves the canonical behavior:

| Knob | Where | Default | What it controls |
| --- | --- | --- | --- |
| `IMAGE_REPO` | `.env` (compose) | `ghcr.io/mavrovde/beaconfolio` (prod), `mavrovde` (dev) | Registry/org/name the compose files pull `-backend/-frontend/-admin-frontend/-proxy` images from |
| `IMAGE_TAG` | `.env` (compose) | repo `VERSION` | Pinned image tag to run |
| `REGISTRY`, `IMAGE_NAME` | GitHub **repository variables** | `ghcr.io`, `${{ github.repository }}` | Where `deploy.yml` publishes images (override to retarget the CI publish) |
| `PUBLIC_SERVER_NAME` | `.env` (proxy) | the canonical instance's hostnames | Public site hostname(s) the reverse proxy answers on. **Set this** to `<your-domain> www.<your-domain>` — unlike the other rows, the built-in fallback is not neutral (#313) |
| `ADMIN_SERVER_NAME` | `.env` (proxy) | the canonical instance's admin hostname + `admin.localhost` | Admin console hostname(s). **Set this** to `admin.<your-domain> admin.localhost` — same caveat |
| `ADMIN_ALLOWED_CIDRS` | `.env` (proxy) | *empty → CLOSED (loopback only)* | Trusted operator IPs/CIDRs allowed to reach the admin console. **Never `0.0.0.0/0` in prod.** |
| `TRUSTED_PROXY_CIDRS` | `.env` (proxy **+ backend**) | `172.16.0.0/12` (Docker bridge) | Upstream CIDR(s) nginx trusts for the forwarded-for header (real client IP recovery) — and, since #273, the peers whose `X-Real-IP`/`X-Forwarded-For` the **backend** believes when keying its per-client-IP rate limiters. Empty = trust nothing (every caller keyed by its own peer address) |
| `REAL_IP_HEADER` | `.env` (proxy) | `X-Forwarded-For` | Header carrying the real client IP (set `X-Real-IP` if your front proxy uses it) |
| `POSTGRES_PORT` | `.env` (compose) | `5433` | Postgres listen port + host mapping + backend `DATABASE_URL` |

The reverse proxy renders its `server_name` from `PUBLIC_SERVER_NAME`/`ADMIN_SERVER_NAME` at
container start (`proxy/entrypoint.sh` → envsubst on `proxy/default.conf.template`).

**Admin console access (#86).** The admin subdomain ships **CLOSED** to the public. Because Docker
NAT masks every external client to the bridge gateway inside the container, the proxy first uses
nginx `real_ip` to recover the true client IP from the front proxy's forwarded header
(`set_real_ip_from ${TRUSTED_PROXY_CIDRS}` + `real_ip_header ${REAL_IP_HEADER}` +
`real_ip_recursive on`, generated into `proxy/real_ip.conf`), then filters that IP against the
allowlist generated from `ADMIN_ALLOWED_CIDRS` into `proxy/admin_allowlist.conf` (both by
`proxy/generate-admin-config.sh` at start; the committed files are the safe defaults + fallback).
With `ADMIN_ALLOWED_CIDRS` empty only loopback reaches admin; set your operator IPs/CIDRs to open
it. **Prerequisite:** your front proxy must forward the real client IP in `REAL_IP_HEADER` and its
egress must fall inside `TRUSTED_PROXY_CIDRS` — verify the proxy access logs show the real external
client IP (not the gateway) before relying on the allowlist. A fail-safe re-tests the generated
config (`nginx -t`) and falls back to a closed default if it is invalid, so a bad allowlist can
never crash nginx or silently misfilter. **Break-glass** (works even with an empty allowlist): reach
admin over loopback from on the box, e.g. `docker compose exec proxy wget -qO- --no-check-certificate
--header 'Host: admin.<your-domain>' https://127.0.0.1/`, or an SSH tunnel that originates inside the
proxy container. Pinned third-party base images (`pgvector/pgvector:pg16`,
`ollama/ollama:0.5.7`, `ghcr.io/open-webui/open-webui:v0.11.0`) are pinned in one place:
`docker-compose.prod.yml`. CI does **not** cache these multi-GB images — measured net-negative
(see `.claude/skills/lessons-learned/SKILL.md` §5); the E2E job pulls them registry-direct
during `docker compose up`. The **Ollama model weights** (`nomic-embed-text`,
`llama3.2`, `llama3.2:1b`) are pulled by the stack at startup and are deliberately **not** cached
in CI either — multi-GB actions caches restore as slowly as a fresh pull.

### Marketing artwork: README banner + repo social preview (#311)

The banner at the top of this file and the site's Open Graph card are **generated**, not hand-drawn,
so a fork advertises *its* product instead of inheriting someone else's:

```bash
bash scripts/make-social-image.sh          # rewrites all three files below

# …or re-brand it for your fork (every string is a knob; nothing is baked in):
BRAND_NAME=Yourfolio BRAND_HOST=yourfolio \
  BRAND_TAGLINE="what your product does" \
  BRAND_FEATURES="one,two,three" \
  BRAND_URL=github.com/you/yourfolio bash scripts/make-social-image.sh
```

| File | Size | Used by |
| --- | --- | --- |
| `docs/assets/social-preview.png` | 1280×640 | GitHub's social preview + the README banner |
| `docs/assets/social-preview-thumbnail.png` | 320×160 | legibility evidence (how the card looks in a link unfurl) |
| `frontend/projects/public/src/assets/og-image.png` | 1200×630 | the site's `og:image`/`twitter:image` (`SeoService`, #71) |

Rows are auto-shrunk to fit the terminal frame (down to 60% of their design size); a value too long
even for that — roughly an 80-character product name — fails the run with an error naming the
`BRAND_*` field to shorten, rather than rendering a card that bleeds past the frame.

The card is deliberately **product-branded** — no owner name, no headshot: the hero renders
`profile.name` and `assets/images/profile.png` from runtime config, so a screenshot of the running
site would bake a person into every fork. It is drawn in the site's own visual language instead
(`#33ff00` phosphor on `#050505`, VT323, matrix grid, scanlines).

**One manual step per fork — GitHub has no API for it:** upload `docs/assets/social-preview.png` at
**Settings → General → Social preview → Upload an image…**. That setting is what renders when the
*repository link* is shared (Slack/Discord/X unfurls, GitHub's own previews); the committed file
only covers the README banner and the site card.

The banner links to the **project repository**, not to any single deployment: an unannotated link to
one instance's domain on a guidance surface is exactly what the de-brand contract (#313) rejects, and
this file's one sanctioned reference-deployment aside already exists further down. In your own fork,
point `README.md:1` wherever you like — your live site is the obvious choice.

### Frontend Environment

Each app has its own environment files:
`frontend/projects/public/src/environments/environment.ts` (+ `.prod.ts`) and
`frontend/projects/admin/src/environments/environment.ts` (+ `.prod.ts`).
For example (public):

```typescript
export const environment = {
  production: false,
  apiUrl: '',
  apiPrefix: '/api/app',
  // Deprecated (#65): analytics is RUNTIME config now — set
  // BEACONFOLIO_ANALYTICS_ID, or BEACONFOLIO_GTM_CONTAINER_ID for a Tag
  // Manager container (#447), in the host .env; this field is inert.
  googleAnalyticsId: '',
};
```

## 📣 Owner notifications — channels (#263, #431)

Every new inbox interaction fans out to **all configured channels**; a channel exists exactly
when its config does, and one dead channel never blocks another (nor intake). Scope is
**outbound notification to you, the owner** — one recipient, one direction. Two-way recruiter
conversations (inbound webhooks, reply windows, threading) are a separate feature with a public
attack surface, tracked as [#432](https://github.com/mavrovde/beaconfolio/issues/432) and
deliberately not on this seam.

### Channels that ship today

| Channel | Config | Notes |
|---|---|---|
| Email | `SMTP_*` | the pre-existing path, unchanged |
| **Telegram** | `BEACONFOLIO_TELEGRAM_BOT_TOKEN` + `BEACONFOLIO_TELEGRAM_CHAT_ID` | **2-minute setup**: message [@BotFather](https://t.me/botfather) → `/newbot` → copy the token; then message your bot once and read your chat id from `https://api.telegram.org/bot<token>/getUpdates`. Free; lands on your phone in seconds. |
| Webhook | `BEACONFOLIO_NOTIFY_WEBHOOK_URL` | provider-agnostic JSON POST (`text` + structured fields) — works as-is with Slack/Mattermost/Discord incoming webhooks, ntfy and Gotify |
| **Matrix** | `BEACONFOLIO_MATRIX_HOMESERVER` + `_ACCESS_TOKEN` + `_ROOM_ID` (all three) | free and **self-hostable**: create a bot account on your own homeserver (or matrix.org), get a token from `POST /_matrix/client/v3/login`, invite it to a room, paste the room id (`!abc:your.server`). Sent as `m.notice`, the bot convention. |
| **SMS (self-hosted gateway)** | `BEACONFOLIO_SMS_GATEWAY_URL` + `_USER` + `_PASSWORD` + `_TO` (all four) | an SMS **with no data connection and no app installed**, via [**sms-gate.app**](https://sms-gate.app/) in local mode on your own spare Android phone with your own SIM. Free beyond your SIM plan; **no metered credential exists**. Fails closed if the phone is offline. See the compatibility note below — this channel implements *one* gateway's contract, not a category. |

#### SMS gateway compatibility — one product, named (checked 2026-09-15)

`SmsGatewayChannel` implements **sms-gate.app**'s local-mode contract and nothing else:
`POST http://<phone-ip>:8080/message`, HTTP Basic, body
`{"textMessage": {"text": …}, "phoneNumbers": [ … ]}` (from the vendor's README and its official
Go client; the flat top-level `message` field that client still carries is annotated *"deprecated,
use TextMessage instead"*, so this channel does not send it).

The other self-hosted Android gateways are **not drop-in URLs**, and setting one gets you a
*registered* channel that returns `False` on every send with only an exception type in the log:

| Gateway | Endpoint | Auth | Body |
|---|---|---|---|
| **sms-gate.app** ✅ supported | `POST /message` (local mode) | HTTP **Basic** | `{"textMessage": {"text": …}, "phoneNumbers": […]}` |
| [httpSMS](https://github.com/NdoleStudio/httpsms) ❌ | `POST /v1/messages/send` | `x-api-Key` **header** | requires `content` + `from` + `to` |
| [textbee](https://github.com/textbee/textbee) ❌ | `POST /api/v1/gateway/send-sms` | `x-api-key` **header** | `{"recipients": […], "message": …}` |

Both are fine products — they just need their own `NotificationChannel` class (~25 lines on this
seam), which is exactly what the seam is for. ⚠️ The example URL is `http://`, so Basic auth
crosses your LAN in the clear; prefer `https://` or reach the phone over a tailnet/VPN.

### Every other messenger — the verdict, and the date it was checked

A deferral here is **a decision with a written reason**, not a missing feature: the seam
(`NotificationChannel` in `backend/app/services/notifications.py`) makes any of these one small
class the day the reason changes. Re-open one with new evidence, not new enthusiasm.
**All facts below checked 2026-09-15.**

| Provider | Verdict | Onboarding | Cost model | Why |
|---|---|---|---|---|
| **Telegram** | ✅ **ships** | self-serve (@BotFather) | free | see above |
| **Generic webhook** — Slack, Discord, Mattermost, ntfy, Gotify | ✅ **already covered, no new code** | self-serve webhook URL | free | all five are a JSON POST, so `WebhookChannel` serves them as-is. This is a *finding*, not a gap — there is deliberately no per-provider class. |
| **Matrix** | ✅ **ships** | self-serve; your own homeserver or matrix.org | free | self-hosted-first, same argument as the local-Whisper decision in #264 |
| **SMS — self-hosted Android gateway** (sms-gate.app) | ✅ **ships** | install sms-gate.app on a spare phone; no carrier/A2P registration (traffic is P2P from your own number) | free beyond your SIM plan | the only SMS path with **no metered API credential**. One product's contract — httpSMS/textbee differ, see the note above |
| **SMS — CPaaS** (Twilio, Vonage, MessageBird) | ⛔ **deferred** | account **plus** US A2P 10DLC brand & campaign registration | metered: ≈ **US$0.012–0.013/message** (≈$0.0083 + $0.0035–0.0045 carrier pass-through), plus campaign fees and number rental | **zero capability gain** over the free gateway above, in exchange for a billed credential in the deployment |
| **WhatsApp** | ⛔ **deferred** | Meta business portfolio + WhatsApp Business Account + verified number + **template pre-approval**; business verification to scale | **per-message since 2025-07-01** (this replaced the old per-conversation model) | **Structural, not just cost:** an owner notification arrives with **no open 24-hour customer-service window** — you never messaged your own business number — so it can only be a **pre-approved template with variable substitution**. The free-text summary this app sends cannot be delivered at all. |
| **Viber** | ⛔ **deferred** | **not self-serve since 2024-02-05**: commercial terms only, via Rakuten Viber or a verified partner | metered **plus a monthly minimum per sender id** (≈ €115+) | a monthly floor for one owner's notifications; the recipient must also subscribe to the bot first |
| **Signal** | ⛔ **deferred** | register a number through an **unofficial** client (`signal-cli`) | free | no official API; the REST wrapper is a stateful linked-device daemon — a second service to operate, with ToS risk. **Escape hatch:** already running `signal-cli-rest-api`? Bridge it into the webhook channel via ntfy/Apprise today. |
| **Facebook Messenger** | ⛔ **deferred** | Facebook Page + **Meta App Review** | in-window sends free; out-of-window routes to paid Utility Templates | unsolicited outbound is not a supported use case, and it narrowed in 2026: Message Tags deprecated **2026-02-09**, legacy tags retire **2026-04-27**, Recurring Notifications ended **2026-02-10** |
| **LINE** | ⛔ **deferred** | self-serve LINE Official Account | free tier with a small monthly **push** quota, billed beyond it | works, but push consumes quota and it is regionally specific (JP/TW/TH) — revisit if a forker in those markets asks |
| **WeChat** | ⛔ **deferred** | **overseas-entity verification** (5–10 business days, annual fee) | verification fee + template constraints | template-only sends under strict content rules |

Two notes on the evidence, so you can weigh it rather than trust it. **(1)** WhatsApp's
per-message model and the window/template rules come from
[Meta's WhatsApp pricing docs](https://developers.facebook.com/docs/whatsapp/pricing) as reviewed
on 2026-09-15; that page refuses non-browser clients, so re-check it in a browser before acting
on it. A further change — in-window *service* messages becoming billable on **2026-10-01** with a
reported 1,000-message monthly allowance — is **BSP/industry reporting, not Meta's own page**, and
is recorded here as unconfirmed. **(2)** [Apprise](https://pypi.org/project/apprise/) (BSD-3,
~150 services) was evaluated as a shortcut for all of the above and **rejected**: it puts a large
dependency between the app and every channel, while the two channels worth shipping are ~25 lines
each on a seam that already existed.

## 🌐 Transparent translation (#248)

Recruiter messages arrive in any language; the inbox detects it and shows a translation into
your language (`OWNER_LANGUAGE`, default `en`) — **clearly labeled as machine-generated, with
the original always one click away and never modified in storage**. Local Ollama by default
(nothing leaves your machine); your Gemini key upgrades it if configured. `TRANSLATION_ENABLED=false`
turns the whole feature off cleanly.

## 🎙️ Voice channel (#264) — backend

A visitor can leave a **voice message** instead of typing: the browser records it
(`MediaRecorder`, no telephony provider and no per-minute cost), the audio lands in the same
inbox as everything else as `source=voice_message`, and it is transcribed **locally by
faster-whisper inside the backend container** — no API key exists for this feature and no
billable call is made anywhere (rule 10). The only network access is a **one-time** anonymous
model download into the `whisper_models` volume, so a container restart never re-downloads it
(the same pattern `ollama_data` gives Ollama's models).

**Off by default.** `VOICE_MESSAGES_ENABLED=false` (the shipped default, and the prod-compose
default) means the public endpoint 404s and no model is ever fetched. The dev compose stack turns
it on.

What the backend guarantees, each pinned by a test:

| Guarantee | How |
|---|---|
| Intake never blocks on AI | transcription, notification and translation are background tasks; the 201 is returned after the DB commit |
| A broken transcriber never costs a contact | the audio row + inbox row are already committed; the payload records `transcription: "failed"` and the message stays playable |
| The size cap is real — and the APP owns it | bounded read of `VOICE_MESSAGE_MAX_BYTES + 1` bytes → `413`; nothing is stored. The proxy must stay out of this decision: nginx's default `client_max_body_size` is **1 MB**, below the cap, so `proxy/default.conf.template` sets it to `3m` on the public `/api/app/` location — raise it there first if you raise the cap, or callers get nginx's HTML `413` instead of the endpoint's JSON |
| The duration cap is not the client's word | the endpoint checks the browser's `duration_s`, and the transcriber re-checks the **decoded** length before decoding any segments (2 MB of WebM/Opus is ~3 minutes, i.e. twice the cap) |
| Abuse budget | `VOICE_RATE_LIMIT_REQUESTS`/`_WINDOW_SECONDS` per client IP (3/60s default — tighter than the contact form's 5/60s, because a voice message costs storage *and* CPU) |
| The transcript is an ordinary message | it is written to `Interaction.message`, so the inbox list, promote-to-pipeline and #248's translation need no per-source special case |
| Recruiter audio is private | playback is admin-only; there is no public route to the bytes |

**Measured latency** — faster-whisper 1.2.1, model `base`, `compute_type=int8`, 14.6 s of
recorded speech (172 KB of WebM/Opus), on an 8-core arm64 laptop:

| What | Measured |
|---|---|
| Cold start, first ever call (model **download** + load) | 20.6 s |
| Warm start (weights already in the `whisper_models` volume) | 0.31 s |
| Transcription, first call | 1.88 s |
| Transcription, subsequent calls | 1.09 s (≈0.075× real time) |

So a 90-second message costs roughly 7 s of CPU on that host. **The small-VPS numbers are NOT
these** — a 2-vCPU VPS is the target host class and must be re-measured there before raising
`WHISPER_MODEL` above `base`; the shape to expect is the same (a one-time download, then a
sub-second load and a fraction-of-real-time transcription), scaled by core count.

**Deliberately deferred — PSTN / telephony (verdict dated 2026-09-15).** A real phone number,
call forwarding, voicemail-to-inbox via Twilio/SIP, and voice-**call** escalation as an owner
notification are **not** implemented, for the same reason the CPaaS SMS channel is deferred in the
notifications table above: they require a metered credential (number rental plus per-minute
pricing), public webhook ingress, and call-recording consent handling that varies by jurisdiction.
The seams they would plug into already exist — `NotificationChannel` for escalation, the
`source`/`source_ref` pair for inbound voicemail — so each is a one-class add when an owner
actually needs one. Re-opening the decision needs new evidence, not new enthusiasm.

## 📈 Engagement analytics (#249)

A **private** dashboard in the admin panel (*Engagement*) answering the one question a job search
actually needs: *did anyone engage, and when?* It counts first-party events the site already
produces — CV request, **each** CV download, contact submission — and shows all-time totals, a
per-week trend and a recent-activity feed. Nothing is sent to a third party, and no new personal
data is stored: an event carries a kind, a pointer to the record that already holds the identity
(`cv_requests.id` / `interactions.id`) and a timestamp — no IP, no user agent, no name.

Why a table and not a query over existing rows: `cv_requests.download_count` collapses every
download into a counter plus the LAST timestamp, so "they opened it twice on Tuesday" cannot be
recovered from it. A repeated event needs one row per occurrence.

- **Weekly digest**: *Send weekly digest* emails the owner a counts-only summary via the existing
  SMTP configuration; with no `SMTP_HOST` it is skipped and the UI says so.
- **Retention**: *Purge old events* deletes events older than `ENGAGEMENT_RETENTION_DAYS`
  (0 = keep nothing, negative = never purge). Only events are deleted — the CV requests and inbox
  messages they point at stay.
- **Off switch**: `ENGAGEMENT_ANALYTICS_ENABLED=false` writes no events and 404s the endpoints, so
  the dashboard has no route to reach.

## 🌐 API Endpoints

### Blog Posts

- `GET /api/posts` - List all posts (with filters)
- `GET /api/posts/{slug}` - Get specific post
- `POST /api/posts` - Create new post
- `PUT /api/posts/{slug}` - Update post
- `DELETE /api/posts/{slug}` - Delete post
- `GET /api/posts/{slug}/similar` - Find similar posts
- `GET /api/posts/search/semantic?q=query` - Semantic search

### Recruiter interactions (#69)

- `POST /api/app/interactions/contact` - Public contact form (rate-limited per client IP; validated + normalized input)
- `POST /api/app/interactions/voice` - Public voice message (#264, `multipart/form-data`: `audio` + `duration_s`, optional `name`/`email`/`company`). **404 when `VOICE_MESSAGES_ENABLED=false`**; `415` for anything but `audio/webm`/`audio/ogg`, `413` past the size or duration cap, `429` past the per-IP budget
- `GET /api/app/admin/interactions` - Admin inbox: filter by `status`/`source`, paginated (auth required)
- `PATCH /api/app/admin/interactions/{id}` - Move an interaction through the status workflow (auth required)
- `GET /api/app/admin/interactions/{id}/voice` - Stream a voice message's audio for playback (auth required; **not** flag-gated, so turning intake off never orphans recordings already received)

### Engagement analytics (#249)

All admin-only (auth required); every route 404s when `ENGAGEMENT_ANALYTICS_ENABLED=false`:

- `GET /api/app/admin/analytics/engagement?weeks=8&limit=20` - Totals, the per-week trend
  (Monday-anchored UTC buckets, zero-filled so the chart has no holes) and the recent-activity
  feed in one call
- `POST /api/app/admin/analytics/purge` - Apply `ENGAGEMENT_RETENTION_DAYS` now; returns how many
  events were deleted
- `POST /api/app/admin/analytics/digest` - Send the weekly summary email now; `sent: false` means
  SMTP is unconfigured, which is a normal answer

### Job-search pipeline (#247, phase 1)

All admin-only (auth required):

- `GET /api/app/admin/opportunities` - Pipeline board data: filter by `stage`, paginated
- `POST /api/app/admin/opportunities` - Create an opportunity (strip-then-validate input contract)
- `GET /api/app/admin/opportunities/{id}` - Detail incl. the notes timeline
- `PATCH /api/app/admin/opportunities/{id}/stage` - Move a card through the stage workflow
- `GET/PUT /api/app/admin/site-settings/availability` - The owner's **job-search state**
  (`open|listening|not_looking`), shown on the public hero beside the Hire-me CTA; editable at
  runtime with no redeploy, served publicly via `/config/site` (an older backend without the field
  degrades to `listening` client-side)
- `GET/PUT /api/app/admin/site-settings/theme` - The public site's **preset theme**
  (`terminal|dark|light|modern|classic`), picked in the admin dashboard and applied on the next
  load — no rebuild, no redeploy. `terminal` is the default and is the look the site has always
  had, so an existing deployment is unaffected until someone chooses otherwise. The whole site
  paints from one token set (see `frontend/projects/public/src/styles.css` for the contract a
  theme must supply, colours AND surface effects); the chosen name is stamped into `data-theme`
  on the root element **during SSR**, so the first byte already carries the right theme and there
  is no flash of the wrong one. An unknown value normalizes to `terminal` on both sides rather
  than being passed through — a name no stylesheet block matches would render untokenized
- `POST /api/app/admin/cv/upload` now takes **`activate`** (form field, default `true`):
  `false` uploads a **variant** — listed in `/versions`, attachable to opportunities — while the
  public `/cv/download` keeps serving the current default untouched
- `POST /api/app/admin/opportunities/{id}/cv-sent` - Record which **CV variant** went to this
  company (`cv_document_id`): sets the current pointer + timestamp and appends the durable
  `CV sent: version (filename)` note to the timeline. Never touches which CV the public flow
  serves (`is_active`) — independent facts, pinned by test
- `POST /api/app/admin/opportunities/{id}/notes` - Append a timeline note (optionally linked to an inbox interaction)
- `POST /api/app/admin/opportunities/promote` - Promote an inbox interaction into an opportunity (advances the interaction new → in_progress). **Idempotent per interaction**: a repeat call returns the card created by the first one — enforced by a UNIQUE constraint, so concurrent requests collapse to one card rather than racing. Overrides (`company`, `role_title`) therefore apply only to the FIRST promotion; changing a card afterwards is an edit, not a re-promote. The card's `source` is derived from the interaction's origin (contact_form → recruiter_outreach, cv_request/booking → discovery)

### Tailored application links (#250)

One unlisted page per application: `/for/<slug>` renders the portfolio the way *this* recruiter
should read it — a personal note, the relevant skills and roles first, and the CV variant that
actually went with the application. **The slug is the access control**: there is no token and no
login, so a generated slug carries a random suffix, and unknown / disabled / expired slugs all
return the same **404** (a distinguishable answer would confirm that a guessed slug exists).
`/for/*` is `Disallow`ed in `robots.txt`, carries `robots: noindex, nofollow` in the
server-rendered `<head>`, and is never listed in `sitemap.xml`.

Admin (auth required):

- `POST /api/app/admin/tailored-links` - Mint a link for an opportunity (`opportunity_id`,
  optional `slug` — generated unguessably when omitted, `cv_document_id`, `headline_note`,
  `highlighted_skills`/`highlighted_projects` (≤20 each, trimmed + de-duplicated), `expires_at`).
  A duplicate custom slug is a **409**, never a silent overwrite. Writes a timeline note on the
  opportunity. **`expires_at` given as a bare date (`2026-12-01`, what the admin date picker
  sends) means "through the end of that day"** — it is stored as the last instant of that day in
  UTC, so a link that expires today is live for the rest of today. A value carrying an explicit
  time is honoured literally
- `GET /api/app/admin/tailored-links?opportunity_id=…` - The links of one application (or all),
  with `visit_count`, `cv_download_count`, `last_visited_at` and the copyable absolute `url`
  built from the runtime `SITE_URL`
- `PATCH /api/app/admin/tailored-links/{id}` - Edit or **revoke** (`enabled: false`); `clear_cv` /
  `clear_expiry` clear the nullable fields a JSON `null` cannot distinguish from "absent"
- `DELETE /api/app/admin/tailored-links/{id}` - Remove a link

Public (no auth — the URL is the secret):

- `GET /api/app/for/{slug}` - The tailored payload the page renders. Deliberately carries **no**
  owner metrics (no visit counts, no expiry, no opportunity id)
- `POST /api/app/for/{slug}/visit` - Count one opening. Called from the **browser only**: SSR
  renders the same page server-side, so counting there would double every real visit. Each visit
  lands on the opportunity timeline (`Tailored link /for/… opened (visit #2)`)
- `GET /api/app/for/{slug}/cv` - The **pinned** CV variant (not the site's active default), also
  recorded on the timeline

Both public **writes** (`/visit` and `/cv`) append to the owner's timeline and are unauthenticated
by design, so both are **rate-limited per client IP** — `TAILORED_VISIT_RATE_LIMIT_REQUESTS`
(default 20) per `TAILORED_VISIT_RATE_LIMIT_WINDOW_SECONDS` (default 60); over budget is a
**429 that writes nothing**. The read (`GET /for/{slug}`) is deliberately *not* limited: SSR
fetches it server-to-server, so every rendered visit would share one bucket.

The owner mints and revokes links from the pipeline detail panel in the admin app — no rebuild,
no redeploy.

### Interview calendar (#247 phase 2 / #70)

All admin-only (auth required). Timestamps are stored and returned in **UTC**; any ISO-8601
offset is accepted on input and normalized (a value without an offset is read as UTC).

- `POST /api/app/admin/opportunities/{id}/interviews` - Schedule a slot (`scheduled_at`,
  `duration_minutes` 5–1440, `kind` ∈ `phone|video|onsite|other`, `location_or_link`,
  `interviewer`, `notes`). Advances the opportunity to `interviewing` **forward only** — a card
  already at `offer`/`closed_*` keeps its stage — writes the change to the notes timeline, and
  emails the owner a **reminder with the `.ics` invite attached** (same VEVENT as the export
  route, stable UID) via the configured SMTP; skipped silently when SMTP is unconfigured, and a
  mail failure never fails the scheduling.
- `GET /api/app/admin/opportunities/{id}/interviews` - Every interview on one opportunity, soonest first
- `GET /api/app/admin/interviews/upcoming?days=14` - Scheduled interviews across **all**
  opportunities inside the window (1–365 days), soonest first, cancelled slots excluded; each row
  carries its `company`/`role_title`/`stage` so a dashboard needs no second request
- `GET /api/app/admin/interviews/{id}` - One interview
- `GET /api/app/admin/interviews/{id}.ics` - **Calendar export**: a minimal RFC 5545 VEVENT
  (UTC `DTSTART`/`DTEND`, escaped TEXT values, 75-octet line folding, `STATUS:CANCELLED` for a
  cancelled slot, stable `UID` derived from the row id + `SITE_URL` host) served as
  `text/calendar` with a download `Content-Disposition`
- `PATCH /api/app/admin/interviews/{id}` - Reschedule and/or record the outcome
  (`pending|passed|failed|cancelled`); only the keys sent are applied, and reschedules/outcome
  changes are appended to the opportunity's notes timeline. A **genuine move** (new instant) also
  re-sends the owner reminder with the updated invite; outcome-only edits and same-instant
  "reschedules" send nothing
- `DELETE /api/app/admin/interviews/{id}` - Remove a mis-created slot (204). The removal is
  written to the notes timeline first, so the history survives the row; to keep an interview that
  simply did not happen, PATCH its outcome to `cancelled` instead

#### Post model — LinkedIn provenance fields (nullable)

| Column | Type | Constraint | Purpose |
|---|---|---|---|
| `source_urn` | `String` | unique when not null (partial index) | LinkedIn activity URN; enables idempotent imports |
| `source_url` | `String(512)` | — | LinkedIn permalink for the original post |
| `posted_at` | `DateTime(tz=True)` | — | Original publish timestamp from LinkedIn |

All three columns are `NULL` for posts not imported from LinkedIn. Two posts may both have
`source_urn = NULL`; two non-null URNs must be distinct (enforced by
`ix_post_source_urn_unique`).

#### Database migrations

| Revision | Description |
|---|---|
| `baseline0001` | Baseline schema — all current tables (`users`, `cv_documents`, `cv_requests`, `posts` incl. `image_url`/`image_blob`/`image_type` and LinkedIn provenance columns, `profile_snapshots`). Consolidates what used to be several disjoint/incomplete revisions (see #46). |
| `encrypt0002` | Encrypts stored per-user Gemini API keys at rest (Fernet via `BEACONFOLIO_GEMINI_ENCRYPTION_KEY`); one-time backfill of existing plaintext keys — a no-op if the key env var is empty when it runs (see #143 and the note in the backend env section above). |
| `inbox0003` | Recruiter communication hub (#69): the `interactions` table (unified inbox — source, status workflow, JSON payload, indexes on status/source/created_at). Self-adopting: a no-op if `create_all` already made the table (pre-Alembic installs). |
| `pipeline0004` | Job-search pipeline phase 1 (#247): `opportunities` + `opportunity_notes` tables (stage workflow, recruiter fields, notes timeline linked to inbox interactions). Self-adopting per the guard above. |
| `promote0005` | Promote-from-inbox idempotency (#279): unique `opportunities.promoted_from_interaction_id` + an index on `opportunity_notes.interaction_id`, backfilled from the promotion note. |
| `interview0006` | Interview calendar, pipeline phase 2 (#247/#70): the `interviews` table (UTC `scheduled_at`, duration, kind, location/link, interviewer, outcome) with `ON DELETE CASCADE` to `opportunities` and indexes for per-opportunity listing + the "next N days" range scan. Self-adopting: when the table already exists it adds only the missing indexes, comparing **column sets, not names** (a name check adds duplicates — see the guard note below). |
| `engage0010` | Engagement analytics (#249): the `engagement_events` table (kind, nullable `subject_id` pointing at the source record, JSONB payload, indexes on `created_at` and `kind`). No FK on purpose — an event outlives the record it references, and the two have different retention. Self-adopting per the guard above. |
| `voice0012` | Voice channel (#264): the `voice_messages` table (audio bytes, content type, size, the browser-claimed duration). No FK to `interactions` on purpose — the pointer runs the other way (`interactions.source_ref`), exactly like `cv_requests`. Self-adopting per the guard above. |

New changes get their own revision on top of this baseline — see
[How to write a migration](#how-to-write-a-migration) above.
**Every post-baseline `create_table`/`create_index` migration MUST start with the
self-adopt guard** (`if sa.inspect(op.get_bind()).has_table("..."): return`) — pre-Alembic
installs got their schema from `create_all` and already have an unpredictable subset of
tables (see `inbox0003` and the lessons-learned entry). When the guard has to decide whether an
**index or constraint** is already there, compare **column sets**, never names
(`{tuple(i["column_names"]) for i in inspector.get_indexes(table)}`): `create_all` names objects
differently from the migration, so a name check believes they are missing and creates duplicates
— which `alembic check` cannot see, because it compares column sets too (see `interview0006`).

### Health Check

- `GET /` - Welcome message
- `GET /api/app/ping` - Liveness (always `200 {"ping": "ok"}` once the process is up)
- `GET /api/app/health` - **Readiness** — `200 {"status": "healthy", "ready": true}` only once the
  schema (Alembic migrations) is present. During the cold-start window where uvicorn is up but
  `alembic upgrade head` (run by `docker-entrypoint.sh`) has not finished, it returns a retryable
  `503 {"status": "initializing", "ready": false}` so orchestrators / the E2E gate wait on true
  readiness instead of racing into a raw `500 UndefinedTableError` (see #124).

## 🤖 Ollama Integration

The application uses Ollama for local, free embeddings:

- **Model**: `nomic-embed-text`
- **Dimensions**: 768
- **Cost**: $0 (completely free)
- **Privacy**: All data stays local
- **Speed**: Fast local inference

### Manual Ollama Commands

```bash
# Check available models
curl http://localhost:11434/api/tags

# Generate embedding
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "Your text here"
}'
```

## 📝 Blog Management

### Create Blog Post

```bash
curl -X POST http://localhost:8000/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Post",
    "slug": "my-post",
    "content": "Post content...",
    "summary": "Brief summary",
    "language": "en",
    "published": true
  }'
```

### Semantic Search

```bash
curl "http://localhost:8000/api/posts/search/semantic?q=ollama+embeddings&lang=en"
```

## 🚢 Deployment

> **Compose runbook:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — clean-server first deploy, the
> `DEPLOY_*` secrets that arm the automated rollout, and the required host `.env` values
> (`ADMIN_PASSWORD`, `JWT_SECRET_KEY`).
>
> **Host runbook:** [`docs/wiki/production-deployment.md`](docs/wiki/production-deployment.md) —
> the panel-free SSH flow on a **host shared by several projects** (#310): OS hardening, Docker from
> the vendor APT repo, the shared edge and host port registry, TLS issuance + auto-renewal, resource
> limits and log rotation, rollback, backup/restore and a risk register. Read it **before** the first
> deploy; it moves to the repository wiki verbatim once that wiki is initialized.

### What CI publishes

Every merge to `main` runs `.github/workflows/deploy.yml`: after the lint /
type / unit-test / security gates it builds and pushes four images to GitHub
Container Registry (anonymously pullable), then runs the full Docker E2E
against exactly those images:

```text
ghcr.io/mavrovde/beaconfolio-backend:sha-<gitsha>
ghcr.io/mavrovde/beaconfolio-frontend:sha-<gitsha>
ghcr.io/mavrovde/beaconfolio-admin-frontend:sha-<gitsha>
ghcr.io/mavrovde/beaconfolio-proxy:sha-<gitsha>
```

After a green E2E each `sha-<gitsha>` image is also promoted to the
`<VERSION>` and `latest` tags. GHCR is the project's registry, and the prod compose
files already default `IMAGE_REPO` to it — override it only when deploying from
a different registry/org (below).

### Rolling out to the host

Since #175 the pipeline ends with a **secrets-gated `Roll Out To Prod Host` job**:
when `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` are configured it SSHes to
the host, deploys the immutable `sha-<gitsha>` tag, verifies the containers by
image digest, health-gates `/api/app/health`, freshness-probes `/admin/login`
(→ 404) and rolls back on failure. **Without those secrets it skips and the run
is still green — nothing is rolled out** (the original #112 / #156 gap). See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). To roll out manually, on the host
set in the root `.env`:

```bash
IMAGE_REPO=ghcr.io/mavrovde/beaconfolio
IMAGE_TAG=<version>          # e.g. the current VERSION, or sha-<gitsha>
```

then:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## 🛠️ Development

### Hot Reload

- **Frontend**: Automatic with `ng serve`
- **Backend**: Use `uvicorn app.main:app --reload`

### Code Quality

```bash
# Backend lint + format + types + security (what CI runs)
cd backend
ruff check .
ruff format --check .        # or `ruff format .` to apply formatting
mypy app --ignore-missing-imports --no-error-summary
bandit -r app -ll --skip B101

# Frontend: no linter is configured (CI's `npm run lint --if-present` is a no-op);
# the type gate is the build itself:
cd frontend
npm run build
```

## 📊 Test Coverage

- **Backend**: 100% line & branch coverage — the maintained project standard
  (engineering rule: never below 95%); `pytest` reports it on every run
- **Frontend**: 100% coverage (statements, branches, functions, lines), maintained
  per workspace project (`shared`, `public`, `admin`)
- **E2E**: Playwright suites (`public-e2e`, `admin-e2e`) against the full Docker stack
  (real Ollama integration)

Run coverage reports:

```bash
# Backend
cd backend
pytest --cov=app --cov-report=html
open htmlcov/index.html

# Frontend (per-project reports under coverage/{shared,public,admin}/)
cd frontend
npm run test:coverage
open coverage/public/index.html
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

[MIT](LICENSE) — fork it, rebrand it, ship it under your own name. (The demo content and the
maintainer's own profile data are *not* part of the license grant; bring your own content, #66.)

## 🙏 Acknowledgments

- **Ollama** - Local LLM inference
- **nomic-embed-text** - Free embedding model
- **FastAPI** - Modern Python web framework
- **Angular** - Frontend framework
- **PostgreSQL** - Database with pgvector

## 📞 Contact

Your deployment shows **your** contact details — they come from the site config (#65) and your
uploaded profile data, never from this repository.

- **Reference deployment**: <https://beaconfolio.com> — the **canonical instance** of Beaconfolio (the <!-- de-brand:canonical: the one sanctioned instance aside in this file -->
  maintainer's own install; one deployment of the product, not the product itself)
- **Issues / questions about the project**: [GitHub issues](https://github.com/mavrovde/beaconfolio/issues)

## 🗺️ Roadmap

- [x] Blog management admin interface
- [x] User authentication and authorization (Admin only)
- [x] AI Tag Suggestions (Ollama + Gemini)
- [x] SEO optimization (meta tags, structured data)
- [x] Google Analytics integration
- [x] Gemini AI Chat integration
- [x] CV/Resume management and download
- [x] Admin SQL panel (backup/restore)
- [x] Cookie consent management
- [x] Admin tag manager
- [x] E2E test suite (Playwright)
- [x] RSS feed generation
- [x] Newsletter integration
- [x] Native Angular fragment Anchor Scrolling for SEO Title Tracking
- [x] Automated CD rollout of published images onto the prod host (#175 — activate by adding the `DEPLOY_*` secrets; #112 / #156 close once a real rollout runs)

---

**Built with ❤️ using Angular, FastAPI, and Ollama**

