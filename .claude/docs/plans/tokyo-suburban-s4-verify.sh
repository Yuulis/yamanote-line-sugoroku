#!/usr/bin/env bash
# usage: tokyo-suburban-s4-verify.sh <label> [gate]  — lead verification for S4 runs
cd /home/yuulis/yamanote-line-sugoroku
label=$1; shift
uv run ruff check scripts/data_pipeline tests/data_pipeline >/dev/null && uv run ruff format --check scripts/data_pipeline tests/data_pipeline >/dev/null && uv run ty check scripts/data_pipeline >/dev/null && echo LINT-OK || echo LINT-FAIL
uv run pytest tests/data_pipeline -q -rs 2>&1 | grep -E "passed|failed|SKIP|error" | tail -3
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py | tail -1
python3 -c "import shutil;shutil.rmtree('.claude/logs/s4/live',ignore_errors=True)"
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s4/live --quiet && diff -r public/data .claude/logs/s4/live >/dev/null && echo LIVE-IDENTICAL || echo LIVE-DIFF
git diff --quiet -- public/data data/overrides data/staging/tokyo-suburban-jr data/staging/tokyo-suburban-nonjr src N02-25_GML && echo PROTECTED-CLEAN || echo PROTECTED-CHANGED
if grep -rlI $'\r' data/staging/tokyo-suburban-assembled 2>/dev/null | grep -q .; then echo CRLF-FOUND; else echo LF-OK; fi
if [ "${1:-}" = gate ]; then
  python3 -c "import shutil;shutil.rmtree('.claude/logs/s4/gate',ignore_errors=True)"
  uv run python -m scripts.data_pipeline.stage_suburban_assembly gate --out-dir .claude/logs/s4/gate 2>&1 | tail -2
  uv run python -m scripts.data_pipeline.stage_suburban_assembly audit --data-dir .claude/logs/s4/gate 2>&1 | tail -2
fi
python3 .claude/skills/_shared/verify_delegation.py --base HEAD --forbid-outside scripts/data_pipeline --forbid-outside tests/data_pipeline --forbid-outside data/staging/tokyo-suburban-assembled --forbid-outside data/README.md --forbid-outside .claude/docs --label "$label" | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ['placeholders','weakened_tests','out_of_scope_files','actionable_total']})"
