# Tenant port registry — the shared prod host (#310/#338)

**This file is the single source of truth** for loopback port allocations on the
shared multi-project host. The wiki's table links here instead of duplicating.
The one property this registry must hold is *no overlap across tenants*: every
tenant binds only `127.0.0.1:<port>` inside its allocated block, and the edge
(`infra/edge/Caddyfile`) is the only listener on host-global 80/443.

| Range         | Tenant        | In use today                                                                 |
|---------------|---------------|------------------------------------------------------------------------------|
| 18000–18099   | beaconfolio   | 18080 (proxy HTTP, redirect-only), 18443* (proxy HTTPS, the edge upstream)   |
| 18100–18199   | viafrei       | 18180 (landing HTTP), 18181 (landing owner preview)****, 18187 (MCP Streamable HTTP), 18190 (status dashboard)***, 18132 (Postgres, tooling) |
| 18200–18999   | *unallocated* | — claim the next free 100-block per tenant via PR against this file          |
| 5433**        | beaconfolio   | Postgres (`127.0.0.1:5433`, compose `db` publish — local pytest + tooling)   |

\* 18443 sits outside the nominal 100-block for historical reasons (the #310
cutover bound HTTPS before the block convention settled). It is beaconfolio's
and is listed here so no future tenant claims it; new tenants keep all bindings
inside their block.

\*** 18190 is the viafrei status dashboard (viafrei repo issue #94). It is the
one route on this host whose site block carries an IP restriction: the
`status.viafrei.com` block matches `remote_ip` against an address list imported
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

\**** 18181 is the owner preview of the same landing page, served by the same
nginx container from a SECOND document root (viafrei repo issue #94). It is
loopback-only like every other port in this block; the edge sends the owner's
address to it and everybody else to 18180, so the port existing is not the
page being public. The two roots are never the same directory and the preview
root is never inside the public one — a preview root under the public root
would be an ordinary public URL.
