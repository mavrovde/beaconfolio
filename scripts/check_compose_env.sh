#!/usr/bin/env bash
# check_compose_env.sh — the documented-knob contract (v1.13.0 retrospective).
#
# WHY THIS EXISTS — three blocker-level review findings in ONE release, same class:
#   * #296 blocker 3 — `docker compose -f docker-compose.prod.yml config` gave the
#     backend 35 environment keys, "none matching SMTP/MAIL": the prod `mail`
#     profile started a relay the app could never talk to.
#   * #297 blocker 3 — `setup.sh` and `README.md` told the owner to set
#     BEACONFOLIO_TELEGRAM_BOT_TOKEN / _CHAT_ID / BEACONFOLIO_NOTIFY_WEBHOOK_URL;
#     measured: "TELEGRAM present: []  NOTIFY present: []  env_file: None".
#     A "2-minute setup" that could not work.
#   * #298 blocker 4 — TRANSLATION_ENABLED / OWNER_LANGUAGE documented at
#     .env.example:190-195; `docker exec … env | grep -c` → 0. The acceptance
#     criterion "the flag disables the feature cleanly" was undeliverable.
# and two priors the repo already wrote comments about: ADMIN_PASSWORD (#256)
# and LINKEDIN_IMPORT_TOKEN (see docker-compose.yml's own inline notes).
#
# ROOT CAUSE, once: neither compose file uses `env_file:`; each service carries an
# explicit `environment:` ALLOWLIST. A key absent from that list never reaches the
# container no matter what the root `.env` says — and `app/config.py`'s own
# `env_file=".env"` resolves INSIDE the container, so it does not save you.
#
# THE CONTRACT this enforces:
#   a key that (a) is a real `backend/app/config.py` Settings field AND (b) is
#   named in a file that PROMISES the owner the knob exists — `.env.example`,
#   `README.md`, `docs/DEPLOYMENT.md` or `setup.sh` — MUST appear in the backend
#   service's `environment:` block of BOTH `docker-compose.yml` and
#   `docker-compose.prod.yml`.
# Keys nobody documents, and documented keys that Settings does not bind (proxy,
# db, image tags), are outside the contract and are never reported. Measured
# against the three round-1 heads of this release: the doc sources beyond
# `.env.example` are what make it catch #297 (the Telegram/webhook trio was
# promised by README + setup.sh before it was ever added to `.env.example`).
#
# Exemptions: add the key to EXEMPT_LIST below WITH A REASON. An exemption without a
# reason is how a guard's scope rots (lessons §21/§32).
#
# Usage:  bash scripts/check_compose_env.sh            # exit 1 on any gap
#         bash scripts/check_compose_env.sh --list     # derived contract + exemptions
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
CONFIG_PY="$ROOT/backend/app/config.py"
COMPOSE_FILES="docker-compose.yml docker-compose.prod.yml"

# Keys that are documented AND are Settings fields, yet deliberately NOT forwarded.
# Format: KEY:reason — an exemption WITHOUT a reason is how a guard's scope rots
# (lessons §21/§32). Six entries on day one, each measured, not assumed.
EXEMPT_LIST="
LINKEDIN_COOKIES_DIR:the path is the TARGET of the linkedin_cookies: named-volume mount in both compose files; forwarding it alone would let an owner point the app at an UNMOUNTED path and silently stop persisting the session. Found by this check on the v1.13.0 tag and resolved in .env.example instead
WHISPER_MODEL_DIR:identical case to LINKEDIN_COOKIES_DIR above — the path is the TARGET of the whisper_models: named-volume mount in both compose files (#264), so forwarding it would let an owner point the app at an UNMOUNTED path and silently re-download the Whisper model on every container start. Documented in .env.example as bare-metal-only instead
EMBEDDING_MODEL:documented only inside README.md's explicitly-labelled BARE-METAL backend/.env block, which is not a compose surface
GEMINI_API_KEY:pre-#141 legacy name, documented only as IGNORED; the compose files pass the legacy NAMES (never values) via LEGACY_GEMINI_ENV so the backend can warn about them
GEMINI_ENCRYPTION_KEY:same — pre-#141 legacy name, documented only as ignored
GEMINI_MODEL:same — pre-#141 legacy name, documented only as ignored
GEMINI_MODEL_FALLBACK:same — pre-#141 legacy name, documented only as ignored
"

# Files that PROMISE the owner a knob exists. `.env.example` is the canonical one;
# the other three are here because #297's Telegram trio was promised by README.md
# and setup.sh a full round BEFORE it reached .env.example — with .env.example as
# the only source, this check stays silent on exactly that PR.
DOC_FILES=".env.example README.md docs/DEPLOYMENT.md setup.sh"

fail=0
note() { printf '%s\n' "$*"; }

[ -f "$ROOT/.env.example" ] || { note "✗ $ROOT/.env.example not found"; exit 1; }
[ -f "$CONFIG_PY" ]         || { note "✗ $CONFIG_PY not found"; exit 1; }

# (1) Env keys `Settings` actually binds: every field name uppercased, plus every
#     explicit validation_alias (the #141 BEACONFOLIO_* namespacing).
settings_keys="$(
  { grep -oE '^ {4}[a-z][a-z0-9_]*[[:space:]]*:' "$CONFIG_PY" | tr -d ' :' | tr '[:lower:]' '[:upper:]'
    grep -oE 'validation_alias="[A-Z][A-Z0-9_]*"' "$CONFIG_PY" | cut -d'"' -f2
  } | sort -u
)"

# (2) …of those, the ones some documentation names. A whole-word match: prose
#     that merely mentions the key still counts as a promise, which is the point.
existing_docs=""
for f in $DOC_FILES; do [ -f "$ROOT/$f" ] && existing_docs="$existing_docs $ROOT/$f"; done
contract=""
for key in $settings_keys; do
  # shellcheck disable=SC2086
  if [ -n "$existing_docs" ] && grep -qw "$key" $existing_docs 2>/dev/null; then
    contract="$contract $key"
  fi
done

is_exempt() {
  printf '%s\n' "$EXEMPT_LIST" | grep -q "^$1:"
}

# The backend service's environment allowlist in one compose file.
backend_env_keys() {
  awk '
    /^  [a-zA-Z0-9_-]+:/ { in_backend = ($0 ~ /^  backend:/); in_env = 0 }
    in_backend && /^    [a-zA-Z0-9_-]+:/ { in_env = ($0 ~ /^    environment:/) }
    in_backend && in_env && /^      - [A-Z][A-Z0-9_]*=/ {
      line = $0; sub(/^      - /, "", line); sub(/=.*/, "", line); print line
    }
    in_backend && in_env && /^      [A-Z][A-Z0-9_]*:/ {
      line = $0; gsub(/^ +/, "", line); sub(/:.*/, "", line); print line
    }
  ' "$1" | sort -u
}

if [ "${1-}" = "--list" ]; then
  note "Documented keys that Settings binds (the contract):"
  # shellcheck disable=SC2086
  printf '%s\n' $contract | sort | sed '/^$/d;s/^/  /'
  note ""
  note "Exemptions (documented + a Settings field, but deliberately NOT forwarded):"
  printf '%s\n' "$EXEMPT_LIST" | sed '/^$/d;s/^/  - /'
  note ""
  for f in $COMPOSE_FILES; do
    note "$f backend environment: $(backend_env_keys "$ROOT/$f" | tr '\n' ' ')"
  done
  exit 0
fi

for f in $COMPOSE_FILES; do
  [ -f "$ROOT/$f" ] || { note "✗ $f not found"; fail=1; continue; }
  present="$(backend_env_keys "$ROOT/$f")"
  for key in $contract; do
    is_exempt "$key" && continue
    if ! printf '%s\n' "$present" | grep -qx "$key"; then
      # Name the file that made the promise — a message that guesses the source
      # is the same "claim not measured" defect this check exists to prevent.
      # shellcheck disable=SC2086
      src="$(grep -lw "$key" $existing_docs 2>/dev/null | sed "s|^$ROOT/||" | tr '\n' ' ')"
      note "✗ $f — backend service never receives \$$key, but it is promised by: ${src:-documentation}"
      note "    add:  - $key=\${$key:-<default>}   to the backend service's environment:"
      note "    (or, if it is deliberately not container-configurable, add it to EXEMPT_LIST with a reason)"
      fail=1
    fi
  done
done

if [ "$fail" -eq 0 ]; then
  n="$(printf '%s' "$contract" | wc -w | tr -d ' ')"
  note "✓ compose env contract OK — all $n documented backend knobs reach the container in both compose files"
fi
exit "$fail"
