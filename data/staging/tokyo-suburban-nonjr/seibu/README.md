# seibu non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`.

Enter primary-source operating-mileage evidence in `length-refs.csv` and `length-ref-components.csv`, then complete the reviewed stop selectors and route mappings before running `measure-pairs`. Verification status belongs in the group verification log under `.claude/logs/s3/seibu/`; this README records only the log pointer.
