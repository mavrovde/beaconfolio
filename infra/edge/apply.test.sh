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

# THE SCAN. One model, read by every assertion in sections 12, 14 and 15 —
# there is no second scanner left in this file, and that is load-bearing rather
# than tidy: this section was four hand-rolled awk scanners through round 4 and
# five through round 5, and the ones nobody was looking at were the ones still
# wrong. `caddy_scan` is defined here, before the first assertion that uses it,
# and every number below comes out of this one call. (Section 17 invokes awk
# once more — to BUILD a mutant Caddyfile, not to read one. It is the only
# other awk in the file, and it answers no question about the config.)
#
# ROUND 6 — WHY IT IS A TOKENISER AND NOT A CHARACTER COUNT. Rounds 4 and 5
# counted brace CHARACTERS per line. Caddy opens a block only on a TOKEN whose
# whole text is `{`; a brace inside a larger token is ordinary text to it. So
# one unquoted token carrying a brace desynchronised the two models by a level
# and carried the gate latch across a boundary Caddy had already crossed.
# Measured on caddy v2.11.4, all three "Valid configuration", all three at
# 69 passed / 0 failed with `/healthz` reaching the dashboard from any address
# and the gate printing "2 of 2":
#
#     header X-Pad {pad     …     header X-Pad2 }pad        (a padding pair)
#     the same, plus `} dash.viafrei.de {` reopening a site on one line
#     respond /a "pad \n { pad \n " 200                     (a quoted token
#                                                            spanning LINES,
#                                                            which no per-line
#                                                            sanitiser can pair)
#
# So the line is tokenised the way Caddy tokenises it:
#   * whitespace separates tokens; `#` starts a comment only at a token start;
#   * a `"` or a backtick at a token start opens a quoted token, which MAY RUN
#     PAST THE END OF THE LINE — the `inq` flag is carried between lines, and
#     `\"` does not close it. The quotes are stripped and THE TEXT IS KEPT,
#     because that is what Caddy compares (round 7: this scanner threw the
#     text away and skipped the token, which is the inverse of the parser);
#   * a token whose text is exactly `{` or `}` moves depth, HOWEVER IT IS
#     SPELLED — bare, "quoted" or backquoted are one token to Caddy, and
#     `example.com "{"` is Valid configuration on v2.11.4 while `respond "{"
#     200` is a wrong argument count, i.e. the parser read it as structure and
#     not as an argument. Depth moves THERE AND THEN, in token order — which is
#     why `} dash.viafrei.de {` closes one site and opens another on one line,
#     instead of netting to zero the way a per-line count did. The test is
#     whole-token equality, never "contains a brace": `"closed { for now }"` is
#     one token of string and routes nothing;
#   * a token that CONTAINS a brace and is not one of those two is examined
#     WHEN IT IS UNQUOTED: if its braces balance it is a placeholder (`{host}`,
#     `{remote_host}`, `127.0.0.1:{$PORT}`) and moves nothing; if they do NOT
#     balance it is `{pad`, and the file is DECLINED. Inside a quoted token a
#     brace is string content and is not examined at all, on one line or
#     across several. Refusing to answer is the right output for input this
#     scanner cannot model — much better than a confident 69/0 on a file with
#     a public hole. An unterminated quoted token at EOF is declined too;
#     `"\{"` keeps its backslash (measured: Caddy reports the site address
#     `\{`), so the inner text is taken raw and never unescaped.
#
# That is one rule covering all three spellings and the fourth nobody thought
# of, instead of a fourth refusal pattern bolted on — which is the move this
# file has made three rounds running.
#
# HANDLED, each because Caddy behaves this way: indentation (ignored entirely —
# a closing brace with one extra tab is "Valid configuration" on v2.11.4); a
# quoted or backtick-quoted token, on one line or several; a comment tail;
# a site reopened on the same line it closed; braces that do not balance at
# EOF (reported, not guessed at).
# REFUSED rather than reasoned about, each narrow, each with a message naming
# the offending token:
#   * a brace inside an UNQUOTED token that does not balance, and an
#     unterminated quote;
#   * an upstream that is not a literal address. All of these validate on
#     v2.11.4 and route wherever they resolve, without the digits ever
#     appearing: `127.0.0.1:{http.request.header.X-Up}` (the CALLER picks the
#     port, per request), `{$ENV}`, `dynamic srv`, and a port RANGE
#     (`:18189-18191` is three upstreams). A literal is
#     `[scheme://]host[:port]`, a bracketed IPv6 `[::1]:18191`, or a
#     `unix/…` socket — the last two are valid Caddy and round 5 refused them
#     while blaming a placeholder that was not there;
#   * a heredoc (`<<`), whose body a scanner reads as configuration;
#   * an `import` of anything but the allow-list file OR a snippet defined in
#     THIS file, because only those two have contents a rule here can read. An
#     in-file `(snippet)` body is scanned by every rule in this scan, so it is
#     accepted (round 4 finding 4, open three rounds); a foreign path is not.
# DELIBERATELY REFUSED though it is legitimate Caddy, because the refusal is
# cheap and the alternative is a guess:
#   * an upstream named by a `{placeholder}` a `map` or `vars` fills in. The
#     table is in the file, but following it means re-implementing Caddy's
#     evaluation order; the message says so rather than blaming the caller.
#     The cost is bounded: `reverse_proxy` takes a literal here, and the two
#     other shapes that were refused by accident (a `respond 4xx` inside a
#     MATCHED `handle @x`/`route /x` block, and an in-file snippet import) are
#     now accepted, with fixtures (s) and (t) to keep them accepted.
# DELIBERATELY NOT HANDLED, and the reason:
#   * the port is matched on the RAW line, never on a token, so no tokeniser
#     bug and no sanitiser can hide a mention — `reverse_proxy "127.0.0.1:18190"`
#     is quoted and still counts, and so does a mention inside a multi-line
#     string. The price is that a comment TAIL naming 18190 outside the gate
#     goes red. That is the safe direction of wrong.
#   * FULL-LINE comments are still skipped for the port, because this file's
#     own prose names the port, including the paragraph you are reading. That
#     skip is the one hole left in the port rule and it is bounded: a comment
#     cannot route traffic.
#
# NOT written as `awk … | { read … }`: a pipeline runs its last stage in a
# SUBSHELL, so ok/bad would print their line and lose the counter increment —
# a red tick and exit 0. That is this file's own subject matter, from the
# shell side.
caddy_scan() { # caddy_scan <file> -> the 25 fields read by `read -r` below
    awk '
        # ---- the tokeniser: tk[1..ntok], tq[i]=1 if the token was quoted ----
        function tokenise(line,   i, c, L, start) {
            ntok = 0
            i = 1
            L = length(line)
            while (i <= L) {
                c = substr(line, i, 1)
                if (inq) {                       # a quoted token from an earlier line
                    while (i <= L) {
                        c = substr(line, i, 1)
                        if (c == "\\" && i < L) { i += 2; continue }
                        if (c == qch) { inq = 0; i++; break }
                        i++
                    }
                    if (inq) return              # the whole line is inside the quote
                    # the token STARTED on an earlier line: its text spans the
                    # newline, so it can never be the one-character token `{`.
                    ntok++; tk[ntok] = ""; tq[ntok] = 1; tml[ntok] = 1
                    continue
                }
                if (c == " " || c == "\t") { i++; continue }
                if (c == "#") return             # a comment tail is not configuration
                if (c == "\"" || c == "`") {
                    qch = c; inq = 1; i++
                    start = i
                    while (i <= L) {
                        c = substr(line, i, 1)
                        if (c == "\\" && i < L) { i += 2; continue }
                        if (c == qch) { inq = 0; i++; break }
                        i++
                    }
                    # KEEP THE TEXT. Caddy compares the TEXT of a token, and quoting
                    # does not change it: `example.com "{"` opens a block on
                    # v2.11.4. Round 6 threw this away and skipped the token,
                    # which is the exact inverse of the parser it models.
                    # Measured: "\\{" stays two characters (Caddy reports the
                    # site address `\\{`), so the inner text is taken RAW.
                    ntok++
                    tk[ntok] = (inq ? "" : substr(line, start, i - 1 - start))
                    tq[ntok] = 1; tml[ntok] = (inq ? 1 : 0)
                    if (inq) return              # unterminated: continues on the next line
                    continue
                }
                start = i
                while (i <= L) {
                    c = substr(line, i, 1)
                    if (c == " " || c == "\t") break
                    i++
                }
                ntok++; tk[ntok] = substr(line, start, i - start)
                tq[ntok] = 0; tml[ntok] = 0
            }
        }
        # 1 = a token whose TEXT is exactly `{`, 2 = one whose text is exactly
        # `}` -- HOWEVER IT IS SPELLED, bare, "quoted" or `backquoted`, because
        # that is what Caddy compares. 3 = a brace inside a longer UNQUOTED
        # token that does not balance. 0 = anything else (a placeholder, and
        # any brace inside a quoted token, which is string content).
        function brace(t,   i, c, d) {
            if (t == "{") return 1
            if (t == "}") return 2
            d = 0
            for (i = 1; i <= length(t); i++) {
                c = substr(t, i, 1)
                if (c == "{") d++
                else if (c == "}") { d--; if (d < 0) return 3 }
            }
            return (d == 0) ? 0 : 3
        }
        function literal(t) {
            if (t ~ "^unix/") return 1                                     # unix//run/x.sock
            if (t ~ "^([A-Za-z0-9+.-]+://)?\\[[0-9A-Fa-f:.]+\\](:[0-9]+)?$") return 1   # [::1]:18191
            return (t ~ "^([A-Za-z0-9+.-]+://)?[A-Za-z0-9._-]+(:[0-9]+)?$")
        }
        function matcher(i) { return (!tq[i] && (tk[i] ~ "^[/@]" || tk[i] == "*")) }
        BEGIN { depth = 0; badtoken = "-"; badbrace = "-"; mdepth = -1 }
        {
            raw = $0
            wasq = inq                     # was this line opened inside a string?
            tokenise(raw)
            d1 = (ntok >= 1 && !tq[1]) ? tk[1] : ""

            # ---- directives, read from tokens, against the CURRENT latches ----
            if (d1 == "import") {
                imports++
                if (ntok == 2 && tk[2] == "/etc/caddy/viafrei-status-allow.conf") {
                    if (site && depth == 1) imp = 1
                } else if (ntok >= 2 && !tq[2]) {
                    # an in-file SNIPPET is not an unreadable file: its body is
                    # scanned by every rule here, ten lines up. Resolved at END
                    # so that a snippet defined below its use still counts.
                    nimp++; impn[nimp] = tk[2]
                } else badimport++
            }
            doorline = 0
            if (d1 == "respond" && ntok >= 2 && !matcher(2)) {
                for (i = 2; i <= ntok; i++) if (!tq[i] && tk[i] ~ "^[45][0-9][0-9]$") doorline = 1
            }
            if (site && fb && doorline) deny = 1
            # a refusal inside a MATCHED block (`handle @hidden`, `route /x`)
            # answers that matcher, not the site; it is not a door of the kind
            # this rule looks for, exactly as an inline `respond /.env 404` is
            # not. Round 6 accepted the inline spelling and refused the block.
            if (inblk && !site && doorline && mdepth < 0) out_deny++
            for (i = 1; i <= ntok; i++) {
                if (tq[i]) continue
                if (tk[i] == "remote_ip" && inblk && !site) out_remote++
                if (tk[i] == "@allowed"  && inblk && !site) fork_seen = 1
                if (index(tk[i], "<<") > 0) heredoc++
                if (tk[i] ~ ":[0-9]+-[0-9]+") range++
            }
            if (d1 == "dynamic") { nonliteral++; if (badtoken == "-") badtoken = tk[1] }
            if (d1 == "reverse_proxy" || d1 == "to") {
                for (i = 2; i <= ntok; i++) {
                    if (!tq[i] && (tk[i] == "{" || matcher(i))) continue
                    if (tq[i] || !literal(tk[i])) {
                        nonliteral++
                        if (badtoken == "-") badtoken = tq[i] ? "<a quoted upstream>" : tk[i]
                        continue
                    }
                    if (site       && tk[i] == "127.0.0.1:18190")       status_proxy = 1
                    if (landing    && tk[i] == "127.0.0.1:18180")       pub_landing  = 1
                    if (mcp        && tk[i] == "127.0.0.1:18187")       mcp_rp       = 1
                    if (beacon     && tk[i] == "https://127.0.0.1:18443") pub_beacon = 1
                }
            }
            if (mcp && d1 == "flush_interval" && ntok == 2 && tk[2] == "-1") mcp_fl = 1
            if (site && d1 == "header_up" && ntok == 3 && tk[2] == "X-Forwarded-For" && tk[3] == "{remote_host}") xff = 1

            # ---- the port, from the RAW line, minus full-line comments ----
            if (raw !~ /^[[:space:]]*#/ && raw ~ /18190/) { tot++; if (site && ga) inside++ }

            # ---- structure, token by token, in order ----
            hdr = ""
            for (i = 1; i <= ntok; i++) {
                b = brace(tk[i])
                # inside a quoted token a brace is DATA: `respond "a { b" 200`
                # routes nothing and must not be declined (fixture o/q). But a
                # quoted token whose WHOLE text is a brace is structure, and
                # the distinction is whole-token equality, not "contains".
                if (tq[i] && b == 3) b = 0
                if (b == 3) { tokbrace++; if (badbrace == "-") badbrace = tk[i]; continue }
                if (b == 1) {
                    if (depth == 0) {
                        site    = (hdr == "status.viafrei.de")
                        landing = (hdr == "viafrei.de, www.viafrei.de")
                        mcp     = (hdr == "mcp.viafrei.de")
                        beacon  = (hdr == "beaconfolio.com, www.beaconfolio.com")
                        inblk = 1; fork_seen = 0; fork_fb = 0; ga = 0; fb = 0
                        if (hdr ~ "^\\(.+\\)$") snip[substr(hdr, 2, length(hdr) - 2)] = 1
                    } else {
                        if (mdepth < 0 && hdr ~ "^(handle|handle_path|route)[[:space:]]+[@/*]") mdepth = depth
                        if (site && depth == 1 && hdr == "handle @allowed") { ga = 1; gseen = 1; gad = depth }
                        if (site && depth == 1 && hdr == "handle")          { fb = 1; fbd = depth }
                        if (inblk && !site && depth == 1 && hdr == "handle") fork_fb = 1
                    }
                    depth++; hdr = ""; continue
                }
                if (b == 2) {
                    depth--
                    if (depth < 0) { neg = 1; depth = 0 }
                    if (mdepth >= 0 && depth <= mdepth) mdepth = -1
                    if (ga && depth <= gad) ga = 0
                    if (fb && depth <= fbd) fb = 0
                    if (depth == 0) {
                        if (inblk && fork_seen) { forks++; if (!fork_fb) forkbad++ }
                        inblk = 0; site = 0; landing = 0; mcp = 0; beacon = 0
                        ga = 0; fb = 0; fork_seen = 0; fork_fb = 0; mdepth = -1
                    }
                    hdr = ""; continue
                }
                # a token that started on an EARLIER line has no text this
                # scanner can compare, so it joins the header as `""` -- it can
                # never make `hdr` equal a header this file acts on.
                htxt = tml[i] ? "\"\"" : tk[i]
                hdr = (hdr == "" ? htxt : hdr " " htxt)
            }
        }
        END {
              for (j = 1; j <= nimp; j++) if (!(impn[j] in snip)) badimport++
              print (tot+0), (inside+0), (imp+0), (gseen+0), (deny+0), \
                    (range+0), (heredoc+0), (imports+0), (badimport+0), \
                    ((neg == 0 && depth == 0) ? 1 : 0), (nonliteral+0), \
                    (out_remote+0), (out_deny+0), (forks+0), (forkbad+0), \
                    (tokbrace+0), (inq ? 1 : 0), (status_proxy+0), (xff+0), \
                    (pub_landing+0), ((mcp_rp && mcp_fl) ? 1 : 0), (pub_beacon+0), \
                    badtoken, badbrace, 25 }' "$1"
}

# THE VERDICTS, as FUNCTIONS, and that is half of the vacuity problem. Round 4
# proved the SCAN could see a bad file; it could not prove the COMPARISON could
# reject one, because an assertion written inline is only ever tried against
# the one file in front of it — neutered to `[ 1 = 1 ]` it would pass forever.
# Named, they can be handed a losing tuple, and section 16 does that. Section
# 17 then closes the last gap: that section 14 actually feeds the scan's
# numbers INTO them, which `contained 1 1` hardcoded would satisfy just as well.
contained() { # contained <total> <inside> — every route to the port is gated
    [ "$1" -ge 1 ] && [ "$1" = "$2" ]
}
door() {      # door <imp> <gate> <deny> — the block positively refuses
    [ "$1" = 1 ] && [ "$2" = 1 ] && [ "$3" = 1 ]
}
none() {      # none <count> — the "refused on sight" verdicts
    [ "$1" = 0 ]
}
present() {   # present <flag> — a route that must still be there
    [ "$1" = 1 ]
}

read -r gate_tot gate_inside s_imp s_gate s_deny s_range s_heredoc s_imports \
        s_badimport s_balanced s_nonliteral s_remote s_outdeny s_forks s_forkbad \
        s_tokbrace s_openquote s_statusproxy s_xff s_landing s_mcp s_beacon \
        s_badtoken s_badbrace s_nfields \
    <<< "$(caddy_scan "$SRC")"
# 25 positional fields is a lot to keep in step, so the scan says how many it
# wrote and this line checks it. A field added in the middle without updating
# the reader would otherwise shift every variable after it silently.
[ "${s_nfields:-}" = 25 ] \
    && ok "the scan wrote all 25 fields the reader expects" \
    || bad "caddy_scan wrote a different number of fields (${s_nfields:-none}): every variable after the gap is shifted"

# 12. the status route exists and points at the registered tenant port
grep -q '^status\.viafrei\.de {$' "$SRC" \
    && ok "the status.viafrei.de site block exists" || bad "no status.viafrei.de site block"
present "$s_statusproxy" \
    && ok "it proxies the viafrei tenant's registered 18190" || bad "the status block does not proxy 127.0.0.1:18190"
grep -q '18190' "$HERE/ports.md" \
    && ok "18190 is registered in ports.md" || bad "18190 is not in the port registry"

# 13. the matcher is IMPORTED, never written here: the addresses are personal
# data, they change when a network does, and changing them must not be a PR.
grep -q 'import /etc/caddy/viafrei-status-allow.conf' "$SRC" \
    && ok "the allow-list is imported from a file outside this repository" \
    || bad "the status block does not import its address list"
# A NEGATIVE grep reports success in two ways that look identical from here:
# the file is clean, or the PATTERN is wrong and matches nothing anywhere. The
# second one is this whole review in miniature -- section 17 once deleted
# `respond 403` from a file that spells it `respond "Forbidden" 403`, and the
# no-op read as a pass. So every negative grep below is first shown a line it
# MUST match. A canary that goes red means the tick under it was free.
canary() { # canary <what> <pattern> <line the pattern must match>
    printf '%s\n' "$3" > "$TMP/canary"
    grep -qE "$2" "$TMP/canary" \
        && ok "canary: the $1 pattern matches the shape it hunts" \
        || bad "canary: the $1 pattern matches NOTHING, so the check under it passes on any file"
}
RX_REMOTE_IP='^[^#]*remote_ip[[:space:]]+[0-9]'
RX_MODE_0644='^#.*viafrei-status-allow\.conf.*0644'
foreign_ipv4() { # foreign_ipv4 <file> — a routable-looking IPv4 off a comment line
    grep -vE '^[[:space:]]*#' "$1" | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' \
        | grep -qv '^127\.0\.0\.1$'
}
canary "remote_ip literal" "$RX_REMOTE_IP" '	remote_ip 192.0.2.7'
grep -qE "$RX_REMOTE_IP" "$SRC" \
    && bad "an address literal follows remote_ip in the committed file" \
    || ok "no address literal follows remote_ip in the committed file"
# Any routable-looking IPv4 on a non-comment line, other than the loopback
# upstreams this whole file is built on.
printf 'reverse_proxy 192.0.2.7:18190\n' > "$TMP/canary-ip"
foreign_ipv4 "$TMP/canary-ip" \
    && ok "canary: the non-loopback sweep finds an address literal when there is one" \
    || bad "canary: the non-loopback sweep finds NOTHING in a file that is one address literal"
foreign_ipv4 "$SRC" \
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
canary "0644 in the path line" "$RX_MODE_0644" '# /etc/caddy/viafrei-status-allow.conf, 0644'
grep -qE "$RX_MODE_0644" "$SRC" \
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
# Every number below comes from the ONE caddy_scan above.
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
    && ok "every reverse_proxy upstream is a literal address ([scheme://]host[:port], [::1]:port or unix/…)" \
    || bad "$s_nonliteral upstream(s) are not a literal address (first: $s_badtoken). A placeholder, {\$ENV}, a dynamic upstream or a port range resolves somewhere this file does not say: 127.0.0.1:{http.request.header.X-Up} lets the CALLER pick the port per request, and a {placeholder} filled by a map or a vars directive is decided by a table this scanner does not follow — legitimate Caddy, still an upstream nobody reading this file can name. The gate declines to certify it rather than guess. Accepted literals: [scheme://]host[:port], a bracketed IPv6 such as [::1]:18191, and unix/… sockets"
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
none "$s_tokbrace" \
    && ok "every brace in the file is either a whole-token { or } (quoted or not) or a balanced placeholder" \
    || bad "$s_tokbrace token(s) carry a brace that does not balance (first: $s_badbrace): Caddy reads that as text and opens no block, a scanner cannot tell where the block ended, and the gate declines to certify the file rather than guess"
none "$s_openquote" \
    && ok "no quoted token is left open at end of file" \
    || bad "a quoted token is still open at end of file: everything after it is string, not configuration, and the gate declines to certify it"
contained "$gate_tot" "$gate_inside" \
    && ok "every mention of 18190 in the whole file is inside status.viafrei.de's handle @allowed ($gate_inside of $gate_tot)" \
    || bad "18190 is reachable outside the gate: $gate_inside of $gate_tot mention(s) are inside handle @allowed"
# The public routes, asserted POSITIVELY: "no matcher anywhere else" would also
# be true of a file that had lost them.
present "$s_landing" \
    && ok "viafrei.de still reverse-proxies 18180, unrestricted" || bad "the viafrei.de block changed"
present "$s_mcp" \
    && ok "mcp.viafrei.de still reverse-proxies 18187 unbuffered, unrestricted" || bad "the mcp.viafrei.de block changed"
present "$s_beacon" \
    && ok "and beaconfolio.com is untouched" || bad "the beaconfolio.com block changed"

# 15. X-Forwarded-For is OVERWRITTEN, not appended. Caddy appends by default;
# the tenant's app trusts the LAST hop when the peer is loopback, so an appended
# header would let a client choose its own source address for the second layer.
# Round 6: this one used to end the status block at a closing brace in column
# 0 and latch `a` on ANY later line, so a file with the header DELETED from the
# status block and present in an unrelated block below it printed this tick.
# A security assertion that passes on a violating file is worse than no
# assertion, because it is the one people cite. It reads the scan now, and the
# scan knows which block it is in from the token stream.
present "$s_xff" \
    && ok "the status block pins header_up X-Forwarded-For {remote_host}" \
    || bad "the status block does not overwrite X-Forwarded-For"

# Sections 16 and 17 are the suite examining ITSELF, and section 17 re-executes
# this file against mutated copies of the Caddyfile. A child run stops here: it
# is the subject, not the examiner, and recursing would fork without end.
if [ -n "${VF_EDGE_CHILD:-}" ]; then
    echo
    echo "== apply.sh contract: $PASS passed, $FAIL failed =="
    if [ "$FAIL" = "0" ]; then exit 0; else exit 1; fi
fi

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
            v_tokbrace v_openquote v_statusproxy v_xff v_landing v_mcp v_beacon \
            v_badtoken v_badbrace v_nfields \
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

# (k) THE ROUND-6 BLOCKER: an unquoted token CARRYING a brace. Caddy opens a
# block only on a token whose whole text is `{`, so `{pad` is text to it and
# `header X-Pad2 }pad` puts a character counter back in step -- while the gate
# latch has been carried across a boundary Caddy already crossed. This file is
# "Valid configuration" on v2.11.4 and served /healthz to the internet at 69/0.
cat > "$TMP/vac-token" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		header X-Pad {pad
		reverse_proxy 127.0.0.1:18190
	}
	handle /healthz {
		reverse_proxy 127.0.0.1:18190
	}
	header X-Pad2 }pad
	handle {
		respond 403
	}
}
VACEOF
vac_scan "$TMP/vac-token"
[ "$v_tokbrace" = 2 ] && [ "$v_inside" -lt "$v_tot" ] \
    && ok "(k) the token-carried braces are refused ($v_tokbrace), AND the healthz route is outside the gate anyway ($v_inside of $v_tot)" \
    || bad "(k) the token-brace bypass is NOT caught: tokbrace=$v_tokbrace, $v_inside of $v_tot inside the gate"

# (l) the same defect with no bare brace token at all: a quoted token spanning
# LINES, which no per-line sanitiser can pair. The braces inside it are string
# content and must move nothing; the structure around it must survive.
cat > "$TMP/vac-mlquote" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		respond /a "pad
		{ pad
		" 200
		reverse_proxy 127.0.0.1:18190
	}
	handle /healthz {
		reverse_proxy 127.0.0.1:18190
	}
	handle {
		respond 403
	}
}
VACEOF
vac_scan "$TMP/vac-mlquote"
[ "$v_balanced" = 1 ] && [ "$v_tokbrace" = 0 ] && [ "$v_tot" = 2 ] && [ "$v_inside" = 1 ] \
    && ok "(l) a brace inside a MULTI-LINE quoted token moves nothing, and the healthz route is still outside the gate (1 of 2)" \
    || bad "(l) the multi-line quote desynchronised the model: balanced=$v_balanced tokbrace=$v_tokbrace, $v_inside of $v_tot inside"

# (m) a quoted token nobody closed. Everything after it is string, not
# configuration, and the scan must say so rather than score it.
cat > "$TMP/vac-openquote" <<'VACEOF'
status.viafrei.de {
	respond /a "never closed
	handle {
		respond 403
	}
}
VACEOF
vac_scan "$TMP/vac-openquote"
[ "$v_openquote" = 1 ] \
    && ok "(m) an unterminated quoted token is reported, not scored" \
    || bad "(m) an unterminated quote was scored as configuration"

# (n) a site CLOSED AND REOPENED on one line. A per-line count nets this to
# zero and never notices the new block; tokens in order do notice, which is
# why depth moves at the token and not at the end of the line.
cat > "$TMP/vac-reopen" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		reverse_proxy 127.0.0.1:18190
	}
	handle {
		respond 403
	}
} dash.viafrei.de {
	reverse_proxy 127.0.0.1:18190
}
VACEOF
vac_scan "$TMP/vac-reopen"
[ "$v_tot" = 2 ] && [ "$v_inside" = 1 ] && [ "$v_balanced" = 1 ] \
    && ok "(n) a site reopened on the line that closed the last one is a SECOND block: 1 of 2, not 2 of 2" \
    || bad "(n) the one-line site reopen was misread: $v_inside of $v_tot inside, balanced=$v_balanced"

# (o) and the legitimate shapes the round-6 refusals must NOT bite: a brace
# plainly inside a string, a bracketed IPv6 literal, a unix socket. "Decline to
# certify" is only defensible while it declines things nobody writes.
cat > "$TMP/vac-legit" <<'VACEOF'
mcp.viafrei.de {
	respond /motd "welcome
	{ not a block
	" 200
	reverse_proxy 127.0.0.1:18187 {
		flush_interval -1
	}
}

other.example {
	reverse_proxy [::1]:18191
}

third.example {
	reverse_proxy unix//run/x.sock
}
VACEOF
vac_scan "$TMP/vac-legit"
[ "$v_tokbrace" = 0 ] && [ "$v_openquote" = 0 ] && [ "$v_nonliteral" = 0 ] && [ "$v_balanced" = 1 ] && [ "$v_mcp" = 1 ] \
    && ok "(o) a quoted multi-line brace, [::1]:18191 and unix//run/x.sock are all accepted — the refusals are narrow" \
    || bad "(o) a legitimate Caddyfile was refused: tokbrace=$v_tokbrace openquote=$v_openquote nonliteral=$v_nonliteral balanced=$v_balanced mcp=$v_mcp"

# (p) THE ROUND-7 BYPASS, permanent. A token whose text is `}` closes a block
# however it is spelled: caddy v2.11.4 calls `example.com "{"` a Valid
# configuration, and `respond "{" 200` a wrong argument count -- the quoted
# brace is structure to the parser, not an argument. Round 6 did the inverse
# of that: it erased a quoted token's text and skipped it before the depth
# test, so Caddy closed the gate here and the scanner did not. `handle "{"`
# then re-synchronised the two models, and the file scored 82 passed 0 failed
# with /healthz reaching the dashboard from any address.
cat > "$TMP/vac-qbrace" <<'VACEOF'
status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	handle @allowed {
		reverse_proxy 127.0.0.1:18190
		"}"
	handle /healthz {
		reverse_proxy 127.0.0.1:18190
	}
	handle "{"
	}
	handle {
		respond 403
	}
}
VACEOF
vac_scan "$TMP/vac-qbrace"
[ "$v_balanced" = 1 ] && [ "$v_tot" = 2 ] && [ "$v_inside" = 1 ] \
    && ok "(p) a QUOTED bare brace closes the gate in the model too — the healthz route is outside it ($v_inside of $v_tot)" \
    || bad "(p) the quoted-brace bypass is back: balanced=$v_balanced, $v_inside of $v_tot inside the gate"

# (q) the same file spelled with backticks, because Caddy accepts both quote
# characters and a rule written for one of them is half a rule.
sed 's/"}"/`}`/; s/handle "{"/handle `{`/' "$TMP/vac-qbrace" > "$TMP/vac-bbrace"
cmp -s "$TMP/vac-qbrace" "$TMP/vac-bbrace" \
    && bad "(q) the backtick fixture is identical to (p): the sed rewrote nothing and this case proves nothing" \
    || ok "(q) the backtick fixture really differs from the quoted one"
vac_scan "$TMP/vac-bbrace"
[ "$v_balanced" = 1 ] && [ "$v_tot" = 2 ] && [ "$v_inside" = 1 ] \
    && ok "(q) and a BACKTICK bare brace closes it too ($v_inside of $v_tot)" \
    || bad "(q) the backtick spelling bypasses the model: balanced=$v_balanced, $v_inside of $v_tot inside"

# (r) the green control for (p) and (q), and the line between them: whole-token
# equality, not "contains a brace". A brace INSIDE a larger quoted token is
# string content on one line exactly as it is across three (fixture l/o), and
# it routes nothing -- including when it does not balance.
cat > "$TMP/vac-qinside" <<'VACEOF'
mcp.viafrei.de {
	respond /motd "closed { for now }" 404
	respond /pad "a } stray" 200
	reverse_proxy 127.0.0.1:18187 {
		flush_interval -1
	}
}
VACEOF
vac_scan "$TMP/vac-qinside"
[ "$v_tokbrace" = 0 ] && [ "$v_balanced" = 1 ] && [ "$v_mcp" = 1 ] && [ "$v_outdeny" = 0 ] \
    && ok "(r) a quoted brace INSIDE a larger token still moves nothing and is not declined — both were Valid configuration on v2.11.4" \
    || bad "(r) a legitimate quoted brace was scored: tokbrace=$v_tokbrace balanced=$v_balanced mcp=$v_mcp outdeny=$v_outdeny"

# (s) a refusal that answers a MATCHER is not a site-wide door. Round 6 let the
# inline spelling (`respond /.env 404`) through and refused the same intent
# written as a named matcher plus a handle block -- valid Caddy on v2.11.4, and
# the shape the second tenant this file invites would be written in. A gate
# that refuses legitimate configs is a gate somebody switches off.
cat > "$TMP/vac-matched" <<'VACEOF'
other.example {
	@hidden path_regexp /\..*
	handle @hidden {
		respond 404
	}
	reverse_proxy 127.0.0.1:18181
}
VACEOF
vac_scan "$TMP/vac-matched"
[ "$v_outdeny" = 0 ] && [ "$v_balanced" = 1 ] \
    && ok "(s) a respond 404 inside handle @hidden is not read as a site-wide door (fixture g still proves an unmatched one is)" \
    || bad "(s) a matched refusal was read as a door: outdeny=$v_outdeny balanced=$v_balanced"

# (t) an import of a snippet DEFINED IN THIS FILE. Round 4 finding 4, open
# three rounds: the refusal says the contents are outside this repository, and
# for `import hardening` they are eight lines above it, scanned by every rule
# here. Fixture (d) is the other half -- a foreign PATH is still refused.
cat > "$TMP/vac-snippet" <<'VACEOF'
(hardening) {
	respond /.env 404
}

status.viafrei.de {
	import /etc/caddy/viafrei-status-allow.conf
	import hardening
	handle @allowed {
		reverse_proxy 127.0.0.1:18190
	}
	handle {
		respond 403
	}
}
VACEOF
vac_scan "$TMP/vac-snippet"
[ "$v_badimport" = 0 ] && [ "$v_imports" = 2 ] && [ "$v_imp" = 1 ] && [ "$v_inside" = "$v_tot" ] \
    && ok "(t) an in-file snippet import is accepted ($v_imports imports, $v_badimport unreadable) and the allow-list import is still seen" \
    || bad "(t) an in-file snippet was refused as unreadable: badimport=$v_badimport imports=$v_imports imp=$v_imp"

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
echo "== 17. the WIRING: the whole suite, run against a mutated copy of the real file =="
# THE LAST GAP, and it is a real one. Section 14 reads numbers out of
# caddy_scan and hands them to contained() / door() / none(). Section 16 proves
# the scan discriminates and proves the verdicts reject a losing tuple. Neither
# proves that section 14 passes the FORMER to the LATTER: `contained 1 1`
# written literally would satisfy every assertion in this file and still print
# 71 passed, 0 failed on a Caddyfile with a public route to the dashboard.
#
# So: copy the real infra/edge/ into a scratch directory, mutate the COPY's
# Caddyfile, and run this whole suite there as a child. The mutation is a
# routing change a reviewer would care about; the child must FAIL. And the
# unmutated copy must PASS -- without that control, "the child failed" would be
# satisfied by a child that always fails, which is the same vacuity one level up.
e17="$TMP/e17"
mkdir -p "$e17"
cp "$HERE/apply.sh" "$HERE/apply.test.sh" "$HERE/ports.md" "$e17/"
child_rc() { # child_rc -> the suite's exit code in $e17, against $e17/Caddyfile
    local rc=0
    ( cd "$e17" && VF_EDGE_CHILD=1 bash ./apply.test.sh ) >/dev/null 2>&1 || rc=$?
    echo "$rc"
}
# "THE CHILD FAILED" IS NOT THE SAME CLAIM AS "THIS MUTATION IS CAUGHT", and
# the difference is a whole finding: swap the X-Forwarded-For deletion below
# for `grep -v flush_interval` and the child still goes red -- on the mcp
# block -- while this section prints a tick about X-Forwarded-For. Checking
# that the mutation CHANGED the file (mutate, below) closes that instance and
# not the class: any mutation that trips any OTHER assertion reads the same
# from here. So each case names the assertion it expects, and a child that
# fails for a different or an additional reason is a FAILURE, not a pass.
fails_exactly() { # fails_exactly <the child ✗ lines> <expected substring>...
    local lines="$1"; shift
    local pat l hit
    [ -n "$lines" ] || return 1                   # no failure at all
    for pat in "$@"; do                           # each expected one present
        printf '%s\n' "$lines" | grep -qF "$pat" || return 1
    done
    while IFS= read -r l; do                      # and nothing else red
        [ -n "$l" ] || continue
        hit=0
        for pat in "$@"; do case "$l" in *"$pat"*) hit=1 ;; esac; done
        [ "$hit" = 1 ] || return 1
    done <<< "$lines"
    return 0
}
# ...and that judgement is shown a losing tuple too, for the same reason the
# verdicts in 16j are: neutered to `return 0` it would certify every case below.
fails_exactly "✗ alpha failed" "alpha" \
    && ok "(17v) the child verdict accepts the expected failure" \
    || bad "(17v) the child verdict rejects the expected failure — every case below would be red"
fails_exactly "✗ beta failed" "alpha" \
    && bad "(17v) the child verdict ACCEPTS a failure on a DIFFERENT assertion: the decoy above passes" \
    || ok "(17v) and rejects a child that failed on a different assertion"
fails_exactly "✗ alpha failed
✗ beta failed" "alpha" \
    && bad "(17v) the child verdict ACCEPTS an extra unexpected failure" \
    || ok "(17v) and rejects a child that failed on an ADDITIONAL assertion"
fails_exactly "" "alpha" \
    && bad "(17v) the child verdict ACCEPTS a child that printed no failure at all" \
    || ok "(17v) and rejects a child that failed on nothing"
expect_fail() { # expect_fail <desc> <expected ✗ substring>...
    local desc="$1"; shift
    local rc=0 out x
    out="$( cd "$e17" && VF_EDGE_CHILD=1 bash ./apply.test.sh 2>&1 )" || rc=$?
    x="$(printf '%s\n' "$out" | grep '✗' | sed 's/^[[:space:]]*//' || true)"
    if [ "$rc" = 0 ]; then
        bad "$desc — but the child suite PASSED: nothing in it is wired to this mutation"
    elif fails_exactly "$x" "$@"; then
        ok "$desc"
    else
        bad "$desc — but the child failed on something else: $(printf '%s' "$x" | tr '\n' '|')"
    fi
}
# EVERY mutation is checked for having HAPPENED. The first draft of this
# section deleted the fallback's refusal with `grep -v 'respond 403'`, which
# matches nothing in a file whose refusal is spelled `respond "Forbidden" 403`
# -- a legitimate variant this suite green-lights elsewhere. The mutation
# became a no-op, the child passed, and the case reported that a bad file had
# been accepted. A fixture that silently does nothing is the same defect as a
# gate that reads nothing: it reports about work it never did.
mutate() { # mutate <desc> <candidate-file> -> 0 only if it differs from $SRC
    cp "$2" "$e17/Caddyfile"
    if cmp -s "$SRC" "$e17/Caddyfile"; then
        bad "$1: the MUTATION CHANGED NOTHING, so this case proves nothing"
        return 1
    fi
    return 0
}

cp "$SRC" "$e17/Caddyfile"
[ "$(child_rc)" = 0 ] \
    && ok "the control passes: an UNMUTATED copy of the real file is green as a child" \
    || bad "the control FAILS: the child suite is red on the committed Caddyfile, so every mutation below would 'fail' for free"

{ cat "$SRC"; printf '\ndash.example {\n\treverse_proxy 127.0.0.1:18190\n}\n'; } > "$TMP/m17"
if mutate "a public second route to 18190" "$TMP/m17"; then
    expect_fail "a public second route to 18190 fails end to end, on the CONTAINMENT assertion and only that one" \
        "18190 is reachable outside the gate"
fi

awk '{ print } /handle @allowed \{$/ { print "\t\theader X-Pad {pad" }' "$SRC" > "$TMP/m17"
if mutate "a token-carried brace" "$TMP/m17"; then
    expect_fail "a token-carried brace fails end to end, on the UNBALANCED-TOKEN refusal" \
        "token(s) carry a brace that does not balance"
fi

# the round-7 bypass, end to end: Caddy closes handle @allowed on the quoted
# brace and opens a block on `handle "{"`, so /healthz is a public sibling
# route to the dashboard while the braces still balance and the file still
# validates. Until this round the whole suite printed 82 passed, 0 failed.
awk '{ print }
     /handle @allowed \{$/ {
         print "\t\t\"}\""
         print "\thandle /healthz {"
         print "\t\treverse_proxy 127.0.0.1:18190"
         print "\t}"
         print "\thandle \"{\""
     }' "$SRC" > "$TMP/m17"
if mutate "a QUOTED bare brace" "$TMP/m17"; then
    expect_fail "a quoted bare brace fails end to end, on the CONTAINMENT assertion" \
        "18190 is reachable outside the gate"
fi

grep -v 'header_up X-Forwarded-For' "$SRC" > "$TMP/m17"
if mutate "X-Forwarded-For deleted from the status block" "$TMP/m17"; then
    expect_fail "deleting X-Forwarded-For fails end to end, on the X-FORWARDED-FOR assertion — not on some other tick" \
        "the status block does not overwrite X-Forwarded-For"
fi

grep -vE 'respond[[:space:]].*[45][0-9][0-9]' "$SRC" > "$TMP/m17"
if mutate "the fallback's refusal deleted" "$TMP/m17"; then
    expect_fail "deleting the fallback refusal fails end to end, on the DOOR assertion (door is WIRED to the scan)" \
        "the status block does not positively refuse"
fi

# and the decoy that exposed the defect: a mutation of something ELSE must not
# be readable as any of the above. It is caught, by its own assertion.
grep -v 'flush_interval' "$SRC" > "$TMP/m17"
if mutate "flush_interval deleted from the mcp block" "$TMP/m17"; then
    expect_fail "deleting flush_interval fails end to end on the MCP assertion — no other tick claims it" \
        "the mcp.viafrei.de block changed"
fi

echo
echo "== apply.sh contract: $PASS passed, $FAIL failed =="
[ "$FAIL" = "0" ]
