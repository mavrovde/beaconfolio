#!/usr/bin/env bash
# apply.test.sh — pins apply.sh's fail-closed contract with stubbed
# caddy/systemctl (#420 review round 1: findings 1-4 each cost or nearly
# cost a live edge; each is a case here so it cannot regress silently).
# Runs anywhere (macOS/Linux) — no sudo, no caddy, no systemd needed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY="$HERE/apply.sh"
SRC="$HERE/Caddyfile"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- stubs -----------------------------------------------------------------
STUB="$TMP/bin"
mkdir -p "$STUB"
cat > "$STUB/caddy" <<'EOF'
#!/usr/bin/env bash
[ "$1" = "validate" ] || { echo "stub caddy: unexpected args: $*" >&2; exit 99; }
exit "${STUB_CADDY_RC:-0}"
EOF
cat > "$STUB/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
    reload)
        echo "reload" >> "$STUB_LOG"
        # first reload obeys STUB_RELOAD_RC; later ones (the restore path)
        # succeed, mirroring a bad new config + a good old one
        n=$(grep -c reload "$STUB_LOG")
        [ "$n" -gt 1 ] && exit 0
        exit "${STUB_RELOAD_RC:-0}" ;;
    is-active) exit "${STUB_ACTIVE_RC:-0}" ;;
    *) echo "stub systemctl: unexpected args: $*" >&2; exit 99 ;;
esac
EOF
chmod +x "$STUB/caddy" "$STUB/systemctl"

run_apply() { # run_apply <mode-args...>; env seams pre-exported per case
    env EDGE_DST="$DST" EDGE_SUDO= EDGE_CADDY="$STUB/caddy" \
        EDGE_SYSTEMCTL="$STUB/systemctl" STUB_LOG="$LOG" \
        STUB_CADDY_RC="${STUB_CADDY_RC:-0}" STUB_RELOAD_RC="${STUB_RELOAD_RC:-0}" \
        STUB_ACTIVE_RC="${STUB_ACTIVE_RC:-0}" \
        EDGE_APPLY_CONFIRM="${EDGE_APPLY_CONFIRM:-0}" \
        bash "$APPLY" "$@"
}

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1" >&2; }
check() { # check <desc> <expected-rc> <actual-rc>
    if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want rc=$2, got rc=$3)"; fi
}

fresh_case() { # resets DST dir + reload log; $1 = optional pre-existing DST content
    DST="$TMP/etc/Caddyfile"; LOG="$TMP/reload.log"
    rm -rf "$TMP/etc" "$LOG"; mkdir -p "$TMP/etc"; : > "$LOG"
    [ -n "${1:-}" ] && printf '%s\n' "$1" > "$DST"
    STUB_CADDY_RC=0 STUB_RELOAD_RC=0 STUB_ACTIVE_RC=0 EDGE_APPLY_CONFIRM=0
}

echo "== apply.sh contract =="

# 1. unknown argument: usage, exit 64, target untouched (finding 2)
fresh_case "old config"
rc=0; run_apply --force >/dev/null 2>&1 || rc=$?
check "unknown arg is refused with exit 64" 64 "$rc"
[ "$(cat "$DST")" = "old config" ] && ok "unknown arg leaves the target untouched" \
    || bad "unknown arg modified the target"

# 2. the DEFAULT (no arg) is --check: read-only even against drift (finding 2)
fresh_case "old config"
rc=0; run_apply >/dev/null 2>&1 || rc=$?
check "default (no arg) is --check and reports drift red" 1 "$rc"
[ "$(cat "$DST")" = "old config" ] && ok "default mode never writes" \
    || bad "default mode WROTE to the target"
[ ! -s "$LOG" ] && ok "default mode never reloads" || bad "default mode reloaded caddy"

# 3. --check on an in-sync target is green
fresh_case; cp "$SRC" "$DST"
rc=0; run_apply --check >/dev/null 2>&1 || rc=$?
check "--check is green when in sync" 0 "$rc"

# 4. stdin mode is refused before anything resolves (finding 1). The trap being
# pinned is NOT "stdin exits non-zero" — it is "stdin silently adopts whatever
# ./Caddyfile lies in the cwd" (#420 round 2: without the decoy below, a
# guard-less script found no cwd Caddyfile, exited 1 incidentally, and the
# vulnerable code passed its own regression test). So: plant a decoy in the
# cwd and set the confirm, so a script whose stdin guard is removed would
# sail through every later gate and INSTALL the decoy — both assertions red.
fresh_case "old config"
printf 'DECOY — must never be validated or installed\n' > "$TMP/Caddyfile"
rc=0; ( cd "$TMP" && env EDGE_DST="$DST" EDGE_SUDO= EDGE_CADDY="$STUB/caddy" \
    EDGE_SYSTEMCTL="$STUB/systemctl" STUB_LOG="$LOG" EDGE_APPLY_CONFIRM=1 \
    bash -s -- --apply < "$APPLY" ) >/dev/null 2>&1 || rc=$?
check "stdin mode (bash -s) is refused" 1 "$rc"
[ "$(cat "$DST")" = "old config" ] && ok "stdin mode installed nothing" \
    || bad "stdin mode MODIFIED the target"
rm -f "$TMP/Caddyfile"

# 5. --apply with drift and NO confirm refuses (finding 3)
fresh_case "old config"
rc=0; run_apply --apply >/dev/null 2>&1 || rc=$?
check "--apply on a differing target refuses without EDGE_APPLY_CONFIRM=1" 1 "$rc"
[ "$(cat "$DST")" = "old config" ] && ok "unconfirmed apply leaves the target untouched" \
    || bad "unconfirmed apply overwrote the target"

# 6. --apply with confirm installs, backs up, reloads
fresh_case "old config"; EDGE_APPLY_CONFIRM=1
rc=0; run_apply --apply >/dev/null 2>&1 || rc=$?
check "confirmed apply succeeds" 0 "$rc"
diff -q "$DST" "$SRC" >/dev/null && ok "confirmed apply installed the committed file" \
    || bad "confirmed apply did not install the committed file"
[ "$(cat "$DST.bak")" = "old config" ] && ok "confirmed apply backed up the old config" \
    || bad "backup missing or wrong"

# 7. validation failure leaves the target untouched
fresh_case "old config"; STUB_CADDY_RC=1 EDGE_APPLY_CONFIRM=1
rc=0; run_apply --apply >/dev/null 2>&1 || rc=$?
check "validation failure is red" 1 "$rc"
[ "$(cat "$DST")" = "old config" ] && ok "validation failure touched nothing" \
    || bad "validation failure MODIFIED the target"
[ ! -s "$LOG" ] && ok "validation failure never reloaded" || bad "reloaded after failed validation"

# 8. reload failure restores the backup and reloads the old config
fresh_case "old config"; STUB_RELOAD_RC=1 EDGE_APPLY_CONFIRM=1
rc=0; run_apply --apply >/dev/null 2>&1 || rc=$?
check "reload failure is red" 1 "$rc"
[ "$(cat "$DST")" = "old config" ] && ok "reload failure restored the old config" \
    || bad "reload failure left the NEW config installed"
[ "$(grep -c reload "$LOG")" = "2" ] && ok "reload failure re-reloaded the restored config" \
    || bad "restored config was not reloaded"

# 9. inactive-after-reload is LOUD and restores (finding 4 — was the silent path)
fresh_case "old config"; STUB_ACTIVE_RC=1 EDGE_APPLY_CONFIRM=1
out="$TMP/out9"; rc=0; run_apply --apply >"$out" 2>&1 || rc=$?
check "caddy inactive after reload is red" 1 "$rc"
grep -q "NOT ACTIVE" "$out" && ok "inactive-after-reload fails LOUDLY" \
    || bad "inactive-after-reload had no loud message"
[ "$(cat "$DST")" = "old config" ] && ok "inactive-after-reload restored the old config" \
    || bad "inactive-after-reload left the new config in place"

# 10. fresh host: installs without a lying 'restoring' message (minor 8)
fresh_case
out="$TMP/out10"; rc=0; run_apply --apply >"$out" 2>&1 || rc=$?
check "fresh-host apply succeeds" 0 "$rc"
diff -q "$DST" "$SRC" >/dev/null && ok "fresh-host apply installed the committed file" \
    || bad "fresh-host apply did not install"
grep -qi "restor" "$out" && bad "fresh-host apply printed a restore message" \
    || ok "fresh-host apply never claims to restore"

# 11. in-sync --apply is an idempotent no-op (minor 10)
fresh_case; cp "$SRC" "$DST"
rc=0; run_apply --apply >/dev/null 2>&1 || rc=$?
check "in-sync apply is green" 0 "$rc"
[ ! -s "$LOG" ] && ok "in-sync apply never reloads (idempotent)" \
    || bad "in-sync apply reloaded caddy"

echo
echo "== apply.sh contract: $PASS passed, $FAIL failed =="
[ "$FAIL" = "0" ]
