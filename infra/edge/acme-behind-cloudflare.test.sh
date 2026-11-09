#!/usr/bin/env bash
# Does the edge still RENEW viafrei.de / www.viafrei.de once they are behind
# Cloudflare (viafrei #1267, review S6)? Docker-only, run by hand; apply.test.sh
# stays hermetic and does not call it.
#
# What it proves. Behind Cloudflare, TLS-ALPN-01 cannot reach us (Cloudflare
# terminates TLS), and Always Use HTTPS (ON in the zone) answers the CA's
# http://…/.well-known/acme-challenge/<t> with a 301 to https, so the HTTP-01
# request reaches the edge on 443 — inside the blocks that gate on @cf_visitor.
# Caddy answers a challenge in Server.ServeHTTP BEFORE any route
# (modules/caddyhttp/server.go, "guarantee ACME HTTP challenges; handle them
# separately from any user-defined handlers", v2.11.9). This test shows it end
# to end with the WORST peer — one outside the Cloudflare ranges, which only
# the direct-visitor fallbacks answer (never a 403 since the 2026-11-09
# hotfix): the apex proxies it to an echo upstream on :18180, www redirects it.
#   - Pebble (a test ACME CA) validates http://<name>/… on port 80;
#   - port 80 at the edge's address is an nginx that only redirects to https,
#     standing in for Always Use HTTPS (the edge's own HTTP port is moved away);
#   - the edge holds a near-expiry certificate for each name (a renewal, as on
#     the host: a first issuance through 443 is impossible without a cert);
#   - TLS-ALPN-01 is disabled, so 443 is the only path left.
# PASS = both names renewed by Pebble AND a plain request from the same peer is
# answered by the fallback: www 301, and the apex 200 from the echo upstream
# with X-Forwarded-For equal to the peer's OWN address although the peer sent a
# made-up CF-Connecting-IP and X-Forwarded-For — on a direct connection the
# caller cannot choose the address the tenant sees. The site blocks are cut
# out of the committed Caddyfile verbatim.
#
# Exit: 0 pass, 1 fail, 2 cannot run (no docker, no image). Cleans up on exit.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
CADDYFILE="$HERE/Caddyfile"
CADDY_IMG=${CADDY_IMG:-caddy:2.11-alpine}
PEBBLE_IMG=ghcr.io/letsencrypt/pebble:latest
DNS_IMG=ghcr.io/letsencrypt/pebble-challtestsrv:latest
NGINX_IMG=nginx:1.27-alpine
SSL_IMG=alpine:3.22
NET=vf-acme-cf-$$
SUB=172.31.$((100 + $$ % 100))
W=$(mktemp -d)

pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "  ✓ $1"; }
bad() { fail=$((fail + 1)); echo "  ✗ $1"; }
refuse() { echo "✗ $1" >&2; exit 2; }

cleanup() {
	docker rm -f "$NET-caddy" "$NET-echo" "$NET-nginx" "$NET-pebble" "$NET-dns" >/dev/null 2>&1
	docker network rm "$NET" >/dev/null 2>&1
	rm -rf "$W"
}
trap cleanup EXIT

command -v docker >/dev/null || refuse "docker is not on PATH"
docker info >/dev/null 2>&1 || refuse "the docker daemon does not answer"
for img in "$CADDY_IMG" "$PEBBLE_IMG" "$DNS_IMG" "$NGINX_IMG" "$SSL_IMG"; do
	docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null 2>&1 ||
		refuse "image $img is not available"
done

# The two site blocks, verbatim from the committed Caddyfile.
awk '/^(viafrei\.de|www\.viafrei\.de) \{/{f=1} f{print} f&&/^\}/{f=0}' "$CADDYFILE" >"$W/sites"
[ "$(grep -c '^\(www\.\)\{0,1\}viafrei\.de {' "$W/sites")" = 2 ] ||
	refuse "could not cut the viafrei.de and www.viafrei.de blocks out of $CADDYFILE"
[ "$(grep -c '^	handle @cf_visitor {$' "$W/sites")" = 2 ] || refuse "the cut blocks do not each gate on @cf_visitor"

mkdir -p "$W/etc" "$W/data" "$W/pebble" "$W/nginx"
{
	cat <<'EOF'
{
	http_port 8080
	cert_issuer acme {
		dir https://pebble:14000/dir
		trusted_roots /pebble/pebble.minica.pem
		disable_tlsalpn_challenge
	}
	log {
		level DEBUG
	}
}
EOF
	cat "$W/sites"
} >"$W/etc/Caddyfile"
# A range the test peer is NOT in: only the fallbacks answer it.
echo 'remote_ip 198.51.100.0/24 2001:db8::/32' >"$W/etc/viafrei-cloudflare.conf"

cid=$(docker create "$PEBBLE_IMG") || refuse "cannot create a pebble container"
docker cp "$cid:/test/certs/pebble.minica.pem" "$W/pebble/" >/dev/null &&
	docker cp "$cid:/test/certs/localhost" "$W/pebble/" >/dev/null
docker rm "$cid" >/dev/null
[ -s "$W/pebble/pebble.minica.pem" ] || refuse "could not read pebble's test root"
cat >"$W/pebble/config.json" <<'EOF'
{"pebble":{"listenAddress":"0.0.0.0:14000","managementListenAddress":"0.0.0.0:15000",
"certificate":"/cfg/localhost/cert.pem","privateKey":"/cfg/localhost/key.pem",
"httpPort":80,"tlsPort":5001,"ocspResponderURL":"","externalAccountBindingRequired":false,
"retryAfter":{"authz":1,"order":1},"keyAlgorithm":"ecdsa",
"profiles":{"default":{"description":"test","validityPeriod":7776000}}}}
EOF
printf 'server { listen 80; location / { return 301 https://$host$request_uri; } }\n' >"$W/nginx/default.conf"
# The tenant stand-in on :18180: echoes the ADDRESS headers it was handed, one
# per line, so a made-up value that reached the tenant would be visible.
mkdir -p "$W/echo"
cat >"$W/echo/Caddyfile" <<'EOF'
{
	admin off
	auto_https off
}
http://:18180 {
	respond "xff=[{http.request.header.X-Forwarded-For}]
xri=[{http.request.header.X-Real-IP}]
fwd=[{http.request.header.Forwarded}]
tci=[{http.request.header.True-Client-IP}]
" 200
}
EOF

# Near-expiry certificates where Caddy keeps the ones this issuer manages:
# 60 days old, 1 day left — inside the renewal window, so Caddy renews at start.
nb=$(date -u -v-60d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d '60 days ago' +%Y%m%d%H%M%SZ)
na=$(date -u -v+1d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d 'tomorrow' +%Y%m%d%H%M%SZ)
docker run --rm -v "$W/data:/data" "$SSL_IMG" sh -c "
	apk add -q openssl >/dev/null 2>&1 || exit 3
	for n in viafrei.de www.viafrei.de; do
		d=/data/caddy/certificates/pebble-14000-dir/\$n; mkdir -p \$d
		openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
			-subj /CN=\$n -addext subjectAltName=DNS:\$n \
			-not_before $nb -not_after $na \
			-keyout \$d/\$n.key -out \$d/\$n.crt 2>/dev/null || exit 4
		printf '{\"sans\":[\"%s\"],\"issuer_data\":{}}' \$n >\$d/\$n.json
	done
	chown -R 1000:1000 /data 2>/dev/null; chmod -R a+rwX /data" ||
	refuse "could not write the near-expiry certificates"

docker network create --subnet "$SUB.0/24" "$NET" >/dev/null || refuse "cannot create network $NET"
docker run -d --name "$NET-dns" --network "$NET" --ip "$SUB.2" "$DNS_IMG" \
	-defaultIPv4 "$SUB.10" -defaultIPv6 "" -dnsserver :8053 -http01 "" -https01 "" -tlsalpn01 "" -doh "" \
	>/dev/null || refuse "cannot start the DNS stub"
docker run -d --name "$NET-pebble" --network "$NET" --ip "$SUB.3" --network-alias pebble \
	-e PEBBLE_VA_NOSLEEP=1 -e PEBBLE_WFE_NONCEREJECT=0 -v "$W/pebble:/cfg:ro" \
	"$PEBBLE_IMG" -config /cfg/config.json -dnsserver "$SUB.2:8053" >/dev/null ||
	refuse "cannot start pebble"
# The redirector owns the edge's address and port 80; the edge joins its
# network namespace, so 443 at that address is Caddy and 80 is only a 301.
docker run -d --name "$NET-nginx" --network "$NET" --ip "$SUB.10" \
	-v "$W/nginx:/etc/nginx/conf.d:ro" "$NGINX_IMG" >/dev/null || refuse "cannot start the redirector"
docker run -d --name "$NET-echo" --network "container:$NET-nginx" \
	-v "$W/echo:/etc/caddy:ro" "$CADDY_IMG" >/dev/null || refuse "cannot start the echo upstream"
docker run -d --name "$NET-caddy" --network "container:$NET-nginx" \
	-v "$W/etc:/etc/caddy:ro" -v "$W/pebble:/pebble:ro" -v "$W/data:/data" \
	"$CADDY_IMG" >/dev/null || refuse "cannot start caddy"

echo "== renewal through 443 behind an http→https redirect, peer outside the ranges =="
# Wait for both renewals on the edge's log, at most 120 s (an event wait, no poll).
NAME="$NET-caddy" OUT="$W/caddy.log" perl -e '
	$pid = open(my $f, "-|", "docker logs -f $ENV{NAME} 2>&1") or exit 2;
	$SIG{ALRM} = sub { kill "TERM", $pid; exit 1 }; alarm 120;
	open(my $o, ">", $ENV{OUT}) or exit 2; select $o; $| = 1;
	while (<$f>) { print $o $_;
		$a = 1 if /renewed successfully.*"identifier":"viafrei\.de"/;
		$b = 1 if /renewed successfully.*"identifier":"www\.viafrei\.de"/;
		if ($a && $b) { kill "TERM", $pid; exit 0 } }'

for n in viafrei.de www.viafrei.de; do
	if grep -q "certificate renewed successfully.*\"identifier\":\"$n\"" "$W/caddy.log"; then
		ok "$n renewed by the CA through the 443 server"
	else
		bad "$n was not renewed (see the caddy log below)"
	fi
	issuer=$(docker run --rm --network "$NET" "$SSL_IMG" sh -c \
		"apk add -q openssl >/dev/null 2>&1; echo | openssl s_client -connect $SUB.10:443 -servername $n 2>/dev/null | openssl x509 -noout -issuer" 2>/dev/null)
	case "$issuer" in
		*[Pp]ebble*) ok "$n now presents the CA's certificate ($issuer)" ;;
		*) bad "$n still presents another certificate (${issuer:-no answer})" ;;
	esac
	# One container is the peer: it prints its own address, then the answer
	# to a request carrying a made-up CF-Connecting-IP and X-Forwarded-For
	# (2 s per request, the test timeout rule). Documentation addresses only.
	ans=$(docker run --rm --network "$NET" "$SSL_IMG" sh -c \
		"apk add -q curl >/dev/null 2>&1; echo \"me=\$(hostname -i)\"; curl -sk --max-time 2 -w 'code=%{http_code}\n' \
		-H 'CF-Connecting-IP: 203.0.113.77' -H 'X-Forwarded-For: 192.0.2.99' \
		--resolve $n:443:$SUB.10 https://$n/" 2>/dev/null)
	me=$(printf '%s\n' "$ans" | sed -n 's/^me=\([0-9.]*\).*/\1/p')
	code=$(printf '%s\n' "$ans" | sed -n 's/^code=//p')
	if [ "$n" = www.viafrei.de ]; then
		[ "$code" = 301 ] && ok "$n answers that peer by its fallback: a 301 to the apex" ||
			bad "$n answered that peer ${code:-nothing}, not 301 (its fallback)"
		continue
	fi
	[ "$code" = 200 ] && ok "$n serves that peer through its fallback (200 from the upstream)" ||
		bad "$n answered that peer ${code:-nothing}, not 200 from the upstream"
	[ -n "$me" ] && printf '%s\n' "$ans" | grep -qx "xff=\[$me\]" &&
		ok "$n hands the upstream X-Forwarded-For = the peer's own address, nothing else" ||
		bad "$n did not hand the upstream exactly the peer's address as X-Forwarded-For (peer=${me:-unknown}; $(printf '%s' "$ans" | grep '^xff=' || echo 'no xff line'))"
	printf '%s\n' "$ans" | grep -q '^xri=\[\]$' && printf '%s\n' "$ans" | grep -q '^fwd=\[\]$' &&
		printf '%s\n' "$ans" | grep -q '^tci=\[\]$' &&
		! printf '%s\n' "$ans" | grep -qE '^(xff|xri|fwd|tci)=.*(203\.0\.113\.77|192\.0\.2\.99)' &&
		ok "$n: neither made-up value reaches any address header of the upstream" ||
		bad "$n: a made-up address reached the upstream ($(printf '%s' "$ans" | grep -E '^(xff|xri|fwd|tci)=' | tr '\n' ' '))"
done
grep -q '"challenge_type":"http-01"' "$W/caddy.log" && ok "the challenge type was http-01" || bad "no http-01 challenge in the log"
for n in viafrei.de www.viafrei.de; do
	# Caddy listens on 443 only (its HTTP port is moved to 8080, which nothing
	# asks): a key authorisation served to the CA's address was served on 443.
	grep -q "\"served key authentication\",\"identifier\":\"$n\",\"challenge\":\"http-01\",\"remote\":\"$SUB.3:" "$W/caddy.log" &&
		ok "$n: the edge served the key authorisation to the CA's address on 443, ahead of every route" ||
		bad "$n: no key authorisation served to the CA's address"
done
grep -q '"trying to solve challenge".*"challenge_type":"tls-alpn-01"' "$W/caddy.log" && bad "a tls-alpn-01 challenge was tried" || ok "no tls-alpn-01 challenge was tried"
hits=$(docker logs "$NET-nginx" 2>/dev/null | grep -c 'acme-challenge.* 301 ')
[ "${hits:-0}" -ge 2 ] && ok "the CA's port-80 requests were redirected to https ($hits)" ||
	bad "the redirector saw ${hits:-0} challenge request(s), expected at least 2"

[ "$fail" -eq 0 ] || { echo "--- caddy log (tail) ---"; tail -40 "$W/caddy.log"; }
echo "== acme behind cloudflare: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
