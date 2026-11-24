# Issue #69 — Clear screen: trajectory replay, highlights, phone layout, X share with map PNG

Affected-area codebase scan (2026-11-22, `develop` @ 5fdd2d6, v0.18.1). Read-only
investigation for Codex design. Line numbers are against that commit.

User decisions (2026-11-22) in scope: (1) replay button that draws the travelled
route progressively and ends on a full-route view, repeatable; (2) highlights:
longest ride, most-used line, farthest station, items used, harmful items avoided;
(3) phone: numbers / share / もう一度遊ぶ first, history folded in `<details>`;
(4) 「Xでシェア」: phone = Web Share API with PNG file + text, desktop = PNG to
clipboard + open `https://x.com/intent/post?text=...`, plus 「画像を保存」; the
image is a real MapLibre map fitted to the full route with the route drawn,
result numbers and attribution burned in; (5) analytics `result_share`
`method: "x"` and image save. Out of scope: leaderboard, localStorage history/best.

Issue #69 body (gh): also proposes percentile vs simulation (not in the user's
list) and says X share text must fit 280 weighted chars (Japanese counts 2).

Correction to the brief: the stack has **no Zustand**. Dependencies are only
`maplibre-gl` 6.11.2, `react`/`react-dom` 19.3.0 (`package.json:20-24`). State is
React hooks plus small `useSyncExternalStore` stores
(`src/features/map/lineVisibilityStore.ts:1,26`, `usePrefersReducedMotion.ts:20`).

---

## 1. Clear screen today

### 1.1 Component — `src/features/game/components/ClearScreen.tsx` (144 lines)

- Props `ClearScreenProps` (`:15-28`): `game`, `network`, `presentation`,
  optional `collection` (#65 counters), `display` (edition title/subtitle),
  optional injectable `shareActions` (default `browserResultShareActions()` at
  `:33` — called on every render), `itemNotice` (ReactNode), `saveStatus`,
  `onPlayAgain`, `onShowTitle`. No settings (speed / 演出 / reduced motion) and
  no map access today.
- `HISTORY_PAGE_SIZE = 20` (`:30`, exported; only used here and in tests).
- Focus: on mount the heading gets focus and the sheet scrolls to top (`:44-49`,
  E2E-gated in `tests/e2e/accessibility.spec.ts:379-395`).
- Summary/share computed per render: `summarizeGame` (`:50`), `buildShareText`
  (`:51`), `canShare(shareText)` (`:52`).
- Copy handler `:53-60` -> `trackEvent("result_share", {method:"copy", outcome})`
  (`:55`), shows fallback textarea on failure. Share handler `:61-69` ->
  `trackEvent("result_share", {method:"share", outcome: result})` (`:63`);
  `cancelled` shows nothing.
- DOM order (`:72-141`): `h1` クリア！ -> summary `p` (hard-coded
  「山手線の外回り全30区間を踏破し、${goalName}に戻りました。」 `:76`, not derived
  from config) -> save warning (`:77-81`) -> `itemNotice` (`:82`) -> `dl.clear-screen__stats`
  (turns / moves / transfers + optional visited stations / ridden lines, `:83-98`)
  -> `h2` 移動履歴 + `ol.clear-screen__history` paged (`:99-114`) -> paging nav with
  `role="status"` (`:115-121`) -> `.clear-screen__share` (結果をコピー, 共有 when
  `canShare`) (`:122-125`) -> always-mounted `p.clear-screen__share-status
  role="status"` (`:127`) -> fallback textarea (`:128-133`) ->
  `.clear-screen__actions` (もう一度遊ぶ primary, タイトルへ) (`:134-141`).
- History rows: item records via `itemHistoryText` (`:102`), classic records
  inline (`:103-111`) with `earlyStopNote` / `landingTransitionText`.

### 1.2 Mounting — `src/app/GameApp.tsx` (811 lines)

- `showClear = turnDisplay?.showClear` (`:536`), derived in
  `deriveTurnMomentDisplay` as `goal && isPublished`
  (`src/features/game/turnMomentPresentation.ts:404`; `goal = status === "completed"` `:367`).
  The clear screen appears only after the goal arrival banner (DESIGN row 238).
- `mapMode = "title" | "clear" | "game"` (`GameApp.tsx:537`); panel hidden on clear (`:538`, `:687`).
- ClearScreen render `:747-762`: `game={session.game}`, `itemNotice` =
  `ItemEventNotice` with `completionAnnouncement={turnDisplay.clearAnnouncement}`
  (the goal announcement live region is owned by ClearScreen; tests
  `game-app-turn-moments.test.ts:898-904,1951-2001`), `collection`, `display`,
  `saveStatus`, `onPlayAgain={startNewGame}`, `onShowTitle={showTitle}`.
- `game_clear` analytics fired once per session in an effect (`:657-663`).
- `RailwayMap` render `:792-808`: `mode={mapMode}`, `progress` (target-only
  completed feature ids + marker + highlighted service, `:391-403`),
  `livePosition` from `useMoveAnimation` (`:351-358`), `panelKey` undefined on
  clear (`:804`), `inert={title || showClear}` (`:807`) -> the whole map wrapper
  (including the attribution toggle) is inert on the clear screen.
- Settings available in GameApp scope: `speedId`, `follow`, `presentationLevel`
  from `useGameSettings(storage)` (`:201`); `reducedMotion` from
  `usePrefersReducedMotion()` (`:184`); `speedById` (`:148-150`). `geometry =
  buildGeometryIndex(data.geometry)` (`:212-215`) and `requiredIds` (`:216-219`)
  are already memoised here — reusable for replay.
- Resume of a cleared save: title 「クリア結果を見る（Nターンでクリア）」 resumes the
  full saved game (`resumeSaved` `:341-345`; title preview strips item history
  only for display, `:337-340`). The map then enters `"clear"` directly from
  `"title"`, so the camera is whatever the title fit left (see 3.4).

### 1.3 Styles — `src/styles.css`

- Shared fixed card: `.title-screen, .clear-screen { position: fixed; z-index:
  var(--layer-screen) }` (`:1528-1534`; layers `:40-45`: panel 10, turn-moment 15,
  screen 20, map-error 25, toast 30, banner 40). Comment says "over the dimmed
  map" but there is no dimming rule.
- Desktop: centred card `top/left 50%`, `width: min(440px, 100% - 24px)`,
  `max-height: calc(100% - 80px - safe areas)`, `overflow-y: auto` (`:1719-1730`).
  The centred card covers the map centre — a route fit/replay on desktop must
  pad around it (or move the card aside).
- Inner blocks `:1732-1846` (stats grid `:1764-1774`, history `max-height:200px`
  scroll `:1776-1789`, actions grid 2fr/1fr `:1797-1807`, share flex-wrap
  `:1809-1825`, status `:1827-1833`, fallback `:1835-1846`), paging `:3330-3343`,
  `@media (max-width: 390px)` actions one column (`:3345-3349`), auto-phrase
  wrapping `:2136-2145`.
- Phone (`@media (max-width: 600px)` opened at `:2613`): bottom sheet
  `bottom: 8px + safe`, `left/right 8px`, `max-height: 60%`, history
  `max-height: 120px` (`:2901-2914`). Breakpoint must match `PHONE_MEDIA_QUERY`
  (`src/features/map/mapConfig.ts:11-17`, `isPhoneWidth()`).
- Short landscape `(min-width:601px) and (max-height:500px)` has no clear-screen
  rule (it gets the desktop centred card).

### 1.4 Share modules

- `src/features/game/resultShareActions.ts` (60 lines): `ResultShareApi`
  (`share({text})`, `canShare({text})`) `:1-4`, `ResultClipboardApi.writeText`
  `:6-8`, `ResultShareActions {copy, share, canShare}` `:10-14`,
  `createResultShareActions` (copy -> boolean; share -> "shared"|"cancelled"|"failed",
  AbortError = cancelled) `:16-44`, `browserResultShareActions` `:46-60` (binds
  `navigator.clipboard.writeText`, `navigator.share`, `navigator.canShare`).
  Text-only: no `files`, no `ClipboardItem`, no `window.open`.
- `src/features/game/shareText.ts`: `RESULT_SHARE_HASHTAG = "#山手線すごろく"`,
  `RESULT_SHARE_SITE_URL = "https://yamanote-line-sugoroku.vercel.app"` (`:4-5`,
  the URL is pinned by `tests/unit/launch-metadata.test.ts:84`), `buildShareText`
  4 lines (`:7-14`). Weighted X length today is well under 280 (≈ 18 JP chars×2 +
  ~30 mixed + hashtag + URL counted as 23).
- `src/features/game/gameSummary.ts`: `GameSummary {turns, moves, transfers}`
  (`:12-17`); `summarizeGame` (`:19-40`) — moves = sum of
  `traversedSegmentIds.length` (deadhead = 0), transfers = line-group changes
  (route-ticket ride, deadhead relocation, landing) using
  `presentation.sameLineGroup`; `endpointKindAt`, `unusedPipsOf`, `earlyStopNote`.
  DESIGN rows 216/227: share text = edition name + 3 numbers + hashtag + URL; no
  item counts, no date, no seed link (user decisions 2026-10-20 / 10-27).

### 1.5 Analytics — `src/features/analytics/analytics.ts`

- `EventName = "game_start" | "game_clear" | "result_share"` (`:6`).
- Allow-lists: `EVENT_KEYS.result_share = ["method","outcome"]` (`:26-30`),
  `EVENT_VALUES.method = ["copy","share"]`, `outcome = ["success","failed","cancelled"]`
  (`:31-35`). `safeParams` drops the **whole event** if any key or value is
  outside the lists (`:37-47`) — so `method: "x"` / `"save"` are silently
  dropped until `EVENT_VALUES.method` is extended. A distinct image-save event
  would need a new `EventName` + `EVENT_KEYS` entry.
- Call sites: `GameApp.tsx:662` (game_clear), `useGameApp.ts:156,160`
  (game_start), `ClearScreen.tsx:55,63` (result_share). `trackException` used by
  RailwayMap for `webgl2_unavailable` / `map_style_or_tile_failure`
  (`RailwayMap.tsx:605,662`).
- Privacy page `public/privacy.html:21` lists "ゲームの開始・クリア・共有・エラーの件数"
  and `:29-30` third parties (OpenFreeMap, Vercel, Google). Opening x.com is a
  new outbound destination; consider a wording check. DESIGN row 220 forbids
  sending saves/seed/history to analytics.

---

## 2. History data available at clear time

### 2.1 State shapes — `src/types/network.ts`

- `GameState` (`:149-162`): `status` incl. `"completed"`, `config`,
  `currentStationId/ServiceId`, `direction`, `turn`, `completedSegmentIds`,
  `movementHistory: MoveRecord[]`, `rngSeed/rngState`.
- Classic `MoveRecord` (`:66-78`): `turn, roll, serviceId, direction,
  fromStationId, toStationId, traversedSegmentIds, stopReason ("roll"|"goal"|"endpoint"),
  landing: LandingChoice | null` (null iff the move cleared).
- Item game (`ItemGameState` `:268-271`, product default): `movementHistory:
  ItemTurnRecord[]`, `inventory`, `effects`, `pending`.
  - `ItemRecordBase` (`:192-202`): `turn, fromStationId, toStationId, command
    {items: PreRollItemCommand[]}, traversedSegmentIds, landing, landingSnapshot,
    itemEvents, discardedInstanceId`.
  - `ItemRideRecord` (`:204-216`): `resolvedRide {serviceId, direction}` (the
    ridden service/direction of this move), `rawRoll, effectiveFace, adjustment,
    movementMode ("normal"|"rapid"|"oversleep"), pips, hopBudget, physicalHops,
    unusedPips, stopReason`.
  - `ItemDeadheadRecord` (`:218-231`): `traversedSegmentIds: []`,
    `physicalHops: 0`, `stopReason: "relocation"`, `relocation {fromStationId,
    toStationId, serviceId(=target), direction, distance(hops)}` — a jump with no
    geometry (`engine/itemMovement.ts:86-92`, destination
    `engine/itemOptions.ts:88-97`).
- Product config = item rules only (`gameConfig.ts:43-55`); classic saves are
  rejected as `CONFIG_MISMATCH` in the app (`engine/save.ts:455`), but
  ClearScreen and `summarizeGame` still accept classic `GameState` (unit tests use it).
- The clearing turn never drops an item (`engine/itemTurn.ts:100`
  `moved.cleared ? null : drawItemDrop(...)`), so `pending === null` at clear.

### 2.2 Reconstructing the full per-step path from saved state (no session needed)

Yes, purely from `movementHistory` + network + geometry, and it survives reload
(save v4 persists every record; restore replays them structurally and with the
seed, `engine/save.ts:392-469`; E2E `full-game.spec.ts:76-79`,
`items.spec.ts:711-715` prove the reopened clear screen shows identical history).

- Station ids are shared across services (`engine/network.ts:50-54,315-323`:
  boarding station is always the landing station), so record N+1
  `fromStationId === ` record N `toStationId` (or the deadhead destination).
- Ridden service per record: classic `record.serviceId`; item ride
  `record.resolvedRide.serviceId`; deadhead `record.relocation.serviceId` (no hops).
- Per-hop chain: `traversedSegmentIds` are in travel order. Each `Segment`
  (`types/network.ts:48-55`) has canonical `from/to` and
  `geometryFeatureIds`. Starting at `record.fromStationId`, each hop's next
  station is the segment end that is not the current station; this equals what
  the engine emitted (`engine/movement.ts:93-111`).
- `stepPath(event, network, geometry)` (`animation/movePath.ts:99-135`) needs a
  `SegmentTraversedEvent`-like object `{segmentId, serviceId, fromStationId,
  toStationId, newlyCompleted}` (`engine/types.ts:15-25`); it chains and orients
  shared features by station identity (`orientPath` `:73-81`), throws
  `GameEngineError("INVALID_NETWORK")` on missing geometry / joint gaps, and
  falls back to straight lines only when the geometry index is empty. It also
  returns `points`, `cumulative`, `total` (degrees) and `distanceKm`
  (`KM_PER_DEGREE = 111.195`, `:32`, not exported).
- No helper exists today that rebuilds events from records (grep: only the
  engine emits `"segment-traversed"`). A pure `recordsToSteps(history, network)`
  would be new; `newlyCompleted` can be recomputed with a seen-set exactly as
  DESIGN row 277 does for #66 (+N区間).
- Platform gap at transfers: marker coordinates are per-service
  (`ServicePattern.platformCoordinates`, `types/network.ts:40`;
  `platformPosition` `engine/network.ts:267-274`), so consecutive legs on
  different services do not share an endpoint (e.g. 東京 京葉線 ≈450 m, DESIGN
  row 179). A drawn route should be a MultiLineString / one feature per leg, not
  one continuous LineString.

### 2.3 Item records relevant to highlights

`ItemEvent` union (`types/network.ts:114-124`) recorded in `record.itemEvents`:

| Event | Meaning | Emitted by |
|---|---|---|
| `consumed` {item} | a beneficial item was used: pre-roll (route/direction ticket, double, rapid, deadhead) and roll-adjust | `itemTurnPreparation.ts:110-112`, `itemTurn.ts:53-55` via `consumeInventoryInstance` (`itemEffects.ts:45-57`) |
| `cancelled-by-certificate` {item: harmful kind, certificate} | a harmful pickup was cancelled by 遅延証明書 (the certificate is consumed but **no** `consumed` event is emitted) | `engine/items.ts:64-68` |
| `harmful-scheduled` (delay / suspension / detour / oversleep) | harmful item hit the player | `items.ts:78-103` |
| `effect-activated` / `effect-expired` | delayed effects firing / suspension ending | `itemTurnPreparation.ts:55-60`, `itemTurn.ts:90` |
| `pickup-retained` / `pickup-pending-discard` / `discarded` | pickups and discards | `items.ts:142-172` |

- "Items used" = count of `consumed` + count of `cancelled-by-certificate`
  (certificate use), optionally broken down by kind; `command.items` and
  `adjustment` give the same for rides.
- "Harmful items avoided" = count of `cancelled-by-certificate`. Other candidate:
  `landingSnapshot.suspensionIgnored` (all candidates suspended, ignored) — not
  an avoidance by the player; probably exclude.
- Labels: `ITEM_DESCRIPTIONS[kind].name` (`itemPresentation.ts:52+`),
  history wording in `itemEventTexts` (`presentation.ts:118-144`).

### 2.4 Highlight candidates (definitions to decide)

- Longest ride: (a) single turn with max `traversedSegmentIds.length`
  (= `physicalHops`; oversleep/rapid produce long ones); (b) single turn with max
  km (sum of `stepPath(...).distanceKm`); (c) longest consecutive run on one
  line group across turns. (a) is trivially exact; (b) needs geometry.
- Most-used line: count traversed segments per `presentation.lineGroupId(segment.serviceId)`
  (segment.serviceId is the ridden service; `collectionProgress.ts:23-29` uses
  the same grouping). Name/colour via `presentation.lineGroups()` /
  `lineGroupColor`; a `LineBadge` component exists
  (`components/LineBadge.tsx`, `lineBadge.ts:204-213`). Tie-break rule needed;
  Yamanote will usually win (30+ segments mandatory) — consider "most-used
  non-target line".
- Farthest station: over visited stations (start + every segment end +
  deadhead destinations; same set as `deriveCollectionProgress`,
  `collectionProgress.ts:19-33`), max great-circle distance from
  `network.stationsById.get(config.startStationId).coordinates` (station
  coordinates, `stations.json`, e.g. shimbashi `[139.7582, 35.66639]`). Use
  `config.startStationId`, not a literal 新橋. No haversine helper exists;
  `planarDistance` (`movePath.ts:63-68`) is degree-planar.
- Bonus available cheaply: total km travelled (sum of step `distanceKm`).
- All derivable purely; put them in a new pure module (e.g.
  `src/features/game/clearHighlights.ts`) so ClearScreen and the image renderer
  share one source.

---

## 3. Map — `src/features/map/*`

### 3.1 `RailwayMap.tsx` (958 lines)

- Props `:84-113`: `data`, `mode` (`"title"|"game"|"clear"`, `:115`),
  `presentation`, `progress: MapProgress`, `markerBearing`, `goalStationId`,
  `adjustmentCandidates`, `segmentFlash`, `livePosition`, `follow`, `panelKey`,
  `coachTargetRef`, `overviewKey`, `inert`, `targetServiceId`, `minZoom`.
  The MapLibre instance is private (`loadedMap` state `:570`), only exposed to
  E2E via `exposeMapForE2E` (`:707`, `e2eHook.ts:14-21`, `window.__sugorokuE2E.map`
  only in `--mode e2e`). Nothing outside can read the canvas today.
- `createMap` (`:519-534`): `style: MAP_STYLE_URL`, `center`, `zoom`,
  `minZoom`, `maxZoom`, `attributionControl: false`. **No
  `canvasContextAttributes`, no `preserveDrawingBuffer`, no `pixelRatio`,
  default `fadeDuration`.** Constructor throws without WebGL2 -> `unsupported`
  (`:601-607`, message `:940-947`).
- Attribution: `AttributionControl({compact: true, customAttribution})` with
  `buildDataAttribution(manifest)` (HTML) (`:598-600,615`), position top-left on
  phones / short landscape, bottom-right otherwise, swapped on media-query change
  (`:616-639`); compact watcher `attribution.ts:39-95`.
- Load/paint lifecycle: `error` before first `load` = basemap failure ->
  `styleFailed` (`:658-664`); `load` + first `render` -> `paintedAttempt`
  (`:649-675`); `style.load` adds railway layers once, re-adds on style
  replacement and bumps `layersRevision` (`:679-708`). Any new layer must be
  re-applied on `layersRevision` like the existing effects (`:754-768`).
- Progress effects: completed filter (`:754-756`), line-group visibility
  (`:757-759`), marker + heading (`:760-764`), goal ring (`:765-767`), flash via
  `useSegmentFlash` (`:179-236`, rAF loop keyed by request key, the pattern to
  copy for a replay loop), highlighted service (`:792-801`).
- Cameras:
  - title: `fitTitleService` (target service platforms, symmetric
    `titleFitPadding`) (`:452-461`, effect `:770-774`).
  - game: `fitNetworkOverview` once on entering game / turn-0 overview
    (`:429-449`, effect `:776-790`; desktop padding `{top:60,right:70,bottom:50,left:340}`,
    phone `{top:100,right:60,left:20}` + measured panel bottom,
    `mapConfig.ts:83-86`, `phonePanelBottomPadding` `:464-471`).
  - follow `recentre` (`:493-503`, effects `:861-887`), adjustment preview fit
    with obstruction measurement (`fitAdjustmentPreview` `:358-418`,
    `previewObstructions` `:286-294` measuring `.game-panel`, map control
    corners, etc. — reusable to measure `.clear-screen` as an obstruction).
  - **clear: no camera logic at all.** Overview effect returns for non-game
    (`:780-783`), preview effect returns for clear (`:833-834`), follow effects
    require `mode === "game"`, layout observer only tracks title/game (`:805`).
    The camera stays where the last game camera (or, after reload, the title
    fit) left it.
  - All fits use `duration: 0` (`IMMEDIATE_CAMERA_DURATION_MS`, `:265`) and
    clear/restore padding around `fitBounds` because MapLibre combines retained
    padding with fit padding (`:444-448`).
- Controls: zoom + 全体/目標路線 only in game mode (`showNavigationControls`
  `:895-904`, `:924-937`; DESIGN row 289: hidden on title, loading, clear,
  failure). Clear-mode map is also `inert`.
- Station popup (`attachStationPopup` `:505-512`) — irrelevant under inert.

### 3.2 Layers — `railwayLayers.ts` (370 lines), `mapConfig.ts`, `progressStyle.ts`

- Sources (`mapConfig.ts:29-33`): `railway-segments` (geojson = the whole
  `segments.geojson`), `railway-stations`, `game-current-position`.
- Layer stack, bottom->top (`railwayLayers.ts:235-399`; ids `mapConfig.ts:48-71`):
  `railway-base` (target track under pending) -> `railway-services` (all other
  primitives, width 3, opacity 0.75) -> `railway-current-service` (ridden
  service highlight by feature ids, width 7) -> pending casing + pending dashed
  magenta (target only) -> `railway-segments-completed` (target only, line
  colour) -> `railway-segments-flash` -> station circles (ordinary from z10.5,
  key always) -> goal ring -> station labels (z11 / z13, `Noto Sans Regular`
  glyphs from the style) -> `game-current-position-circle`.
- Filters are by `featureId` property. **Both progress filters are restricted to
  `serviceId == targetServiceId`** (`progressStyle.ts:10-23`) and feature
  `serviceId` is the primitive *owner*, not the ridden service — composed
  services share primitives (`serviceGeometry.ts:49-58`: "primitives with
  several owners"; max reuse 8 services per feature in the product bundle). So:
  - reusing `segmentsCompleted` cannot draw non-Yamanote travel;
  - a feature-id filter layer coloured by `["get","serviceId"]`
    (`lineColor.ts:7-24`) would colour by owner, not by the line ridden.
  - A dedicated trajectory GeoJSON source built from step paths (one
    LineString per turn-leg with the ridden `serviceId`/colour as properties)
    avoids both problems, supports partial-segment progressive drawing, and can
    be inserted `beforeId` the station circles. It must be (re)added in
    `addRailwayLayers` or on `style.load` so style reloads keep it.
- `updateHighlightedService` (`:465-469`) shows the "filter by feature ids,
  never by owner" pattern; `setSegmentFlashFeatures/Opacity` (`:481-494`) show
  the guarded-write pattern (`if (!map.getLayer(...)) return`).
- Line visibility (legend toggles) rewrites the base/services filters
  (`lineVisibility.ts:39-50`); a trajectory layer should be independent of it.
- Heading marker is a DOM marker (`headingMarker.ts:94`), not on the canvas —
  it will not appear in a canvas capture.

### 3.3 Movement animation — reuse for replay

- `useMoveAnimation` (`animation/useMoveAnimation.ts:43-101`) is bound to a
  game `MoveAnimation` (`gameSession.ts:28-37`) and calls `onFinished` ->
  `app.finishAnimation` (game-state reducer). Not reusable as-is for a replay
  (it would drive session state).
- Pure pieces are reusable:
  - `buildMovePlan` / `stepPath` / `positionAlong` (`movePath.ts:99-167`).
  - `runMoveAnimation(steps, stepMs, scheduler, onFrame, onDone, maxDurationMs)`
    (`runner.ts:25-56`) — injectable `FrameScheduler`, returns cancel, finishes
    synchronously for empty plans or `stepMs <= 0`.
  - `frameAt` (`timeline.ts:33-49`) with distance-paced hops (`hopDurationMs`
    450 ms at 1 km, clamp 2/3..8/3, `:18-27`) and a uniform `maxDurationMs`
    scale-down (`MAX_MOVE_DURATION_MS = 6000` per item move, `:29`;
    `itemSession.ts:110`). Frames expose `stepsCompleted` and `position`.
  - `createLivePosition` (`livePosition.ts:16-33`) + RailwayMap's
    `useSyncExternalStore` subscription (`RailwayMap.tsx:723-724`) — a replay
    could feed the marker through the existing `livePosition` prop.
- A whole-game replay is long: product history game = 96 turns / 298 hops
  (`tokyo-suburban.spec.ts:103-106`); at 450 ms/hop that is ≈2+ minutes, so a
  total cap (e.g. 10-20 s via `maxDurationMs`) and/or per-turn batching is
  required. Deadhead records produce no steps (jump; draw as a dashed hop or skip).

### 3.4 Map config / tiles / capture

- `MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"`
  (`mapConfig.ts:3`); `MAP_CREDITS` (OpenFreeMap / © OpenMapTiles / ©
  OpenStreetMap contributors) (`:22-27`) — plain-text credits ready for burning
  into the image; railway data credit from `manifest.source` (`attribution`
  「「国土数値情報（鉄道データ）」（国土交通省）を加工して作成」, `license` "CC BY 4.0",
  `url`) — `buildDataAttribution` (`attribution.ts:137-142`) returns HTML, so a
  plain-text variant is needed for canvas.
- `maplibreWorker.ts` sets the worker URL (bundled worker); a second map
  instance reuses it.
- MapLibre 6.11.2 API (installed `.d.ts`): `canvasContextAttributes?:
  WebGLContextAttributesWithType` (default `preserveDrawingBuffer: false`,
  `contextType: 'webgl2'`) (`node_modules/maplibre-gl/dist/maplibre-gl.d.ts:12704-12706`),
  `pixelRatio?` (`:12944-12946`), `setPixelRatio` (`:13871`), `getCanvas()`
  (`:15400`). The old top-level `preserveDrawingBuffer` option is gone.
- **No image export exists** (grep: no `toDataURL`, `toBlob`, `ClipboardItem`,
  `preserveDrawingBuffer`, `files` share anywhere in `src`).
- No CSP: `vercel.json` only sets cache headers on `/assets/*`; blob: URLs,
  canvas and clipboard are unrestricted. Basemap tiles/sprites/glyphs are
  fetched with CORS (vector data), so the WebGL canvas is not tainted;
  `toBlob` is allowed.
- Capture options to evaluate:
  - (A) capture the live map: must re-fit to the route (the user sees it),
    the visible viewport is partly covered by the clear card / phone sheet and
    has the viewport's aspect ratio, and without `preserveDrawingBuffer` the
    read must happen inside a `render` callback after `triggerRepaint()`.
    Enabling `preserveDrawingBuffer` on the main map has a per-frame cost on
    every device for the whole game (C1 perf baseline:
    `.claude/docs/research/c1-map-performance-baseline.md`).
  - (B) dedicated off-screen map: hidden fixed-size container (e.g. 1200×675
    CSS px, `pixelRatio` 1-2), `interactive:false`, `attributionControl:false`,
    `fadeDuration: 0`, `canvasContextAttributes: {preserveDrawingBuffer: true}`,
    same style + railway layers + trajectory layer, `fitBounds(route, {duration:0})`,
    wait `idle`, composite into a 2D canvas with title, numbers, highlights and
    credits, `toBlob("image/png")`, then `map.remove()`. Costs a second WebGL
    context and tile/glyph fetches (HTTP-cached) and seconds of software WebGL
    in CI. Independent of UI layout — likely the cleaner choice.
- Fonts for burned-in text: app font stack `system-ui, -apple-system,
  "Hiragino Sans", "Noto Sans JP", sans-serif` (`styles.css:9`); no web fonts,
  so the image typography is device-dependent. OGP image is 1200×630
  (`index.html` og:image meta) — a natural target size for `summary_large_image`.

---

## 4. Network data — `public/data/`

| File | Size | Content |
|---|---|---|
| `manifest.json` | 48 KB | schema 3, `dataVersion n02-2025-7974da15af8e`, `source` credits, `uiPresentation` (15 operators, line groups, aliases, per-service stop names) |
| `segments.geojson` | 1.29 MB | 1,938 LineString features; `id == properties.featureId` e.g. `jr-yamanote:shimbashi~hamamatsucho`; properties `serviceId` (owner), `lineId`, `from`, `to` (canonical orientation) |
| `segments.json` | 744 KB | 3,988 directed gameplay segments `{id, serviceId, from, to, geometryFeatureIds[]}` e.g. `jr-yamanote:shimbashi:hamamatsucho` |
| `services.json` | 306 KB | 135 services + 135 lines; `ServicePattern` with `stationIds` (+1 order), `circular`, `endpoints`, `color`, `directionLabels`, `platformCoordinates` |
| `stations.json` | 192 KB | 1,586 stations `{id, name, coordinates}` |

- Types: `types/data.ts` (`SegmentFeature` `:130-141`, `Manifest` `:105-113`),
  `types/network.ts`. Loaded once per edition (`src/data/loaders.ts`) into
  `RailwayData` (`data.geometry`, `data.segments`, `data.services`,
  `data.stations`, each `{ok, value}`), and `RailwayNetwork`
  (`segmentsById`, `servicesById`, `stationsById`, `servicesByStation`,
  `engine/network.ts:40-47`).
- Drawing an arbitrary travelled path needs exactly: `network.segmentsById`
  (segment -> `geometryFeatureIds`) + `buildGeometryIndex(data.geometry)`
  (feature id -> canonical points + from/to) — both already in GameApp — plus
  `stepPath` to orient and chain. Per-hop feature reuse is possible (same
  primitive ridden by several services and in both directions), so the trajectory
  must be built from steps, not from a set of feature ids, to keep order and
  ridden colour.
- Full-route bounds: union of all step points (+ deadhead endpoints via
  `platformPosition`). Routes can reach far ends of the network (e.g. 長野 /
  塩尻 / 浪江 services exist, DESIGN row 210), giving low zooms (≈7-8) where only
  key stations are drawn (`ORDINARY_STATION_MIN_ZOOM 10.5`, labels from z11,
  `mapConfig.ts:111,128-129`).

---

## 5. Settings to respect

- Speed: `ANIMATION_SPEEDS` slow 600 / normal 450 / fast 300 / very-fast 120 ms
  per hop (`gameConfig.ts:61-70`); per-speed moment timings
  (`animation/turnMomentPolicy.ts:26-43`).
- 演出 level `"all" | "important" | "none"` (`gameSettings.ts:3,17-21`);
  `captureTurnPresentationPolicy` (`turnMomentPolicy.ts:49-61`). DESIGN row 247:
  levels never change the movement animation, toasts or camera; the clear screen
  and its announcement stay at every level; OS reduced motion overrides all and
  the menu shows 「演出: 省略」. Settings persist in
  `yamanote-line-sugoroku:settings:v1` (DESIGN row 248;
  `store/settings.ts`, `useGameSettings.ts`). The settings UI lives only in the
  game panel/menu (hidden on clear), so the replay cannot change them.
- Reduced motion: `usePrefersReducedMotion()` live media query
  (`usePrefersReducedMotion.ts:3-22`); GameApp forces `stepMs = 0` under it
  (`GameApp.tsx:349-350`); `runMoveAnimation` with `stepMs <= 0` finishes
  synchronously (`runner.ts:33-36`); CSS has several
  `@media (prefers-reduced-motion: reduce)` blocks. A replay under reduced
  motion should jump straight to the final full-route view (still "replayable",
  but instant). Open decision: whether 演出 "none" also shortens/skips the replay
  (row 247 says levels do not touch movement animation; the replay is an
  explicit user request, so likely speed-only).
- E2E defaults to `reducedMotion: "reduce"` for every test
  (`playwright.config.ts` `use.reducedMotion`), so replay E2E either tests the
  instant path or opts out and fast-forwards a frozen clock
  (`tests/e2e/support/turnMoments.ts`, `advanceMovement` in `items.spec.ts:692`).

---

## 6. Tests

### 6.1 Unit (Vitest)

- Config: `vite.config.ts:56-59` — `include: ["tests/unit/**/*.test.ts"]`
  (`.ts` only; components are mounted with `createElement`), default env `node`,
  jsdom per file via `// @vitest-environment jsdom`. Mount helper
  `tests/unit/helpers/reactDom.ts` (`mountReact`). jsdom has no 2D canvas /
  WebGL / `ClipboardItem` — image rendering must sit behind an injectable seam.
- `tests/unit/result-share.test.ts` (192 lines): share text exactness
  (`:53-65`), ClearScreen share behaviour via `createResultShareActions`
  injection (`:67-134`), item accounting (`:136-191`). **Order-coupled
  selectors**: `container.querySelector("button")` is assumed to be 結果をコピー
  (`:71,83,187`) and `querySelector('[role="status"]')` the share status
  (`:73,84,119,128`). Inserting a replay button / new status region before them
  breaks these tests.
- `tests/unit/hud-progress-components.test.ts:107-118` renders ClearScreen
  collection totals (`.clear-screen__stats`).
- `tests/unit/game-app-turn-moments.test.ts`: mocks `RailwayMap` and records its
  props (`railwayMapProps`, `:40-47`, 32 uses), mocks `trackEvent`
  (`game_clear` once, `:1724`), asserts ClearScreen mount timing / focus / map
  inertness / single goal announcement (`:898-904,1951-2001,2364`) and counts
  `role="status"` regions (`:62-66`). New RailwayMap props or status regions
  surface here. `game-app-item-progress.test.ts` and `map-flash.test.ts` also
  capture `railwayMapProps`.
- `tests/unit/analytics.test.ts`: allow-list behaviour (`:73-86` region:
  unknown keys dropped); extend for `method: "x"` / image save.
- Map unit tests: `title-map-mode.test.ts` has a full `maplibre-gl` `MapDouble`
  mock (`:18-111`, `emit("style.load"/"load"/"render")`, records
  `fitBounds`/`setPadding`/`jumpTo`), mocks `railwayLayers` (`:119-123`),
  includes `render("clear")` cases (`:290-311`). `map-camera.test.ts`,
  `map-flash.test.ts`, `map-helpers.test.ts` test pure helpers with fake maps
  exposing `getLayer/setFilter/setPaintProperty`.
- Animation: `tests/unit/animation.test.ts`, `move-animation-gate.test.ts`
  (runner/timeline with injected scheduler).
- Fixtures: `tests/unit/fixtures/multiService.ts` (`multiServiceInput`,
  `multiConfig`), `yamanote.ts`, `railway.ts`, `editions.ts`
  (`FIXTURE_EDITION_A` display "Fixture A 試験版A").

### 6.2 E2E (Playwright)

- Projects (`playwright.config.ts`): `desktop-chromium` 1280×800,
  `phone-chromium` (Pixel 7 412×839, **runs only `@layout`-tagged tests**),
  `desktop-firefox` (xvfb), `desktop-webkit` (CI only). Memory: feature pushes
  run chromium only; PRs run the full matrix.
- Hermetic map: `tests/e2e/support/mapStub.ts` serves a stub style, empty
  vector tiles and local Japanese glyphs from `tiles.openfreemap.org`; every
  other external request is aborted and **recorded in `stub.counts.blocked`,
  which `tests/e2e/fixtures.ts:77-82` asserts is empty** — a real
  `window.open("https://x.com/...")` in a test would fail the test unless
  `window.open` is stubbed (e.g. `page.addInitScript`) and the URL asserted.
- Nothing stubs `navigator.share`, `navigator.canShare`, `navigator.clipboard`
  or `window.open` today. Linux Chromium has no `navigator.share` (desktop or
  Pixel emulation), so the phone Web Share path needs an init-script stub
  capturing `{files, text}`; clipboard image writes need
  `context.grantPermissions(["clipboard-read","clipboard-write"])` on Chromium
  (Firefox/WebKit differ).
- Clear-screen specs and seeds:
  - `full-game.spec.ts:26-91` — fixture dataset, seed
    `FIXTURE_GAME_SEED` reaches clear in `FIXTURE_SCENARIO_TURNS.completed = 14`
    rolls (`fixtures/seeds.ts:3-10`); checks 結果をコピー visible, stats,
    per-record history text, reload -> 「クリア結果を見る」, もう一度遊ぶ.
  - `tokyo-suburban.spec.ts:84-130` — real data; pinned
    `fixtures/tokyo-suburban-before-clear-save.json` (turn 95) -> one roll ->
    96 turns / 298 moves / 53 transfers, 5 history pages. Fastest real-data
    clear (one roll from a pinned save).
  - `text-wrapping.spec.ts:631-692` `@layout` (also phone) — 320×568,
    `completedHistoryGame` (`:88-99`, `PRODUCT_HISTORY_GAME_SEED`, 96 turns);
    asserts summary text constant `:52`, goal announcement, **20 visible history
    items, paging clicks, one-column actions, single-line buttons for
    `.clear-screen__actions/__share/__paging button`, no horizontal overflow**.
  - `capital-region.spec.ts:385-402+` `@layout` — scrolls
    `.clear-screen__history` and pages it (would need the `<details>` opened on phone).
  - `accessibility.spec.ts:379-395` `@layout` — heading focused, sheet
    `scrollTop === 0`, heading in viewport.
  - `items.spec.ts:690-716` — frozen-clock goal banner -> clear, history text
    identical after reload.
  - `title-map.spec.ts:116`, `turn-result-card.spec.ts:1379,1394`,
    `map-visual.spec.ts:572`, `first-play-hints.spec.ts` (loop until clear).
  - Helpers: `support/app.ts` `rollOnce` (`:242-258`), `writeSaveText` (`:365`),
    `readSave`, `diceButton`; layout helpers `support/layout.ts`,
    `support/textWrappingState.ts`.
- Canvas pixels are never read in E2E today (only `page.screenshot`), so an
  exported PNG can be validated by decoding the blob in-page (size, non-empty)
  rather than by pixel comparison.

---

## 7. DESIGN.md gates and decisions touching the clear screen

(`.claude/docs/DESIGN.md`, 367 lines)

- Row 203: X share was explicitly planned after network expansion (2026-10-15).
- Row 216 (A1): copy + Web Share (text) buttons; text = edition name, 3 numbers,
  hashtag, URL; no date / seed link; failures show selectable text; save format
  and rules unchanged.
- Row 227: edition name stays 「東京近郊版」; numbers stay the 3; no item counts
  in the text; deadhead = 0 moves / 1 turn. Highlights added to the *text*
  would revise this row — keep them in the image/UI unless the user decides otherwise.
- Row 217: canonical URL `https://yamanote-line-sugoroku.vercel.app`.
- Row 220: GA4, no saves/seed/history sent, opt-out; privacy page.
- Row 238 / 247: goal turn shows the arrival banner, then the clear screen;
  clear screen kept at every 演出 level; reduced motion overrides.
- Row 241: all displayed values derived in `deriveTurnMomentDisplay`, single
  live region rule ("単一のライブリージョンは維持する"); ClearScreen already owns
  the goal announcement plus share/paging status regions.
- Row 254 / 259: Japanese wrapping via `PhraseText` only at render time; share
  text and aria strings stay byte-identical; clear-screen long prose uses
  auto-phrase in `@supports`.
- Row 272: the #66 phone pill is not rendered with the clear screen.
- Row 277: replay of `movementHistory` with a seen-set for first traversals
  (resume-safe; memo keys must include history identity, not length) — the same
  approach fits trajectory/highlight derivation.
- Row 285: #65 counters appear only in the phone hamburger and the clear screen.
- Row 289: zoom/全体/目標路線 hidden on the clear screen.
- Rows 294 / 299: `showClear` discards first-play hints.
- Memory "phone shows less": phones get reduced variants; consistent with
  history in `<details>` on phone only.
- No numeric layout budget exists for the clear screen (the 252px phone HUD
  budget and desktop no-scroll gates concern the game panel). The de-facto gates
  are the E2E assertions in 6.2 (320×568 no overflow, single-line buttons,
  one-column actions at ≤390px, heading focus + top scroll).

---

## 8. Downstream consumers and reusable utilities

### Consumers of likely-changed code

| Changed | Consumers |
|---|---|
| `ClearScreen` props / DOM order | `GameApp.tsx:747-762`; tests `result-share.test.ts` (order-coupled), `hud-progress-components.test.ts:107`, `game-app-turn-moments.test.ts`; E2E listed in 6.2 |
| `ResultShareActions` shape | `ClearScreen.tsx:7,22,33`; `result-share.test.ts` (`createResultShareActions(clipboard, shareApi)` 2-arg signature used everywhere) |
| `buildShareText` / constants | `ClearScreen.tsx:51`, `result-share.test.ts`, `launch-metadata.test.ts:5,84` |
| `summarizeGame` | `ClearScreen.tsx:50`, `GameApp.tsx:661`, `game-presentation.test.ts`, `game-app-state.test.ts`, `turn-result-card.test.ts` |
| `analytics.ts` EventName / allow-lists | `GameApp.tsx`, `useGameApp.ts`, `ClearScreen.tsx`, `RailwayMap.tsx` (`trackException`), `analytics.test.ts`, test mocks in `game-app-*`/`map-flash` |
| `RailwayMap` props / clear-mode camera | `GameApp.tsx:792-808`; `EditionApp`/`TitleScreen` paths use the same map; mocked prop capture in `game-app-turn-moments`, `game-app-item-progress`, `map-flash`; `title-map-mode.test.ts` MapDouble (needs any new methods, e.g. `getCanvas`, `addSource`, `setData`) |
| `addRailwayLayers` (if a trajectory layer is added there) | `RailwayMap.tsx:682-690`; `title-map-mode.test.ts:119-123` mock; any off-screen capture map |
| `.clear-screen*` CSS | E2E layout assertions (6.2) |

### Shared utilities to reuse

- Path/geometry: `buildGeometryIndex`, `stepPath`, `buildMovePlan`,
  `positionAlong`, `planarDistance` (`animation/movePath.ts`);
  `platformPosition`, `findSegment`, `nextStationId` (`engine/network.ts`).
- Animation: `runMoveAnimation` + `browserFrameScheduler` (`runner.ts`),
  `frameAt`/`hopDurationMs` (`timeline.ts`), `createLivePosition`.
- Map: `positionsBounds` (`RailwayMap.tsx:348-356`, module-private),
  `previewObstructions` / `toMapRect` (`:277-294`) for measuring the clear card as
  an obstruction, `titleFitPadding` (`camera.ts:40-46`), guarded layer writers
  in `railwayLayers.ts`, `buildLineColorExpression` / `presentation.lineGroupColor`.
- Credits: `MAP_CREDITS` (`mapConfig.ts:22-27`), `manifest.source`,
  `CC_BY_LICENSE_NAME` / `CC_BY_URL` / `safeExternalUrl` (`attribution.ts:110-123`).
- Aggregation: `summarizeGame`, `deriveCollectionProgress`
  (`collectionProgress.ts`), `presentation.lineGroupId/lineGroups/sameLineGroup`,
  `ITEM_DESCRIPTIONS` names, `LineBadge`.
- Text: `PhraseText` for wrapping, `stationName/serviceName` (`presentation.ts:12-27`).
- Settings: `useGameSettings`, `speedById` (`GameApp.tsx:148`),
  `usePrefersReducedMotion`, `isPhoneWidth` / `PHONE_MEDIA_QUERY`.

---

## 9. Open technical risks

1. **Transient user activation for share/copy.** iOS Safari / WebKit and
   Chromium require `navigator.share({files})` and `clipboard.write` to start
   within the user gesture; generating the PNG (map `idle` can take seconds on
   phones, longer in software WebGL) before calling them can throw
   `NotAllowedError`. Options: pre-render the image when the clear screen opens
   (or on first idle) and keep the Blob; on Safari pass a `Promise<Blob>` into
   `new ClipboardItem({"image/png": promise})` synchronously.
2. **Desktop ordering of clipboard write vs `window.open`.** Opening the X tab
   first can blur the document (clipboard write rejects when not focused);
   awaiting the clipboard first can lose popup permission. Needs a defined
   sequence (e.g. start clipboard write synchronously, then `window.open`
   synchronously in the same handler, report clipboard outcome afterwards). The
   X intent cannot attach images — the user must paste; UI copy must say so.
3. **`canShare` with files.** Current `canShare` checks text only; file support
   must be probed with `navigator.canShare({files:[file]})`. Firefox Android /
   some in-app browsers lack file share -> fall back to intent URL + 画像を保存.
   X intent links may open the login page inside the X in-app browser (X
   developer forum report).
4. **Second WebGL context / memory** for an off-screen capture map on low-end
   phones; must be created lazily and removed after capture; must degrade to
   text-only share when WebGL2 is unavailable (`unsupported`) or the style
   failed (`styleFailed`). If the live map is captured instead,
   `preserveDrawingBuffer` on the main map costs performance for the whole game.
5. **Capture completeness**: wait for `idle` (tiles + glyphs), set
   `fadeDuration: 0`; the DOM heading marker and DOM attribution are not part of
   the canvas (must be redrawn/burned in). Basemap tile failures after load are
   tolerated in the live map but would yield a blank basemap image.
6. **Replay duration** for long games (≈300 hops; p99 261 turns in S7) needs a
   total cap and possibly per-turn batching; deadhead jumps have no geometry;
   platform offsets break continuous LineStrings at transfers.
7. **Clear-mode camera does not exist**: after reload the camera is the title
   fit; desktop card covers the map centre and phone sheet covers up to 60%
   height — the final full-route view needs obstruction-aware padding and a
   resize observer (the existing observer ignores clear mode, `RailwayMap.tsx:805`).
   The map is `inert` on clear (attribution toggle unreachable).
8. **Colour/ownership**: feature `serviceId` is the primitive owner; the
   trajectory must carry the ridden service per leg. Existing progress layers
   are target-only by design (DESIGN row 180) and must not be repurposed.
9. **Test coupling**: order-dependent selectors in `result-share.test.ts`;
   `text-wrapping`/`capital-region` `@layout` E2E expect a visible, pageable
   history on phones (conflicts with `<details>` collapsed by default);
   `stub.counts.blocked` fails any real `window.open` to x.com; no existing
   share/clipboard/open stubs; jsdom lacks canvas.
10. **Analytics allow-list** silently drops `method: "x"` / save events until
    `EVENT_VALUES`/`EVENT_KEYS` (and possibly `EventName`) are extended; outcome
    semantics for "x" (clipboard ok but window blocked?) need definition.
11. **Single live region rule** (DESIGN row 241): new statuses (replay
    progress, image generation, copy result) should reuse the existing
    `.clear-screen__share-status` rather than add regions.
12. **Share text scope**: adding highlights to the X text revises DESIGN row
    227; X weighted limit 280 (Japanese = 2) — current text is ≈120 weighted.
13. **Hard-coded summary** 「山手線の外回り全30区間…」 (`ClearScreen.tsx:76`)
    is edition-specific; the image should derive wording from config/display if
    other editions are expected (B1 edition registry exists,
    `features/editions/registry.ts`).

Sources (external): [X Web Intent docs](https://docs.x.com/x-for-websites/post-button/guides/web-intent),
[X Post button overview](https://docs.x.com/x-for-websites/post-button/overview),
[X dev forum: intent opens login in app](https://devcommunity.x.com/t/bug-intent-urls-x-com-intent-post-open-login-page-inside-x-app-instead-of-post-composer/250749).
