# Chiba S6P stage — built and validated

This stage builds from the read-only raw N02 input and passes artifact validation under the
`stage` profile. It covers all 17 product services touching Chiba and the corresponding 152
Chiba stations. The stage start is Funabashi; the manifest is staging-only and is not live game data.

The frozen product-catalogue oracle remains the sole source of staged service order and stop lists.
Both raw-N02 builds are deterministic, the built output matches the oracle exactly, and all 152
stations are reachable from Funabashi and can return there. Full route evidence, measurements and
acceptance outputs are in the [Chiba stage evidence](../../../../.claude/docs/research/jr-east-capital-region-s6p-chiba.md).

The six Tokyo enclave stations 成瀬・町田・高尾 and 綾瀬・亀有・金町, plus prefecture-split
Yokohama and Chuo Main Line runs, are deferred to the combined four-prefecture S6 dataset per the
lead decision. The cross-border inventory is in `cross-border-pairs.csv`; its Ibaraki neighbours
remain scope-only and outside the approved playable extent.

Raw-free integrity tests load the complete overrides through the normal loader and verify the stage
profile, oracle hash, service scopes, composition recipes and stop-topology reachability:

```bash
uv run pytest tests/data_pipeline/test_staging_chiba.py
```

Do not copy this staging dataset to live `data/overrides`; combine and review it with the other S6
prefecture stages first.
