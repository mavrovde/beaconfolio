# Deployment

> **Two documents, one split (#310).** **This file is canonical for the compose
> project runbook** — environment variables, image coordinates, rollout secrets,
> per-release operator actions. **The host lifecycle and the multi-project layout
> are canonical in the wiki article**: provisioning, OS hardening, the shared
> edge, the host port registry, TLS issuance and renewal, backup/restore and
> incident response. That article lives at
> [`docs/wiki/production-deployment.md`](wiki/production-deployment.md) until the
> repository wiki is initialized, after which it moves there verbatim.
> Read the wiki article **before** the first deploy below; this file assumes the
> host it describes already exists. Its **"What the owner must prepare — cutover
> checklist"** section is the list to work through first: server sizing, DNS, TLS,
> the secrets to generate, and who does what.

Two paths: a **first deploy** onto a clean host (manual, one-time) and the
**automated rollout** that keeps the host current on every green `main` pipeline
once the owner adds three secrets. CI publishes multi-tagged amd64 images to
`ghcr.io/mavrovde/beaconfolio-{backend,frontend,admin-frontend,proxy}` —
`sha-<gitsha>`, the release version (e.g. `1.12.0`), and `latest`. The host pulls
with **no registry login**, so those four packages **must be public** — the four
post-rename `beaconfolio-*` packages were created *private* by GitHub and need a
one-time visibility change (see "One-time action after the rename" below).

The same workflow also runs on **pull requests**, but in verification-only mode
(#208): the lint / type / security / unit-test / migration / version gates run,
while every job that builds, publishes, or rolls out is gated on
`github.event_name == 'push'` — nothing is ever published or deployed from a PR.

## First deploy (clean server)

Prerequisites on the host: Docker Engine + the compose plugin (installed from the
vendor APT repo, not the convenience script), DNS for the public + admin
hostnames pointed at the host, and **a TLS terminator that already holds a valid
certificate for both hostnames** — no server panel is involved anywhere in this
process (owner decision, 2026-09-07; `#156` was closed `not planned`).

There is no panel to hand certificates to the stack, so exactly one of these is
true and you must know which:

- **Shared-edge host (the documented topology):** a host-level **Caddy** edge owns
  80/443 for every project on the box, terminates TLS with certificates it obtains
  and renews itself, and forwards to beaconfolio on a loopback high port. This
  container's self-signed `/CN=localhost` fallback (`proxy/entrypoint.sh`) is then
  **correct** — that hop is internal. Set `PROXY_HTTP_PUBLISH` /
  `PROXY_HTTPS_PUBLISH` in the host `.env` (see `.env.example`).
- **This proxy terminates TLS (single-tenant box):** mount a real
  `fullchain.pem`/`privkey.pem` into the proxy's `/etc/nginx/ssl` and publish
  `443`. One certificate must cover the public **and** admin hostnames (a SAN) —
  `proxy/default.conf.template` points both server blocks at the same files.

Issuance, renewal, the SAN-vs-wildcard decision and the port registry are in
[the wiki article](wiki/production-deployment.md) — do not re-derive them here.

Also decide `COMPOSE_PROJECT_NAME` **before** the first `up`: unset, Compose
derives it from the directory basename, so moving the deploy directory later
orphans every volume. On an existing host, pin the name already in use rather
than the one you would prefer (`.env.example`, "Multi-project host").

```bash
# 1. Get the compose project onto the host (default rollout dir; override with
#    the DEPLOY_DIR secret if you choose another path)
git clone https://github.com/mavrovde/beaconfolio.git /opt/beaconfolio
cd /opt/beaconfolio

# 2. Configure — copy the template and fill EVERY required value
cp .env.example .env
#    Required: ADMIN_PASSWORD and JWT_SECRET_KEY (the backend refuses to start
#    without BOTH — generate the JWT secret with `openssl rand -hex 32`, #177),
#    POSTGRES_PASSWORD, LINKEDIN_IMPORT_TOKEN (for the posts importer),
#    PUBLIC_SERVER_NAME / ADMIN_SERVER_NAME, ADMIN_ALLOWED_CIDRS (keep empty =
#    loopback-only admin until you add your operator IPs — YOUR real IPs, not the
#    RFC 5737 sample addresses; the proxy warns at start if a documentation-range
#    entry slips in, #336).
#    ADMIN LOCKOUT / BREAK-GLASS (#336): once ADMIN_ALLOWED_CIDRS is non-empty,
#    host-loopback THROUGH the proxy (https://127.0.0.1:<port>) is DENIED — nginx
#    sees the Docker bridge-gateway IP, not a loopback or allowlisted client. To
#    get back in from the box: `docker compose exec backend curl -s
#    http://127.0.0.1:8000/api/...` (bypasses nginx), or exec INSIDE the proxy
#    container (`docker compose exec proxy wget -qO- --no-check-certificate
#    --header 'Host: admin.<your-domain>' https://127.0.0.1/`); then fix the list
#    and `docker compose restart proxy`. With the list EMPTY the same two paths
#    apply — the published port is never a break-glass route.
#    Optional: BEACONFOLIO_GEMINI_API_KEY (+ BEACONFOLIO_GEMINI_ENCRYPTION_KEY) — without it the AI
#    features fall back to the in-stack Ollama.
#    Identity (#65/#66 — the committed DEFAULTS are the Jane Doe demo persona):
#    set SITE_URL, SITE_NAME, OWNER_NAME, OWNER_HEADLINE, OWNER_DESCRIPTION,
#    SOCIAL_LINKS (and BEACONFOLIO_ANALYTICS_ID to keep analytics) or the site
#    renders the demo identity and SSR advertises example.com og:url/canonical.
#    The backend prints an IDENTITY line at every startup and flags
#    "DEFAULTS IN USE" loudly when the demo persona is live (#335).
#    ⚠️ PUBLIC_URL is NOT site identity — it only names the freshness/rollout
#    probe target; SITE_URL is the knob SEO/og:url read. Startup warns when
#    PUBLIC_URL is set while SITE_URL is not (#335, measured 2026-09-10).
#    ⚠️ WHICH .env: production reads ONLY the deploy dir's .env (this file,
#    /opt/beaconfolio/.env) — not your laptop's checkout, not a server
#    debug workspace. Edit here, then `docker compose restart <service>`.
#    Then upload the real Profile Data JSON + CV via the admin panel — and the
#    portrait (#333), which has NO panel button yet (one authenticated API
#    call): POST /api/app/admin/profile/photo (JPEG/PNG <= 5 MB); it is
#    stored in the DB, so it survives every rollout, and until uploaded the
#    hero shows the bundled placeholder. /linkedin-sync step 3 automates it.
#    Image coordinates: IMAGE_REPO defaults to ghcr.io/mavrovde/beaconfolio;
#    set IMAGE_TAG to the release you are deploying (e.g. 1.12.0).

# 3. Pull the validated images and start (never use `down -v` — volumes hold
#    the database and models)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 4. Verify
curl -s https://<public-host>/api/app/health          # -> healthy
curl -s https://<public-host>/api/app/stats/public    # backend_version == IMAGE_TAG
curl -s -o /dev/null -w '%{http_code}' https://<public-host>/admin/login  # -> 404 (freshness probe)
```

Optional notification channels (#263): `BEACONFOLIO_TELEGRAM_BOT_TOKEN` + `BEACONFOLIO_TELEGRAM_CHAT_ID` (Telegram) and `BEACONFOLIO_NOTIFY_WEBHOOK_URL` (Slack/Mattermost/ntfy) — empty = channel off.

The backend runs `alembic upgrade head` on start (schema is created on first
boot) and seeds the admin user from `ADMIN_PASSWORD`. Ollama pulls its models on
first use; the first AI request is slow.

### First content import (LinkedIn posts)

From your workstation (scraper session + data live there, see
`scraper/WORKFLOW.md` and `importer/README.md`):

```bash
cd scraper && PLAYWRIGHT_CHANNEL=chrome node scrape-posts.js   # refresh posts_data.json
cd .. && BEACONFOLIO_API_URL=https://<public-host> \
  LINKEDIN_IMPORT_TOKEN=<same value as the host .env> \
  IMPORT_PUBLISH=true python -m importer                        # publish on first import
```

`IMPORT_PUBLISH=true` publishes newly created posts immediately; re-imports
update content but never flip an existing post's published state.

## After the first deploy — verify the job-search surfaces (v1.12.0)

Beyond `backend_version`, check the features this release added, because a misconfigured
identity or a missing admin allowlist fails silently:

```bash
# 1. Identity really came from YOUR .env (not the shipped demo persona)
curl -s https://<public-host>/api/app/config/site | jq '{site_name, owner_name, site_url}'
#    owner_name must NOT be "Jane Doe" and site_url must NOT be example.com
#    (the API serializes snake_case — camelCase keys return null and the check
#     would "pass" while telling you nothing)

# 2. The public contact form accepts a message (creates an inbox interaction)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://<public-host>/api/app/interactions/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Deploy Check","email":"you@example.com","message":"post-deploy probe"}'
#    expect 201; a 429 means the per-IP rate limit is working, also fine

# 3. It arrived: log into the admin console -> Inbox -> the probe is listed
#    (admin is loopback-only until ADMIN_ALLOWED_CIDRS names your operator IP)
```

If SMTP is configured, the owner also receives a notification for step 2; without SMTP the
interaction is still stored and the send is skipped, by design.

## Email options (#262)

Three ways to make notifications flow, in order of recommendation:

1. **External provider (recommended).** Point `SMTP_HOST/PORT/USER/PASSWORD` at any provider
   (a mailbox account, SES, Sendgrid, …). STARTTLS and login are on by default. This is the only
   option with dependable deliverability.
2. **Dev / local: nothing to do.** The dev compose bundles **Mailpit**, a catch-all SMTP + web
   inbox at `http://localhost:8025` — every notification is captured there and **nothing ever
   leaves the machine**. The integration tier asserts the contact-form notification through
   Mailpit's API, so the mail path is CI-tested end to end.
3. **Self-hosted outbound relay (opt-in, eyes open).** `docker compose -f docker-compose.prod.yml --profile mail up` adds a
   send-only postfix (`mailer`) on the private network; set `SMTP_HOST=mailer`, `SMTP_PORT=587`,
   `SMTP_STARTTLS=false`, and `MAIL_SENDER_DOMAIN=yourdomain`. **This does NOT make delivery
   work by itself**: receiving servers will junk or refuse mail unless you set up **SPF** (an
   `include`/`ip4` for your host), **DKIM**, and **reverse DNS** for the host's IP — and many VPS
   providers **block outbound port 25 entirely**, which no compose file can fix. If any of that
   sounds like a chore, use option 1. No documentation here promises otherwise on purpose.

## Automated rollout (the `deploy` job)

`deploy.yml` ends with a `deploy` job that is a **no-op until secrets exist** —
add these in Settings → Secrets and variables → Actions:

| Secret | Required | Meaning |
|---|---|---|
| `DEPLOY_HOST` | yes | Host to SSH to |
| `DEPLOY_USER` | yes | Dedicated non-root deploy user |
| `DEPLOY_SSH_KEY` | yes | Private key for that user (generate a dedicated pair; never reuse a personal key) |
| `DEPLOY_DIR` | no | Compose project dir (default **`/opt/beaconfolio`** since #310 — it was `/opt/mavrov.de`, a maintainer-specific path <!-- de-brand:historical: the pre-#310 default -->). This default is only reached when the secret is unset, and the rollout has never run on any host, so nothing existing is repointed. **A deployment that lives elsewhere sets this secret to its own path.** |
| `DEPLOY_SSH_PORT` | no | SSH port (default 22) |
| `DEPLOY_PUBLIC_URL` | no | Legacy secret for the health-gate URL — superseded by the `PUBLIC_URL` **variable** below, still honoured |

And one repository **variable** (Settings → Secrets and variables → Actions → Variables):

| Variable | Required | Meaning |
|---|---|---|
| `PUBLIC_URL` | forks: yes | The live site's public URL. ONE knob shared by the deploy gate and the scheduled **Live Freshness** workflow (`.github/workflows/live-freshness.yml`, #169) — the secretless daily alarm that goes **red whenever live ≠ released** (version probe + public `/admin/login` → 404), with a distinct "unreachable" verdict for outages. Forks without it skip the workflow instead of probing the canonical site. The verdict logic lives in `scripts/check_live_freshness.sh`, shared by both callers. Note: GitHub auto-disables scheduled workflows after ~60 days of repo inactivity — re-enable it if the repo goes quiet. |

On every green pipeline the job then: rewrites only `IMAGE_REPO`/`IMAGE_TAG`
in the host `.env`, deploying the **immutable `sha-<gitsha>` tag** (never the
mutable version tag — that would make rollback a no-op); `.env.rollback`
records only the previous coordinate lines, never secrets. It pulls and
recreates **only the four app services** (`backend frontend admin-frontend
proxy`, `--no-deps`) so the DB/Ollama/Open-WebUI images and volumes are never
rolled by CI, verifies each running container **by image digest**, waits on
`/api/app/health`, runs the retried freshness probe (`/admin/login` → 404,
issue #169), and **rolls back to the previous sha tag** on failure. Volumes
are never touched (CLAUDE.md rule 9).

**Do not add these secrets before the host can pass the gate.** The health step
polls `https://<PUBLIC_URL>/api/app/health` on **443**. Out of the box this stack
publishes `80` and `10443` and self-signs a `/CN=localhost` certificate, so on a
host with nothing terminating TLS on 443 the rollout would mutate the host and
then fail its own gate on every run. Order of operations: stand the edge up and
get a real certificate first (wiki § TLS certificates), confirm `curl` succeeds with **no
`-k`**, *then* add the secrets.

Host-side hardening checklist: dedicated `deploy` user in the `docker` group
only, `authorized_keys` restricted to that key, password auth off, fail2ban or
an IP allowlist on sshd. The key in GitHub should exist nowhere else. The full
procedure — sshd config, `ufw`, `unattended-upgrades`, the Docker APT repo, and
why `ufw` does **not** protect a published container port — is in the
[wiki article](wiki/production-deployment.md) § Host preparation.

## Upgrading a host across the #141 rename

The Gemini variables are project-scoped since #141. Before rolling out a release that contains it,
rename them in the host `.env`:

```diff
-GEMINI_API_KEY=...
-GEMINI_ENCRYPTION_KEY=...
+BEACONFOLIO_GEMINI_API_KEY=...
+BEACONFOLIO_GEMINI_ENCRYPTION_KEY=...
```

Leaving the old names is **not** fatal — the app ignores them, AI features fall back to the in-stack
Ollama, and the backend prints a `CONFIG WARNING` naming each stale variable at startup (the compose
files pass the legacy *names*, never their values, so nothing sensitive enters the container).
`GEMINI_MODEL`/`GEMINI_MODEL_FALLBACK` follow the same rule; they are namespaced because model choice
is a cost control.

If a host had `GEMINI_ENCRYPTION_KEY` set and rows already encrypted (`enc:v1:` prefix), renaming
without carrying the value over makes those values read as unset — recoverable by setting
`BEACONFOLIO_GEMINI_ENCRYPTION_KEY` to the same key.

Apply it with `docker compose -f docker-compose.prod.yml up -d backend`, **not** `restart`: compose
resolves the environment when it *creates* a container, so `restart` reuses the old values and the
edit appears to have done nothing. Then verify the container actually sees the new names:

```bash
docker compose -f docker-compose.prod.yml exec backend env | grep GEMINI
# expect BEACONFOLIO_GEMINI_*; a bare GEMINI_API_KEY here means the rename did not take
docker compose -f docker-compose.prod.yml logs backend | grep 'CONFIG WARNING'
# any line names a variable still set under its old name on the host
```

## Database-name default (#288)

The default database name is **`beaconfolio`** since the #330 rebrand — it was `hirefolio` <!-- de-brand:historical: the two prior defaults, needed for volume pins -->
from #288, and `mavrov` before that. Postgres reads `POSTGRES_DB` only at **volume initialization**, so this changes
nothing for existing data — but the backend's connection string is interpolated from the
same variable on every boot:

- **Fresh server (the intended moment for this rename):** nothing to do — the volume
  initializes as `beaconfolio` and everything matches.
- **Host created before the rename** (including the current canonical host and any dev
  machine with an existing volume): pin the old name in that host's `.env` **before**
  pulling a post-rename compose file — pin the name your volume actually holds:
  `POSTGRES_DB=hirefolio` (initialised between #288 and #330) or `POSTGRES_DB=mavrov` <!-- de-brand:historical: the two prior defaults, needed for volume pins -->
  (initialised before #288). Without the pin the backend
  looks for a `beaconfolio` database that does not exist in the old volume and fails at
  startup — the data itself is untouched either way.
- Renaming an existing volume's database instead of pinning is a deliberate manual
  migration (`ALTER DATABASE mavrov RENAME TO beaconfolio` with the stack stopped except
  `db`, then drop the pin); do it only if you want the old host to match the product name.

## Registry notes

- **One-time action after the rename to `beaconfolio` (#330):** CI publishes to
  `ghcr.io/<owner>/<repo>-*`, so the first build after the rename creates four
  **brand-new** GHCR packages — `beaconfolio-backend`, `beaconfolio-frontend`,
  `beaconfolio-admin-frontend`, `beaconfolio-proxy`. New packages default to
  **private**, and package visibility does **not** follow a repository rename.
  The prod host pulls with **no `docker login`**, so make all four public once:
  GitHub → your profile → **Packages** → each package → *Package settings* →
  *Change visibility* → **Public**. The rollout job preflights this and fails
  with an explicit message naming the package if it is still private, before it
  touches the host.
- Images published **before** the `beaconfolio` rename remain at their era's path (still
  public). To deploy a pre-rename tag, pin `IMAGE_REPO` to the path that era published:
  `IMAGE_REPO=ghcr.io/mavrovde/hirefolio` for tags between #88 and #330 (e.g. `1.14.0`),
  or `IMAGE_REPO=ghcr.io/mavrovde/mavrov.de` for pre-#88 tags (e.g. `1.8.4`).
- Once made public, keep them public — otherwise every host needs a read-only
  PAT `docker login` and the rollout job's anonymous-pull preflight fails.
- `build_amd64_and_push.sh` remains as a manual fallback for pushing images
  from a workstation.
