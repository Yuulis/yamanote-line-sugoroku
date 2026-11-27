# Plan: map readability (issue #72)

Date: 2026-11-26. Base: `develop` @ c7af52a (v0.21.0).
Brief: `.claude/docs/research/feature-map-readability-brief.md` (authoritative scope).
Scan: `.claude/docs/research/feature-map-readability-codebase.md`.
Codex (Sol, low effort, read-only): scope `.claude/logs/codex/20261126T132230Z-map-readability-scope.md`;
architecture `.claude/logs/codex/20261126T132842Z-map-readability-arch.md`;
plan `.claude/logs/codex/20261126T133219Z-map-readability-plan.md`; validation: section 9.

## 1. Summary

Three PRs to `develop`, each from a `feature/*` branch cut from `develop` after the previous PR
merges. Each PR body references #72; the release PR carries `Closes #72`.

- **PR1** `feature/map-focus-goal`: pure extraction out of `RailwayMap.tsx` (1,022 lines → ≤ 800),
  then A1 focus paint, A2 lottery-candidate overlay, A3 faded basemap symbols, C gold goal ring +
  CSS pulse + 「ここに着けばゴール」 bubble, B2 Japanese colour-vision report.
- **PR2** `feature/replay-camera-strip`: replay store seek/step + `cardExpanded`, per-turn camera
  with manual-view lock, bottom seek-bar strip on desktop and phone, 「結果を表示」 as the only way
  back to the centred card.
- **PR3** `feature/shared-track-offsets`: pure corridor-offset builder for exactly shared edges,
  derived render source for three layers, zoom-gated `line-offset`, performance gate.

Presentation only: `SAVE_VERSION`, `dataVersion`, `public/data`, game rules unchanged; no save
migration.

Out of scope (user 2026-11-26): B1 line-code labels on the map, current-marker badge, focus
toggle, colour changes, near-parallel offsets, data/pipeline changes, Yamanote pending styling.

## 2. Architecture (per item)

| Item | Decision |
|---|---|
| A1 | `railway-services` paint becomes 2 px / 0.30 opacity (initial tuning; constants in `mapConfig.ts`) on the gameplay map only; the title map keeps today's paint (width 3, opacity 0.75, user 2026-11-26). Mechanism: `addRailwayLayers` takes an optional `focusBackground` flag (default off = today's paint, matching the "title map passes nothing" convention of `RailwayMapProps`); `RailwayMap` passes `focusBackground: modeRef.current !== "title"` from its `style.load` handler and re-applies it with `setBackgroundFocus` in a layout effect keyed on `mode !== "title"` and `layersRevision`. Correction (2026-11-27, Step 1.5 review): `GameApp` keeps one persistent `RailwayMap` and switches `mode` between title/game/clear, so a creation-time flag alone left gameplay at the title paint; only `EditionApp`'s data-error title map is a separate instance. Clear mode shares the gameplay instance, so it gets the focus paint and keeps `clearNetworkVisibility.ts` as today. Current ride (7 px, opacity 1) and the Yamanote stack are unchanged. `lineVisibility.ts` still owns the two background filters, so the legend keeps working. |
| A2 | `deriveTurnMomentDisplay` publishes `lotteryCandidateServiceIds` (public landing candidates) only during `lottery-flip` / `lottery-settle`; identical across both stages and independent of the winner; a stable empty list in every other phase (effects off, reduced motion, Skip ⇒ no stage ⇒ empty). `RailwayMap` resolves them via `indexServiceGeometry` to deduplicated primitive `featureId`s and filters a new layer `LAYER_IDS.lotteryCandidates` (between `services` and `currentService`, below Yamanote progress; 13 → 14 layers; initial 4 px / ~0.85). Filter written only on set change (compare the deduplicated `featureId` sets by content: `lotteryCandidateServiceIds` is a fresh frozen array whenever non-empty, per Step 1.6 review 2026-11-27) and on `layersRevision`; layer added to `CLEAR_HIDDEN_OVERLAY_LAYER_IDS`. The current-service highlight keeps its existing settle publication boundary, so nothing leaks. |
| A3 | Pure `buildBasemapLabelPatches` scales `text-opacity` (×0.75) / `icon-opacity` (×0.65) of `symbol` layers selected by type (never by id), from each freshly loaded style's own values (omitted ⇒ default 1; constants; data expressions; top-level `step`/`interpolate` zoom expressions incl. inside `let` scale their outputs; unsafe values skipped). Applied in the `style.load` handler before `addRailwayLayers`, so app station labels are never touched and fading never compounds. Writes are guarded by `getLayer`. |
| B2 | Report only: `docs/manual/map-readability/colour-vision.md` (Japanese), written after PR1 visuals are final. Records exact palette reuse separately from protan/deutan/tritan similarity, the method, sampled views/zooms (dim background, candidate overlay, gold ring vs red marker vs magenta pending), and existing non-colour cues (HUD/lottery badges, dash vs solid). Any analysis script stays local (not committed). Official colours unchanged. |
| C | `railway-goal-station` stays the permanent zoom-aware ring, restyled gold / 5 px (initial). In gameplay, `RailwayMap` resolves the reveal-gated `goalStationId` to coordinates and mounts `goalCallout.ts`: a 「ここに着けばゴール」 DOM bubble built from the roll-adjust bubble shell (exported from `rollAdjustmentPreview.ts`) plus a second DOM marker whose inner element pulses opacity/scale over ~3 s via CSS. `prefers-reduced-motion` disables the animation; ring and bubble stay. Zero per-frame MapLibre writes (respects the #62 Step 4b perf finding). Clear map keeps the static ring only. Markers are `aria-hidden`, non-interactive, `data-map-goal-callout` / `data-map-goal-pulse`. |
| D1 | `useClearReplayCamera` (moved out of `useClearRouteMap.ts`) subscribes to the turn-level UI snapshot and fits each saved turn's span bounds (all step coordinates; empty span ⇒ destination point; unresolved ⇒ keep view) instantly at the existing max zoom with measured card/strip padding, coalescing layout reads per frame. A user pan/zoom (`USER_CAMERA_EVENTS` + `isUserCameraEvent`) locks automatic turn and layout fits; an explicit seek/prev/next (`seekRevision` bump) forces exactly one fit and keeps the lock; completion always fits `route.bounds` and supersedes queued turn work. A new playback unlocks. Style reload does not unlock. Reduced motion keeps the instant full-route path with the card expanded. |
| D2 | `cardExpanded` in the store, independent of phase. Ordinary playback collapses the card to a bottom strip on desktop and phone: native range input (one-based real turns), 前/次 buttons, pause/resume, speed, 全経路を表示, and the 「移動履歴を見る」 trigger on desktop only (the phone strip has no history trigger during playback, keeping today's behaviour). Paused/done shows 「結果を表示」; only it sets `cardExpanded` (natural end and 全経路を表示 keep the strip and show the full route). Seek/step never pause or resume playback: if playing it keeps playing from the new turn, if paused it stays paused, and from `done` it goes to paused at the chosen turn; each publishes route prefix, caption and camera from one transition. 前 from `done` (the completed full-route view) selects the first real turn. Focus moves Play → strip control, disappearing control → surviving strip control, 「結果を表示」 → Play or results heading. Share during replay goes through 「結果を表示」 and still sees the full route. |
| E | Pure `buildCorridorOffsets(geometry, targetServiceId)`: index undirected edges by exact endpoint coordinates; shared ⇔ ≥ 2 distinct owning `serviceId`s; walk connected shared runs in a deterministic orientation (sorted tie-break at branches/loops), reorient fragments, split at original feature boundaries, shared/unshared transitions and slot changes, keep intermediate vertices. Slots: target (Yamanote) = 0, fresh groups centred around 0, continuing services keep compatible slots, entering services take free slots; never depends on legend or lottery state. Fragments get unique top-level `id`s but keep `properties.featureId/serviceId/lineId`, so every existing `featureId` filter (incl. cross-owner references) still selects all fragments. Derived source feeds only `services`, `currentService`, `lotteryCandidates`, all with one `line-offset` = `interpolate(zoom)`: 0 through z11 → `corridorSlot × spacing` at z13 (missing slot ⇒ 0). Base/progress/flash, clear route and movement keep the canonical source. Memoised per geometry identity + target; reused across style reloads; derivation failure falls back to the canonical source. |

### Module structure

| PR | New | Modified |
|---|---|---|
| 1 | `src/features/map/railwayMapCamera.ts` (~270–330 lines: `cameraLayoutTargets`, `useCameraLayoutObserver`, `previewObstructions` + preview fitting, title/overview/follow helpers, moved intact), `src/features/map/useSegmentFlash.ts` (~55–70), `src/features/map/basemapLabels.ts` (~50–90), `src/features/map/goalCallout.ts` (~50–80), `tests/unit/basemap-labels.test.ts`, `docs/manual/map-readability/colour-vision.md` | `RailwayMap.tsx` (target 700–750 after PR1 wiring), `mapConfig.ts`, `railwayLayers.ts`, `rollAdjustmentPreview.ts`, `clearNetworkVisibility.ts`, `turnMomentPresentation.ts`, `GameApp.tsx`, `src/styles.css` |
| 2 | `src/features/map/useClearReplayCamera.ts` (~120–170) | `clearReplayStore.ts`, `clearResult.ts`, `clearRoute.ts`, `clearRouteCamera.ts`, `useClearRouteMap.ts`, `ClearScreen.tsx`, `ClearReplayControls.tsx`, `clearScreen.css` |
| 3 | `src/features/map/corridorOffsets.ts` (~200–300), `tests/unit/corridor-offsets.test.ts` | `RailwayMap.tsx`, `mapConfig.ts` (source id + railway-source error classification), `railwayLayers.ts`, `scripts/perf/measure-map.mjs` |

### Interfaces

```ts
// basemapLabels.ts — pure, consumes the freshly loaded style
type SymbolOpacityPatch = Readonly<{
  layerId: string;
  property: "text-opacity" | "icon-opacity";
  value: number | ExpressionSpecification;
}>;
function buildBasemapLabelPatches(
  layers: readonly LayerSpecification[],
  factors: Readonly<{ text: number; icon: number }>,
): readonly SymbolOpacityPatch[];

// turnMomentPresentation.ts — new field on TurnMomentDisplay
readonly lotteryCandidateServiceIds: readonly string[];
// RailwayMapProps — optional (title map passes nothing)
readonly lotteryCandidateServiceIds?: readonly string[];
// railwayLayers.ts RailwayLayerInput — optional; omitted = today's background paint (title map)
readonly focusBackground?: boolean; // RailwayMap passes mode !== "title"
// railwayLayers.ts — guarded, called on set change and layersRevision only
function updateLotteryCandidates(map: MapLibreMap, featureIds: readonly string[]): void;

// rollAdjustmentPreview.ts — shared bubble shell; roll-specific content and lanes stay local
function createMapCallout(content: readonly Node[]): {
  element: HTMLElement; bubble: HTMLElement; leader: HTMLElement;
};
// goalCallout.ts — mount returns teardown (mirrors roll adjustment)
function mountGoalCallout(map: MapLibreMap, position: Position): () => void;
function createGoalPulseElement(): HTMLElement; // private; timing in CSS

// clearReplayStore.ts — turn-level snapshot additions
interface ClearReplayUiSnapshot {
  readonly phase: ClearReplayPhase;
  readonly recordIndex: number;
  readonly turnCount: number;
  readonly cardExpanded: boolean;
  readonly seekRevision: number; // bumps on explicit seek/step only
}
// ClearReplayStore additions
seek(recordIndex: number): void;   // clamps finite input, ignores non-finite; keeps play state
                                   // (playing continues, paused stays paused, done -> paused there)
step(delta: -1 | 1): void;         // same play-state rule; from done, -1 selects the first turn
                                   // (record index of the first real turn)
showResults(): void;               // full route + cardExpanded = true
function resolveReplaySeekIndex(turnCount: number, recordIndex: number): number | null;

// clearResult.ts — ClearTurnSpan
readonly destination?: Position;
// clearRouteCamera.ts — pure
type ClearReplayBounds = readonly [southWest: Position, northEast: Position];
function clearReplayTurnBounds(route: ClearRoute, recordIndex: number): ClearReplayBounds | null;
// useClearReplayCamera.ts
type ClearReplayCameraInput = Pick<
  ClearRouteMapInput, "map" | "active" | "route" | "generation" | "cardRef" | "replayStore"
>;
function useClearReplayCamera(input: ClearReplayCameraInput): void;

// corridorOffsets.ts — pure, input treated as immutable
type CorridorRenderFeature = Omit<SegmentFeature, "properties"> & {
  properties: SegmentFeatureProperties & { readonly corridorSlot: number };
};
interface CorridorRenderCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly CorridorRenderFeature[];
}
function buildCorridorOffsets(
  geometry: Readonly<{ type: "FeatureCollection"; features: readonly SegmentFeature[] }>,
  targetServiceId: string,
): CorridorRenderCollection;
```

### Data flow

1. Gameplay: `deriveTurnMomentDisplay` → candidates, ride, goal guidance → `GameApp` →
   `RailwayMap` (resolves feature ids / station coordinates). A replaced style gets fresh basemap
   patches, then railway layers; state effects reapply on `layersRevision`.
2. Replay: frame snapshot → route prefix + marker; turn-level snapshot → controls, caption,
   camera. A scrub publishes one consistent position. Completion publishes the full route with
   `cardExpanded` false; 「結果を表示」 flips it and the camera re-measures.
3. Offsets: loaded geometry → canonical consumers unchanged; memoised derivation → three layers;
   ignores legend changes, lottery changes and animation frames.

### Error handling

Missing map/layer/geometry/coordinates use existing guarded fallbacks (skip silently). Missing
goal coordinate ⇒ no DOM markers. Missing candidate geometry ⇒ empty filter. Untransformable
remote opacity value ⇒ property skipped. Non-finite seek ignored, finite clamped, boundary
buttons disabled; empty routes unavailable. Unavailable layout measurement ⇒ keep the intended
fit and retry on the next observed layout. Scheduled work cancelled on reset/teardown; removed-
map guard and padding restore kept. Degenerate corridor edges are non-matchable (centre line);
derivation failure ⇒ canonical source, zero offsets.

## 3. PR1 steps (`feature/map-focus-goal`)

Every step is one commit. The implementer runs the listed desktop Chromium specs; the lead
re-runs typecheck + touched vitest + build + phone `@layout`. Firefox/WebKit run in PR CI.

| Step | Title | Visible | LOC (impl + test) |
|---|---|---|---|
| 1.1 | Extract camera layout observation (pure move) | no | ~75 + 5 |
| 1.2 | Extract adjustment-preview camera helpers (pure move) | no | ~165 + 3 |
| 1.3 | Extract title/overview/follow camera helpers (pure move) | no | ~95 + 0 |
| 1.4 | Extract the segment flash hook (pure move) | no | ~65 + 5 |
| 1.5 | A1 focus paint for background services (gameplay map only) | **yes** | ~25 + 30 |
| 1.6 | A2 candidate publication in turn-moment display | no | ~30 + 45 |
| 1.7 | A2 candidate overlay layer | **yes** | ~80 + 55 |
| 1.8 | A3 basemap symbol opacity on style load | **yes** | ~65 + 65 |
| 1.9 | C gold ring, CSS pulse, goal bubble | **yes** | ~115 + 55 |
| 1.10 | B2 colour-vision report + PR1 DESIGN rows | no (docs) | ~65 + 0 |

### Step 1.1 — Extract camera layout observation (pure move)
Files: `src/features/map/railwayMapCamera.ts` (new) receives `cameraLayoutTargets` and
`useCameraLayoutObserver` intact; `RailwayMap.tsx` imports them; effect order and inputs unchanged.
Tests: `tests/unit/map-panel-observer.test.ts`, `map-helpers.test.ts`, `turn-result-placement.test.ts` — import paths only.
```bash
npm run typecheck
npx vitest run tests/unit/map-panel-observer.test.ts tests/unit/map-helpers.test.ts tests/unit/turn-result-placement.test.ts
npm run build
```

### Step 1.2 — Extract adjustment-preview camera helpers (pure move)
Files: `railwayMapCamera.ts` receives preview layout selectors, obstruction measurement, bounds,
origin-marker clearance and preview fitting; `RailwayMap.tsx` keeps mode selection and call order.
Tests: `turn-result-placement.test.ts` (`previewObstructions` import only); roll-adjust cases unchanged.
```bash
npm run typecheck
npx vitest run tests/unit/turn-result-placement.test.ts tests/unit/map-panel-observer.test.ts tests/unit/roll-adjustment-preview.test.ts
npm run build
```

### Step 1.3 — Extract title/overview/follow camera helpers (pure move)
Files: `railwayMapCamera.ts` receives title/overview fits, bottom-panel padding, layout key and
recentring; `RailwayMap.tsx` keeps camera mode, lifecycle and effects.
Tests: `title-map-mode.test.ts`, `map-camera.test.ts`, `map-helpers.test.ts` run as written.
```bash
npm run typecheck
npx vitest run tests/unit/title-map-mode.test.ts tests/unit/map-camera.test.ts tests/unit/map-helpers.test.ts
npm run build
```

### Step 1.4 — Extract the segment flash hook (pure move)
Files: `src/features/map/useSegmentFlash.ts` (new; clock + hook intact); `RailwayMap.tsx` imports it.
Tests: `tests/unit/map-flash.test.ts` (import and mock paths only; frame/halo/cleanup assertions kept).
```bash
npm run typecheck
npx vitest run tests/unit/map-flash.test.ts
npm run build
wc -l src/features/map/RailwayMap.tsx   # record; must end PR1 at <= 800
git diff --check
```
Review each move diff against the original bodies (no behaviour change; E2E desktop smoke optional).

### Step 1.5 — A1 focus paint, gameplay map only (visible)
Files: `mapConfig.ts`, `railwayLayers.ts`: background services 2 px / 0.30 (named focus constants
beside the existing `OTHER_SERVICE_LINE_WIDTH` / opacity) selected by the optional
`RailwayLayerInput.focusBackground` flag (omitted ⇒ today's width 3 / opacity 0.75);
`RailwayMap.tsx` passes `focusBackground: mode !== "title"` in the `style.load` call; legend
filters and clear-screen visibility untouched.
Tests: `tests/unit/capital-region-scaling.test.ts` (add positive asserts that pin the split:
`addRailwayLayers` without the flag, i.e. the title map, keeps background width 3 / opacity 0.75;
with `focusBackground: true`, i.e. the gameplay map, background width 2 / opacity 0.30; current-service
width 7 and opacity 1 in both). The flag wiring in `RailwayMap.tsx` is covered by the title/game
E2E smoke below. No existing width-3/opacity-0.75 assertion for
the background layer exists (the `0.75` dash entry and width 8 in `map-flash.test.ts` /
`map-visual.spec.ts` belong to the pending casing and stay). The `line-offset` absence assertion
at `capital-region-scaling.test.ts:169` stays through PR1 and PR2.
```bash
npm run typecheck
npx vitest run tests/unit/capital-region-scaling.test.ts tests/unit/map-station-markers.test.ts tests/unit/map-flash.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep 'service legend|pending guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --grep @layout
```

### Step 1.6 — A2 candidate publication (TDD)
Files: `src/features/game/animation/turnMomentPresentation.ts`: `lotteryCandidateServiceIds`.
Tests (first): `tests/unit/turn-moment-presentation.test.ts` — same set in flip and settle,
independent of the committed result, empty for ordinary turns, effects off, reduced motion, Skip.
```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts
npm run build
```

### Step 1.7 — A2 candidate overlay (visible)
Files: `mapConfig.ts`, `railwayLayers.ts`, `RailwayMap.tsx`, `clearNetworkVisibility.ts`,
`src/app/GameApp.tsx`: register `lotteryCandidates`, resolve and dedupe feature ids, write the
filter on publication change and `layersRevision`, clear after settle, hide in clear mode.
Tests: **intentional update** `tests/unit/map-station-markers.test.ts:137` — exact 14-layer order
(`lotteryCandidates` after `services`) and empty initial filter. `tests/e2e/lottery.spec.ts`
arrival case keeps its current assertions (it runs under the config's `reducedMotion: "reduce"`
and `rollOnce` returns after the stages, so it cannot observe them). The transient overlay is
asserted in the existing fake-clock test `tests/e2e/ui-pop-turn-moments.spec.ts:624` "lottery flip
and settle keep HUD, highlight, platform, log, upcoming stations and item results behind one
publication": inside its stage loop, the candidate filter equals the deduplicated fixture
candidate `featureId`s in both flip and settle, and is empty after settle.
```bash
npm run typecheck
npx vitest run tests/unit/map-station-markers.test.ts tests/unit/capital-region-scaling.test.ts tests/unit/game-app-turn-moments.test.ts
npm run build
npx playwright test tests/e2e/lottery.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --grep 'lottery flip and settle keep HUD'
npx playwright test tests/e2e/lottery.spec.ts --project=phone-chromium --grep @layout
```

### Step 1.8 — A3 basemap symbol opacity (visible)
Files: `src/features/map/basemapLabels.ts` (new, pure); `RailwayMap.tsx` applies patches once per
fresh style before app layers are added.
Tests (first): `tests/unit/basemap-labels.test.ts` (new, synthetic layers): omitted default,
constant, data expression, top-level zoom expression (incl. `let`), skipped value, replacement
style uses its own baseline, non-symbol layers untouched; expression outputs validated with
MapLibre's style validation. The E2E stub has no symbol layers, so live Liberty labels/icons are
checked manually on desktop and phone.
```bash
npm run typecheck
npx vitest run tests/unit/basemap-labels.test.ts tests/unit/map-helpers.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep 'real Japanese labels'
npm run dev   # manual: overview and station zoom, after a style reload app labels keep full opacity
```

### Step 1.9 — C goal ring, pulse, bubble (visible)
Files: `mapConfig.ts`, `railwayLayers.ts` (gold / 5 px ring); `rollAdjustmentPreview.ts` (export
`createMapCallout`); `src/features/map/goalCallout.ts` (new); `RailwayMap.tsx` (mount/teardown keyed
to the reveal-gated goal coordinate, gameplay only); `src/styles.css` (bubble reuse, pulse
keyframes, `prefers-reduced-motion` off).
Tests: `tests/e2e/map-visual.spec.ts` "30 of 30 return guidance" (extend; filter, rendered marker,
HUD and toast assertions kept): positive gold / 5 px paint, no bubble before publication, exact
「ここに着けばゴール」 after, computed animation `none` under reduced motion. The old checks pin filter
and rendering only (no literal `#b26a00` assert to replace). `clear-replay-share.spec.ts:734`
keeps its goal-ring assertion. `roll-adjustment-preview.test.ts` keeps shell coverage.
```bash
npm run typecheck
npx vitest run tests/unit/roll-adjustment-preview.test.ts tests/unit/map-station-markers.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep '30 of 30 return guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --grep @layout
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=desktop-chromium --grep 'keeps the goal ring'
```

### Step 1.10 — B2 report and PR1 records (docs)
Files: `docs/manual/map-readability/colour-vision.md` (new, Japanese, after visuals are final);
`.claude/docs/DESIGN.md` rows R1, R2 (section 6) recorded by the lead via `/design-tracker`.
```bash
git diff --check
test -s docs/manual/map-readability/colour-vision.md
npm run typecheck && npm test && npm run build
wc -l src/features/map/RailwayMap.tsx   # <= 800
npx playwright test --project=phone-chromium --grep @layout
```

## 4. PR2 steps (`feature/replay-camera-strip`, from post-PR1 `develop`)

| Step | Title | Visible | LOC (impl + test) |
|---|---|---|---|
| 2.1 | Store seek/step + `turnCount`, `seekRevision` (TDD) | no | ~100 + 85 |
| 2.2 | Store `cardExpanded` + `showResults` (TDD) | no | ~40 + 45 |
| 2.3 | Turn span destination + `clearReplayTurnBounds` (TDD) | no | ~65 + 65 |
| 2.4 | `useClearReplayCamera`: per-turn framing + manual lock | **yes** | ~125 + 70 |
| 2.5 | Bottom strip on desktop and phone, 「結果を表示」 | **yes** | ~95 + 100 |
| 2.6 | Seek bar + 前/次 buttons | **yes** | ~65 + 65 |
| 2.7 | PR2 DESIGN rows | no (docs) | ~15 + 0 |

### Step 2.1 — Atomic replay seek and step
Files: `src/features/game/clearReplayStore.ts`: clamped finite seek, one-turn step, `turnCount`,
`seekRevision`; seek resets the clock anchor (`atElapsed(recordIndex × turnDuration)`), invalidates
pending callbacks, publishes route prefix, marker and caption in one transition; seek/step keep
the play state (playing continues from the new turn, paused stays paused, `done` goes to paused at
the chosen turn); 前 from `done` selects the first real turn; reduced motion stays instant.
Tests (first): `tests/unit/clear-replay.test.ts` — empty timeline/spans, out-of-range and
non-finite input, same-turn seek bumps revision, seek while playing keeps playing from the new
turn, seek while paused stays paused, seek/step from done lands paused at the chosen turn, 前 from
done selects the first real turn, stale queued frame, speed/resume continuity.
```bash
npm run typecheck
npx vitest run tests/unit/clear-replay.test.ts tests/unit/clear-replay-marker.test.ts
npm run build
```

### Step 2.2 — Replay results state
Files: `clearReplayStore.ts`: `cardExpanded`, `showResults()`. Ordinary replay starts collapsed;
natural end and `finish()` keep it collapsed with the full route; `showResults()` expands; reduced
motion starts and stays expanded. `setReducedMotion(true)` during a collapsed playing/paused
replay publishes `done`, the full route and `cardExpanded: true` together (today it only calls
`finish()`, `clearReplayStore.ts:305`). Consumed by the screen in 2.5.
Tests (first): `clear-replay.test.ts` — card state at start, pause, natural end, finish,
showResults, restart, reduced motion at start, and reduced motion switched on during playback;
full-route assertions kept.
```bash
npm run typecheck
npx vitest run tests/unit/clear-replay.test.ts tests/unit/clear-replay-controls.test.ts
npm run build
```

### Step 2.3 — Bounds for a saved turn
Files: `src/features/game/clearResult.ts`, `clearRoute.ts` (optional `destination` from the
validated traversal), `src/features/map/clearRouteCamera.ts` (`clearReplayTurnBounds`).
Tests (first): `clear-route-map.test.ts`, `clear-route.test.ts` — bend beyond endpoints, empty
turn with and without destination, propagation from a saved traversal; full-route fixtures kept.
```bash
npm run typecheck
npx vitest run tests/unit/clear-route-map.test.ts tests/unit/clear-route.test.ts tests/unit/clear-route-real-data.test.ts
npm run build
```

### Step 2.4 — Per-turn framing and manual lock (visible)
Files: `src/features/map/useClearReplayCamera.ts` (new) takes camera ownership from
`useClearRouteMap.ts` (route-layer lifecycle stays there). Behaviour per section 2 D1.
Tests: `clear-route-map.test.ts` — turn/layout scheduling, user vs programmatic events, same-turn
explicit fit under lock, completion beats stale work. `clear-replay-share.spec.ts:698` (fake-clock
case, extended): automatic framing, manual pan survives a turn change, full-route finish; prefix,
caption, replay-again assertions kept. **Intentional update** `clear-replay-share.spec.ts:882`: the
"whole accumulated prefix fits above the band" check becomes "the active turn fits above the band";
complete-route framing after finish stays asserted.
```bash
npm run typecheck
npx vitest run tests/unit/clear-route-map.test.ts tests/unit/clear-replay.test.ts
npm run build
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=desktop-chromium --grep 'keeps the caption and partial route|draws the full route|reduced-motion replay'
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --grep @layout
```

### Step 2.5 — Collapse both layouts; explicit results (visible)
Files: `ClearScreen.tsx`, `ClearReplayControls.tsx`, `clearScreen.css`: strip driven by
`cardExpanded` on desktop and phone; 全経路を表示 stays a full-route action in the strip;
「結果を表示」 while paused/done; the 「移動履歴を見る」 trigger sits on the desktop strip only (the phone
strip keeps today's behaviour: no history trigger during playback), the strip stays behind the
history dialog across resize; pause-on-history (desktop) and focus return kept; focus hand-off per section 2 D2 (reuses
the phone logic at `ClearScreen.tsx:139-160`, `hidden` + `inert` + `aria-hidden`).
Tests (intentional updates in `tests/e2e/clear-replay-share.spec.ts`, none weakened):
- `:951` "leaves the desktop clear card expanded during replay" → renamed **"uses a bottom strip
  on desktop and expands results explicitly"**: desktop strip bottom-aligned, controls usable,
  the strip's 「移動履歴を見る」 trigger visible and reachable (positive check, desktop only),
  result actions hidden; after 「結果を表示」 the centred card and share action.
- `:896` (inside the 320/390 px case `:882`) **stays as is**: the phone strip has no history
  trigger during playback, so the zero-count assertion for 「移動履歴を見る」 and the other
  hidden-content assertions (content, heading, 結果をコピー) are not replaced.
- `:939` "restores the phone sheet when replay ends naturally" → strip persists, full route framed
  above it, explicit 「結果を表示」 restores the capped sheet and refits.
- Phone finish / restart / speed cases: full route and strip persist after 全経路を表示, then enter
  results explicitly before restart; band height, bottom gap, rows, focus, speed persistence kept.
- Desktop fake-clock case `:698` and desktop speed case `:765`: click 「結果を表示」 after 全経路を表示
  before each `startReplay()` call (the helper clicks 「軌跡を再生」, which lives in the results card);
  caption reset, route-prefix and speed-persistence assertions kept.
- `:968` history across resize: opened from the desktop strip's trigger, stays paused/open across
  the resize to phone (where no trigger exists), strip collapsed behind, focus returns to the
  surviving strip control (再開); time advances only after resume (kept).
- `:1257` "while the replay runs" share: pause → 「結果を表示」 → share; full-route assertion and
  recorded share call kept. Opt-in screenshots `:986`, `:1004` updated for the new states.
- Reduced-motion case `:1035`: instant full route, card stays expanded.
`tests/unit/clear-replay-controls.test.ts`: paused / done / expanded control sets.
```bash
npm run typecheck
npx vitest run tests/unit/clear-replay.test.ts tests/unit/clear-replay-controls.test.ts tests/unit/clear-screen.test.ts
npm run build
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --grep @layout
```

### Step 2.6 — Seek bar and turn buttons (visible)
Files: `ClearReplayControls.tsx`, `clearScreen.css`: labelled native range (one-based turns,
real-turn endpoints), 前/次 buttons, disabled at the bounds, reachable in the 320 px strip (the
phone strip has no history trigger, so no extra crowding); input seeks without changing the play
state (playing continues, paused stays paused, `done` becomes paused at the chosen turn); 前 from
the completed view selects the first turn; the completed view is distinct from a seek to the final turn.
Tests: `clear-replay-controls.test.ts` (endpoints, labels, availability incl. `done`, 前 from `done` targets
the first turn); `clear-replay-share.spec.ts:698` extended: seek under manual lock and one prev/next
step — caption and prefix change together, one reframe per seek, replay keeps running after a seek
while playing and stays paused after a seek while paused, lock respected until completion;
the 320/390 px strip measurements (`:882`) include the new controls.
```bash
npm run typecheck
npx vitest run tests/unit/clear-replay-controls.test.ts tests/unit/clear-replay.test.ts tests/unit/clear-route-map.test.ts
npm run build
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=desktop-chromium --grep 'keeps the caption and partial route|uses a bottom strip on desktop and expands results explicitly'
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --grep @layout
```

### Step 2.7 — PR2 records (docs)
Files: `.claude/docs/DESIGN.md` rows R3, R4 via `/design-tracker`.
```bash
git diff --check
npm run typecheck && npm test && npm run build
npx playwright test --project=phone-chromium --grep @layout
```

## 5. PR3 steps (`feature/shared-track-offsets`, from post-PR2 `develop`)

| Step | Title | Visible | LOC (impl + test) |
|---|---|---|---|
| 3.1 | Exact shared-edge index (TDD) | no | ~75 + 60 |
| 3.2 | Run orientation + stable slots (TDD) | no | ~100 + 75 |
| 3.3 | Fragment emission `buildCorridorOffsets` (TDD) | no | ~85 + 55 |
| 3.4 | Derived source for three layers + `line-offset` | **yes** | ~75 + 70 |
| 3.5 | Measurement gate | no | ~50 + 0 |
| 3.6 | PR3 DESIGN row | no (docs) | ~10 + 0 |

### Step 3.1 — Exact shared-edge index
Files: `src/features/map/corridorOffsets.ts` (new): undirected edges keyed by exact endpoint
coordinates, original feature + traversal references kept, ownership by distinct `serviceId`,
degenerate edges non-matchable, input immutable.
Tests (first): `tests/unit/corridor-offsets.test.ts` (new) — identical and reversed edges, one
service with duplicate edges, near-parallel (non-identical) coordinates not matched, degenerate
edge, partly shared feature.
```bash
npm run typecheck
npx vitest run tests/unit/corridor-offsets.test.ts
npm run build
```

### Step 3.2 — Orient runs, assign stable slots
Files: `corridorOffsets.ts`: deterministic run walk with sorted tie-break at branches/loops;
centred fresh groups; target at 0; continuing services keep compatible slots.
Tests (first): curved continuation, reversed traversal, entry/exit, branch or loop, input-order
independence, target at 0.
```bash
npm run typecheck
npx vitest run tests/unit/corridor-offsets.test.ts
npm run build
```

### Step 3.3 — Emit render fragments
Files: `corridorOffsets.ts`: `buildCorridorOffsets` splits on feature boundaries, shared/unshared
transitions and slot changes; consistent orientation; intermediate vertices kept; unique top-level
ids; `properties.featureId/lineId/serviceId` kept; unshared and target fragments at 0.
Tests (first): partial splits, curved-run joins, zero-slot unshared/target, unique ids, a
cross-service primitive reference matching all its fragments via `featureId`.
```bash
npm run typecheck
npx vitest run tests/unit/corridor-offsets.test.ts tests/unit/capital-region-scaling.test.ts
npm run build
```

### Step 3.4 — Feed offsets to the three service layers (visible)
Files: `RailwayMap.tsx` (memo by geometry identity + target), `mapConfig.ts` (derived source id,
railway-source error classification), `railwayLayers.ts` (source for `services`, `currentService`,
`lotteryCandidates`; one shared offset expression, 0 through z11 → slot × spacing at z13;
fallback to canonical source).
Tests: **intentional update** `tests/unit/capital-region-scaling.test.ts:169` — the blanket
`not.toHaveProperty("line-offset")` becomes positive checks: the three consumers read the derived
source and carry the offset expression; 0 at low zoom; 0 for missing/zero slot; nonzero signed at
z13; base/progress/flash keep the canonical source and no `line-offset`. Cross-owner `featureId`
filter and highlight colour assertions kept. `map-station-markers.test.ts` keeps the 14-layer
order. Optional: a rendered-feature check in an existing map-visual case if the fixture exposes
東海道線 and 横須賀線 on one run deterministically.
```bash
npm run typecheck
npx vitest run tests/unit/corridor-offsets.test.ts tests/unit/capital-region-scaling.test.ts tests/unit/map-station-markers.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts tests/e2e/lottery.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/map-visual.spec.ts tests/e2e/lottery.spec.ts --project=phone-chromium --grep @layout
npm run dev   # manual: 東海道/横須賀 at z11 and z13, 5-deep corridor, run ends, ride + lottery emphasis, hidden group keeps slots
```

### Step 3.5 — Measurement gate
Files: `scripts/perf/measure-map.mjs` reports canonical and derived feature counts and
synchronous derivation time (perf harness only; no production logging). Capture the PR3 base SHA
before 3.4 and benchmark it from a separate checkout.
Thresholds: derived count ≤ 2 × canonical (≤ 3,876); cold derivation median ≤ 50 ms, max ≤ 100 ms
on the benchmark host; median move-frame P50 over 5 runs ≤ baseline + 2 ms on desktop and mobile
profiles. A failing threshold blocks the merge until profiled and fixed.
```bash
npm run typecheck
npm run perf:map -- --runs 5 --tiles stub --profiles desktop,mobile --browser chromium
git diff --exit-code develop -- public/data
```

### Step 3.6 — PR3 record (docs)
Files: `.claude/docs/DESIGN.md` row R5 via `/design-tracker`; measured figures in the PR body.
```bash
git diff --check
npm run typecheck && npm test && npm run build
npx playwright test --project=phone-chromium --grep @layout
git diff --exit-code develop -- public/data
```

## 6. DESIGN.md Key Decisions rows (proposed; the lead records them)

| # | Decision | Rationale | Rejected alternatives |
|---|---|---|---|
| R1 (PR1) | Issue #72 map focus: background services are thin (~2 px) and ~30% opacity on the gameplay map, always on (the title map keeps its current width 3 / opacity 0.75 paint); the legend stays. Presented lottery stages (`lottery-flip`/`lottery-settle`) emphasise the public candidate set on a layer between background and current service; none when the stage is not shown. Basemap symbol text/icon opacity is scaled down from each style's own values (14 layers) (2026-11-26) | Yamanote and the current ride read first while network, place names and the published choices stay legible; reveal gating unchanged | Focus toggle; candidate line-code labels on the map; a current-position badge; colour changes |
| R2 (PR1) | Issue #72 goal guidance supersedes the goal-ring parts of the #62 map-guidance row (2026-11-10) and Step 5 row (2026-11-11): after 30/30 新橋 gets a thick gold ring, a slow CSS-pulsed DOM halo and a 「ここに着けばゴール」 bubble (roll-adjust bubble shell); reduced motion shows the static ring and bubble; the clear map keeps the static ring (2026-11-26) | Weight, shape and text make the destination unmistakable; the DOM pulse adds no per-frame MapLibre writes (#62 Step 4b finding) | Thin #b26a00 ring only; a red ring (reads as a second player); a per-frame paint-property pulse |
| R3 (PR2) | Issue #72 replay camera supersedes the camera choice of the #69 trajectory-replay row (2026-11-22): replay frames each saved turn; a manual pan/zoom keeps the player's view; seek and 前/次 reframe once and keep the play state (playing continues, paused stays paused, done goes to paused; 前 from done selects the first turn); the end frames the full route; reduced motion shows the full route immediately (2026-11-26) | Shows where each move happened while respecting the player's manual view | Fixed full-route camera through playback; continuous marker following |
| R4 (PR2) | Issue #72 replay strip supersedes the card behaviour of the #69 S4b/S5b row (2026-11-24, "expands on natural end … desktop is unchanged"): desktop and phone collapse to a bottom seek-bar strip (range, 前/次, pause/resume, speed, 全経路を表示, plus 「移動履歴を見る」 on desktop only) during replay and keep it after pause, natural end or 全経路を表示; only 「結果を表示」 restores the centred card / phone sheet (2026-11-26) | The map stays visible through playback and scrubbing; the player chooses when to see results | Expanded desktop card during replay; automatic expansion at natural end or finish; a left sidebar |
| R5 (PR3) | Issue #72 shared track supersedes the dropped 23-ward uniform `line-offset: 4`: a runtime-derived render source offsets services on exactly shared edges (identical coordinates) with stable slots, Yamanote at 0, zoom-gated (0 ≤ z11 → full at z13), used by background, current-service and lottery layers only; published geometry and `dataVersion` unchanged; marker may sit a few px off an offset line (2026-11-26) | Separates overlapping services incl. reversed and partially shared features without touching saves or movement geometry | Uniform feature-wide offset; near-parallel (tolerance) matching; pipeline-generated offset geometry |

## 7. Risks

- **PR1**: Liberty's real opacity expressions may differ from synthetic fixtures (verify live
  tiles; skip untransformable values). Candidate overlay must follow public stage transitions and
  style re-registration. Goal markers must tear down on goal, map and mode changes. A pure move
  that silently reorders effects (review move diffs against originals).
- **PR2**: resize/card transitions race with gestures and completion (pending-fit priority unit
  tests + one fake-clock browser scenario). Focus and reachability at 320 px and landscape. Many
  intentional E2E updates in one spec — each replacement must be positive, not looser.
- **PR3**: seams at shared-run ends; derived geometry raises worker load (thresholds in 3.5);
  slot flips at branches (deterministic tie-break tests); marker drift accepted by the user.
- Blast radius: map rendering and the clear screen only; no data, save or rule change.

## 8. Defaults confirmed by the user (2026-11-26)

These replace the Codex defaults the plan was validated with.

- A1 focus paint applies to the gameplay map only; the title map keeps today's
  railway-services paint (width 3, opacity 0.75). The clear screen keeps whatever
  `clearNetworkVisibility.ts` already does.
- 前 from the completed (done / full-route) view selects the first real turn (record index of the first turn).
- Seeking or stepping does not pause playback: playing keeps playing from the new turn, paused
  stays paused, and from done it goes to paused at the chosen turn.
- The 「移動履歴を見る」 trigger sits on the strip on desktop only; the phone strip has no history
  trigger during playback (today's behaviour). The trigger still pauses replay as now.

## 9. Validation

Codex Sol (low effort, read-only), three rounds; static review only (no Playwright/Vitest run).

| Round | Verdict | Response | Changes applied |
|---|---|---|---|
| 1 | NEEDS_REVISION | `.claude/logs/codex/20261126T133802Z-map-readability-validate-1.md` | 1.7 overlay assertions moved to `ui-pop-turn-moments.spec.ts:624` (+ gate); 2.2 `setReducedMotion(true)` during playback; 2.5 `:896` history assertion replacement and renamed desktop case; 2.6 grep |
| 2 | NEEDS_REVISION | `.claude/logs/codex/20261126T134027Z-map-readability-validate-2.md` | 2.5 desktop finish → 「結果を表示」 → restart in `:698` and `:765` |
| 3 | **PASS** | `.claude/logs/codex/20261126T134135Z-map-readability-validate-3.md` | none |

Final verdict (round 3, quoted): "**PASS.** Revised Step 2.5 resolves the round-2 blocker. The
change is consistent with the brief's requirement that the results card reopen only through
「結果を表示」." Remaining blocking issues: "None found in the read-only review. Playwright and
Vitest were not run." Product questions raised by Codex: none (section 8 defaults accepted).

Post-PASS revision (2026-11-26): sections 2, 3 (Step 1.5), 4 (Steps 2.1, 2.5, 2.6), 6 (R1, R3, R4) and 8 were
updated for the four user default changes. No new Codex validation round was run on the revision.
