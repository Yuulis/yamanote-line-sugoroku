# Codebase scan: JR East 1都3県 expansion (affected areas)

Date: 2026-10-12 · Scope: read-only scan of `feature/jrx-e2e-map-ready` (HEAD `45ca369`) · Input brief:
`.claude/docs/research/feature-jr-east-capital-region-expansion-brief.md`.

Measured on this machine (raw N02 present under `N02-25_GML/UTF-8/`):

- Current build: `uv run python -m scripts.data_pipeline.build --quiet --out-dir <scratch>` **3.3 s**, output
  byte-identical to `public/data/*`; `validate` **0.5 s**; `vitest run tests/unit/real-data.test.ts` (8 full games)
  **0.4 s**.
- JR East N02 inside a loose 1都3県 envelope (lon 138.9–140.9, lat 34.85–36.3, wider than the area): **1,389
  sections / 1,791 km** (conventional ≈ 1,630 km after removing 上越/東北新幹線), **602 platform features, 515
  distinct names**, 28 N02 line names (中央線, 東北線, 東海道線, 総武線, 常磐線, 京葉線, 武蔵野線, 南武線, 横浜線, 根岸線,
  横須賀線, 相模線, 青梅線, 五日市線, 八高線, 川越線, 高崎線, 赤羽線, 鶴見線, 内房線, 外房線, 成田線, 久留里線, 東金線,
  鹿島線, 山手線, plus out-of-area 伊東線/水戸線). Note N02 `横須賀線` is only 25.7 km (大船–久里浜); the 品鶴線
  (品川–鶴見 via 武蔵小杉) is under N02 `東海道線`, and 京浜東北/宇都宮 tracks are both N02 `東北線`.
- Current payload density: `segments.geojson` 41,176 B for ≈ 125 km of per-service features ≈ **330 B/km**.

---

## 1. Hardcoded network assumptions

| Location | Assumption | Expansion impact |
|---|---|---|
| `src/features/game/gameConfig.ts:4-6` | `EXPECTED_STATION_COUNTS = { "jr-yamanote": 30 }` | Keep only if Yamanote stays the target |
| `src/features/game/gameConfig.ts:14-20` | `rulesetVersion "jr-east-23ku-1"`, target `jr-yamanote`, start `shimbashi`, dir 1, `truncate-on-target-service` | Must bump `rulesetVersion`; goal fields are the only goal levers |
| `src/features/map/railwayLayers.ts:60` | services layer filter `!= "jr-yamanote"` (literal) | Should come from config |
| `src/features/map/progressStyle.ts:11,19` | default `targetServiceId = "jr-yamanote"` in both progress filters | Same |
| `src/features/game/components/GamePanel.tsx:48-49,109,113` | title 山手線すごろく, subtitle `JR東日本 東京23区版`, legend `山手線 踏破済み/未踏破` | Text change; title wording is a user decision |
| `src/features/game/components/TitleScreen.tsx:127-138` | subtitle, "東京23区内のJR東日本5路線", "外回り全30区間", 新橋 | Rewrite with goal rule |
| `src/features/game/components/ClearScreen.tsx:25` | "山手線の外回り全30区間を踏破し" | Depends on goal rule |
| `index.html:6` | `<title>山手線すごろく — JR東日本 東京23区版</title>` | Text |
| `README.md:3`, `data/README.md:1-5,71-75`, `docs/manual/jr-east-tokyo/{rules,implementation-status}.md` | 5 services / 67 / 22 / 146 / 88 | Docs |
| `scripts/data_pipeline/config.py:55` | `CANDIDATE_SEARCH_BBOX = (139.45, 35.45, 140.05, 35.95)` (N02 platform search, also via-point check `constraints.py:162-164`) | Excludes most of 1都3県 (銚子 140.8, 館山 35.0, 熊谷 36.1, 小田原 139.15, 奥多摩 139.1); widening it also admits same-name platforms in Ibaraki/Tochigi/Gunma/Yamanashi |
| `scripts/data_pipeline/config.py:58-82` | `TOKYO_23_WARDS` | Area concept must become prefecture (+ municipality) |
| `scripts/data_pipeline/config.py:91` | `MAX_GEOJSON_BYTES = 300_000` | Will be exceeded (§8 R2) |
| `scripts/data_pipeline/config.py:93-95` | `OUTPUT_BBOX = (139.55, 35.50, 139.95, 35.85)`; used by every coordinate check `validate.py:102-103` | Every out-of-ward coordinate fails rule 1 |
| `scripts/data_pipeline/config.py:41` | `METRIC_CRS = EPSG:6677` (JPRCS IX) | Still valid: 東京/埼玉/千葉/神奈川 are all zone IX |
| `scripts/data_pipeline/registry.py:20,118-122` | registry column `ward`, must be one of the 23 wards | Column + rule change |
| `scripts/data_pipeline/rules.py:68-69` | `check_registry_membership` "lies outside the 23 wards" | Same |
| `data/overrides/dataset.json` | `areaName "東京23区"`, 5-id catalogue, target/start | Data |
| `data/overrides/stations.csv` (67 rows + header) | `ward` column, `representative_service_id` per station | Several hundred curated rows |
| `src/features/map/mapConfig.ts:5-9` | `MAP_CENTER` = Yamanote centre, `MAP_ZOOM 11.5`, **`MAP_MIN_ZOOM 9`** | Full area (≈ 1.9° lon × 1.3° lat) needs zoom ≈ 8 on desktop and ≈ 7.3 on a 390 px phone; min zoom 9 makes the overview fit impossible |
| `tests/e2e/fixtures/seeds.ts:2-9` | pinned `FIXTURE_GAME_SEED`, scenario turns 1/2/3/8/15 | Re-prove only if lottery/goal semantics change (fixture network is independent of real data) |

Not hardcoded (good): service list, colours, names, direction labels and endpoint kinds all come from
`services.json`; lottery order = data order (`src/features/game/engine/network.ts:34-35`).

---

## 2. Data model (`src/types/*`, contract v2)

- `Segment` = one `geometryFeatureId: string` per directed segment (`src/types/network.ts:32-39`); runtime guard
  requires a non-empty string (`src/data/guards.ts:89-98`).
- Feature properties `{featureId, serviceId, from, to}` (`src/types/data.ts:29-41`), LineString only
  (`guards.ts:142-146`). Features are **per service per +1 pair** (`export.py:102-104`, id
  `"{service}:{a}~{b}"`): the 88 features = 30 + 21 + 23 + 9 + 5; parallel services on the same corridor do *not*
  share features today — "shared" means shared by both directions only.
- Load-time cross-check `src/features/game/networkFromData.ts:37-47`: every segment's feature must exist, have the
  **same `serviceId`**, and join exactly the segment's `from/to` (either orientation).
- `ServicePattern` (`network.ts:17-30`): `stationIds` (no repeats, `network.ts:108-110`, `guards.ts:60`),
  `circular`, `endpoints {first,last}: terminus | area-boundary`, `platformCoordinates` keyed by exactly the stops
  (`guards.ts:67-71`). No service-type/category field (local vs rapid), no "through-service" link, no weight.
- `Manifest.schemaVersion: 2` literal type (`data.ts:15`), guard `guards.ts:135`, validator `validate.py:463-464`,
  exporter `export.py:193`.

**What breaks when consecutive stops are not track-adjacent (rapid services):**

1. Engine: nothing. `validateSegment` only requires adjacency *within the service's own `stationIds`*
   (`network.ts:118-132`), so a rapid service listing only its stops is structurally valid.
2. Geometry identity: a rapid hop needs the track of several physical pairs. Composition from another service's
   features is rejected by `networkFromData.ts:44` (serviceId mismatch) and `:40-43` (pair mismatch); the type only
   holds one id.
3. Animation: `stepPath` takes one feature (`src/features/game/animation/movePath.ts:100-106`) and `orientPath`
   orients **by station identity** and throws when the feature does not join the hop's stations
   (`movePath.ts:70-78`). A composed path needs the ordered list of features *and* the pass-through station
   sequence (to orient each piece), or pre-oriented pieces.
4. Progress layers: `GameApp.tsx:74-85` maps completed **segment ids → one feature id** and only for target
   segments; `progressStyle.ts:4-22` filters by `featureId` + target `serviceId`. Fine while the target is Yamanote;
   a track-coverage goal would need segment → covered physical pairs.
5. Pipeline: `build_segments`/`build_segment_features` emit exactly one feature per service pair
   (`export.py:107-150`); validator rule 11 requires feature ids == canonical per-service pair list
   (`validate.py:348-358`) and properties == `{featureId, serviceId, from, to}` of that pair (`:385-391`); rule 14
   sums a service's own features for `lengthRef` (`validate.py:407,433-439`).
6. Map: services layer draws features, not services (`railwayLayers.ts:55-68`); a rapid service that owns no
   features is invisible on the map though listed in the legend.
7. Not every rapid/medium-distance service runs on a local's track: 東海道線 (東京–横浜), 宇都宮/高崎線 (列車線),
   総武快速, 常磐快速, 中央快速 run on their own track pairs where they are the *only* all-stop-ish service. So the
   model needs both "own geometry" and "composed from another service's pairs".

---

## 3. Engine (`src/features/game/engine/*`)

- **Candidates** = every service stopping at the station, deduplicated, in `services.json` order, ridden service
  included (`network.ts:153-167`, `network.ts:300-309`, `landing.ts:55-79`). k ≥ 2 → uniform draw
  (`landing.ts:142-149`); no weighting primitive exists — `drawIndex` is uniform with rejection sampling
  (`rng.ts:164-191`). Weighting = new RNG primitive + `rulesetVersion` bump + all pinned trajectories re-proven
  (draw order contract `landing.ts:3-14`, `rng.ts:13-18`).
- **Direction**: target service forced to `targetDirection`; others → movable directions in `[1,-1]`
  (`landing.ts:64-72`, `network.ts:316-324`). R1-a re-draw at every landing.
- **Open chain vs cycle**: `nextStationId` wraps only for `circular` (`network.ts:266-280`), endpoint truncation
  discards pips (`movement.ts:79-92`). Branches must be separate services (no repeated station in one service:
  `network.ts:108-110`).
- **Config constraints** (`config.ts:39-62`): target must exist, be **circular** (`:49`), contain the start, and
  have every target-direction segment; every non-target service needs **both** directions for every pair (`:54-56`)
  — so a second circular service would fail (the pipeline exports loops +1 only, `topology.py:24-29`); the start
  station must not be an end of any linear service (`:57-60`; mirrored `overrides.py:581-588`, `rules.py:378-385`) —
  e.g. 東京 could not be the start (terminus of 中央快速/京葉線).
- **Goal** (`goal.ts:7-46`): "all target-service segments in target direction completed, standing on start".
  `GameConfig` has only `targetServiceId/startStationId/targetDirection/goalArrivalPolicy` (`network.ts:64-70`). Any
  other goal (station collection, N lines, distance) needs new config fields + goal module + save/config compare
  (`save.ts:72-85,267-275`).
- **Completion unit** is the directed `(service, from, to)` segment id (`movement.ts:93-99`). A rapid hop completes
  only its own segment, never the local segments it physically covers; pass-through stations are not recorded.
- **Per-turn cost** (all fine at today's size, grow with C = completed segments):
  `advance` copies `completedSegmentIds` and builds a `Set` every turn (`movement.ts:71-73`) → O(C);
  `targetSegmentIds` recomputed per move (`movement.ts:71`); goal check `required.every` per hop
  (`movement.ts:113-114`) is O(|target|) — O(total segments) if the goal becomes "all segments".
  `nextStationId` uses `indexOf` (O(stops)). `computeTurn` copies events (`game.ts:107-108`). Nothing is
  super-linear per turn; restore is O(T·C) and runs **two** full replays (`save.ts:353-354`).
- Network build: `validateSegment` rebuilds `servicePairs` for every segment (`network.ts:118-132`) →
  O(segments × stops); `indexServicesByStation` spreads arrays per insert (`network.ts:160`). One-off at load,
  negligible below ~10k segments.

---

## 4. Pipeline (`scripts/data_pipeline/*`) incl. simulation

Flow (`build.py:199-212`): `load_overrides` → `N02Source` (reads full JR East N02 once, platform search limited to
`CANDIDATE_SEARCH_BBOX`, `n02.py:76-87`) → per service `route_service` (`build.py:135-167`) → `export.build_files`.

- **Per-pair line mapping**: every +1 stop pair maps to exactly **one N02 line** (`overrides.py:427-466`); the
  track graph per pair is built from that one line's sections only (`build.py:152-163`). Via points only on
  single-pair ranges (`overrides.py:449-453`). A hop whose track crosses an N02 line boundary between two stops
  (typical for long rapid hops, e.g. 湘南新宿ライン 大崎→西大井 over 山手線/東海道線(品鶴)) cannot be routed.
- **Routing**: open-chain / loop DP over platform candidates, deterministic tie-break (`routing.py:155-228`);
  Dijkstra runs to completion with shapely `substring` per relaxation (`network.py:115-145`), c² runs per pair
  (`routing.py:94-119`). Today 3.3 s for 92 pairs; ≈ 1,500 pairs extrapolates to ~1 min — acceptable, not a blocker.
- **Platform matching**: by normalised name **and** the N02 lines adjacent to the stop (`build.py:53-111`);
  multiple N02 group codes without a selector is an error (`build.py:104-109`); registry rejects homonyms
  (`registry.py:111-117`).
- **Overrides format** (`overrides.py:1-12`, `data/README.md`): `dataset.json`, `stations.csv`
  (`id,name,n02_name,ward,representative_service_id`), `services.json` (`id,name,color,circular,directionLabels,
  endpoints,expectedStopCount,lengthRef{km,toleranceKm,source}`), `services/<id>/{stops.csv,line_mapping.csv,
  sections.csv?}`, `offset_exceptions.csv`.
- **Station-number check** (`overrides.py:384-424`): numbers must have one prefix and step by exactly ±1. Rapid
  services skip numbers (中央特快 on JC, 総武快速 on JO) and through services mix prefixes (上野東京ライン JT/JU) →
  **fails**; needs "strictly monotonic, gaps allowed" for non-all-stop services, or empty numbers.
- **Validator, 17 rules** (`validate.py:480-539`, list in `jr-east-tokyo-expansion-design.md` §5.4):
  rule 1 coordinates in `OUTPUT_BBOX` (`validate.py:93-103`); 2–3 registry/ward/catalogue (`rules.py:51-86`);
  4 metadata (`validate.py:157-259`); 5 stop lists (`rules.py:113-134`); 6 contiguity (`rules.py:137-154`);
  7–8 platforms/offsets ≤ 250 m default (`rules.py:229-273`, `config.py:90`); 9–10 directed pairs + walks
  (`rules.py:157-223`); 11–13 features/endpoints ≤ 30 m/detour ≤ 1.8/same-service skipped stop 100 m/via
  (`validate.py:328-447`); 14 length vs `lengthRef` (`rules.py:318-328`); 15 connectivity + reviewed disconnected
  list (`rules.py:334-375`); 16 start not an endpoint; 17 canonical bytes, content hash, size budget
  (`validate.py:450-538`). Expansion-sensitive: 1, 2–3, 11, 14, 17 (budget); 13 detour 1.8 is risky on curvy
  branch lines (青梅/八高/久留里); 8 will need more offset exceptions at big stations.
  `check_geometry` scales O(features × (platforms + stations)) in Python (`validate.py:408-422`) — ~100× today,
  still seconds.
- **Determinism**: `dataVersion = n02-2025-<sha256 of the 4 game files>[:12]` (`export.py:175-197`), atomic writes,
  manifest last (`export.py:233-246`); pinned inputs `data/n02-2025.sha256`; byte-for-byte test
  `tests/data_pipeline/test_build.py:45-55` (skipped in CI without raw data); canonical serialisation re-checked by
  the validator (`validate.py:514-531`).
- **Simulation / Monte Carlo: no script exists** (repo searched; also no leftover scratchpad). The 23-ward numbers
  (`jr-east-tokyo-expansion-design.md` §3.1-3.4, median 52 / p90 114 / p99 189) came from a *throwaway* Python
  script (`random.Random`, not sfc32) over the CSV in `.claude/docs/research/jr-east-tokyo-service-graph.md:16-`
  (`service_id,name_ja,circular,status,stop_count,stops` with `|`-separated Japanese names). Options for the new
  study:
  - Graph-level Python MC on a researcher CSV of the same shape (fast to iterate on goal-rule variants; no N02
    needed; must re-implement R1-a, truncation, goal policy faithfully).
  - Engine-level TS harness reusing the real engine: `loadBundle("real" | "fixture")` from
    `tests/e2e/fixtures/bundle.ts:18-25` + `createGame`/`playTurn` exactly as `tests/unit/real-data.test.ts:32-51`,
    run with `npx vitest run <file>` (Vitest is the only TS runner; `vite.config.ts:18-21` includes only
    `tests/unit/**/*.test.ts`; Node type-stripping cannot resolve the extension-less `src` imports). Needs a
    generated bundle, i.e. only after data exists; goal variants need engine changes first.

---

## 5. Map & UI

- Layers (`railwayLayers.ts:50-144`): one `services` line layer for all non-target features with a **single
  constant** offset 4 / width 3 / opacity 0.65 (`mapConfig.ts:43-46`) → all parallel services on a corridor draw on
  top of each other; target pending/completed layers; station circles + labels (all stations, `minzoom 10`,
  `mapConfig.ts:68`); one marker source updated per frame (`railwayLayers.ts:157-160`).
- Colours: `match` on `serviceId` (`lineColor.ts:6-18`); fine for 80 entries, but JR East line colours repeat
  (orange 中央快速/東海道/宇都宮/高崎, blue 横須賀/総武快速, …) so colour alone cannot distinguish services.
- Overview: `fitNetworkOverview` fits all platform points with `maxZoom: MAP_ZOOM` (`RailwayMap.tsx:64-81`) but is
  floored by `MAP_MIN_ZOOM 9` (`mapConfig.ts:9`) → cannot fit 1都3県 (see §1); real-data E2E asserts every platform
  is in view and outside the panel (`tests/e2e/real-data.spec.ts:9-29`).
- Legend: one `<li>` per non-target service (`GamePanel.tsx:115-122`), flex-wrap, 11–12 px
  (`src/styles.css:208-216,491-494`) inside a panel capped at `max-height: 45%` on phones (`styles.css:468-473`,
  scrolls `:105-106`). 40–80 entries will dominate the panel.
- Lottery text joins every candidate name (`presentation.ts:40-42`) in an `aria-live` region
  (`GamePanel.tsx:97-99`) — long at hubs (東京/新宿/大宮/横浜/千葉 likely 6–12 candidates).
- Station popup lists all service names (`stationCollection.ts:27-31`, `stationPopup.ts:2-16`) — long but safe
  (textContent). Built O(stations × services × stops) once.
- Animation: constant time per hop (`timeline.ts:22-37`, speeds `gameConfig.ts:23-27`) → a 20 km rapid hop and a
  1 km local hop take the same 450 ms (marker speed varies ×20). Per frame, `GameApp.tsx:74-85` filters all
  completed ids and `RailwayMap.tsx:220` joins them into a key → O(C) per frame (cheap today).
- Clear screen renders the full history (`ClearScreen.tsx:40-53`); no cap (by design, design §3.2).

---

## 6. Saves

- `SAVE_VERSION = 2` (`game.ts:23`); version checked first (`save.ts:121-130`) → `UNSUPPORTED_SAVE_VERSION`.
  Then `DATA_VERSION_MISMATCH` (`save.ts:341-346`), `CONFIG_MISMATCH` via `expectedConfig`
  (`save.ts:348-350`), structural replay (`save.ts:236-265`), seeded replay (`save.ts:295-305`).
- New data alone already invalidates old saves (`dataVersion` hash) and a new `rulesetVersion` adds
  `CONFIG_MISMATCH`; a `SAVE_VERSION` bump is only required if the save shape changes (e.g. new config fields,
  visited stations). Rejection UX exists: title shows `saveProblemMessage` + 「セーブデータを破棄」
  (`TitleScreen.tsx:47-55`, `persistence.ts:44-61`); storage key `yamanote-line-sugoroku:save:v1`
  (`persistence.ts:19`).
- Size: segment ids are `"{service}:{from}:{to}"` (`export.py:47-48`, ~30–50 chars). Save = completed ids + per-turn
  traversed ids, written on every committed turn (`useGameApp.ts:57-60`). A 1,000-turn game with ~3,000 completed
  ids is ≈ 300–400 KB — within localStorage, but restore = 2 × O(T·C) replay on every title-screen visit
  (`useGameApp.ts:64-67`).
- `parseConfig` knows exactly the five config fields (`save.ts:72-85`); new goal fields must be added there and in
  `sameConfig` (`save.ts:267-275`).

---

## 7. Tests

- **Vitest** (`tests/unit/*`, node env). Synthetic fixtures `tests/unit/fixtures/{yamanote,multiService,railway}.ts`
  are independent of shipped data. Real-data coupling: `tests/unit/real-data.test.ts:13-30` asserts exact ids,
  stop counts `[30,22,24,10,6]`, 67 stations, 146 segments, 22 transfer stations, 88 features, and
  `servicesByStation("tokyo")`; `:32-51` plays 8 seeds to completion with `MAX_TURNS = 5_000` and restores. Must be
  rewritten; the 5,000-turn safety cap must exceed the new p99.9.
- `tests/unit/e2e-fixture-seeds.test.ts:7-63` proves the pinned fixture trajectory (transfer t1, boundary t2,
  terminus t3, direction t8, clear t15) — invalidated by any change to lottery/goal semantics or `MVP_GAME_CONFIG`
  goal fields, not by real-data changes.
- **Playwright**: hermetic fixture network `tests/e2e/fixtures/data/*` (hand-maintained, no generator: jr-yamanote
  30 + `fixture-south` + `fixture-west`, 34 stations, 38 segments) served by route interception
  (`tests/e2e/fixtures.ts`); it must still satisfy `networkFromData` (`EXPECTED_STATION_COUNTS`, `MVP_GAME_CONFIG`).
  Text assertions: `lottery.spec.ts:19` `4/30`; `full-game.spec.ts:17-46` 15 turns. Real-data smoke
  `tests/e2e/real-data.spec.ts:31-76` asserts 67 stations, subtitle `JR東日本 東京23区版`, four legend names, rendered
  service ids **exactly** `["jr-chuo-sobu-local","jr-keihin-tohoku","jr-keiyo","jr-saikyo"]` (`:45-49`, also depends
  on what is on screen at the overview zoom), and the full-overview fit.
- **pytest** (`tests/data_pipeline/*`): `test_validate.py` runs against committed `public/data` + overrides
  (`:24-34`, literal "expected 67 stations" `:65`, "30-step walk" `:76`); `test_overrides.py:72,86-88` assert 67
  registry rows and `[30,22,24,10,6]`; `test_build.py` (raw-data only) byte-for-byte + Yamanote corridor checks
  (`:45-72`); `fixtures/jr_east_core/` is a frozen 5-service override copy used for multi-service paths
  (`support.py:11-13`, `conftest.py:43-48`) — still valid as a synthetic fixture. `test_routing.py` /
  `test_export.py` are synthetic.
- Regeneration needed: `public/data/*`, real-data Vitest + E2E smoke, `test_overrides.py` counts,
  `test_validate.py` count literals; fixture network + seed proofs only if rules change.

---

## 8. Scaling risks, ranked

1. **R1 — Rapid-service geometry has no representation (High).** One feature id per segment, feature must belong
   to the same service and join the hop's endpoints (`types/network.ts:38`, `networkFromData.ts:37-47`,
   `movePath.ts:70-106`, `export.py:107-150`, `validate.py:348-391`). Composition needs a contract change
   (schemaVersion 3): e.g. ordered `geometry: {featureId, reversed}[]` or a pass-through station list per segment,
   plus validator rules for composed paths, a map layer for feature-less services, and length checks over composed
   paths. Some medium-distance services own their track (no local to borrow from), so both modes are needed.
2. **R2 — Payload / rendering budget (High).** ≈ 1,630 km of conventional N02 track at ≈ 330 B/km ≈ 0.5 MB with
   one feature per physical pair, more where local services overlap; `MAX_GEOJSON_BYTES = 300_000`
   (`config.py:91`) fails. Levers: per-physical-pair shared features (not per service), `SIMPLIFY_TOLERANCE_M`
   (`config.py:47`, 1 m), `COORDINATE_DECIMALS` 6 → 5, gzip on Vercel. `services.json` grows with
   `platformCoordinates` per service per stop; `segments.json` (28,949 B today) scales with 2×pairs.
3. **R3 — Goal / game length (High, user decision).** Goal is hard-wired to a circular target service
   (`config.ts:49`, `overrides.py:575-576`, `goal.ts`); with dozens of services and uniform k-way lotteries the
   Yamanote-return probability per landing drops sharply, so game length can explode. Changing the goal touches
   `GameConfig`, `goal.ts`, `config.ts`, `save.ts` parse/compare, presentation texts, the fixture trajectory, and
   requires an MC harness first (none exists, §4).
4. **R4 — Area model & search bounds (Medium-High, mechanical but wide).** `TOKYO_23_WARDS` / `ward` column /
   `OUTPUT_BBOX` / `CANDIDATE_SEARCH_BBOX` (§1). Widening the platform bbox imports same-name stations from
   neighbouring prefectures; the homonym guards (`registry.py:111-117`, `build.py:104-109`) will surface them as
   build errors needing selectors.
5. **R5 — Map scalability (Medium).** `MAP_MIN_ZOOM 9` blocks the overview; single constant-offset services layer
   overlaps parallel services; shared JR colours; 40–80-row legend in a 45 %-height phone panel; label density at
   zoom ≥ 10 (§5).
6. **R6 — Override curation checks that assume all-stop single-line services (Medium).** Station numbers ±1 single
   prefix (`overrides.py:384-424`), one N02 line per stop pair (`overrides.py:427-466`, `build.py:152-163`), detour
   ≤ 1.8 per pair (`config.py:87`) and 250 m platform offset default (`config.py:90`).
7. **R7 — Lottery semantics (Medium, user decision).** Uniform over all services at a station
   (`landing.ts:55-79,142-149`); local/rapid weighting needs a new RNG primitive and ruleset bump. Through-running
   splits (上野東京ライン, 湘南新宿ライン) only affect data, not engine, if modelled as separate open chains.
8. **R8 — Per-turn / restore cost (Low).** O(C) copies per turn, O(T·C) ×2 on restore, O(C) per animation frame
   (§3, §5, §6). Fine below ~10k completed ids; becomes visible only with a "complete everything" goal.
9. **R9 — Pipeline runtime (Low).** 3.3 s today; ~1 min extrapolated. Dijkstra without early exit
   (`network.py:115-145`) is the first thing to optimise if needed.
