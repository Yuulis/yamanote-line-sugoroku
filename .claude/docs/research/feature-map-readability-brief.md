## Feature Brief: Issue #72 map readability (route emphasis, non-colour identification, goal emphasis, replay camera and seek bar, shared-track offsets)

### Current State
- Architecture: MapLibre GL JS map in `src/features/map/*` (`RailwayMap.tsx` 1,022 lines, `railwayLayers.ts`, `mapConfig.ts`, `headingMarker.ts`, `rollAdjustmentPreview.ts`, `useClearRouteMap.ts`); game UI in `src/features/game/components/*` (`GameApp.tsx`, `ClearScreen.tsx`, `LotteryReveal.tsx`, `LineBadge.tsx`, `lineBadge.ts`); turn-moment animation in `src/features/game/animation/*`; data in `public/data/*` (per-service geometry, `segments.geojson` hashed into `dataVersion`).
- Relevant files: see `.claude/docs/research/feature-map-readability-codebase.md` (full scan with file:line references).
- Patterns:
  - All 134 non-Yamanote groups share one layer `railway-services` (width 3, opacity 0.75, no zoom interpolation).
  - The current ride is a width-7 highlight layer. Yamanote pending segments use magenta dashes over a white casing (#62).
  - The current position is a red circle layer plus a DOM heading beak.
  - The goal ring `railway-goal-station` is a thin #b26a00 stroke. Roll-adjust speech bubbles are DOM markers.
  - Clear replay is driven by an external store and fits `route.bounds` once. The phone card collapses to a control band while playing or paused; the desktop card stays centred.
  - Lottery candidates come from `session.lastMove.landing.serviceCandidates` and are public during `lottery-flip`/`lottery-settle`.
  - The basemap is OpenFreeMap Liberty (remote). The E2E stub style has no symbol layers.

### Feature Goal
On first sight the board (Yamanote loop and the current line) reads as the protagonist. Lines stay identifiable without relying on colour alone. The goal 新橋 is unmistakable after 30/30. The clear replay shows where each move happened. Lines sharing the same track no longer hide each other.

### Scope
- Include:
  - **A1 Focus style, always on, no toggle** (user 2026-11-26). Lines other than the current ride and Yamanote draw thinner and faded (about 30% opacity). The existing per-line legend still works, so enthusiasts can show or hide lines.
    - **A2 Lottery emphasis** (user 2026-11-26). Only while the lottery stages (`lottery-flip`/`lottery-settle`) are presented, the candidate lines are emphasised. When no lottery stage is shown (effects off, reduced motion, skip), there is no emphasis.
  - **A3 Basemap labels faded** (user 2026-11-26). Basemap symbol layers (place names and icons) get lower text/icon opacity while staying readable.
  - **B2 Colour-vision check of the palette, report only** (user). Results go to a `docs/manual/` page, and official colours are not changed.
  - **C Goal emphasis after 30/30** (user). A thick gold ring that pulses slowly, with the pulse off under reduced motion, plus a 「ここに着けばゴール」 speech bubble reusing the roll-adjust bubble pattern.
  - **D1 Replay camera follows per turn** (user). Zoom to each turn's path. After the end, return to the full-route view.
  - **D1b Manual map interaction during replay** (user 2026-11-26). Once the player pans or zooms by hand, the manual view is kept. The camera re-frames only on an explicit turn change (seek or prev/next) and at the end.
  - **D2 HUD during replay** (user). While playing, the clear card collapses to a thin seek-bar strip at the bottom of the map, on desktop as well as phone. The seek bar is draggable to jump to a turn, and previous/next buttons step one turn. While paused and after the end, a 「結果を表示」-style button appears, and only pressing it brings the card back to the centre; it does not return by itself.
  - **E Shared-track offsets** (user: exactly shared sections only). Draw services that share identical coordinates side by side using offsets, only from a moderate zoom up. Yamanote stays on the centre line. The offsets are a render-only runtime derivation and must not change the published data or `dataVersion`. The moving marker may sit a few px off an offset line, which the user accepts.
- Exclude:
  - A badge next to the current-position marker. The user explicitly declined it (2026-11-26).
  - Line-code labels on the map for lottery candidates (B1). The user declined these (2026-11-26); non-colour identification stays the HUD/lottery-board badges plus the colour-vision report.
  - A focus-style toggle in the menu.
  - Changing official line colours.
  - Offsetting near-parallel (non-identical) tracks.
  - Pipeline or data changes that would bump `dataVersion`.
  - Yamanote pending-segment styling (#62, already done).

### Complexity Classification (from Codex)
- Classification: COMPLEX (Codex Sol low scope consult, 2026-11-26; response .claude/logs/codex/20261126T132230Z-map-readability-scope.md)
- Estimated files: roughly 30 source and test files across the items, with overlap
- Estimated LOC: about 670-1,105 implementation plus 535-900 tests after dropping B1 (Codex estimate 790-1,305 plus 605-1,020 with B1)
- Implementation route: team-execute style, step by step, with the implementer chosen by the user. Proposed split into 3 PRs: PR1 A1-A3 + B2 + C, PR2 D1/D2, PR3 E.

### Integration Points
- `railwayLayers.ts` / `mapConfig.ts`: paint and width changes for focus, the lottery emphasis layer or filter, goal ring style, and offset layers.
- `RailwayMap.tsx`: wiring the lottery stage state and the goal bubble. The file is already over 800 lines, so new logic goes into new hooks or modules.
- `GameApp.tsx` turn-moment state, which decides when lottery candidates are public.
- `useClearRouteMap.ts`, `ClearScreen.tsx`, `clearScreen.css`, and the replay store: per-turn camera, seek or step API, and the collapsed strip layout.
- Basemap style load: restyle the symbol layers after the style loads.
- Data loading of the segment GeoJSON: build the render-only corridor geometry with offsets.

### Risks
- **E algorithm.** 36% of shared edges are traversed in opposite directions, and 282 features are only partly shared. Per-feature `line-offset` cannot separate them, so the render geometry must be split and direction-normalised. Mitigation: a Codex design review, pure tested module, and runtime only.
- **E marker drift.** The marker sits a few px off an offset line. The user accepts this.
- **DESIGN.md conflicts.**
  - The #69 row rejected a following camera and kept the desktop card unchanged. The E2E test at `clear-replay-share.spec.ts:951` asserts a centred desktop card.
  - `capital-region-scaling.test.ts:169` pins the absence of `line-offset`.
  - Mitigation: superseding DESIGN rows, and update those tests deliberately rather than weaken them.
- **Basemap restyle.** The style is remote and the stub has no symbol layers. Mitigation: unit-test the restyle function on a synthetic style.
- **Performance.** More layers or features at 134 groups. Mitigation: measure; keep it data-driven with filters.
- **Reduced motion.** The pulse and the camera easing must respect it.

### Success Criteria
- At game start, non-current non-Yamanote lines render at about 30% opacity and thinner. The current line and Yamanote are unchanged or stronger.
- During presented lottery stages only candidates are emphasised, and the emphasis clears after settle.
- After 30/30 the gold ring and bubble show on 新橋, and the pulse is disabled under reduced motion.
- Replay zooms per turn, and the seek bar plus prev/next buttons jump between turns. The card returns to the centre only via the button, and the full-route view shows at the end.
- On 東海道/横須賀 shared track both lines are visible side by side at the target zoom, and `dataVersion` is unchanged.
- Colour-vision report exists under `docs/manual/`.
- The typecheck, vitest, and build gates pass, the phone @layout E2E passes, and branch CI is green.
