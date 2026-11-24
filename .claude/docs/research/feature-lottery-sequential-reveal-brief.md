# Feature Brief: split-flap lottery sequential reveal (issue #63)

Date: 2026-11-24. Codebase scan: `.claude/docs/research/feature-lottery-sequential-reveal-codebase.md`.
Plan: `.claude/docs/plans/lottery-sequential-reveal-plan.md`.

## Feature Brief: route row first, then direction row

### Current State
- Architecture: post-move reveal stages are planned once per record by
  `buildTurnRevealStages` (`src/features/game/animation/turnMoments.ts`) from the
  captured `TurnPresentationPolicy` (`turnMomentPolicy.ts`, per-speed table) and run by
  `useRevealSequence` (one `setTimeout` per stage; the only deadline owner). The lottery
  is two stages, `lottery-flip` (F: 2133 / 1600 / 1067 / 280 ms) and `lottery-settle`
  (533 / 400 / 267 / 100 ms). `LotteryReveal.tsx` is decoration only: both rows flip in
  parallel over F via CSS animations (`src/styles.css` lottery block), result at 0.84·F.
- Relevant files: `src/features/game/animation/turnMomentPolicy.ts`,
  `src/features/game/animation/turnMoments.ts`,
  `src/features/game/components/LotteryReveal.tsx`, `src/styles.css` (lottery block),
  `src/app/GameApp.tsx` (builds the `lottery` prop, unchanged),
  `tests/unit/turn-moments.test.ts`, `tests/unit/turn-moment-policy.test.ts`,
  `tests/unit/turn-moment-components.test.ts`, `tests/e2e/support/turnMoments.ts`,
  `tests/e2e/ui-pop-turn-moments.spec.ts`.
- Patterns: per-speed timing captured at roll time; stage durations are pure data;
  CSS animations driven by inline custom properties (`--lottery-ms`, `--frame-index`);
  deterministic frames from saved candidates (no presentation RNG); CSS regex unit
  tests; E2E durations are independent literals, never imported from `src/**`.
- Leaks today: the direction row cycles only the drawn service's labels, and a
  single-direction service (Yamanote → 外回り) leaves the direction row static from t=0.

### Feature Goal
The route row flips first; the direction row shows a neutral "方向 ？" placeholder until
the route has stopped and only then flips (or snaps to 外回り for a single-direction
service), so neither labels, motion, nor size reveal the route early. Results,
probabilities and save format are unchanged.

### Scope
- Include:
  - Route row keeps today's full flip F per speed.
  - Direction flip window D = round(0.4·F) added after F when both rows draw
    (slow 853 / normal 640 / fast 427 / very-fast 112 ms); settle unchanged.
  - Single-direction service: direction row snaps to its only direction at the route
    stop (0.84·F); the stage stays F (no D).
  - Direction-only draw (service not drawn): direction flips over F from t=0 as today
    (assumption, flagged to the user).
  - Placeholder overlay, sequential CSS timing, 4 direction frames in the D window,
    reduced-motion CSS fallback, E2E `advanceLotteryFlip` helper aware of the longer stage.
  - DESIGN.md decision row.
- Exclude:
  - Roulette variant; Yamanote 1/2 weighting in the split-flap (user decision 5).
  - Map highlight during the lottery (#72), result card persistence (#66).
  - Engine, RNG, probabilities, save format, announcements, publication boundaries,
    new reveal stages, `useRevealSequence`, `GameApp.tsx`, `TurnMomentHost.tsx`.

### Complexity Classification (from Codex)
- Classification: SIMPLE (classified by general-purpose-opus; no Codex consult was run
  because the design reuses the existing stage and CSS-variable patterns and has no
  security, concurrency or data-integrity surface)
- Estimated files: 9 (4 src, 5 tests/e2e support) plus `.claude/docs/DESIGN.md`
- Estimated LOC: 130-180 added/changed (src ~50, tests ~90, docs ~10)
- Implementation route: Sonnet subagent per step, Opus review, pause after every step

### Integration Points
- Stage planner (`buildTurnRevealStages`): `lottery-flip` duration becomes
  `lotteryFlipStageMs(F, draws)` — F + D when both rows draw, else F. Draw flags come
  from the same snapshot test already used (`services.length > 1`,
  `selected.directions.length > 1`), matching `itemSession.ts` landing flags.
- `LotteryReveal`: receives F as today (`GameApp` unchanged) and derives D and row
  windows from the same exported helper, so stage deadline and CSS timing share one
  source.
- Publication, announcements ("抽選結果を表示しています"), Skip, reduced motion,
  effects なし / 重要なときだけ, first-play guide hold: all keyed on stage boundaries or
  `lottery !== null`; they inherit the longer stage with no code change.
- E2E helper `advanceLotteryFlip`: adds an independent 640 ms literal when both board
  rows report `data-drawn="true"`.

### Risks
- E2E specs on the real network (`capital-region`, `dice`, `accessibility`) may land on
  a both-drawn lottery and would stall with a fixed 1600 ms advance: mitigated by the
  DOM-aware helper in step 1.
- Placeholder or hidden result changing row size would hint the route or shift phone
  `lotteryFitScale`: placeholder is an absolute overlay; direction result forced to one
  line.
- Reduced-motion CSS (`animation: none !important`) would leave the placeholder covering
  the result: hide it in the reduced-motion block (board is normally not mounted then).
- CSS real time vs `setTimeout` drift: pre-existing; settle replaces the flip anyway.
- Very-fast direction frames are ~24 ms each: cosmetic, accepted for snappiness.

### Success Criteria
- Before the route stops, the direction row is pixel-identical for a two-direction and a
  single-direction service (placeholder, no visible frames, same size).
- Both drawn: route stops at 0.84·F, direction flips in [F, F + D], settle follows;
  stage durations per speed are 2986 / 2240 / 1494 / 392 ms.
- Single-direction service: direction appears at 0.84·F, stage stays F.
- Direction-only draw and all other stages unchanged; existing stage/publication tests
  pass unmodified apart from the both-drawn duration expectation.
- `npm run typecheck`, `npm test`, `npm run build` and the targeted Playwright runs pass;
  branch CI green.
