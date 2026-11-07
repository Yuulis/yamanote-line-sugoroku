## Feature Brief: UI pop P2 — turn moments

### Current State
- Architecture: the engine commits the roll, movement, landing lottery (service then direction) and item drop, and saves them, before any animation (`G/itemSession.ts:100-152`, `useGameApp.ts:71-87`). The UI masks the arrival state with an `AnimationView` while `useMoveAnimation` plays hops (`displayedProgress.ts:48-55`). P0 `useRevealSequence` (key `${sessionId}:${recordTurn}`) arms stages only after `movementComplete`; production stages are the empty `NO_REVEAL_STAGES` (`GameApp.tsx:52`, `:107`), and only `ready` (gates toasts) and `skip` are consumed. P1 HUD (`GameHud`, `InventoryPanel`, `GamePanel` coordinator, `ToastHost` outside `.game-panel`).
- Relevant files: `src/app/GameApp.tsx`, `G/animation/useRevealSequence.ts`, `G/animation/useMoveAnimation.ts`, `G/presentation.ts`, `G/hudPresentation.ts` (`compactRollFor` modifier labels), `C/GamePanel.tsx`, `C/GameHud.tsx`, `C/InventoryPanel.tsx`, `C/LineBadge.tsx`, `C/ItemIcon.tsx`, `M/railwayLayers.ts` (`MapProgress`), `M/RailwayMap.tsx`, `M/mapConfig.ts`, `src/styles.css`. Full scan: `.claude/docs/research/feature-ui-pop-turn-moments-codebase.md`.
- Patterns: pure reducers + thin hooks with Vitest table tests and fake timers; jsdom component tests via `tests/unit/helpers/reactDom.ts`; E2E defaults to reduced motion, with motion-enabled specs using `fastForward`; a single live region in the panel; overlays mount outside `.game-panel` (camera padding and ResizeObserver read the panel box).

### Feature Goal
Make each turn feel like a game "moment": the player sees the dice tumble onto the committed roll, the arrival, the lottery result flipping on a departure board, and new items flying into the inventory — without any change to the rules, the RNG, saves or data.

### Scope
- Include:
  - Split-flap (パタパタ) lottery board overlaid at the visible map centre: row 1 line (LineBadge + name), row 2 direction; flips and stops on the committed value, then settles into the HUD ride row; only when a service or direction draw actually happened; no probabilities.
  - Pseudo-3D CSS cube dice tumble landing on the committed raw roll, then modifier stamps (×2, ±1 adjust, 寝過ごし, 遅延, 快速); the movement starts after the tumble (and after the adjust dialog when one is needed).
  - Arrival banner 「〇〇 に到着！」 plus a flash of newly completed Yamanote segments on the map; on the goal turn the banner plays, then ClearScreen.
  - Item pickup animation into the inventory slot; DiscardChoice opens after the pickup animation.
  - A presentation-level "displayed" ride / inventory / decision / announcement mask so the HUD, map highlight, log, candidate list and live region do not reveal results early.
  - Durations scale with the existing 速度 setting (normal ≈ 0.6 + 0.8 + 2.0 s, plus stamps and pickup).
  - The dice button is disabled during post-move reveal stages; tap on the overlay and the existing スキップ button end the reveal; one Skip ends tumble + movement + reveal.
  - Everything is omitted under prefers-reduced-motion and for restored (resumed) results.
  - The known reduced-motion first-commit `busy` issue in `useRevealSequence` is fixed first.
- Exclude: engine/RNG/save/`src/types/network.ts`/`public/data/**` changes; sound; player pawn, clear celebration, title onboarding, item dialog cards, coach marks (P3); dark theme; release work.

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: ~33 (17 production, 16 tests; range 30–36)
- Estimated LOC: 1,400–2,200 added/changed
- Implementation route: team-execute equivalent as per-step Codex delegation — Codex Luna high implements each step, Codex Sol low reviews, the lead verifies; the lead pauses after every step for user review (user lane and pacing preference, as in P0+P1)

### Integration Points
- `useRevealSequence`: conditional production stages (arrival, flash, lottery, pickup) and render-phase reduced-motion completion.
- `useMoveAnimation`: a start gate that keeps the origin-state `AnimationView` while the tumble or adjust dialog runs.
- `GameApp`: one Skip across tumble + movement + reveal; displayed-state mask; ClearScreen and its focus move delayed until the goal banner ends; overlay host outside `.game-panel`.
- `GamePanel` / `GameHud` / `InventoryPanel`: a "presented decision" used for the dialog, live region, toast pause, card close and focus restore; dice disabled during reveal; the pickup target slot is hidden until landing.
- `presentation.ts`: stage-aware single live message.
- Map: a new flash layer and `MapProgress` field; the existing completed-layer filter shape stays.

### Risks
- Double tumble on the adjust path (raw roll exists before the record): key the tumble on the click, not the record; never replay it on resumed `awaiting-adjust`.
- Early result reveal through any of HUD, map highlight, log, candidates, inventory or live region: one derived displayed model, with tests per surface.
- Accessibility and focus: visual parts `aria-hidden`; the overlay never takes focus; the existing スキップ stays the keyboard path; the single live region is kept.
- Resume boundary: the restored result never replays; a new record after resolving a resumed pending adjust plays normally — pinned by tests.
- E2E timing: motion-enabled specs are re-pointed to tumble/move/reveal completion checkpoints, never loosened.
- Phone/landscape layout: the overlay sits at the visible map centre and does not change the `.game-panel` size or block attribution and toasts.
- CSS 3D cost on low-end devices: transform/opacity only; not measured yet.
- MapLibre flash: style reload, Skip and screen change must leave no residue; layer-count assertions are updated to the exact new value.

### Success Criteria
- All four moments play in order at normal speed and scale with 速度; one Skip ends them; the dice is disabled during post-move reveal stages.
- Every displayed value equals the saved engine value (motion-enabled E2E checks the board lands on the saved `landing.serviceId` and direction).
- No surface reveals the lottery or pickup before its stage; reduced motion and resume show results instantly, with no overlay frame.
- Goal turn: banner, then ClearScreen.
- `npm run typecheck`, `npx vitest run`, `npm run build` and the targeted E2E specs pass locally; the full 4-browser E2E passes in CI; no engine/save/data diff.
