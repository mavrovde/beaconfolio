---
name: ssh-deploy
description: >-
  The panel-free SSH deployment loop for the SHARED, MULTI-PROJECT prod host (#310) — how to roll
  beaconfolio, verify it, roll it back, read host logs, and diagnose a failed `Roll Out To Prod Host`
  run step by step, plus the certificate-renewal runbook and the multi-tenant do-not-touch list.
  Consult BEFORE any host-side action, before adding or changing the DEPLOY_* secrets, when a
  rollout/health gate/freshness gate goes red, when a certificate is near expiry or a TLS error
  appears, and before any command that could touch a NEIGHBOURING project's containers, volumes or
  ports. beaconfolio is ONE TENANT on this box, not its owner.
---

# SSH deploy — the operational loop on a shared host (#310)

Full design and host lifecycle: **`docs/wiki/production-deployment.md`** (moves to
the repository wiki verbatim once the owner initializes it —
`docs/wiki/README.md`). That article is canonical for provisioning, the edge, the
port registry, TLS and backup/restore. **This skill is the operational loop** —
what to run, in what order, and what a failure means.

`docs/DEPLOYMENT.md` stays canonical for the compose runbook (env vars, image
coordinates, rollout secrets).

## The first thing to know

**beaconfolio does not own the host.** Other projects share it. Any command that is
not scoped to beaconfolio's compose project can take a neighbour down, and Docker's
destructive commands are **host-wide, not project-scoped**. Two owner constraints
(2026-09-07) bound everything here: **no server panel of any kind**, and **the
host is shared**.

**Published ≠ live, still.** A green `deploy.yml` run means images were published.
The host was rolled only if the secrets-gated `Roll Out To Prod Host` job actually
ran — the tell is whether `Roll out validated images` and `Health + freshness
gate` are `skipped`. `/deploy-status` checks this. Never say "prod is updated"
from a green run alone.

## Preconditions before the DEPLOY_* secrets are added

Adding `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` to a host that cannot pass
the gate produces a rollout that **mutates the host and then fails on every push**.
The health step polls `https://<PUBLIC_URL>/api/app/health` on **443**, while the
stack out of the box publishes `80` and `10443` and self-signs `/CN=localhost`.

Verify all four, from off the host, before the secrets exist:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<public-host>/api/app/health   # 200, NO -k
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://<public-host>/  # 301 -> https
ssh -p <port> deploy@<host> 'docker compose version'                            # key works, docker group
ssh deploy@<host> 'cd /opt/beaconfolio && ls -l .env'                              # mode 600, deploy-owned
```

`curl` exits **60** on an untrusted certificate, so a `200` without `-k` *is* the
TLS assertion. Never add `-k` to make a check pass — that converts the gate into
decoration.

## Roll out, verify, roll back

The pipeline does this automatically. These are the manual equivalents, for when
it cannot.

```bash
cd /opt/beaconfolio

# State
grep -E '^IMAGE_(REPO|TAG)=' .env
docker compose -f docker-compose.prod.yml ps
cat .env.rollback 2>/dev/null            # previous coordinates only, never secrets

# Roll: edit ONLY the two coordinate lines; never rewrite .env wholesale
sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=sha-<gitsha>|' .env
docker compose -f docker-compose.prod.yml pull  backend frontend admin-frontend proxy
docker compose -f docker-compose.prod.yml up -d --no-deps backend frontend admin-frontend proxy

# Verify BY DIGEST — a version string is not proof of freshness
for svc in backend frontend admin-frontend proxy; do
  want=$(docker image inspect --format '{{.Id}}' "$IMAGE_REPO-$svc:sha-<gitsha>")
  got=$(docker inspect --format '{{.Image}}' \
        "$(docker compose -f docker-compose.prod.yml ps -q "$svc")")
  [ "$want" = "$got" ] && echo "$svc OK" || echo "$svc MISMATCH"
done

curl -sS https://<public-host>/api/app/health
bash scripts/check_live_freshness.sh https://<public-host> "$(cat VERSION)"
```

Rolling back is the same three commands with the `IMAGE_TAG` from `.env.rollback`.

**One-time after the release that adds log bounds / memory ceilings (#310).** Both
bind at container CREATE, and the rollout only recreates `backend frontend
admin-frontend proxy` — so on an existing host `db`, `ollama` and `open-webui`
keep their old unbounded configuration forever, including `ollama`, which is the
hog the ceiling exists for. Run once, on the host:

```bash
cd /opt/beaconfolio
docker compose -f docker-compose.prod.yml up -d          # NO --no-deps
# Compose recreates only what changed; volumes untouched (up -d, never down -v).
# Verify, per service — mem=0 on db/ollama/open-webui means it has not run yet:
docker inspect -f '{{.Name}} {{.HostConfig.LogConfig.Config}} mem={{.HostConfig.Memory}}' \
  $(docker compose -f docker-compose.prod.yml ps -aq)
```

Interrupts THIS tenant only (no neighbour is in this compose project); Ollama
re-warms from the cached volume, so nothing re-downloads but the first AI request
is slow again. A fresh install never needs this.

**Never** `docker compose down` on a shared host when `up -d --no-deps <services>`
will do: `down` stops the whole project including `db` and `ollama`, and `down -v`
destroys volumes (blocked by rule 9 / `guard-destructive.sh`).

**Resolve containers through compose, never by a literal name.** #310 removed the
fixed `open-webui` / `global_proxy` names because they are host-global and collide
between projects:

```bash
# -aq, not -q, when DIAGNOSING: a container that has EXITED is the case you are
# looking at, and plain -q would resolve it to an empty id.
docker compose -f docker-compose.prod.yml ps -aq proxy      # -> container id
docker inspect -f '{{.State.Running}}' "$(docker compose -f docker-compose.prod.yml ps -aq proxy)"
```

## Failure → diagnosis, per step of `Roll Out To Prod Host`

Job at `.github/workflows/deploy.yml:928-1132`.

| Failing step | What it means | Check on the host / in the run |
|---|---|---|
| **Check rollout secrets** (`:938-950`) emits a skip notice | Not a failure — one of the three secrets is absent, so nothing rolled. The run is green and prod is unchanged. | Confirm the later steps are `skipped`; report "published, not rolled". Do **not** add secrets to "fix" this until the preconditions above pass. |
| **Set up SSH** (`:952-973`) — `ssh-keyscan` fails or times out | Host unreachable, wrong `DEPLOY_SSH_PORT`, or provider firewall. | `nc -vz <host> <port>` from elsewhere; provider console; is sshd running? |
| **Set up SSH** — host key mismatch | The host key changed (rebuild/reinstall) — or a MITM. | Re-verify the fingerprint from a trusted machine or the provider console **before** accepting anything. Never blind-accept. |
| **Preflight — images anonymously pullable** (`:975-1001`) | A GHCR package is **private**. New packages default to private and visibility does not follow a repo rename (lessons §20, #88/#189). | The error names the package: Packages → package → settings → visibility → Public. Then re-run. Nothing on the host was touched. |
| **Roll out** — `FATAL: .env is missing or unreadable` | Wrong `DEPLOY_DIR`, or `.env` is root-owned and the deploy user cannot read it. | `ls -l /opt/beaconfolio/.env` — must be mode 600 and owned by the deploy user. |
| **Roll out** — `FATAL: .env rewrite would drop N lines` | The guard refused to truncate a secret-bearing `.env`. **It protected you.** | Inspect `.env` by hand for corruption/CRLF; never disable the guard. |
| **Roll out** — `bind: address already in use` | Another tenant holds the port. | `sudo ss -ltnp \| grep -w <port>`; reassign beaconfolio via `PROXY_HTTP_PUBLISH` / `PROXY_HTTPS_PUBLISH` and update the wiki port registry. **Never take the port from its holder.** |
| **Roll out** — `Digest mismatch for <svc>` | The running container is not the image the tag resolves to — a stale container, or a pull that silently failed. | Re-run `pull` + `up -d --no-deps <svc>`; check disk (`df -h`) — a full disk fails pulls quietly. |
| **Health gate** — TLS error / `curl (60)` | The certificate is expired, self-signed, or does not cover this hostname. **This is the panel-free host's most likely failure.** | `openssl s_client -servername <h> -connect <h>:443` → check issuer, dates, SAN. Is the edge serving 443 at all? § Certificate renewal below. |
| **Health gate** — connection refused / times out | Nothing on 443, or the edge is down, or the edge points at the wrong tenant port. | `systemctl status caddy`; `sudo ss -ltnp \| grep -w 443`; confirm the edge forwards to the tenant's **443**, not its 80 (see the redirect-loop trap). |
| **Health gate** — redirect loop / `301` chain | The edge is forwarding to beaconfolio's **port 80**, which unconditionally redirects to HTTPS. Measured: `Host: <PUBLIC_SERVER_NAME>` → `:80` = `301 https://<that name>/`; → `:443` = `200`. | Point the edge at `PROXY_HTTPS_PUBLISH` with upstream verification disabled (the tenant's cert is the internal self-signed one). |
| **Health gate** — 200 but backend unhealthy | Backend up, dependency down. | `docker compose logs backend`; is `db`/`ollama` healthy? Alembic errors at startup? |
| **Freshness gate** fails after health passes | Live version ≠ released, or the route shape is wrong (`/admin/login` must 404 publicly). | `bash scripts/check_live_freshness.sh <url> <version>` locally against the host; the frontend may be a stale image while the backend rolled. |
| **Roll back on failure** — `No usable .env.rollback` | The run aborted before recording coordinates, or a previous run consumed it. | Roll back by hand (above) using the previous `sha-` tag from the run history. |

Deploys are serialized by a concurrency guard (#147) — a second merge queues.
Never trigger overlapping rollouts by hand.

## Certificate renewal runbook

Exactly **one** ACME client on the box, at the **edge**. Tenants never request
certificates — two clients renewing one name is a renewal race and a fast route to
a rate limit.

**The standing alarm is automated (#310):** the scheduled **Live Freshness**
workflow's "Certificate expiry" step probes every hostname in the
`TLS_HOSTNAMES` repo variable daily and goes **red under 21 days** remaining.
A red run there means Caddy's renewal has already been failing ~9 days — start
with the journal commands below. The hand-run checks are for ad-hoc diagnosis:

```bash
# Is it healthy, and did it renew?
systemctl status caddy
journalctl -u caddy | grep -i -e certificate -e acme -e renew

# What is actually being served (names + expiry) — from anywhere
echo | openssl s_client -servername <host> -connect <host>:443 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName

# Days remaining; alarm under 21
end=$(echo | openssl s_client -servername <host> -connect <host>:443 2>/dev/null \
      | openssl x509 -noout -enddate | cut -d= -f2)
echo "$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 )) days"

# Graceful, edge-only — reload before restart; restart affects EVERY tenant
sudo systemctl reload caddy
```

Certbot fallback: `sudo certbot renew --dry-run` must exit 0, and the deploy hook
in `/etc/letsencrypt/renewal-hooks/deploy/` must reload **only the edge** — a
renewed file on disk changes nothing until the serving process reloads.

Two facts that change how this is operated:

- **Let's Encrypt sends no expiry emails** (service ended 2025-06-04). If we do
  not probe, nobody warns us.
- **One certificate covers the public AND admin hostnames** — both nginx server
  blocks read the same files — so an expiry locks the owner out of admin at the
  same moment the public site breaks.

## Multi-tenant do-not-touch list

Never, on this host, without explicit authorization naming the resource:

- `docker volume rm` / `docker volume prune` — **host-wide**, not project-scoped.
- `docker compose down -v` / `--volumes` — destroys this project's data volumes.
- `docker system prune` / `docker image prune -a` — reaches every project.
- Any container, network, volume or compose project **you did not deploy**.
- The edge configuration and its certificates (`/etc/caddy`, `/var/lib/caddy`,
  `/etc/letsencrypt`) — coordinate first; the edge is everyone's.
- Another tenant's `.env`, or a `DROP`/recreate of any non-`test_*` database.

All of the above are blocked by `.claude/hooks/guard-destructive.sh:365-383` (rule
9). **A backup is not authorization.** Deliberate gap, and the one you actually
need: **`docker image prune` WITHOUT `-a` passes** — dangling images only. When
the disk is full, escalate `df -h` → `du -sh /var/lib/docker/containers` →
`docker image prune` → `docker image prune --filter 'until=720h'` →
`docker builder prune`. Never `system prune`.

Also remember `docker` group membership is **root-equivalent** (it can mount the
host filesystem into a container), so the group is the real access list for every
tenant's secrets.

## Triage: "a neighbour is down — is it us?"

```bash
docker ps --format '{{.Names}}\t{{.Status}}'   # is their container even up?
systemctl status caddy                          # shared edge healthy?
journalctl -u caddy -n 100 --no-pager           # 502/504 for their host?
df -h / && free -h                              # shared resource exhausted?
journalctl -k | grep -i -e oom -e 'killed process'
docker stats --no-stream                        # who is at their memory ceiling?
```

If beaconfolio is inside its ceilings, the disk is fine and the edge is healthy, the
fault is theirs. If the **edge** is unhealthy it is everyone's — `reload` before
`restart`, and validate the config first.

## Reporting rules

- Report what you **measured**, not what you expect. "The rollout succeeded"
  requires the digest check, a `200` from `/api/app/health` without `-k`, and the
  freshness verdict — paste them.
- Naming a neighbour: never publish another project's hostnames, ports or paths
  in a public issue/PR. Reference the wiki port registry by row, not by value.
- Rule 8: a release is confirmed only when the pipeline is green end-to-end **and**
  the live host verifiably serves it.
