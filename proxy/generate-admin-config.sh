#!/bin/sh
# Generate the nginx real-client-IP trust config + the admin allowlist from env.
#
# WHY: in the containerized prod topology the admin subdomain is fronted by an
# edge reverse proxy and Docker NAT, so nginx sees the Docker bridge gateway
# as $remote_addr for EVERY client. Trusting the upstream CIDR and reading the
# forwarded-for header restores the real client IP, which the admin allow/deny
# rules (and access logs) then filter on.
#
# Usage:  generate-admin-config.sh [OUTPUT_DIR]      (default: /etc/nginx)
#         -> writes  <OUTPUT_DIR>/real_ip.conf  and  <OUTPUT_DIR>/admin_allowlist.conf
#
# Env (all optional; safe, CLOSED defaults):
#   TRUSTED_PROXY_CIDRS  space/comma list of upstream CIDRs to trust for the
#                        forwarded header. Default: 172.16.0.0/12 (Docker bridge
#                        range). Tighten to your exact front-proxy CIDR in prod.
#   REAL_IP_HEADER       header carrying the real client IP. Default:
#                        X-Forwarded-For. (Some front proxies use X-Real-IP.)
#   ADMIN_ALLOWED_CIDRS  space/comma list of operator IPs/CIDRs allowed to reach
#                        the admin console. Default: EMPTY -> closed (loopback
#                        only; the server block always allows 127.0.0.1 / ::1).
#                        NEVER emits a blanket "allow all" as the default.
set -eu

OUT_DIR="${1:-/etc/nginx}"
REAL_IP_CONF="${OUT_DIR}/real_ip.conf"
ALLOWLIST_CONF="${OUT_DIR}/admin_allowlist.conf"

TRUSTED_PROXY_CIDRS="${TRUSTED_PROXY_CIDRS:-172.16.0.0/12}"
REAL_IP_HEADER="${REAL_IP_HEADER:-X-Forwarded-For}"
ADMIN_ALLOWED_CIDRS="${ADMIN_ALLOWED_CIDRS:-}"

# Accept only tokens shaped like an IPv4/IPv6 address or CIDR. This is a
# security control, not just a nicety: it prevents a malformed env value from
# injecting arbitrary nginx directives into the included config.
is_valid_cidr() {
    printf '%s' "$1" | grep -Eq \
        '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$|^[0-9A-Fa-f:]+(/[0-9]{1,3})?$'
}

# Space/comma separated -> space separated.
split_list() { printf '%s' "$1" | tr ',' ' '; }

# --- real-client-IP trust config (http context; included by nginx.conf) -------
{
    echo "# GENERATED at container start by generate-admin-config.sh — do not edit."
    echo "# Restores the real client IP (admin filtering + access logs) when traffic"
    echo "# arrives via the Docker bridge gateway / front proxy. Only trust CIDRs you"
    echo "# control: a trusted source can spoof the forwarded-for header."
    _real_ip_count=0
    for cidr in $(split_list "$TRUSTED_PROXY_CIDRS"); do
        [ -n "$cidr" ] || continue
        if is_valid_cidr "$cidr"; then
            echo "set_real_ip_from $cidr;"
            _real_ip_count=$((_real_ip_count + 1))
        else
            echo "WARN: ignoring invalid TRUSTED_PROXY_CIDRS entry: '$cidr'" >&2
        fi
    done
    if [ "$_real_ip_count" -eq 0 ]; then
        echo "# (no valid TRUSTED_PROXY_CIDRS — real_ip disabled; \$remote_addr = direct peer)"
        echo "WARN: no valid TRUSTED_PROXY_CIDRS; real_ip disabled" >&2
    else
        if printf '%s' "$REAL_IP_HEADER" | grep -Eq '^[A-Za-z0-9-]+$'; then
            echo "real_ip_header $REAL_IP_HEADER;"
        else
            echo "WARN: invalid REAL_IP_HEADER '$REAL_IP_HEADER'; using X-Forwarded-For" >&2
            echo "real_ip_header X-Forwarded-For;"
        fi
        echo "real_ip_recursive on;"
    fi
} > "$REAL_IP_CONF"

# --- admin allowlist (included inside the admin server block) ------------------
{
    echo "# GENERATED at container start by generate-admin-config.sh — do not edit."
    echo "# Included AFTER the loopback allows in the admin server block. Empty"
    echo "# ADMIN_ALLOWED_CIDRS => closed (loopback only). Never emits a blanket allow"
    echo "# as the default — a fresh deploy ships CLOSED to the public."
    for cidr in $(split_list "$ADMIN_ALLOWED_CIDRS"); do
        [ -n "$cidr" ] || continue
        if is_valid_cidr "$cidr"; then
            case "$cidr" in
                0.0.0.0/0 | ::/0)
                    echo "WARN: ADMIN_ALLOWED_CIDRS opens admin to THE WORLD ($cidr) — test only, never prod" >&2
                    ;;
                # RFC 5737 / RFC 3849 documentation ranges (#336): these are the
                # sample values in .env.example, and one was pasted verbatim into
                # production — the only symptom was an opaque 403. Warn loudly,
                # do NOT fail: CI fixtures legitimately use these ranges.
                # Prefix-exact on purpose: the dot/colon boundary keeps real
                # addresses like 192.0.20.1 silent; a broader v4 prefix such as
                # 192.0.0.0/16 that merely CONTAINS a doc range is also silent —
                # this catches the pasted-sample mistake, not every superset.
                192.0.2.* | 198.51.100.* | 203.0.113.* | 2001:[Dd][Bb]8:* | 2001:0[Dd][Bb]8:*)
                    echo "WARN: ADMIN_ALLOWED_CIDRS entry '$cidr' is a DOCUMENTATION address (RFC 5737/3849) — it looks copied from .env.example; no real client ever has it, so admin will 403 for everyone (#336)" >&2
                    ;;
            esac
            echo "allow $cidr;"
        else
            echo "WARN: ignoring invalid ADMIN_ALLOWED_CIDRS entry: '$cidr'" >&2
        fi
    done
    echo "deny all;"
} > "$ALLOWLIST_CONF"
