#!/usr/bin/env bash
# Self-test for check_env_example_complete.sh (#61, PR #418). Run:
#   bash scripts/check_env_example_complete.test.sh
# Mutation-checked per the lessons discipline: both failure directions are
# proven reachable on fixtures derived from the REAL pair, so a checker that
# stopped comparing (or compared the wrong things) goes red here, not in a
# review round.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check_env_example_complete.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

expect() { # desc expected_exit ...args
  local desc="$1" want="$2"; shift 2
  if bash "$CHECK" "$@" >/dev/null 2>&1; then got=0; else got=$?; fi
  if [ "$got" -eq "$want" ] || { [ "$want" -ne 0 ] && [ "$got" -ne 0 ]; }; then
    printf 'PASS  [exit %s]  %s\n' "$got" "$desc"
  else
    printf 'FAIL  got exit %s want %s  %s\n' "$got" "$want" "$desc"
    fails=$((fails + 1))
  fi
}

# 1. The real pair passes — this is the repo contract itself.
expect "real config.py vs real .env.example" 0

# 2. MISSING direction: a new Settings field with no sample line goes red.
#    Appended INSIDE the class (the file ends with the module-level singleton,
#    so inject before `settings =`), aliased and un-aliased both.
python3 - "$HERE/../backend/app/config.py" "$TMP/config_extra.py" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
inject = (
    "    pr418_probe_plain: int = 7\n"
    '    pr418_probe_aliased: str = Field(default="", validation_alias="BEACONFOLIO_PR418_PROBE")\n'
)
out = re.sub(r"(?m)^settings = ", inject + "\nsettings = ", src, count=1)
assert out != src, "injection anchor `settings = ` not found"
open(sys.argv[2], "w").write(out)
PY
expect "new un-aliased field -> red"  1 "$TMP/config_extra.py" "$HERE/../backend/.env.example"

# 3. ORPHAN direction: a sample key naming no field goes red.
cp "$HERE/../backend/.env.example" "$TMP/env_orphan"
echo "PR418_GHOST_KEY=1" >> "$TMP/env_orphan"
expect "sample key with no field -> red" 1 "$HERE/../backend/app/config.py" "$TMP/env_orphan"

# 4. Alias resolution is real, not cosmetic: documenting the probe field by its
#    FIELD name while an alias is declared must stay red (the alias is the env
#    name pydantic actually reads).
cp "$HERE/../backend/.env.example" "$TMP/env_fieldname"
{ echo "PR418_PROBE_PLAIN=7"; echo "PR418_PROBE_ALIASED=x"; } >> "$TMP/env_fieldname"
expect "aliased field documented by field name -> red" 1 "$TMP/config_extra.py" "$TMP/env_fieldname"

# 5. ...and documenting it by the alias goes green (kills a checker that
#    ignores validation_alias and uppercases everything).
cp "$TMP/env_fieldname" "$TMP/env_alias"
sed -i.bak 's/^PR418_PROBE_ALIASED=x$/BEACONFOLIO_PR418_PROBE=x/' "$TMP/env_alias"
expect "aliased field documented by alias -> green" 0 "$TMP/config_extra.py" "$TMP/env_alias"

# ---------------------------------------------------------------------------
# Mutation contract (#393): neuter ONE enforcement arm at a time in a COPY of
# the checker and require the matching case to go red. `invalid` (rotted
# needle / no-diff edit / assertion false on the UNMODIFIED script) is counted
# separately and fails the run — #388's silent-INVALID-mutant failure mode.
# Kills are message-anchored, not rc-anchored: overlapping arms keep rc=1.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  mutate() { # name needle replacement assert-fn
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$TMP/mut.sh"
    if ! grep -qF "$needle" "$CHECK"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return
    fi
    python3 - "$CHECK" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
open(dst, "w").write(open(src).read().replace(needle, repl, 1))
PY
    cmp -s "$CHECK" "$M" && { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — no change"; return; }
    bash -n "$M" 2>/dev/null || { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — not parseable"; return; }
    # The mutants target Python embedded in the bash script, which bash -n
    # cannot vet. "Green on the real pair" is the WRONG validity criterion —
    # the alias mutant legitimately reds it (the real .env.example documents
    # aliased fields by alias) — so vet runnability instead: broken Python
    # announces itself as a traceback, and a traceback-kill is a kill for the
    # wrong reason (#427 review round 1, nit 3).
    if bash "$M" "$HERE/../backend/app/config.py" "$HERE/../backend/.env.example" 2>&1 >/dev/null \
       | grep -q 'Traceback'; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — raises a Python traceback (broken, not weakened)"; return
    fi
    if ! "$assertfn" "$CHECK"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — assertion fails on the UNMODIFIED script"; return
    fi
    if "$assertfn" "$M"; then
      SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: '$name' — the case stays green with the arm removed"
    else
      KILLED=$((KILLED+1)); echo "  ✓ killed: $name"
    fi
  }
  # assert-fns return 0 when the pinned behaviour HOLDS for script "$1".
  assert_missing() { local o; o="$(bash "$1" "$TMP/config_extra.py" "$HERE/../backend/.env.example" 2>&1)"
    [ $? -ne 0 ] && echo "$o" | grep -q "MISSING: Settings field"; }
  assert_orphan() { local o; o="$(bash "$1" "$HERE/../backend/app/config.py" "$TMP/env_orphan" 2>&1)"
    [ $? -ne 0 ] && echo "$o" | grep -q "ORPHAN:"; }
  assert_alias() { local o; o="$(bash "$1" "$TMP/config_extra.py" "$TMP/env_fieldname" 2>&1)"
    [ $? -ne 0 ] && echo "$o" | grep -q "BEACONFOLIO_PR418_PROBE"; }
  assert_exit() { bash "$1" "$TMP/config_extra.py" "$HERE/../backend/.env.example" >/dev/null 2>&1
    [ $? -ne 0 ]; }

  mutate "MISSING arm removed (undocumented field passes)" \
    'missing = sorted(set(expected) - documented)' 'missing = []' assert_missing
  mutate "ORPHAN arm removed (ghost sample key passes)" \
    'orphans = sorted(documented - set(expected))' 'orphans = []' assert_orphan
  mutate "alias resolution removed (field-name doc satisfies an aliased field)" \
    'expected[alias or field.upper()] = field' 'expected[field.upper()] = field' assert_alias
  mutate "failure exit removed (findings print but the check passes)" \
    'if missing or orphans:' 'if False:' assert_exit

  echo "check_env_example_complete mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fails=$((fails+1))
fi

if [ "$fails" -eq 0 ]; then
  echo "All env-example-complete cases passed."
else
  echo "$fails env-example-complete case(s) FAILED." >&2
  exit 1
fi
