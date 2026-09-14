#!/usr/bin/env bash
# check_env_example_complete.sh — backend/.env.example documents EXACTLY the
# knobs `backend/app/config.py` consumes (#61, PR #418 review round 1 major 4).
#
# The 74/74 state this guards was hand-verified once; without a gate it decays
# silently on the very next `Settings` field — the same failure shape
# `check_compose_env.sh` closed for the knob→container leg (#296/#297/#298).
# This closes the config.py→sample leg:
#   - a Settings field with no `KEY=` line in the sample  → MISSING  → red
#   - a `KEY=` line naming no Settings field              → ORPHAN   → red
#     (an orphan is a renamed/removed field still documented — a forker sets
#     it and nothing happens, the worst kind of sample)
#
# The env name for a field is its `validation_alias` when one is declared,
# else the UPPERCASED field name (pydantic-settings matches field names
# case-insensitively; the sample writes them uppercase). Parsed with stdlib
# `ast`, not by importing the app — no venv, no pydantic, runs anywhere
# python3 exists (same reasoning as the reviewer's own 74/74 measurement).
#
# Usage: bash scripts/check_env_example_complete.sh [CONFIG_PY] [ENV_EXAMPLE]
#   (the operands exist for the self-test's fixtures; CI and the pre-push
#    gate run it bare against the real pair)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-$ROOT/backend/app/config.py}"
SAMPLE="${2:-$ROOT/backend/.env.example}"

[ -f "$CONFIG" ] || { echo "FAIL: $CONFIG not found" >&2; exit 1; }
[ -f "$SAMPLE" ] || { echo "FAIL: $SAMPLE not found" >&2; exit 1; }

python3 - "$CONFIG" "$SAMPLE" <<'PY'
import ast, re, sys

config_path, sample_path = sys.argv[1], sys.argv[2]

tree = ast.parse(open(config_path).read(), filename=config_path)
settings = next(
    (n for n in ast.walk(tree)
     if isinstance(n, ast.ClassDef) and n.name == "Settings"),
    None,
)
if settings is None:
    print(f"FAIL: no `class Settings` found in {config_path}", file=sys.stderr)
    sys.exit(1)

expected = {}  # env name -> field name
for node in settings.body:
    if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
        continue
    field = node.target.id
    if field == "model_config":
        continue
    alias = None
    if isinstance(node.value, ast.Call):
        for kw in node.value.keywords:
            if kw.arg == "validation_alias" and isinstance(kw.value, ast.Constant):
                alias = kw.value.value
    expected[alias or field.upper()] = field

documented = set()
for line in open(sample_path):
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
    if m:
        documented.add(m.group(1))

missing = sorted(set(expected) - documented)
orphans = sorted(documented - set(expected))

for k in missing:
    print(f"  ✗ MISSING: Settings field `{expected[k]}` (env `{k}`) has no line in {sample_path}", file=sys.stderr)
for k in orphans:
    print(f"  ✗ ORPHAN: `{k}=` in {sample_path} names no Settings field — renamed or removed?", file=sys.stderr)

if missing or orphans:
    print(f"FAIL: backend env sample out of sync ({len(missing)} missing, {len(orphans)} orphan)", file=sys.stderr)
    sys.exit(1)

print(f"ok: {len(expected)} Settings knobs all documented, no orphans ({sample_path})")
PY
