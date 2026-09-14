#!/bin/bash
# Self-test for patch_linkedin.sh (#381, PR #408 review round 1: the happy path
# is exercised by every install leg in CI, but the failure branches — the two
# exit-1 guards — were gated by nothing). Network-free: pip and python are
# PATH-stubbed, so this runs in seconds anywhere. Invoked by deploy.yml's
# Backend Lint & Format job right after the real script runs.
#
#   bash scripts/patch_linkedin.test.sh
set -u
cd "$(dirname "$0")" || exit 1
SCRIPT="./patch_linkedin.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/patchli.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0

check() { # name, expected_rc, actual_rc, output, expected_substring
  local name="$1" want_rc="$2" rc="$3" out="$4" want_sub="$5"
  if [ "$rc" = "$want_rc" ] && printf '%s' "$out" | grep -qF "$want_sub"; then
    echo "PASS $name"; PASS=$((PASS + 1))
  else
    echo "FAIL $name (rc=$rc want=$want_rc; looking for '$want_sub')"
    printf '%s\n' "$out" | sed 's/^/     | /'
    FAIL=$((FAIL + 1))
  fi
}

# --- 1. no pin at all -> loud exit 1 at the guard ---------------------------
printf 'requests==2.32.3\n' > "$TMP/nopin.txt"
OUT="$(bash "$SCRIPT" "$TMP/nopin.txt" 2>&1)"; RC=$?
check "no-pin fails at the guard" 1 "$RC" "$OUT" "no 'linkedin-api==<version>' pin"

# --- 2. non-numeric version -> same guard, not a later pip death ------------
printf 'linkedin-api==whatever\n' > "$TMP/badver.txt"
OUT="$(bash "$SCRIPT" "$TMP/badver.txt" 2>&1)"; RC=$?
check "non-numeric pin fails at the guard" 1 "$RC" "$OUT" "no 'linkedin-api==<version>' pin"

# --- stubs: pip records its argv; python swallows the heredoc ---------------
mkdir -p "$TMP/bin"
cat > "$TMP/bin/pip" <<STUB
#!/bin/bash
echo "\$@" >> "$TMP/pip-args"
STUB
cat > "$TMP/bin/python" <<'STUB'
#!/bin/bash
cat > /dev/null
STUB
chmod +x "$TMP/bin/pip" "$TMP/bin/python"

# --- 3. wheel-name mismatch -> exit 1 (stub pip downloads nothing) ----------
printf 'linkedin-api==9.9.9  # comment after the pin\n' > "$TMP/pin.txt"
mkdir -p /tmp/wheels   # the script lists it in the error path
OUT="$(PATH="$TMP/bin:$PATH" bash "$SCRIPT" "$TMP/pin.txt" 2>&1)"; RC=$?
check "missing wheel fails loudly" 1 "$RC" "$OUT" "expected /tmp/wheels/linkedin_api-9.9.9-py3-none-any.whl"

# --- 4. derivation: the stubbed pip must be asked for EXACTLY the pin -------
: > "$TMP/pip-args"
touch "/tmp/wheels/linkedin_api-9.9.9-py3-none-any.whl"
OUT="$(PATH="$TMP/bin:$PATH" bash "$SCRIPT" "$TMP/pin.txt" 2>&1)"; RC=$?
check "happy path with stubs" 0 "$RC" "$OUT" "patching linkedin_api-9.9.9-py3-none-any.whl (pin from $TMP/pin.txt)"
if grep -qF "download linkedin-api==9.9.9 --no-deps" "$TMP/pip-args" \
   && grep -qF "install /tmp/patched/linkedin_api-9.9.9-py3-none-any.whl" "$TMP/pip-args"; then
  echo "PASS pip asked for the derived pin"; PASS=$((PASS + 1))
else
  echo "FAIL pip argv did not carry the derived pin:"; sed 's/^/     | /' "$TMP/pip-args"
  FAIL=$((FAIL + 1))
fi
rm -f "/tmp/wheels/linkedin_api-9.9.9-py3-none-any.whl"

echo "----"
echo "patch_linkedin.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
