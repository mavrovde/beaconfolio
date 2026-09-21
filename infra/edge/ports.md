# Tenant port registry — the shared prod host (#310/#338)

**This file is the single source of truth** for loopback port allocations on the
shared multi-project host. The wiki's table links here instead of duplicating.
The one property this registry must hold is *no overlap across tenants*: every
tenant binds only `127.0.0.1:<port>` inside its allocated block, and the edge
(`infra/edge/Caddyfile`) is the only listener on host-global 80/443.

| Range         | Tenant        | In use today                                                                 |
|---------------|---------------|------------------------------------------------------------------------------|
| 18000–18099   | beaconfolio   | 18080 (proxy HTTP, redirect-only), 18443* (proxy HTTPS, the edge upstream)   |
| 18100–18199   | viafrei       | 18180 (landing HTTP, PUBLIC), 18181 (retired preview root, nothing routes to it)****, 18187 (MCP Streamable HTTP, PUBLIC), 18190 (status dashboard)***, 18132 (Postgres, tooling) |
| 18200–18999   | *unallocated* | — claim the next free 100-block per tenant via PR against this file          |
| 5433**        | beaconfolio   | Postgres (`127.0.0.1:5433`, compose `db` publish — local pytest + tooling)   |

\* 18443 sits outside the nominal 100-block for historical reasons (the #310
cutover bound HTTPS before the block convention settled). It is beaconfolio's
and is listed here so no future tenant claims it; new tenants keep all bindings
inside their block.

\*** 18190 is the viafrei status dashboard (viafrei repo issue #94). It is the
one route on this host whose site block carries an IP restriction: the
`status.viafrei.de` block matches `remote_ip` against an address list imported
from `/etc/caddy/viafrei-status-allow.conf` (root:caddy, 0640 — the addresses
are personal data and this is a shared host) — a file outside every repository —
and answers a bare `403` to everything else. Its DNS record must be a plain
A/AAAA: `remote_ip` matches the direct peer, so a proxied record would make the
matcher see the proxy and the restriction mean nothing. `viafrei.de` and `mcp.viafrei.de` are unaffected and stay public. Like
every tenant port it is bound `127.0.0.1` only; the container behind it enforces
the same list a second time (empty = deny all).

\** 5433 predates the block convention entirely (it is what `TEST_DATABASE_URL`
and every doc in the repo point at). Registered so no tenant binds it; like all
tenant ports it is loopback-only and never reachable through the edge.

## Claiming a range (second-tenant onboarding)

1. Add a row above: next free 100-block, tenant name, intended ports.
2. Add the tenant's server block to `infra/edge/Caddyfile` (template at the
   bottom of that file).
3. The tenant's compose publishes ONLY `127.0.0.1:<its ports>` (see
   `.env.example` → `PROXY_HTTP_PUBLISH` / `PROXY_HTTPS_PUBLISH` for how
   beaconfolio does it).
4. PR + review (rule 13), then on the host: `bash infra/edge/apply.sh` (read-only
   check) and `bash infra/edge/apply.sh --apply` — validate happens before
   reload; an invalid config never replaces the running one, and a diff that
   removes running-only lines refuses without `EDGE_APPLY_CONFIRM=1`.

\**** 18181 WAS the owner preview of the landing page, served by the same
nginx container from a second document root (viafrei repo issue #94). **The
edge no longer routes to it** (owner 2026-09-20): viafrei.de serves the live
national digest on 18180 to everybody, owner included.

The preview was worth retiring rather than repointing, and the reason is worth
keeping. The fork was written when 18180 was an "im Aufbau" notice and 18181
held the real page. viafrei repo issue #176 then put the live digest on 18180
and the fork inverted in place, without anyone editing it: measured from two
addresses on 2026-09-20, off-host got 23 840 bytes of "live in Deutschland"
and the owner's address got 2 160 bytes of "Vorschau". A fork named after what
its two sides used to be will not tell you when one of them changes.

The port is still published by the tenant's compose and still serves the old
notice to nobody. Retiring it is a viafrei-repo change and belongs with the
v0.1.0 landing work.
