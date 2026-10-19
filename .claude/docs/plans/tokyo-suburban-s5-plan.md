# S5 implementation plan — final bundle, ruleset, saves (Codex Sol `low`, 2026-10-18)

Source: `.claude/logs/codex/20261018T041420Z-s5-plan.md` (kept verbatim below).

## Lead adjustments (binding; override the plan body where they differ)

1. **REVIEW.md is restored** (commit after `b636ff5`, "restore the S4 assembled-stage REVIEW.md"): the lead's post-review
   rebuild of A deleted the uncommitted file; it was regenerated from committed artifacts. S5 does not need to recover it;
   drop that carry-over item.
2. Dataset `operator` / `areaName` are not rendered by the app (`src/data/guards.ts:83` only checks non-empty). The plan's
   values are acceptable; S5 must not add any UI copy (title/notice/legend are S6).
3. STOP conditions (report with evidence, never widen): any simulation difference from the frozen chosen case (median 55,
   p90 146, p99 261, max 446, 0 cap hits) or per-seed difference where shards exist; any change to accepted S2/S3/S4
   evidence hashes or five-file hashes; any budget overrun; any A/B difference.
4. Per-seed shard comparison applies only if the original R2 shards exist on disk; if they do not, report that and
   compare the 5,000-game distribution exactly.
5. Codex fast mode (`--config service_tier=fast`) may be used for runs. Lead verifier:
   `.claude/docs/plans/tokyo-suburban-s5-verify.sh <label>`.
6. E2E: use the repo's existing Playwright config and npm scripts; under WSL2 prefer `localhost` over `127.0.0.1` if the
   dev server stalls (known quirk), and never `pkill -f`.

---

## TL;DR
- Rebuild the five product files from audited S4 overrides; install only the frozen `tokyo-suburban-1` rules.
- Retain manifest schema 3, save version 3 and the existing storage key; test dataset/ruleset rejection and explicit discard.
- Preserve historical staging baselines before replacing live data. Keep all UI presentation work in S6.

## Contract diff

| Contract | Before | After |
|---|---|---|
| `data/overrides/**` | 40 services, 472 stations, capital-region scope | Reproducibly derived S4 catalogue: 135 services, 1,586 stations, 2,142 stops |
| `public/data/*` | Capital-region five-file bundle | Fresh product build; 3,988 directed segments, including exactly 30 target segments |
| Manifest | `schemaVersion: 3`, content-derived `dataVersion` | Same schema; new content-derived version; no stage fields |
| `src/types/{data,network}.ts` | Existing station/service/segment/config/state shapes | Unchanged |
| `MVP_GAME_CONFIG` | `jr-east-capital-1`, target share 1/2 | `tokyo-suburban-1`, target share 2/3 |
| Save format/storage | `SAVE_VERSION = 3`; `yamanote-line-sugoroku:save:v1` | Unchanged; incompatible contents remain discoverable |
| S6 inputs | S4 identity, original-name and UI-group sidecars | Verified, retained authoring inputs; no browser schema extension or UI consumption in S5 |

Do not change title, notices, legend, camera, labels, or Oedo display grouping.

## Product build

- Add `scripts/data_pipeline/product_suburban.py` with subcommands specified below; tests must precede implementation.
- Inputs: freeze and its verified research hashes; S4 overrides, expected catalogue, verification and consumed sidecars; pinned N02 files.
- `prepare --out-dir DIR`: verify inputs, copy S4 overrides, then transform only dataset configuration:
  `validationProfile="gameplay"`, remove `stageStartStationId`, set frozen start/target, and replace staging metadata with
  `operator="Tokyo suburban rail operators"`, `areaName="Tokyo suburban rail"`; retain S4 `updatedAt`, scopes, catalogue hash, budgets and 1 m simplification.
- Preserve per-service operators, stop order, selectors, geometry recipes and exceptions exactly. Emit a provenance report enumerating every transformed field.
- `verify-inputs`: validate source semantics and hashes; reject missing, stale, additional or inconsistent consumed records.
- Build with `uv run python -m scripts.data_pipeline.build --overrides-dir DIR --out-dir OUT`.
- Validate with `uv run python -m scripts.data_pipeline.validate --overrides-dir DIR --data-dir OUT`.
- Build A/B under different `PYTHONHASHSEED` values. Compare all five files byte-for-byte, recompute their SHA-256 hashes and manifest content hash.
- Require four payload hashes to equal S4 `verification.json` build A hashes; only the manifest changes from stage to product.
- `install`: verify first, then install generated overrides and freshly generated five-file output; never edit/relabel a stage manifest.
- `verify`: check installed overrides against derivation, all runtime guards, frozen catalogue/order/counts, geometry references, reachability and budgets.
- Retain caps: geometry raw/gzip 1,572,864/460,800 B; five-file total raw/gzip 3,145,728/921,600 B; references 20,000; maximum chain 128.
- Report each file’s raw size and gzip level 9 size with `mtime=0`, totals, references and chain length. An overrun fails; do not raise caps.

## Ruleset

- Keep runtime rules in `src/features/game/gameConfig.ts`; retain the exported `MVP_GAME_CONFIG` name.
- Freeze-derived values: ruleset `tokyo-suburban-1`; target `jr-yamanote`; direction `1`; start `shimbashi`;
  kind weights local/rapid `1/1`; target share `2/3`; toward-target weight `2`.
- Keep `goalArrivalPolicy="truncate-on-target-service"`: this is the existing engine representation used by the frozen chosen case.
- Goal tests require all 30 outer directed segments, then arrival at Shimbashi; preserve existing truncation and endpoint semantics.
- Add a freeze-to-runtime assertion covering every field, including the prose-goal-to-engine-policy mapping.
- Test non-target Oedo loop travel in both directions; Yamanote remains the sole one-way target loop.
- Update historical product expectations using frozen catalogue evidence, including the circular-service segment formula; preserve old-edition regression coverage separately.

## Save incompatibility

- **No schema/save-version bump.** `export.build_manifest` already emits schema 3; the product payload shapes remain unchanged.
- `GameState` already stores `dataVersion`, complete config and RNG/history; `SAVE_VERSION` is already 3.
- `restoreGame` checks data version before config, and `sameConfig` compares ruleset id and every lottery/goal field.
- Persistence already maps `DATA_VERSION_MISMATCH` to `data-version` and `CONFIG_MISMATCH` to `rules`.
- Capture a valid pre-S5 save using the actual old bundle/config before replacement; retain it as a regression fixture with provenance.
- Test: actual old save → dataset rejection; current data plus old rules → config rejection; both mismatches → dataset rejection first.
- Test rule-field mismatches independently, not only the ruleset string.
- Test new-game mid-run/completed serialization, strict seeded restore, and identical continuation after restore.
- Storage tests assert rejected bytes survive reads/reloads; discard cancellation preserves them; confirmed discard removes them.
- Extend existing save-error E2E coverage with the old-edition fixture against real product data. Reuse existing messages/dialogs; no migration or automatic deletion.

## Simulation acceptance

- Historical `npm run sim` defaults use the old research preset’s 1/2 share; running that unchanged does **not** verify S5.
- Add explicit `SIM_CONFIG=product` support selecting `MVP_GAME_CONFIG`; retain historical presets unchanged.
- Add an S5 measurement test using `loadShippedBundle`, production config, `gameSeed`, `runGame` and `summarizeTurns`.
- Use 5,000 seeds `s1m-20261012-0` through `s1m-20261012-4999`, cap 20,000, nearest-rank quantiles.
- Compare against frozen `target-two-thirds`: median 55, p90 146, p99 261, max 446, zero cap hits and zero above 500.
- **Tolerance: zero turns**, including per-seed turn counts against the original chosen-case shards.
  The catalogue order, gameplay topology, policy and independent seeds are unchanged; geometry/display metadata do not justify statistical drift.
- Verify gameplay signatures before measurement: ordered service ids/stops, kinds, circularity, endpoints and directed adjacency.
- Report raw turns, seed-set hash, full config, bundle hashes and code fingerprint; independent aggregation rejects gaps, overlaps and stale shards.
- Four 1,250-game shards may run independently. Repeat one shard exactly, excluding runtime fields from deterministic comparison.
- Retain full-history save/replay checks separately because measurement intentionally discards history.

## Carry-over closure

- Product `targetServiceId` must flow through existing `DatasetOverride.directed_segment_target_service_id` into export and validation.
  Test explicit product configuration with no stage fallback.
- Move `_stable_repr` into `stage_suburban_support.py`; import it from S4 evidence and use it for every recursive `repr` field in
  `stage_suburban_nonjr._filter_recipe_hash`. Preserve set-free rendering.
- Prove synthetic multi-member frozenset hashes agree across processes; compare every real S3 recipe hash before/after.
- Rebuild S3 outputs and require unchanged five-file hashes. If historical evidence hashes change, stop and report the affected records;
  do not remeasure or overwrite accepted evidence silently.
- Validate shared-track review against recomputed candidates/approved composition; require 1,289 reviewed candidates and zero open.
- Validate UI groups against freeze; identity/original-name metadata against frozen catalogue/audit; mileage references/components against pinned S2/S3 inputs and arithmetic.
- Add tampering tests for each sidecar category, including endpoint identity and the airport mileage subtraction.
- Historical S2/S3/S4 checks compare live paths to saved old-edition baselines. Before replacement, archive old overrides/public data under
  `data/baselines/jr-east-capital-region/`, sourced from commit `b636ff57d914d325c1b324405042c633310f4d2c`.
- Add a shared historical-baseline resolver: use the archive only when its complete tree hashes match saved staging baselines;
  retain live baseline checks before cutover. Route historical preservation comparisons through it, with tampering/missing-file tests.
- Preserve old-edition tests by directing their fixtures to that archive; add separate installed-product assertions.
- Requested `data/staging/tokyo-suburban-assembled/REVIEW.md` is absent. Recover its actual reviewed source/history or document the evidence gap;
  do not fabricate a review or treat the handoff’s reference as proof.

## Runs

All runs: failing test first, minimal implementation, then passing checks; LF-only output. Each is bounded to roughly 30 minutes.
Commands below naming new modules/subcommands define their required implementation interface.

1. **R1 — shared helpers and historical baseline, dedicated early run; sequential.**
   Files: shared support, S3 hash function, S4 evidence/baseline consumers, historical test fixtures, baseline archive.
   Add deterministic-hash and baseline-tampering tests; preserve existing comparisons and original accepted evidence.
   Acceptance: `uv run pytest tests/data_pipeline`; `uv run ruff check scripts tests`; `uv run ty check`.
   Also: `uv run python -m scripts.data_pipeline.product_suburban verify-history` once R2 supplies that command.
   If R1 exceeds its bound, split baseline support from hash stabilization; complete both before product cutover.

2. **R2 — reproducible preparation and sidecar verification; after R1.**
   Files: new product module/support as needed, `tests/data_pipeline/test_suburban_product.py`, `data/README.md`.
   Implement `verify-history`, `verify-inputs`, `prepare`, `compare`, `verify`, `install`; negative tests cover every contract above.
   Acceptance: `uv run pytest tests/data_pipeline/test_suburban_product.py`; `uv run ruff check scripts tests`; `uv run ty check`.
   Run `uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py`.
   Run `uv run python -m scripts.data_pipeline.product_suburban verify-history`.
   Run `uv run python -m scripts.data_pipeline.product_suburban verify-inputs`.

3. **R3 — runtime rules/save regressions; can be authored in parallel with R2, integrate sequentially.**
   Files: `gameConfig.ts`, policy/persistence/real-data unit specs, old-save fixture, existing save-error E2E spec.
   Preserve old seeded golden cases against archived bundle/config; independently establish new frozen golden cases.
   Acceptance after R4: `npm test`; `npm run typecheck`; `npx playwright test tests/e2e/save-errors.spec.ts`.

4. **R4 — product A/B builds and installation; after R1–R2, integrate R3.**
   Files: generated `data/overrides/**`, five `public/data/*`, verification reports.
   `uv run python -m scripts.data_pipeline.product_suburban prepare --out-dir .claude/logs/s5/overrides`
   `PYTHONHASHSEED=1 uv run python -m scripts.data_pipeline.build --overrides-dir .claude/logs/s5/overrides --out-dir .claude/logs/s5/a`
   `PYTHONHASHSEED=777 uv run python -m scripts.data_pipeline.build --overrides-dir .claude/logs/s5/overrides --out-dir .claude/logs/s5/b`
   `uv run python -m scripts.data_pipeline.validate --overrides-dir .claude/logs/s5/overrides --data-dir .claude/logs/s5/a`
   Repeat validation with `--data-dir .claude/logs/s5/b`.
   `uv run python -m scripts.data_pipeline.product_suburban compare --a .claude/logs/s5/a --b .claude/logs/s5/b`
   `uv run python -m scripts.data_pipeline.product_suburban install --overrides-dir .claude/logs/s5/overrides --data-dir .claude/logs/s5/a`
   `uv run python -m scripts.data_pipeline.product_suburban verify`
   Split A and B execution into separate runs if required; neither may reuse the other’s build output.

5. **R5 — simulation tooling; authorable in parallel with R2/R3, measurements after R4.**
   Files: simulation measurement/harness integration, new S5 measurement test and independent Python verifier.
   Implement `SIM_CONFIG=product`, `S5_OFFSET`, `S5_GAMES`, `S5_OUTPUT`; dedicated test reads `SIM_BUNDLE`.
   Acceptance: `npm test -- tests/unit/simulation-harness.test.ts`.
   `SIM_BUNDLE=public/data SIM_CONFIG=product SIM_GAMES=200 npm run sim -- tests/simulation/measurement.test.ts`
   `SIM_BUNDLE=public/data S5_OFFSET=0 S5_GAMES=1250 S5_OUTPUT=.claude/logs/s5/sim-0.json npm run sim -- tests/simulation/suburban-product.test.ts`
   Repeat with offsets/output suffixes 1250, 2500, 3750; these four measurement runs are parallelizable.
   Repeat offset 0 to `sim-repeat.json`; verify via `uv run python -m scripts.data_pipeline.product_suburban verify-simulation`.

6. **R6 — integration evidence; sequential final run.**
   `uv run pytest tests/data_pipeline`; `uv run ruff check scripts tests`; `uv run ty check`; `npm test`; `npm run build`.
   `uv run python -m scripts.data_pipeline.product_suburban verify-history`
   `uv run python -m scripts.data_pipeline.product_suburban verify`; `git diff --check`.
   Rerun S4 gate/audit/handoff against the verified historical baseline through its resolver; retain all existing acceptance assertions.
   Record hashes, sizes, simulation results, commands and missing review evidence in the S5 handoff; inspect complete diff for scope and weakened tests.

## Risks
- Historical baseline coupling can invalidate staging checks after cutover; close it before replacing live paths.
- A/B or simulation differences indicate a contract/order/hash defect; investigate rather than widening tolerance.
- Missing original shards or S4 review evidence must be reported explicitly; summaries alone cannot prove per-seed/review acceptance.
- Budget overruns block installation. Device/map performance remains S6/S7 work.

## Decisions needing the user
- None. The edition, rules, save policy and S6 presentation scope are already decided.
