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

printf '\ncheck_aiconfig_map self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
