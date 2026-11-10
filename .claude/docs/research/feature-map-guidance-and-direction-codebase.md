# Issue #62 (MAP関連) -- affected-area codebase scan

Date: 2026-11-10. Branch at scan time: `docs/release-0.13.1-status` (HEAD `33ff82c`).
Scope: read-only investigation for Codex design/planning of GitHub issue #62. No tracked file was
edited. Experiments ran on `git archive HEAD` copies in the session scratchpad only.

Sub-items (numbering used throughout):

1. Direction labels (「進行方向」) disagree with real termini for 10 JR services.
2. No guidance after all 30 Yamanote segments are done ("あとは新橋").
3. Unvisited Yamanote segments are grey `#8a8a8a`, width 3, dashed; no "next target" emphasis.
4. Current-position marker has no heading.
5. Roll-adjust dialog shows pips only, not the landing station; it is modal.

Constraints from related issues: #71 (phone panel covers ~45% of the map; adjust dialog should
not hide the map), #72 (line emphasis + non-colour cues; marker line-code badge to be designed
together with the heading "beak"; keep solid/dashed distinction). #65 (open, not implemented)
owns milestone toasts at 10/20/25/29 and HUD proximity; the 30/30 toast in #62 should share its
channel and wording.

---

## 1. Affected files per sub-item

Change types: **D** data, **P** pipeline/validator, **E** engine (pure), **V** view/presentation,
**M** map layer, **T** tests/fixtures, **Doc** docs.

### Sub-item 1 -- direction labels

| Path:line | Type | What / why |
|---|---|---|
| `data/overrides/services.json:72,157,600,662,707,763,907,1143,1323,1380` | D | `directionLabels` of the 10 services (line = the `"directionLabels"` key; values on the next 2 lines). This is the **live build input** (`config.DEFAULT_OVERRIDES_DIR`). |
| `data/staging/tokyo-suburban-assembled/overrides/services.json` (same line numbers as above) | D | S4 assembled stage. `product_suburban._check_derived_override_tree` (`scripts/data_pipeline/product_suburban.py:306-325`) requires every file except `dataset.json` to be byte-identical to `data/overrides`. Must be edited in lockstep or the provenance contract updated. |
| `data/staging/tokyo-suburban-jr/combined/overrides/services.json:347,430,859,919,962,1016,1154,1380,1554,1609` | D (optional) | S2 combined stage (the file the issue cites at :348). Hash-pinned by `combined/baseline-sha256.json` and assembled `inputs-sha256.json`; editing it cascades into S4 re-assembly. Recommend leaving frozen history alone and documenting the supersession instead. |
| `data/staging/tokyo-suburban-jr/{chuo,takasaki,tohoku,tokaido}/overrides/services.json` | none | Per-region staging copies carry the same stale labels. Frozen history; out of scope. |
| `scripts/data_pipeline/stage_suburban_jr.py:625-636` | P (explain only) | Root cause: the seed step regenerates `directionLabels = "<last stop>方面" / "<first stop>方面"` only for services in `REGION_SERVICES[region]` (`assigned`); every pre-existing (23区/1都3県-era) definition hits `continue` at :625-627 and keeps its old labels. The 10 services were extended in extent without being re-labelled. |
| `scripts/data_pipeline/stage_suburban_nonjr.py:474-477` | none | Non-JR staging always derives labels from first/last stop -- why no non-JR service mismatches. |
| `scripts/data_pipeline/override_parsing.py:226,331` | P (maybe) | Parses `directionLabels`; candidate place for an override-level check (has stop `original_name`). |
| `scripts/data_pipeline/validate.py:169-284` (`check_services`), `:226-232` | P | Existing check only compares published labels to `data/overrides`. New rule fits here (see §3). |
| `scripts/data_pipeline/rules.py:121-141` (`check_service_metadata`) | P (alt) | Shared-metadata rule pattern (`report.errors.append(...)`) if the rule should be reusable by stage validation. |
| `public/data/services.json`, `public/data/manifest.json` | D (generated) | Only these two files change on rebuild (verified, §3). |
| `src/features/game/presentation.ts:28-31` | V (none needed) | `directionLabel()` prints data verbatim. Used by HUD (`GamePanel.tsx:296`), map-free summary (`GamePanel.tsx:337`), lottery reveal (`LotteryReveal.tsx:55`), item dialogs (`ItemUseDialog.tsx:113,152`, `GamePanel.tsx:285`), log (`presentation.ts:42,106,266`), clear screen (`ClearScreen.tsx:97`). Data fix propagates everywhere with no code change. |
| `tests/e2e/fixtures/*.json`, `tests/unit/fixtures/edition-save-compatibility.json` | T | Regenerate after the data change (§7). |
| `tests/unit/product-data.test.ts:242-251`, `tests/e2e/save-errors.spec.ts:138` | T | Immutable historical classic save expectations change (§7). |
| `data/README.md`, `docs/manual/tokyo-suburban/implementation-status.md:7`, `tests/simulation/README.md:80`, `.claude/docs/DESIGN.md` | Doc | Record new `dataVersion` and the label rule. |

### Sub-item 2 -- 30/30 guidance ("あとは新橋に着けばクリア")

| Path:line | Type | What / why |
|---|---|---|
| `src/features/game/engine/goal.ts:18-22` (`checkGoal`), `:7-12` (`targetSegmentIds`) | E (read only) | Goal = on `config.startStationId` with all `targetSegmentIds` completed. "All done but not yet at start" is `completed ⊇ required && currentStationId !== startStationId` -- derivable in presentation; no engine change needed. |
| `src/features/game/engine/movement.ts:113-126` | E (read only) | Goal truncation inside `advance()` (`stopsAtGoal`, policy `truncate-on-target-service`). |
| `src/features/game/components/TargetProgressBar.tsx:10-33` | V | 30 cells, `role=progressbar`, `aria-valuetext "n/30"`. Issue proposes swapping cells for text at 30/30. Must keep the **constant HUD row height** (DESIGN row 2026-11-10 #70: stats rows 18/34/34/18 px, 320x568 panel 252 px under the 45% cap). |
| `src/features/game/hudPresentation.ts:74-81` (`progressSegments`) | V | Pure cell model; a sibling pure helper (e.g. goal-guidance state) belongs here with unit tests in `tests/unit/hud-presentation.test.ts`. |
| `src/features/game/components/GameHud.tsx:82-83` | V | Renders `踏破区間 n/30` + bar; place for guidance copy. Props `completed/required` already exist. |
| `src/features/game/components/GamePanel.tsx:298-299` | V | Computes `completed` from `turnDisplay.progress.completedSegmentIds` (reveal-gated). Use the same source so the guidance never appears before the arrival is presented. |
| `src/features/game/turnMomentPresentation.ts:37-74` (`TurnMomentDisplay`), `:209-210` (`toastInputs`) | V | Single derivation point for every published value (DESIGN 2026-11-03: "deriveTurnMomentDisplay() 1か所で導出し、公開境界より前に結果を出さない"). New guidance flag/toast must be derived here. |
| `src/features/game/toastQueue.ts:13-22` (`ToastInput`), `:84-112` (`turnToasts`), `:158-187` (`newerPosition`/`enqueueToasts`) | V | Toasts are item-event-only today, keyed `${sessionId}:${turn}:${eventIndex}` and ordered by `(turn, eventIndex)` cursor. A milestone toast needs a non-colliding key and an `eventIndex` slot that sorts after item events (or a separate channel); classic (non-item) records currently produce no toasts at all (`record = lastMove?.itemRecord` guard). Shared design point with #65. |
| `src/app/GameApp.tsx:226-243` | V | Toast acceptance; baseline keys suppress toasts for restored history (resume must not re-toast 30/30). |
| `src/features/game/components/ToastHost.tsx` | V | Renderer; no change expected. |
| `src/features/map/railwayLayers.ts:170-222`, `src/features/map/stationCollection.ts:34-81` | M | Station source/layers. Shimbashi highlight = new layer (or filter/paint change) keyed by `startStationId`, toggled when all targets are complete. |
| `src/features/map/RailwayMap.tsx:62-81` (props), `:440-456` (effects) | M | Needs a new progress field (e.g. `goalStationId` or `allTargetsCompleted`) plumbed through `MapProgress` (`railwayLayers.ts:56-60`) from `GameApp.tsx:245-257`. |
| `src/features/editions/registry.ts:26` | none | Only current mention of 新橋 as goal (rules copy). Derive the station name from `config.startStationId` via `stationName()`, never hard-code. |

### Sub-item 3 -- pending-segment emphasis / "next segment"

| Path:line | Type | What / why |
|---|---|---|
| `src/features/map/mapConfig.ts:89-92` | M | `PENDING_SEGMENT_COLOR #8a8a8a`, width 3, dash `[2, 1.5]`. |
| `src/features/map/railwayLayers.ts:131-143` | M | `segmentsPending` line layer (filter `pendingSegmentFilter`). Base track under it: `:103-110` (target-only, width 2, opacity 0.5, track colour). |
| `src/features/map/progressStyle.ts:5-23` | M | Filters are `serviceId == target` AND featureId (not) in completed literal. A "next segment" layer would be a third filter on a specific featureId list. |
| `src/features/map/railwayLayers.ts:270-279` (`updateCompletedSegments`) | M | Called from `RailwayMap.tsx:446-449` on `completedKey` change; extend for the next-segment layer. |
| `src/app/GameApp.tsx:245-257` | V | `completedFeatureIds` = required completed segment ids mapped via `segmentsById.get(id).geometryFeatureIds`. Same mapping for "next" ids. |
| `src/features/game/engine/network.ts:280-294` (`nextStationId`), `:300-312` (`requiredSegmentIds`) | E (read only) | Yamanote is circular; required ids are in loop order from `stationIds[0]`. |
| `src/features/game/engine/proximity.ts:38-63` (`nearestTargetStation`) | E (read only) | Forward BFS to the nearest Yamanote stop; useful when the player is off-Yamanote. |
| `src/features/game/components/GamePanel.tsx:110-122` | V | `remainingSections` already lists pending target segments (map-free fallback, `:327-334`). |
| `src/features/map/railwayLayers.ts:144-168` | M | Completed and flash layers; DESIGN 2026-11-03 records the layer stack ("計11レイヤー", flash filter shape fixed). Adding layers is a recorded-decision change. |

"Next segment to complete" has no code definition today. Candidate definitions for Codex:
(a) on Yamanote (direction is forced to `targetDirection`): walk `nextStationId` from
`progress.stationId` until the first segment whose id is not completed; (b) off Yamanote: from
`nearestTargetStation(...)` walk forward the same way; (c) simplest: emphasise all pending
segments (colour/width change only). Completed set can be non-contiguous, so (a)/(b) pick one
segment (or a run). Must use reveal-gated `turnDisplay.progress`, not `game` state.

### Sub-item 4 -- marker heading

| Path:line | Type | What / why |
|---|---|---|
| `src/features/map/railwayLayers.ts:223-237`, `:281-285` | M | `game-current-position` GeoJSON source + `circle` layer (`game-current-position-circle`); `updateCurrentPosition` sets one Point per frame. |
| `src/features/map/mapConfig.ts:29-33,48-67,93-96` | M | Source/layer ids; marker radius 10, `#e53935`, white stroke 3. |
| `src/features/map/progressStyle.ts:25-48` | M | `CurrentPositionCollection.properties: Record<string, never>` -- add `bearing` (and later #72 `lineCode`) here. |
| `src/features/map/RailwayMap.tsx:440-455` | M | Position = `livePosition` frame ?? `progress.currentPosition`; effect re-runs on position. |
| `src/features/game/animation/displayedProgress.ts:43-73` | V | Idle position = `platformPosition(currentServiceId, currentStationId)`; during animation = frame position. |
| `src/features/game/animation/movePath.ts:99-135` (`stepPath`), `:73-82` (`orientPath`), `:149-167` (`positionAlong`) | V | Builds an oriented polyline for any directed segment from `segments.geojson`; reusable for a hypothetical next hop to get the track tangent instead of a straight station-to-station bearing. |
| `src/features/game/animation/timeline.ts:4-9` (`AnimationFrame`), `livePosition.ts`, `useMoveAnimation.ts:64-100` | V | Per-frame stream carries only `Position`; heading during a move needs either a bearing on the frame or derivation from consecutive frames. |
| `src/features/game/components/GamePanel.tsx:123-133` (`upcomingStations`), `:296` | V | Already computes next stops from `turnDisplay.ride` + `turnDisplay.progress.stationId` with `nextStationId`. HUD direction (`:296`) uses the same `ride`. Deriving the map heading from the same inputs guarantees "HUD の進行方向と地図の向きは必ず一致". |
| `tests/e2e/support/app.ts:318-385`, `tests/e2e/accessibility.spec.ts:653-803`, `tests/e2e/map-failure.spec.ts:150-173` | T | E2E reads the marker via `getSource("game-current-position").getData()` and `queryRenderedFeatures(..., { layers: [LAYER_IDS.currentPosition] })`; style-reload test asserts unique `railway-`/`game-` layer ids. Changing the layer type/id needs these helpers updated. |

Data available for heading at idle: `turnDisplay.ride.{serviceId,direction}`,
`turnDisplay.progress.stationId`, `nextStationId(network, serviceId, stationId, direction)`
(guaranteed defined for a settled position: `assertSettledPosition`, `movement.ts:41-54`),
`platformPosition` for both stops, and the segment geometry (`findSegment` ->
`geometryFeatureIds` -> `GeometryIndex`). The ride shown at idle is the **next** ride after the
landing lottery, and it is reveal-gated; heading must follow `turnDisplay.ride`, never raw
`game.currentServiceId`, or it would leak the lottery result before the flap reveal.

MapLibre feasibility (maplibre-gl 6.11.2): no existing `addImage`/`icon-image`/sprite use; the E2E
stub style has glyphs but no sprite (`tests/e2e/support/mapStub.ts:25-46`), and glyph fixtures only
cover ranges 0-255, 12288-12543, 19968-40959, 65280-65535 (`tests/e2e/fixtures/glyphs/`), so a text
glyph arrow (U+25B2 etc., range 9472-9727) would also require regenerating glyph fixtures.
Feasible options: (i) a `symbol` layer with a runtime `map.addImage(id, ImageData, { sdf: true })`
arrow/beak, `icon-rotate: ["get", "bearing"]`, `icon-rotation-alignment: "map"`,
`icon-allow-overlap: true`, added inside `addRailwayLayers` so it is re-added on `style.load`
(style reload drops runtime images; `RailwayMap.tsx:401-416` already re-adds layers when the
marker source is missing); keep the circle layer under it so existing E2E marker queries keep
working. (ii) A DOM `maplibregl.Marker` with `rotation` -- breaks the canvas-only pattern and the
E2E source/`queryRenderedFeatures` contract; not recommended.

### Sub-item 5 -- roll-adjust landing preview

| Path:line | Type | What / why |
|---|---|---|
| `src/features/game/components/RollAdjustment.tsx:30-36` (`showModal`), `:51-79` | V | Native modal dialog; choices `-1/0/+1` labelled `：出目 n、nマス進む`. Modal makes the rest of the page (map) inert. |
| `src/features/game/itemSession.ts:46-51` (`adjustmentOptions`), `:198-206` (decision type), `:229-233` | V | Decision carries `rawRoll`, `resolvedRide`, `allowedDeltas`; a preview list per delta could be added here (pattern: `itemSessionView` already exposes `deadheadDestination`, `directionHint`, route options). |
| `src/features/game/engine/itemTurn.ts:31-66` (`finishItemTurn`) | E (read only) | `face = rawRoll (+delta)`; movement `advanceWithMode(..., { mode: "normal", pips: face })` because adjustment is legal only with no pre-roll item, not delayed, not oversleep (`:46-48`, mirrored by `adjustmentOptions`). |
| `src/features/game/engine/itemMovement.ts:80-121` (`advanceWithMode`), `movement.ts:69-138` (`advance`) | E | Pure; no RNG. A preview helper (`advance(position, face, network)` per candidate) is RNG-free. Note `movement.ts`, `goal.ts`, `network.ts` are in the simulation code fingerprints (§6), so prefer a new module or a presentation helper over editing them. |
| `src/features/game/engine/itemTurn.ts:68-101` (`resolveArrival`) | E (read only) | RNG is consumed only **after** the landing station is fixed: `drawLanding` (landing lottery) then `drawItemDrop`. |
| `src/features/game/components/GamePanel.tsx:382-388` | V | Mount point of `RollAdjustment`. |
| `src/features/map/*` | M | No candidate overlay exists; would be a new source + circle/symbol layer (labels need glyphs: CJK station names are covered by fixtures; ASCII digits/±/+ are in 0-255, U+2212 "−" is not). |
| `src/styles.css:1320-1340` (`.dialog`, `::backdrop`), `:1518-1630` (`.item-dialog`, `.item-adjustment__choice`) | V | Dialog sizing/position for phones (#71 overlap). |

---

## 2. Existing patterns and conventions

- **Engine purity and RNG contract.** DESIGN Key Decisions (2026-10-12 rows 181-183): forced choices
  consume no draws; `playTurn`/`finishItemTurn` are atomic; lottery order is `services.json` order.
  Every #62 sub-item can be done without touching RNG, `SAVE_VERSION` (`engine/game.ts:24`, = 4), or
  ruleset ids. UI pop decisions (2026-10-28/11-03/11-07) repeat "表示するだけで RNG・ルール・セーブ形式は変えない".
- **Single publication point.** All shown values derive from `deriveTurnMomentDisplay()`
  (`turnMomentPresentation.ts`); nothing may be shown before its reveal boundary; one `role=status`
  live region. New HUD guidance, toasts, map heading, next-segment emphasis must read
  `turnDisplay.*`.
- **Map layers.** Added in `addRailwayLayers` on `style.load`; ids in `mapConfig.ts` `SOURCE_IDS` /
  `LAYER_IDS`; updates via small `update*`/`set*` functions that early-return when the layer is
  missing (failed map / style reload). Filters are MapLibre expressions built by pure helpers in
  `progressStyle.ts`. Progress is told by line style as well as colour (comment `railwayLayers.ts:131`,
  spec 6.3) -- keep solid vs dashed (#72).
- **Presentation names.** Station/service names go through `PresentationResolver`
  (`stationName`, `serviceStationName`, `serviceName`); `PhraseText` adds `<wbr>` hints (before 方面)
  without altering strings (#70).
- **Data pipeline.** Deterministic build (`scripts/data_pipeline/build.py`), `dataVersion` =
  `n02-2025-` + first 12 hex of SHA-256 over stations/services/segments/segments.geojson
  (`export.py:210-239`); `validate.py` checks byte-canonical serialization and staleness
  (`validate.py:569-575,675-679`). Validation errors are strings appended to `report.errors`.
- **Test locations.** Vitest unit: `tests/unit/**/*.test.ts` (`vite.config.ts:56-57`; jsdom for
  components). Simulation: `vitest.simulation.config.ts` (`npm run sim`, not CI). Playwright E2E:
  `tests/e2e/*.spec.ts`, hermetic map stub (`support/mapStub.ts`), map observed via
  `window.__sugorokuE2E.map` (`src/features/map/e2eHook.ts`, e2e build only). Pytest:
  `tests/data_pipeline/`, raw-N02 and local-evidence tests skip via
  `tests/data_pipeline/_local_inputs.py` markers. Test naming and AAA per `.claude/rules/testing.md`.
- **Seeds and pinned saves.** `tests/e2e/fixtures/seeds.ts` pins 128-bit seeds verified by
  `tests/unit/e2e-fixture-seeds.test.ts` and `real-data-e2e-scenarios.test.ts`. Real-bundle saves
  are regenerated by `tests/e2e/fixtures/regenerate-saves.ts` (command in
  `tests/e2e/fixtures/README.md`), which also rewrites `item-saves.provenance.json` (bundle SHA-256s,
  dataVersion) and `tests/unit/fixtures/edition-save-compatibility.json`.
  `old-capital-region-save.json` and `historical-classic-before-clear-save.json` are documented as
  **immutable** historical fixtures.
- **CI.** `npm run typecheck`, `npm test`, `npm run build`; `uv run ruff check/format`, `uv run ty check
  scripts/`, `uv run pytest -q`, `uv run python -m scripts.data_pipeline.validate`; per-browser
  Playwright matrix under xvfb (`.github/workflows/ci.yml`). Raw N02 is not in CI.

---

## 3. Data pipeline flow for direction labels

Flow: frozen research catalog -> S2 JR staging (`stage_suburban_jr.py seed`, labels regenerated only
for region-assigned services) / S3 non-JR staging -> S4 `data/staging/tokyo-suburban-assembled/`
(A/B gate, hashes in `verification.json` `gate.buildHashes`) -> product prepare copies assembled
overrides into `data/overrides/` (+ `ui-presentation.json`, transformed `dataset.json`) ->
`build.py` reads `data/overrides` and writes `public/data/*` -> `validate.py` re-checks published
files against `data/overrides`.

Exact commands (from `data/README.md`; raw N02 is present locally under `N02-25_GML/UTF-8/`):

```bash
uv sync --locked
sha256sum --check data/n02-2025.sha256
uv run python -m scripts.data_pipeline.build            # writes public/data/*
uv run python -m scripts.data_pipeline.validate         # no raw data needed; CI runs this
uv run pytest -q
```

Verified in a scratch copy (labels in `data/overrides/services.json` patched for the 10 services):

- `validate` against the **old** `public/data` reports exactly the 10
  `service <id> directionLabels differ from data/overrides` errors.
- `build` (~14 s) then `validate` -> `OK`. Only `services.json` and `manifest.json` change;
  `stations.json`, `segments.json`, `segments.geojson` are byte-identical. Builds are deterministic.
- New `dataVersion`: `n02-2025-7974da15af8e` (was `n02-2025-8a0970069659`). New
  `services.json` SHA-256 `90ba16802aad2c5116c8eb57621edd27c1272d70e14a624b341dd8a02d012545`.
  Raw total 2,577,364 -> 2,577,355 bytes, gzip 413,592 -> 413,557 (within the capital-region budget).
- `uv run pytest tests/data_pipeline` on the patched copy has the **same** failure set as an
  unpatched copy (4 failed / 5 errors, all due to git-ignored `.claude/logs` evidence absent from
  the copy). No tracked pytest pins `services.json` labels.

Provenance chain that does **not** run in CI but will break: `product_suburban verify`
(`product_suburban.py:437-458`) compares live `public/data` hashes to S4
`verification.json` `gate.buildHashes` (`product_suburban_inputs.py:489-504`, services.json pinned
`40b9c124...`) and requires `data/overrides` == assembled overrides except `dataset.json`. Options:
(a) edit assembled overrides too and record a reviewed post-S4 label correction (hashes in
`verification.json` stay stale -> verify still fails), (b) add an explicit, reviewed "post-release
label amendment" allowance to `verify`, or (c) accept that `verify` is a frozen S5 cut-over check
and document it as superseded. Codex should pick; (b) or (c) avoids re-running S4 (which needs
`.claude/logs/s4`, absent locally).

### Proposed validator rule

Where: `validate.py` `check_services` loop (after `:226-232`), which already has `raw`
(`stationIds`, `directionLabels`, `circular`) and `definition`. Rule: for every non-circular service,
`forward == name(stationIds[-1]) + "方面"` and `backward == name(stationIds[0]) + "方面"`, where
`name` is the per-service stop name (`manifest.uiPresentation.serviceStopNames` override, else the
station registry name). My scratch check using that definition finds **0** extra mismatches beyond
the 10 across all 125 non-circular public services. Circular services must be exempt (or
allow-listed): `jr-yamanote` 外回り/内回り and `toei-oedo-loop` 新宿方面/都庁前方面. An override-level
twin (using `stops.csv` `original_name`) in `override_checks.py` would catch the problem before
build. Test pattern: `tests/data_pipeline/test_validate.py:286-287` (mutate dataset lambda +
expected error substring). The `tests/data_pipeline/fixtures/jr_east_core/services.json` 23区
fixture (浮間舟渡方面, 葛西臨海公園方面) is consistent with its own 23区 termini and should still pass.

---

## 4. Mismatch table

Rule: `<terminus stop name>方面` (user decision 2026-11-10). `fwd` = toward `stationIds[-1]`,
`bwd` = toward `stationIds[0]`. Script: read-only, scratchpad `mismatch.py`.

### Shipped edition: 東京近郊版 (`public/data`, the only registered edition)

| Service id | Name | Current fwd / bwd | Expected fwd / bwd | Endpoints (first/last) |
|---|---|---|---|---|
| jr-keihin-tohoku | 京浜東北線・根岸線 | 蒲田方面 / 赤羽方面 | 大船方面 / 大宮方面 | terminus / terminus |
| jr-chuo-sobu-local | 中央・総武線各駅停車 | 小岩方面 / 三鷹方面 | 千葉方面 / 三鷹方面 | terminus / terminus |
| jr-saikyo | 埼京線・川越線 | 浮間舟渡方面 / 大崎方面 | 川越方面 / 大崎方面 | terminus / terminus |
| jr-sotetsu-direct | 相鉄線直通 (JR区間) | 西大井方面 / 新宿方面 | 羽沢横浜国大方面 / 新宿方面 | service-boundary / service-boundary |
| jr-keiyo | 京葉線 | 葛西臨海公園方面 / 東京方面 | 蘇我方面 / 東京方面 | terminus / terminus |
| jr-musashino | 武蔵野線 | 新秋津方面 / 府中本町方面 | 西船橋方面 / 府中本町方面 | terminus / service-boundary |
| jr-nambu | 南武線 | 立川方面 / 矢野口方面 | 立川方面 / 川崎方面 | terminus / terminus |
| jr-yokohama | 横浜線 | 八王子方面 / 相原方面 | 八王子方面 / 東神奈川方面 | service-boundary / terminus |
| jr-yokosuka | 横須賀線 | 西大井方面 / 東京方面 | 久里浜方面 / 東京方面 | service-boundary / terminus |
| jr-sobu-rapid | 総武快速線 | 新小岩方面 / 東京方面 | 千葉方面 / 東京方面 | service-boundary / service-boundary |

Matches the issue's list exactly. All other 125 non-circular services already comply.
Circular (exempt): jr-yamanote 外回り/内回り; toei-oedo-loop 新宿方面/都庁前方面.

### Other datasets (not playable; for reference)

- `src/features/editions/registry.ts` registers only `tokyo-suburban`. 23区版, 1都3県版 and
  山手線のみ are not shipped (DESIGN 2026-10-20 B1 decision), so no other edition shows labels.
- `data/baselines/jr-east-capital-region/public/data` (frozen 1都3県 baseline, 40 services, used
  only by historical tests): 19 mismatches -- the same 10 plus jr-chuo-takao-fujino
  (相模湖・藤野方面 vs 藤野方面), jr-hachiko (箱根ケ崎方面 vs 丹荘方面), jr-tokaido (品川方面 vs 湯河原方面),
  jr-utsunomiya (赤羽方面 vs 栗橋方面), jr-takasaki (赤羽方面 vs 神保原方面), jr-shonan-shinjuku-local
  (西大井/赤羽 vs 逗子/栗橋), jr-shonan-shinjuku-rapid-takasaki (大崎/赤羽 vs 小田原/神保原),
  jr-joban-rapid (北千住方面 vs 天王台方面), jr-joban-local (松戸方面 vs 綾瀬方面 backward). Frozen
  history; do not edit. A new validator rule must not be applied to this baseline (or must be
  scoped to the live profile), or historical-baseline tests would fail.
- `tests/e2e/fixtures/capital-region` (synthetic): all 7 non-circular services use generic
  `南・東方面 / 北・西方面` by design. If the rule lives in `validate.py` it will not touch these
  TS fixtures; if any TS-side guard is added, exempt fixtures.
- `tests/e2e/fixtures/data` (small 3-service fixture): only circular Yamanote; compliant.

---

## 5. Engine determinism of roll-adjust landing

- Adjustment is offered only when `pending.kind === "roll"`, no pre-roll item, not oversleep, not
  delay-due, and a `roll-adjust` ticket is owned (`itemSession.ts:46-51`); `finishItemTurn`
  re-validates the same (`itemTurn.ts:44-52`). Hence movement mode is always `normal`, pips = face,
  no `double`/`rapid` multiplier, ride = `pending.resolvedRide` (= current service/direction).
- Movement `advance()` (`movement.ts:69-138`) is a pure function of `(position, pips, network)`:
  stops only at (a) goal (start station with all targets done, under `stopsAtGoal`), (b) endpoint
  (no next stop; terminus / area-boundary / service-boundary, unused pips discarded), or (c) the
  last pip. **Transfer stations do not stop movement**; lotteries do not affect the landing station.
- RNG order in `resolveArrival` (`itemTurn.ts:68-101`): landing station fixed first, then
  `drawLanding` (service/direction lottery, from `pending.rngStateAfterRoll`), then `drawItemDrop`
  (separate item RNG stream). Suspensions/detour change only the lottery options, not the station.
- Therefore a preview `advance({...game, currentServiceId: ride.serviceId, direction: ride.direction},
  rawRoll + delta, network)` for each delta in `[−1, 0, +1] ∩ allowedDeltas` gives the exact
  landing station, `stopReason` (`roll`/`endpoint`/`goal`), unused pips and newly completed target
  segments, with **zero RNG consumption** and no state mutation. The result can be shown pre-move
  without leaking any lottery: the raw roll is already public at this stage.
- Guardrails: `advanceWithMode` calls `assertSettledPosition` (throws on unsettled state) -- call
  through it or replicate the guard. Do not place the preview in `movement.ts`/`goal.ts`/`network.ts`
  if avoidable (simulation fingerprints, §6). Adding the preview to `ItemSessionView.decision`
  keeps it in the existing presentation boundary; `autoRoll` waits on adjust and is unaffected.
- Map overlay for candidates: needs a new source/layer (+ labels), plus a non-modal or bottom-sheet
  dialog on phones because `showModal()` makes the map inert and centred dialogs cover it (#71).
  The issue's cheap alternative (append `→ 渋谷` to each radio label) needs no map work.

---

## 6. Dependencies and downstream consumers

- `directionLabels` consumers (all via `presentation.directionLabel`): HUD 進行方向, LotteryReveal
  flap second row, lottery/landing log text (`landingTransitionText`, `presentation.ts:106,266`),
  ItemUseDialog direction-ticket/route-ticket options, map-free summary, ClearScreen history, live-region announcements (share text does not use labels). E2E `full-game.spec.ts:61` reads
  labels dynamically from `services.json`.
- `dataVersion` consumers: `restoreGame` rejects a save whose `dataVersion` differs
  (`save.ts:447-452`, `DATA_VERSION_MISMATCH`) -> `persistence.ts:48,57` shows
  「路線データが更新されたため、このセーブデータは使えません。」 and offers discard. **Every in-progress
  player save becomes unusable after the label fix ships** (first post-release data change since S6;
  `public/data` last changed in `478e3ca`). Title screen shows `路線データ <dataVersion>`
  (`TitleScreen.tsx:162`).
- Simulation fingerprints: `product_suburban.SIMULATION_CODE_FILES` (`product_suburban.py:54-69`)
  and `tests/simulation/suburban-observations.ts:20-36` hash engine sources (`movement.ts`,
  `goal.ts`, `network.ts`, `landing.ts`, `proximity.ts`, `game.ts`, `rng.ts`, ...) and the five bundle
  files. `_simulation_gameplay_signature_sha256` excludes labels (gameplay unaffected), but bundle
  hashes include `services.json`. These are local/S5-S7 evidence checks (not CI), still worth
  noting in the plan.
- Map: `GameApp.tsx` -> `RailwayMap` props (`progress`, `segmentFlash`, `livePosition`, `follow`).
  Any new map state (heading, next segment, goal station, adjust candidates) flows through
  `MapProgress` or a new prop; layers must survive `style.load` re-add and missing-layer guards.
- Turn moments / reveal: `useTurnMoments`, `useRevealSequence`, `turnMomentPresentation.ts`
  publication phases (`pre-move`, `moving`, `arrival`, `segment-flash`, `lottery-flip`, ...). The
  30/30 toast must fire at the arrival reveal of the completing turn, not at commit, and not again on
  resume (toast baseline in `GameApp.tsx:226-243`).
- #65 (open): milestone toasts (10/20/25/29) + "あと1区間" share the toast channel and copy; HUD
  proximity row competes for the same HUD space as the 30/30 text.
- #72: marker badge next to the heading marker -> same `currentPosition` source properties;
  non-colour cue requirement constrains the pending/next-segment styling.
- #71: phone panel height and dialog placement constrain the adjust preview UI.

---

## 7. Risks

1. **Save invalidation (highest impact).** Fixing labels in data changes `dataVersion`
   (`8a0970069659` -> `7974da15af8e`) and every in-progress save is rejected with the "路線データが
   更新された" message. Options for Codex/user: accept (release note), or add a
   label-only-compatible dataVersion allow-list / migration in `save.ts` (engine/save change, needs
   design), or derive labels at runtime in `presentation.directionLabel` from terminus names and
   leave data bytes unchanged (no save break, but contradicts the user's "直したあと validate.py で
   確かめる" direction and leaves data wrong). This is a user decision.
2. **Pinned fixtures.** Verified on a patched copy (`vitest run`, full unit suite): 4 failures, all
   from the data change -- `product-data.test.ts` "matches the regenerated v4 source, resumed, and
   next-turn save bytes" and "rejects the immutable pre-S11 classic v4 save" (now fails with
   `DATA_VERSION_MISMATCH` before `CONFIG_MISMATCH`, and the classic restore to turn 41 throws), and
   `real-data-e2e-scenarios.test.ts` save-bytes + provenance pins. Three are fixed by running
   `regenerate-saves.ts`; the historical classic fixture is documented as immutable and its test /
   `save-errors.spec.ts:138` expectations need an explicit decision (keep bytes, change expected
   code to `data-version`, or rewrite only its `dataVersion` with new provenance). E2E specs using
   pinned saves (`tokyo-suburban.spec.ts:41-94`, `real-data.spec.ts:20`, `accessibility.spec.ts:381`)
   need the regenerated files. (Two other suite-level failures in the copy, `map-flash` and
   `map-panel-observer`, were caused by the symlinked `node_modules` outside the Vite root -- not
   by the data.)
3. **Provenance chain.** `product_suburban verify` will fail (S4 hash pin and derived-override
   equality). Needs an explicit decision (§3) so the frozen-stage contract is not silently broken.
4. **Reveal leaks.** Heading, next-segment emphasis, 30/30 text and Shimbashi highlight read
   state; using `game` instead of `turnDisplay` would show the next ride/lottery result or the 30th
   segment before its arrival reveal (violates 2026-11-03 decision). Unit tests in
   `turn-moment-presentation.test.ts` / `game-app-turn-moments.test.ts` are the guard.
5. **HUD layout regressions.** Replacing the 30-cell bar with text must keep the constant row height
   and phone panel cap (#70 decisions, `hud-layout.spec.ts`, `text-wrapping.spec.ts`). Longest
   existing label is already `羽田空港第1・第2ターミナル方面`, so the new labels do not widen HUD needs.
6. **Map layer contract.** New layers/images must be re-added on `style.load`; E2E helpers assume
   the marker is a `circle` layer at `LAYER_IDS.currentPosition` with a single-Point source; style
   reload test asserts unique ids. SDF icon via `addImage` avoids glyph-fixture regeneration; a
   glyph arrow or `−` (U+2212) label would need new glyph ranges in `tests/e2e/fixtures/glyphs`.
7. **Map performance.** Per-frame `setData` on the marker source already runs every frame; adding a
   bearing property is cheap, but recomputing next-segment filters per frame is not -- key them on
   reveal state, not on frames (`scripts/perf/measure-map.mjs`, `c1-map-performance-baseline.md`).
8. **Validator scope.** Applying the terminus rule globally would fail the frozen 1都3県 baseline
   (19 mismatches) if baseline validation is run in tests; scope it to the live dataset or make
   circular/frozen exemptions explicit.

---

## 8. Relevant tests

| Area | Tests |
|---|---|
| Labels / data | `tests/data_pipeline/test_validate.py` (pattern at :286-287), `test_overrides.py:79,218-220`, `test_suburban_stage_support.py:125`, `test_suburban_product.py`, `test_suburban_historical_baseline.py`; unit `product-data.test.ts`, `real-data-e2e-scenarios.test.ts`, `real-data.test.ts`, `data-contract-v3.test.ts:64,106`; E2E `full-game.spec.ts:61`, `tokyo-suburban.spec.ts`, `real-data.spec.ts`, `save-errors.spec.ts:138` |
| Saves / fixtures | `tests/e2e/fixtures/regenerate-saves.ts`, `item-saves.provenance.json`, `tests/unit/fixtures/edition-save-compatibility.json`, `engine-save-v4.test.ts`, `persistence.test.ts`, E2E `resume.spec.ts`, `save-errors.spec.ts` |
| 30/30 guidance / HUD / toasts | `hud-presentation.test.ts`, `game-hud.test.ts`, `game-app-item-progress.test.ts`, `turn-moment-presentation.test.ts`, `game-app-turn-moments.test.ts`, `toast.test.ts`, `turn-moment-components.test.ts`; E2E `hud-layout.spec.ts`, `layout.spec.ts`, `text-wrapping.spec.ts`, `accessibility.spec.ts`, `full-game.spec.ts`, `ui-pop.spec.ts` |
| Map progress / marker | `game-session.test.ts` (progressStyle helpers), `map-flash.test.ts`, `map-helpers.test.ts`, `map-station-markers.test.ts`, `map-camera.test.ts`, `capital-region-scaling.test.ts`; E2E `map-visual.spec.ts`, `map-failure.spec.ts:150-173`, `tokyo-suburban.spec.ts`, `ui-pop-turn-moments.spec.ts`, `accessibility.spec.ts:653-803`, helpers `tests/e2e/support/app.ts:318-385` |
| Roll adjust | `engine-item-turn.test.ts`, `game-session-items.test.ts`, `item-controls.test.ts`, `turn-moment-items.test.ts`, `game-presentation.test.ts`; E2E `items.spec.ts`, `auto-roll-decisions.spec.ts`, `ui-pop-turn-moments.spec.ts`, `ui-pop.spec.ts`, `resume.spec.ts`, `accessibility.spec.ts`, `text-wrapping.spec.ts` |

Local E2E policy (user memory): run only affected specs locally; the 4-browser matrix runs in CI.
