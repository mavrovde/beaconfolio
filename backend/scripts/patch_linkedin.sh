#!/bin/bash
set -e

# patch_linkedin.sh
# Patches linkedin-api to remove entry_points.txt which causes conflicts
# ("Invalid script entry point (lint = black:None)" — pip rejects the wheel).
#
# The version is DERIVED from requirements.txt so the pin exists in exactly
# ONE place (#381): bumping the requirement is the whole change — this script
# and backend/Dockerfile (which runs this script) both follow it. Before #381
# the filename was hardcoded here AND inlined in the Dockerfile, so a bump
# was a multi-edit change and the Snyk job would redden on the stale copy.
#
# Usage: bash scripts/patch_linkedin.sh [path/to/requirements.txt]
# (default: requirements.txt in the current directory — both call sites run
# from backend/.)

REQ="${1:-requirements.txt}"
# sed -n …p: a line whose version part is NOT numeric-dotted simply doesn't
# print, so it falls into the guard below instead of passing the raw line
# through into $VER and dying later inside pip (#408 review round 1).
VER="$(sed -nE 's/^linkedin-api==([0-9][0-9A-Za-z.]*).*$/\1/p' "$REQ" | head -1)"
if [ -z "$VER" ]; then
  echo "patch_linkedin.sh: no 'linkedin-api==<version>' pin found in $REQ" >&2
  exit 1
fi
WHEEL="linkedin_api-${VER}-py3-none-any.whl"
echo "patch_linkedin.sh: patching ${WHEEL} (pin from ${REQ})"

pip download "linkedin-api==${VER}" --no-deps -d /tmp/wheels
if [ ! -f "/tmp/wheels/${WHEEL}" ]; then
  # The wheel filename convention broke (upstream repackaged?) — say which
  # file WAS downloaded rather than failing on a mystery path later.
  echo "patch_linkedin.sh: expected /tmp/wheels/${WHEEL}, found:" >&2
  ls /tmp/wheels >&2 || true   # under set -e a failed ls would pre-empt exit 1
  exit 1
fi
mkdir -p /tmp/patched
WHEEL="$WHEEL" python - <<'PY'
import os, zipfile
wheel = os.environ["WHEEL"]
zin = zipfile.ZipFile(f"/tmp/wheels/{wheel}", "r")
zout = zipfile.ZipFile(f"/tmp/patched/{wheel}", "w")
for i in zin.infolist():
    zout.writestr(i, b"" if i.filename.endswith("entry_points.txt") else zin.read(i.filename))
zin.close()
zout.close()
PY
pip install "/tmp/patched/${WHEEL}" && rm -rf /tmp/wheels /tmp/patched
