#!/usr/bin/env bash
# cloudflare-ranges.sh — writes the host-side import file that tells the edge
# which connections are Cloudflare's (viafrei repo issue #1267).
#
# viafrei.de and www.viafrei.de are the only Cloudflare-PROXIED names on this
# host. Their site blocks serve a connection only when its peer is one of
# Cloudflare's addresses and answer 403 to anything else (the Caddyfile says
# why). The addresses are NOT in the committed Caddyfile — apply.test.sh
# refuses an address literal there, and Cloudflare changes the list on its own
# schedule — so the blocks import one line from a file outside the repository:
#
#     /etc/caddy/viafrei-cloudflare.conf   (root:caddy, 0640)
#         remote_ip <cidr> [<cidr> …]     (imported INSIDE the @cf_visitor matcher)
#
# This script is the one way that file is written.
#
# Modes (closed surface — anything else is usage, exit 64):
#   sudo bash infra/edge/cloudflare-ranges.sh            # = --check (READ-ONLY)
#   sudo bash infra/edge/cloudflare-ranges.sh --check    # fetch, validate, diff
#                                                        # against the installed
#                                                        # file; changes nothing
#   sudo bash infra/edge/cloudflare-ranges.sh --write    # fetch, validate, install
#
# Exit codes: 0 current / written; 1 --check found the file missing or
# different (the diff is printed); 2 REFUSED — a download failed, a line is
# not a CIDR, the list is short, the target directory is absent or the
# installed file cannot be read. A refusal writes nothing, ever.
#
# FAIL CLOSED, on the side that matters: the file decides who may reach
# viafrei.de at all. A truncated download or an HTML error page written into
# it would lock every visitor out (Cloudflare's own connections refused) or,
# with a stray wide range, let everybody past the door. So:
#   * every line of both lists must be a CIDR of its family — one line that
#     is not refuses the whole run (a captive portal, an HTML page, a CDN
#     error body);
#   * fewer than CF_MIN_V4 (10) IPv4 or CF_MIN_V6 (5) IPv6 ranges is a refusal
#     (Cloudflare publishes 15 and 7 as of 2026-11; a short list is a broken
#     download, not a smaller Cloudflare);
#   * a /0 (or any prefix shorter than /8 for IPv4, /12 for IPv6) is refused:
#     it would make "Cloudflare" mean "everybody";
#   * the file is written to a temporary name in the SAME directory with its
#     final owner and mode, the previous file is kept as .bak, and the new one
#     is renamed over it — Caddy never reads a half-written file.
#
# AFTER --write, the running edge still holds the OLD list: an imported file is
# read at load time. Validate and reload (apply.sh does not reload an edge
# whose Caddyfile is already in sync):
#     sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
#       && sudo systemctl reload caddy
# On the FIRST run there is nothing to reload: run apply.sh next.
#
# DAILY DRIFT CHECK: infra/edge/systemd/viafrei-cloudflare-ranges-check.timer
# runs `--check` as the caddy user (it reads the 0640 file through its group).
# Drift or a refusal FAILS the unit (journal + `systemctl --failed`); it never
# writes, because a list that moved is a change somebody should look at.
# Install steps are in that service file's header.
#
# Test seams (used ONLY by apply.test.sh; unset in real use):
#   CF_RANGES_DST    target file    (default /etc/caddy/viafrei-cloudflare.conf)
#   CF_RANGES_CURL   curl binary    (default curl)
#   CF_RANGES_SUDO   privilege wrapper for the install steps
#                    (default: none when run as root, else sudo)
#   CF_RANGES_OWNER  file owner     (default root)
#   CF_RANGES_GROUP  file group     (default caddy)
set -euo pipefail

V4_URL="https://www.cloudflare.com/ips-v4"
V6_URL="https://www.cloudflare.com/ips-v6"
DST="${CF_RANGES_DST:-/etc/caddy/viafrei-cloudflare.conf}"
CURL="${CF_RANGES_CURL:-curl}"
if [ "$(id -u)" = 0 ]; then SUDO_DEFAULT=""; else SUDO_DEFAULT="sudo"; fi
SUDO="${CF_RANGES_SUDO-$SUDO_DEFAULT}"
OWNER="${CF_RANGES_OWNER:-root}"
GROUP="${CF_RANGES_GROUP:-caddy}"
MIN_V4=10
MIN_V6=5

MODE="${1:---check}"
case "$MODE" in
    --check|--write) ;;
    *)
        echo "usage: cloudflare-ranges.sh [--check|--write]   (default: --check, read-only)" >&2
        echo "✗ unrecognised argument: $MODE — nothing was fetched or written" >&2
        exit 64 ;;
esac
[ "$#" -le 1 ] || { echo "✗ one mode only (got: $*) — nothing was fetched or written" >&2; exit 64; }

refuse() { echo "✗ REFUSED: $*" >&2; echo "  (nothing was written; $DST is unchanged)" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cf-ranges.XXXXXX")"
TMPDST=""
trap 'rm -rf "$WORK"; if [ -n "$TMPDST" ]; then $SUDO rm -f "$TMPDST" 2>/dev/null || true; fi' EXIT

fetch() { # fetch <url> <out>
    if ! "$CURL" -fsS --proto '=https' --tlsv1.2 --max-time 20 --retry 2 "$1" -o "$2"; then
        refuse "could not fetch $1"
    fi
}

valid_v4() { # one CIDR, IPv4, every octet <= 255, prefix 8..32
    local cidr="$1" addr pfx o
    case "$cidr" in */*) ;; *) return 1 ;; esac
    addr="${cidr%/*}"; pfx="${cidr##*/}"
    printf '%s\n' "$addr" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || return 1
    printf '%s\n' "$pfx" | grep -qE '^[0-9]{1,2}$' || return 1
    [ "$pfx" -ge 8 ] && [ "$pfx" -le 32 ] || return 1
    for o in $(printf '%s' "$addr" | tr '.' ' '); do
        [ "$((10#$o))" -le 255 ] || return 1
    done
    return 0
}

valid_v6() { # one CIDR, IPv6: hex groups and colons, at most one ::, prefix 12..128
    local cidr="$1" addr pfx groups
    case "$cidr" in */*) ;; *) return 1 ;; esac
    addr="${cidr%/*}"; pfx="${cidr##*/}"
    printf '%s\n' "$addr" | grep -qE '^[0-9A-Fa-f:]+$' || return 1
    case "$addr" in *:*:*) ;; *) return 1 ;; esac            # at least two colons
    case "$addr" in *::*::*) return 1 ;; esac                  # at most one ::
    case "$addr" in *:::*) return 1 ;; esac
    printf '%s\n' "$addr" | tr ':' '\n' | grep -qE '^[0-9A-Fa-f]{5,}$' && return 1
    groups="$(printf '%s' "$addr" | tr -cd ':' | wc -c | tr -d ' ')"
    [ "$groups" -le 7 ] || return 1
    printf '%s\n' "$pfx" | grep -qE '^[0-9]{1,3}$' || return 1
    [ "$pfx" -ge 12 ] && [ "$pfx" -le 128 ] || return 1
    return 0
}

# read_list <file> <family> -> the CIDRs, space-separated, on stdout; refuses
# on the first line that is not one. Blank lines and a trailing CR are allowed
# (a CRLF download is still the list); anything else is not.
read_list() {
    local file="$1" fam="$2" line out=""
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        [ -n "$line" ] || continue
        if [ "$fam" = v4 ]; then valid_v4 "$line" || refuse "not an IPv4 CIDR in $V4_URL: line of ${#line} character(s)"
        else                     valid_v6 "$line" || refuse "not an IPv6 CIDR in $V6_URL: line of ${#line} character(s)"
        fi
        out="${out:+$out }$line"
    done < "$file"
    printf '%s' "$out"
}

fetch "$V4_URL" "$WORK/v4"
fetch "$V6_URL" "$WORK/v6"
V4="$(read_list "$WORK/v4" v4)"
V6="$(read_list "$WORK/v6" v6)"
N4=0; for c in $V4; do N4=$((N4 + 1)); done
N6=0; for c in $V6; do N6=$((N6 + 1)); done
[ "$N4" -ge "$MIN_V4" ] || refuse "only $N4 IPv4 range(s) from $V4_URL (want >= $MIN_V4): a short list is a broken download"
[ "$N6" -ge "$MIN_V6" ] || refuse "only $N6 IPv6 range(s) from $V6_URL (want >= $MIN_V6): a short list is a broken download"

# No timestamp in the file: --check compares bytes, and a file that changes on
# every run is a file whose drift nobody can see.
{
    echo "# Cloudflare's IP ranges — GENERATED by infra/edge/cloudflare-ranges.sh"
    echo "# (beaconfolio repository). Do not edit by hand: re-run the script."
    echo "# Source: $V4_URL ($N4) and $V6_URL ($N6)."
    echo "# Imported inside the @cf_visitor matcher of viafrei.de and www.viafrei.de (viafrei #1267)."
    echo "remote_ip $V4 $V6"
} > "$WORK/new"

DIR="$(dirname "$DST")"
[ -d "$DIR" ] || refuse "the target directory $DIR does not exist (is this the edge host?)"

if [ -e "$DST" ] && [ ! -r "$DST" ]; then
    refuse "$DST exists but cannot be read by $(id -un) — run with sudo"
fi

if [ "$MODE" = "--check" ]; then
    if [ ! -e "$DST" ]; then
        echo "✗ $DST does not exist — the edge cannot be applied until it does." >&2
        echo "  Fix: sudo bash $0 --write   ($N4 IPv4 + $N6 IPv6 ranges fetched and valid)" >&2
        exit 1
    fi
    if diff -u "$DST" "$WORK/new"; then
        echo "✓ $DST is current: $N4 IPv4 + $N6 IPv6 ranges, byte-identical to Cloudflare's lists"
        exit 0
    fi
    echo "✗ $DST differs from Cloudflare's current lists (diff above: '-' = installed," >&2
    echo "  '+' = fetched). Fix: sudo bash $0 --write, then validate + reload." >&2
    exit 1
fi

# --- --write -------------------------------------------------------------------
if [ -e "$DST" ] && cmp -s "$DST" "$WORK/new"; then
    echo "✓ $DST already current ($N4 IPv4 + $N6 IPv6) — nothing written"
    exit 0
fi
FIRST=1; [ -e "$DST" ] && FIRST=0
TMPDST="$DST.new.$$"
$SUDO install -o "$OWNER" -g "$GROUP" -m 0640 "$WORK/new" "$TMPDST"
if [ "$FIRST" = 0 ]; then
    $SUDO cp -p "$DST" "$DST.bak"
fi
$SUDO mv -f "$TMPDST" "$DST"
echo "✓ wrote $DST ($N4 IPv4 + $N6 IPv6, $OWNER:$GROUP 0640)"
if [ "$FIRST" = 1 ]; then
    echo "  first run: no previous file. Next: bash infra/edge/apply.sh, then --apply."
else
    echo "  previous file kept as $DST.bak. The running edge still holds the old list:"
    echo "  sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \\"
    echo "    && sudo systemctl reload caddy"
fi
