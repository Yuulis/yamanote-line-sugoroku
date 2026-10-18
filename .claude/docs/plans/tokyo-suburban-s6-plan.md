# S6 implementation plan — larger-network UI (Codex Sol `low`, 2026-10-18)

Source: `.claude/logs/codex/*s6-plan.md` (kept verbatim below).

## Lead adjustments (binding; override the plan body where they differ)

1. Joined display labels (`浜松町・大門`, `後楽園・春日`) follow the approved design (`tokyo-suburban-network-design.md` §3:
   "curated canonical labels plus aliases such as 後楽園・春日 … Do not display only a representative's name"). The registry
   `name` stays the canonical name (S4 adjustment 1); only the UI composes the label.
2. User decisions (2026-10-18, recorded in DESIGN.md Key Decisions):
   (a) large-ケ: option **B** — for the 22 private/subway names whose audited original spelling has small ヶ (つつじヶ丘, ひばりヶ丘,
   井土ヶ谷, 向ヶ丘遊園, 富士見ヶ丘, 市ヶ谷〈都営〉, 幡ヶ谷, 恋ヶ窪, 新百合ヶ丘, 新鎌ヶ谷, 桜ヶ丘, 梅ヶ丘, 狭山ヶ丘, 百合ヶ丘, 祖師ヶ谷大蔵,
   聖蹟桜ヶ丘, 芦ヶ久保, 鎌ヶ谷, 鎌ヶ谷大仏, 鐘ヶ淵, 霞ヶ関〈東武〉, 鶴ヶ島), display the audited original spelling as that
   service's stop name and in the station label when no JR service names the station; keep canonical IDs/registry names;
   keep the large-ケ form as a searchable alias; JR stations (e.g. 市ケ谷) keep JR spelling. No blanket ケ→ヶ replacement —
   drive it from `service-stop-metadata.csv` originals.
   (b) Oedo at 都庁前: one row 「大江戸線（抽選枠2）」 (Sol's proposal); engine lottery unchanged.
   (c) Intro copy: approved exactly as written in "Copy changes".
3. Watchdog: the lead checks every long run about every 5 minutes (PID liveness + log progress).
4. Fast mode allowed. Lead verifier: `.claude/docs/plans/tokyo-suburban-s5-verify.sh <label>` (+ Playwright where UI changes).
5. Restore the six real-bundle panel checks dropped in S5 (user instruction) — R5.
6. **Line colours (lead, after R1).** 94 of the 134 UI line groups are the staging default `#808080` (incl. 大江戸線). Add a
   curated, cited colour table (each operator's official line colour / line symbol colour; JR lines keep the colours already in
   the shipped data) used ONLY for `uiPresentation.lineGroups[].color` — the four gameplay payloads (`services.json` etc.) must
   stay byte-identical, so `dataVersion` and the S5 simulation fingerprints do not change. The map/legend (R4) draws line
   colours from the presentation resolver. Where an operator publishes no colour, record that and choose a distinguishable
   colour, marked `unofficial`. Run R1b (colours) in parallel with R2.

---

## TL;DR

- Ship S6 as presentation changes only: reproducible UI metadata, grouped/filterable legend, aliases, density-controlled labels, camera checks, and approved title/copy.
- Preserve all four S5 gameplay payloads byte-for-byte, engine identities, rules, `dataVersion`, and save version 3; add optional, validated UI metadata to the manifest.
- Execute the bounded runs below sequentially; only independent read-only verification may run in parallel. The large-ケ display policy requires a user decision.

## Bundle/UI contract

- Extend `Manifest` with optional `uiPresentation`, containing `version: 1`, `operators`, `lineGroups`, `stations`, and `serviceStopNames`. Keep the five-file bundle.
- `operators`: `{id, name}` records; use existing audited service `operator` values as stable grouping keys and display names.
- `lineGroups`: `{id, name, operatorId, color, serviceIds}`. Start from existing line/service metadata; apply the frozen `toei-oedo` replacement to its two services. Preserve other existing line groupings and ordering.
- `stations`: `{id, aliases}` for stations with distinct aliases only; canonical names remain in `stations.json`.
- `serviceStopNames`: `{serviceId, stationId, name}` only where the audited original stop name differs from the canonical station name. Avoid exporting source URLs, selectors, or complete research records.
- Derive metadata from verified `station-groups.json`, `service-stop-metadata.csv`, `ui-line-groups.json`, and existing exported services/lines. Verify sidecars before consuming them; never edit them.
- Add a small `product_suburban_presentation.py` builder and optional `uiPresentationFile`/`uiPresentationSha256` dataset settings. `product_suburban prepare` writes deterministic compact UI metadata into its prepared override tree.
- Extend dataset parsing and `export.build_files` to load/check that file and attach its parsed content to the manifest. Generic and historical builds without the setting retain their existing output.
- Extend `_check_derived_override_tree` to permit exactly those derived settings and the recomputed metadata file; retain all existing S4 source comparisons.
- `compare`, `install`, and `verify` must independently compare manifest UI metadata against recomputed audited expectations. Their existing four-payload S4 equality checks remain mandatory.
- Types/guards: update `src/types/data.ts`, `src/data/guards.ts`, and loading/application wiring. Reject malformed metadata when present; absence supports existing fixtures and archived bundles.
- Validate unique IDs, nonempty names, valid colors, referenced services/stations/operators, nonoverlapping explicit UI service groups, and service-stop membership. Test unknown IDs, duplicate membership, checksum mismatch, and altered aliases.
- Keep presentation metadata separate from engine indexes/configuration. Pass a presentation resolver/context to display helpers and map components.
- **Compatibility decision from this proposed diff:** only manifest and derived UI override inputs change. `manifest_inputs()` hashes the four gameplay files, so `dataVersion` stays unchanged; schema/save version and storage key stay at 3. No migration or automatic save deletion.
- Test a captured pre-S6/S5 save restoring unchanged, plus existing pre-S5 incompatible-save rejection. Assert four gameplay file hashes and gameplay signatures remain unchanged.
- Include the enlarged manifest in raw/gzip totals. Current S5 totals are 2,529,844 raw / 407,508 gzip bytes.
- Retain caps: GeoJSON 1,572,864 raw / 460,800 gzip; total 3,145,728 raw / 921,600 gzip; references ≤20,000; chain length ≤128. Current references/chain are 3,994/3.
- If metadata exceeds the remaining raw allowance, compact sparse records/serialization first; do not increase budgets or remove required aliases.

## Map & legend

- Retain the existing three GeoJSON sources and nine railway layers. Do not add per-service/operator layers or clone composed geometry.
- Build indexes once per immutable bundle: station→services, UI group→services, service→primitive feature IDs, and operator→groups.
- Filtering selects UI groups and resolves their primitive IDs through `segments.json`, including primitives owned by another service.
- Apply filters to both background railway line layers, so the base layer cannot leave excluded lines visible. Preserve current-service highlighting, target progress, and current position independently.
- Default all groups visible. Use operator `<details>` sections, line checkboxes, operator select-all with mixed state, and `すべて表示`.
- One Oedo checkbox controls both services. Filters affect map visibility only; lottery candidates and gameplay remain unchanged.
- Keep progress/current-position legend entries always visible. Collapse the route list initially for this large bundle; preserve the phone panel height limit and reachable dice button.
- Keep current location and target progress visible even if their ordinary legend group is unchecked; explain with `現在地・乗車中の路線・山手線の進捗は常に表示します。`
- Display merged station identities as canonical name plus distinct aliases, e.g. `浜松町・大門`, `後楽園・春日`. Never change frozen canonical names or IDs.
- Use the joined label in map labels/popups and station summaries/history. In service-specific directions/popups, retain the original service-stop name when it differs; deduplicate repeated names.
- Keep popup DOM construction through `textContent`.
- Keep one symbol layer: labels below zoom 11 hidden; zoom 11–<13 permits target/interchange labels; zoom ≥13 permits all stations.
- Explicitly retain collision handling (`text-allow-overlap: false`, `text-ignore-placement: false`); sort target labels before interchanges before ordinary labels, with stable station-order tie breaks.
- Supply priority/eligibility properties through `stationCollection.ts`; use zoom expressions in the existing label layer. Ordinary marker gating remains at 10.5.
- Initial new-game view fits Yamanote using existing panel-aware padding; resume follows the saved location. `全体` fits all service platforms and disables follow; `目標路線` restores target fit.
- Verify overview extremes including 白馬/長野/浪江/伊東 and mobile panel occlusion. Keep current minzoom 6 unless the projected fit test proves it prevents fitting; calculate the required lower bound rather than guessing.
- Density acceptance: at overview no station labels; at zoom 11.5 no ordinary-only labels; at 13.5 ordinary labels become eligible. Check collision-safe layouts at 新宿, 東京, 横浜, and 大宮 on desktop and phone.
- Render actual Japanese glyphs for density evidence. Existing hermetic map stubs must be checked for glyph availability; blank glyph responses cannot substantiate readability. Use a licensed local glyph fixture if necessary.

## Oedo single line

- Centralize UI service/group resolution; never rename or merge `toei-oedo-loop` and `toei-oedo-radial` in engine data.
- Resolve both names to exactly `大江戸線` in legend, station popups, ride panel, lottery result/candidates, title resume summary, and clear/history views.
- Deduplicate candidate **display rows** by UI group. Keep engine candidate IDs/order, draws, and probabilities unchanged.
- For lottery text, preserve truthful engine weighting: if both Oedo services are candidates, show `大江戸線（抽選枠2）`; count them as two `抽選枠`, never imply equal probability among distinct displayed lines.
- Retain current wording for candidate sets unaffected by grouping. Add grouped wording only where duplicate UI groups exist.
- Suppress `乗換` wording for an Oedo service-to-service transition within the same UI group; show direction changes as appropriate.
- Preserve the selected service’s direction labels and geometry highlighting; test loop directions and the radial endpoint separately.
- Search all UI `.name` accesses, including `gameSummary.ts` and `ClearScreen.tsx`, to prevent bypassing the resolver.

## Copy changes

- Title: `山手線すごろく`
- Subtitle: `東京近郊版`
- Replace the complete introductory paragraph with:
  > 新橋から出発し、東京近郊区間のJR線と対象の私鉄・地下鉄を乗り継ぐすごろくです。山手線外回り全30区間を踏破したあと、新橋に到着するとクリアです。サイコロの出目だけ駅を進み、到着駅で次に乗る路線を抽選します。山手線と他の路線がある駅では、3分の2の確率で山手線を選び、残りの確率を他の運行系統に均等に割り当てます。他の路線で方向を抽選するときは、山手線に近づく方向の抽選重みが反対方向の2倍になります。
- This avoids equating 135 engine services with UI line count and avoids the obsolete four-prefecture boundary.
- Delete both complete notice paragraphs:
  - `本作品は既存作品から着想を得た独立したオリジナルゲームです。`
  - `本作は東日本旅客鉄道株式会社および国土交通省とは関係のない、非公式のファンメイド作品です。`
- Preserve source/license/map credits. Update corresponding exact-text E2E expectations.

## Runs

Each run has a ≤30-minute bound; return changed files, commands/results, and unresolved failures. No protected-data edits, rule changes, weakened tests, commits, or deployment.

1. **R1 — reproducible UI metadata; sequential.**
   Files: dataset parser/model, `export.py`, `product_suburban.py`, new presentation builder, focused pipeline tests.
   Implement the contract above, deterministic export, source validation, product verification, and negative tests.
   Acceptance: `uv run pytest tests/data_pipeline/test_suburban_product*.py`; `uv run ruff check scripts tests`; `uv run ty check`.

2. **R2 — TS contract/resolvers and copy; after R1.**
   Files: `src/types/data.ts`, guards/loaders, presentation resolver, application wiring, `presentation.ts`, `gameSummary.ts`, title/panel/clear components, relevant unit tests.
   Implement optional metadata fallback, aliases, Oedo grouping, exact copy, and preserved-save regression.
   Acceptance: `npm test -- tests/unit/guards.test.ts tests/unit/loaders.test.ts tests/unit/game-presentation.test.ts tests/unit/game-app-state.test.ts tests/unit/persistence.test.ts`; `npm run typecheck`.

3. **R3 — generated bundle installation; after R1/R2.**
   Reuse S5’s permitted preparation location; do not modify the assembled staging tree.
   ```bash
   uv run python -m scripts.data_pipeline.product_suburban prepare --out-dir .claude/logs/s5/s6-overrides
   PYTHONHASHSEED=1 uv run python -m scripts.data_pipeline.build --overrides-dir .claude/logs/s5/s6-overrides --out-dir .claude/logs/s5/s6-a
   PYTHONHASHSEED=777 uv run python -m scripts.data_pipeline.build --overrides-dir .claude/logs/s5/s6-overrides --out-dir .claude/logs/s5/s6-b
   uv run python -m scripts.data_pipeline.validate --overrides-dir .claude/logs/s5/s6-overrides --data-dir .claude/logs/s5/s6-a
   uv run python -m scripts.data_pipeline.validate --overrides-dir .claude/logs/s5/s6-overrides --data-dir .claude/logs/s5/s6-b
   uv run python -m scripts.data_pipeline.product_suburban compare --a .claude/logs/s5/s6-a --b .claude/logs/s5/s6-b
   uv run python -m scripts.data_pipeline.product_suburban install --overrides-dir .claude/logs/s5/s6-overrides --data-dir .claude/logs/s5/s6-a
   uv run python -m scripts.data_pipeline.product_suburban verify
   ```

4. **R4 — map/legend interaction; after R2/R3.**
   Files: `GameLegend.tsx`, `GamePanel.tsx`, `RailwayMap.tsx`, layer/config/collection/interaction helpers, `src/styles.css`, corresponding unit tests.
   Implement visibility state, primitive-aware filtering, aliases, label priorities, and camera behavior above.
   Acceptance: `npm test -- tests/unit/game-legend.test.ts tests/unit/map-helpers.test.ts tests/unit/map-camera.test.ts tests/unit/map-station-markers.test.ts tests/unit/capital-region-scaling.test.ts`; `npm run build`.

5. **R5 — real-bundle browser coverage; after R4.**
   Files: `capital-region.spec.ts`, `real-data.spec.ts`, map visual/layout specs and observation hook only as needed.
   Restore exactly six checks: at the paced forward and reverse composed-hop midpoints, assert `抽選: 移動中…`, the pre-landing ridden direction, and displayed pre-landing progress.
   Derive expected direction/progress from the existing production-rule scenario and displayed-progress helpers; committed saves already contain the landing state. Preserve midpoint geometry and post-skip landing assertions.
   Add real-bundle Oedo, aliases, operator/group filtering, shared primitive visibility, label-density, overview, touch, and keyboard checks.
   Acceptance: `npx playwright test tests/e2e/capital-region.spec.ts tests/e2e/real-data.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/layout.spec.ts --project=desktop-chromium --project=phone-chromium`.

6. **R6 — performance/compression evidence; after R5.**
   Files: real-data metrics test and `data/README.md`/README deployment notes; no hosting mutation.
   Print existing `JRCR_S6_LOAD_METRICS` on phone Chromium too; retain desktop metrics and record cold-load repetitions, resource sizes, ready times, and interactive pan/filter/dice behavior.
   Report browser/device/CPU/network conditions; software WebGL and stubbed resources do not establish real-device/network performance.
   Run the real-bundle smoke on representative desktop/mobile hardware; require usable controls, readable labels, no rendering failures, and existing readiness timeouts without increases.
   The repository identifies Vercel as the deploy target. Verify its current static-asset compression behavior against official documentation during implementation, including `.geojson` MIME handling.
   Use an already available authorized preview URL: `curl -sS -D - -o /dev/null -H 'Accept-Encoding: gzip, br' "$S6_PREVIEW_URL/data/segments.geojson"`.
   Require negotiated gzip/Brotli and correct content type; download/decode and compare the decoded SHA-256 with the generated file. Check JSON assets too.
   Do not assume Vite preview or a `.gz` file proves production compression. If Vercel does not compress this asset, return the evidenced configuration/asset-delivery fix for lead review before release.
   Missing preview access or device evidence remains an explicit acceptance gap; no production deployment is authorized.

7. **R7 — final verification; sequential integration, read-only checks marked parallel.**
   `uv run pytest tests/data_pipeline`; `uv run ruff check scripts tests`; `uv run ty check`; `npm test`; `npm run build`; `npx playwright test`.
   **[Parallel read-only checks]** `uv run python -m scripts.data_pipeline.product_suburban verify-history` and `uv run python -m scripts.data_pipeline.product_suburban verify-inputs`.
   `uv run python -m scripts.data_pipeline.product_suburban verify`; `uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py`; `git diff --check`.
   Verify protected paths against the starting revision and inspect the complete diff. Record final per-file/total raw/gzip sizes, references, chain length, screenshots, device/load metrics, and compression evidence.
   Guard/type changes affect S5 simulation fingerprints. Preserve prior reports; regenerate four 1,250-game shards plus repeat into a separate directory using existing `S5_OFFSET`, `S5_GAMES`, `S5_OUTPUT` interfaces.
   **[Parallel independent measurements]** offsets 0/1250/2500/3750; then repeat offset 0 as `sim-repeat.json`. Verify with `uv run python -m scripts.data_pipeline.product_suburban verify-simulation --shard-dir .claude/logs/s6/simulation`.
   Require zero per-seed differences and unchanged frozen distribution. Split measurement/integration into additional bounded executions if necessary.

## Risks

- Manifest metadata is outside `dataVersion`; independently recomputed product verification and deployment cache consistency must detect stale presentation.
- Shared primitives can disappear under owner-based filtering; filter by resolved references.
- Deduplicating Oedo before the lottery would change rules; group only presentation.
- Blank glyph fixtures, localhost transfers, and software WebGL cannot prove production readability, compression, or hardware performance.

## Decisions needing the user

- **22 private-railway large-ケ names:** A) retain registry spelling everywhere; B) display audited original spelling where it differs, preserving canonical IDs/names; C) introduce an independently curated official-spelling override table.
- **Recommend B:** use service-specific originals such as `新百合ヶ丘` where available, retain `新百合ケ丘` as a searchable/display alias, and preserve frozen identities. First return the exact 22-name original/canonical comparison for user approval; do not apply a blanket ケ→ヶ replacement.
- R1–R7 can otherwise proceed using existing canonical spelling and audited distinct-name aliases. Apply the spelling choice in a bounded follow-up after the user decides.
