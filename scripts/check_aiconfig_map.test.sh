#!/usr/bin/env bash
# Self-test for scripts/check_aiconfig_map.sh (#246).
#
# The point is the FAILING-FIRST cases: a drift check that only ever reports OK
# is indistinguishable from one that cannot fail (lessons §16/§18). Every case
# builds a throwaway .claude/ skeleton + CLAUDE.md in a temp dir, points the
# checker at it with CLAUDE_PROJECT_DIR, and asserts the exit code AND that the
# message names the drifted thing.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check_aiconfig_map.sh"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n     %s\n' "$1" "$2"; }

# A minimal repo whose map and filesystem AGREE. Cases then perturb one side.
skeleton() { # skeleton <dir>
  d="$1"
  mkdir -p "$d/.claude/agents" "$d/.claude/commands" "$d/.claude/hooks" \
           "$d/.claude/skills/demo-skill" "$d/scripts"
  : > "$d/.claude/agents/backend-dev.md"
  : > "$d/.claude/commands/verify.md"
  : > "$d/.claude/hooks/pre-push-tests.sh"
  : > "$d/.claude/skills/demo-skill/SKILL.md"
  : > "$d/scripts/check_demo.sh"
  cat > "$d/.claude/settings.json" <<'JSON'
{ "enabledPlugins": { "context7@claude-plugins-official": true } }
JSON
  cat > "$d/.mcp.json" <<'JSON'
{ "mcpServers": { "postgres": {}, "github": {} } }
JSON
  cat > "$d/CLAUDE.md" <<'MD'
# CLAUDE.md — demo

| Kind | Name | Purpose |
|---|---|---|
| agent | `backend-dev` | backend work |
| command | `/verify` | local gates |
| skill | `demo-skill` | a demo |
| hook | `pre-push-tests.sh` | gates before push |
| lint | `scripts/check_demo.sh` | a demo lint |
| plugin | `context7` | live docs |
| MCP | `postgres`, `github` | demo servers |

- **Subagents** (`.claude/agents/`): all one — `backend-dev`.

## Plugins
  - `context7` — KEEP: live library docs.
MD
}

run() { CLAUDE_PROJECT_DIR="$1" bash "$SCRIPT" 2>&1; }

echo "== AI-config map drift check self-test =="

# --- 1. CONTROL: an agreeing repo passes. If this fails nothing below means anything.
d="$(mktemp -d)"; skeleton "$d"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "an agreeing map passes" || bad "control" "rc=$rc; $out"
rm -rf "$d"

# --- 2. FAILING FIRST: a tool on disk with no row (the #246 shape) -----------
d="$(mktemp -d)"; skeleton "$d"; : > "$d/.claude/agents/ghost-agent.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "ghost-agent"; then
  ok "an agent with no map row FAILS, and is named"
else bad "undocumented agent" "rc=$rc; $out"; fi
rm -rf "$d"

# same for each other kind — one missing row must never slip through
for kind in "commands/ghost-cmd.md:ghost-cmd" "hooks/ghost-hook.sh:ghost-hook.sh"; do
  path="${kind%%:*}"; name="${kind##*:}"
  d="$(mktemp -d)"; skeleton "$d"; : > "$d/.claude/$path"
  out="$(run "$d")"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "$name"; then
    ok "an undocumented $name FAILS"
  else bad "undocumented $name" "rc=$rc; $out"; fi
  rm -rf "$d"
done
d="$(mktemp -d)"; skeleton "$d"; mkdir -p "$d/.claude/skills/ghost-skill"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "ghost-skill"; then
  ok "an undocumented skill FAILS"
else bad "undocumented skill" "rc=$rc; $out"; fi
rm -rf "$d"

# --- 3. FAILING FIRST: a row naming a file that no longer exists -------------
d="$(mktemp -d)"; skeleton "$d"; rm "$d/.claude/agents/backend-dev.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "backend-dev"; then
  ok "a row naming a deleted file FAILS"
else bad "stale row" "rc=$rc; $out"; fi
rm -rf "$d"

d="$(mktemp -d)"; skeleton "$d"; rm "$d/scripts/check_demo.sh"
out="$(run "$d")"; rc=$?
[ "$rc" -ne 0 ] && ok "a lint row naming a deleted script FAILS" \
  || bad "stale lint row" "rc=$rc; $out"
rm -rf "$d"

# --- 4. Plugins, BOTH directions (the #122 duplication shape) ----------------
d="$(mktemp -d)"; skeleton "$d"
cat > "$d/.claude/settings.json" <<'JSON'
{ "enabledPlugins": { "context7@claude-plugins-official": true,
                      "playwright@claude-plugins-official": true } }
JSON
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "playwright"; then
  ok "an ENABLED plugin missing from the map FAILS"
else bad "enabled-but-unlisted plugin" "rc=$rc; $out"; fi
rm -rf "$d"

d="$(mktemp -d)"; skeleton "$d"
sed -i.bak 's/| plugin | `context7` |/| plugin | `context7`, `dropped-one` |/' "$d/CLAUDE.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "dropped-one"; then
  ok "a listed plugin that is NOT enabled FAILS"
else bad "listed-but-disabled plugin" "rc=$rc; $out"; fi
rm -rf "$d"

# An enabled plugin with a row but NO rationale paragraph.
d="$(mktemp -d)"; skeleton "$d"
sed -i.bak '/KEEP: live library docs/d' "$d/CLAUDE.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi "rationale"; then
  ok "an enabled plugin with no rationale line FAILS"
else bad "missing rationale" "rc=$rc; $out"; fi
rm -rf "$d"

# The real CLAUDE.md pairs two plugins on ONE rationale line
# ("- `pyright-lsp` / `typescript-lsp` — KEEP: …"); that must still count.
d="$(mktemp -d)"; skeleton "$d"
cat > "$d/.claude/settings.json" <<'JSON'
{ "enabledPlugins": { "context7@claude-plugins-official": true,
                      "typescript-lsp@claude-plugins-official": true } }
JSON
sed -i.bak 's/| plugin | `context7` |/| plugin | `context7`, `typescript-lsp` |/' "$d/CLAUDE.md"
printf '  - `pyright-lsp` / `typescript-lsp` — KEEP: type errors.\n' >> "$d/CLAUDE.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "a SHARED rationale line counts for both plugins" \
  || bad "shared rationale line" "rc=$rc; $out"
rm -rf "$d"

# --- 5. FAILING FIRST: a stale prose count -----------------------------------
d="$(mktemp -d)"; skeleton "$d"
: > "$d/.claude/agents/second-agent.md"
sed -i.bak 's/| agent | `backend-dev` | backend work |/| agent | `backend-dev` | backend work |\n| agent | `second-agent` | more work |/' "$d/CLAUDE.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi "stale"; then
  ok "prose \"all one\" against 2 agent rows FAILS"
else bad "stale prose count" "rc=$rc; $out"; fi
rm -rf "$d"

# --- 6. THE LINT CATEGORY MUST FAIL TOO (review finding) ---------------------
#     The first version had no real->map direction for lints, so the whole
#     category could not fail: a new scripts/ lint with no row passed, and
#     deleting EVERY lint row still printed "✓ … 0 lints". It was hiding live
#     drift (`check_no_pii.sh` had no row). A check that cannot fail is worse
#     than no check, because it reports success.
d="$(mktemp -d)"; skeleton "$d"; : > "$d/scripts/check_ghost.sh"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "check_ghost.sh"; then
  ok "a scripts/ lint with no map row FAILS"
else bad "undocumented lint" "rc=$rc; $out"; fi
rm -rf "$d"

d="$(mktemp -d)"; skeleton "$d"
sed -i.bak '/| lint |/d' "$d/CLAUDE.md"
out="$(run "$d")"; rc=$?
[ "$rc" -ne 0 ] && ok "deleting ALL lint rows FAILS (it used to pass)" \
  || bad "all lint rows deleted" "rc=$rc; $out"
rm -rf "$d"

# a *.test.sh beside a lint is that lint's self-test, not a lint of its own
d="$(mktemp -d)"; skeleton "$d"; : > "$d/scripts/check_demo.test.sh"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "a lint's *.test.sh needs no row of its own" \
  || bad "test.sh treated as a lint" "rc=$rc; $out"
rm -rf "$d"

# --- 7. A skill is its SKILL.md, not an empty directory ----------------------
d="$(mktemp -d)"; skeleton "$d"; rm "$d/.claude/skills/demo-skill/SKILL.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi "SKILL.md"; then
  ok "a skill directory with no SKILL.md FAILS"
else bad "empty skill dir" "rc=$rc; $out"; fi
rm -rf "$d"

# --- 8. A plugin listed twice is drift ---------------------------------------
d="$(mktemp -d)"; skeleton "$d"
sed -i.bak 's/| plugin | `context7` |/| plugin | `context7`, `context7` |/' "$d/CLAUDE.md"
out="$(run "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi "MORE THAN ONCE"; then
  ok "a plugin listed twice FAILS"
else bad "duplicate plugin" "rc=$rc; $out"; fi
rm -rf "$d"


# --- #378: the MCP category must be able to fail ----------------------------
D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| MCP | `postgres`, `github` | demo servers |\n", ""))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "NO | MCP | row"; then
  ok "#378: deleting the | MCP | row FAILS (the category can fail now)"
else bad "#378: deleting the MCP row must fail" "rc=$rc $out"; fi
rm -rf "$D"

D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("`postgres`, `github`", "`postgres`"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "MCP server 'github' is in .mcp.json but not"; then
  ok "#378: a server in .mcp.json with no row entry FAILS"
else bad "#378: server-without-row must fail" "rc=$rc $out"; fi
rm -rf "$D"

D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("`postgres`, `github`", "`postgres`, `github`, `ghost`"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "MCP server 'ghost' is in the map's MCP row but not"; then
  ok "#378: a row entry naming a server absent from .mcp.json FAILS"
else bad "#378: row-without-server must fail" "rc=$rc $out"; fi
rm -rf "$D"

# --- #378: a non-.sh tool in scripts/ needs a row ---------------------------
D="$(mktemp -d)"; skeleton "$D"
: > "$D/scripts/sneaky_tool.py"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "sneaky_tool.py"; then
  ok "#378: a rowless scripts/*.py FAILS (the sweep sees every extension)"
else bad "#378: a rowless .py tool must fail" "rc=$rc $out"; fi
rm -rf "$D"

# a `tooling` row satisfies the sweep (the real map distinguishes gates from helpers)
D="$(mktemp -d)"; skeleton "$D"
: > "$D/scripts/helper_tool.py"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| plugin | `context7` | live docs |",
  "| tooling | `scripts/helper_tool.py` | a helper |\n| plugin | `context7` | live docs |"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -eq 0 ]; then ok "#378: a kind-tooling row satisfies the scripts/ sweep"
else bad "#378: a tooling row must satisfy the sweep" "rc=$rc $out"; fi
rm -rf "$D"

# --- #378: the two formerly tolerant parses now fail ------------------------
D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| lint | `scripts/check_demo.sh` |", "| lint | `check_demo.sh` |"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "does not carry the scripts/ prefix"; then
  ok "#378: a lint row without the scripts/ prefix FAILS"
else bad "#378: prefixless lint row must fail" "rc=$rc $out"; fi
rm -rf "$D"

D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| hook | `pre-push-tests.sh` |", "| hook | `/pre-push-tests.sh` |"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "starts with '/'"; then
  ok "#378: a hook row with a leading / FAILS"
else bad "#378: leading-/ hook row must fail" "rc=$rc $out"; fi
rm -rf "$D"

# --- #400 review round 1: the fix's own holes -------------------------------
# The blocker: `\`` inside a single-quoted ERE is a LITERAL backtick to BSD grep
# and the START-OF-BUFFER ANCHOR to GNU grep, so the reverse-MCP loop matched
# nothing on the Linux runner and that category could not fail there. The case
# below cannot see the platform difference (it runs on one grep), so pin the
# cause instead: no single-quoted ERE in the checker may contain `\``.
# The sequence backslash-backtick must appear NOWHERE in the checker. Round 2
# measured four ways around a narrower "only after -oE" regex (grep -qE,
# grep -o -E, sed -E, a pattern held in a variable), and a check whose regex is
# narrower than its promise is itself a cannot-fail check. Parsing shell quoting
# to find the risky ones is worse than the disease — an apostrophe in a comment
# breaks the parse. So the checker holds its backtick in $BT instead, there is
# no escape anywhere in it, and this becomes a fixed-string search that cannot
# be argued with (#400 r2).
if LC_ALL=C grep -qF '\`' "$SCRIPT"; then
  bad "#400: the checker contains backslash-backtick — under GNU grep that is the start-of-buffer anchor, so the pattern matches nothing" "$(LC_ALL=C grep -nF '\`' "$SCRIPT")"
else ok "#400: backslash-backtick appears nowhere in the checker (it uses \$BT)"; fi

# The lint promises bash+coreutils in four committed places; a broken or absent
# jq must therefore change nothing. A stub that always fails stands in for
# "jq is not installed here".
D="$(mktemp -d)"; skeleton "$D"
mkdir -p "$D/fakebin"
printf '#!/bin/sh\nexit 127\n' > "$D/fakebin/jq"; chmod +x "$D/fakebin/jq"
out="$(PATH="$D/fakebin:$PATH" CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -eq 0 ]; then ok "#400: a broken/absent jq changes nothing (the lint is dependency-free)"
else bad "#400: the lint must not need jq" "rc=$rc $out"; fi
rm -rf "$D"

# `tooling` satisfies the scripts/ sweep, so it is load-bearing and needs the
# map->real direction too.
D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| plugin | `context7` | live docs |",
  "| tooling | `scripts/ghost_helper.py` | a helper nobody wrote |\n| plugin | `context7` | live docs |"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "ghost_helper.py"; then
  ok "#400: a tooling row naming a nonexistent file FAILS"
else bad "#400: tooling row -> real file must be checked" "rc=$rc $out"; fi
rm -rf "$D"

D="$(mktemp -d)"; skeleton "$D"
: > "$D/scripts/helper_tool.py"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| plugin | `context7` | live docs |",
  "| tooling | `helper_tool.py` | a helper |\n| plugin | `context7` | live docs |"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "does not carry the scripts/ prefix"; then
  ok "#400: a tooling row without the scripts/ prefix FAILS"
else bad "#400: prefixless tooling row must fail" "rc=$rc $out"; fi
rm -rf "$D"

D="$(mktemp -d)"; skeleton "$D"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("`postgres`, `github`", "`postgres`, `github`, `postgres`"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "listed MORE THAN ONCE in the map's MCP row"; then
  ok "#400: a server listed twice in the MCP row FAILS"
else bad "#400: duplicate MCP entry must fail" "rc=$rc $out"; fi
rm -rf "$D"

# The awk .mcp.json walk must not depend on indentation — same servers, minified.
D="$(mktemp -d)"; skeleton "$D"
printf '{"mcpServers":{"postgres":{"command":"npx","args":["-y","x"]},"github":{"env":{"T":"${T}"}}}}\n' > "$D/.mcp.json"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -eq 0 ]; then ok "#400: the .mcp.json walk is indentation-independent (minified JSON parses)"
else bad "#400: minified .mcp.json must parse the same" "rc=$rc $out"; fi
rm -rf "$D"

# …and a NESTED object must not be mistaken for a server (github's "env" here).
D="$(mktemp -d)"; skeleton "$D"
printf '{"mcpServers":{"postgres":{},"github":{"env":{"TOKEN":"x"}}}}\n' > "$D/.mcp.json"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -eq 0 ] && ! printf '%s' "$out" | grep -q "'env'"; then
  ok "#400: a nested object inside a server is not read as a server"
else bad "#400: nested objects must not become servers" "rc=$rc $out"; fi
rm -rf "$D"

# Deleting .mcp.json must not make the MCP row UNINSPECTED (#400 r2 finding 1).
D="$(mktemp -d)"; skeleton "$D"
rm -f "$D/.mcp.json"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "NO .mcp.json"; then
  ok "#400: an MCP row with no .mcp.json at all FAILS (the file cannot be deleted into silence)"
else bad "#400: deleting .mcp.json must not skip the MCP row" "rc=$rc $out"; fi
rm -rf "$D"

# …and with neither the file nor the row, there is nothing to disagree about.
D="$(mktemp -d)"; skeleton "$D"
rm -f "$D/.mcp.json"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("| MCP | `postgres`, `github` | demo servers |\n", ""))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -eq 0 ]; then ok "#400: no .mcp.json and no MCP row is consistent, not an error"
else bad "#400: absent file + absent row must pass" "rc=$rc $out"; fi
rm -rf "$D"

# A server whose value is not an object must fail CLOSED, not vanish silently.
D="$(mktemp -d)"; skeleton "$D"
printf '{"mcpServers":{"postgres":{},"github":"oops"}}\n' > "$D/.mcp.json"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "whose value is not an object"; then
  ok "#400: a non-object server value FAILS CLOSED (it is not dropped in silence)"
else bad "#400: a non-object server value must fail closed" "rc=$rc $out"; fi
rm -rf "$D"

# An ARRAY value is not a server object (#400 r3 nit).
D="$(mktemp -d)"; skeleton "$D"
printf '{"mcpServers":{"postgres":{},"github":[]}}\n' > "$D/.mcp.json"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "whose value is not an object"; then
  ok "#400: an ARRAY server value FAILS CLOSED (it is not counted as an object)"
else bad "#400: an array server value must fail closed" "rc=$rc $out"; fi
rm -rf "$D"

# The malformed signal travels by EXIT STATUS, so no server name can forge it.
D="$(mktemp -d)"; skeleton "$D"
printf '{"mcpServers":{"postgres":{},"__MALFORMED__":{}}}\n' > "$D/.mcp.json"
python3 - "$D/CLAUDE.md" <<'PY2'
import sys
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("`postgres`, `github`", "`postgres`, `__MALFORMED__`"))
PY2
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -eq 0 ]; then ok "#400: a server named __MALFORMED__ cannot forge the error channel"
else bad "#400: the malformed signal must not be forgeable by a server name" "rc=$rc $out"; fi
rm -rf "$D"

# mcpServers itself as an array is not silently 'no servers'.
D="$(mktemp -d)"; skeleton "$D"
printf '{"mcpServers":[{"postgres":{}}]}\n' > "$D/.mcp.json"
out="$(CLAUDE_PROJECT_DIR="$D" bash "$SCRIPT" 2>&1)"; rc=$?
if [ $rc -ne 0 ]; then ok "#400: mcpServers as an ARRAY fails (not read as zero servers)"
else bad "#400: mcpServers as an array must fail" "rc=$rc $out"; fi
rm -rf "$D"

printf '\ncheck_aiconfig_map self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
