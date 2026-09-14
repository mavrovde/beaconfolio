#!/bin/sh
# Unit test for generate-admin-config.sh — asserts the real_ip + admin allowlist
# generator is CLOSED by default, opens on valid CIDRs, rejects malformed input,
# and never emits a blanket allow as the default. Deterministic; no Docker/topology
# needed. Run: sh proxy/test-generate-admin-config.sh
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
GEN="$DIR/generate-admin-config.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail=0
check() { # desc, condition-result(0/1)
    if [ "$2" -eq 0 ]; then
        echo "  ok: $1"
    else
        echo "  FAIL: $1"
        fail=1
    fi
}
has()   { grep -Fq "$2" "$1" && echo 0 || echo 1; }   # file contains literal
hasnt() { grep -Fq "$2" "$1" && echo 1 || echo 0; }   # file lacks literal

run() { # runs generator with given env into $WORK (stderr -> $WORK/warn.log)
    ( cd "$WORK" && env "$@" TRUSTED_PROXY_CIDRS="${TRUSTED_PROXY_CIDRS:-172.16.0.0/12}" \
        "$GEN" "$WORK" 2> "$WORK/warn.log" )
}

ALLOW="$WORK/admin_allowlist.conf"
REALIP="$WORK/real_ip.conf"

echo "1) default (empty ADMIN_ALLOWED_CIDRS) -> CLOSED, no 'allow'"
env -u ADMIN_ALLOWED_CIDRS -u TRUSTED_PROXY_CIDRS "$GEN" "$WORK" 2>"$WORK/warn.log"
check "allowlist ends with deny all"                 "$(has "$ALLOW" 'deny all;')"
check "allowlist has NO allow line (closed default)" "$(hasnt "$ALLOW" 'allow ')"
check "real_ip trusts docker bridge default"         "$(has "$REALIP" 'set_real_ip_from 172.16.0.0/12;')"
check "real_ip reads X-Forwarded-For by default"     "$(has "$REALIP" 'real_ip_header X-Forwarded-For;')"
check "real_ip_recursive on"                         "$(has "$REALIP" 'real_ip_recursive on;')"

echo "2) valid ADMIN_ALLOWED_CIDRS -> allow lines + deny all"
ADMIN_ALLOWED_CIDRS="203.0.113.7 198.51.100.0/24" run
check "allow 203.0.113.7"        "$(has "$ALLOW" 'allow 203.0.113.7;')"
check "allow 198.51.100.0/24"    "$(has "$ALLOW" 'allow 198.51.100.0/24;')"
check "still ends with deny all" "$(has "$ALLOW" 'deny all;')"

echo "3) comma-separated list is accepted"
ADMIN_ALLOWED_CIDRS="10.0.0.1,10.0.0.2" run
check "allow 10.0.0.1"  "$(has "$ALLOW" 'allow 10.0.0.1;')"
check "allow 10.0.0.2"  "$(has "$ALLOW" 'allow 10.0.0.2;')"

echo "4) malformed entry is rejected (no injection), valid one kept"
ADMIN_ALLOWED_CIDRS="1.2.3.4 evil;deny all;allow all 5.6.7.8" run
check "valid 1.2.3.4 kept"                 "$(has "$ALLOW" 'allow 1.2.3.4;')"
check "valid 5.6.7.8 kept"                 "$(has "$ALLOW" 'allow 5.6.7.8;')"
check "injected 'allow all' NOT present"   "$(hasnt "$ALLOW" 'allow all')"
check "warned about invalid entry"         "$(has "$WORK/warn.log" 'ignoring invalid ADMIN_ALLOWED_CIDRS')"

echo "5) custom REAL_IP_HEADER + TRUSTED_PROXY_CIDRS honored"
REAL_IP_HEADER="X-Real-IP" TRUSTED_PROXY_CIDRS="192.168.0.0/16" ADMIN_ALLOWED_CIDRS="" run
check "trusts 192.168.0.0/16"       "$(has "$REALIP" 'set_real_ip_from 192.168.0.0/16;')"
check "reads X-Real-IP"             "$(has "$REALIP" 'real_ip_header X-Real-IP;')"

echo "6) 0.0.0.0/0 is emitted but loudly warned (test-only escape hatch)"
ADMIN_ALLOWED_CIDRS="0.0.0.0/0" run
check "allow 0.0.0.0/0 emitted"     "$(has "$ALLOW" 'allow 0.0.0.0/0;')"
check "warned about world-open"     "$(has "$WORK/warn.log" 'THE WORLD')"

echo "7) documentation-range entries (RFC 5737/3849) are emitted but loudly warned (#336)"
# lowercase 2001:db8 is the form every doc in this repo prints; uppercase and
# the zero-padded 2001:0db8 pin the case-insensitive + padded variants.
ADMIN_ALLOWED_CIDRS="192.0.2.9 198.51.100.0/24 203.0.113.7 2001:db8::/32 2001:DB8::/32 2001:0db8::/32" run
check "allow 192.0.2.9 still emitted"       "$(has "$ALLOW" 'allow 192.0.2.9;')"
check "allow 203.0.113.7 still emitted"     "$(has "$ALLOW" 'allow 203.0.113.7;')"
check "allow 2001:db8::/32 still emitted"   "$(has "$ALLOW" 'allow 2001:db8::/32;')"
check "warned DOCUMENTATION address"        "$(has "$WORK/warn.log" 'DOCUMENTATION')"
check "all 6 doc entries warned individually" "$([ "$(grep -c 'DOCUMENTATION' "$WORK/warn.log")" -eq 6 ] && echo 0 || echo 1)"

echo "8) real allowlist entries do NOT trigger the documentation warning"
# 192.0.20.1 pins the dot boundary: it must NOT match the 192.0.2.* pattern.
ADMIN_ALLOWED_CIDRS="51.15.23.7 192.0.20.1 2a01:4f8::/32" run
check "allow 51.15.23.7 emitted"            "$(has "$ALLOW" 'allow 51.15.23.7;')"
check "allow 192.0.20.1 emitted"            "$(has "$ALLOW" 'allow 192.0.20.1;')"
check "no DOCUMENTATION warning"            "$(hasnt "$WORK/warn.log" 'DOCUMENTATION')"

echo ""
if [ "$fail" -eq 0 ]; then
    echo "ALL ADMIN-CONFIG GENERATOR TESTS PASSED"
else
    echo "ADMIN-CONFIG GENERATOR TESTS FAILED"
    exit 1
fi
