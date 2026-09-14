#!/usr/bin/env bash
# apply.sh — the ONE sanctioned way to change the shared Caddy edge (#338).
#
# Modes:
#   bash infra/edge/apply.sh --check   # diff committed vs running; NO changes.
#   bash infra/edge/apply.sh           # validate committed file, install it,
#                                      # graceful reload. Refuses on validation
#                                      # failure, leaving the running edge as-is.
#
# Run ON the prod host (or via: ssh <host> 'bash -s -- [--check]' < apply.sh
# — stdin mode has no repo checkout, so it only supports --check against a
# pasted file; prefer running from a checkout).
#
# Deliberately NOT wired into the rollout job: the edge serves EVERY tenant and
# must not roll on one tenant's release cadence (#310 option-A rationale).
# Validation before install is the whole point — `caddy validate` parses and
# provisions the config without binding sockets, so a syntax error or a bad
# directive is caught while the old edge keeps serving.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/Caddyfile"
DST="/etc/caddy/Caddyfile"
MODE="${1:-apply}"

[ -f "$SRC" ] || { echo "✗ committed Caddyfile not found at $SRC" >&2; exit 1; }

if [ "$MODE" = "--check" ]; then
    if [ ! -f "$DST" ]; then
        echo "✗ no running Caddyfile at $DST (fresh host? run apply)" >&2
        exit 1
    fi
    if diff -u "$DST" "$SRC"; then
        echo "✓ edge in sync: $DST is byte-identical to the committed Caddyfile"
        exit 0
    else
        echo "✗ DRIFT: running edge differs from the committed Caddyfile (diff above:" >&2
        echo "  '-' = running, '+' = committed). Reconcile via PR, then apply." >&2
        exit 1
    fi
fi

command -v caddy >/dev/null || { echo "✗ caddy not on PATH — run on the edge host" >&2; exit 1; }

echo "== validating committed Caddyfile =="
if ! caddy validate --config "$SRC" --adapter caddyfile; then
    echo "✗ validation FAILED — the running edge was NOT touched" >&2
    exit 1
fi

echo "== installing to $DST (backup: $DST.bak) =="
sudo cp -p "$DST" "$DST.bak" 2>/dev/null || true
sudo install -m 0644 "$SRC" "$DST"

echo "== graceful reload =="
if ! sudo systemctl reload caddy; then
    echo "✗ reload FAILED — restoring $DST.bak and reloading the old config" >&2
    sudo install -m 0644 "$DST.bak" "$DST"
    sudo systemctl reload caddy || true
    exit 1
fi
systemctl is-active --quiet caddy && echo "✓ edge reloaded and active"
