# Issue #72 地図の見やすさ — affected-area codebase scan

Scanned at `develop` `c7af52a` (v0.21.0), 2026-11-26. Read-only investigation; no source edited.

Issue #72 body was written at v0.12.0. It has three later comments that widen the scope:

1. (2026-11-14) After 30/30, make the 新橋 target more visible: a red circle, or a speech bubble 「ここにつけばゴール」.
2. (2026-11-26) Clear-screen replay: the camera should zoom in on the moving part instead of always showing the
   whole route; the HUD should fold into a sidebar instead of the centre so the map is visible, and return to the
   centre when replay stops.
3. (2026-11-26) Where different lines run on the same stretch (東海道線 and 横須賀線), the routes overlap and one is
   hidden.

Items below: A = route emphasis, B = non-colour identification, C = 新橋 goal after 30/30 (comment 1),
D = clear replay camera and layout (comment 2), E = overlapping routes (comment 3).

---

## 0. Map architecture in one page

- One `RailwayMap` component (`src/features/map/RailwayMap.tsx`, 1022 lines) owns a single MapLibre map
  (`maplibre-gl` 6.11.2, `package.json:21`) for title, game and clear modes (`RailwayMapMode`, `:133`).
- Basemap: remote style `https://tiles.openfreemap.org/styles/liberty` (`mapConfig.ts:3`), passed straight to the
  `Map` constructor (`RailwayMap.tsx:540-555`). The app never restyles basemap layers (no `setPaintProperty` /
  `setLayoutProperty` on any non-railway layer anywhere in `src/`).
- Railway layers are added on every `style.load` by `addRailwayLayers` (`railwayLayers.ts:93-270`, called at
  `RailwayMap.tsx:711-741`), appended on top of the whole basemap (no `beforeId`). A replaced style bumps
  `layersRevision` (`RailwayMap.tsx:598, 723-725`) so every state effect reapplies itself.
- One GeoJSON source `railway-segments` (all 1,938 features) feeds 7 line layers; `railway-stations` feeds 2 circle
  + 1 ring + 2 label layers; `game-current-position` feeds 1 circle layer. 13 layers total, order pinned by
  `tests/unit/map-station-markers.test.ts:137-152`:
  `base, services, currentService, segmentsPendingCasing, segmentsPending, segmentsCompleted, segmentsFlash,
  stationCirclesOrdinary, stationCircles, goalStation, stationLabelsOrdinary, stationLabels, currentPosition`
  (ids in `mapConfig.ts:48-71`).
- DOM markers (`maplibregl.Marker`) used for: heading beak (`headingMarker.ts`), roll-adjustment speech bubbles
  (`rollAdjustmentPreview.ts`), station popups (`stationPopup.ts`). A symbol layer for the beak was tried and
  removed for performance (DESIGN.md row "Issue #62 Step 4b", 2026-11-11: symbol layer on per-frame `setData`
  doubled move-frame P50 16.7 → 33.3 ms).
- State flow: `GameApp.tsx` derives `turnDisplay` (`deriveTurnMomentDisplay`, `turnMomentPresentation.ts`), then
  builds `MapProgress` (`GameApp.tsx:394-405`) and passes reveal-gated props to `<RailwayMap>` (`GameApp.tsx:818-841`):
  `progress.highlightedServiceId = turnDisplay.ride.serviceId`, `markerBearing`, `goalStationId`,
  `segmentFlash`, `adjustmentCandidates`, clear route/replay store.

---

## A. Route emphasis (路線の強弱)

### A1. Current behaviour

| What | Where | Today |
|------|-------|-------|
| Non-target lines (134 groups / 134 services) | `railwayLayers.ts:117-128`, constants `mapConfig.ts:76-81` | One layer `railway-services`, filter `serviceId != target`, colour = line-group colour (`lineColor.ts:24-47`), **width 3, opacity 0.75, no zoom interpolation**. Every line drawn at the same strength. |
| Target track under the dashes | `railwayLayers.ts:109-116` | `railway-base`: Yamanote features only, width 2, opacity 0.5. |
| Yamanote pending | `railwayLayers.ts:138-161`, `mapConfig.ts:93-103` | **#62 already redesigned it**: magenta `#c040cf` width-4 dashed core over a white width-8 dashed casing. (The issue's "薄い緑の点線" is gone.) |
| Yamanote completed | `railwayLayers.ts:162-172` | Solid width 5 in the Yamanote colour. |
| Arrival flash | `railwayLayers.ts:173-186`, `RailwayMap.tsx:213-257` | One half-sine pulse per arrival. |
| Current ride highlight | `railwayLayers.ts:129-136`, `updateHighlightedService` `:335-339`, effect `RailwayMap.tsx:849-858` | `railway-current-service`: features of `progress.highlightedServiceId` (= `turnDisplay.ride.serviceId`, `GameApp.tsx:401`), width 7, full opacity, line-group colour, no casing. Drawn **below** the Yamanote progress layers, so on shared Yamanote track the dashed pending line covers it. Ride changes publish at lottery settle (`visibleRide`, `turnMomentPresentation.ts:172-181`). |
| Lottery-time map highlight of candidate lines | — | **None.** Candidates exist only on the split-flap board (`LotteryReveal.tsx`, mounted via `TurnMomentHost`; props built at `GameApp.tsx:511-517` from `session.lastMove.landing.serviceCandidates`). The board is public during `lottery-flip` / `lottery-settle`; the result stays hidden until settle. `RailwayMap` receives no candidate prop. |
| Per-line visibility (路線ごとの表示設定) | `GameLegend.tsx` (menu, `GameMenu.tsx:148`), store `lineVisibilityStore.ts`, apply `lineVisibility.ts:274-282` | Checkbox per line group and per operator + 「すべて表示」. Only the two background layers are filtered; progress/highlight/marker always visible (note text `GameLegend.tsx:24`). **In-memory only** (module-level store, reset on new game `GamePanel.tsx:178` and app mount `App.tsx:22`); not persisted. |
| Clear screen | `clearNetworkVisibility.ts:331-348` | Already "focus" in its own way: every legend group hidden, progress overlays hidden by layout visibility, only the travelled route (7 px over 11 px white casing, `clearRouteLayers.ts:11-14`) is coloured (DESIGN row "Issue #69 S4b/S5b", 2026-11-24; "Dim other lines" was the rejected alternative there). |
| Basemap labels | — | Untouched; full Liberty style opacity. The app's own station labels (`railwayLayers.ts:250-253, 280-307`) sit above every basemap layer. |

Basemap label feasibility: after `style.load`, `map.getStyle().layers.filter(l => l.type === "symbol" && !railwayIds.has(l.id))`
gives every basemap label layer; `setPaintProperty(id, "text-opacity" | "icon-opacity", v)` dims them. The same
"first symbol layer" scan already exists in `clearRouteAnchor` (`clearRouteLayers.ts:34-37`). Caveats: Liberty layers
may already carry `text-opacity` expressions (overwriting loses them — read `getPaintProperty` first and multiply or
skip); must be reapplied on `layersRevision`; the E2E stub style has **no symbol layers**
(`tests/e2e/support/mapStub.ts:25-47`), so only unit tests with a fake style can cover it; the offscreen share-image
map (`routeImage.ts:358`) is a separate map and is unaffected unless the helper is shared deliberately.

### A2. Done vs missing

- Done: Yamanote pending emphasis (#62); current ride drawn wider; clear-screen focus; legend per-line visibility.
- Missing: (a) a dimmed "focus" default for non-target, non-current lines (today 0.75 / 3 px for all);
  (b) lottery-time candidate highlight on the map; (c) basemap label dimming; (d) a way to keep the full-strength look
  for those who want it (issue: 「路線ごとの表示設定は、好きな人のために残す」 — the legend stays, but a style toggle
  does not exist). Current-ride highlight lacks a casing and sits under the Yamanote dashes.

### A3. Files likely to change

`src/features/map/mapConfig.ts` (new constants: dim opacity/width, label opacity, candidate layer id),
`src/features/map/railwayLayers.ts` (focus paint, new `railway-lottery-candidates` layer or reuse of
`currentService`, update helpers), `src/features/map/RailwayMap.tsx` (new props `lotteryCandidateServiceIds`,
`mapStyle`; effects), new `src/features/map/basemapLabels.ts`, `src/app/GameApp.tsx` (pass candidates during
`lottery-flip|settle`, pass style setting), `src/features/game/gameSettings.ts` + `store/settings.ts` +
`useGameSettings.ts` + `components/GameMenu.tsx` / `PhoneGameMenu.tsx` (toggle, if chosen), `GameLegend.tsx`
(legend copy). Tests: `map-station-markers.test.ts` (layer count/order 13 → 14), `capital-region-scaling.test.ts`
(paint assertions), `map-helpers.test.ts`, `game-settings.test.ts`, `use-game-settings.test.ts`,
`persistence.test.ts`, `game-legend.test.ts`; E2E `map-visual.spec.ts`, `lottery.spec.ts`, `game-settings.spec.ts`.

### A4. Risks / constraints

- `setFilter` and data-driven `setPaintProperty` on the 1,938-feature source re-run worker layout; the existing
  pattern already does `setFilter` per ride change (`railwayLayers.ts:335-339`), so per-ride/per-lottery updates
  are acceptable, but **never per frame**. A constant (non-data-driven) opacity/width change is cheap. Option:
  `promoteId: "featureId"` + `setFeatureState` for paint-only changes without re-layout (features already carry a
  string `id` equal to `featureId`, `export.py:167`, guard `guards.ts:247-259`).
- Lottery highlight must not leak the result: highlight every candidate equally during `lottery-flip`, switch to the
  result only at the existing settle boundary (DESIGN 2026-11-07 / 2026-11-12 publication rows). Presentation
  なし / reduced motion / Skip have no lottery stage → product decision whether candidates show at all then.
- The lottery board (`TurnMomentHost`) covers the map centre where the current station is; candidates near it are
  partly hidden (board placement uses map obstruction logic in `TurnMomentHost.tsx`).
- Basemap dimming depends on a third-party style whose layer ids can change without notice; implement by layer
  `type`, not by id.
- Title map uses the same layers (`EditionApp.tsx:101`): decide whether focus applies there.
- Clear screen must keep its own visibility rules (`clearNetworkVisibility.ts`); a focus style must not undo them on
  `layersRevision`.

---

## B. Non-colour identification (色以外の識別)

### B1. Current behaviour

- Line codes: hard-coded table `LINE_BADGE_CODES` (`src/features/game/lineBadge.ts:12-155`, keyed by **line-group
  id**, with source URLs per operator) plus `NO_CODE_LINE_GROUP_IDS` (`:157-179`). Measured on the real bundle: 134
  groups → **113 have a code, 21 have none** (all JR rural lines: 八高線, 相模線, 外房線, 上越線 …); 0 unaccounted.
  `tests/unit/line-badge.test.ts:103-108` enforces the partition. Codes are **not unique**: 22 codes are shared by
  2–8 groups (KS ×8, JO/SI/KK/KO ×5, JC/TS/TI ×4 …) — a code alone does not identify a service.
- `lineBadgeFor(serviceId, presentation)` (`lineBadge.ts:217-236`) → `{groupId, code, color, name, textColor}`;
  text colour by WCAG contrast (`badgeTextColor`, `:199-203`, `uiContrast.ts`). Rendered by `LineBadge.tsx`
  (React, sizes sm/md/lg; CSS `styles.css:3232-3270`). Used in HUD (`GameHud.tsx`), turn result card, effect chips,
  lottery board (`LotteryReveal.tsx:5,9`). **Never on the map.**
- Current-position marker: MapLibre circle layer `game-current-position-circle` (red `#e53935`, r=10, white 3 px
  stroke; `mapConfig.ts:104-107`, `railwayLayers.ts:255-269`), source updated per animation frame
  (`updateCurrentPosition`, `:323-326`; effect `RailwayMap.tsx:812-817`) plus the #62 DOM heading beak
  (`headingMarker.ts`, `Marker` with `rotationAlignment: "map"`, created once per map `RailwayMap.tsx:787-795`,
  updated in the same effect as the circle). Hidden during clear replay (`clearReplayMarker.ts`).
- Colour-vision: no simulation anywhere. The only colour checks are WCAG contrast for UI text
  (`uiContrast.ts`, `tests/unit/ui-contrast.test.ts`, DESIGN row "UI pop P0"). Palette = official operator colours
  from `manifest.json uiPresentation.lineGroups[].color`: **81 distinct colours for 134 groups**, 21 colours reused
  (`#1c0076` ×8, `#f15a22` ×7, `#ffd400` ×6 …) — colour is ambiguous even for typical vision. Progress already uses
  line style (dash vs solid) per spec 6.3 (`railwayLayers.ts:137`, DESIGN NFR row 109).

### B2. Done vs missing

- Done: HUD/lottery badges with codes; dash/solid progress cue; heading beak.
- Missing: (a) a line-code badge next to the current-position marker; (b) codes on candidate lines during the
  lottery; (c) a CVD simulation check of the palette (and of magenta pending `#c040cf` vs red marker `#e53935` vs
  goal ring `#b26a00`). 21 groups would need a fallback (no code → short name or nothing).

### B3. Files likely to change

New `src/features/map/lineCodeMarker.ts` (DOM `Marker`, modelled on `headingMarker.ts`; HTML text via
`textContent`), `RailwayMap.tsx` (new prop e.g. `currentLineBadge: LineBadgeModel | null`, update in the
position effect `:812-817`), `GameApp.tsx` (compute with `lineBadgeFor(turnDisplay.ride.serviceId, presentation)`),
`src/styles.css` (badge-on-map CSS, reuse `.line-badge__mark` look), candidate badge placement module if (b) is
taken. CVD: a pure helper (e.g. Machado 2009 matrices) + `tests/unit/` palette report, or a one-off script under
`scripts/` writing to `.claude/logs/`. Tests: new `line-code-marker.test.ts` (pattern: `heading-marker.test.ts:54-59`),
`map-visual.spec.ts` @layout phone check that the badge does not cover the beak or adjustment bubbles.

### B4. Risks / constraints

- The badge follows the marker every animation frame: `Marker.setLngLat` per frame is what the beak already does,
  fine; React must not re-render per frame (only `RailwayMap` subscribes to `livePosition`, `RailwayMap.tsx:755-756`).
- Reveal gating: the badge must use `turnDisplay.ride` (reveal-gated), never `session` state, or it leaks the
  lottery result (same reason the beak uses `turnDisplay.markerBearing`, DESIGN row #62 2026-11-10).
- Collisions: beak (protrudes `CURRENT_POSITION_RADIUS` px in any direction), roll-adjust bubbles anchored above
  stations (`rollAdjustmentPreview.ts:242-249`), proposed goal bubble (C), station labels, turn-result pill
  (phone). Adjustment-preview camera treats `[data-map-adjustment-callout]` as obstruction
  (`RailwayMap.tsx:265-284`) — a new marker should be added to those selector lists if it must stay unobscured.
- Candidate badges need an anchor point per candidate line (e.g. first segment from the current station on that
  service) — new geometry logic; several candidates leave one station in the same direction on shared track (E).
- Shared/absent codes: a JO badge cannot tell 横須賀線 from 総武快速線 from 成田線; decide whether to add the name.

---

## C. 新橋 goal after 30/30

### C1. Current behaviour (#62, shipped)

- Publication: `goalGuidance` in `turnMomentPresentation.ts:383-387` (public from the first-completion arrival,
  cleared on the goal turn), text `${goalStationName}に着けばクリア`.
- HUD: progress slot swaps to the guidance text (`TargetProgressBar.tsx`; short landscape 「あとは新橋へ」, DESIGN row
  "Issue #62 Step 5").
- Toast: 「30区間を踏破！あとは<goal>に着けばクリア」 once (DESIGN row "Issue #62 Step 6").
- Map ring: layer `railway-goal-station` (`railwayLayers.ts:236-249`), circle on the stations source, transparent
  fill (`circle-opacity: 0`), stroke **`#b26a00` 3 px**, radius zoom stops `[[8,7],[11,9],[13,12]]`
  (`mapConfig.ts:118-120`); between key station circles and labels; filter toggled by `updateGoalStation`
  (`:329-332`) from `goalStationId` (`GameApp.tsx:825`: guidance station in game, start station on clear;
  `RailwayMap.tsx:818-820`). Ring is kept during clear replay (E2E `clear-replay-share.spec.ts:734`).
- Reusable bubble: roll-adjustment callouts (`rollAdjustmentPreview.ts:187-260`): DOM `Marker` anchored `bottom`
  with offset `-6px`, bubble + leader tail, lane assignment against other bubbles, re-layout on `moveend`, CSS
  `.map-adjustment-callout*` (`styles.css:661-703`, cream bubble, `--color-brand-strong` border). Mounted only while
  an adjustment decision is open (`RailwayMap.tsx:796-805`).

### C2. Done vs missing

- Done: ring layer, HUD text, toast, announcement.
- Missing: stronger visual (the ring is a thin brown 3 px circle — easy to miss at overview zoom 11.5); a map bubble
  「ここに着けばゴール」; optional pulse. No camera hint (e.g. 「目標路線」 button already fits Yamanote, `RailwayMap.tsx:990-996`).

### C3. Files likely to change

`mapConfig.ts` (ring colour/width/radius, maybe a casing ring layer), `railwayLayers.ts` (second ring layer or
paint change), new `src/features/map/goalCallout.ts` (or generalise `rollAdjustmentPreview.ts` bubble creation into
a shared `mapCallout.ts`), `RailwayMap.tsx` (mount/unmount with `goalStationId` in game mode; include it in
`PREVIEW_LAYOUT_SELECTORS` / obstruction lists if needed), `styles.css`. Tests:
`map-station-markers.test.ts` (layer list), `roll-adjustment-preview.test.ts` (if shared code is extracted),
`map-visual.spec.ts` "30 of 30 return guidance" (`:508`), `clear-replay-share.spec.ts:734`.

### C4. Risks / constraints

- **Red conflicts with the current-position marker**, which is already a red `#e53935` circle; a "赤丸" goal would
  read as a second player. Needs a distinct shape/colour (and CVD check, B).
- Wording: existing copy is 「…に着けば**クリア**」 everywhere; the comment says 「ゴール」. Keep one term.
- Bubble vs roll-adjust bubbles at/near 新橋: both are bottom-anchored above the station; lane logic only knows its
  own bubbles (`assignLanes`). Either hide the goal bubble while adjustment bubbles are open, or feed both into one
  lane solver.
- Phone: bubble must not sit under the panel/pill; ring and bubble should stay on the clear screen or not (decide).
- Pulsing → `prefers-reduced-motion` must stop it (pattern: `usePrefersReducedMotion.ts`).

---

## D. Clear-screen replay (#69)

### D1. Current behaviour

- Store: `createClearReplayStore` (`src/features/game/clearReplayStore.ts:131-338`), phases
  `idle | playing | paused | done`, per-saved-turn timeline at 900/550/250 ms per turn, three subscriptions:
  frame snapshot (`subscribe`), phase (`subscribePhase`), UI (`subscribeUi` – phase + recordIndex). Pauses on
  `visibilitychange`. Reduced motion: `start`/`resume` call `finish()` immediately (`:242-245, 274-277`); controls
  label 「全経路を表示」 (`ClearReplayControls.tsx:52`).
- Signalling: buttons 軌跡を再生 / 一時停止 / 再開 / 速度 / 全経路を表示 (`ClearReplayControls.tsx:48-78`); phase
  changes announced via the clear screen live region (`:29-41`). Share/copy/save first `finish()` a running replay
  (`ClearScreen.tsx:188-191`); opening history pauses (`:323`).
- Map drawing: `useClearRouteMap` (`src/features/map/useClearRouteMap.ts:292-373`). Effect 1 (`:295-313`) writes the
  partial route GeoJSON on every replay frame (`buildClearRouteGeoJson(route, {stepIndex, fraction})`,
  `clearRoute.ts:269-285`). Effect 2 (`:315-372`) **fits `route.bounds` (the whole route) once** in the area the
  card leaves open (`clearFitPadding`, `clearRouteCamera.ts:165-183`, largest free region above/below/left/right
  of the card), with top ≥ 60 px for the caption (`:290, 333`), and refits only on resize. Its deps are
  `[map, active, route, generation, cardRef]` — **no replay phase**, so the camera never moves during replay.
  There is no replay head marker: the gameplay marker is hidden while playing/paused (`clearReplayMarker.ts`,
  `RailwayMap.tsx:767, 814-816`); the growing line tip is the only cue.
- Caption: `ClearReplayMapCaption` fixed at the map top (`ClearReplayControls.tsx:87-101`, CSS
  `clearScreen.css:200-240`).
- Layout: desktop card = **centred modal-like card** `top/left 50%`, `translate(-50%,-50%)`, width
  `min(440px, 100%-24px)` (`clearScreen.css:3-8`); the route is framed beside it. Phone (≤600 px) = bottom sheet
  capped at 65 % (`:404-414`); **during playing/paused the phone card already collapses** to a control band
  (`replayCollapsed`, `ClearScreen.tsx:89-90`; CSS `clearScreen.css:468-523`), with focus hand-off
  (`ClearScreen.tsx:139-160`) and a refit because the card is ResizeObserved (`useClearRouteMap.ts:353-356`).
  Desktop stays expanded — **asserted by E2E** `clear-replay-share.spec.ts:951` "leaves the desktop clear card
  expanded during replay".
- Desktop game panel (for "sidebar" reuse): fixed left, bottom 28 px, width 310 px (`styles.css:754-768`).
- DESIGN rows: 2026-11-22 "Trajectory replay starts only from a button … ends on the full-route view" lists
  **"camera following the current position" as a rejected alternative**; 2026-11-24 "Issue #69 S4b/S5b" says
  "desktop is unchanged". Comment 2 reverses both → new superseding Key Decisions rows needed.

### D2. Done vs missing

- Done: replay, speeds, pause/resume/finish, caption, phone collapse, reduced-motion full route, refit on resize.
- Missing: (a) camera that follows/zooms to the moving tip; (b) desktop collapse of the card into a sidebar during
  replay, and back to centre when it stops; (c) a head marker (optional, helps the follow camera read).

### D3. Files likely to change

`src/features/map/useClearRouteMap.ts` (phase-aware camera: follow during playing, decide paused, full fit on
done/idle; subscribe to the store), `src/features/map/clearRouteCamera.ts` (follow padding/zoom helpers,
`CLEAR_FOLLOW_ZOOM`), `src/features/game/clearRoute.ts` (export head position for a cursor), maybe
`clearReplayMarker.ts`/new head-marker layer, `src/features/game/components/ClearScreen.tsx` (`replayCollapsed`
extended to desktop), `clearScreen.css` (desktop sidebar variant), `ClearReplayControls.tsx` (if controls move).
Tests: `clear-route-map.test.ts` (`useClearRouteMap` block `:328+`), `clear-replay.test.ts`,
`clear-replay-controls.test.ts`, `clear-screen.test.ts`, E2E `clear-replay-share.spec.ts` (`:882`, `:939`, `:951`
must flip, screenshots `:986`, `:1004`).

### D4. Risks / constraints

- Per-frame camera moves: the store publishes every rAF; `jumpTo` per frame is fine (game follow already uses
  `immediate` jumps while animating, `RailwayMap.tsx:514-524`), but `easeTo` per frame fights itself. Follow per
  turn (recordIndex change) with easing is the cheaper option.
- Must keep: card-aware padding (sidebar now occupies the left, so `clearFitPadding` must be fed the collapsed
  card rect — it already measures the live card), caption clearance, credit-button clearance, `watchRemoval`
  guards, `map.setPadding(entryPadding)` restore on exit, StrictMode re-activation of the store.
- User camera gestures during replay: today nothing reacts; follow mode needs an override (pattern:
  `previewCameraOverrideRef`, `RailwayMap.tsx:610, 731-737`).
- Reduced motion never plays, so follow code is inert there — keep it that way.
- Focus management: desktop collapse must reuse the phone hand-off logic (`ClearScreen.tsx:139-160`); hidden parts
  use `hidden` + `inert` + `aria-hidden` (`:234, 263, 293`).
- The share PNG (`routeImage.ts`) uses its own offscreen map and full-route fit; unaffected.
- "再生を止めたら" is ambiguous: pause vs finish/natural end (phone today re-expands only on natural end or
  全経路を表示, `ClearScreen.tsx:89-90`).

---

## E. Overlapping routes on shared track

### E1. Data model (measured on `public/data`, `dataVersion n02-2025-7974da15af8e`)

- `manifest.json` `schemaVersion: 3` (`src/types/data.ts:48`, guard `guards.ts:140`).
- `segments.geojson`: 1,938 `LineString` features, one **undirected feature per adjacent station pair per service**
  (`featureId = "<serviceId>:<from>~<to>"`, canonical +1 orientation, `export.py:116-183`). Properties
  `featureId, serviceId, lineId, from, to`; `serviceId == lineId` for every feature (135 owners).
  `segments.json`: 3,988 directed segments referencing features; 148 segments (15 pairs, e.g. 湘南新宿ライン →
  高崎線/東海道線/横須賀線/宇都宮線, 副都心線 → 有楽町線) reference **another service's** features.
- Geometry is **duplicated per service, not shared by reference**: each service owns its own coordinates, generated
  from N02 by the pipeline (`stage_suburban_jr.py`, `stage_suburban_nonjr.py`, simplification
  `simplification.py`, export `export.py:151-183`). Where two services run on the same N02 polyline the
  coordinates are byte-identical.
- Overlap measurement (scratch scripts, exact edge = identical rounded coordinates):
  - 279.5 km of 4,171.6 km drawn length (6.7 %) is exactly shared; 1,817 shared edges in 154 connected corridors,
    **50 corridors ≥ 1 km**, 133 service pairs. Stack depth: 2 services on 1,461 edges, 3 on 137, 4 on 141,
    **5 on 78**.
  - Largest: 東京–上野–大宮 corridor (8 services incl. 山手線, 京浜東北, 宇都宮, 高崎, 常磐, 東海道 via 上野東京ライン,
    up to 5 stacked); 赤羽–大宮 (5); 大崎–池袋 (埼京/湘南新宿/相鉄直通/山手); 中央・総武緩行/快速; 常磐快速/緩行.
  - 東海道線 × 横須賀線: 17.4 km exact, at 品川–西大井 start, 新川崎/川崎–横浜, 横浜–保土ケ谷–東戸塚–戸塚, 戸塚–大船.
    山手線 × 京浜東北線: 14.8 km. 東海道線 × 京浜東北線: 17.4 km.
  - Near-coincident (within 15 m, not identical): 699 km sampled. At the initial zoom 11.5 one pixel ≈ 44 m, so
    parallel N02 tracks tens of metres apart also merge visually; exact-sharing is only part of the problem.
  - **Orientation is mixed**: of 1,832 shared edges, 658 are traversed in opposite directions by the services
    sharing them. **Features do not align at station boundaries**: 282 features are only partially shared
    (e.g. 東海道 `yokohama~totsuka` covers three 横須賀線 features).
- Rendering: all non-target services are one layer with one colour `match` expression (`railwayLayers.ts:117-128`);
  draw order among overlaps = source order (later feature wins). `line-sort-key` is not used.
- History: a uniform `line-offset: 4` existed in the 23-ward design and was dropped because "it cannot separate
  dozens of services" (`.claude/docs/research/jr-east-capital-region-expansion-design.md:196`,
  `jr-east-tokyo-expansion-design.md:391, 408`). A unit test pins its absence:
  `tests/unit/capital-region-scaling.test.ts:169` `expect(layers[LAYER_IDS.services]?.paint).not.toHaveProperty("line-offset")`.
- Data pipeline "offsets" (`stage_suburban_assembly_offsets.py`) are **platform offsets in metres**, unrelated to
  render offsets.

### E2. Feasibility of `line-offset`

MapLibre `line-offset` is a data-driven paint property (pixels, can be zoom-interpolated); `line-sort-key` is a
data-driven layout property. A per-feature offset on the current features is **not sufficient**:

1. Mixed orientation flips the side for one of two services on 36 % of shared edges unless the render copy reverses
   coordinates to a corridor-canonical direction.
2. Partial sharing: an offset applies to the whole feature, so 282 features would shift their unshared parts too.
   Clean results need render-only features **split at the start/end of each shared run**, each with a slot index
   (e.g. -1, 0, +1 for three services, Yamanote fixed at 0).
3. The moving marker and clear-route use the un-offset centreline (`movePath.ts:14-49`, `clearRoute.ts:28-68`);
   an offset current-line highlight would leave the marker a few px off its line.

Where to compute: **runtime, not the pipeline**. `segments.geojson` is hashed into `dataVersion`
(`export.py:211-216, 219-229`), and `engine/save.ts:155-157, 457` rejects saves whose `dataVersion` differs — editing
the published geometry would invalidate every save. A runtime derived "render collection" (pure function from the
loaded `SegmentFeatureCollection`, memoised like `buildMapPresentationIndex`) keeps data and saves untouched; a
separate non-hashed render file from the pipeline is the alternative (needs loader/guard/manifest work). Cost:
~31 k edges, a hash map pass — expected tens of ms, but mobile main thread is already the bottleneck (TBT figures in
`.claude/docs/research/c1-map-performance-baseline.md:151-160`); measure.

### E3. Done vs missing

- Done: nothing beyond source order; the current ride is drawn wider on top (`currentService`, width 7), so the
  ridden line itself is visible.
- Missing: any separation of coincident services.

### E4. Files likely to change

New `src/features/map/corridorOffsets.ts` (split + slot assignment, pure), `railwayLayers.ts` (second source or
replace source for `base`/`services`/`currentService`; `line-offset` expression with zoom stops;
maybe `line-sort-key`), `RailwayMap.tsx` (memo + source data), `mapPresentation.ts` /
`lineVisibility.ts` (feature-id filters must map to the split render ids — today filters use `featureId`
lists, `lineVisibility.ts:229-259`, `railwayLayers.ts:335-339`), `progressStyle.ts` if Yamanote layers use split
features. Tests: new `corridor-offsets.test.ts` with tiny fixtures (two services, reversed orientation, partial
overlap), `capital-region-scaling.test.ts:169` (pinned absence must be updated with justification),
`map-helpers.test.ts`, `clear-network-visibility.test.ts`, E2E `map-visual.spec.ts` screenshots.

### E5. Risks / constraints

- Scope/complexity is the largest of A–E; algorithmic and non-local (filters, highlight, legend, progress all key
  on `featureId`). Codex design review recommended.
- Offsets at overview zoom widen 5-deep corridors to ~15–20 px; zoom-interpolate (0 below ~z11, full at ~z13) or
  limit to the focus/current line.
- Near-coincident parallels are not caught by exact matching; a tolerance-based matcher is much harder (snapping).
- Changing source data per ride must stay off the per-frame path.

---

## Conventions to follow

- Map layers: ids in `LAYER_IDS` / `SOURCE_IDS` (`mapConfig.ts:29-71`), constants UPPER_SNAKE in `mapConfig.ts`
  (e.g. `GOAL_STATION_RING_*`), layers added only inside `addRailwayLayers` in a fixed order; every update helper
  checks `map.getLayer(id)` first and skips silently (`railwayLayers.ts:309-370`); effects depend on
  `layersRevision` so state survives a style reload; filters keyed by `featureId`, not owner; empty filter =
  `["in", ["get", …], ["literal", []]]`. Clear-mode layers added with `beforeId` = first station layer
  (`clearRouteAnchor`). Layout visibility is used when filters/paint must be preserved (`clearNetworkVisibility.ts`).
- DOM markers: plain DOM built in a factory (`createHeadingMarkerElement`, `createCalloutElement`), `aria-hidden`,
  `pointer-events: none`, a `data-map-*` attribute for tests/obstruction lists, text via `textContent`, controller
  object with `update/remove` or a mount function returning teardown; created in a `useEffect` keyed on
  `loadedMap` (`RailwayMap.tsx:787-805`).
- Reveal gating: map props come only from `turnDisplay` (DESIGN row 2026-11-10 map guidance).
- Settings: `GameSettings` v1 JSON (`store/settings.ts`), parse is lenient (missing field → default), so a new field
  needs no version bump; toggles live in `GameMenu.tsx:118-145` (追尾 / 速度 / 演出 pattern) and the phone hamburger.
- Tests: Vitest `describe/it` with behaviour sentences; fake map objects recording `addLayer/setFilter/
  setPaintProperty` (`map-station-markers.test.ts:115-121`, `capital-region-scaling.test.ts:158-166`,
  `clear-route-map.test.ts:96`); Playwright with `{ tag: "@layout" }` for phone layout, real dataset via
  `test.use({ dataset: "real" })`, map read through the e2e-only hook `window.__sugorokuE2E.map`
  (`e2eHook.ts`), stub basemap (`support/mapStub.ts`), screenshots to `.claude/logs/...` on request. CI: feature
  push = Chromium only; PR = full matrix (memory notes).
- File size: `RailwayMap.tsx` is already 1,022 lines (above the 800 max in `coding-principles.md`); new logic should
  go into new hooks/modules (`useLotteryHighlight`, `useClearReplayCamera`, …), not into the component.
- DESIGN.md: every product decision here supersedes or extends rows dated 2026-11-10/11 (#62), 2026-11-22/24
  (#69); add superseding Key Decisions rows.

---

## Rough size estimate (source + tests, excluding docs)

| Item | Source LOC | Test LOC | Notes |
|------|-----------:|---------:|-------|
| A1 focus dim of other lines (constants + optional toggle/persist) | 20–120 | 40–120 | constants only ≈ 20; with menu toggle + settings ≈ 120 |
| A2 lottery candidate highlight | 60–100 | 60–100 | new layer or reuse, GameApp wiring |
| A3 basemap label dimming | 30–50 | 40–60 | unit-only coverage (stub style has no labels) |
| B1 current-line code badge marker | 80–120 | 60–100 | incl. CSS ~30 |
| B2 candidate codes on map | 120–200 | 80–120 | anchor placement + collisions |
| B3 CVD palette check | 60–120 | 40–80 | report-only; palette changes are a product call |
| C goal emphasis (ring + bubble) | 60–120 | 50–100 | possible extraction of shared callout code |
| D1 replay follow camera | 120–200 | 100–160 | phase-aware camera + override |
| D2 desktop sidebar collapse | 60–120 (mostly CSS) | 60–100 | flips E2E `:951` |
| E corridor offsets (runtime split + offset) | 250–400 | 200–300 | highest risk; Codex design first |

Total if everything is taken: roughly 0.9–1.6 k source LOC and 0.7–1.2 k test LOC. Natural PR split:
(A+B1+C) map emphasis, (D) clear replay, (E) corridor offsets, (B2/B3) later.
