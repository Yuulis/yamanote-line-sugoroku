# keikyu-sotetsu non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`.

The group contains 8 frozen services, 106 stops, and 98 directed stop pairs. Primary-source operating mileage and source-pinned N02 station selectors are recorded in `length-refs.csv`, `length-ref-components.csv`, and each service's `stops.csv`. Pair evidence is in `pair-evidence.csv`.

Verification artifacts are under `.claude/logs/s3/keikyu-sotetsu/`. The group gate completed deterministic A/B builds, validation, and evidence checks; the preservation audit passed.
