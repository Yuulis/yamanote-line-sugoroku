# Plan: split-flap lottery sequential reveal (issue #63)

Date: 2026-11-24. Brief: `.claude/docs/research/feature-lottery-sequential-reveal-brief.md`.
Scan: `.claude/docs/research/feature-lottery-sequential-reveal-codebase.md`.
Branch: `feature/lottery-sequential-reveal` from `develop`; PR to `develop` references
#63 (the release PR carries `Closes #63`).
Execution: one Sonnet subagent per step, Opus review, pause after every step.

## 1. Architecture

### Timing (one source of truth)

F = `timing.lotteryFlipMs` (unchanged table). New in `turnMomentPolicy.ts`:

```ts
/** Direction window after the route row stops, as a share of the route flip (issue #63). */
export const LOTTERY_DIRECTION_FLIP_SHARE = 0.4;
export function lotteryDirectionFlipMs(routeFlipMs: number): number; // Math.round(F * 0.4)
export interface LotteryDraws { readonly serviceDrawRequired: boolean; readonly directionDrawRequired: boolean }
export function lotteryFlipStageMs(routeFlipMs: number, draws: LotteryDraws): number; // (T,T) F + D · (T,F) F · (F,T) D
```

D is derived, not a new `TurnMomentTiming` field, so every `toEqual` on timing rows
(policy, turn-moments, hooks, game-app tests) stays untouched.

| Speed | F | D = round(0.4·F) | Stage, both drawn (F+D) | Settle | Lottery total, both drawn (today) |
|---|---|---|---|---|---|
| ゆっくり | 2133 | 853 | 2986 | 533 | 3519 (2666) |
| ふつう | 1600 | 640 | 2240 | 400 | 2640 (2000) |
| はやい | 1067 | 427 | 1494 | 267 | 1761 (1334) |
| とても速い | 280 | 112 | 392 | 100 | 492 (380) |

Rationale for 0.4: the direction pool is usually 2 labels, so 4 frames suffice; with 4
frames in 0.84·D each frame lasts 179 / 134 / 90 / 24 ms, about 0.8x the route rhythm
(224 / 168 / 112 / 29 ms), so it reads as the same board, not a rushed second one. It
adds +640 ms at ふつう only on landings that draw both. 0.5 (+800 ms) was the
alternative; very-fast stays under 0.5 s.

### Row timeline per case (t = 0 at flip start)

| serviceDraw | directionDraw | Stage | Route row | Direction row |
|---|---|---|---|---|
| true | true | F + D | flip [0, F], result at 0.84·F | placeholder [0, F]; 4 frames over [F, F + 0.84·D]; result at F + 0.84·D |
| true | false (山手線 → 外回り) | F | flip [0, F] | placeholder [0, 0.84·F]; result snaps at 0.84·F (with the route stop) |
| false | true | D | static result | flip [0, D], 4 frames, no placeholder (user decision 2026-11-24: shorter) |
| false | false | no lottery stage | — | — |

Before 0.84·F rows 1 and 2 are indistinguishable: same placeholder, no visible frame,
same size.

### Stage planner (`turnMoments.ts`, ~4 lines)

In `buildTurnRevealStages`, compute `serviceDrawRequired = services.length > 1` and
`directionDrawRequired = selected.directions.length > 1` (the existing `drawsLottery` is
their OR) and push `{ key: "lottery-flip", durationMs: lotteryFlipStageMs(timing.lotteryFlipMs, draws) }`.
No new stage key; `useRevealSequence`, `publicationPhase`, `GameApp`, `TurnMomentHost`
unchanged.

### Component (`LotteryReveal.tsx`)

- `durationMs` keeps today's value from `GameApp` (flip: F; settle: settle ms). Update its
  JSDoc: during flip it is the route window; the stage may last F + D.
- Replace `LotteryRowProps.drawn`-only logic with a row flip model computed in
  `LotteryReveal`:
  `type RowFlip = { kind: "flip"; delayMs: number; windowMs: number } | { kind: "snap"; windowMs: number } | { kind: "static" }`.
  Keep `data-drawn={drawn}` (the E2E helper reads it).
- During `lottery-flip` only: `--flipping` class for `flip`, new `lottery-reveal__row--snap`
  class for `snap`; inline `--row-delay` / `--row-ms` merged with the settle style.
- Direction frames: `DIRECTION_FLIP_FRAME_COUNT = 4` when the direction flips after the
  route; 8 (`FLIP_FRAME_COUNT`) otherwise. Still deterministic from saved candidates.
- Placeholder: `<span className="lottery-reveal__placeholder">方向 ？</span>` in the
  direction row, rendered only when `stage === "lottery-flip"` and the route row is drawn.
  A `span` (not a div) so the `HTMLDivElement` rect spies in tests keep their counts.
  Copy as a named constant `DIRECTION_PLACEHOLDER`.
- `.lottery-reveal__result` keeps the final value in every mode (tests and E2E read it).

### CSS (`src/styles.css` lottery block, ~20 lines)

- `.lottery-reveal__row`: defaults `--row-delay: 0ms; --row-ms: var(--lottery-ms);`.
- `.lottery-reveal__frame`: duration `calc(var(--row-ms) * 0.84 / var(--frame-count))`,
  delay `calc(var(--row-delay) + var(--row-ms) * 0.84 * var(--frame-index) / var(--frame-count))`.
- `.lottery-reveal__row--flipping .lottery-reveal__result`:
  `animation: lottery-result var(--row-ms) steps(1, end) var(--row-delay) both;`
  (`both` = backwards fill, hidden during the delay).
- `.lottery-reveal__row--snap .lottery-reveal__result`:
  `animation: lottery-result var(--row-ms) steps(1, end) both;` (shown at 0.84·F).
- `.lottery-reveal__placeholder`: absolute overlay `inset: 0`, grid centre,
  `padding: inherit`, surface background, muted text, `pointer-events: none`.
  - in `--flipping` rows: `animation: lottery-placeholder var(--row-delay) steps(1, end) both;`
    with `@keyframes lottery-placeholder { 0% { opacity: 1; } 100% { opacity: 0; } }`.
  - in `--snap` rows: `animation: lottery-placeholder-stop var(--row-ms) steps(1, end) both;`
    with `@keyframes lottery-placeholder-stop { 0% { opacity: 1; } 84%, 100% { opacity: 0; } }`.
- Direction result one line: `.lottery-reveal__row:last-of-type .lottery-reveal__result`
  (or a `--direction` modifier) gets `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
  so a long label cannot make the row taller before the route stops.
- Reduced-motion block: add `.lottery-reveal__placeholder { display: none; }`.

### Behaviour checks (no code change expected)

- 重要なときだけ: lottery stages still planned (`showImportantMoments`); longer stage applies.
- なし / reduced motion / restored result: no lottery stage, board never mounts.
- Skip: `skip` ends the sequence at any sub-phase (sub-phases are CSS only).
- Speed change mid-flip: policy and F captured at roll; GameApp reads captured timing.
- Auto-roll: not implemented in `src/` (only a brief exists); a future auto-roll gated on
  the sequence `ready` inherits the longer stage.
- Screen reader: board stays `aria-hidden`; announcement copy unchanged.
- E2E fixtures: the fixture lottery turns are (true, false) and (false, true), both F,
  so `STAGE_MS_BY_SPEED` boundary tests stay valid.

## 2. Steps

### Step 1 — Timing source and stage duration

Files:
- `src/features/game/animation/turnMomentPolicy.ts`: add the share constant,
  `lotteryDirectionFlipMs`, `LotteryDraws`, `lotteryFlipStageMs`.
- `src/features/game/animation/turnMoments.ts`: lottery-flip duration via `lotteryFlipStageMs`.
- `tests/unit/turn-moment-policy.test.ts`: one `it.each` over 4 speeds asserting
  D (853/640/427/112) and `lotteryFlipStageMs` for (T,T)=F+D, (T,F)=F, (F,T)=D.
- `tests/unit/turn-moments.test.ts`: update "plans only actual draws" so the flip
  expectation is F+D / F / D for (T,T) / (T,F) / (F,T) with literal
  direction values per speed (independent literals, no import of the helper).
- `tests/e2e/support/turnMoments.ts`: `NORMAL_STAGE_MS.lotteryDirectionFlip = 640`;
  `advanceLotteryFlip` reads which rows are drawn (`.lottery-reveal__row[data-drawn="true"]`) after
  `awaitStage` and advances F+D / F / D (× factor) per case; the E2E fixture's direction-only
  lottery now finishes after D, so check every caller that assumed F. Update the header
  comment of the helper.

Acceptance:
```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-policy.test.ts tests/unit/turn-moments.test.ts
npm test
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --grep "lottery"
```
Visible effect after this step alone: on a both-drawn landing the board still flips both
rows in parallel and then holds for D before settling (temporary, fixed in step 2).

### Step 2 — Sequential board and placeholder

Files:
- `src/features/game/components/LotteryReveal.tsx`: row flip model, delay/window vars,
  snap class, 4 direction frames in the D window, placeholder span, JSDoc on `durationMs`.
- `src/styles.css`: lottery block changes listed in section 1.
- `tests/unit/turn-moment-components.test.ts`:
  - extend the existing S14 `it.each` (4 cases) with: placeholder "方向 ？" present in
    flip iff `serviceDrawRequired`; direction row class (`--flipping` / `--snap` / none);
    for (T,T) direction row `--row-delay: 1600ms`, `--row-ms: 640ms` and 4 frames; for
    (F,T) `--row-delay: 0ms`, `--row-ms: 1600ms` and 8 frames; no placeholder in settle.
    Adjust the existing `--flipping` expectation for the (T,F) case (direction row is now
    `--snap`, still not `--flipping`, so the assertion stands).
  - one CSS regex test: frame delay uses `--row-delay` + `--row-ms`, flipping result has
    `var(--row-delay) both`, snap result rule, both placeholder rules, placeholder
    `display: none` inside the reduced-motion block.
- `tests/e2e/ui-pop-turn-moments.spec.ts`: one new test reusing `playLotteryToFlip`
  (fixture turn is the snap case): pause every animation in `.lottery-reveal`
  (`getAnimations({ subtree: true })`, pattern from `readSettleLandings` in
  `turn-result-card.spec.ts`), seek to 0.5·F → placeholder opacity 1, direction result
  opacity 0; seek to 0.9·F → placeholder 0, direction result 1. Then resume and finish via
  the existing helpers.

Acceptance:
```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-components.test.ts tests/unit/lottery-board-fit.test.ts
npm test
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --grep "lottery"
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep @layout
```
Manual check by the user (visible change): `npm run dev`, play until a station with two
services each with two directions (e.g. 代々木) and one Yamanote-only draw; screenshots,
if taken, go to `.claude/logs/screenshots/`.
Firefox/WebKit run in PR CI only.

### Step 3 — Design record and PR

Files:
- `.claude/docs/DESIGN.md`: one decision row via `/design-tracker` (sequential reveal,
  D = 0.4·F, snap at route stop, direction-only draw behaviour, placeholder copy); note
  that the "抽選 2.0秒" wording at ふつう now applies to single-row draws.
- PR `feature/lottery-sequential-reveal` → `develop`, body references #63 and lists the
  timing table; note `text-wrapping.spec.ts` evidence screenshot now shows the placeholder.

Acceptance:
```bash
git diff --stat develop...HEAD
python3 .claude/skills/_shared/verify_delegation.py --base develop --forbid-outside src --forbid-outside tests --forbid-outside .claude/docs --label lottery-sequential
gh pr checks <pr>   # full matrix green, including WebKit shards
```

## 3. Per-step test list (summary)

| Step | New / changed tests |
|---|---|
| 1 | policy D + stage ms per speed (new `it.each`); turn-moments draw-matrix expectation (changed); E2E helper (support code, no new spec) |
| 2 | S14 LotteryReveal `it.each` extended; 1 CSS regex test; 1 E2E seek test (snap path) |
| 3 | none |

Unchanged and expected green: stage-keyed suites (`game-app-turn-moments`,
`turn-moment-hooks`, `turn-moment-presentation`, `turn-result-publication`, …), E2E stage
boundary specs, phone `@layout`.

## 4. Risks

- Real-network E2E both-drawn landing stalls with a fixed advance → step 1 helper reads
  `data-drawn`. If a unit fixture in `game-app-turn-moments` reaches a both-drawn landing,
  `finishLotteryIfPresented` (advance 1600) must add 640; the implementer fixes it only if
  vitest shows it.
- Row size leak or phone fit-scale drift → absolute placeholder, one-line direction result;
  phone `@layout` run in step 2.
- Reduced-motion fallback hides the result under the placeholder → explicit
  `display: none` rule plus regex test.
- The (T,T) visual path is not covered by an E2E fixture (fixture lotteries are (T,F)
  and (F,T)) → unit tests on vars/classes, CSS regex, and the user's manual check.
- Very-fast direction frames (~24 ms) may drop on 60 Hz displays → cosmetic.

## 5. Open questions and assumptions for the user

- A1 (DECIDED 2026-11-24): direction-only draw (`serviceDrawRequired=false`) gets the
  shorter stage D; the direction row flips over [0, D] with 4 frames, no placeholder.
- A2 (DECIDED): D = round(0.4·F) (ふつう +640 ms, とても速い +112 ms).
- A3 (DECIDED): placeholder copy "方向 ？".
- A4: the single-direction snap happens at the route stop (0.84·F), so 外回り is visible
  for the last 0.16·F of the flip plus the settle, and the stage stays F.
- A5: the direction row uses 4 frames in its D window (both-drawn and direction-only cases).

## 6. Handoff status

| Step | Status | Commit | Verification |
|---|---|---|---|
| 1 Timing source and stage duration | done (lead verified) | 4f80e3a | lead: typecheck, npm test, build pass; implementer: 46 desktop-chromium + 7 phone E2E pass; branch CI run 45401098111 |
| 2 Sequential board and placeholder | done (lead verified, Opus reviewed; review fixes applied) | (this commit) | lead: typecheck, npm test 2672 pass, build, phone @layout 31 pass; implementer: desktop-chromium lottery 12 pass incl. new (T,T) seek test on real data hub seed |
| 3 Design record and PR | pending | — | — |
