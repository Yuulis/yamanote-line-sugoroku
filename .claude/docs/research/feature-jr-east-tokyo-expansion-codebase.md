# Codebase analysis: JR East Tokyo-area expansion (multi-service, forced transfers)

Date: 2026-10-12 · Branch analysed: `develop` @ `4a0cb52` · Read-only analysis (no code changed)
Spec: `railway_sugoroku_mvp_spec.md` §2, §4, §5, §10 item 1 (station groups, transfer detection,
uniform service lottery, direction lottery, endpoint handling).

Legend: **MUST** = breaks or is wrong once more than one service / a non-circular service exists.
**EXT** = already extensible, keep. **DECIDE** = needs a product/design decision before implementing.

---

## 0. Top decision-relevant findings

1. **Save/replay is the hardest seam.** `restoreGame` replays history with `moveByRoll(record.roll)`
   (`src/features/game/engine/save.ts:150-164`, `:187-193`) and `verifySeededHistory` replays with
   `playTurn` assuming exactly one `rollDie` per turn and comparing only `roll`
   (`save.ts:232-247`). Any service/direction lottery adds RNG draws *inside* a turn and changes
   `currentServiceId`/`direction` after landing; neither replay path can reproduce that today.
   `MoveRecord` (`src/types/network.ts:33-41`) records only the service/direction *ridden*, not the
   landing decision. Required: record the landing resolution in `MoveRecord`, make
   `moveByRoll`+`resolveLandingEvent` replayable from recorded choices (shape replay) and make
   `verifySeededHistory` compare whole records (the M2 note already predicted this:
   `.claude/docs/research/m2-experience.md:90`). Bump `SAVE_VERSION` (`game.ts:18`) and
   `rulesetVersion` (`gameConfig.ts:8`).
2. **RNG has no generic uniform draw.** `rng.ts` only exposes `rollDie` (fixed 6 faces,
   `rng.ts:32-35,118-132`). Uniform choice over k services / k directions needs a new
   `drawIndex(rngState, k)` with the same rejection-sampling technique. The draw order
   (roll → service → direction) and whether a *forced* choice (k = 1, terminus, Yamanote fixed
   direction) consumes a draw must be fixed in the ruleset, because it changes every later roll.
   Skipping draws when k = 1 keeps the existing fixed-seed dice snapshot
   (`tests/unit/engine-rng.test.ts:52`) valid for a pure-Yamanote game.
3. **The pipeline is structurally single-loop.** Station/segment/line-mapping logic is modular
   arithmetic over one cycle (`overrides.py:139-166`, `build.py:32-35`, `routing.py:62-117`,
   `export.py:77-92`) and validation asserts exactly one circular service of 30 stations closing at
   新橋 (`validate.py:111,148-169,180,205,216-231,357-362`; `config.py:45-55`). Track routing
   (`network.py`, `TrackNetwork.shortest_path`) and N02 loading (`n02.py`) are reusable as-is.
   Needed: per-service override tables, an open-path DP variant, bidirectional segment export,
   per-service validation (official length table instead of `OFFICIAL_LOOP_LENGTH_KM`), wider
   `OUTPUT_BBOX`, and a relaxed "foreign station" check.
4. **Station identity / groups need a decision.** N02 gives a cross-operator station group code
   `N02_005g` (`config.py:31`, already loaded into `PlatformCandidate.group_code`, `n02.py:26`) but
   it is not exported. Measured on the local N02 copy (JR East, bbox 139.3-140.2E / 35.3-36.0N):
   410 platforms, 333 names, **no same-name homonyms (> 1 km)**, group code consistent except
   東京 (京葉線 platforms `003785` vs `003766`) and 武蔵小杉 (`004297`/`004301`). Same-name
   platforms spread up to **448 m (東京)**, 393 m (武蔵小杉), 216 m (新宿) — far beyond the 30 m
   endpoint check (`config.py:47`, `validate.py:333-339`). Options: (a) one `Station` per physical
   station shared by all services (simple engine; per-service platform point for geometry), or
   (b) one `Station` per (station, line platform) linked by `groupId` (spec §5 shape; goal and
   transfer checks must compare groups, not ids). `groupId` is typed and guarded
   (`types/network.ts:12`, `guards.ts:53`) but used nowhere else.
5. **Non-circular movement currently throws.** `moveByRoll` throws `INVALID_STATE` at the end of a
   non-circular service (`game.ts:94-97`); spec §2/§11 requires stopping at the endpoint and
   discarding pips. `unusedPips` is today interpreted everywhere as "stopped at the goal"
   (`GamePanel.tsx:31-35`, `ClearScreen.tsx:45`, `gameSummary.ts:17-20`), so a terminus stop would
   be mislabelled "新橋で停止". Needs a stop reason (event + record field). The network validator
   only checks direction +1 completeness (`network.ts:170-176`); direction −1 segments must exist
   for every non-fixed-direction service or `moveByRoll` throws "No segment" (`game.ts:98-101`).
6. **`expectedStationCount` applies to every service** (`network.ts:22-25,87-95`;
   `networkFromData.ts:28`; `gameConfig.ts:4`). With a second service the app refuses to start
   ("路線データが不正です"). Must become target-service-only or be dropped.
7. **UI/progress counting is single-service.** The panel shows
   `displayedCompletedCount = shown.completedSegmentIds.length` (`GameApp.tsx:147-149`) — once
   other services' segments enter `completedSegmentIds` (they do: `game.ts:102-106`), "踏破区間 X/30"
   over-counts. Direction labels are 外回り/内回り for any service (`GamePanel.tsx:25,54`); title,
   rules and clear texts hard-code 山手線/外回り/30区間 (`TitleScreen.tsx:127-133`,
   `ClearScreen.tsx:25`, `index.html:6`). No current-service display, no lottery display.
8. **Data size budget.** Current `segments.geojson` = 12,992 B for 30 segments / 34.45 km
   (~377 B/km at 1 m Douglas-Peucker, 6 decimals). `MAX_GEOJSON_BYTES = 300_000`
   (`config.py:52`). Exporting one feature per *directed* segment (current rule
   `geometryFeatureId == id`, `validate.py:193-194`) doubles bytes for bidirectional services; a
   ~700 km service set would be ~264 KB undirected / ~528 KB directed. Share one feature per
   undirected service-segment (the animation already orients reversed geometry:
   `movePath.ts:58-71`) and revisit the budget.
9. **E2E assumes a short deterministic Yamanote lap.** `full-game.spec.ts:18-19` caps the game at
   30 rolls; `dice.spec.ts:61,85-87` equates completed count with the panel. With forced transfers a
   real-data game can last hundreds of turns (most Yamanote stations become transfer stations), so
   a full-game E2E needs a fixture dataset or a known short seed. Game length itself is a
   **DECIDE** item (simulate before committing to the rule set).

---

## 1. Data pipeline (`scripts/data_pipeline/*`, `data/overrides/*`, `tests/data_pipeline/*`)

### 1.1 Current flow

`build.build()` (`build.py:65-108`): load overrides → expand line ranges to one N02 line per segment
→ per station, collect JR East platform candidates with the same name on the lines of its two
adjacent segments (`build.py:32-62`, `n02.py:59-85`) → load JR East sections of those lines within a
2 km box (`n02.py:88-112`) → one `TrackNetwork` per N02 line (`build.py:84`) → choose one platform
per station by cycle DP minimising the closed-loop length (`routing.py:62-117`) → export
stations/services/segments/geojson + content-hashed manifest (`export.py`).

Representative point = midpoint along the chosen platform LineString in EPSG:6677
(`n02.py:82`). Segment geometry = shortest track path between the two chosen midpoints on the
segment's mapped N02 line, simplified 1 m, WGS84, 6 decimals, oriented from→to
(`export.py:31-42`).

### 1.2 Hard-coded single-loop assumptions

| Location | Assumption | Verdict |
|---|---|---|
| `config.py:1,16-18` | Files `yamanote_stations.csv`, `yamanote_line_mapping.csv`, `service.json` (one service) | MUST: per-service tables (e.g. `data/overrides/services/<id>/{stations.csv,line_mapping.csv}` + `services.json` list) |
| `config.py:45-46` | `EXPECTED_STATION_COUNT = 30`, `START_STATION_ID = "shimbashi"` | MUST: per-service expectations; start belongs to game config |
| `config.py:49-51` | `MAX_DETOUR_RATIO`, `OFFICIAL_LOOP_LENGTH_KM = 34.5 ± 1.5` | MUST: per-service official route length table; detour threshold may need per-segment exemptions |
| `config.py:52` | `MAX_GEOJSON_BYTES = 300_000` | DECIDE: new budget (see §0.8) |
| `config.py:55` | `OUTPUT_BBOX = (139.60, 35.55, 139.85, 35.80)` (Yamanote-sized) | MUST: widen to the target area |
| `overrides.py:23-29,86-124` | `StationOverride.jy_number`; `validate_stations` requires exactly 30 rows, S[0] = 新橋, JY numbers descending cyclically | MUST: generic station-number check per service (prefix + monotonic, cyclic only when `circular`) |
| `overrides.py:38-47,180-197` | One `ServiceOverride` incl. `n02_operator`, `updated_at` | MUST: list of services; `updatedAt` should move to a dataset-level file |
| `overrides.py:139-166` | `expand_line_ranges` uses `% count` (wrap-around) and requires every segment of the cycle | MUST: open-path variant (no wrap, `count - 1` segments) when `circular = false` |
| `build.py:32-35` | `station_lines` uses `segment_lines[i - 1]` (wraps for S[0]) | MUST: endpoints of an open path have one adjacent segment |
| `build.py:38-62` | Candidates matched by `station.name` only | EXT for JR East (no homonyms measured); add group/override key for safety |
| `routing.py:62-117` | `route_loop` cycle DP, closes `count - 1 → 0` | MUST: add `route_path` (open chain DP: drop the closing edge, no fixed `first`) |
| `export.py:49-59` | Stations written from a list aligned 1:1 with one service | MUST: merge stations across services (dedupe by id/group), choose a representative point per station (DECIDE: shared point vs per-platform) and export `groupId` |
| `export.py:62-74` | `build_services` returns a one-element list | MUST: one entry per service |
| `export.py:77-92` | `build_segments` emits only direction +1, `(index + 1) % count` (closes loop) | MUST: for non-circular services emit `count - 1` pairs in **both** directions; for the circular fixed-direction Yamanote keep +1 only (or both, if 内回り mode is planned) |
| `export.py:95-112` | One feature per segment, `id == segmentId` | MUST/DECIDE: share one undirected feature per service pair to save bytes; properties would then need `segmentIds` or a pair id |
| `export.py:45-46` | `segment_id = f"{service}:{from}:{to}"` | EXT: already directed and service-scoped |
| `build.py:111-127` | `describe` prints a loop and `loop track length` | MUST (cosmetic): per-service diagnostics |
| `n02.py:59-112` | Filters by operator and line names, 2 km box around candidates | EXT; for a wide area the box grows large — consider per-service boxes to keep routing fast |
| `network.py` | Generic undirected track graph, snap + Dijkstra | EXT, unchanged |

### 1.3 N02 facts relevant to services (measured locally, JR East in the Tokyo box)

- N02 `N02_003` is the physical line, not the service (already documented for 山手線:
  `.claude/docs/research/m0-data-spike.md`). Lines present: 東北線 (36 stations), 中央線 30, 南武線 30,
  総武線 29, 東海道線 28, 武蔵野線 27, 常磐線 21, 横浜線 20, 京葉線 19, 相模線 18, 山手線 17, 鶴見線 13,
  根岸線 12, 川越線 11, 内房線 11, 久留里線 10, 青梅線 10, 八高線 10, 成田線 7, 高崎線 5, 外房線 4, 赤羽線 4,
  五日市線 3, 横須賀線 3 (+ 新幹線). Services such as 京浜東北線 (東北線+東海道線+根岸線),
  中央・総武緩行線 (中央線+総武線), 埼京線 (赤羽線+東北線…) must be defined by override stop lists plus
  per-run N02 line mapping — the existing `LineRange` mechanism generalises if made non-cyclic.
- Parallel tracks of one N02 line (e.g. 中央線 rapid vs local, 東北線 京浜東北 vs 宇都宮/高崎) are in the
  same N02 line; the shortest-path routing may jump between them. The current DP mitigates by platform
  choice; per-service track hints (via-points or section allowlists) may be needed — verify per service.
- `N02_005g` (group code) groups platforms across operators (e.g. 新宿 `003700` covers JR, 京王, 小田急,
  都営, 東京メトロ). Exceptions within JR East: 東京 京葉線, 武蔵小杉 → needs an override table for
  transfer groups ("同一駅構内または公式に案内される乗換", spec §2).

### 1.4 Validation (`validate.py`) structure

`validate_dataset` (`validate.py:401-423`) runs, in order: `check_stations` (count, unique ids and
**unique names**, coords in bbox, order equals override) → `check_service` (exactly one, circular,
starts at 新橋) → `check_segments` (exactly 30, E[i] = S[i]→S[i+1], closes to start) → `check_walk`
(30-step lap) → `check_geometry` (feature ids in segment order, properties equal segment, endpoints
≤ 30 m, detour ≤ 1.8, **no non-endpoint station within 100 m of any segment**, loop length) →
`check_manifest` (content hash, source contract) → geojson byte budget.

What must change:
- `check_stations`: count per service; uniqueness of names is fine for JR East but should be per
  group; order check must be per service (`validate.py:111-141`).
- `check_service` → `check_services` over a list; `circular` only where declared; start-station rule
  moves to the game config (`validate.py:145-169`).
- `check_segments`/`check_walk`: per service; for non-circular services expect `2·(n−1)` directed
  segments (both directions) and a walk end-to-end each way (`validate.py:172-231`).
- `check_geometry`: feature order/1:1 assumption (`validate.py:304-310`) breaks if features are shared;
  endpoint check must use the per-service platform point if stations share one representative point;
  the foreign-station check (`validate.py:346-355`) compares against **all** stations — with many
  services, lines legitimately pass non-stopping or other-service stations within 100 m (e.g. 湘南新宿
  ライン along 山手線; shared corridors). Restrict it to stations of the same service (stations the
  service skips are exactly what the check is for). `O(segments × stations)` cost grows to ~10^5-10^6
  distance calls — acceptable but consider an STRtree.
- Loop length (`validate.py:357-362`) → per-service length table.

### 1.5 Pipeline tests that hard-code Yamanote

- `test_overrides.py:16-20,29-50,80-106` (outer-loop names, 30 lines, specific indices, `expected 30 stations`).
- `test_validate.py:22-44,52-64` (shape of `services[0]`, `#9ACD32`, `expected 30 stations`, "30-step walk").
- `test_build.py:35-46` (30 paths, N02 line per corridor by index) — skipped in CI (raw data absent,
  `ci.yml` pipeline job comment) but **runs locally** because the raw N02 files exist in
  `N02-25_GML/UTF-8/`; the byte-for-byte rebuild check is the reproducibility guard.
- `test_export.py:31-39` (`build_segments` closes the loop) and `test_routing.py` (cycle DP only) —
  keep, add open-path cases.

---

## 2. Data contract (`public/data/*`, `src/types/*`, `src/data/*`)

### 2.1 Files and fields today

| File | Shape | Single-service assumptions |
|---|---|---|
| `stations.json` (3,463 B) | `[{id, name, coordinates}]` in outer-loop order | Order = service order (validator relies on it); no `groupId` emitted |
| `services.json` (715 B) | one `{id:"jr-yamanote", name, operator, stationIds[30], circular:true, color}` | one element |
| `segments.json` (5,619 B) | 30 × `{id, serviceId, from, to, geometryFeatureId == id}` | direction +1 only |
| `segments.geojson` (12,992 B) | 30 LineString features, `properties {segmentId, serviceId, from, to}` | one feature per directed segment |
| `manifest.json` | `{dataVersion: n02-2025-<hash>, updatedAt, source}` | EXT (hash covers the four game files; any data change invalidates saves via `DATA_VERSION_MISMATCH`) |

### 2.2 Types and guards

- `src/types/network.ts:8-31`: `Station.groupId?`, `ServicePattern {stationIds, circular, color}`,
  `Segment {serviceId, from, to, geometryFeatureId}` — spec §5 verbatim. **EXT** for linear
  services. Missing for the expansion: per-service direction labels (e.g. `directionLabels:
  {1: "大船方面", -1: "大宮方面"}` or derived from termini), optional `fixedDirection` (山手線 =
  外回り per mode), and a transfer/group model if (b) in §0.4 is chosen.
- `src/types/network.ts:33-41` `MoveRecord`: no landing resolution, no stop reason. **MUST** extend
  (see §3).
- `src/types/network.ts:43-49` `GameConfig`: `targetServiceId/targetDirection` double as "the
  fixed-direction service in this mode". **DECIDE** whether to add explicit fields (e.g.
  `serviceIds` in play, `fixedDirections`, `endpointPolicy`).
- `src/types/data.ts:33-38` `SegmentFeatureProperties` single `segmentId` — **MUST** change if
  features are shared by two directed segments.
- `src/data/guards.ts:49-78`: shape-only guards; `isServicePattern` does not reject 1-station
  services (engine does, `network.ts:96`). `groupId` accepted (`guards.ts:53`). **EXT**; add guards
  for new fields.
- `src/data/loaders.ts:11-17,67-79`: five fixed files loaded in parallel, independent failure.
  **EXT**; a transfers file (if any) would be a sixth `DATA_FILES` entry and needs to join the
  manifest hash (`export.py:129-139`).
- `groupId` usage today: only the type (`types/network.ts:12`), the guard (`guards.ts:53`) and two
  guard tests (`tests/unit/guards.test.ts:27-37`). Pipeline never emits it; engine/UI never read it.

---

## 3. Game engine (`src/features/game/engine/*`)

### 3.1 Module map

| File | Role | Expansion verdict |
|---|---|---|
| `network.ts` | `buildRailwayNetwork` (indexes, validation), `servicePairs`, `findSegment`, `nextStationId`, `requiredSegmentIds` | Mostly EXT. MUST: `expectedStationCount` per-target (`:87-95`); validate both directions for non-fixed services (`:170-176` checks +1 only); add `servicesByStation` / `stationsByGroup` indexes for transfer detection |
| `config.ts:22-41` | `validateConfig`: target circular, start on target, every +1 segment | EXT for the goal (target stays Yamanote). Add checks for new config fields |
| `game.ts:23-44` `createGame` | Start on `targetServiceId` with `targetDirection` | EXT (start on Yamanote 外回り). DECIDE: does turn 0 run a landing lottery at 新橋? Spec §4.1 triggers only after a move, so no |
| `game.ts:75-151` `moveByRoll` | Step loop, completion set, goal check per step, record | MUST: terminus stop (`:94-97`), stop reason, `unusedPips` meaning (`:149`); `completedSegmentIds` collects every service's segments (`:102-106`) — fine for the map, but UI counting must filter |
| `game.ts:159-163` `playTurn` | One `rollDie` then `moveByRoll` | MUST: becomes roll → move → (if playing) `resolveLandingEvent` with RNG draws |
| `goal.ts:18-44` | `checkGoal` compares `currentStationId === startStationId`; `stopsAtGoal` already distinguishes riding the target service (truncate) vs others (exact-stop) | EXT for the policy (spec §3.3 multi-line rule is already implemented and unit-tested: `engine-game.test.ts:286-329`). MUST if stations are per-platform with `groupId`: goal must compare groups |
| `rng.ts` | sfc32, `rollDie` with rejection | MUST: add `drawIndex(state, k)` (uniform, rejection over `2^32 - 2^32 % k`) |
| `save.ts` | parse, replay (`moveByRoll`), seeded replay (`playTurn`) | MUST: see §3.3 |
| `errors.ts` | 12 codes | Probably EXT (`INVALID_STATE`, `INVALID_SAVE`, `RNG_MISMATCH` cover the new failure modes) |
| `types.ts` | `MoveEvent = segment-traversed | goal-reached` | MUST: add e.g. `endpoint-reached` (pips discarded), `transfer-resolved` (candidates, chosen service, chosen direction, whether drawn) |

### 3.2 Seam for `resolveLandingEvent` (spec §8.1, §4.1)

Natural shape, keeping the engine pure and replayable:

```ts
// pure; no RNG inside
function landingOptions(state, network): { services: ServiceId[]; directionsByService: Map<ServiceId, Direction[]> };
// applies a decision; validates it is among the options
function resolveLandingEvent(state, network, choice: { serviceId; direction }): { state; event };
// playTurn = rollDie → moveByRoll → (status === "playing") ? draw service (k>1) → draw direction (k>1, not fixed) → resolveLandingEvent
```

- Candidate set: services stopping at the landing station (or its group), deduplicated, including
  the current service (spec §4.1 step 2). Needs a station→services index (absent today).
- Direction options: both directions minus those with no next station (terminus) — "移動可能な方向"
  (spec §4.1 step 5, §4.2 bullet 1). Yamanote: fixed `targetDirection`. Current service kept when it
  is the only candidate (§4.1 step 3) — DECIDE what happens if that sole service's direction points
  off a terminus (spec §4.2 "終着駅での折返し" is open).
- Spec §3.5: no transfer event on stations passed through, and none after a goal-ending move.

### 3.3 Save / restore / RNG replay — what breaks

- `assertReplayMatches` (`save.ts:175-205`) rebuilds the game with `moveByRoll(record.roll)`; the
  landing lottery would not run, so `currentServiceId/direction` after the first transfer never match
  (`save.ts:198-199`) → every multi-service save is rejected as `INVALID_SAVE`.
- `verifySeededHistory` (`save.ts:232-247`) compares only `result.roll`; once `playTurn` draws more
  values, the final `rngState` still matches (same calls), but a forged service/direction choice
  would pass unless whole records are compared.
- Fix pattern: extend `MoveRecord` with the landing outcome (e.g. `landing?: { serviceId; direction;
  serviceCandidates: ServiceId[]; drawn: { service: boolean; direction: boolean } }` and
  `stopReason: "roll" | "goal" | "endpoint"`), replay structure via `moveByRoll` +
  `resolveLandingEvent(recorded choice)` (validates the choice is legal), then seeded replay via
  `playTurn` comparing the entire record (`sameRecord`, `save.ts:137-147`, must include the new
  fields). `parseMoveRecord` (`save.ts:82-96`) and `sameConfig` (`save.ts:207-215`) need the new
  fields; `SAVE_VERSION` 1 → 2 (`game.ts:18`). Old saves are already invalidated by the data hash
  change, and the UI reports `unsupported-version` / `data-version` cleanly
  (`persistence.ts:44-57`).
- Ordering contract to document next to `rng.ts` header: per turn, `rollDie` first, then the service
  draw only if k > 1, then the direction draw only if the chosen service is not fixed and has > 1
  movable direction. The existing inline dice snapshot stays valid for games that never transfer.

### 3.4 Non-circular services and area boundaries

- `nextStationId` already returns `undefined` past either end (`network.ts:201-215`); `servicePairs`
  already handles `circular: false` (`network.ts:69-80`). **EXT**.
- `moveByRoll` must stop at the last station when `nextStationId` is undefined, record
  `unusedPips`, emit an endpoint event, and leave the landing resolution to pick a movable
  direction. Data truncated at the area boundary is indistinguishable from a real terminus — the
  pipeline simply ends the stop list at the last in-area station (spec §2 エリア端点, §11
  "端点で余りの目を破棄").
- Goal interplay: `stopsAtGoal(..., isLastStep)` (`goal.ts:30-44`) treats `step === roll` as the last
  step; with endpoint truncation, a stop at 新橋 because it is a terminus of a non-target service
  should count as an exact stop — DECIDE (新橋 is not a terminus of any JR East service in practice,
  so low risk, but the predicate should use "the move ended here" rather than `step === roll`).

### 3.5 Engine tests that hard-code Yamanote

`tests/unit/fixtures/yamanote.ts` (30-station loop builder; already has an `inputWithShuttle()`
3-stop circular test service through 新橋 — a good base for a multi-service fixture, but it is
circular; add a linear branch fixture), `engine-game.test.ts:39-56,118-125,358-366` (30 segments,
wrap-around, full-game equals `SEGMENT_IDS` order), `engine-network.test.ts:28-39`
(`expectedStationCount: 30`), `engine-save.test.ts` (replay via `moveByRoll`),
`engine-rng.test.ts:52` (dice snapshot — must remain unchanged), `game-app-state.test.ts:191`
(`moves: 30`), `animation.test.ts:49,58,151` (`jr-yamanote` ids).

---

## 4. UI and map (`src/app/*`, `src/features/game/**`, `src/features/map/*`)

| Location | Current assumption | Verdict |
|---|---|---|
| `GameApp.tsx:55-58` | `requiredCount` from target service | EXT |
| `GameApp.tsx:147-149` | `displayedCompletedCount = shown.completedSegmentIds.length` | MUST: count only target segments (intersect with `targetSegmentIds`) |
| `GamePanel.tsx:25,54` | `DIRECTION_LABELS {1: 外回り, -1: 内回り}` for any service | MUST: per-service direction label (termini names or data labels) |
| `GamePanel.tsx:42-43` | Legend colour = target service colour | DECIDE: completed lines are coloured per service by the map already |
| `GamePanel.tsx:31-35`, `ClearScreen.tsx:45`, `gameSummary.ts:17-20` | `unusedPips` ⇒ "新橋で停止" | MUST: use stop reason |
| `GamePanel.tsx:49`, `TitleScreen.tsx:127-133`, `ClearScreen.tsx:25`, `index.html:6` | "山手線すごろく", 外回り, 全30区間, rule text | MUST (text) / DECIDE (title) |
| `GamePanel.tsx` | No current service, no lottery outcome | MUST: show 乗車中の路線 (name + colour), 進行方向, and the latest transfer/direction draw (text, aria-live, spec §6.3) |
| `ClearScreen.tsx:39-48` | History: `出目N：A → B` | MUST: include service per move and transfers |
| `gameSession.ts:13-21,98-131` | Phases `idle/animating`; `MoveAnimation.events` | EXT: landing events can ride in `events`; a lottery presentation step (spec §4.2 "6面サイコロ演出") is a UI phase after the move animation — DECIDE whether it needs its own phase/skip |
| `useGameApp.ts:46-49,65` | `MVP_GAME_CONFIG` everywhere | MUST: new config constant (ruleset) |
| `movePath.ts:58-71,88-110` | Orients stored geometry to the departure station; MultiLineString skipped | EXT: shared undirected features already animate correctly in both directions |
| `railwayLayers.ts:47-77`, `progressStyle.ts` | Two line layers (pending dashed grey, completed coloured) filtered by `segmentId` | MUST/DECIDE: with both directions as separate features, a completed and a pending feature overlap on the same track; with shared features the filter needs directed→feature mapping. Many parallel services in shared corridors will overlap — consider `line-offset` per service, dimming non-target services, or showing pending only for the target |
| `lineColor.ts` | `match serviceId → color` | EXT |
| `stationCollection.ts:23-40` | `lineNames` from services containing the station | EXT (multi-service ready); group-aware if (b) |
| `mapConfig.ts:5-10` | `MAP_CENTER` loop centre, zoom 11.5, min 9 | DECIDE: initial view for a wider area; follow mode already handles movement |
| `RailwayMap.tsx` | Marker is a plain circle | DECIDE: show direction/service on marker (spec §6.1 "現在地マーカーと移動方向") |
| `camera.ts`, `runner.ts`, `timeline.ts`, `displayedProgress.ts` | Generic | EXT |
| `persistence.ts:19` | Key `yamanote-line-sugoroku:save:v1` (layout version, not format) | EXT: format change is signalled by `saveVersion` |

---

## 5. Tests — patterns and fixtures

- Unit (Vitest): fixtures in `tests/unit/fixtures/yamanote.ts` (in-memory network, never reads
  `public/data`) and `tests/unit/fixtures/railway.ts` (guard samples, `jr-yamanote`). Pattern: pure
  engine tests with `moveByRoll` arbitrary rolls; seeded tests via `playTurn`; `deepFreeze` to prove
  immutability. Add: multi-service fixture with a transfer station, a linear service with a
  terminus, a station group; RNG `drawIndex` uniformity and snapshot; save v2 round trip and
  forged-choice rejection.
- E2E (Playwright, `tests/e2e/*`): real `public/data` served by `vite preview`, map stubbed
  (`support/mapStub.ts`), deterministic `crypto.getRandomValues` (`fixtures.ts:10-41`) so the game
  seed is fixed per load. Hard-codes: `REQUIRED_SEGMENTS = 30` (`support/app.ts:67`), start
  `shimbashi` (`dice.spec.ts:32`, `full-game.spec.ts:20`), "新橋に戻りました" and per-move history text
  (`full-game.spec.ts:42-56`), `MAX_TURNS = 30` (`full-game.spec.ts:18-19`), `踏破区間` equals
  `completedSegmentIds.length` (`dice.spec.ts:85-87`), title "山手線すごろく" (`support/app.ts:131`).
  `readMap` reads the `in` filter literal of the completed layer (`support/app.ts:234-244`) — tied to
  the filter shape. A full-game E2E on real multi-service data is not bounded; options: pick a
  seed proven (offline) to finish within N turns, or move the full-game proof to unit tests and keep
  E2E to "transfer shown in panel + reload restores service/direction".

## 6. CI, versioning, size budget

- CI (`.github/workflows/ci.yml`): `frontend` (tsc, vitest, build, bundle must not contain the E2E
  hook), `pipeline` (ruff, ruff format, `ty check scripts/`, pytest, `validate`), `e2e` (Playwright
  chromium/firefox/webkit under `xvfb-run`, 30 min job timeout, 30 s per test,
  `playwright.config.ts:42`). Raw N02 is absent in CI, so the only data guard there is `validate`
  over committed JSON; the rebuild-reproducibility test runs only locally.
- Versions to bump: `SAVE_VERSION` (`game.ts:18`), `rulesetVersion` (`gameConfig.ts:8`), data
  `dataVersion` changes automatically (hash). `RNG_STATE_PREFIX` stays `sfc32-v1` if the algorithm
  is unchanged (adding a new draw function is not a state-format change).
- Size: see §0.8; also consider initial-load cost of a larger `stations.json`/`segments.json`
  (pretty-printed with indent 2; `export.dumps_pretty`).

## 7. Open decisions to settle before implementation

1. Service catalogue for "JR東日本・東京近郊" (which services, where each is truncated at the area
   boundary, branch splitting — spec §4.2 bullet 2) and "各駅停車相当" stop patterns.
2. Station model: shared station ids vs per-platform stations with `groupId` (§0.4); transfer table
   source (N02 `N02_005g` + overrides).
3. RNG draw contract (order, skip-when-forced) and the "6面サイコロ演出" presentation vs uniform-k draw.
4. Terminus behaviour (forced reversal vs re-lottery), sole-candidate at a terminus.
5. Progress semantics: `completedSegmentIds` = all traversed vs target-only; map rendering of
   non-target services.
6. Expected game length under forced uniform transfers (run a Monte Carlo over the chosen network
   before fixing the rules; affects E2E feasibility and UX).
7. Title/branding (still "山手線すごろく"?) and size budget.
