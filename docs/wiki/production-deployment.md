# Production deployment — panel-free SSH flow on a multi-project Linux host

Everything needed to take a bare Linux VPS to a hardened, multi-tenant host that
serves beaconfolio (and its neighbours) over valid, auto-renewing HTTPS, rolls a
release automatically, health-gates it, and rolls back when it fails — operated
entirely over SSH.

**Owner constraints, verbatim (2026-09-07):**

> (a) **NO 1Panel and no server panel of any kind** — clear SSH access, operating
> directly on the OS: distro package manager, Docker Engine + compose plugin,
> systemd/journald, plain logs; (b) **the host is shared by multiple projects** —
> beaconfolio is one tenant among several, not the owner of the machine.

> Any proposal that reintroduces a panel, or that assumes exclusive ownership of
> the host, is out of scope by decision.

A third constraint, same date: **valid, auto-renewing HTTPS for every hostname
served from the box is a hard requirement**, not an aside.

## Scope and canonical ownership

Two documents, one split — keep them that way or they drift:

| Surface | Canonical for |
|---|---|
| **This article** | Host lifecycle and multi-project layout: provisioning, OS hardening, the shared edge, the port registry, TLS issuance/renewal, backup/restore, incident response. |
| **`docs/DEPLOYMENT.md`** | The compose project runbook: environment variables, image coordinates, rollout secrets, per-release operator actions. |
| **`.claude/skills/ssh-deploy/`** | The agent-executable operational loop distilled from this article (deploy, verify, roll back, read logs, the traps). |

**Who this is written for.** Beaconfolio is an open project, and this article is
written for **anyone deploying it**, not for one installation. Hostnames appear as
`<your-domain>` / `admin.<your-domain>` where you substitute your own, and as
`example.com` in configuration samples; the deploy directory is `/opt/beaconfolio`
and the compose project is `beaconfolio`. (`beaconfolio.com` is simply the canonical <!-- de-brand:canonical: #315's instance aside, marker added by #313 -->
deployment instance of this product — nothing here is specific to it.)

Assumed distro: **Ubuntu LTS**. 24.04 LTS "Noble Numbat" is the conservative
choice (standard support to April 2029); 26.04 LTS "Resolute Raccoon" shipped
2026-04-23 and is the choice for a brand-new box wanting the longest runway. On
Debian the commands are identical apart from the Docker repository URL
(`download.docker.com/linux/debian`); on RHEL-family substitute `dnf`,
`firewalld` for `ufw`, and `dnf-automatic` for `unattended-upgrades`.

Status of this document: the **design** below is complete and grounded in the
repository as it stands. The **edge and ACME implementation is the cutover's
work** — see § Dry-run rehearsal for what must be executed before the canonical
host is touched, and § What is deferred to the cutover for the explicit list.
**Start with § What the owner must prepare — cutover checklist.**

---

## What the owner must prepare — cutover checklist

Everything needed **before** and **at** the cutover, in the order it is needed.
Each item is tagged **[owner]** (only the owner can do it — an account, a
credential, a purchase, a decision) or **[agent-at-cutover]** (done during the
cutover session, once the owner has handed over SSH access).

The handover itself is one step in the middle: **[owner]** provides the server
IP and root (or sudo) SSH credentials; **[agent-at-cutover]** immediately creates
the unprivileged `deploy` user, installs keys, and turns password authentication
**off** (§ Host preparation). Assume any password shared this way is burned:
rotate or disable it once key-only access is confirmed working.

### 1. The server

- [ ] **[owner]** A Linux VPS/host with **root or sudo SSH access** (user +
      password *or* a key — either is fine; we harden to key-only within minutes
      of first login) and a **public IPv4 address**.
- [ ] **[owner]** Distro: **Ubuntu 24.04 LTS** (recommended — mature, supported to
      April 2029) or **Ubuntu 26.04 LTS** (released 2026-04-23, longest runway).
      Debian works with a different Docker repo URL; RHEL-family needs the
      substitutions noted in § Scope.
- [ ] **[owner]** Sizing. **Measured against this stack on 2026-09-07**, warm,
      with all three models resident:

  | Resource | beaconfolio alone | Shared host (recommended) | Where it goes |
  |---|---|---|---|
  | **RAM** | **8 GB minimum** | **16 GB** | Measured warm: `ollama` **4.195 GiB** (the driver — `OLLAMA_KEEP_ALIVE=-1` keeps 3 models resident), `open-webui` 863 MiB, `db` 168 MiB, `backend` 85 MiB, `frontend` 57 MiB, `admin-frontend` 10 MiB, `proxy` 5 MiB ⇒ **≈ 5.4 GiB**, plus ~1 GB for the OS. 8 GB leaves little for a neighbour; that is why 16 GB is the shared-host number. |
  | **Disk** | **40 GB minimum** | **60–80 GB** | Images ≈ **15.9 GB** for one copy — and two of them dominate: `ollama/ollama:0.5.7` **7.29 GB** and `open-webui:v0.11.0` **6.51 GB** (the four app images total only 1.5 GB). Volumes: `ollama_data` **3.6 GB** (the models again, on disk), `open-webui_data` ~1.1 GB, `postgres_data` grows with content. Add ~1.5 GB because a rollout holds the old **and** new image tags at once, ~0.3 GB of capped logs, and the OS. 25 GB will fill. |
  | **CPU** | **2 vCPU minimum** | **4 vCPU** | Inference is CPU-only here. 2 vCPU works — `llama3.2:1b` exists precisely for that — but generation is slow; 4 makes the AI surfaces pleasant. |
  | **Swap** | 4 GB | 4–8 GB | Turns a bursty model load into slowness instead of an OOM kill (§ Host preparation). |

- [ ] **[owner]** *Optional saving:* dropping the `open-webui` service removes
      **~7.6 GB** (6.51 GB image + 1.1 GB volume). It is reached at `/open/` and is
      not required by the portfolio or the admin console. Decide before sizing.

### 2. Domain and DNS

- [ ] **[owner]** **Decision: which domain this deployment answers on.** This is
      the one choice that is expensive to reverse — it is baked into `SITE_URL`,
      the certificate names, `CORS_ORIGINS` and every published link.
- [ ] **[owner]** **Access to the DNS zone** for that domain (registrar or DNS
      provider login). Needed to create records, and — if DNS-01 were ever chosen
      over the recommended HTTP-01 — to mint an API token. HTTP-01 needs no token.
- [ ] **[owner]** Decide the hostnames. The stack serves **two** roles, and the
      committed defaults point at the canonical deployment instance, so a new
      deployment MUST override `PUBLIC_SERVER_NAME` and `ADMIN_SERVER_NAME`
      (`.env.example`):
  - the **public site** — apex (`example.com`) and/or `www`;
  - the **admin console** — a separate subdomain (`admin.example.com`), never a
    path on the public site.
- [ ] **[owner]** **`A` records for every one of those names → the server IP.**
      Add `AAAA` only if the host really has IPv6 and the edge listens on it — a
      stale `AAAA` makes the site intermittently unreachable for dual-stack
      clients, which is a genuinely nasty failure to debug.
- [ ] **[owner]** **Lower the TTL to 300s at least 24h before cutover**, so a
      mistake is 5 minutes of pain instead of a day. Raise it again once stable.
- [ ] **[agent-at-cutover]** Verify propagation from off-host (`dig +short A …`)
      **before** requesting any certificate — a challenge against a name that does
      not yet resolve here fails and burns rate limit.

### 3. TLS — nothing to buy

- [ ] **[owner]** **With the recommended path (Let's Encrypt), there is NOTHING to
      purchase and no file to hand over.** The prerequisites are only: DNS
      pointing at the host (item 2), **ports 80 and 443 reachable from the
      internet** (item 5), and **an email address for the ACME account**. Provide
      that address; it goes in the Caddyfile.
- [ ] **[owner]** *Only if a provider certificate is used instead:* hand over the
      **`fullchain.pem` and `privkey.pem`** files, plus who renews them and when.
      This path puts a human in the expiry path — see § TLS certificates for why
      it is not recommended.
- [ ] **[owner]** Note: Let's Encrypt **stopped sending expiry emails** on
      2025-06-04. The pre-expiry probe (§ Certificate renewal) is the only warning
      that exists, so the email address above is for the account, not for alerts.

Full reasoning, the SAN-vs-wildcard decision and the renewal runbook:
§ TLS certificates and § Certificate renewal, reload and expiry monitoring.

### 4. Secrets and settings to decide before the first deploy

All of these go in the host `.env` (mode 600). **[owner]** decides or generates
each; **[agent-at-cutover]** writes them to the host and never echoes a value into
a log, PR, issue or commit.

**Required — the stack will not start without the first two:**

- [ ] **[owner]** `ADMIN_PASSWORD` — the admin console login. Strong and unique;
      the backend refuses to seed a login-able admin without it (never ships
      `admin/admin`). Generate: `openssl rand -base64 24`.
- [ ] **[owner]** `JWT_SECRET_KEY` — signs admin tokens; the backend **refuses to
      start** when empty or left at the historical placeholder.
      Generate: `openssl rand -hex 32`. Plain-language explainer below.
- [ ] **[owner]** `POSTGRES_PASSWORD` — `openssl rand -base64 24`. Set it before
      the **first** `up`: it is written into the volume at initialization.
- [ ] **[owner]** `LINKEDIN_IMPORT_TOKEN` — shared secret the importer presents.
      `openssl rand -hex 32`; the same value goes on the workstation that imports.
- [ ] **[owner]** `ADMIN_ALLOWED_CIDRS` — **your operator IP(s)**. Empty (the
      default) means the admin console is reachable only from loopback, which is
      safe but means you cannot log in from your laptop. Find yours with
      `curl -s https://ifconfig.me`. A home IP usually changes — prefer a stable
      office/VPN CIDR, and never `0.0.0.0/0`.
- [ ] **[owner]** **Site identity** — `SITE_URL`, `SITE_NAME`, `OWNER_NAME`,
      `OWNER_HEADLINE`, `OWNER_DESCRIPTION`, `SOCIAL_LINKS`. **The committed
      defaults are the "Jane Doe" demo persona**, so unset values ship a demo site
      and make SSR advertise `example.com` as the canonical URL.

#### What `JWT_SECRET_KEY` actually is (and why it is not your password)

Admin logins here are **stateless**: the server keeps no session list. When you
log in successfully, the backend hands your browser a small signed ticket — a
**JWT** — that says, in effect, *"the bearer of this is the admin, valid until
14:35"*. Your browser sends that ticket with every subsequent request, and the
backend re-checks the **signature** each time instead of looking you up in a
session table. That is what makes it stateless, and it is why the signature has
to be trustworthy.

`JWT_SECRET_KEY` is **the key the server signs those tickets with**. Its only job
is to make a ticket unforgeable.

The consequence is the whole point: **anyone who knows this value can write their
own admin ticket and skip the login entirely.** No password needed, no brute
force, nothing to detect — a forged ticket is indistinguishable from a real one,
because it *is* validly signed. That is why (issue #177) there is deliberately no
default value and the backend **refuses to start** on an empty key or the
historical `your-secret-key-change-in-production` placeholder: a publicly-known
signing key is an open admin door that looks completely normal in the logs.

- **It is not the admin password.** `ADMIN_PASSWORD` is what *you type* to prove
  who you are. `JWT_SECRET_KEY` is what lets the *server trust that a login
  already happened*, on every later request. Changing one has nothing to do with
  the other.
- **Generate it once, on the host.** Best practice: run the command **on the
  server during setup** so the value never travels through chat, email, a file
  you edit locally, or a notes app:

  ```bash
  # on the server, appending straight into the .env — the value is never displayed
  printf 'JWT_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >> /opt/beaconfolio/.env
  ```

- **Nobody memorizes it or needs a copy.** It lives in the host `.env` (mode 600)
  and nowhere else. It is not a GitHub secret, not a password-manager entry you
  must be able to read back, and not something to paste into an issue or PR.
- **Rotating it logs everyone out — and that is the feature.** Replace the value,
  recreate the backend, and every previously issued ticket stops verifying. The
  cost is one re-login; the benefit is that a leaked key is instantly worthless.
  **If you ever suspect it was exposed, rotate it — that is the correct and
  complete response**, and it is far cheaper than the alternative:

  ```bash
  # rotate: edit the value, then RECREATE (not `restart` — see docs/DEPLOYMENT.md:
  # compose reads the environment when it CREATES a container)
  docker compose -f docker-compose.prod.yml up -d backend
  ```

**Optional — each is off when empty, by design:**

- [ ] **[owner]** `BEACONFOLIO_GEMINI_API_KEY` (+ `BEACONFOLIO_GEMINI_ENCRYPTION_KEY`,
      a Fernet key, to encrypt it at rest). Without it the AI features fall back to
      the in-stack Ollama at no cost. **A real key never goes anywhere near CI**
      (rule 10).
- [ ] **[owner]** **SMTP provider credentials** (`SMTP_HOST/PORT/USER/PASSWORD/
      FROM`) — **external provider recommended**. Most VPS providers block
      outbound **port 25** entirely, so the bundled self-hosted relay usually
      cannot deliver at all (item 5).
- [ ] **[owner]** `BEACONFOLIO_TELEGRAM_BOT_TOKEN` + `BEACONFOLIO_TELEGRAM_CHAT_ID`
      (two minutes with `@BotFather`) and/or `BEACONFOLIO_NOTIFY_WEBHOOK_URL`. These
      are also the natural target for the certificate-expiry alarm.

**Decided, not generated:**

- [ ] **[agent-at-cutover]** `COMPOSE_PROJECT_NAME` — pinned before the first
      `up`, never changed afterwards (§ Docker management discipline).
- [ ] **[agent-at-cutover]** `PROXY_HTTP_PUBLISH` / `PROXY_HTTPS_PUBLISH` —
      loopback high ports from the port registry.
- [ ] **`POSTGRES_DB` needs NO pin on a fresh server.** A new volume initializes
      as `beaconfolio` and everything matches (#288). A `POSTGRES_DB` pin applies
      **only** to a host whose volume predates that rename, and its value is that
      host's pre-existing database name.

### 5. Provider-side checks

- [ ] **[owner]** **Provider firewall / security group allows inbound 22, 80,
      443** and denies the rest. This is *separate* from `ufw` on the host and
      silently overrides it — a cloud security group is the most common reason a
      correct `ufw` config still fails.
- [ ] **[agent-at-cutover]** Verify from **off** the host: `nmap -Pn -p
      22,80,443,5433,10443 <ip>` — 22/80/443 open, everything else closed. A
      loopback test proves nothing here.
- [ ] **[owner]** **Outbound port 25 is blocked by most VPS providers.** If it is,
      the self-hosted `mailer` profile cannot deliver mail no matter how it is
      configured — use an external SMTP provider (item 4). Ask the provider, or
      test with `nc -vz smtp.gmail.com 25` from the host.
- [ ] **[owner]** *Only if self-hosted mail is ever wanted:* a **reverse-DNS
      (PTR) record** for the server IP, plus SPF and DKIM in DNS. Without all
      three, receiving servers junk or refuse the mail.

### 6. GitHub-side

- [ ] **[owner]** **Initialize the wiki** — open
      `https://github.com/mavrovde/beaconfolio/wiki` and create the first page
      through the web UI. Until that click, `beaconfolio.wiki.git` does not exist and
      this article cannot be moved out of the repository (`docs/wiki/README.md`).
      This is the one item that is **not** blocked on the server.
- [ ] **[owner]** **GHCR packages public** — the four `beaconfolio-*` packages. The
      host pulls with no `docker login`. *Already done for this repository*; the
      rollout preflights it anyway and names the package if it regresses.
- [ ] **[agent-at-cutover]** **The three `DEPLOY_*` secrets — created DURING the
      cutover, not before.** The key does not exist until the `deploy` user does,
      and adding them to a host that cannot yet pass the health gate produces a
      rollout that mutates the host and fails on **every** push
      (§ Activating the automated rollout).
- [ ] **[owner]** The `PUBLIC_URL` repository **variable** — the live URL, shared
      by the deploy gate and the scheduled Live Freshness alarm.

### 7. Content for the first import

- [ ] **[owner]** **Decision: real content or the demo persona.** The site runs
      either way; the demo persona is a working site with "Jane Doe" on it.
- [ ] **[owner]** If real: the **LinkedIn profile + posts JSON** (produced by the
      scraper on *your* workstation — it needs an interactive login, so it cannot
      run on the server) and the **CV PDF**, uploaded through the admin console.
      See `scraper/WORKFLOW.md` and `importer/README.md`.
- [ ] **[owner]** The scraper session lives in `scraper/.chrome-profile/` on the
      workstation and is gitignored. Nothing about it belongs on the host.

### Cutover-day order

1. **[owner]** DNS records live with a low TTL (≥24h earlier), item 2.
2. **[owner]** Hands over server IP + SSH credentials.
3. **[agent-at-cutover]** Host preparation → key-only SSH, `ufw`, fail2ban, swap.
4. **[owner]** Confirms key-only login works, then **rotates/disables the shared
   password**.
5. **[agent-at-cutover]** Docker Engine, `/etc/docker/daemon.json`, the Caddy edge.
6. **[agent-at-cutover]** Certificates issued; `curl` succeeds with **no `-k`**.
7. **[agent-at-cutover]** First deploy with the item-4 values; verify health,
   identity and the admin login.
8. **[agent-at-cutover]** *Then* the `DEPLOY_*` secrets; push; watch the rollout,
   health gate, freshness verdict and rollback behave.
9. **[owner]** Content import, or accept the demo persona.
10. **[owner]** Raise the DNS TTL again.

---

## Multi-project host architecture

### The decision

**Chosen: option (A) — a dedicated host-level edge.** A **Caddy** instance
installed from its vendor APT repository and run under systemd owns host ports
80 and 443, terminates TLS for *every* hostname the box serves, and forwards to
each project on a **loopback-bound high port** that project registers. Every
tenant — beaconfolio included — stops claiming host-global 80/443 and becomes an
internal upstream.

**Rejected: option (B) — beaconfolio's own `proxy` service as the shared edge.**
It is superficially attractive (the config and the certificate path already
exist), and it was not dismissed on taste. It fails on a measured fact:

- `proxy` is a member of `APP_SERVICES` in `.github/workflows/deploy.yml:934`.
  The rollout runs `docker compose up -d --no-deps backend frontend
  admin-frontend proxy` (`:1060`), so **every beaconfolio release recreates the
  edge**, and the rollback step (`:1107-1132`) recreates it a second time.
- Consequence: every neighbouring project's traffic path is torn down and rebuilt
  on *beaconfolio's* release cadence, and a beaconfolio rollback rolls the shared edge
  back to a beaconfolio-shaped configuration. The acceptance criterion "redeploying
  beaconfolio does not interrupt other projects' traffic — zero failed requests"
  cannot pass under (B) as the pipeline is written.
- The only repair is to remove `proxy` from `APP_SERVICES`, which means proxy
  changes stop deploying at all — reintroducing exactly the "published ≠ live"
  asymmetry #175 was built to close.
- Two smaller costs: every tenant's availability would depend on a beaconfolio image
  build, and the ACME client would live inside an image CI rebuilds on every merge
  — the worst possible home for a long-lived account key.

Within (A), **Caddy over nginx + certbot**, with the trade-off stated honestly:

- **For Caddy.** Automatic HTTPS is built in: it obtains, stores and renews
  certificates itself and swaps them **in-process**. That deletes three separate
  failure modes this repo would otherwise have to operate — a second ACME client,
  a renewal timer that can be disabled, and a reload hook that can be forgotten
  ("renewed on disk, never reloaded" is a real outage shape, and it is in the risk
  register below). Adding a tenant is a four-line block. It installs from a vendor
  APT repo and runs as a systemd unit with journald logs — precisely the
  panel-free, package-manager operation the owner asked for.
- **Against Caddy.** The repo's existing nginx knowledge lives in
  `proxy/default.conf.template`, and `certbot --nginx` is the more widely
  documented recipe. Caddy's automatic HTTPS uses HTTP-01/TLS-ALPN-01, so a
  **wildcard** certificate would need DNS-01 through a provider module, which
  means a custom binary (`xcaddy`). We do not need a wildcard (see § TLS), so this
  cost is not paid.
- **Net.** The in-repo nginx expertise concerns the *tenant* proxy, which stays
  nginx and stays unchanged. The edge is a new component under either choice, so
  "we already know nginx" buys less than it appears to. The nginx + certbot
  fallback is documented in full below for an owner who prefers it.

### The measured trap that shapes the edge configuration

**The edge must forward to beaconfolio's HTTPS port, not its HTTP port.**

`proxy/default.conf.template` declares two server blocks that both `listen 80`
and both match the public hostname: an unconditional redirect (`:17-21`,
`return 301 https://$host$request_uri`) which appears **first**, and the main
application block (`:24-31`). nginx selects the first matching block, so a
request arriving on port 80 carrying the real public `Host` is redirected —
straight back to the edge, which forwards it again.

Measured against a running stack (2026-09-07), sending each `Host` through the
tenant proxy. `<public>` is whatever `PUBLIC_SERVER_NAME` is set to:

```
Host: <public>        -> :80   =>  301  https://<public>/   # THE REDIRECT LOOP
Host: localhost       -> :80   =>  200                       # wrong: breaks admin routing
Host: admin.localhost -> :80   =>  403                       # admin block matches BY NAME
Host: <public>        -> :443  =>  200                       # correct upstream
Host: nope.example    -> :80   =>  444 (connection closed)
```

Therefore the edge proxies to the tenant's **443** (`PROXY_HTTPS_PUBLISH`), with
upstream certificate verification disabled — the tenant presents the self-signed
`/CN=localhost` certificate `proxy/entrypoint.sh:4-11` generates, which under this
topology is **correct, not a bug**: that hop never leaves the machine. Rewriting
the `Host` to `localhost` is *not* an acceptable substitute, because the admin
server block matches by name and would stop routing.

A cleaner long-term fix — making the tenant's port-80 redirect conditional on
`$http_x_forwarded_proto` — is deferred to the cutover; it is a change to
`proxy/default.conf.template` that must be validated by the Docker E2E, and it is
not needed for the topology to work.

### Edge configuration (the shape, to be applied at cutover)

```caddyfile
# /etc/caddy/Caddyfile — the ONLY component on this host that terminates TLS.
{
    email ops@example.com          # ACME account contact
}

(tenant_tls) {
    # Tenants present the internal self-signed cert; this hop is loopback-only.
    transport http {
        tls
        tls_insecure_skip_verify
    }
}

example.com, www.example.com {
    reverse_proxy https://127.0.0.1:18443 {
        import tenant_tls
        header_up X-Forwarded-For {remote_host}
    }
}

admin.example.com {
    reverse_proxy https://127.0.0.1:18443 {
        import tenant_tls
        header_up X-Forwarded-For {remote_host}
    }
}

# Second tenant — four lines, no beaconfolio involvement.
other-project.example {
    reverse_proxy 127.0.0.1:18081
}
```

Two consequences for beaconfolio's own configuration:

- `TRUSTED_PROXY_CIDRS` — **check it; do not assume it needs changing.** A
  host-level edge connects to the tenant over loopback, so the packet still
  reaches nginx through Docker NAT and `$remote_addr` is still the **Docker
  bridge gateway** — which the committed default `172.16.0.0/12` already covers.
  The likely outcome is that no change is needed. What is **not** optional is the
  verification: **confirm in the proxy access log that `$remote_addr` is the real
  client IP**, not the gateway, before trusting `ADMIN_ALLOWED_CIDRS`
  (lessons-learned §12 — an allowlist without working `real_ip` is decoration,
  and this is a runtime check that cannot be reproduced locally). Narrow the CIDR
  to the exact observed gateway only if you want to tighten it; a trusted hop can
  spoof the header, so trust as little as works.
- `REAL_IP_HEADER` stays `X-Forwarded-For`; the Caddyfile above sets it.

### Network and volume naming convention

- **One network per project**, created implicitly by Compose and prefixed with the
  project name (`<project>_app-network`). No cross-project network is shared. The
  edge does not join any project network — it reaches tenants over loopback ports,
  which keeps it working for non-Docker tenants too.
- **Volumes carry the project prefix** (`<project>_postgres_data`). Nothing else
  distinguishes one tenant's data from another's, which is why the project name
  must be pinned explicitly (next section).

---

## Docker management discipline

### Explicit compose project names

`COMPOSE_PROJECT_NAME` appeared **nowhere** in this repository before #310. Unset,
Compose derives the project name from the deploy **directory basename**:
a directory named `example.com` normalizes to `examplecom`, and the volume
destroyed in the #91 incident carried exactly such a directory-derived prefix
(lessons-learned §8).

Rename or move that directory and every container, network and volume name
changes with it — the stack comes up against **new, empty volumes**. The database
is intact on disk under the old name; the site simply behaves as though every
record is gone. That is indistinguishable from data loss at 3 a.m.

Pin it in the host `.env`, and **read the current value off the host before you
write one** (same continuity rule as the #288 `POSTGRES_DB` pin):

```bash
docker compose -f docker-compose.prod.yml ps --format '{{.Project}}' | head -1
docker volume ls --filter name=postgres_data      # -> <project>_postgres_data
```

Fresh install: any stable, project-unique value — `beaconfolio` is the obvious one.
Existing host: whatever the two commands above report, character for character. `.env.example` ships it **commented out** on
purpose — a default here would silently orphan the volumes of every host whose
directory basename differs.

### Log rotation

Docker's default `json-file` driver is **unbounded**. One chatty tenant fills the
disk for everyone on the box, and a full disk takes down every project at once.

Both compose files now set a bounded driver on every service via a shared anchor
(`x-logging`), defaulting to `max-size=10m`, `max-file=3` — about 30 MB per
container — and overridable with `DOCKER_LOG_MAX_SIZE` / `DOCKER_LOG_MAX_FILE`.

Set the same defaults **daemon-wide**, so tenants that forget inherit them:

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

```bash
sudo systemctl restart docker     # containers pick it up on next recreate
docker inspect -f '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}' $(docker ps -q)
```

### These settings bind at container CREATE — which the rollout does for only 4 of 7 services

Both `logging:` and `mem_limit:` are applied when a container is **created**, not
when the image changes. The rollout runs `up -d --no-deps backend frontend
admin-frontend proxy` (`deploy.yml`), and `db` / `ollama` / `open-webui` are
deliberately **never** rolled by CI. So on a host that already exists, merging
this change and letting the pipeline roll gives you bounded logs and ceilings on
**four** services, while the other three keep running with their old, unbounded
configuration — indefinitely, because nothing ever recreates them.

That inverts the intent for the service that matters most: **`ollama` is the named
hog, and it is one of the three the rollout does not touch.**

One-time, on the host, after the first rollout that carries this change:

```bash
cd /opt/beaconfolio
docker compose -f docker-compose.prod.yml up -d          # NO --no-deps
```

Compose recreates only containers whose configuration differs, so this is a short
restart of `db`, `ollama` and `open-webui` and a no-op for the rest. **Volumes are
untouched** — it is `up -d`, never `down -v` (rule 9). Ollama re-warms its models
from the cached `ollama_data` volume, so nothing is re-downloaded, but the first
AI request afterwards is slow again. On a shared host this interrupts **only this
tenant**: no neighbour's container is in this compose project.

Verify it actually took, per service — the point of the exercise:

```bash
docker inspect -f '{{.Name}} {{.HostConfig.LogConfig.Config}} mem={{.HostConfig.Memory}}' \
  $(docker compose -f docker-compose.prod.yml ps -aq)
# every line: max-size/max-file present, and mem non-zero where a ceiling is set.
# A `mem=0` on db/ollama/open-webui means the one-time recreate has not run yet.
```

A fresh install never sees this: the first `up -d` creates everything with the
new configuration.

### Disk-space policy that does not require a prohibited command

"The disk is full" is exactly when someone reaches for `docker system prune`. On a
shared host that command is **not project-scoped** and destroys neighbours' data.
CLAUDE.md rule 9 forbids it and `.claude/hooks/guard-destructive.sh` blocks it
(`:365` volume rm/prune, `:370-375` `down -v`, `:377` `system prune`, `:381-383`
`image prune -a`). Note the deliberate gap: **`docker image prune` WITHOUT `-a`
is allowed** — dangling images only, nothing named, no volumes.

Escalate in this order:

```bash
df -h /                                                   # 1. confirm where it went
sudo du -sh /var/lib/docker/containers | tail -1          # 2. logs?
sudo du -sh /var/lib/docker/overlay2                      # 3. images/layers?
docker image prune                                        # 4. dangling ONLY (allowed)
docker image prune --filter 'until=720h'                  # 5. >30d old (allowed)
docker builder prune --filter 'until=168h'                # 6. build cache
```

Never `docker volume prune`, never `docker system prune`, never `image prune -a`.
If those six steps are not enough, the honest answer is a bigger disk or a tenant
that must be asked to shrink — not a command that deletes a neighbour's database.

### Restart policies

Keep `restart: always` on every prod service: it is what survives a host reboot.
Combined with the memory ceilings below, a crash-looping tenant is capped rather
than unbounded — it consumes its own limit and restarts, instead of competing for
the whole machine. Find one with `docker ps --format '{{.Names}}\t{{.Status}}'`
and look for a climbing restart count.

---

## Resource isolation

Ceilings, not reservations: a limit that is never reached changes nothing, and it
only matters on the day a runaway would otherwise OOM-kill a *neighbouring
project*. Set in `docker-compose.prod.yml`, all parameterized:

| Service | Variable | Default | Why |
|---|---|---|---|
| `ollama` | `OLLAMA_MEM_LIMIT` | `8g` | The named hog. `OLLAMA_KEEP_ALIVE=-1` keeps up to `OLLAMA_MAX_LOADED_MODELS` resident indefinitely. **Measured warm: 4.195 GiB** for the three pinned models (`llama3.2` 2.0 GB, `llama3.2:1b` 1.3 GB, `nomic-embed-text` 274 MB). The ceiling is ~2× the observed working set. |
| `backend` | `BACKEND_MEM_LIMIT` | `4g` | FastAPI + agent orchestration. Measured idle: **85 MiB**; the ceiling is headroom for an import or a multi-agent conversation, not a forecast. |
| `db` | `DB_MEM_LIMIT` | `2g` | Postgres with default `shared_buffers`. Measured: **168 MiB**. |
| `open-webui` | `OPEN_WEBUI_MEM_LIMIT` | `2g` | Optional surface; measured **863 MiB**. Capped so it can never be the cause — and droppable entirely (§ What the owner must prepare). |
| `frontend` | `FRONTEND_MEM_LIMIT` | `1g` | Node SSR server. Measured: **57 MiB**. |
| `admin-frontend` | `ADMIN_FRONTEND_MEM_LIMIT` | `512m` | Static nginx. Measured: **10 MiB**. |
| `proxy` | `PROXY_MEM_LIMIT` | `512m` | nginx. Measured: **5 MiB**. |
| `mailer` | `MAILER_MEM_LIMIT` | `256m` | Opt-in `mail` profile only. |

Ceilings deliberately oversubscribe the box; that is correct, because they are
maxima, not claims — the whole set measured **≈ 5.4 GiB** warm against ~17.8 GB of
ceilings. Size `OLLAMA_MEM_LIMIT` to leave every other tenant its working set: on
an 8 GB box, lowering it to `5g` still clears the measured 4.195 GiB while
reserving ~2 GB for a neighbour; on 16 GB the default is fine as shipped. Ollama's
appetite is also why a **swap file** matters (§ Host preparation).

> **On an existing host these ceilings do not exist until you recreate the
> containers.** `mem_limit` binds at container create, and the rollout recreates
> only `backend frontend admin-frontend proxy` — so `db`, `ollama` and
> `open-webui` keep running unlimited until a one-time
> `docker compose -f docker-compose.prod.yml up -d` (no `--no-deps`). `ollama` is
> both the hog this table exists for and one of the three, so skipping that step
> leaves the ceiling that matters unapplied. Command, caveats and the
> per-service verification are in § These settings bind at container CREATE.

CPU is left unlimited by default. Add `cpus:` to any service that needs it —
`cpus: 2.0` under the service key — and prefer it over memory pressure as the
first lever, since a CPU-starved container is slow while a memory-starved one is
killed.

Observing pressure:

```bash
docker stats --no-stream                 # per-container mem/CPU against the limits
free -h                                   # host-wide
journalctl -k | grep -i -e oom -e 'killed process'   # who got killed, and when
docker inspect -f '{{.Name}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' $(docker ps -q)
```

**During a beaconfolio rollout, neighbours are untouched**: the job recreates only
`backend frontend admin-frontend proxy` with `--no-deps`, all inside beaconfolio's
own project, and — under the chosen shared-edge design — the edge is not among
them, so no neighbour's traffic path is modified.

---

## Host port registry

The registry is **this page**. An operator adding a tenant edits the table here in
the same change that opens the port. Anything published and not in the table is a
bug to be explained or closed.

**Reserved (the edge only):**

| Port | Owner | Purpose |
|---|---|---|
| 22 | host | SSH (raise to a non-default port if desired; keep it in `ufw`) |
| 80 | edge (Caddy) | ACME HTTP-01 + redirect to HTTPS |
| 443 | edge (Caddy) | TLS termination for every hostname on the box |

**Assignable to tenants — `127.0.0.1` only, block `18000-18999`.** The
authoritative registry lives IN THE REPO since #338:
[`infra/edge/ports.md`](../../infra/edge/ports.md) — claim a range there via PR,
never by editing this article (a wiki table nobody diffs is how the pre-#338
edge drifted). The committed edge config is
[`infra/edge/Caddyfile`](../../infra/edge/Caddyfile); the only sanctioned way to
change the running edge is `bash infra/edge/apply.sh` (validate → install →
graceful reload; `--check` diffs committed vs running with no changes). The
edge deliberately does NOT roll on tenant deploys — apply is a manual, reviewed
step (#310 option-A rationale). Second-tenant onboarding = PR touching
`ports.md` + `Caddyfile` (template block at its bottom) + one apply.

**beaconfolio's prod bindings — a verdict for each:**

| Binding (before #310) | Verdict | How |
|---|---|---|
| `80:80` (`proxy`) | **Remapped** to loopback | `PROXY_HTTP_PUBLISH=127.0.0.1:18080:80`. Default unchanged (`80:80`) so CI/E2E are untouched; the host `.env` performs the remap at cutover. Note the edge does **not** use this port — see the redirect-loop finding. |
| `10443:443` (`proxy`) | **Remapped** to loopback; this is the edge's actual upstream | `PROXY_HTTPS_PUBLISH=127.0.0.1:18443:443` |
| `${POSTGRES_PORT:-5433}` (`db`) | **Internal-only** (loopback) | Now `${POSTGRES_BIND_HOST:-127.0.0.1}:…`. Reach it with `ssh -L 5433:127.0.0.1:5433 deploy@host`. |
| `open-webui` 8080 | Already internal | Never published; reached through the proxy at `/open/`. |

**Collision detection — run before adding a tenant, and after:**

```bash
# Every listening socket with the process that owns it
sudo ss -ltnp

# Everything Docker has published, per container
docker ps --format '{{.Names}}\t{{.Ports}}'

# Is a specific candidate free? (silence = free)
sudo ss -ltnp | grep -w 18081
```

A tenant that fails to start with `bind: address already in use` has collided;
the fix is a new port from this table, never taking the port from whoever holds
it.

---

## TLS certificates

### Sourcing: two options, one recommendation

**Option 1 — provider-supplied certificates.** The domain registrar or hosting
provider issues a certificate (often 1-year, often a paid DV/OV product) and you
install it by hand. It lands on the host by SCP into the edge's certificate
directory; renewal is a **calendar event a human must honour**, and when it lapses
the accountable party is whoever forgot. It is the right choice only when an
external requirement (an EV certificate, a corporate CA, a pinned chain) forces
it.

**Option 2 — free certificates from a public CA (Let's Encrypt) — RECOMMENDED.**
Automated issuance and renewal, no human in the expiry path, no cost. The
recommendation follows directly from the failure we are trying to prevent: a
lapsed certificate takes down the **public site and the admin console at the same
time** (both server blocks read the same certificate files), so the property that
matters most is *renewal that cannot be forgotten*, and that argues for automation
over a longer-lived manual certificate.

**Challenge type — HTTP-01, and why not DNS-01:**

| | HTTP-01 | DNS-01 |
|---|---|---|
| Proves | Control of one hostname over port 80 at the edge | Control of the DNS zone |
| Needs | Port 80 reachable publicly (the edge already owns it) | A DNS provider API credential **on the host** |
| Wildcards | Not possible | The only way to get one |
| Credential blast radius | None | A token that can rewrite the whole zone — enough to redirect mail or pass someone else's challenges |

**Chosen: HTTP-01.** The edge already owns port 80 for the redirect, so the
requirement costs nothing, and it needs **no DNS credential on the box at all**.
DNS-01 is the correct choice only if a wildcard is ever needed, or if port 80 must
be closed — and then the token belongs in `/root` at mode 600, scoped to one zone.

Note for anyone tempted to run ACME through *beaconfolio's* proxy instead of the
edge: it would not work as configured. The public `:80` block is a blanket
`return 301` (`proxy/default.conf.template:17-21`) and unknown hosts get
`return 444` (`:10-14`), so an HTTP-01 webroot challenge would be redirected away
before it was served. `grep -rn 'well-known\|acme' proxy/` returns nothing. Under
the chosen design this is **N/A** — the host edge owns the challenge and the
project proxy never sees one.

### Coverage decisions

**Within beaconfolio: one SAN certificate, not a wildcard.**
`proxy/default.conf.template:30-31` (public) and `:91-92` (admin) point at the
*same* `fullchain.pem`/`privkey.pem`, so a single certificate must cover
`<your-domain>`, `www.<your-domain>` **and** `admin.<your-domain>`. A SAN certificate listing
those three names does that with HTTP-01 and no DNS credential. A wildcard would
also work but costs a DNS-01 credential and puts every present and future
subdomain behind one key — more blast radius for no benefit at three names.

*Under the chosen topology this certificate is issued and held by the edge*; the
tenant container keeps its internal self-signed pair.

**Across the host: per-domain certificates at the shared edge.** The edge is the
only component that terminates TLS, so it is the only component that needs a
certificate. Each tenant's hostnames get their own certificate — a compromise or
mis-issuance is scoped to one tenant, and a new tenant never touches another's
certificate.

**The internal hop is plaintext-equivalent, and that is fine.** The edge reaches
tenants over `127.0.0.1`, so that traffic never leaves the machine or touches a
network interface. For beaconfolio the hop is nominally HTTPS (to port 18443) with
verification disabled, purely because forwarding to port 80 triggers the redirect
loop measured above — it buys no security and should not be described as if it
does. Any tenant reachable on plain HTTP over loopback is equally acceptable.

### The single ACME client

**Caddy is the only ACME client on this host.** No tenant requests certificates
independently. Two clients renewing the same name is the classic renewal race and
a fast route to a rate limit that blocks the renewal you actually needed.

| | |
|---|---|
| Client | Caddy (built-in ACME) |
| Config | `/etc/caddy/Caddyfile` |
| Certificates + account key | `/var/lib/caddy/.local/share/caddy/` |
| Unit | `systemctl status caddy` |
| Logs | `journalctl -u caddy` |

If the owner chooses the nginx fallback instead, the single client is **certbot**
(`/etc/letsencrypt/`), and the rule is unchanged: exactly one, at the edge.

### Key protection

- Private keys exist **only on the host**, root-owned, not world-readable.
- Never in the repository: `.gitignore:42-45` excludes `proxy/certs/`, and
  `git grep -inE 'BEGIN [A-Z ]*PRIVATE KEY' -- .` returns **0** — verified,
  no key material is tracked.
- **Never a GitHub secret.** GitHub holds the deploy SSH key and nothing else
  cryptographic; a certificate key in CI is a key in CI logs.
- Never echoed into a log, a PR, or an issue.

```bash
sudo find /var/lib/caddy -name '*.key' -o -name '*.pem' | xargs -r sudo ls -l
sudo find /var/lib/caddy /etc/letsencrypt -name '*.pem' -perm /o=r    # expect: no output
```

---

## Certificate renewal, reload and expiry monitoring

**Automation.** Caddy renews from its own long-running process — no timer, no
cron, no reload hook, and it swaps the certificate **in memory**, so there is no
"renewed on disk but never reloaded" state. This is the single strongest reason
it was chosen.

```bash
systemctl status caddy                       # the renewer IS the server
journalctl -u caddy | grep -i -e certificate -e acme -e renew
```

**Proving renewal before it matters.** Caddy has no `--dry-run`, so rehearse
against the **staging** CA on the throwaway host (§ Dry-run rehearsal), where
issuance is effectively unlimited, then remove the staging directive for
production. Never rehearse against production: 50 certificates per registered
domain per 7 days is a global limit shared by every account.

```caddyfile
{
    # REHEARSAL ONLY — issues untrusted certs. Remove for production.
    acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}
```

**nginx + certbot fallback**, if that path is taken — here the reload hook is
mandatory, and it must reload **only the edge**:

```bash
sudo certbot renew --dry-run                             # exit 0 = renewal proven
systemctl list-timers --all | grep -i -e certbot -e acme # a timer exists and is scheduled

# /etc/letsencrypt/renewal-hooks/deploy/reload-edge.sh   (chmod 755)
#!/bin/sh
systemctl reload nginx      # the EDGE only — no tenant is reloaded or restarted
```

A renewed file on disk changes nothing until the serving process reloads;
reloading every tenant instead is unnecessary churn that turns a certificate
renewal into a fleet-wide restart.

**Expiry monitoring that alarms BEFORE the lapse.** This is not optional, and note
that **Let's Encrypt stopped sending expiration notification emails on
2025-06-04** — there is no safety net from the CA. **Implemented (#310):** the
scheduled **Live Freshness** workflow
(`.github/workflows/live-freshness.yml`, "Certificate expiry" step) measures
`notAfter` for every hostname in the `TLS_HOSTNAMES` repository variable
(default: the maintainer's three) and **goes red under 21 days remaining** —
Caddy renews at ~30 days left, so red at 21 means renewal has already been
failing for about nine days. The step runs daily and independently of the
staleness probe; a forker points `TLS_HOSTNAMES` at their own names. The
equivalent hand-run check, for a box not covered by the workflow:

```bash
# Days remaining for every hostname the box serves — alarm under 21
for host in <your-domain> admin.<your-domain> other-project.example; do
  end=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
        | openssl x509 -noout -enddate | cut -d= -f2)
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  echo "$host expires in $days days ($end)"
  [ "$days" -lt 21 ] && echo "ALARM: $host certificate expires in $days days"
done
```

Verify names and expiry by hand at any time:

```bash
echo | openssl s_client -servername <your-domain> -connect <your-domain>:443 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName
```

---

## Host preparation

### Users and SSH

```bash
# A dedicated, non-root deploy user in the docker group ONLY (no sudo).
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy

# Its authorized_keys holds ONE key: the dedicated CI pair, used nowhere else.
sudo -u deploy mkdir -p /home/deploy/.ssh && sudo -u deploy chmod 700 /home/deploy/.ssh
sudo -u deploy tee /home/deploy/.ssh/authorized_keys < deploy_key.pub
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

Membership of the `docker` group is **equivalent to root** — the group can mount
the host filesystem into a container. That is precisely why the deploy user has
no sudo and no interactive password, and why its key is used for nothing else.

### SSH authentication: keys now, certificates as the scale-up path

The host is reached with **SSH key pairs**, and **password authentication is
switched off immediately after the first login**. A password that survives on an
internet-facing host is a permanent, guessable credential; a key is not
guessable, and it is the only thing the automated rollout can use anyway.

**Use ed25519.** It is the modern default: small keys, fast, no parameter choices
to get wrong. (RSA still works — if you must, use `-b 4096` — but there is no
reason to choose it for a new host.)

```bash
# 1. On your WORKSTATION — generate a pair. Use a passphrase for your personal key.
ssh-keygen -t ed25519 -C 'you@workstation'                 # -> ~/.ssh/id_ed25519{,.pub}

# 2. Install the PUBLIC half on the host (never the private half — it never leaves
#    your machine). While password auth is still on, this does it in one step:
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@<host>
#    Or by hand, appending to /home/deploy/.ssh/authorized_keys (mode 600, dir 700).

# 3. TEST THE KEY LOGIN IN A SECOND TERMINAL — before changing anything:
ssh -o PasswordAuthentication=no deploy@<host> 'echo key login OK'
```

Only once that prints `key login OK` do you disable passwords:

```bash
# /etc/ssh/sshd_config.d/99-hardening.conf
PermitRootLogin no                 # root never logs in directly; use sudo from a user
PasswordAuthentication no          # keys only — the whole point of this section
KbdInteractiveAuthentication no    # otherwise a password prompt sneaks back in
PubkeyAuthentication yes
X11Forwarding no
AllowUsers deploy <your-admin-user>
```

```bash
sudo sshd -t && sudo systemctl reload ssh     # validate BEFORE reloading
```

> **The classic lockout, and how to not have it.** Keep your current session
> **open**, and confirm a **brand-new** session logs in before you close it. A
> syntax error plus a closed session is a host only the provider's serial console
> can recover. `sshd -t` catches the syntax error; the second session catches
> everything else. Risk register row 26.

The **rollout key is a separate pair** (§ Activating the automated rollout): a
dedicated, passphrase-less ed25519 key used by GitHub Actions and nowhere else,
so it can be revoked by deleting one line from `authorized_keys` without
affecting your own access. Your personal key keeps its passphrase; the CI key
cannot have one, which is exactly why it must be single-purpose.

**Rotation, with keys:** add the new public key to `authorized_keys`, verify a
login with it, then delete the old line. `authorized_keys` is the access list —
audit it (`wc -l`, and know who owns every entry).

#### SSH certificates — what they would buy, and why not yet

There is a more advanced option, worth knowing exists. Instead of listing every
public key on every host, you run a small **SSH certificate authority**: the CA
signs a user's public key into a **short-lived certificate** (say, 8 hours), and
`sshd` is told to trust *the CA* rather than individual keys:

```bash
# On the host — trust the CA, and stop maintaining per-key authorized_keys:
#   /etc/ssh/sshd_config.d/99-hardening.conf
#   TrustedUserCAKeys /etc/ssh/ca_user_key.pub
#
# Issuing a cert (on the CA, offline/protected):
ssh-keygen -s ca_user_key -I 'you@workstation' -n deploy -V +8h id_ed25519.pub
#   -> id_ed25519-cert.pub, which the client presents alongside its key
```

What it buys:

- **Credentials that expire by themselves.** Access ends when the certificate
  does. Offboarding or a lost laptop stops being an urgent edit on every host.
- **No `authorized_keys` sprawl.** One trusted CA instead of N keys × M hosts,
  which is where stale access actually accumulates.
- **Attributable, constrained access** — the certificate records who it was
  issued to, which usernames it may assume, and which options are permitted.

**Recommendation: plain ed25519 keys for now.** With one owner and one host,
`authorized_keys` has two lines and is trivially auditable, while a CA adds a new
component that must itself be protected, backed up and kept available — if the CA
key is lost or compromised, that is a worse day than a stale `authorized_keys`
entry. Certificates start paying for themselves at **several hosts or several
people**, and that is the moment to revisit this — not before. Named here so the
option is a known choice rather than a discovery.

### Firewall — and what it does not do

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

> **`ufw` does NOT filter Docker-published ports.** Docker publishes a port with a
> DNAT rule in the `PREROUTING` chain; the rewritten packet then traverses
> `FORWARD`, and never enters the `INPUT` chain `ufw` filters. `ufw deny 5433`
> therefore leaves a published Postgres port **reachable from the internet**. This
> is not a misconfiguration to fix with more `ufw` rules — it is how the two
> interact.
>
> The reliable fix is to **bind to `127.0.0.1`**: the DNAT rule then only matches
> packets addressed to loopback, and the kernel drops any off-host packet claiming
> that destination before a firewall rule is consulted. That is exactly what
> `POSTGRES_BIND_HOST` (default `127.0.0.1`) and the loopback `PROXY_*_PUBLISH`
> values do. If a container port genuinely must be filtered rather than
> loopback-bound, the rules belong in the `DOCKER-USER` chain, which Docker
> evaluates before its own.

Verify from **off the host** (a loopback test proves nothing here):

```bash
nmap -Pn -p 22,80,443,5433,10443,18080,18443 <host>   # from a workstation
# expect: 22/80/443 open; everything else closed/filtered
```

### fail2ban, time, swap

```bash
sudo apt install -y fail2ban
# /etc/fail2ban/jail.local
# [sshd]
# enabled = true
# maxretry = 5
# bantime  = 1h
sudo systemctl enable --now fail2ban && sudo fail2ban-client status sshd

sudo timedatectl set-timezone UTC        # logs across tenants must share a clock
sudo hostnamectl set-hostname <host>
```

Swap matters here because of Ollama: model loads are large and bursty, and swap
turns a would-be OOM kill into slowness. Size it at roughly host RAM, capped
around 8 GB:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10 && free -h
```

---

## Docker Engine installation

The **vendor APT repository**, not the convenience script — the repo path is what
`apt upgrade` and `unattended-upgrades` can maintain afterwards.

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin

docker --version && docker compose version     # `docker compose`, NOT `docker-compose`
```

Then write `/etc/docker/daemon.json` (§ Log rotation) and
`sudo systemctl restart docker`. Never add a project's runtime user to `sudo`;
`docker` group membership is all a deploy user needs, and already a great deal.

---

## DNS

Every hostname the box serves needs an `A` record (and `AAAA` if the host has
IPv6 and the edge listens on it) pointing at the host, **before** the first
certificate request — an ACME challenge against a name that does not resolve to
this box fails, and repeated failures burn rate limit.

```bash
dig +short A <your-domain>
dig +short A www.<your-domain>
dig +short A admin.<your-domain>
# each must return the host's public IP; check from off-host, not via /etc/hosts
```

Set a short TTL (300s) while cutting over, and raise it once stable. If the host
has no IPv6 address, publish **no** `AAAA` record — a stale `AAAA` makes the site
intermittently unreachable for dual-stack clients and is a genuinely nasty
intermittent failure.

---

## First deploy

Follow `docs/DEPLOYMENT.md` § First deploy for the environment variables; this
section adds only the host and tenancy context.

```bash
sudo mkdir -p /opt/beaconfolio && sudo chown deploy:deploy /opt/beaconfolio
sudo -u deploy git clone https://github.com/mavrovde/beaconfolio.git /opt/beaconfolio
cd /opt/beaconfolio
cp .env.example .env && chmod 600 .env
```

Before the first `up`, set in `.env`:

- **`COMPOSE_PROJECT_NAME`** — decided now, never changed later (above).
- **`POSTGRES_DB`** — on a host created before the #288 rename, pin that host's
  **existing** database name; a fresh volume needs nothing (it initializes as
  `beaconfolio`).
- **Tenancy bindings** — `PROXY_HTTP_PUBLISH=127.0.0.1:18080:80`,
  `PROXY_HTTPS_PUBLISH=127.0.0.1:18443:443`; leave `POSTGRES_BIND_HOST` at its
  loopback default.
- **Required secrets** — `ADMIN_PASSWORD`, `JWT_SECRET_KEY` (`openssl rand -hex
  32`), `POSTGRES_PASSWORD`. The backend refuses to start without the first two.
- **Identity** — `SITE_URL`, `SITE_NAME`, `OWNER_NAME`, … or the site renders the
  Jane Doe demo persona. The backend prints an `IDENTITY:` line at every startup
  and flags `DEFAULTS IN USE` when the demo persona is live; it also warns when
  `PUBLIC_URL` (the freshness/rollout probe target — *not* an identity knob) is
  set while `SITE_URL` is not (#335 — both traps fired on the 2026-09-10 first
  deploy). Three `.env` files can exist (dev checkout, server workspace, deploy
  dir): **production reads only the deploy dir's** (`/opt/beaconfolio/.env`).

`.env` holds every prod secret: mode 600, owned by the deploy user. On a shared
box, confirm who else can read it — `ls -l .env` and `getent group docker`, since
any member of `docker` can read any file on the machine via a container.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

One-time registry action: the four GHCR packages must be **public**, because the
host pulls with no `docker login` and new packages default to private (visibility
does not follow a repository rename — lessons-learned §20, #88/#189). The rollout
job preflights this and names the offending package.

Ollama pulls its models on first boot — multi-GB and slow; the stack is not ready
until its healthcheck passes. Then add the tenant to the edge (§ Edge
configuration), `sudo systemctl reload caddy`, and verify **without `-k`**:

```bash
curl -sS -o /dev/null -w 'public %{http_code}\n' https://<your-domain>/
curl -sS -o /dev/null -w 'health %{http_code}\n' https://<your-domain>/api/app/health
curl -sS -o /dev/null -w 'http->%{http_code} %{redirect_url}\n' http://<your-domain>/
```

`curl` exits **60** on an untrusted certificate, so a `200` here *is* the
assertion that TLS is real. Never add `-k` to make this pass.

---

## Activating the automated rollout

The `Roll Out To Prod Host` job (`.github/workflows/deploy.yml:928-1132`) is a
guarded no-op until three secrets exist. **Do not add them until the host serves
valid HTTPS on 443** — the health gate polls
`https://<PUBLIC_URL>/api/app/health`, so on a host without a real certificate on
443 the job mutates `.env`, rolls, then fails its own gate and rolls back, on
every push.

```bash
ssh-keygen -t ed25519 -f ./beaconfolio_deploy -C 'github-actions rollout' -N ''
# public half -> /home/deploy/.ssh/authorized_keys on the host
# private half -> the DEPLOY_SSH_KEY secret; then delete the local copy
```

| Secret / variable | Required | Meaning |
|---|---|---|
| `DEPLOY_HOST` | yes | Host to SSH to |
| `DEPLOY_USER` | yes | The `deploy` user |
| `DEPLOY_SSH_KEY` | yes | Private half of the pair above — used nowhere else |
| `DEPLOY_DIR` | no | Compose project dir (default `/opt/beaconfolio`; set it if your host uses another path) |
| `DEPLOY_SSH_PORT` | no | Default 22 |
| `PUBLIC_URL` (**variable**) | forks: yes | Health-gate + Live Freshness URL |
| `TLS_HOSTNAMES` (**variable**) | no | Space-separated hostnames the certificate-expiry alarm probes (#310). Canonical repo defaults to the maintainer's three; a fork without it probes only its `PUBLIC_URL` hostname — set it to cover `admin.` and `www.` too |

What each stage does, and what it means for neighbours:

1. **Gate** (`:938-950`) — with any secret missing, emits a skip notice; the run
   is still green with nothing rolled out.
2. **SSH setup** (`:952-973`) — `ssh-keyscan` TOFU on first contact, then strict
   host-key checking. *Trap:* the first run trusts whatever answers. Compare the
   recorded fingerprint against `ssh-keyscan` run from a machine you trust.
3. **Preflight** (`:975-1001`) — all four images must be anonymously pullable.
4. **Rollout** (`:1003-1063`) — rewrites **only** `IMAGE_REPO`/`IMAGE_TAG` in the
   host `.env`, with line-count guards that abort rather than truncate a
   secret-bearing file; deploys the immutable `sha-<gitsha>` tag; `up -d --no-deps
   backend frontend admin-frontend proxy`; verifies each container **by image
   digest**. `db`, `ollama` and `open-webui` are never rolled by CI, and no
   neighbouring project is touched.
5. **Health + freshness gate** (`:1068-1105`) — 30×10s on `/api/app/health`, then
   the retried freshness verdict.
6. **Rollback** (`:1107-1132`) — restores the previous sha tag from
   `.env.rollback` on any failure.

Deploys are serialized by a concurrency guard (#147): a second merge queues rather
than cancelling. Never trigger overlapping rollouts by hand.

---

## Rollback and incident response

**Automatic:** any failure after the mutation triggers the rollback step, which
restores the previous `IMAGE_REPO`/`IMAGE_TAG` and re-runs `up -d --no-deps`.

**Manual equivalent**, when the job cannot (network died mid-run):

```bash
cd /opt/beaconfolio
cat .env.rollback                      # the previous coordinates, nothing else
grep -E '^IMAGE_(REPO|TAG)=' .env      # what is deployed now

# Re-pin by hand — edit ONLY those two lines; never rewrite .env wholesale
sudo -u deploy sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=sha-<previous>|' .env
docker compose -f docker-compose.prod.yml pull backend frontend admin-frontend proxy
docker compose -f docker-compose.prod.yml up -d --no-deps backend frontend admin-frontend proxy
curl -sS https://<your-domain>/api/app/health
```

**Rollback restores images, not schema.** `alembic upgrade head` runs at backend
start, so a release that migrated the database and then failed leaves the schema
ahead of the rolled-back image. Symptoms are backend startup errors naming a
column or table. Do **not** reach for a destructive reset: capture the error, take
a `pg_dump` (§ Backup), and fix forward — the guard blocks the destructive paths
for exactly this moment.

**"A neighbour is down — is it us?"**

```bash
docker ps --format '{{.Names}}\t{{.Status}}'  # is the neighbour's container even up?
systemctl status caddy                        # shared edge healthy?
journalctl -u caddy -n 100 --no-pager         # 502/504 for that host?
df -h / && free -h                            # shared resource exhausted?
journalctl -k | grep -i oom                   # did WE get something killed?
docker stats --no-stream                      # who is at their ceiling?
```

If beaconfolio is inside its ceilings, the disk is fine, and the edge is healthy,
the fault is the neighbour's. If the edge is unhealthy, it is everyone's — and
the edge is the one component whose restart affects every tenant, so `reload`
(graceful) before `restart`.

---

## Observability

```bash
# Application
docker compose -f docker-compose.prod.yml logs -f --tail 100 backend
docker compose -f docker-compose.prod.yml logs --since 30m proxy
docker compose -f docker-compose.prod.yml ps

# Resolve a container WITHOUT a literal name (#310 removed the fixed names).
# Use -aq when diagnosing: an EXITED container is exactly what you are chasing,
# and plain -q lists only running ones, so it would resolve to an empty id.
docker inspect -f '{{.State.Running}}' "$(docker compose -f docker-compose.prod.yml ps -aq proxy)"

# Host / daemon
journalctl -u docker -n 200 --no-pager
journalctl -u caddy -f
journalctl -k | grep -i -e oom -e 'killed process'

# Capacity
docker stats --no-stream
df -h / && sudo du -sh /var/lib/docker/containers
docker system df                       # reports only; never `prune` from here
```

Remote alarms: the scheduled **Live Freshness** workflow goes red whenever live ≠
released (version probe + public `/admin/login` → 404), sharing
`scripts/check_live_freshness.sh` with the deploy gate. GitHub auto-disables
scheduled workflows after ~60 days of repository inactivity — re-enable it if the
repo goes quiet, or the alarm is silently off. Certificate expiry is **not**
covered by it; that probe is in § Certificate renewal.

---

## Maintenance and upgrades

**Unattended security updates.** `unattended-upgrades` ships on Ubuntu Server;
what it needs is confirmation that it is enabled and that reboots are scheduled
rather than surprising.

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# /etc/apt/apt.conf.d/20auto-upgrades
# APT::Periodic::Update-Package-Lists "1";
# APT::Periodic::Unattended-Upgrade "1";

# /etc/apt/apt.conf.d/50unattended-upgrades — security pocket only, plus:
# Unattended-Upgrade::Automatic-Reboot "true";
# Unattended-Upgrade::Automatic-Reboot-Time "04:00";
# Unattended-Upgrade::Automatic-Reboot-WithUsers "false";

sudo unattended-upgrade --dry-run --debug | tail -20
systemctl list-timers | grep apt-daily
```

`restart: always` plus the reboot time above means an unattended reboot brings
every tenant back by itself. Confirm that on the rehearsal host by actually
rebooting it — an untested assumption about reboot recovery is how a routine
kernel update becomes an outage.

**Docker and OS upgrades.** Docker Engine follows `apt upgrade`; do it
deliberately, with tenants' owners aware, since it restarts the daemon and every
container. Distro release upgrades (`do-release-upgrade`) are a scheduled event
for **all** tenants, never a solo decision — announce, snapshot, then upgrade.

**Base image pins.** `pgvector/pgvector:pg16`, `ollama/ollama:0.5.7`,
`ghcr.io/open-webui/open-webui:v0.11.0` are pinned in `docker-compose.prod.yml`
and are **never** rolled by CI. Bumping the Open WebUI pin is the documented cure
for its volume/schema crash-loop; bumping the Postgres major requires a dump and
restore, never an in-place volume swap.

---

## Backup and restore

Under rule 9, backups are how we avoid ever needing a destructive command — they
are **not** authorization to run one.

**Volumes and what they hold** (per tenant, prefixed with the project name):

| Volume | Contents | Backup |
|---|---|---|
| `<p>_postgres_data` | The database: posts, interactions, settings, users | **Yes — the one that matters** |
| `<p>_ollama_data` | Downloaded models | No — re-downloadable, multi-GB |
| `<p>_open-webui_data` | Open WebUI chats/config | Optional; this is the #91 volume |
| `<p>_linkedin_cookies` | Saved LinkedIn session | Optional; re-login recreates it |

```bash
# Backup — no downtime; write outside /var/lib/docker
cd /opt/beaconfolio
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER:-postgres}" -p "${POSTGRES_PORT:-5433}" \
          -d "${POSTGRES_DB:-beaconfolio}" -Fc \
  > "/var/backups/beaconfolio/db-$(date +%F-%H%M).dump"

# Verify the dump is real — an unverified backup is a hope, not a backup
ls -lh /var/backups/beaconfolio/ | tail -3
pg_restore --list /var/backups/beaconfolio/db-<stamp>.dump | head
```

Keep a nightly cron with retention, and store at least one copy **off the host** —
a backup that only exists on the machine you are protecting protects nothing.
**Installed on the maintainer's host (#310, 2026-09-15):**
`/usr/local/bin/beaconfolio-backup.sh` (dump → verify `PGDMP` header → commit →
14-day retention) run by `/etc/cron.d/beaconfolio-backup` at 03:15 daily; the
first run was executed by hand and its dump verified with `pg_restore --list`
(80 TOC entries). The off-host copy is **still open** — it needs a destination
only the owner can provide (object storage or a second box).

```bash
# Restore into a SCRATCH database first, always
docker compose -f docker-compose.prod.yml exec -T db \
  createdb -U postgres -p 5433 restore_check
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U postgres -p 5433 -d restore_check < db-<stamp>.dump
```

Restoring *over* the live database, or dropping it, is a **rule 9** action needing
explicit authorization that names the resource; `guard-destructive.sh` blocks the
usual shapes. Only `test_*` databases may be dropped autonomously. This applies to
**every tenant on the box**, not just beaconfolio: `docker volume rm`,
`docker volume prune`, `docker compose down -v` and `docker system prune` are
host-wide and not project-scoped — one careless command destroys a neighbour's
data.

**Do-not-touch list on a shared host:** any volume, container, network or compose
project you did not deploy; the edge configuration (coordinate first — it is
everyone's); `/etc/letsencrypt` or `/var/lib/caddy`; another tenant's `.env`.

---

## Risk and impediment register

| # | Risk | Mitigation / open question |
|---|---|---|
| 1 | **Host port collision** between tenants (`bind: address already in use`) | Port registry above is authoritative; `sudo ss -ltnp` before assigning; per-tenant loopback block in `18000-18999`. Never take a port from its holder. |
| 2 | **Shared edge is a single point of failure** | Accepted deliberately: it is one small, stable component under systemd with `restart=always`, versus option (B) where the edge restarts on every beaconfolio release. It is **not** in beaconfolio's rolled service list. `reload` (graceful) before `restart`; validate config before either. |
| 3 | **Certificate renewal race** — two ACME clients, one name | Exactly one client on the box (Caddy, at the edge). Tenants never request certificates. Documented in § The single ACME client. |
| 4 | **Disk exhaustion** by images and unbounded json-file logs | Bounded logging in both compose files **and** `/etc/docker/daemon.json`; the six-step escalation in § Disk-space policy, none of which is a blocked command. |
| 5 | **Accidental cross-project volume destruction** (`volume rm`/`system prune` are host-wide) | Rule 9 + `guard-destructive.sh:365-383` block the blanket forms while leaving scoped `docker image prune` usable; the do-not-touch list above; volumes carry a project prefix so ownership is legible. |
| 6 | **Resource starvation / OOM** caused by one tenant (Ollama) | Per-service memory ceilings (§ Resource isolation), swap sized for model loads, `journalctl -k \| grep -i oom` in the triage loop. |
| 7 | **Compose project-name drift** orphans volumes on a directory rename | `COMPOSE_PROJECT_NAME` pinned explicitly in the host `.env`; read the current value off the host before writing one; `.env.example` ships it unset so no default can orphan anything. |
| 8 | **Certificate expiry** = public site down **and** admin locked out (same cert) | Automated renewal with no human in the path + the pre-expiry probe (alarm at <21 days). Break-glass admin access over loopback from on-box is documented in `.env.example`. |
| 9 | **Renewal silently fails** — renewed on disk, never reloaded | Caddy reloads in-process, so the state cannot occur. On the certbot fallback, the `deploy/reload-edge.sh` hook is mandatory and `certbot renew --dry-run` must exit 0 before cutover. |
| 10 | **HTTP-01 blocked** by the project proxy's `301`/`444` blocks | N/A under the chosen design — the host edge owns port 80 and the challenge; the project proxy never sees one. If option (B) were ever revisited, a `/.well-known/acme-challenge/` exception **before** the redirect becomes mandatory. |
| 11 | **Let's Encrypt rate limits** during rehearsal (50 certs / registered domain / week, global) | Rehearse only against the **staging** directory; use scratch DNS names; remove `acme_ca` before production. |
| 12 | **Private-key exposure** | Keys only on the host, root-owned, non-world-readable; `proxy/certs/` gitignored; verified 0 tracked keys; never a GitHub secret; never echoed to logs. |
| 13 | **SSH key hygiene** | A dedicated ed25519 pair used nowhere else; public half in the deploy user's `authorized_keys` only; local private copy deleted after upload; rotate by replacing both halves. |
| 14 | **Host-key TOFU** on the first `ssh-keyscan` (`deploy.yml:961-963`) | Compare the recorded fingerprint with one obtained from a trusted machine or the provider console before the first real rollout; strict checking applies thereafter. |
| 15 | **GHCR private-package trap** — new packages default to private, visibility does not follow a rename | One-time visibility change for all four packages; the rollout preflight fails with the package name before touching the host (lessons-learned §20). |
| 16 | **Port-25 egress blocked** by most VPS providers (self-hosted mail) | Use an external SMTP provider (`docs/DEPLOYMENT.md` § Email options). The bundled `mailer` profile is opt-in and promises nothing about deliverability. |
| 17 | **Failed Alembic migration mid-rollout** — rollback restores images, not schema | Back up before a migration-bearing release; fix forward from the recorded error; never reset the database to "unstick" it (rule 9). |
| 18 | **#288 `POSTGRES_DB` default rename** on a pre-rename host | Pin that host's **existing** database name in its `.env` **before** pulling a post-rename compose file; data is untouched either way. Fresh volumes need no pin. |
| 19 | **Host `.env` secret hygiene** on a shared box | Mode 600, owned by the deploy user; audit `getent group docker` — every member can read any file on the host through a container, so `docker` group membership *is* the access list. |
| 20 | **Provider firewall / security group** silently overrides `ufw` | Verify from **off the host** with `nmap -Pn`; reconcile the provider's rules with the port registry as part of adding a tenant. |
| 21 | **Ollama first-boot model pull** — time and disk | Multi-GB and slow; the healthcheck gates readiness. Pre-pull before announcing the deploy; ensure free disk before starting. |
| 22 | **Live Freshness workflow auto-disabled** after ~60 idle days | Re-enable after any quiet period; treat a missing scheduled run as an alarm, not as silence. |
| 23 | **`ufw` does not filter Docker-published ports** — an operator believes the DB is firewalled when it is not | Loopback binds by default (`POSTGRES_BIND_HOST`, `PROXY_*_PUBLISH`); `DOCKER-USER` chain if filtering is genuinely required; verify from off-host with `nmap`. |
| 24 | **Edge → tenant port-80 redirect loop** (measured) | Edge forwards to the tenant's **443** with verification disabled. Verify during rehearsal that the public URL returns 200, not a redirect chain. Conditional-redirect fix deferred to cutover. |
| 25 | **`docker` group membership is root-equivalent** | The deploy user has no sudo; the group is minimal and audited; nobody who should not have root on the box is added to it. |
| 26 | **SSH lockout** when disabling password auth — a bad `sshd_config` plus a closed session leaves only the provider's serial console | `sudo sshd -t` before every reload; prove a **new** key session works while the current one is still open; keep `AllowUsers` in sync when adding a user. Recovery path (provider console) identified **before** the change, not during it. |
| 27 | **Loss of the only SSH key** (lost laptop, wiped disk) | Two authorized keys from different machines, or a provider console/recovery mode known to work. SSH certificates (§ SSH authentication) solve this class properly, at the cost of a CA to protect — the scale-up path, not today's. |
| 28 | **`JWT_SECRET_KEY` disclosure** — a forged admin token needs no password and looks legitimate | No default and a startup refusal on empty/placeholder (#177); generated **on the host** so it never transits chat or a file; lives only in `.env` (mode 600), never a GitHub secret. On any suspicion, **rotate** — one re-login invalidates every issued token. |

---

## Dry-run rehearsal

The first real cutover must be a **repeat**, not a first attempt. Nothing below
touches the canonical host.

**Setup.** A throwaway VPS, scratch DNS names (`stage.example`,
`admin.stage.example`, `neighbour.stage.example`), a fork or scratch repository
environment for the `DEPLOY_*` secrets and the `PUBLIC_URL` variable, and the
Caddy `acme_ca` staging directive set.

**Execute, in order:**

1. Host preparation, Docker installation, and the edge — from this article
   verbatim. Where a command does not work as written, fix **the article**.
2. Stand up a trivial **second tenant** (any static container on `127.0.0.1:18100`)
   behind the same edge, with its own hostname.
3. Issue certificates for all three names against **staging**. Confirm `openssl
   s_client` shows the staging issuer and the expected SAN list.
4. Deploy beaconfolio (§ First deploy), confirm `curl` without `-k` returns 200 on
   both beaconfolio names.
5. Add the `DEPLOY_*` secrets in the scratch environment and push. Record the
   health-gate output and the freshness verdict.
6. **Run the neighbour probe across the whole rollout** and record `failed=0`:

```bash
NEIGHBOUR=https://neighbour.stage.example/
fails=0; for i in $(seq 1 300); do
  code=$(curl -sS -o /dev/null -m 5 -w '%{http_code}' "$NEIGHBOUR" || echo 000)
  case "$code" in 2*|3*) ;; *) fails=$((fails+1)); echo "miss #$i -> $code";; esac
  sleep 1
done; echo "failed=$fails"          # expect failed=0
```

7. Deliberately fail the health probe (stop the backend mid-rollout) and confirm
   the **rollback** restores the previous sha tag — with `failed=0` on the
   neighbour again.
8. Reboot the host; confirm every tenant returns unaided.
9. Force a certificate renewal and confirm the edge serves the new certificate
   without a restart.

**Record every output in the issue or its PR.** A step that could not be executed
is named as not executed — never ticked optimistically.

---

## What is deferred to the cutover

Stated plainly so nobody mistakes design for deployment. This document specifies
the following; none of it is implemented in this repository, and none of it can be
without a host:

- Installing and configuring the Caddy edge (`/etc/caddy/Caddyfile`).
- Issuing the first certificates and proving renewal.
- Setting `PROXY_HTTP_PUBLISH` / `PROXY_HTTPS_PUBLISH` /
  `COMPOSE_PROJECT_NAME` in the host `.env` — the values only make sense on the
  host, and the wrong `COMPOSE_PROJECT_NAME` orphans volumes.
- Adding the three `DEPLOY_*` secrets (only after 443 serves a real certificate).
- The pre-expiry certificate alarm and its cron entry.
- The conditional port-80 redirect in `proxy/default.conf.template` (optional
  cleanup; the topology works without it).
- The rehearsal itself, and the `failed=0` neighbour measurement it produces.

## References consulted

Verified 2026-09-07 (this document's claims about the repository are measured
from the tree at that date; the external facts below were confirmed, not
recalled):

- [Docker — Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) — the APT repository path and package list.
- [Ubuntu release cycle](https://ubuntu.com/about/release-cycle) · [Ubuntu 26.04 LTS release notes](https://documentation.ubuntu.com/release-notes/26.04/) — 24.04 LTS supported to April 2029; 26.04 LTS released 2026-04-23.
- [Ubuntu Server — Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/) — `20auto-upgrades` / `50unattended-upgrades`, `apt-daily` timers, reboot options.
- [Let's Encrypt — Rate limits](https://letsencrypt.org/docs/rate-limits/) — 50 certificates per registered domain per 7 days, a global limit.
- [Let's Encrypt — Staging environment](https://letsencrypt.org/docs/staging-environment/) — the rehearsal directory.
- [Let's Encrypt — Expiration notification service has ended](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended) — no CA safety net since 2025-06-04; own the expiry probe.
- [Let's Encrypt — Challenge types](https://letsencrypt.org/docs/challenge-types/) — HTTP-01 vs DNS-01; DNS-01 is the only wildcard route.
- [Baeldung — Docker published ports ignore UFW rules](https://www.baeldung.com/linux/docker-container-published-port-ignoring-ufw-rules) · [chaifeng/ufw-docker](https://github.com/chaifeng/ufw-docker) — the PREROUTING/FORWARD path, `DOCKER-USER`, and the loopback-bind fix.
- [Certbot — renewal hooks and `--dry-run`](https://eff-certbot.readthedocs.io/en/stable/using.html) — the nginx fallback's deploy hook.
