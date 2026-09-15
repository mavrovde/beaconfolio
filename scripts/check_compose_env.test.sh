#!/usr/bin/env bash
# Self-test for scripts/check_compose_env.sh.
#
# The point of this file is the FAILING-FIRST case: a check that only ever
# reports OK is indistinguishable from a check that cannot fail (lessons §16/§18
# — "verify that your gates actually gate"). Every case below builds a throwaway
# repo skeleton in a temp dir, points the checker at it via CLAUDE_PROJECT_DIR,
# and asserts the exit code AND the message.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check_compose_env.sh"
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  ✗ %s\n     %s\n' "$1" "$2"; }

# Build a minimal repo: .env.example + backend/app/config.py + both compose files.
# $1 = temp dir, $2 = extra .env.example lines, $3 = extra compose env lines
skeleton() {
  d="$1"
  mkdir -p "$d/backend/app"
  { echo "# sample"; echo "# SITE_NAME=My Portfolio"; printf '%s\n' "$2"; } > "$d/.env.example"
  cat > "$d/backend/app/config.py" <<'PY'
class Settings(BaseSettings):
    site_name: str = "My Portfolio"
    translation_enabled: bool = True
    gemini_api_key: str = Field(default="", validation_alias="BEACONFOLIO_GEMINI_API_KEY")
PY
  for f in docker-compose.yml docker-compose.prod.yml; do
    { echo "services:"
      echo "  db:"
      echo "    image: postgres"
      echo "  backend:"
      echo "    image: backend"
      echo "    environment:"
      echo "      - SITE_NAME=\${SITE_NAME:-My Portfolio}"
      printf '%s\n' "$3"
    } > "$d/$f"
  done
}

run() { CLAUDE_PROJECT_DIR="$1" bash "$SCRIPT" 2>&1; }

# --- 1. FAILING FIRST: the #298 shape — documented knob, not forwarded -------
d="$(mktemp -d)"; skeleton "$d" "# TRANSLATION_ENABLED=true" ""
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && ok "documented-but-unforwarded key FAILS (rc=1)" \
  || bad "documented-but-unforwarded key FAILS" "rc=$rc, out=$out"
printf '%s' "$out" | grep -q 'never receives $TRANSLATION_ENABLED' \
  && ok "…and names the key + the file" || bad "names the key" "$out"
printf '%s' "$out" | grep -q 'docker-compose.prod.yml' \
  && ok "…and reports BOTH compose files" || bad "reports both files" "$out"
rm -rf "$d"

# --- 2. PASSING AFTER: the same repo with the forward added ------------------
d="$(mktemp -d)"; skeleton "$d" "# TRANSLATION_ENABLED=true" \
  "      - TRANSLATION_ENABLED=\${TRANSLATION_ENABLED:-true}"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "adding the forward makes it PASS (rc=0)" \
  || bad "adding the forward makes it pass" "rc=$rc, out=$out"
rm -rf "$d"

# --- 3. Forwarded in dev but NOT in prod is still a failure (#296's shape) ---
d="$(mktemp -d)"; skeleton "$d" "# TRANSLATION_ENABLED=true" \
  "      - TRANSLATION_ENABLED=\${TRANSLATION_ENABLED:-true}"
: > "$d/docker-compose.prod.yml"
{ echo "services:"; echo "  backend:"; echo "    environment:"
  echo "      - SITE_NAME=\${SITE_NAME:-x}"; } > "$d/docker-compose.prod.yml"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && ok "dev-only forward still FAILS on prod" || bad "dev-only forward fails" "rc=$rc"
printf '%s' "$out" | grep -q 'docker-compose.yml — backend' \
  && bad "dev file wrongly reported" "$out" || ok "…and does not blame the dev file"
rm -rf "$d"

# --- 4. Namespaced alias (#141 BEACONFOLIO_*) is understood -------------------
d="$(mktemp -d)"; skeleton "$d" "# BEACONFOLIO_GEMINI_API_KEY=x" ""
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'BEACONFOLIO_GEMINI_API_KEY' \
  && ok "validation_alias keys are part of the contract" || bad "alias keys" "rc=$rc out=$out"
rm -rf "$d"

# --- 5. A documented key that is NOT a Settings field is NOT reported --------
#     (keeps the check quiet: proxy/db/image keys are outside the contract)
d="$(mktemp -d)"; skeleton "$d" "# PUBLIC_SERVER_NAME=example.com" ""
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "non-Settings documented keys are ignored" || bad "non-Settings ignored" "$out"
rm -rf "$d"

# --- 6. A Settings field NOT documented in .env.example is NOT reported ------
#     (an internal default nobody is told to set is not a promise)
d="$(mktemp -d)"; skeleton "$d" "" ""
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "undocumented Settings fields are ignored" || bad "undocumented ignored" "$out"
rm -rf "$d"

# --- 7. The #297 shape: promised by README/setup.sh BEFORE .env.example ------
#     With .env.example as the only doc source this case is silent, which is
#     exactly why DOC_FILES is wider than one file.
d="$(mktemp -d)"; skeleton "$d" "" ""
printf 'Set TRANSLATION_ENABLED in your .env to disable it.\n' > "$d/README.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && ok "a knob promised only by README is still in the contract" \
  || bad "README as a doc source" "rc=$rc, out=$out"
printf '%s' "$out" | grep -q 'promised by: README.md' \
  && ok "…and the message names the file that promised it" || bad "names the doc source" "$out"
rm -rf "$d"

# --- 8. The REAL repo passes ------------------------------------------------
out="$(bash "$SCRIPT")"; rc=$?
[ "$rc" -eq 0 ] && ok "the real repository satisfies the contract" || bad "real repo" "$out"

# ---------------------------------------------------------------------------
# Mutation contract (#393): neuter ONE arm of the checker at a time in a COPY
# and require the pinned case to go red. INVALID (rotted needle / no diff /
# unparseable / assertion false on the unmodified script) counts separately
# and fails the run (#388).
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  MT="$(mktemp -d)"; trap 'rm -rf "$MT"' EXIT
  runx() { CLAUDE_PROJECT_DIR="$2" bash "$1" 2>&1; }
  mutate() { # name needle replacement assert-fn
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$MT/mut.sh"
    if ! grep -qF "$needle" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return
    fi
    python3 - "$SCRIPT" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
open(dst, "w").write(open(src).read().replace(needle, repl, 1))
PY
    cmp -s "$SCRIPT" "$M" && { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — no change"; return; }
    bash -n "$M" 2>/dev/null || { INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — not parseable"; return; }
    if ! "$assertfn" "$SCRIPT"; then
      INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — assertion fails on the UNMODIFIED script"; return
    fi
    if "$assertfn" "$M"; then
      SURVIVED=$((SURVIVED+1)); echo "  ✗ SURVIVED: '$name' — the case stays green with the arm removed"
    else
      KILLED=$((KILLED+1)); echo "  ✓ killed: $name"
    fi
  }
  # assert-fns rebuild their fixture each call and hold on the unmodified script.
  assert_unforwarded() { local d o; d="$MT/f1"; rm -rf "$d"; mkdir -p "$d"
    skeleton "$d" "# TRANSLATION_ENABLED=true" ""
    o="$(runx "$1" "$d")"; [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'never receives $TRANSLATION_ENABLED'; }
  assert_prod_only() { local d o; d="$MT/f3"; rm -rf "$d"; mkdir -p "$d"
    skeleton "$d" "# TRANSLATION_ENABLED=true" "      - TRANSLATION_ENABLED=\${TRANSLATION_ENABLED:-true}"
    { echo "services:"; echo "  backend:"; echo "    environment:"
      echo "      - SITE_NAME=\${SITE_NAME:-x}"; } > "$d/docker-compose.prod.yml"
    o="$(runx "$1" "$d")"; [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'docker-compose.prod.yml'; }
  assert_readme_source() { local d o; d="$MT/f7"; rm -rf "$d"; mkdir -p "$d"
    skeleton "$d" "" ""
    printf 'Set TRANSLATION_ENABLED in your .env to disable it.\n' > "$d/README.md"
    o="$(runx "$1" "$d")"; [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'promised by: README.md'; }
  assert_alias() { local d o; d="$MT/f4"; rm -rf "$d"; mkdir -p "$d"
    skeleton "$d" "# BEACONFOLIO_GEMINI_API_KEY=x" ""
    o="$(runx "$1" "$d")"; [ $? -eq 1 ] && printf '%s' "$o" | grep -q 'BEACONFOLIO_GEMINI_API_KEY'; }

  mutate "missing-key detection removed (unforwarded knob passes)" \
    'if ! printf '"'"'%s\n'"'"' "$present" | grep -qx "$key"; then' 'if false; then' assert_unforwarded
  mutate "prod compose dropped from scope (dev-only forward passes)" \
    'COMPOSE_FILES="docker-compose.yml docker-compose.prod.yml"' 'COMPOSE_FILES="docker-compose.yml"' assert_prod_only
  mutate "doc sources narrowed to .env.example (the #297 README promise passes)" \
    'DOC_FILES=".env.example README.md docs/DEPLOYMENT.md setup.sh"' 'DOC_FILES=".env.example"' assert_readme_source
  mutate "validation_alias extraction removed (namespaced knobs leave the contract)" \
    'grep -oE '"'"'validation_alias="[A-Z][A-Z0-9_]*"'"'"' "$CONFIG_PY" | cut -d'"'"'"'"'"' -f2' 'true' assert_alias
  mutate "exemption match becomes blanket (every key exempt)" \
    'printf '"'"'%s\n'"'"' "$EXEMPT_LIST" | grep -q "^$1:"' 'true' assert_unforwarded
  mutate "Settings-field extraction removed (no field is ever in the contract)" \
    'grep -oE '"'"'^ {4}[a-z][a-z0-9_]*[[:space:]]*:'"'"' "$CONFIG_PY" | tr -d '"'"' :'"'"' | tr '"'"'[:lower:]'"'"' '"'"'[:upper:]'"'"'' 'true' assert_unforwarded

  echo "check_compose_env mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fail=$((fail+1))
fi

printf '\ncheck_compose_env self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
