#!/usr/bin/env bash
# check_aiconfig_map.sh — the CLAUDE.md AI-config map must describe the tooling
# that actually exists (#246).
#
# WHY: the map (#121) is the one place a reader learns what agents/commands/
# skills/hooks/lints this repo has. Nothing kept it honest, so it could drift
# silently — a tool added without a row, a row naming a file someone deleted, an
# enabled plugin with no rationale, or a prose count ("seven skills") that stopped
# being true. Each of those misleads the next contributor, human or agent. This
# drift is not hypothetical: the `playwright` plugin duplication (#122) and two
# map edits in one afternoon are what prompted this check.
#
# Dependency-free on purpose: bash + coreutils only, same as the other repo
# lints, so it runs in the pre-push hook and in CI without a toolchain.
#
#   bash scripts/check_aiconfig_map.sh        # exit 0 = map matches reality
#
# Override the repo root with CLAUDE_PROJECT_DIR (the self-test does).
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
MAP="$ROOT/CLAUDE.md"
SETTINGS="$ROOT/.claude/settings.json"
problems=0

fail() { problems=$((problems + 1)); printf '  ✗ %s\n' "$1"; }

[ -f "$MAP" ] || { echo "✗ no CLAUDE.md at $MAP"; exit 1; }

# The map rows look like:  | agent | `backend-dev` | purpose |
# Collect the NAMES present for one kind, one per line.
map_names() { # map_names <kind>
  grep -E "^\| *$1 *\|" "$MAP" \
    | sed -E 's/^\| *[a-z]+ *\| *//; s/ *\|.*$//' \
    | tr -d '`' | sed -E 's#^scripts/##; s#^/##' | sed 's/^ *//; s/ *$//'
}

# --- 1. every real tool has a row, and every row names a real file -----------
# $1 = kind, $2 = dir, $3 = find pattern, $4 = how to turn a path into a name
check_kind() {
  kind="$1"; dir="$2"; pat="$3"; strip="$4"
  [ -d "$ROOT/$dir" ] || return 0
  rows="$(map_names "$kind")"
  # real -> map
  for f in "$ROOT/$dir"/$pat; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    case "$strip" in
      md)    name="${name%.md}" ;;
      slash) name="$(basename "$(dirname "$f")")" ;;
      keep)  ;;
    esac
    # a *.test.sh is the self-test OF a tool, not a separate tool
    case "$name" in *.test.sh) continue ;; esac
    printf '%s\n' "$rows" | grep -qxF "$name" \
      || fail "$kind '$name' exists ($dir) but has NO row in the CLAUDE.md AI-config map"
  done
  # map -> real
  printf '%s\n' "$rows" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$strip" in
      md)    target="$ROOT/$dir/$name.md" ;;
      slash) target="$ROOT/$dir/$name" ;;
      keep)  target="$ROOT/$dir/$name" ;;
    esac
    [ -e "$target" ] || printf '  ✗ %s row `%s` names a file that does not exist (%s)\n' \
      "$kind" "$name" "${target#$ROOT/}"
  done
}

echo "AI-config map vs reality:"

check_kind agent   .claude/agents   '*.md' md
check_kind command .claude/commands '*.md' md
check_kind hook    .claude/hooks    '*.sh' keep
# skills are directories; the row carries the directory name
for d in "$ROOT"/.claude/skills/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  map_names skill | grep -qxF "$name" \
    || fail "skill '$name' exists but has NO row in the AI-config map"
done
map_names skill | while IFS= read -r name; do
  [ -n "$name" ] || continue
  [ -d "$ROOT/.claude/skills/$name" ] \
    || printf '  ✗ skill row `%s` names a directory that does not exist\n' "$name"
done
# lint rows point at scripts/ (the row text carries the scripts/ prefix, stripped above)
map_names lint | while IFS= read -r name; do
  [ -n "$name" ] || continue
  [ -f "$ROOT/scripts/$name" ] \
    || printf '  ✗ lint row `%s` names a file that does not exist (scripts/%s)\n' "$name" "$name"
done

# The `while | read` subshells above cannot increment `problems`, so re-count the
# map->real misses from a single pass and fold them in.
missing_files=$( {
  map_names agent   | while IFS= read -r n; do [ -n "$n" ] && [ ! -e "$ROOT/.claude/agents/$n.md" ] && echo x; done
  map_names command | while IFS= read -r n; do [ -n "$n" ] && [ ! -e "$ROOT/.claude/commands/$n.md" ] && echo x; done
  map_names hook    | while IFS= read -r n; do [ -n "$n" ] && [ ! -e "$ROOT/.claude/hooks/$n" ] && echo x; done
  map_names skill   | while IFS= read -r n; do [ -n "$n" ] && [ ! -d "$ROOT/.claude/skills/$n" ] && echo x; done
  map_names lint    | while IFS= read -r n; do [ -n "$n" ] && [ ! -f "$ROOT/scripts/$n" ] && echo x; done
} | grep -c x )
problems=$((problems + missing_files))

# --- 2. enabled plugins: settings.json <-> map row <-> rationale prose --------
if [ -f "$SETTINGS" ]; then
  # keys look like "context7@claude-plugins-official": true — take the bare name
  enabled="$(grep -oE '"[a-z0-9-]+@[a-z0-9-]+" *: *true' "$SETTINGS" \
             | sed -E 's/"([a-z0-9-]+)@.*/\1/' | sort -u)"
  # ONLY the name column (field 3): the purpose column legitimately names
  # DROPPED plugins, which are not enabled and must not be demanded to be.
  plugin_row="$(grep -E '^\| *plugin *\|' "$MAP" | head -1 | awk -F'|' '{print $3}')"
  for p in $enabled; do
    printf '%s' "$plugin_row" | grep -qF "\`$p\`" \
      || fail "plugin '$p' is ENABLED in .claude/settings.json but is not listed in the map's plugin row"
    # a rationale line in the Plugins section: "- `name` — KEEP/DROPPED: why"
    grep -qE "^ *- +(\`[a-z0-9-]+\` */ *)*\`$p\`" "$MAP" \
      || fail "plugin '$p' is enabled but has no rationale line in the CLAUDE.md \"Plugins\" section"
  done
  # the reverse: a name in the plugin row that is not enabled anywhere
  for p in $(printf '%s' "$plugin_row" | grep -oE '`[a-z0-9-]+`' | tr -d '`'); do
    printf '%s\n' "$enabled" | grep -qxF "$p" \
      || fail "plugin '$p' is in the map's plugin row but is NOT enabled in .claude/settings.json"
  done
fi

# --- 3. prose counts must match the table --------------------------------------
# e.g. "all eight — `backend-dev`, …" or "all seven —". A stale count is exactly
# the drift this check exists for.
declare_count() { # declare_count <word> -> number
  case "$1" in
    one) echo 1;; two) echo 2;; three) echo 3;; four) echo 4;; five) echo 5;; six) echo 6;;
    seven) echo 7;; eight) echo 8;; nine) echo 9;; ten) echo 10;;
    eleven) echo 11;; twelve) echo 12;; *) echo "";;
  esac
}
check_prose_count() { # check_prose_count <regex-prefix> <kind>
  line="$(grep -oE "$1 (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)" "$MAP" | head -1)"
  [ -n "$line" ] || return 0
  word="${line##* }"
  want="$(declare_count "$word")"
  [ -n "$want" ] || return 0
  have="$(map_names "$2" | grep -c .)"
  [ "$want" -eq "$have" ] \
    || fail "CLAUDE.md prose says \"$line\" but the map lists $have $2 row(s) — one of them is stale"
}
check_prose_count '\*\*Subagents\*\* \(`\.claude/agents/`\): all' agent
check_prose_count '\*\*Skills\*\* \(`\.claude/skills/`\): all' skill
check_prose_count '\*\*Slash commands\*\* \(`\.claude/commands/`\): all' command

if [ "$problems" -eq 0 ]; then
  printf '✓ AI-config map matches reality — %s agents, %s commands, %s skills, %s hooks, %s lints\n' \
    "$(map_names agent | grep -c .)" "$(map_names command | grep -c .)" \
    "$(map_names skill | grep -c .)" "$(map_names hook | grep -c .)" "$(map_names lint | grep -c .)"
  exit 0
fi
printf '\n✗ %d AI-config map drift problem(s) — update the map in the SAME PR that changed the tooling\n' "$problems"
exit 1
