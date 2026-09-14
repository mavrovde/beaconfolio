# Tenant port registry — the shared prod host (#310/#338)

**This file is the single source of truth** for loopback port allocations on the
shared multi-project host. The wiki's table links here instead of duplicating.
The one property this registry must hold is *no overlap across tenants*: every
tenant binds only `127.0.0.1:<port>` inside its allocated block, and the edge
(`infra/edge/Caddyfile`) is the only listener on host-global 80/443.

| Range         | Tenant        | In use today                                                                 |
|---------------|---------------|------------------------------------------------------------------------------|
| 18000–18099   | beaconfolio   | 18080 (proxy HTTP, redirect-only), 18443* (proxy HTTPS, the edge upstream)   |
| 18100–18999   | *unallocated* | — claim the next free 100-block per tenant via PR against this file          |

\* 18443 sits outside the nominal 100-block for historical reasons (the #310
cutover bound HTTPS before the block convention settled). It is beaconfolio's
and is listed here so no future tenant claims it; new tenants keep all bindings
inside their block.

## Claiming a range (second-tenant onboarding)

1. Add a row above: next free 100-block, tenant name, intended ports.
2. Add the tenant's server block to `infra/edge/Caddyfile` (template at the
   bottom of that file).
3. The tenant's compose publishes ONLY `127.0.0.1:<its ports>` (see
   `.env.example` → `PROXY_HTTP_PUBLISH` / `PROXY_HTTPS_PUBLISH` for how
   beaconfolio does it).
4. PR + review (rule 13), then `bash infra/edge/apply.sh` over SSH — validate
   happens before reload; an invalid config never replaces the running one.
