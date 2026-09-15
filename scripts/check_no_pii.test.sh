#!/usr/bin/env bash
# Self-test for scripts/check_no_pii.sh — BOTH of its contracts.
#
# The point of this file is the FAILING-FIRST case. Check A (PII) shipped for two
# releases with no self-test at all, and check B (#313 de-branding) is a *new*
# gate: a gate that has never been observed to fail is indistinguishable from a
# gate that cannot fail (lessons §16/§18 — "verify that your gates actually
# gate"). Every case below builds a throwaway git repo in a temp dir, points the
# checker at it via CLAUDE_PROJECT_DIR, and asserts the exit code AND the message.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check_no_pii.sh"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ✓ %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  ✗ %s\n     %s\n' "$1" "$2"; }

# A minimal repo carrying every in-scope surface plus two out-of-scope ones, all
# clean. $1 = temp dir. Callers then dirty exactly one file.
skeleton() {
  d="$1"
  mkdir -p "$d/docs/retrospectives" "$d/docs/wiki" \
           "$d/.claude/agents" "$d/agents" "$d/.github/prompts" "$d/importer"
  echo "# Beaconfolio" > "$d/README.md"
  echo "deploy Beaconfolio at <your-domain>" > "$d/docs/DEPLOYMENT.md"
  echo "see <your-domain>" > "$d/docs/wiki/production-deployment.md"
  echo "v1.0.0 retro" > "$d/docs/retrospectives/v1.0.0.md"
  echo "You work on Beaconfolio." > "$d/.claude/agents/backend-dev.md"
  echo "# SITE_URL=https://example.com" > "$d/.env.example"
  echo "You are part of the Beaconfolio delivery team." > "$d/.claude/PLAYBOOK.md"
  echo "Beaconfolio testing guide." > "$d/README_TESTING.md"
  echo "Report at https://github.com/mavrovde/beaconfolio/security/advisories/new" > "$d/SECURITY.md"
  echo "A LinkedIn -> Beaconfolio content pipeline." > "$d/.github/copilot-instructions.md"
  echo "Prepare and check a release of Beaconfolio." > "$d/.github/prompts/release-check.prompt.md"
  echo "# Dependabot version updates for Beaconfolio" > "$d/.github/dependabot.yml"
  echo "Pushes your posts into your Beaconfolio backend." > "$d/importer/README.md"
  # Surfaces round 2 proved unguarded under the old INCLUDE list — plus the rest
  # of the same class (every legacy per-tool rule file, every instructions file).
  mkdir -p "$d/.github/instructions" "$d/scraper"
  for g in AGENTS.md AI.md .cline.md .clauderules .cursorrules .geminirules .windsurfrules; do
    echo "See CLAUDE.md; this project is Beaconfolio." > "$d/$g"
  done
  echo "Images publish to ghcr.io/mavrovde/beaconfolio-*." > "$d/.github/instructions/infra-ci.instructions.md"
  echo "Scrape, then import into your Beaconfolio backend." > "$d/scraper/WORKFLOW.md"
  # Excluded classes: each must keep the domain WITHOUT tripping the guard.
  mkdir -p "$d/proxy" "$d/backend/app" "$d/agents/common" "$d/.github/workflows"
  echo "## v1.0.0 — moved off mavrov.de" > "$d/CHANGELOG.md"
  echo "  - PUBLIC_SERVER_NAME=\${PUBLIC_SERVER_NAME:-beaconfolio.com}" > "$d/docker-compose.yml"
  echo "the maintainer deploys it at beaconfolio.com" > "$d/CLAUDE.md"
  echo ': "${PUBLIC_SERVER_NAME:=beaconfolio.com}"' > "$d/proxy/entrypoint.sh"
  echo "# defaults preserve the beaconfolio.com hostnames" > "$d/proxy/default.conf.template"
  echo "          PUBLIC_URL: 'https://beaconfolio.com'" > "$d/.github/workflows/deploy.yml"
  echo '    cors_origins: str = "https://beaconfolio.com"' > "$d/backend/app/config.py"
  echo '"""A2A team for Beaconfolio."""' > "$d/agents/common/roster.py"
  echo '"""LinkedIn -> Beaconfolio importer."""' > "$d/importer/core.py"
  echo '{"headers": {"Host": "beaconfolio.com"}}' > "$d/verify_proxy_routes.py"
  ( cd "$d" && git init -q . && git add -A ) >/dev/null 2>&1
}

# $1 = temp dir. Re-stages so newly written files are visible to `git grep`.
run() { ( cd "$1" && git add -A >/dev/null 2>&1; CLAUDE_PROJECT_DIR="$1" bash "$SCRIPT" 2>&1 ); }

# --- 1. FAILING FIRST: unannotated domain on a guidance surface -------------
d="$(mktemp -d)"; skeleton "$d"
echo "Point your DNS at mavrov.de and you are done." >> "$d/README.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && ok "unannotated maintainer domain in README FAILS (rc=1)" \
  || bad "unannotated domain fails" "rc=$rc, out=$out"
printf '%s' "$out" | grep -q 'De-brand guard' \
  && ok "…and says which guard tripped" || bad "names the guard" "$out"
printf '%s' "$out" | grep -q 'README.md' \
  && ok "…and names the offending file" || bad "names the file" "$out"
rm -rf "$d"

# --- 2. PASSING AFTER: the product voice ------------------------------------
d="$(mktemp -d)"; skeleton "$d"
echo "Point your DNS at <your-domain> and you are done." >> "$d/README.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "the placeholder rewrite PASSES (rc=0)" \
  || bad "placeholder passes" "rc=$rc, out=$out"
rm -rf "$d"

# --- 3. The three annotations are the ONLY way to keep the domain -----------
for marker in \
  "the maintainer's install <!-- de-brand:canonical: the one sanctioned aside --> at mavrov.de" \
  "it was /opt/mavrov.de <!-- de-brand:historical: the pre-#310 default -->" \
  "pre-rename images live at ghcr.io/mavrovde/mavrov.de-backend"
do
  d="$(mktemp -d)"; skeleton "$d"
  printf '%s\n' "$marker" >> "$d/README.md"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 0 ] && ok "annotated line accepted: ${marker:0:38}…" \
    || bad "annotated line accepted: $marker" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 3b. NEGATIVE direction: an INCIDENTAL marker word must NOT exempt -------
#     Round 1 of #318 matched three BARE words against the whole `git grep`
#     output line. The reviewer walked all three of these through it green — the
#     third being a straight REVERT of the README row this change fixed, exempted
#     because the cell says "canonical". "canonical" and "historical" are ordinary
#     English in this repo (21 in-scope lines already use "canonical" innocently),
#     so the ONLY thing that may exempt a line is the `de-brand:` namespace.
for prose in \
  "Set SSR to advertise mavrov.de as the canonical URL for every page." \
  "The historical posts feed is served from mavrov.de/blog." \
  "| PUBLIC_SERVER_NAME | .env | mavrov.de www.mavrov.de | the canonical fallback |" \
  "mavrov.de is the instance <!-- DE-BRAND:CANONICAL --> — marker in the wrong case."
do
  d="$(mktemp -d)"; skeleton "$d"
  printf '%s\n' "$prose" >> "$d/README.md"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 1 ] && ok "incidental marker does NOT exempt: ${prose:0:36}…" \
    || bad "incidental marker must not exempt: $prose" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 3c. NEGATIVE direction: the marker may not live in the PATH -------------
#     `git grep -in` emits `path:line:content`; filtering the whole line made
#     every file under a `canonical`/`historical`-named directory exempt forever.
#     The third path carries the FULL namespaced marker in a directory name — it
#     is the case that falsifies the fix itself: stripping the prefix textually
#     cannot handle a path containing `:`, so the checker must read the file.
for p in docs/canonical-urls/setup.md docs/historical-notes/hosting.md \
         'docs/de-brand:historical-notes/hosting.md'
do
  d="$(mktemp -d)"; skeleton "$d"
  mkdir -p "$d/$(dirname "$p")"
  echo "Point your DNS at mavrov.de and you are done." > "$d/$p"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 1 ] && ok "a marker word in the PATH does not exempt: $p" \
    || bad "path-level exemption hole: $p" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 4. EVERY in-scope surface is actually scanned ---------------------------
#     A scope list is a claim; an unscanned entry is a silent hole. Rounds 1 AND 2
#     of #318 both found branded, permanently-unguarded surfaces because the scope
#     was an INCLUDE list — round 2's positive control (append the domain, watch
#     the guard stay green) caught AGENTS.md, AI.md, .cline.md,
#     .github/instructions/*, scraper/WORKFLOW.md. The scope is now inverted, so
#     this loop asserts the *whole class*, not a hand-maintained subset.
for f in README.md docs/DEPLOYMENT.md docs/wiki/production-deployment.md \
         .claude/agents/backend-dev.md .env.example .claude/PLAYBOOK.md \
         README_TESTING.md SECURITY.md .github/copilot-instructions.md \
         .github/prompts/release-check.prompt.md .github/dependabot.yml \
         importer/README.md \
         AGENTS.md AI.md .cline.md .clauderules .cursorrules .geminirules \
         .windsurfrules .github/instructions/infra-ci.instructions.md \
         scraper/WORKFLOW.md
do
  d="$(mktemp -d)"; skeleton "$d"
  echo "deploy it at mavrov.de" >> "$d/$f"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 1 ] && ok "in scope: $f" || bad "in scope: $f" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 4b. FAIL CLOSED: a file nobody ever listed is guarded from birth --------
#     This is the case an include list can never satisfy, and the reason the scope
#     was inverted. None of these paths appears anywhere in the checker.
for f in docs/BRAND-NEW.md .github/instructions/newthing.instructions.md \
         .github/workflows/newthing.yml proxy/newthing.conf \
         some/dir/nobody/listed/guide.md .aiderrules
do
  d="$(mktemp -d)"; skeleton "$d"
  mkdir -p "$d/$(dirname "$f")"
  echo "Point your DNS at mavrov.de and you are done." > "$d/$f"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 1 ] && ok "guarded from birth (never listed): $f" \
    || bad "new file unguarded: $f" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 5. ONLY history stays out of scope (#330 executed the #313 deferrals) ---
#     History must not be rewritten. Every OTHER former exclusion — runtime
#     defaults, CLAUDE.md, application code — was renamed by #330 and is now
#     guarded like any file.
for f in docs/retrospectives/v1.0.0.md CHANGELOG.md
do
  d="$(mktemp -d)"; skeleton "$d"
  echo "we shipped mavrov.de v1.0.0 that day" >> "$d/$f"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 0 ] && ok "out of scope (history): $f" || bad "out of scope: $f" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 5a. The #313 deferrals are DEFERRED NO LONGER: each former exclusion now trips
for f in CLAUDE.md docker-compose.yml proxy/entrypoint.sh proxy/default.conf.template \
         .github/workflows/deploy.yml backend/app/config.py agents/common/roster.py \
         importer/core.py verify_proxy_routes.py
do
  d="$(mktemp -d)"; skeleton "$d"
  echo "deploy it at mavrov.de" >> "$d/$f"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 1 ] && ok "former #313 deferral now IN scope: $f" \
    || bad "former deferral still excluded: $f" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 5c. The OLD PRODUCT NAME is a violation too (#330) ----------------------
for line in \
  "clone the hirefolio repository and run setup" \
  "the Hirefolio admin panel" \
  "set HIREFOLIO_GEMINI_API_KEY in your .env"
do
  d="$(mktemp -d)"; skeleton "$d"
  printf '%s\n' "$line" >> "$d/README.md"
  out="$(run "$d")"; rc=$?
  [ "$rc" -eq 1 ] && ok "old product name trips: ${line:0:34}…" \
    || bad "old product name must trip: $line" "rc=$rc, out=$out"
  rm -rf "$d"
done

# --- 5d. …but the legacy GHCR pin and MIXED-CASE domain behave correctly -----
d="$(mktemp -d)"; skeleton "$d"
echo "tags <= 1.14.0 live at ghcr.io/mavrovde/hirefolio-backend" >> "$d/README.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "legacy ghcr.io/mavrovde/hirefolio pin is exempt" \
  || bad "legacy pin exempt" "rc=$rc, out=$out"
rm -rf "$d"
d="$(mktemp -d)"; skeleton "$d"
echo "LIFESPAN START: Mavrov.de API" >> "$d/README.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && ok "mixed-case Mavrov.de is caught (the #330 sweep missed 3 of these)" \
  || bad "mixed case caught" "rc=$rc, out=$out"
rm -rf "$d"

# --- 6. Check A still gates, and the two checks are independent -------------
d="$(mktemp -d)"; skeleton "$d"
# The identifier is ASSEMBLED, never written literally: this file is itself
# scanned by the check it tests, so a literal one trips check A for real. It did
# — on the first push attempt of #313, which is the gate working as intended.
# Excluding this file from check A would have been the weaker fix.
pii="serg"".mavrov@example.com"
echo "contact $pii" >> "$d/docs/DEPLOYMENT.md"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 1 ] && ok "PII identifier still FAILS (rc=1)" || bad "PII fails" "rc=$rc, out=$out"
printf '%s' "$out" | grep -q '✗ PII guard' \
  && ok "…reported by check A" || bad "check A reports" "$out"
printf '%s' "$out" | grep -q '✓ De-brand guard' \
  && ok "…while check B independently passes (A failing does not skip B)" \
  || bad "B runs after A fails" "$out"
rm -rf "$d"

# --- 7. A clean repo passes both --------------------------------------------
d="$(mktemp -d)"; skeleton "$d"
out="$(run "$d")"; rc=$?
[ "$rc" -eq 0 ] && ok "a clean repo passes both checks" || bad "clean repo" "rc=$rc, out=$out"
rm -rf "$d"

# --- 8. The REAL repository satisfies both contracts -------------------------
out="$(bash "$SCRIPT")"; rc=$?
[ "$rc" -eq 0 ] && ok "the real repository satisfies both contracts" || bad "real repo" "$out"

# ---------------------------------------------------------------------------
# Mutation contract (#393): neuter ONE arm at a time in a COPY of the checker
# and require the pinned case to go red. INVALID (rotted needle / no diff /
# unparseable / assertion false on the unmodified script) counts separately
# and fails the run (#388). PII fixtures are ASSEMBLED, never literal — this
# file is scanned by the very check it tests.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--mutations" ]; then
  KILLED=0; SURVIVED=0; INVALID=0
  MDIR="$(mktemp -d)"
  runx() { ( cd "$2" && git add -A >/dev/null 2>&1; CLAUDE_PROJECT_DIR="$2" bash "$1" 2>&1 ); }
  mutate() { # name needle replacement assert-fn
    local name="$1" needle="$2" repl="$3" assertfn="$4" M="$MDIR/mut.sh"
    python3 - "$SCRIPT" "$M" "$needle" "$repl" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1:5]
t = open(src).read()
if needle not in t:
    sys.exit(3)
open(dst, "w").write(t.replace(needle, repl, 1))
PY
    case $? in 3) INVALID=$((INVALID+1)); echo "  ✗ INVALID mutant '$name' — needle not found (rotted)"; return ;; esac
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
  assert_pii() { local d o; d="$(mktemp -d)"; skeleton "$d"
    local pii; pii="serg"".mavrov@example.com"
    echo "contact $pii" >> "$d/docs/DEPLOYMENT.md"
    o="$(runx "$1" "$d")"; local rc=$?; rm -rf "$d"
    [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -q '✗ PII guard'; }
  assert_brand() { local d o; d="$(mktemp -d)"; skeleton "$d"
    echo "Point your DNS at mavrov.de and you are done." >> "$d/README.md"
    o="$(runx "$1" "$d")"; local rc=$?; rm -rf "$d"
    [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -q 'De-brand guard'; }
  assert_marker_ns() { local d o; d="$(mktemp -d)"; skeleton "$d"
    echo "Set SSR to advertise mavrov.de as the canonical URL for every page." >> "$d/README.md"
    o="$(runx "$1" "$d")"; local rc=$?; rm -rf "$d"; [ "$rc" -eq 1 ]; }
  assert_docs_scope() { local d o; d="$(mktemp -d)"; skeleton "$d"
    echo "Point your DNS at mavrov.de and you are done." >> "$d/docs/DEPLOYMENT.md"
    o="$(runx "$1" "$d")"; local rc=$?; rm -rf "$d"
    [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -q 'De-brand guard'; }
  assert_marker_case() { local d o; d="$(mktemp -d)"; skeleton "$d"
    echo "mavrov.de is the instance <!-- DE-BRAND:CANONICAL --> — wrong case." >> "$d/README.md"
    o="$(runx "$1" "$d")"; local rc=$?; rm -rf "$d"; [ "$rc" -eq 1 ]; }
  assert_b_after_a() { local d o; d="$(mktemp -d)"; skeleton "$d"
    local pii; pii="serg"".mavrov@example.com"
    echo "contact $pii" >> "$d/docs/DEPLOYMENT.md"
    o="$(runx "$1" "$d")"; local rc=$?; rm -rf "$d"
    [ "$rc" -ne 0 ] && printf '%s' "$o" | grep -q '✓ De-brand guard'; }

  mutate "check A detection removed (a PII hit passes silently)" \
    'if [ -n "$hits" ]; then' 'if false; then' assert_pii
  mutate "check A exclusions widened to everything (the allowlist swallows the repo)" \
    "':(exclude)LICENSE' \\" "':(exclude)*' \\" assert_pii
  mutate "check B detection removed (an unannotated domain passes)" \
    'if [ -n "$brand" ]; then' 'if false; then' assert_brand
  mutate "marker namespace debased to bare words (the #318 round-1 regression verbatim)" \
    "GUIDANCE_ANNOTATIONS='de-brand:(canonical|historical)|ghcr\\.io/mavrovde/(mavrov\\.de|hirefolio)'" \
    "GUIDANCE_ANNOTATIONS='(canonical|historical)|ghcr\\.io/mavrovde/(mavrov\\.de|hirefolio)'" assert_marker_ns
  mutate "check B exclusions widened to all of docs/ (guidance surfaces exempted)" \
    "':(exclude)docs/retrospectives/*' \\" "':(exclude)docs/*' \\" assert_docs_scope
  mutate "marker match made case-insensitive (a wrong-case marker exempts)" \
    '&& $0 !~ pat {' '&& tolower($0) !~ pat {' assert_marker_case
  mutate "check A failure aborts the script (check B silently skipped)" \
    '  rc=1' '  exit 1' assert_b_after_a

  rm -rf "$MDIR"
  echo "check_no_pii mutations: $KILLED killed, $SURVIVED survived, $INVALID invalid"
  [ "$SURVIVED" -eq 0 ] && [ "$INVALID" -eq 0 ] || fail=$((fail+1))
fi

printf '\ncheck_no_pii self-test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
