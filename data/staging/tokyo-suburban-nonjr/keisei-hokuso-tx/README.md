# keisei-hokuso-tx non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`. The group contains 10 frozen services, 132 stops, and 122 forward pairs.

Each stop selector pins its frozen `station_name_original` match to a raw N02 line and station code. Primary-source operating mileage and its arithmetic are recorded in `length-refs.csv` and `length-ref-components.csv`; the Narita Airport Line range is derived as 51.4 km minus the Hokuso 32.3 km section.

Verification status and the deterministic A/B build results are recorded in `.claude/logs/s3/keisei-hokuso-tx/gate-report.json`. Run the group's acceptance checks with:

```bash
uv run pytest tests/data_pipeline/test_staging_nonjr_keisei_hokuso_tx.py -q -rs
uv run python -m scripts.data_pipeline.stage_suburban_nonjr gate --operator-group keisei-hokuso-tx --out-dir .claude/logs/s3/keisei-hokuso-tx
uv run python -m scripts.data_pipeline.stage_suburban_nonjr audit --operator-group keisei-hokuso-tx --data-dir .claude/logs/s3/keisei-hokuso-tx
```
