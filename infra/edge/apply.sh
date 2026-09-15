#!/usr/bin/env bash
# apply.sh — the ONE sanctioned way to change the shared Caddy edge (#338).
#
# Modes (closed surface — anything else is usage, exit 64):
#   bash infra/edge/apply.sh            # = --check (READ-ONLY default)
#   bash infra/edge/apply.sh --check    # diff committed vs running; NO changes
#   bash infra/edge/apply.sh --apply    # validate, install, graceful reload
#
# Run ON the prod host, from a checkout. Stdin mode (`ssh host 'bash -s' <
# apply.sh`) is REFUSED: without BASH_SOURCE the script cannot locate its
# sibling Caddyfile and an earlier draft silently resolved to the cwd —
# validating and installing whatever ./Caddyfile happened to lie there
# (#420 review round 1, blocker 1). Copy the repo to the host instead.
#
# The edge serves EVERY tenant, so --apply fails CLOSED at each step:
#   * `caddy validate` runs before anything is touched; an invalid config
#     never replaces the running one.
#   * A DIFFERING running config is never overwritten silently: the unified
#     diff is printed and EDGE_APPLY_CONFIRM=1 must be set — that is the
#     structural do-not-touch guard for a neighbour's hand-added block
#     (round 1, finding 3). A byte-identical target is a no-op (idempotent).
#   * Reload failure restores the backup and reloads the old config.
#   * `systemctl is-active` failing AFTER a reload is the one failure that
#     takes down every tenant — it restores + reloads the backup and exits 1
#     LOUDLY (round 1, finding 4: it used to be the only silent path).
#
# Deliberately NOT wired into the rollout job: the edge must not roll on one
# tenant's release cadence (#310 option-A rationale).
#
# Test seams (used ONLY by apply.test.sh; unset in real use):
#   EDGE_DST       target path        (default /etc/caddy/Caddyfile)
#   EDGE_SUDO      privilege wrapper  (default sudo; test sets it empty)
#   EDGE_CADDY     caddy binary       (default caddy)
#   EDGE_SYSTEMCTL systemctl binary   (default systemctl)
set -euo pipefail

if [ -z "${BASH_SOURCE[0]:-}" ]; then
    echo "✗ stdin mode is unsupported: the script cannot locate the committed" >&2
    echo "  Caddyfile without a checkout (it would resolve to the cwd — see" >&2
    echo "  the header). Run it from a copy of the repo on the host." >&2
    exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/Caddyfile"
DST="${EDGE_DST:-/etc/caddy/Caddyfile}"
SUDO="${EDGE_SUDO-sudo}"
CADDY="${EDGE_CADDY:-caddy}"
SYSTEMCTL="${EDGE_SYSTEMCTL:-systemctl}"

MODE="${1:---check}"
case "$MODE" in
    --check|--apply) ;;
    *)
        echo "usage: apply.sh [--check|--apply]   (default: --check, read-only)" >&2
        echo "✗ unrecognised argument: $MODE — nothing was validated or applied" >&2
        exit 64 ;;
esac

[ -f "$SRC" ] || { echo "✗ committed Caddyfile not found at $SRC" >&2; exit 1; }

if [ "$MODE" = "--check" ]; then
    if [ ! -f "$DST" ]; then
        echo "✗ no running Caddyfile at $DST (fresh host? run --apply)" >&2
        exit 1
    fi
    if diff -u "$DST" "$SRC"; then
        echo "✓ edge in sync: $DST is byte-identical to the committed Caddyfile"
        exit 0
    else
        echo "✗ DRIFT: running edge differs from the committed Caddyfile (diff above:" >&2
        echo "  '-' = running, '+' = committed). Reconcile via PR, then --apply." >&2
        exit 1
    fi
fi

# --- --apply ---------------------------------------------------------------
command -v "$CADDY" >/dev/null || { echo "✗ caddy not on PATH — run on the edge host" >&2; exit 1; }

if [ -f "$DST" ] && diff -q "$DST" "$SRC" >/dev/null; then
    echo "✓ edge already in sync — nothing to do"
    exit 0
fi

echo "== validating committed Caddyfile =="
if ! "$CADDY" validate --config "$SRC" --adapter caddyfile; then
    echo "✗ validation FAILED — the running edge was NOT touched" >&2
    exit 1
fi

HAD_OLD=0
if [ -f "$DST" ]; then
    HAD_OLD=1
    echo "== the running edge will CHANGE as follows ('-' = running, '+' = committed) =="
    diff -u "$DST" "$SRC" || true
    if [ "${EDGE_APPLY_CONFIRM:-0}" != "1" ]; then
        echo "✗ refusing to overwrite a differing running config without" >&2
        echo "  EDGE_APPLY_CONFIRM=1 — lines the diff REMOVES may be another" >&2
        echo "  tenant's hand-added block (the do-not-touch guard). Review the" >&2
        echo "  diff; if the removals are intended, re-run with the confirm." >&2
        exit 1
    fi
    echo "== installing to $DST (backup: $DST.bak) =="
    $SUDO cp -p "$DST" "$DST.bak"
else
    echo "== fresh host: installing to $DST (no previous config to back up) =="
fi
$SUDO install -m 0644 "$SRC" "$DST"

restore_old() {
    if [ "$HAD_OLD" = "1" ]; then
        echo "  restoring $DST.bak and reloading the old config" >&2
        $SUDO install -m 0644 "$DST.bak" "$DST"
        $SUDO "$SYSTEMCTL" reload caddy || true
    else
        echo "  fresh host: no previous config to restore — $DST left in place" >&2
    fi
}

echo "== graceful reload =="
if ! $SUDO "$SYSTEMCTL" reload caddy; then
    echo "✗ reload FAILED" >&2
    restore_old
    exit 1
fi
if ! "$SYSTEMCTL" is-active --quiet caddy; then
    echo "✗ caddy is NOT ACTIVE after the reload — every tenant is down" >&2
    restore_old
    exit 1
fi
echo "✓ edge reloaded and active"
