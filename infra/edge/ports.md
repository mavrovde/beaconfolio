# Tenant port registry — the shared prod host (#310/#338)

**This file is the single source of truth** for loopback port allocations on the
shared multi-project host. The wiki's table links here instead of duplicating.
The one property this registry must hold is *no overlap across tenants*: every
tenant binds only `127.0.0.1:<port>` inside its allocated block, and the edge
(`infra/edge/Caddyfile`) is the only listener on host-global 80/443.

| Range         | Tenant        | In use today                                                                 |
|---------------|---------------|------------------------------------------------------------------------------|
| 18000–18099   | beaconfolio   | 18080 (proxy HTTP, redirect-only), 18443* (proxy HTTPS, the edge upstream)   |
| 18100–18199   | viafrei       | 18180 (landing HTTP, PUBLIC through Cloudflare)*****, 18181 (retired preview root, nothing routes to it)****, 18187 (MCP Streamable HTTP, PUBLIC), 18190 (status page + operations console, both IP-gated)***, 18132 (Postgres, tooling) |
| 18200–18999   | *unallocated* | — claim the next free 100-block per tenant via PR against this file          |
| 5433**        | beaconfolio   | Postgres (`127.0.0.1:5433`, compose `db` publish — local pytest + tooling)   |
| 25, 465, 587, 993 | beaconfolio | Mail (`mailserver` compose service, profile `mailserver`): 25 inbound MX, 465/587 submission, 993 IMAP. PUBLIC on all addresses (not via the edge); ufw opens them. The host's ONE SMTP listener: a second mail domain (e.g. viafrei.de, whose MX also resolves here) joins this server rather than binding 25 again |

\* 18443 sits outside the nominal 100-block for historical reasons (the #310
cutover bound HTTPS before the block convention settled). It is beaconfolio's
and is listed here so no future tenant claims it; new tenants keep all bindings
inside their block.

\*** 18190 is the viafrei status container (viafrei repo issues #94, #560, #589),
served under two names since viafrei 2.0: `status.viafrei.de` is the status
page and `admin.viafrei.de` is the operations console; the container routes by
Host, so the two names still reach different routers (a console path on the
status name answers 404). They are the two routes on this host whose site
blocks carry the owner's address allow-list, and both have exactly the same shape: the block
matches `remote_ip` against an address list imported from
`/etc/caddy/viafrei-status-allow.conf` (root:caddy, 0640 — the addresses are
personal data and this is a shared host) — a file outside every repository —
and answers a bare `403` to everything else. `status.viafrei.de` was public from
viafrei 2.0 until 2026-10-13, when its owner closed it again ("Close the status
panel by the ip white list again, it should be available only to our laptop").
Both DNS records must be a plain A/AAAA: `remote_ip` matches the direct peer, so
a proxied record would make the matcher see the proxy and the restriction mean
nothing. `viafrei.de` and `mcp.viafrei.de` are unaffected and stay public
(`viafrei.de` through Cloudflare, see *****). Like
every tenant port it is bound `127.0.0.1` only. For `admin.viafrei.de` the
container behind it enforces the same list a second time (empty = deny all);
`status.viafrei.de` reaches the app's public router, which reads no allow-list,
so for that name this edge block is the only gate. `apply.test.sh` holds every
route to 18190 inside the `handle @allowed` of one of those two blocks — at
least one in each, none anywhere else — and asserts each block's door
(import + `handle @allowed` + `handle { respond 4xx }`) separately; a public
route to 18190 anywhere fails the gate.

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

\***** 18180 is reached ONLY through Cloudflare since viafrei repo issue #1267
(owner 2026-11-09, protection from crawlers that ignore robots.txt).
`viafrei.de` and `www.viafrei.de` are the only Cloudflare-PROXIED records on
this host; every other name (`mcp.`, `status.`, `admin.`, `mail.` and every
beaconfolio site) stays a plain A/AAAA record. Both blocks define
`@cf_visitor` as: the connection comes from a Cloudflare range (imported from
`/etc/caddy/viafrei-cloudflare.conf`, root:caddy 0640, one `remote_ip …` line,
never committed) AND the request carries a `CF-Connecting-IP` that looks like
an address. They serve inside `handle @cf_visitor` and answer `403` to every
other request, because the host address is public through the DNS-only names.
The apex overwrites `X-Forwarded-For` with `CF-Connecting-IP` inside the gate
only, so the tenant's rate limit and place lookup see the visitor rather than
a Cloudflare PoP, and a Cloudflare connection without the header gets the 403
rather than an empty `X-Forwarded-For`.

What the gate does NOT prove: a Cloudflare address means "came through
Cloudflare", not "came through our zone". Any Cloudflare customer can point a
proxied record at this address and pass. The stronger follow-up is
Authenticated Origin Pulls (Caddy `tls { client_auth … }` requiring Cloudflare's
origin-pull certificate; a per-zone/per-hostname certificate, because the
shared Cloudflare CA again proves only "Cloudflare").

The file is written by `infra/edge/cloudflare-ranges.sh`:

- `sudo bash infra/edge/cloudflare-ranges.sh --write` fetches
  `https://www.cloudflare.com/ips-v4` and `/ips-v6`, refuses any line that is
  not a CIDR, any prefix shorter than /8 (IPv4) or /12 (IPv6), and a list
  shorter than 10 IPv4 or 5 IPv6 ranges (exit 2, nothing written), then
  installs it atomically and keeps the previous file as `.bak`;
- `sudo bash infra/edge/cloudflare-ranges.sh --check` is read-only and exits 1
  when the installed file is missing or differs from Cloudflare's lists.
- `infra/edge/systemd/viafrei-cloudflare-ranges-check.{service,timer}` run
  `--check` daily as the caddy user; drift or a refusal fails the unit
  (journal, `systemctl --failed`). Install steps are in the service file. The
  3-hourly prod round reads it: `systemctl is-failed
  viafrei-cloudflare-ranges-check.service` answering `failed` is a finding.

`apply.sh --apply` refuses by name while the file is missing, empty or without
a `remote_ip` line, and when a token on it is `/0`, an IPv4 prefix wider than
/8, an IPv6 prefix wider than /12 or not an address at all.

Certificates: the edge keeps renewing viafrei.de and www.viafrei.de itself.
TLS-ALPN-01 cannot reach it behind Cloudflare (logged and retried as HTTP-01);
HTTP-01 is redirected by Always Use HTTPS (ON) and arrives on 443, where Caddy
answers the challenge before any route, so neither the proxy nor the 403 sees
it — proved by `infra/edge/acme-behind-cloudflare.test.sh` (docker). It needs
the current certificate valid, so after the switch and at every prod round the
ORIGIN certificate's notAfter (`openssl s_client -connect 127.0.0.1:443
-servername viafrei.de` | `openssl x509 -noout -enddate`, and www) must be
more than 20 days out. Fallback: DNS-only for the renewal, or a Cloudflare
Origin CA certificate as `tls <cert> <key>` in both blocks. A refreshed list takes effect after `caddy validate` +
`systemctl reload caddy` (apply.sh does not reload an edge whose Caddyfile is
already in sync).

Order on the day, switching ON:

0. the zone is on Cloudflare's nameservers (done 2026-11-09) and its SSL/TLS
   mode is **Full (strict)** (set 2026-11-09); Flexible would reach this edge
   over http, which redirects to https — a loop. Nothing may rewrite the origin
   request to http;
1. switch the two records to proxied;
2. wait out the old records' TTL (auto, about 300 s), or lower it a day ahead;
3. write the ranges file, then apply.

The other way round, every visitor connects directly and gets the 403.
ROLLBACK is the reverse: apply the previous Caddyfile FIRST, then switch the
records back to DNS-only.
