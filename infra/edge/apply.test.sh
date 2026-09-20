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
cat > "$STUB/sudo" <<'EOF'
#!/usr/bin/env bash
# records what was asked for, then runs it — so a case can assert WHICH steps
# the script wraps in the privilege wrapper, not merely that it has one
echo "sudo $*" >> "$SUDO_LOG"
exec "$@"
EOF
chmod +x "$STUB/caddy" "$STUB/systemctl" "$STUB/sudo"

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

# 7b. validate runs UNDER the privilege wrapper. Not a style point: the status
# block imports /etc/caddy/viafrei-status-allow.conf, whose documented and
# actual mode is 0640 root:caddy. Run as the ordinary user this script assumes
# everywhere else (it $SUDOs cp, install and systemctl), `caddy validate` could
# not read that import and exited with
#     Could not import /etc/caddy/viafrei-status-allow.conf: permission denied
# — measured on the edge host, 2026-09-21, where the same command under sudo
# answers "Valid configuration". Fail-closed, so nothing was ever wrongly
# installed; it meant the sanctioned apply path stopped at its first step.
fresh_case "old config"; EDGE_APPLY_CONFIRM=1
SUDO_LOG="$TMP/sudo.log"; : > "$SUDO_LOG"
rc=0; env EDGE_DST="$DST" EDGE_SUDO="$STUB/sudo" EDGE_CADDY="$STUB/caddy" \
    EDGE_SYSTEMCTL="$STUB/systemctl" STUB_LOG="$LOG" SUDO_LOG="$SUDO_LOG" \
    EDGE_APPLY_CONFIRM=1 bash "$APPLY" --apply >/dev/null 2>&1 || rc=$?
check "apply with a recording sudo wrapper succeeds" 0 "$rc"
grep -q "sudo .*validate" "$SUDO_LOG" \
    && ok "caddy validate runs under the privilege wrapper (the 0640 root:caddy import is unreadable without it)" \
    || bad "caddy validate is NOT wrapped in \$SUDO: on the real host it cannot read the allow-list import and every apply dies there"

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
echo "== the committed Caddyfile's shape (viafrei #94) =="
# The edge config is code, and its riskiest property cannot be seen by running
# apply.sh: WHICH site blocks carry an IP restriction. viafrei's status
# dashboard must be behind one; viafrei.de and mcp.viafrei.de must not be (that
# tenant's owner, 2026-09-19: the product stays public, the operational surface
# does not). Files only — no caddy, no host, no network.

# 12. the status route exists and points at the registered tenant port
grep -q '^status\.viafrei\.de {$' "$SRC" \
    && ok "the status.viafrei.de site block exists" || bad "no status.viafrei.de site block"
awk '/^status\.viafrei\.de \{$/{f=1} f&&/reverse_proxy 127\.0\.0\.1:18190/{a=1} /^\}$/{f=0} END{exit !a}' "$SRC" \
    && ok "it proxies the viafrei tenant's registered 18190" || bad "the status block does not proxy 127.0.0.1:18190"
grep -q '18190' "$HERE/ports.md" \
    && ok "18190 is registered in ports.md" || bad "18190 is not in the port registry"

# 13. the matcher is IMPORTED, never written here: the addresses are personal
# data, they change when a network does, and changing them must not be a PR.
grep -q 'import /etc/caddy/viafrei-status-allow.conf' "$SRC" \
    && ok "the allow-list is imported from a file outside this repository" \
    || bad "the status block does not import its address list"
grep -qE '^[^#]*remote_ip[[:space:]]+[0-9]' "$SRC" \
    && bad "an address literal follows remote_ip in the committed file" \
    || ok "no address literal follows remote_ip in the committed file"
# Any routable-looking IPv4 on a non-comment line, other than the loopback
# upstreams this whole file is built on.
grep -vE '^[[:space:]]*#' "$SRC" | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | grep -qv '^127\.0\.0\.1$' \
    && bad "a non-loopback address literal is committed in the Caddyfile" \
    || ok "the only address literals in the file are loopback upstreams"

# 13b. the three things the owner has to get right on the HOST, stated where
# the change is made. They are comments, and that is the point: nothing in this
# repository can enforce the mode of a file it must never contain, so the file
# that sends somebody to create it is the file that has to say how.
grep -q 'root:caddy, 0640' "$SRC" \
    && ok "the allow file's documented mode is 0640 root:caddy (the addresses are personal data)" \
    || bad "the allow file's documented mode is not 0640 root:caddy"
# In the PATH LINE, not in the prose: the sentence under it explains why the
# mode is 0640 "and not 0644", and a check that reads its own rationale as
# configuration is a check that fails for the wrong reason.
grep -qE '^#.*viafrei-status-allow\.conf.*0644' "$SRC" \
    && bad "a world-readable mode is still documented for the allow file" \
    || ok "no world-readable mode is documented for the allow file"
grep -qi 'plain A/AAAA' "$SRC" \
    && ok "the block says its DNS record must be a plain A/AAAA, never proxied (remote_ip sees the peer)" \
    || bad "the block does not say the record must be a plain A/AAAA"
grep -q 'must exist BEFORE the first apply' "$SRC" \
    && ok "and that the file must exist before the first apply (validate fails on an import that matches nothing)" \
    || bad "the first-run order is not stated as a step"

# 14. the restriction is SCOPED — present in the status block, absent
# everywhere else — and the status block's door is PROVED rather than inferred.
#
# ONE SCAN. Until round 5 this section was FOUR hand-rolled awk scanners, and
# three of them decided where a block ENDED by looking at the indentation
# COLUMN of its closing brace. Caddy does not care about indentation: measured
# against caddy v2.11.4 on the edge host, 2026-09-21, a site block whose
# closing brace carries one leading tab is "Valid configuration". Round 4
# retired the column rule in the containment count and in the triple and left
# it standing in `scoped_count` and in the fork check — so indenting the status
# block's own closing brace made every "outside the status block" rule go blind
# to everything after that point, and a `respond 402` door or a `remote_ip`
# restriction on a later site passed at 59/0 with this section printing that
# neither existed. Four copies is how three of them stayed wrong for three
# rounds. There is now one model, and these assertions read its numbers.
#
# WHAT THE MODEL IS: brace DEPTH. Every line contributes (count of `{`) minus
# (count of `}`), and a block ends when the depth returns to the depth it
# opened at. Nothing anywhere reads a column.
#
# Both characters are counted on every line, and the reason is NOT the
# single-line form `handle /x { … }`: round 3's rationale claimed Caddy reads
# that, and it does not — v2.11.4 refuses it with "Unexpected next token after
# '{' on same line", so the one-line route it narrated as an exploit was never
# installable. The real reasons are that an ordinary line carries BALANCED
# braces which must cancel instead of opening a block (`header_up Host {host}`
# is the commonest line in this file), and that this guard reads files Caddy
# has not accepted yet and must not produce a confident number for one.
#
# HANDLED, and each because Caddy behaves this way:
#   * indentation: ignored entirely, by anything but the eye;
#   * `{`/`}` inside a "double-quoted" or backtick-quoted token: Caddy reads
#     those as text, so they are removed before the braces are counted;
#   * a `# comment tail`: removed before counting, same reason;
#   * braces that do not balance: NOT guessed at — the scan reports it and the
#     first assertion below is red. A depth model on an unbalanced file is
#     arithmetic about nothing.
# REFUSED rather than reasoned about, each a narrow restriction on a feature
# this file does not use, each with a message that says why:
#   * an upstream whose port is not a LITERAL. All of these validate on
#     v2.11.4 (measured, same session) and route to the dashboard without the
#     digits 18190 appearing anywhere in the file:
#         reverse_proxy /ops* 127.0.0.1:{http.request.header.X-Up}
#         reverse_proxy /ops* 127.0.0.1:{$EDGE_UP_PORT}
#         reverse_proxy /ops* { dynamic srv _ops._tcp.example }
#     The first is the worst of them: the port is chosen by the CALLER, at
#     request time, from a header. No rule that reads this file can know what
#     an upstream resolves to, so a non-literal upstream is declined, not
#     analysed.
#   * a port RANGE (`127.0.0.1:18189-18191` is three upstreams, one of them
#     18190, and the literal never appears);
#   * a heredoc (`<<`), whose body is content a brace counter reads as config;
#   * an `import` of anything but the allow-list file, whose contents are not
#     in this repository and so cannot be read by any rule here.
# DELIBERATELY NOT HANDLED, and the reason:
#   * the port is matched on the RAW line, never on the sanitised copy, so no
#     sanitiser can hide a mention — `reverse_proxy "127.0.0.1:18190"` is
#     quoted and still counts. The price is that a comment TAIL naming 18190
#     outside the gate goes red. That is the safe direction of wrong.
#   * FULL-LINE comments are still skipped for the port, because this file's
#     own prose names the port, including the paragraph you are reading. That
#     skip is the one hole left in the port rule and it is bounded: a comment
#     cannot route traffic.
#
# NOT written as `awk … | { read … }`: a pipeline runs its last stage in a
# SUBSHELL, so ok/bad would print their line and lose the counter increment —
# a red tick and exit 0. That is this file's own subject matter, from the
# shell side.
caddy_scan() { # caddy_scan <file> -> the 15 numbers read by `read -r` below
    awk '
        function clean(s,   t) {           # a copy safe to count braces in
            t = s
            gsub(/"[^"]*"/, " ", t)        # quoted tokens are text to Caddy
            gsub(/`[^`]*`/, " ", t)
            if (t ~ /^[[:space:]]*#/) t = ""
            sub(/[[:space:]]#.*$/, "", t)  # and so is a comment tail
            return t
        }
        BEGIN { depth = 0 }
        {
            raw = $0
            bl  = clean(raw)
            dc  = raw; sub(/[[:space:]]#.*$/, "", dc)   # quotes KEPT: see below
            opens  = gsub(/\{/, "{", bl)   # gsub returns the COUNT; bl is unchanged
            closes = gsub(/\}/, "}", bl)
            pre  = depth
            post = pre + opens - closes
            if (post < 0) { neg = 1; post = 0 }

            if (pre == 0 && opens > 0) {   # a site block opens at depth 0
                site = (bl ~ /^status\.viafrei\.de \{$/)
                inblk = 1; fork_seen = 0; fork_fb = 0
                ga = 0; fb = 0
            }
            if (site && pre == 1) {        # the site block s own top level
                if (bl ~ /^[[:space:]]*import[[:space:]]+\/etc\/caddy\/viafrei-status-allow\.conf[[:space:]]*$/) imp = 1
                if (bl ~ /^[[:space:]]*handle[[:space:]]+@allowed[[:space:]]*\{/) { ga = 1; gseen = 1; gad = pre }
                if (bl ~ /^[[:space:]]*handle[[:space:]]*\{/)                     { fb = 1; fbd = pre }
            }
            # the fallback s BODY, at any depth inside it. `respond "Forbidden"
            # 403` is a legitimate refusal: clean() has already dropped the
            # quoted body, so the CODE is what is matched.
            if (site && fb && bl ~ /respond[[:space:]]+[45][0-9][0-9]([[:space:]]|$)/) deny = 1

            # OUTSIDE the status block. remote_ip and a bare 4xx/5xx refusal
            # belong to the one site with a door; everywhere else the product
            # is public and must stay that way.
            if (inblk && !site) {
                if (bl ~ /remote_ip/) out_remote++
                if (bl ~ /respond[[:space:]]+[45][0-9][0-9]([[:space:]]|$)/) out_deny++
                if (bl ~ /@allowed/) fork_seen = 1
                if (pre == 1 && bl ~ /^[[:space:]]*handle[[:space:]]*\{/) fork_fb = 1
            }

            if (raw !~ /^[[:space:]]*#/) {                      # RAW, never cleaned
                if (raw ~ /18190/) { tot++; if (site && ga) inside++ }
                if (raw ~ /:[0-9]+-[0-9]+/) range++
                if (raw ~ /<</) heredoc++
                if (raw ~ /^[[:space:]]*import[[:space:]]/) {
                    imports++
                    if (raw !~ /^[[:space:]]*import[[:space:]]+\/etc\/caddy\/viafrei-status-allow\.conf[[:space:]]*$/) badimport++
                }
                # UPSTREAMS, from the comment-stripped but STILL QUOTED line:
                # clean() would eat `reverse_proxy "127.0.0.1:{$X}"` whole.
                # Every argument of reverse_proxy / to that is not a matcher
                # must be a literal [scheme://]host[:port] and nothing else.
                if (dc ~ /^[[:space:]]*(reverse_proxy|to)[[:space:]]/) {
                    n = split(dc, tk, /[[:space:]]+/)
                    for (i = 1; i <= n; i++) {
                        t = tk[i]
                        if (t == "" || t == "reverse_proxy" || t == "to" || t == "{") continue
                        if (t ~ /^[\/@*]/) continue                  # a matcher, not an upstream
                        if (t !~ "^([A-Za-z0-9+.-]+://)?[A-Za-z0-9._-]+(:[0-9]+)?$") nonliteral++
                    }
                }
                if (dc ~ /^[[:space:]]*dynamic[[:space:]]/) nonliteral++
            }

            depth = post                   # close what this line closed
            if (depth <= 0) {
                if (inblk && fork_seen) { forks++; if (!fork_fb) forkbad++ }
                inblk = 0; fork_seen = 0; fork_fb = 0
                site = 0; ga = 0; fb = 0
            }
            if (ga && depth <= gad) ga = 0
            if (fb && depth <= fbd) fb = 0
        }
        END { print (tot+0), (inside+0), (imp+0), (gseen+0), (deny+0), \
                    (range+0), (heredoc+0), (imports+0), (badimport+0), \
                    ((neg == 0 && depth == 0) ? 1 : 0), (nonliteral+0), \
                    (out_remote+0), (out_deny+0), (forks+0), (forkbad+0) }' "$1"
}

# THE VERDICTS, as FUNCTIONS, and that is the round-5 half of the vacuity
# problem. Round 4 proved the SCAN could see a bad file; it could not prove the
# COMPARISON could reject one, because an assertion written inline is only ever
# tried against the one file in front of it — neutered to `[ 1 = 1 ]` it would
# pass forever and section 16 would stay green. Named, they can be handed a
# losing tuple, and section 16 does exactly that.
contained() { # contained <total> <inside> — every route to the port is gated
    [ "$1" -ge 1 ] && [ "$1" = "$2" ]
}
door() {      # door <imp> <gate> <deny> — the block positively refuses
    [ "$1" = 1 ] && [ "$2" = 1 ] && [ "$3" = 1 ]
}
none() {      # none <count> — the "refused on sight" verdicts
    [ "$1" = 0 ]
}

read -r gate_tot gate_inside s_imp s_gate s_deny s_range s_heredoc s_imports \
        s_badimport s_balanced s_nonliteral s_remote s_outdeny s_forks s_forkbad \
    <<< "$(caddy_scan "$SRC")"

# The depth model's own precondition, first: on an unbalanced file every number
# after this line is arithmetic about nothing.
[ "$s_balanced" = 1 ] \
    && ok "the file's braces balance, so the depth model has something true to model" \
    || bad "the Caddyfile's braces do not balance: every number below would be meaningless"
none "$s_remote" \
    && ok "remote_ip appears in NO site block but the status one" \
    || bad "remote_ip appears outside the status site block ($s_remote line(s))"
# `@allowed` need not be scoped to the status block: a block MAY use the same
# address list to ROUTE rather than to refuse — a fork in the road, not a door
# — provided it also carries a bare `handle {` fallback so nobody is turned
# away. What must stay scoped is REFUSAL.
#
# PRECONDITION, and it is the point of saying the number out loud: as of
# 2026-09-21 no block outside `status.` uses @allowed at all. A rule with
# nothing to judge passes for free, and a gate that reports success about what
# it never read is exactly the class this repository keeps finding. "0 forks,
# nothing to check" is an honest pass; a jump from 0 to 1 is a routing change
# someone must have intended.
none "$s_forkbad" \
    && ok "@allowed outside the status block only routes ($s_forks such block(s); each has an open fallback)" \
    || bad "$s_forkbad block(s) match @allowed with no open fallback: they refuse visitors outside the status block"
# Every spelling of a door, not one: 401, 404, 503 refuse a visitor exactly as
# 403 does, and a rule naming a single code is a rule a typo walks past.
none "$s_outdeny" \
    && ok "and neither does a 4xx/5xx refusal, quoted body or not" \
    || bad "a respond 4xx/5xx appears outside the status site block ($s_outdeny line(s))"
none "$s_nonliteral" \
    && ok "every reverse_proxy upstream is a literal host:port (a placeholder, {\$ENV} or dynamic upstream is declined, not analysed)" \
    || bad "$s_nonliteral upstream(s) are NOT literal: a request-time placeholder, {\$ENV} or dynamic upstream routes wherever it resolves — 127.0.0.1:{http.request.header.X-Up} lets the CALLER pick the port — and nothing that reads this file can know where. The gate declines to certify one"
none "$s_range" \
    && ok "no upstream carries a port range (the gate cannot expand one, so it refuses to certify one)" \
    || bad "an upstream carries a port RANGE ($s_range line(s)): 127.0.0.1:18189-18191 is three upstreams, one of them 18190, and the literal never appears — the gate declines to certify a range"
none "$s_heredoc" \
    && ok "no heredoc (<<) in the file (its body would be read as configuration by a brace counter)" \
    || bad "a heredoc (<<) appears in the Caddyfile: the gate cannot tell its body from configuration and declines to certify it"
[ "$s_imports" -ge 1 ] && none "$s_badimport" \
    && ok "every import is the allow-list file itself ($s_imports import(s)) — an imported file is not in this repository and no rule here can read it" \
    || bad "an import other than the allow-list file is present ($s_badimport of $s_imports): its contents are outside this repository and could route the dashboard"
door "$s_imp" "$s_gate" "$s_deny" \
    && ok "the status block imports the list, gates on @allowed, and its fallback is respond 4xx/5xx" \
    || bad "the status block does not positively refuse: import + handle @allowed + handle { respond 403 } is not all present (imp=$s_imp gate=$s_gate deny=$s_deny)"
# The count is also the precondition: zero routes to 18190 means the block no
# longer proxies the dashboard at all, which is a change nobody should make
# silently, and a rule that passes on zero is the class this file keeps
# rediscovering.
contained "$gate_tot" "$gate_inside" \
    && ok "every mention of 18190 in the whole file is inside status.viafrei.de's handle @allowed ($gate_inside of $gate_tot)" \
    || bad "18190 is reachable outside the gate: $gate_inside of $gate_tot mention(s) are inside handle @allowed"
# The public routes, asserted POSITIVELY: "no matcher anywhere else" would also
# be true of a file that had lost them.
awk '/^viafrei\.de, www\.viafrei\.de \{$/{f=1} f&&/reverse_proxy 127\.0\.0\.1:18180/{a=1} f&&/^\}$/{f=0} END{exit !a}' "$SRC" \
    && ok "viafrei.de still reverse-proxies 18180, unrestricted" || bad "the viafrei.de block changed"
awk '/^mcp\.viafrei\.de \{$/{f=1} f&&/reverse_proxy 127\.0\.0\.1:18187/{a=1} f&&/flush_interval -1/{b=1} f&&/^\}$/{f=0} END{exit !(a&&b)}' "$SRC" \
    && ok "mcp.viafrei.de still reverse-proxies 18187 unbuffered, unrestricted" || bad "the mcp.viafrei.de block changed"
awk '/^beaconfolio\.com, www\.beaconfolio\.com \{$/{f=1} f&&/reverse_proxy https:\/\/127\.0\.0\.1:18443/{a=1} f&&/^\}$/{f=0} END{exit !a}' "$SRC" \
    && ok "and beaconfolio.com is untouched" || bad "the beaconfolio.com block changed"

# 15. X-Forwarded-For is OVERWRITTEN, not appended. Caddy appends by default;
# the tenant's app trusts the LAST hop when the peer is loopback, so an appended
# header would let a client choose its own source address for the second layer.
awk '/^status\.viafrei\.de \{$/{f=1} f&&/header_up X-Forwarded-For \{remote_host\}/{a=1} /^\}$/{f=0} END{exit !a}' "$SRC" \
    && ok "the status block pins header_up X-Forwarded-For {remote_host}" \
    || bad "the status block does not overwrite X-Forwarded-For"

echo
echo "== 16. the gate can fail: the scan AND the verdicts, on inputs built to break them =="
# A GATE WITH NO INPUT REPORTS SUCCESS. That is this repository's single most
# repeated defect, and section 14 is exactly its shape: eighteen ticks, all read
# from ONE file that happens to be correct. A caddy_scan() that returned "all
# clear" unconditionally -- or a regex that silently matched nothing after an
# edit -- would print the same eighteen ticks and the suite would be decoration.
#
# TWO HALVES, and round 4 only had the first. The scan can be shown a bad file
# (16a-16h below). The VERDICT -- the comparison that turns numbers into a tick
# -- could not be shown anything at all while it was written inline, so
# neutering `contained()` to `[ 1 = 1 ]` left this whole section green. That is
# why the verdicts are named functions now, and why 16i hands each of them a
# losing tuple. Both halves, every run, or the ticks above are decoration.
vac_scan() { # vac_scan <file>; sets v_* in THIS shell -- no pipeline, no subshell
    read -r v_tot v_inside v_imp v_gate v_deny v_range v_heredoc v_imports \
            v_badimport v_balanced v_nonliteral v_remote v_outdeny v_forks v_forkbad \
        <<< "$(caddy_scan "$1")"
}

# (a) nothing at all. The `-ge 1` preconditions in section 14 are what make
# this red rather than a free pass, and this line is what proves they are.
: > "$TMP/vac-empty"
vac_scan "$TMP/vac-empty"
[ "$v_tot" = 0 ] && [ "$v_gate" = 0 ] && [ "$v_imp" = 0 ] && [ "$v_deny" = 0 ] && [ "$v_imports" = 0 ] \
    && ok "(a) on an EMPTY file the scan reports 0 routes, no gate, no refusal, no import" \
    || bad "(a) an empty file did not read as empty: tot=$v_tot gate=$v_gate imp=$v_imp deny=$v_deny imports=$v_imports"

# (b) THE ROUND-4 BLOCKER, verbatim: the gate's closing brace one tab deeper
# than a column rule expects, and a healthz route after it. Valid Caddy; the
# indentation means nothing to it. Every OTHER assertion is green on this file
# -- balanced, imported, gated, refusing -- so containment is the only thing
# between it and a public dashboard. Before round 4 the suite said "2 of 2".
cat > "$TMP/vac-deep" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		reverse_proxy 127.0.0.1:18190 {
			header_up Host {host}
		}
		}
	handle /healthz {
		reverse_proxy 127.0.0.1:18190
	}
	handle {
		respond 403
	}
}
VACEOF
vac_scan "$TMP/vac-deep"
[ "$v_balanced" = 1 ] && [ "$v_imp" = 1 ] && [ "$v_gate" = 1 ] && [ "$v_deny" = 1 ] \
    && ok "(b) the deep-brace fixture is otherwise impeccable: balanced, imported, gated, refusing" \
    || bad "(b) the deep-brace fixture is not the intended shape (balanced=$v_balanced imp=$v_imp gate=$v_gate deny=$v_deny)"
[ "$v_tot" = 2 ] && [ "$v_inside" = 1 ] \
    && ok "(b) and the scan still places its healthz route OUTSIDE the gate: 1 of 2, not the '2 of 2' a column rule reported" \
    || bad "(b) the deep-brace bypass is NOT caught: $v_inside of $v_tot counted inside the gate"

# (c) the port RANGE. 18189-18191 is three upstreams, one of them the
# dashboard, and no /18190/ test can ever see it.
cat > "$TMP/vac-range" <<'VACEOF'
dash.viafrei.de {
	reverse_proxy 127.0.0.1:18189-18191
}
VACEOF
vac_scan "$TMP/vac-range"
[ "$v_range" -ge 1 ] && [ "$v_tot" = 0 ] \
    && ok "(c) the range fixture is refused on sight ($v_range range(s)) though it mentions 18190 exactly $v_tot times" \
    || bad "(c) a port range was not refused: range=$v_range tot=$v_tot"

# (d) an import this repository cannot read. Its contents decide whether the
# dashboard is public, and they are not here.
cat > "$TMP/vac-import" <<'VACEOF'
viafrei.de {
	import /etc/caddy/viafrei-extra.conf
	reverse_proxy 127.0.0.1:18180
}
VACEOF
vac_scan "$TMP/vac-import"
[ "$v_badimport" = 1 ] && [ "$v_imports" = 1 ] \
    && ok "(d) a foreign import is refused ($v_badimport of $v_imports), because no rule in this repository can read the file it names" \
    || bad "(d) a foreign import was not refused: badimport=$v_badimport imports=$v_imports"

# (e) braces that do not balance. A depth model must say so rather than
# produce a confident number from arithmetic that went wrong halfway.
cat > "$TMP/vac-unbalanced" <<'VACEOF'
status.viafrei.de {
	handle @allowed {
		reverse_proxy 127.0.0.1:18190
	}
VACEOF
vac_scan "$TMP/vac-unbalanced"
[ "$v_balanced" = 0 ] \
    && ok "(e) an unbalanced file is reported as unbalanced instead of scored" \
    || bad "(e) unbalanced braces were scored as if the depth model still meant something"

# (f) THE ROUND-5 BLOCKER: the port chosen by the CALLER. Three spellings, all
# "Valid configuration" on caddy v2.11.4, none of which writes the digits.
cat > "$TMP/vac-nonliteral" <<'VACEOF'
viafrei.de {
	reverse_proxy /ops* 127.0.0.1:{http.request.header.X-Up}
	reverse_proxy /ops2* 127.0.0.1:{$EDGE_UP_PORT}
	reverse_proxy /ops3* {
		dynamic srv _ops._tcp.example
	}
	reverse_proxy 127.0.0.1:18180
}
VACEOF
vac_scan "$TMP/vac-nonliteral"
[ "$v_nonliteral" = 3 ] && [ "$v_tot" = 0 ] && [ "$v_balanced" = 1 ] \
    && ok "(f) all three non-literal upstreams are refused ($v_nonliteral), and the file names 18190 exactly $v_tot times" \
    || bad "(f) a non-literal upstream was not refused: nonliteral=$v_nonliteral tot=$v_tot balanced=$v_balanced"

# (g) THE TWIN ROUND 4 LEFT STANDING: the status block's OWN closing brace
# indented one tab -- "Valid configuration" on v2.11.4 -- with a later site
# carrying both an IP restriction and a refusal door. Under the column rule
# every "outside the status block" scanner went blind at that brace and this
# file passed 59/0. Under the depth model the later site is still outside.
cat > "$TMP/vac-twin" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		reverse_proxy 127.0.0.1:18190
	}
	handle {
		respond 403
	}
	}

probe.example {
	@deny remote_ip private_ranges
	respond 402
}
VACEOF
vac_scan "$TMP/vac-twin"
[ "$v_remote" = 1 ] && [ "$v_outdeny" = 1 ] && [ "$v_inside" = "$v_tot" ] \
    && ok "(g) an indented site brace no longer blinds the scoped rules: the later remote_ip and 402 are both seen" \
    || bad "(g) the column twin is NOT caught: remote=$v_remote outdeny=$v_outdeny ($v_inside of $v_tot gated)"

# (h) a fork with no way back: a non-status block that matches @allowed and
# has no open fallback is a door, and doors are scoped to the status block.
cat > "$TMP/vac-fork" <<'VACEOF'
probe.example {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		reverse_proxy 127.0.0.1:18180
	}
}
VACEOF
vac_scan "$TMP/vac-fork"
[ "$v_forks" = 1 ] && [ "$v_forkbad" = 1 ] \
    && ok "(h) a fork with no open fallback is counted as a door ($v_forkbad of $v_forks)" \
    || bad "(h) a fallback-less @allowed fork was not flagged: forkbad=$v_forkbad forks=$v_forks"

# (i) AND THE OTHER DIRECTION: the fixtures must not be red by construction. A
# scan that called everything a leak would pass (a)-(h) and be useless. The
# committed Caddyfile is the positive control -- green in section 14 -- and so
# is a gate whose body nests, which is the shape a matcher inside the allow
# list takes, with a quoted refusal body and a literal upstream carrying a
# scheme.
cat > "$TMP/vac-nested" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		handle /api/* {
			reverse_proxy https://127.0.0.1:18190
		}
		reverse_proxy 127.0.0.1:18190 {
			header_up Host {host}
		}
	}
	handle {
		respond "Forbidden" 403
	}
}
VACEOF
vac_scan "$TMP/vac-nested"
[ "$v_tot" = 2 ] && [ "$v_inside" = 2 ] && [ "$v_deny" = 1 ] && [ "$v_nonliteral" = 0 ] \
    && ok "(i) a nested gate stays gated (2 of 2), a quoted body is still a refusal, and a scheme is still literal — the scan is not merely pessimistic" \
    || bad "(i) a legitimate nested gate was misread: $v_inside of $v_tot inside, deny=$v_deny nonliteral=$v_nonliteral"

# (j) THE SECOND HALF, and the one round 4 was missing: the VERDICTS. Every
# tick in section 14 is a comparison, and until these six lines existed no test
# could tell a comparison that judges from one that says yes. Neuter
# `contained()` to `[ 1 = 1 ]`, or `none()` to `true`, and the suite goes red
# HERE -- which is the only reason the ticks up there mean anything.
contained 1 1 \
    && ok "(j) the containment verdict accepts 1 of 1" \
    || bad "(j) the containment verdict rejects 1 of 1 — it would reject the committed file"
contained 2 1 \
    && bad "(j) the containment verdict ACCEPTS 1 of 2: the deep-brace bypass passes on numbers alone" \
    || ok "(j) and rejects 1 of 2 — neuter it to [ 1 = 1 ] and this line goes red"
contained 0 0 \
    && bad "(j) the containment verdict ACCEPTS 0 of 0: a file that stopped proxying the dashboard at all" \
    || ok "(j) and rejects 0 of 0 — zero routes is not containment, it is a different file"
door 1 1 1 \
    && ok "(j) the door verdict accepts import + gate + refusal" \
    || bad "(j) the door verdict rejects a complete door"
door 1 1 0 \
    && bad "(j) the door verdict ACCEPTS a gate with no refusal behind it" \
    || ok "(j) and rejects a gate whose fallback does not refuse"
none 0 && none 1 \
    && bad "(j) the refusal verdict ACCEPTS 1: every 'refused on sight' rule above is decoration" \
    || ok "(j) the refusal verdicts accept 0 and reject 1"

echo
echo "== apply.sh contract: $PASS passed, $FAIL failed =="
[ "$FAIL" = "0" ]
