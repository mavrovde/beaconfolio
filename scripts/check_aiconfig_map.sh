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
# A literal backtick, held in a variable. The map's name column is written
# in backticks, so nearly every pattern here needs one — and writing it as
# backslash-backtick is the trap this file already fell into once: harmless
# inside double quotes, but inside SINGLE quotes GNU grep reads that
# two-character sequence as its start-of-buffer anchor while BSD grep reads a
# literal, so the pattern matches nothing on Linux and the check silently
# cannot fail (#400). With BT there is no escape to get wrong, and the
# self-test can simply assert the sequence appears NOWHERE in this file.
BT='`'

fail() { problems=$((problems + 1)); printf '  ✗ %s\n' "$1"; }

[ -f "$MAP" ] || { echo "✗ no CLAUDE.md at $MAP"; exit 1; }

# The map rows look like:  | agent | `backend-dev` | purpose |
# Collect the NAMES present for one kind, one per line.
map_names() { # map_names <kind>
  # [A-Za-z]+ , not [a-z]+ : the `| MCP |` row is uppercase, and the
  # lowercase-only pattern made the whole MCP category INVISIBLE — deleting
  # the row passed, which is this checker's own defect class (#378; the #367
  # reviewer measured 0 problems from wholesale MCP-row deletion while every
  # other category showed several).
  grep -E "^\| *$1 *\|" "$MAP" \
    | sed -E 's/^\| *[A-Za-z]+ *\| *//; s/ *\|.*$//' \
    | tr -d '`' | sed -E 's#^scripts/##; s#^/##' | sed 's/^ *//; s/ *$//'
}

# The two formerly TOLERANT parses, now checked (#378): a lint row missing its
# `scripts/` prefix and a hook row with a leading `/` both used to normalise
# away silently. Tolerance in a drift checker is drift.
grep -E '^\| *(lint|tooling) *\|' "$MAP" | grep -vE '^\| *(lint|tooling) *\| *`scripts/' \
  | while IFS= read -r r; do [ -n "$r" ] && echo x; done | grep -q x \
  && fail "a lint/tooling row does not carry the scripts/ prefix — write the path the file actually has"
# command rows legitimately start with '/' (slash commands); hooks and the
# rest must not.
grep -E '^\| *(hook|agent|skill) *\| *`/' "$MAP" >/dev/null \
  && fail "a hook/agent/skill row name starts with '/' — write the bare filename"

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
  # A skill is its SKILL.md, not its directory: an empty directory left behind
  # by a deleted skill would otherwise satisfy the row (review finding).
  if [ ! -d "$ROOT/.claude/skills/$name" ]; then
    printf '  ✗ skill row `%s` names a directory that does not exist\n' "$name"
  elif [ ! -f "$ROOT/.claude/skills/$name/SKILL.md" ]; then
    printf '  ✗ skill row `%s` has a directory but NO SKILL.md — the skill is not loadable\n' "$name"
  fi
done
# lint rows point at scripts/ (the row text carries the scripts/ prefix, stripped above)
map_names lint | while IFS= read -r name; do
  [ -n "$name" ] || continue
  [ -f "$ROOT/scripts/$name" ] \
    || printf '  ✗ lint row `%s` names a file that does not exist (scripts/%s)\n' "$name" "$name"
done
# `tooling` rows satisfy the scripts/ sweep below, which makes them LOAD-BEARING
# — so they need the same map->real check, or a `| tooling | scripts/ghost.py |`
# row for a file nobody wrote passes clean (#400 review, round 1).
map_names tooling | while IFS= read -r name; do
  [ -n "$name" ] || continue
  [ -f "$ROOT/scripts/$name" ] \
    || printf '  ✗ tooling row `%s` names a file that does not exist (scripts/%s)\n' "$name" "$name"
done
# …and the REAL -> MAP direction for lints, which the first version omitted.
# Without it the whole lint category could not fail: a new `scripts/` lint with
# no row passed, and deleting ALL five lint rows still printed "✓ … 0 lints".
# Found by review, and it was hiding LIVE drift — `check_no_pii.sh` runs in the
# pre-push gate and in deploy.yml and had no row at all. A check that cannot
# fail is worse than no check, because it reports success.
#
# What needs a row here: EVERY regular file in scripts/ that is not itself a
# self-test (`*.test.sh` belongs to the tool it tests) and not a named build
# helper — any extension, not just `*.sh`. The exclusions are named, not
# pattern-guessed, so adding a file to scripts/ forces a decision (give it a
# `lint` or `tooling` row, or add it here with a reason) rather than silently
# slipping into an ignore rule. That is deliberate and it does mean a data file
# dropped into scripts/ reds the gate until someone accounts for it: scripts/ is
# the repo-contract toolbox, not a scratch directory.
# EVERY file in scripts/, not just *.sh (#378): the old glob meant a .py or
# .mjs tool needed no row — and scripts/dedup_changelog_unreleased.py was
# already such a file, invisible to this sweep, one extension away from the
# original whole-category hole.
for f in "$ROOT"/scripts/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  case "$name" in
    *.test.sh) continue ;;                 # a self-test, not a lint
    make-social-image.sh) continue ;;      # asset generator, not a repo-contract lint
    *.pyc) continue ;;                     # build output; __pycache__ is a dir, filtered by -f
  esac
  # a row of kind `lint` OR `tooling` satisfies the sweep — the map deliberately
  # distinguishes gates from helpers, and both are rows that must exist.
  { map_names lint; map_names tooling; } | grep -qxF "$name" \
    || fail "'scripts/$name' exists but has NO lint/tooling row in the CLAUDE.md AI-config map"
done

# The `while | read` subshells above cannot increment `problems`, so re-count the
# map->real misses from a single pass and fold them in.
missing_files=$( {
  map_names agent   | while IFS= read -r n; do [ -n "$n" ] && [ ! -e "$ROOT/.claude/agents/$n.md" ] && echo x; done
  map_names command | while IFS= read -r n; do [ -n "$n" ] && [ ! -e "$ROOT/.claude/commands/$n.md" ] && echo x; done
  map_names hook    | while IFS= read -r n; do [ -n "$n" ] && [ ! -e "$ROOT/.claude/hooks/$n" ] && echo x; done
  map_names skill   | while IFS= read -r n; do [ -n "$n" ] && { [ ! -d "$ROOT/.claude/skills/$n" ] || [ ! -f "$ROOT/.claude/skills/$n/SKILL.md" ]; } && echo x; done
  map_names lint    | while IFS= read -r n; do [ -n "$n" ] && [ ! -f "$ROOT/scripts/$n" ] && echo x; done
  map_names tooling | while IFS= read -r n; do [ -n "$n" ] && [ ! -f "$ROOT/scripts/$n" ] && echo x; done
} | grep -c x )
problems=$((problems + missing_files))

# --- 1b. MCP servers: .mcp.json <-> map row (#378) ---------------------------
MCPJSON="$ROOT/.mcp.json"
if [ -f "$MCPJSON" ]; then
  # Dependency-free on purpose (the header, verify_all.sh, the pre-push hook and
  # deploy.yml all promise bash+coreutils): walk the JSON with awk rather than
  # reaching for jq. Measured jq-less, the jq version failed CLOSED and printed
  # three bogus "map drift" errors — a lint that cries wolf gets ignored.
  # Depth-tracking, string-aware, so it does not depend on indentation: emit the
  # keys that open an object exactly one level inside "mcpServers".
  mcp_real="$(awk '
    BEGIN { depth = 0; instr = 0; inservers = 0; lastkey = ""; nkeys = 0; nsrv = 0 }
    {
      n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (instr) {
          if (c == "\\") { i++; continue }
          if (c == "\"") {
            instr = 0; lastkey = buf
            # A string in KEY position directly inside mcpServers names a
            # server, whatever its value turns out to be. Counting these
            # separately from the objects actually opened is what stops a
            # non-object value ("github": "oops") being dropped in silence —
            # the counts then disagree and the walk fails CLOSED (#400 r2).
            if (inservers && depth == sdepth && expectkey) { nkeys++; expectkey = 0 }
            continue
          }
          buf = buf c; continue
        }
        if (c == "\"") { instr = 1; buf = ""; continue }
        if (c == "{" || c == "[") {
          depth++
          # Only a BRACE opens mcpServers or a server. An array VALUE
          # ("github": []) is not a server object, so the key/object counts
          # disagree and the walk fails closed (#400 r3).
          if (!inservers && lastkey == "mcpServers") {
            if (c == "{") { inservers = 1; sdepth = depth; expectkey = 1 }
            # …and mcpServers itself being an ARRAY is its own malformation.
            # Round 3 made the brace-only test skip the bracket and then latch
            # onto the first inner object, turning a fail-closed into a SILENT
            # PASS — a regression introduced by the fix for the nit above
            # (#400 r4). Flagging it here is what keeps it loud.
            else badservers = 1
          }
          else if (inservers && depth == sdepth + 1 && c == "{") { print lastkey; nsrv++ }
          # A key is consumed by the brace it opens; leaving it set let a stale
          # key latch onto an unrelated later brace.
          lastkey = ""
          continue
        }
        if (c == "}" || c == "]") {
          if (inservers && depth == sdepth) inservers = 0
          depth--; continue
        }
        if (c == "," && inservers && depth == sdepth) { expectkey = 1; continue }
      }
    }
    END { if (nkeys != nsrv || badservers) exit 3 }
  ' "$MCPJSON")"; awk_rc=$?
  mcp_real="$(printf '%s' "$mcp_real" | sort)"
  # Signalled by EXIT STATUS, not by a sentinel line: an in-band marker can be
  # forged by a server literally named after it, and "a value that collides with
  # the error channel" is the same cannot-fail family this PR is closing (#400 r3).
  if [ "$awk_rc" -eq 3 ]; then
    fail ".mcp.json has a server entry whose value is not an object — fix the file; this lint will not guess"
  fi
  [ -n "$mcp_real" ] || fail ".mcp.json exists but no servers could be parsed from it"
  mcp_row="$(grep -E '^\| *MCP *\|' "$MAP" | head -1 | awk -F'|' '{print $3}')"
  [ -n "$mcp_row" ] || fail ".mcp.json declares servers but the map has NO | MCP | row"
  for m in $mcp_real; do
    printf '%s' "$mcp_row" | grep -qF "${BT}${m}${BT}" \
      || fail "MCP server '$m' is in .mcp.json but not in the map's MCP row"
  done
  # NOTE the BARE backtick in this ERE (single quotes already protect it from
  # the shell). Escaping it here — backslash then backtick — is what broke this
  # check in review round 1: BSD grep reads that pair as a literal backtick, so
  # it was green on macOS, while GNU grep reads it as the start-of-buffer
  # ANCHOR, so on the Linux runner the pattern matched nothing, this loop never
  # ran, and the reverse MCP check became a category that CANNOT FAIL — exactly
  # the defect class #378 exists to close. See the BT note at the top.
  for m in $(printf '%s' "$mcp_row" | grep -oE '`[A-Za-z0-9_-]+`' | tr -d '`'); do
    printf '%s\n' "$mcp_real" | grep -qxF "$m" \
      || fail "MCP server '$m' is in the map's MCP row but not in .mcp.json"
  done
  # A server named twice in the row is drift too — same rule the plugin row
  # already carries below.
  mcp_dupes="$(printf '%s' "$mcp_row" | grep -oE '`[A-Za-z0-9_-]+`' | tr -d '`' | sort | uniq -d)"
  for m in $mcp_dupes; do
    fail "MCP server '$m' is listed MORE THAN ONCE in the map's MCP row"
  done
else
  # No .mcp.json — but a map row claiming servers must still be wrong. Without
  # this arm the whole block is skipped and the row goes UNINSPECTED: delete the
  # file and the checker reports "✓ matches reality" while the map advertises
  # three MCP servers that do not exist. A cannot-fail path reached by deleting
  # a file is the same defect class as one reached by a bad regex (#400 r2).
  grep -qE '^\| *MCP *\|' "$MAP" \
    && fail "the map has an | MCP | row but there is NO .mcp.json — no server is configured"
fi

# --- 2. enabled plugins: settings.json <-> map row <-> rationale prose --------
if [ -f "$SETTINGS" ]; then
  # keys look like "context7@claude-plugins-official": true — take the bare name
  enabled="$(grep -oE '"[a-z0-9-]+@[a-z0-9-]+" *: *true' "$SETTINGS" \
             | sed -E 's/"([a-z0-9-]+)@.*/\1/' | sort -u)"
  # ONLY the name column (field 3): the purpose column legitimately names
  # DROPPED plugins, which are not enabled and must not be demanded to be.
  plugin_row="$(grep -E '^\| *plugin *\|' "$MAP" | head -1 | awk -F'|' '{print $3}')"
  for p in $enabled; do
    printf '%s' "$plugin_row" | grep -qF "${BT}${p}${BT}" \
      || fail "plugin '$p' is ENABLED in .claude/settings.json but is not listed in the map's plugin row"
    # a rationale line in the Plugins section: "- `name` — KEEP/DROPPED: why"
    grep -qE "^ *- +(${BT}[a-z0-9-]+${BT} */ *)*${BT}${p}${BT}" "$MAP" \
      || fail "plugin '$p' is enabled but has no rationale line in the CLAUDE.md \"Plugins\" section"
  done
  # the reverse: a name in the plugin row that is not enabled anywhere
  for p in $(printf '%s' "$plugin_row" | grep -oE '`[a-z0-9-]+`' | tr -d '`'); do
    printf '%s\n' "$enabled" | grep -qxF "$p" \
      || fail "plugin '$p' is in the map's plugin row but is NOT enabled in .claude/settings.json"
  done
  # A name listed twice in the row is drift as much as a missing one — it means
  # the row was edited without reading it (review finding).
  dupes="$(printf '%s' "$plugin_row" | grep -oE '`[a-z0-9-]+`' | tr -d '`' | sort | uniq -d)"
  for p in $dupes; do
    fail "plugin '$p' is listed MORE THAN ONCE in the map's plugin row"
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
# NO HOOK ENTRY HERE, DELIBERATELY (#384). The prose says "all four hooks" and
# "all four self-tests", which is TRUE — there are 4 real PreToolUse hooks — but
# the map carries 6 hook rows, because hook-parse-lib.sh and prepush-select-lib.sh
# are shared LIBRARIES, not hooks. A count regex here would compare 4 against 6
# and fail on correct content. If you are tempted to "fix" that by adding one,
# this is why it is absent: the mismatch is real and intended. A 5th hook would
# make the prose stale silently — accepted, and written down instead of guarded.
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
