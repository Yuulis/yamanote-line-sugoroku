#!/usr/bin/env bash
# usage: tokyo-suburban-s5-verify.sh <label>  — lead verification for S5 runs
cd /home/yuulis/yamanote-line-sugoroku
label=$1; shift
uv run ruff check scripts tests >/dev/null && uv run ruff format --check scripts tests >/dev/null && uv run ty check scripts/data_pipeline >/dev/null && echo PY-LINT-OK || echo PY-LINT-FAIL
uv run pytest tests/data_pipeline -q -rs 2>&1 | grep -E "passed|failed|SKIP|error" | tail -3
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py | tail -1
npm run typecheck >/dev/null 2>&1 && echo TS-TYPECHECK-OK || echo TS-TYPECHECK-FAIL
npm test 2>&1 | grep -E "Tests +[0-9]|Test Files" | tail -2
git diff --quiet -- data/staging/tokyo-suburban-jr data/staging/tokyo-suburban-nonjr data/staging/tokyo-suburban-assembled N02-25_GML && echo STAGING-CLEAN || echo STAGING-CHANGED
if grep -rlI $'\r' scripts tests src data/overrides public/data data/baselines 2>/dev/null | grep -q .; then echo CRLF-FOUND; else echo LF-OK; fi
python3 .claude/skills/_shared/verify_delegation.py --base HEAD --forbid-outside scripts --forbid-outside tests --forbid-outside src --forbid-outside data --forbid-outside public/data --forbid-outside .claude/docs --forbid-outside package.json --label "$label" | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ['placeholders','weakened_tests','out_of_scope_files','actionable_total']})"
