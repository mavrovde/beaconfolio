# Testing Guide

This document explains how to run tests and view coverage reports for the Beaconfolio application.

## Backend Tests (Python/FastAPI)

### Prerequisites

- PostgreSQL with `pgvector` running on `127.0.0.1:5433` (`docker compose up -d db`)
- Python 3.12 (the version prod/CI runs; the repo venv lives at `backend/venv`)
- Dependencies installed: `pip install -r requirements.txt -r requirements-dev.txt`

### Test database — isolation warning

**Never run bare `pytest` against the live database.** Point the suite at a
dedicated `test_*` database first — otherwise it can hang on (or write into)
the live dev DB:

```bash
export TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/test_beaconfolio
```

> **Ports:** the integration overlay publishes the stack's Postgres on **5533**, not 5433, so a
> verification stack never evicts your local pytest database (they collided until v1.12.x — the
> symptom was `password authentication failed for user "postgres"` on the NEXT pytest run, which
> looks nothing like a port conflict). Override with `POSTGRES_HOST_PORT` if 5533 is taken.

`conftest.py` resolves `TEST_DATABASE_URL` → `DATABASE_URL` → the app config —
and then HARD-REFUSES to run (pytest.exit) unless the resolved database name
starts with `test_`: the suite drop/creates tables, so any other target would
be destroyed (lesson §4, enforced in code and pinned by
`tests/test_conftest_db_guard.py`). It also auto-creates the database if it is missing (per-worker `<db>_gwN` copies
under `pytest -n`). Only `test_*` databases are ever
dropped by the suite. Do not run two pytest suites at the same time — they
share the test database.

### Running Tests

```bash
cd backend

# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_embeddings.py

# Run specific test
pytest tests/test_embeddings.py::test_get_embedding_success

# Run with coverage
pytest --cov=app --cov-report=html --cov-report=term

# Run only unit tests (exclude integration)
pytest tests/ --ignore=tests/integration/

# Run only integration tests
pytest tests/integration/
```

### Coverage Reports

After running tests with coverage, open the HTML report:

```bash
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

## Frontend Tests (Angular/Vitest v5+)

The frontend is a 3-project workspace (`shared`, `public`, `admin`), each with
its own Vitest config under `projects/<name>/vitest.config.ts`.

### Prerequisites

- Node.js 22 (what CI uses)
- Dependencies installed: `npm install`

```bash
cd frontend

# Run all tests (shared -> public -> admin)
npm run test
npm run test:public          # one project

# Run with coverage (Vitest V8)
npm run test:coverage
npm run test:coverage:admin  # one project

# Run a specific test file (must name the project's config)
npx vitest run --config projects/public/vitest.config.ts src/app/components/header/header.component.spec.ts

# Run with UI (Requires @vitest/ui)
npx vitest --ui --config projects/public/vitest.config.ts
```

### Coverage Reports

Coverage reports are generated per project under `coverage/{shared,public,admin}/`:

```bash
open coverage/public/index.html  # macOS
xdg-open coverage/public/index.html  # Linux
```

## The test tiers — what belongs where (#260)

| Tier | Lives in | Runs against | Job |
|---|---|---|---|
| **Unit** (backend) | `backend/tests/` | in-process ASGI, mocks at boundaries | logic + error paths, 100% coverage gate |
| **Unit** (frontend) | `projects/*/src/**/*.spec.ts` | TestBed, mocked services | component/service logic, 100% per project |
| **Black-box integration** | `backend/tests_integration/` | the RUNNING Docker stack over real HTTP, **WireMock as the `ollama` service** | composition: proxy routing, CORS preflight, authz boundary, 404s, the #69 contact→inbox round trip, pgvector path, AI-boundary behavior incl. fault injection |
| **Performance smoke** | `backend/perf/` (JMeter) | a running stack | executable latency budgets on public endpoints |
| **E2E** | `frontend/projects/*-e2e/` (Playwright) | prod-topology stack | browser behavior, SSR/zoneless regressions |

> Naming honesty: `backend/tests/integration/` (inside the unit tree) is
> in-process **workflow unit tests** — it mocks the boundaries and never leaves
> the process. The black-box tier above is the real integration layer.

### Black-box integration tier

```bash
./run_integration_tests.sh              # boot (dev compose + inttest overlay), seed, run, stop
KEEP_STACK=1 ./run_integration_tests.sh # leave the stack up for iterating
```

The `docker-compose.inttest.yml` overlay replaces the `ollama` service with
**WireMock** (same hostname/port), so AI code paths run against deterministic,
credential-free stubs — rule 10 by construction. Mappings live in
`backend/tests_integration/wiremock/mappings/`; the `fault-*` mappings inject
delays/500s (trigger with `__wiremock_slow__` / `__wiremock_error__` in a
prompt) so timeout/fallback behavior (#207) is tested end-to-end. The suite has
its own pytest rootdir on purpose — the unit run's coverage gate does not apply
to system tests, and `cd backend && pytest` never collects them.

### Performance smoke (JMeter, Dockerized — no local Java)

```bash
./backend/perf/run_jmeter.sh                          # 10 threads, 60 s, 800 ms budget
THREADS=25 DURATION=120 ./backend/perf/run_jmeter.sh
BUDGET_READ_MS=1 ./backend/perf/run_jmeter.sh         # negative test: must exit non-zero
```

Budgets are **executable**: a Duration Assertion fails the sample and the
runner exits non-zero. HTML dashboard lands in `backend/perf/results/<ts>/`.
Perf runs are local/nightly tooling — never a PR gate (shared-runner noise).

## Integration Testing with Docker/Podman

### The two compose stacks

> **Note**: These commands work with both Docker and Podman. If using Podman, it has docker-compose compatibility built-in.

- **Dev stack** — `docker-compose.yml` (built locally): day-to-day development.

  ```bash
  docker compose up -d          # or ./manage.sh start
  docker compose ps             # wait for services to be healthy
  curl http://localhost:11434/api/tags   # check Ollama is ready
  ```

- **Prod + E2E stack** — `docker-compose.prod.yml` overlaid with
  `docker-compose.e2e.yml`: what `./verify_all.sh` (and CI) run the Playwright
  suite against. The E2E overlay switches the prod images to local builds and
  opens the admin allowlist for the test run only; CI additionally injects an
  **empty** `BEACONFOLIO_GEMINI_API_KEY` so the E2E falls back to local Ollama and no paid
  API is ever hit (CLAUDE.md rule 10).

  ```bash
  docker compose -f docker-compose.prod.yml -f docker-compose.e2e.yml up -d --build \
    backend frontend admin-frontend proxy open-webui
  ```

  Prefer running `./verify_all.sh` — it orchestrates the stack, the readiness
  gate, seeding, and both Playwright projects for you.

### Create Sample Data

```bash
cd backend
python scripts/create_sample_posts.py
```

### Test API Endpoints

```bash
# List posts
curl http://localhost:8000/api/posts

# Get specific post
curl http://localhost:8000/api/posts/getting-started-ollama

# Semantic search
curl "http://localhost:8000/api/posts/search/semantic?q=ollama+embeddings&lang=en"

# Similar posts
curl http://localhost:8000/api/posts/getting-started-ollama/similar
```

## Manual Testing Checklist

### Backend

- [ ] Ollama service starts and pulls model
- [ ] Database migrations run successfully
- [ ] API endpoints respond correctly
- [ ] Embeddings are generated for new posts
- [ ] Semantic search returns relevant results
- [ ] Similar posts feature works

### Frontend

- [ ] Application loads without errors
- [ ] Language switching works
- [ ] All components render correctly
- [ ] Profile data loads and displays
- [ ] Responsive design works on mobile
- [ ] Analytics tracking initializes

## Coverage Targets

- **Backend**: 100% line & branch coverage — the maintained project standard
  (engineering rule: never below 95%)
- **Frontend**: 100% coverage (statements, branches, functions, lines),
  maintained per workspace project (`shared`, `public`, `admin`)
- **E2E**: all critical flows validated by the Playwright `public-e2e` +
  `admin-e2e` suites (auth, admin, AI suggestions, blog, CV, LLM, SSR)

(Exact test counts change with every PR — trust the suite output, not this file.)

## Continuous Integration

What CI (`.github/workflows/deploy.yml`) runs:

```bash
# Backend CI
cd backend
pytest -n auto -v --tb=short --cov=app --cov-report=xml --cov-report=term-missing

# Frontend CI (per-project coverage)
cd frontend
npm run test:coverage
```

## Static Analysis (SonarQube, #359)

Local-first, like every other gate in this repo:

```bash
bash scripts/sonar_local.sh          # dockerized SonarQube Community + scanner,
                                     # prints the quality-gate verdict, exits by it
bash scripts/sonar_local.sh --down   # remove the sonar container (volumes kept)
```

The script runs a plain named container (`beaconfolio-sonarqube`) — never a compose
project, so the one-stack guard is not involved — and reuses existing coverage output
(`backend/coverage.xml` from `pytest --cov-report=xml`, `frontend/coverage/*/lcov.info`
from `npm run test:coverage`). Project surface and exclusions are committed in
`sonar-project.properties`, shared with CI.

CI (`.github/workflows/sonarqube.yml`) is **secrets-gated**: without `SONAR_TOKEN` +
`SONAR_HOST_URL` it skips with a note (never red). Recommended CI target when
activated: **SonarCloud** (free for public repos, PR decoration included).

## Troubleshooting

### Backend Tests Fail

- Ensure PostgreSQL is running
- Check test database exists
- Verify Ollama is accessible (for integration tests)

### Frontend Tests Fail

- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check for TypeScript errors: `npm run build`

### Ollama Connection Issues

- Verify Ollama is running: `docker-compose ps`
- Check logs: `docker-compose logs ollama`
- Test endpoint: `curl http://localhost:11434/api/tags`

## Best Practices

1. **Run tests before committing**: Ensure all tests pass
2. **Write tests for new features**: Maintain coverage
3. **Use descriptive test names**: Make failures easy to understand
4. **Mock external dependencies**: Keep tests fast and reliable
5. **Test edge cases**: Handle errors and null values
