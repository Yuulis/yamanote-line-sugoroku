#!/usr/bin/env bash
# usage: s2verify.sh <label> [region...]   — lead verification for S2 runs
cd /home/yuulis/yamanote-line-sugoroku
label=$1; shift
uv run ruff check scripts/data_pipeline tests/data_pipeline >/dev/null && uv run ruff format --check scripts/data_pipeline tests/data_pipeline >/dev/null && uv run ty check scripts/data_pipeline >/dev/null && echo LINT-OK || echo LINT-FAIL
uv run pytest tests/data_pipeline -q -rs 2>&1 | grep -E "passed|failed|SKIP|error" | tail -3
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py | tail -1
python3 -c "import shutil;shutil.rmtree('.claude/logs/s2/live',ignore_errors=True)"
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s2/live --quiet && diff -r public/data .claude/logs/s2/live >/dev/null && echo LIVE-IDENTICAL || echo LIVE-DIFF
git diff --quiet -- public/data data/overrides src N02-25_GML && echo PROTECTED-CLEAN || echo PROTECTED-CHANGED
for region in "$@"; do
  stage="data/staging/tokyo-suburban-jr/$region/overrides"; out=".claude/logs/s2/$region"
  python3 -c "import shutil;[shutil.rmtree(p,ignore_errors=True) for p in ('$out-a','$out-b')]"
  uv run pytest "tests/data_pipeline/test_staging_suburban_${region}.py" -q -rs 2>&1 | tail -1
  uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir "$stage" --out-dir "$out-a" --quiet || echo "BUILD-A-FAIL $region"
  uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir "$stage" --out-dir "$out-b" --quiet || echo "BUILD-B-FAIL $region"
  diff -r "$out-a" "$out-b" >/dev/null && echo "AB-IDENTICAL $region" || echo "AB-DIFF $region"
  uv run python -m scripts.data_pipeline.validate --overrides-dir "$stage" --data-dir "$out-a" 2>&1 | tail -1
  uv run python -m scripts.data_pipeline.stage_suburban_jr audit --region "$region" --data-dir "$out-a" 2>&1 | tail -2
done
python3 .claude/skills/_shared/verify_delegation.py --base HEAD --forbid-outside scripts/data_pipeline --forbid-outside tests/data_pipeline --forbid-outside data/staging --forbid-outside data/README.md --forbid-outside .claude/docs --label "$label" | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ['placeholders','weakened_tests','out_of_scope_files','actionable_total']})"
