## Verdict

**Fix first.** The shipped bundle and actual S7 observations are consistent with the approved rules, but clean-checkout reproducibility is broken and the S7 report checker accepts invalid evidence.

Reviewed `master` **4906c4a4** through HEAD **3e35b6f3** (merge base **8433519f**), plus tracked and untracked S7 working-tree changes. This is not release approval or a CI-success claim.

## Findings

1. **High — Frozen hashes depend on uncommitted CRLF bytes.**  
   **Locations:** `.claude/docs/plans/tokyo-suburban-s0-freeze.json:90`, `:92`, `:93`, `:98`, `:99`; `data/staging/tokyo-suburban-assembled/inputs-sha256.json:10`.  
   Five research inputs—`r1-jr-catalog`, `r1-pe-catalog`, `r1-pe-transfers`, `r1-sub-catalog`, `r1-sub-transfers`—are `i/lf w/crlf` despite `eol=lf`. Their frozen hashes match working-tree CRLF bytes, not committed LF bytes. For example, JR catalog records `e3831384…`, whereas `git show HEAD:<path>` hashes to `81756f0d…`.  
   **Reproduction:** substituted committed input bytes into the freeze check’s hashing function, without writing files; `check_freeze.main([])` returned **2**, “freeze baseline differs.” `verify_freeze()` likewise compares raw bytes, so fresh-checkout staging/product verification will reject these inputs. Current local gate success conceals this difference.  
   **Required fix:** normalize these working files to LF and refresh affected freeze/provenance hashes through an explicitly scoped correction. Preserve semantic inputs and gameplay payloads. Verify the resulting committed-byte snapshot, including downstream evidence freshness; add a regression comparing frozen hashes with checkout-stable bytes.

2. **Medium — The report checker does not authenticate bundle/source hashes or recheck frozen turns.**  
   **Locations:** `scripts/s7_simulation_report.py:116`, `:216`, `:307`.  
   Hash validation checks format and cross-shard bundle agreement only. It does not require the five expected bundle keys, compare hashes with current files, or compare source hashes between shards/current sources. The aggregator also never reads the S6 golden turns, contrary to lead adjustment 2.  
   **Reproduction:** invoked the real CLI entry point with file I/O intercepted in memory. It accepted all five reports with `bundleHashes={"bogus": "0"*64}` and `sourceHashes={"bogus": "0"*64}`. Separately, it accepted all game lengths changed to **501** with corresponding `turns` arrays.  
   **Required fix:** authenticate complete bundle/source inventories against current files, require consistent source fingerprints, and compare every observation seed/turn with verified S6 goldens. Add negative tests for uniformly stale hashes, differing source fingerprints, and altered turns.

3. **Medium — Failed lottery diagnostics still produce a successful report command.**  
   **Location:** `scripts/s7_simulation_report.py:326`.  
   `passesDiagnostic` is computed but never checked. The CLI enforces primary denominators ≥1,000, then writes output even when the statistical threshold fails. Neither the observer’s final assertions nor this CLI stops the pipeline for that condition.  
   **Reproduction:** set every game’s `targetSelections` to zero, preserving matching repeat records. The actual CLI entry point accepted 5,000 games and wrote a result with `targetShare.passesDiagnostic == false`.  
   **Required fix:** make failed required diagnostics return nonzero with an investigation message; check the reported equal-distance diagnostic when populated as well. Preserve diagnostic output and existing tolerances. Add CLI-level regression coverage.

4. **Low — Simulation documentation identifies the wrong configuration source.**  
   **Location:** `tests/simulation/README.md:73`.  
   It says product configuration is loaded from the manifest. `tests/simulation/measurement.test.ts:28` actually selects imported `MVP_GAME_CONFIG`; the manifest contains no gameplay configuration.  
   **Required fix:** name `src/features/game/gameConfig.ts` as the configuration source and describe the manifest as bundle identity/presentation metadata.

## Checklist

| # | Status | Evidence |
|---|---|---|
| 1 | **Finding** | S0–S6 acceptance has substantive catalogs, staging evidence, regression tests and prior reviews on disk. S7 acceptance remains incomplete because of findings 1–3 and absent completed full-pytest evidence at review time. |
| 2 | **Pass** | `MVP_GAME_CONFIG` matches frozen `tokyo-suburban-1`: target share 2/3, direction weight 2, unchanged goal. Save/replay code and rejection/discard tests retain substantive checks. `git diff HEAD -- src` contains exactly the specified EOF blank-line removal. |
| 3 | **Finding** | Actual reports independently recompute to the saved summary; every recorded source/bundle hash matches disk, and every observation turn matches S6. All 5,000 games complete, maximum 446, zero recorded violations. Target **78,731/117,785**, toward **112,531/168,691**, equal-distance **24,452/48,904**; all diagnostics pass. Independent fixpoint distances and independently calculated weights are present. Checker enforcement is deficient: findings 2–3. |
| 4 | **Pass** | Reviewed Korakuen transfer, explicit candidate labels, service marker, popup/small-ヶ, next hop, actual clearing turn, results/reload/restart, Oedo arrival/next hop, and strengthened save-discard checks. Three pinned-save hashes and all bundle provenance hashes match. Worker evidence records two passes each at 1/2 workers, failures at 4, and two full runs of **121 passed / 2 skips** at the new default. |
| 5 | **Pass, focused review** | Branch inventories and focused source/test diffs revealed no additional placeholders, silent error suppression, hardcoded implementation substitutes or unrelated S7 product edits. Existing browser checks are retained/strengthened. Raw-data and measurement skips are conditional; phone-only project skips remain explicit. This was not a line-by-line audit of all 3,236 committed files. |
| 6 | **Pass** | Four gameplay payloads equal `c76ad92`; manifest and protected staging/baseline/raw paths equal `478e3ca`. History includes the documented S4 provenance corrections and S5 historical archive; no S7 protected-path change exists. Finding 1 will require a separately scoped provenance correction. |
| 7 | **Finding** | Current-tree freeze, historical verification, raw checksums and S6 simulation verification pass independently. Lead `verify`/`verify-inputs` logs report verified inputs and reproducibility evidence. Committed input bytes fail freeze verification: finding 1. |
| 8 | **Finding** | Five changed research CSVs retain CRLF in the working tree: finding 1. Other scanned changed text is LF. Glyph README records pinned Noto Sans JP origin/hash, OFL link and generation parameters. MLIT attribution remains in manifest/data docs. All **134** color rows pass the pinned schema/checksum validator. |
| 9 | **Finding** | Measured bundle/UI counts and simulation results match current docs; historical manuals/addenda remain marked and retained. Checked manual/README relative links exist. Configuration-source statement needs finding 4’s correction. |
| 10 | **Pass** | Vercel delivery, physical-device performance/touch-pan, the 1.32 MB main chunk and local WebKit exclusion are explicitly recorded. Local delivery evidence distinguishes decoded identity from deployed compression. No release or CI success is claimed. |

## Checks run

- Git status, branch/working diffs, file inventories, protected-path comparisons, history, and changed-text line-ending scan.
- Freeze verification against current files: **pass**; against committed input bytes in memory: **fail, exit 2**.
- `product_suburban verify-history`: **verified**.
- `product_suburban verify-simulation --shard-dir .claude/logs/s6/simulation/s6-fix`: **verified**, 5,000 games, zero per-seed/distribution mismatches.
- `sha256sum --check data/n02-2025.sha256`: **both pass**.
- Independent S7 aggregation, current hash comparisons, golden-turn comparisons and pinned-save provenance checks: **pass**.
- Three in-memory CLI negative probes: invalid evidence incorrectly accepted, as detailed above.
- `.venv/bin/python -B -m pytest -s -q -p no:cacheprovider tests/data_pipeline/test_s7_simulation_report.py`: **7 passed**. Initial invocation with default capture could not create temporary files in the read-only sandbox; disabling capture resolved it.
- Color-table validation: **134 rows pass**.
- `git diff --check master...HEAD` remains nonzero for documented Markdown hard breaks and the committed EOF blank line; the S7 working diff removes that blank line. Markdown hard breaks are not treated as defects.

## Not verified

- No Playwright, full pytest suite, production build, or fresh full product rebuild was run by this reviewer.
- At the final evidence check, `.claude/logs/s7/gates/pytest.log` ended after **81%**, and `summary.txt` had no pytest completion entry. Obtain the completed result before closing S7.
- Original external font/color sources were not fetched; provenance records, citation presence and pinned color checksum were inspected.
- Fresh-checkout executable gates must pass after the hash correction. Fixes require a final independent review of the resulting snapshot.
- CI/WebKit execution, Vercel delivery and physical devices remain unverified S8/follow-up work.
