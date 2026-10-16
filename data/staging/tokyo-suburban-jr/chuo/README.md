# chuo JR staging dataset

This stage starts from the shipped overrides and the hash-verified frozen JR catalog. It is isolated from `data/overrides` and `public/data`.

The shipped Chuo Main Line pairs remain unchanged. Their three platform candidates are pinned by the baseline build's JR East station codes (`004029`, `004148`, and `004156`) so the new routing cannot move their published geometry.

New stop pairs in `line_mapping.csv` carry the frozen catalog N02 line when it is unambiguous. Their `via`, `route`, and `compose` cells are intentionally empty: the region run must make those decisions from N02 route evidence. Existing shipped rows remain byte-for-byte unchanged.

Run `uv run python -m scripts.data_pipeline.stage_suburban_jr measure-pairs --region chuo` after the region has added its reviewed route and junction data. It writes `pair-evidence.csv` and `length-refs.csv`; new-service official distances are checked against raw N02 path sums with the fixed 1.5 km tolerance. The measured pair evidence records the JR East source candidates and single-pair raw N02 routes.

Added pairs are measured without shipped allow rows for an extended service: those rows enumerate the shipped route only. Shipped deny rows still apply. Rows first written in this stage apply either service-wide or to their declared `(from_id, to_id)` pair interval and must be found near an added pair. Limit an inherited allow list to the shipped stop interval before adding range-specific rules; the normal build and this measurement command resolve the same pair filter.
