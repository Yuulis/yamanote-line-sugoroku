## Feature Brief: Issue #62 map guidance and direction

Branch: `feature/map-guidance` from `origin/develop` 33ff82c (v0.13.1 + release docs).
Codebase scan: `.claude/docs/research/feature-map-guidance-and-direction-codebase.md` (all path:line references below come from it).

### Current State
- Architecture: React + TypeScript + MapLibre GL JS client; pure engine under `src/features/game/engine/` (RNG, movement, landing, save v4); presentation-only layers (`presentation.ts`, `turnDisplay` from `deriveTurnMomentDisplay()`, HUD `GameHud.tsx`, `TargetProgressBar.tsx`, toast host, map layers in `src/features/map/railwayLayers.ts` / `mapConfig.ts` / `progressStyle.ts`). Public data under `public/data/` is produced by the Python pipeline (`uv run python -m scripts.data_pipeline.build`, then `... .validate`) from `data/overrides/**`.
- Relevant files: `data/overrides/services.json`, `scripts/data_pipeline/validate.py`, `public/data/{services,manifest}.json`, `src/features/game/presentation.ts`, `src/features/game/components/{GamePanel,GameHud,TargetProgressBar,RollAdjustment}.tsx`, `src/features/map/{railwayLayers,mapConfig,progressStyle}.ts`, `src/features/game/engine/{movement,proximity}.ts` (read-only use), `tests/e2e/support/app.ts`, `tests/e2e/fixtures/regenerate-saves.ts`.
- Patterns: map state must be derived from the reveal-gated `turnDisplay` (never raw `game`) so nothing is revealed before its moment (DESIGN 2026-11-03); new map layers/images re-added on `style.load`; HUD keeps constant row heights and the phone panel cap (#70 decisions); short labels use PhraseText; toasts are visual-only, max 3.

### Feature Goal
The map alone tells the player where they are heading, which Yamanote segments remain, and — after 30/30 — that only arriving at 新橋 remains; the HUD "進行方向" always names the real terminus; when using the roll-adjust ticket the player sees on the map where each choice lands.

### Scope
- Include:
  1. Data fix: the 10 東京近郊版 JR services whose `directionLabels` do not equal `<terminus>方面` (fix in `data/overrides/services.json`, rebuild public data). New validator rule in `validate.py` `check_services`: every non-circular service's direction label equals `<terminus station name>方面` (terminus = area/service end; user decision 2026-11-10). Exempt circular services; do not apply to the frozen 1都3県 baseline.
  2. 30/30 guidance: when all 30 target segments are complete (reveal-gated), the progress bar area is replaced by text such as 「あとは新橋に着けばクリア」, 新橋 is highlighted on the map, and a one-time toast announces it (key scheme compatible with #65 milestones).
  3. Pending-segment emphasis: unvisited Yamanote segments get a colour clearly distinct from the basemap (not grey `#8a8a8a`), keeping the solid-vs-dashed distinction (non-colour cue, #72 policy). Optional "next segment" emphasis — Codex picks the definition (scan §Sub-item 3 lists options).
  4. Marker heading: the current-position marker shows its travel direction (beak/arrow), bearing = current station → next station in the current direction, derived from the same `turnDisplay` input as the HUD direction so HUD and map always agree.
  5. Roll-adjust destination preview: while choosing −1 / そのまま / +1, show on the map a speech-bubble callout at each candidate landing station with the step count (and station name as appropriate). Landing computed by the pure `advance(position, roll±1, network)` without RNG. The dialog must be positioned so the map (marker + candidates) stays visible; the map camera frames the current position and candidates. Phone behaviour must be designed: lead's proposal is a compact bottom strip (roll + three buttons) with the camera fitted to the visible area above it, optionally tapping a callout to choose. Codex decides with rationale.
- Exclude: line de-emphasis / non-colour line identification and line-code badge next to the marker (#72 — design the marker so a badge can be added later); phone panel covering the map in general (#71); engine rules, RNG, save schema or SAVE_VERSION; new dependencies; release/version bump.

### Decisions already made (user, 2026-11-10)
- All of #62 in one PR, step-by-step with a stop after every step; implementer Codex Luna xhigh, reviews Codex Sol low, lead verifies.
- Direction label rule: every service shows "<terminus>方面"; terminus at area or service end uses that station name.
- Roll-adjust: map speech-bubble callouts with step counts; dialog repositioned so the map is visible; phone layout to be proposed.
- Save compatibility: in-progress saves from the old dataVersion may be rejected (existing 「路線データが更新されたため…」 path). No migration/allow-list. Regenerate pinned save fixtures with `tests/e2e/fixtures/regenerate-saves.ts`.
- `product_suburban verify` S4 hash pins: do not edit the command; record in the handoff doc and DESIGN.md that #62 superseded the S4 label output.
- Keep test scope lean (prior features: Codex validation rounds inflated 400–750 LOC plans to 1,445–2,220 LOC). Local E2E per step is targeted specs only; full 4-browser matrix is CI.

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: 40-47 touched paths incl. ~7 regenerated data/fixture files (Codex corrected the lead's 20-25)
- Estimated LOC: 785-1,100 handwritten incl. tests, 12 units of ≤150 LOC (excluding regenerated fixtures/data)
- Implementation route: step-by-step Codex Luna xhigh per step, Sol low review, lead verification (team-execute equivalent, sequential per user pacing)

### Integration Points
- `data/overrides/services.json` → pipeline build → `public/data/services.json` + `manifest.json` (`dataVersion` changes) → `save.ts` data-version check.
- `turnDisplay` (`deriveTurnMomentDisplay`) → HUD direction, marker bearing, pending/next segment filters, 30/30 state, 新橋 highlight.
- `RollAdjustment.tsx` dialog (currently `showModal()`, map inert) → candidate landings via engine `advance` → new map callout layer/markers → camera framing.
- Toast host → 30/30 one-time toast keyed so restore/replay does not re-fire it.

### Risks
- Save invalidation (accepted by user): note it in the release note.
- Immutable classic v4 save fixture (`product-data.test.ts:242`, `save-errors.spec.ts:138`) now fails with `DATA_VERSION_MISMATCH` before `CONFIG_MISMATCH`: needs a stated handling that keeps the test meaningful.
- Reveal leaks (heading, next segment, 30/30, 新橋) if raw `game` is used.
- Map layer contract: E2E helpers assume the marker is a single-Point `circle` layer; style reload re-adds layers; glyph fixtures limit text labels (SDF `addImage` avoids glyph regeneration; callout text may need glyph ranges or HTML markers).
- HUD row height and phone panel cap (#70) when replacing the bar with text.
- Map performance: per-frame marker `setData` is fine; filters must update on reveal-state change, not per frame.

### Success Criteria
- `uv run python -m scripts.data_pipeline.validate` passes with the new terminus rule; all 東京近郊版 services' labels equal `<terminus>方面`.
- HUD "進行方向" and the marker heading agree in every tested state (Yamanote, other lines, after lottery reveal).
- After 30/30 the HUD shows the 新橋 guidance text, 新橋 is highlighted, and the toast fires once.
- During roll-adjust, each candidate landing is visible on the map with its step count, on desktop and phone viewports, without the dialog hiding them.
- `npm run typecheck`, vitest, build, ruff/ty/pytest, targeted E2E pass locally; CI green.
