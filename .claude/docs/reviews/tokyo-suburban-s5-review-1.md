## Verdict

**fix first** — one blocking test regression. The product bundle, frozen rules, save rejection, and exact simulation comparison passed review.

## Blocking findings

- **Browser fixture proofs use different rules from the browser.**  
  **Locations:** `tests/unit/e2e-fixture-seeds.test.ts:8`, `tests/e2e/lottery.spec.ts:12`, `tests/e2e/full-game.spec.ts:46`.  
  The unit trajectory proof now uses `LEGACY_CAPITAL_REGION_CONFIG`, while the browser uses `MVP_GAME_CONFIG` with the same fixture seed. I independently executed that fixture through the actual engine under production rules: seed `00000000000000000000000000000009` stays on Yamanote after turn 1 and completes at turn **8**. The browser specs require a turn-1 transfer to `fixture-south` and completion at turn **15**, so their assertions necessarily fail. The passing legacy proof no longer validates the browser scenario.  
  **Fix:** retain legacy goldens separately; establish production-rule seeds and corresponding unit/browser expectations that still exercise transfers, boundaries, termini, direction lotteries, and completion. Review the analogous capital-region fixture proofs switched to legacy configuration. Run the affected Playwright specs without weakening their behavioral coverage.

## Non-blocking

- **Ruleset fidelity:** every `MVP_GAME_CONFIG` field matches the freeze, including the explicit prose-goal mapping to `truncate-on-target-service`. Only the ruleset identifier and target share changed in production TypeScript; engine and persistence implementation are unchanged.
- **Save compatibility:** keeping schema/save version 3 and the storage key is correct. The captured old save has different data identity; restoration rejects data version before comparing rules. Existing persistence preserves rejected bytes, and the added browser test covers cancellation, reload, and confirmed discard. No migration or automatic deletion was introduced.
- **Reproducibility independently confirmed:** A/B comparison passed. A fresh, read-only, in-memory build with `PYTHONHASHSEED=31337` reproduced all five installed files byte-for-byte. The four payload hashes match accepted S4; only the manifest differs.
- **Historical integrity:** `verify_history()` and `verify()` passed. Archive selection after cutover checks both complete trees against saved baselines; a damaged archive cannot fall back to mismatching live product data. `_distance_reference` now uses that resolver.
- **Provenance refresh:** the assembled-stage diff contains exactly **16 hash-line replacements**, with no catalogue, pair measurements, sidecars, or five-file build hashes changed. The shared stable renderer preserves the previous implementation, and regression coverage checks all 1,087 accepted S3 recipe hashes.
- **Simulation independently verified:** `verify_simulation()` passed for all 5,000 original seeds, with **zero per-seed differences**, identical repeat measurement, median **55**, p90 **146**, p99 **261**, max **446**, and zero cap hits/over-500 games. Python recomputes statistics from raw turns and checks seeds, ranges, configuration, bundle hashes, and code fingerprints.
- Installed budgets passed: geometry **1,288,259 raw / 265,508 gzip bytes**; total **2,529,844 / 407,508**; **3,994** geometry references; maximum chain **3**.
- Freeze verification and `git diff --check` passed. Full pytest/Playwright suites were not rerun during this read-only review; their run reports were inspected.

## Carry-overs for S6

- Use the verified identity/original-name metadata and UI-group sidecars for map/legend work. Display `toei-oedo-loop` and `toei-oedo-radial` as one **大江戸線** while retaining their engine identities and two-way non-target loop.
- Keep title **山手線すごろく**, set subtitle **東京近郊版**, and remove both previously specified notice sentences.
- Update the introductory copy too: `TitleScreen.tsx:132` still describes **40 JR services**, the old geographic scope, and **1/2** Yamanote probability.
- Resolve the documented 22 private-railway names containing large ケ as a display choice, preserving frozen identities.
- Close the browser-seed regression above before treating the existing unit goldens as evidence for current browser behavior.
