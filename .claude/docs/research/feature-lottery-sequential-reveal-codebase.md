# Feature research: sequential split-flap lottery reveal (issue #63)

Date: 2026-11-24. Scope: read-only codebase map for "route row first, then
direction row" in the split-flap (パタパタ) transfer lottery. Out of scope:
roulette variant, #72 map highlight, #66 result card.

Issue #63 (gh issue view 63), "パタパタ" plan: the route row stops first, then
the direction row flips; until then the direction row shows a neutral blank
("方向 ？"), and a single-direction service (Yamanote → 外回り) also starts from
that blank and stops on 外回り. Split the current flip time ~60/40. Results and
probabilities unchanged. Optional idea in the issue ("show Yamanote's weight by
more Yamanote cards") is a separate presentation change and NOT part of this
sequencing task.

---

## 1. How the reveal is timed and sequenced today

### Stage list (JS, the only deadline owner)

- Durations per speed live in `TURN_MOMENT_TIMINGS`
  (`src/features/game/animation/turnMomentPolicy.ts:26-43`):
  - slow (ゆっくり): flip 2133 / settle 533 ms (L29)
  - normal (ふつう): flip 1600 / settle 400 ms (L33)
  - fast (はやい): flip 1067 / settle 267 ms (L37)
  - very-fast (とても速い): flip 280 / settle 100 ms (L41)
  - Speed labels: `src/features/game/gameConfig.ts:62-65`.
- Policy is captured at roll time (`captureTurnPresentationPolicy`,
  `turnMomentPolicy.ts:49-61`); `showImportantMoments = level !== "none"` (L59).
  Effects levels: すべて/重要なときだけ/なし = `all|important|none`
  (`src/features/game/gameSettings.ts:3,18-20`).
- `buildTurnRevealStages` (`src/features/game/animation/turnMoments.ts:132-155`)
  pushes two stages `lottery-flip` (lotteryFlipMs) then `lottery-settle`
  (lotterySettleMs) (L146-149) only when the landing snapshot draws something:
  `services.length > 1 || selected.directions.length > 1` (L142-145). Returns
  no stages when restored/omitted (L133) or `!showImportantMoments` (L141) or
  goal (L141).
- The plan is frozen once per reveal key (`useTurnMoments.ts:164-174`) and run by
  `useRevealSequence` (`src/features/game/animation/useRevealSequence.ts:120-164`):
  one `window.setTimeout` per stage with the current stage's duration
  (L142-149); `advance` increments the stage index, marking `done` after the
  last (L97-105); `skip` sets `done` immediately (L107-108, L151-154). Stage is
  exposed as `sequence.stage` (L159).
- `publicationPhase` maps reveal stage → `"lottery-flip" | "lottery-settle"`
  (`src/features/game/turnMomentPresentation.ts:122-133`, L127-128).
- `GameApp` builds the `lottery` prop only during those phases, picking
  `durationMs` = lotteryFlipMs or lotterySettleMs
  (`src/app/GameApp.tsx:509-515`), and renders `TurnMomentHost` with `onTap={skip}`
  (`GameApp.tsx:749-752`). Host renders `<LotteryReveal {...lottery} boardScale>`
  (`src/features/game/components/TurnMomentHost.tsx:545`) and adds
  `turn-moment-host__region--settling` during settle (L527).

### Component (decoration only, no timers)

`src/features/game/components/LotteryReveal.tsx`:
- `FLIP_FRAME_COUNT = 8` (L26).
- Frames: route row = 8 badges cycling `serviceCandidates` + final drawn service
  (L78); direction row = 8 labels cycling `directionCandidates` of the **drawn**
  service + final direction (L79; `directionFrame` uses `landing.serviceId`, L77).
  This is the leak: direction candidates are the drawn service's labels
  (engine: `resolveLandingEvent` builds `directionCandidates` from the resolved
  service, `src/features/game/engine/landing.ts:222-238`).
- Root sets `--lottery-ms` = current stage duration and `data-stage`
  (`LotteryReveal.tsx:80`). Both rows get the same `stage` and are rendered in
  parallel (L82-83).
- `LotteryRow` (L43-71): `flipping = drawn && stage === "lottery-flip"` (L64) →
  class `lottery-reveal__row--flipping`; renders `.lottery-reveal__result`
  (final frame, L67) always, and the 8 `.lottery-reveal__frame` spans only while
  flipping (L68-69) with `--frame-index` / `--frame-count`.
- Second leak: a non-drawn direction row (`directionDrawRequired === false`, e.g.
  Yamanote has only 外回り) is never flipping, so its result is visible and static
  from t=0 (L64-67) — "the row does not move" ⇒ "the route is Yamanote".
- Settle: `useLayoutEffect` measures row vs HUD target once stage becomes
  settle (L48-58), then `data-motion="flight"|"fade"` enables the CSS settle
  (L60-66). Comment L42: "the sequence owns the deadline".

### CSS (all motion is CSS animations on real time)

`src/styles.css`:
- `.lottery-reveal__frame` (L3286-3295): `opacity: 0` base; animation
  `lottery-frame` with duration `--lottery-ms*0.84/--frame-count` and delay
  `--lottery-ms*0.84*index/count`, `forwards` (no backwards fill → invisible
  before its delay because base opacity is 0).
- `.lottery-reveal__row--flipping .lottery-reveal__result` (L3309-3311):
  `lottery-result var(--lottery-ms) steps(1,end) both` → hidden until 84%, then
  shown (keyframes L3324-3327).
- Settle (L3312-3317, keyframes L3328-3331): row with `[data-motion]` flies/fades,
  heading fades.
- Reduced-motion fallback (L3332-3335): all lottery animations off, frames
  `display:none` → results shown statically.
- Board/row layout: `.lottery-reveal` L3255-3260, `.lottery-reveal__row`
  L3265-3278 (min-height 3.5rem), split seam `::after` L3279-3285.

Net timeline today (normal, 1600 ms flip): both rows cycle frames 0–1344 ms,
both results appear at 1344 ms, hold to 1600 ms; then settle 400 ms.

## 2. Minimal change

### Recommended: CSS-timed sub-phases inside the existing `lottery-flip` stage

Keep the stage list, `turnMomentPolicy` durations, `useRevealSequence`,
`GameApp`, `TurnMomentHost` and `LotteryRevealProps` unchanged. Only
`LotteryReveal.tsx` (row props + inline custom properties + a placeholder span)
and the lottery CSS block change. Total duration is identical by construction
(flip + settle untouched), so every consumer keyed on stage boundaries keeps
working.

Row timing per case (F = flip `durationMs`, R = round(F × 0.6), constant e.g.
`ROUTE_FLIP_SHARE = 0.6` per no-magic-numbers rule):

| serviceDraw | directionDraw | Route row | Direction row |
|---|---|---|---|
| true | true | flips in [0, R] (frames over 0.84·R, result at 0.84·R) | placeholder "方向 ？" in [0, R]; flips in [R, F] |
| true | false (Yamanote 外回り, single-direction stops) | flips in [0, R] | placeholder in [0, R]; result snaps visible at R, no frames |
| false | true | static result from t=0 (route known, no leak possible) | **open question**: flip over whole [0, F] (today's behaviour, recommended) or keep 60/40 with placeholder |
| false | false | no lottery stage at all (`turnMoments.ts:145`) | — |

Pre-R the direction row is pixel-identical across rows 1 and 2 of the table
(same placeholder, no motion, frames invisible), so neither labels nor motion
hint the route.

Concrete edits:
- `LotteryReveal.tsx`
  - Replace `drawn` with a small row model, e.g. `{ mode: "static" | "flip" |
    "snap"; startMs: number; windowMs: number; placeholder: ReactNode | null }`
    computed in `LotteryReveal` from `serviceDrawRequired` /
    `directionDrawRequired` and `durationMs` (L74-84). `flipping` (L64) becomes
    `mode === "flip" && stage === "lottery-flip"`.
  - Set per-row inline vars `--row-delay: ${startMs}ms`, `--row-ms: ${windowMs}ms`
    on the row div (L65-66; merge with the settle `style`, L60-63).
  - Render `<span className="lottery-reveal__placeholder">方向 ？</span>` only
    when `stage === "lottery-flip"` and the route row is drawn (direction row).
    Absolutely positioned overlay (like frames) so row/board size never changes
    (keeps `lotteryFitScale` and settle measurement unchanged).
  - Snap row: new class (e.g. `lottery-reveal__row--snap`) so the result is
    hidden until `--row-delay` then shown.
  - Keep `.lottery-reveal__result` holding the final value in every mode (tests
    and E2E read it, see §5).
  - Optionally size direction frames down (e.g. 4–6) since its window is 40%;
    keep deterministic, no RNG (comment at L73).
- `styles.css` (L3286-3335)
  - Frame duration/delay: `calc(var(--row-ms) * 0.84 / var(--frame-count))` and
    `calc(var(--row-delay) + var(--row-ms) * 0.84 * var(--frame-index) / var(--frame-count))`.
    Default `--row-delay: 0ms; --row-ms: var(--lottery-ms)` on `.lottery-reveal__row`
    so a static or settle row is unaffected.
  - Flipping result: `animation: lottery-result var(--row-ms) steps(1,end) var(--row-delay) both`
    (`both` gives backwards fill → hidden during delay).
  - Snap result: e.g. `lottery-hold var(--row-delay) steps(1,end) both`
    (opacity 0 → 1 at the end of the delay).
  - Placeholder: overlay with surface background, `lottery-placeholder` hidden at
    `--row-delay` via `steps(1,end) both`.
  - Reduced-motion block (L3332-3335) must also `display:none` the placeholder;
    otherwise "animation: none" would leave it covering the result forever.
- No change to `turnMomentPolicy.ts`, `turnMoments.ts`, `useRevealSequence.ts`,
  `useTurnMoments.ts`, `GameApp.tsx`, `TurnMomentHost.tsx`, engine.

Why not a JS sub-timer: the component comment (`LotteryReveal.tsx:42`) and the
sequence design keep a single deadline owner; a second `setTimeout` in the
component adds a clock the reveal sequence does not know about. Why not split
into new reveal stages (`lottery-route` / `lottery-direction`): touches the
stage union (`turnMoments.ts:10`), `publicationPhase`
(`turnMomentPresentation.ts:127-128,589-590`), announcement stage union
(`src/features/game/presentation.ts:215,240`), `GameApp.tsx:509-513`,
`TurnMomentHost.tsx:527`, the policy shape and ~40 stage-keyed tests (§5). Only
worth it if the plan wants DOM-level truth (placeholder actually replacing the
result node) and deterministic `page.clock` assertions mid-flip; DOM text is
not user-visible here because the board is `aria-hidden` (§3).

### Consumers that wait on completion (must still fire once at the end)

- The only completion signal is the reveal sequence's `advance`/`done`
  (`useRevealSequence.ts:142-149,97-105`): `lottery-flip` → `lottery-settle` →
  next stage (pickup) or `done` → `publicationPhase` returns `"published"`
  (`turnMomentPresentation.ts:130`). Publication of HUD ride, map highlight,
  platform marker, lottery text, candidates, turn result, guide candidates is
  gated on `lotteryPublished`/`resultPublished`
  (`turnMomentPresentation.ts:345-347,397-411`; ride L172-180).
- There are no promises or onDone callbacks from `LotteryReveal`; CSS
  `animationend` is not listened to. With the recommended approach nothing in
  this chain changes.
- First-play guide is held while `lottery !== null` (`GameApp.tsx:655-661`).

## 3. Accessibility

- Board is `aria-hidden="true"` (`LotteryReveal.tsx:80`) inside an
  `aria-hidden` host (`TurnMomentHost.tsx:525`); unit test asserts no
  focusable / `role=status` inside (`tests/unit/turn-moment-components.test.ts:1331`).
- Live region: one `role="status" aria-live="polite" aria-atomic`
  (`src/features/game/components/GamePanel.tsx:795`), text from
  `turnMomentAnnouncement` (`turnMomentPresentation.ts:466`).
  During `lottery-flip`/`lottery-settle` it emits the arrival copy plus
  "。抽選結果を表示しています" only (`src/features/game/presentation.ts:240-245`) —
  no service or direction. The result is read only at publication
  (`presentation.ts:247-253`).
- HUD stats keep the previous ride until published (`turnMomentPresentation.ts:172-180`);
  panel lottery line shows the previous landing text / "抽選: —"
  (`turnMomentPresentation.ts:397-400`); E2E asserts both during flip/settle
  (`tests/e2e/ui-pop-turn-moments.spec.ts:644-661`).
- Conclusion: no early leak to assistive tech today, and the change does not
  touch any announcement. Keep the placeholder inside the `aria-hidden` board.
  The DOM does hold the final values from t=0 (opacity-hidden) — invisible to
  users and SR; only DOM-inspecting tests see it.

## 4. Reduced motion / effects "なし" / skip

- Reduced motion (JS, `usePrefersReducedMotion`, `src/app/GameApp.tsx:186`;
  `src/features/game/usePrefersReducedMotion.ts:3`): stages omitted
  (`turnMoments.ts:133`, `useTurnMoments.ts:170,186`), so `LotteryReveal` never
  mounts; turning it on mid-flip ends the whole presentation without replay
  (unit `tests/unit/game-app-turn-moments.test.ts:2067`, E2E
  `ui-pop-turn-moments.spec.ts:682-699`). CSS fallback `styles.css:3332-3335`
  must keep the final values visible → add placeholder to it.
- Effects なし: `showImportantMoments=false` → no lottery stages
  (`turnMoments.ts:141`; test `tests/unit/turn-moments.test.ts:444`).
  重要なときだけ still shows the lottery (same line).
- Skip: card tap → `skip` (`GameApp.tsx:750`, `useTurnMoments.ts:192-196`) →
  `done` (`useRevealSequence.ts:107-108`) → board unmounts, result publishes.
  Unchanged; works at any sub-phase because sub-phases are CSS only.
- Resume/restored results: no stages (`turnMoments.ts:133`); E2E
  `tests/e2e/lottery.spec.ts:43-79`, `tests/e2e/resume.spec.ts:220-228`.
- Must stay true: total = flip + settle per speed; one publication at the
  settle deadline; Skip/reduced motion end everything with no replay; save
  unchanged (`expect(await readSave(page)).toEqual(saved)` patterns).

## 5. Tests touching the lottery

Unit (vitest, jsdom):
- `tests/unit/turn-moment-components.test.ts`
  - "S14 LotteryReveal › flips only drawn rows (service %s, direction %s) and
    stops on saved values" (L1318-1338): asserts `--flipping` per drawn flag
    (L1328) and `.lottery-reveal__result` text (L1329-1334). **Update**: the
    `[true,false]` case's direction row becomes "snap" (not flipping) — fine,
    but add assertions for placeholder presence, `--row-delay`/`--row-ms` values
    (R = 960 for 1600), and that the placeholder is absent during settle
    and when `serviceDrawRequired=false`.
  - "measures both HUD targets…" (L1340-1356) and "measures the unanimated
    source…" (L1358-1381): settle only; placeholder must not render in settle.
    `getBoundingClientRect` spies are on `HTMLDivElement` — keep placeholder a
    `span` so call counts (L1353 `toHaveBeenCalledTimes(2)`) stay.
  - CSS regex tests (pattern to mimic): "starts lottery settling only after a
    row has measured its motion" (L320-323), reduced-motion check (L306-311),
    `rule(selector)` helper L282. Add regexes for the new frame delay calc,
    placeholder rule, and placeholder in the reduced-motion block.
- `tests/unit/lottery-board-fit.test.ts`: `lotteryProps` (L120-135) renders flip
  in `TurnMomentHost` and mocks `HTMLDivElement` rects (L179-190); unaffected if
  placeholder is a span overlay. Verify.
- Stage/timing tests that must stay green unchanged (they prove the total
  duration did not move): `tests/unit/turn-moment-policy.test.ts:13-17,36,52-55`,
  `tests/unit/turn-moments.test.ts:81-85,309-310,331,381,444`,
  `tests/unit/game-app-turn-moments.test.ts:1148,1154,2021-2048 ("S14 lottery
  publication lifecycle › holds all consumers through flip and settle…"),
  2067 ("omits %s on reduced motion without replay"), 2082 ("one Skip completes
  %s with no replay")`, plus `turn-moment-hooks`, `turn-moment-presentation`,
  `turn-result-publication`, `hud-progress-publication`,
  `progress-milestone-publication`, `game-app-item-progress`, `map-flash`,
  `turn-moment-items` (all stage-keyed, grep `lottery-flip`).
- Fake-timer pattern: `vi.useFakeTimers()` + `advance(ms)`
  (`game-app-turn-moments.test.ts:338`, helpers L2021-2028).

E2E (Playwright; `page.clock` frozen does NOT drive CSS animations):
- `tests/e2e/ui-pop-turn-moments.spec.ts`
  - "lottery flip and settle keep HUD, highlight, platform, log, upcoming
    stations and item results behind one publication" (L621-680): reads
    `.lottery-reveal__result` first/last text in settle (L663-665) — keep
    result nodes. Its fixture turn is `serviceDrawRequired: true,
    directionDrawRequired: false, serviceId: fixture-south`
    (`tests/unit/e2e-fixture-seeds.test.ts:103,169`) — i.e. the **snap** path,
    good place for a new assertion.
  - "`${end}` during `${stage}` ends the whole presentation without replay"
    (L682-699), "S16 complete overflow turn at `${speed}`…" (L818, boundaries
    L883-905), "S16 one Skip during `${stage}`…" (L951), "S16 reload during
    `${stage}`…" (L965), "S16 `${exit}` during lottery…" (L1121): stage-level,
    unchanged.
- `tests/e2e/support/turnMoments.ts`: `STAGE_MS_BY_SPEED` (L64-73),
  `awaitStage` for lottery (L127-128), `advanceLotteryFlip/Settle` (L207-219) —
  unchanged.
- `tests/e2e/turn-result-card.spec.ts` "moments preserve and avoid previous
  result at 320x568 / 320x480" (@layout, L780-800+; `assertPhoneMoment`
  L702-732, `readSettleLandings` L743-761). Board geometry/scale must not change
  — overlay placeholder keeps it. `readSettleLandings` is the pattern for
  seeking CSS animations deterministically: `row.getAnimations()`, find by
  `animationName`, `pause()`, set `currentTime` (L751-758). Mimic it for a new
  E2E check: seek the flip animations to t < R and assert the placeholder is
  opaque, direction frames/result opacity 0; t > R assert result visible.
- `tests/e2e/text-wrapping.spec.ts` L522-534: evidence screenshot only
  (`lottery-reveal-long-line.png`, no comparison) — will now capture the
  placeholder; acceptable, maybe note in PR.
- `tests/e2e/lottery.spec.ts` (@layout L8-41; skip L43-79): asserts no board
  while moving (L62); unaffected.
- `tests/e2e/resume.spec.ts:220-228`: stage attribute only.

## 6. Risks

- Timing drift between CSS (real time) and the sequence deadline (setTimeout):
  pre-existing; under load the settle stage replaces the flip anyway. A route
  result at 0.84·R and direction window [R, F] leave a visible "route stopped"
  beat (0.16·R ≈ 154 ms at ふつう).
- とても速い: F = 280 → R = 168, direction 112 ms; 8 frames in 0.84·168 ≈ 141 ms
  is ~17 ms/frame (≈1 frame per refresh); today it is ~29 ms/frame. Consider
  fewer frames per row at small windows; purely cosmetic.
- E2E flakiness: asserting mid-flip visuals with `page.clock` will not work
  (CSS not faked) — use animation seeking (above) or limit to unit + CSS-regex
  tests. WebKit: the settle measurement ordering note
  (`LotteryReveal.tsx:53-54`) must be preserved; do not add measurement work in
  flip. WebKit runs CI-only (3 shards) — check branch/PR CI.
- Phone @layout specs (320×568/480): any change to row height or board width
  shifts `lotteryFitScale` and the "keeps scale 1" assertion
  (`turn-result-card.spec.ts:722-723`). Keep the placeholder absolutely
  positioned and shorter than the row.
- Minor residual hint: the hidden direction result still sets the row's
  intrinsic height; a direction label that wraps would make the row taller from
  t=0. Labels are short today; if needed, force one line on the direction
  result (`white-space: nowrap; text-overflow: ellipsis`).
- Design record: `.claude/docs/DESIGN.md:228` ("1行目に路線、2行目に方面をめくって")
  and `:243` (flip 1.6 s + settle 0.4 s) should get a design-tracker row for the
  sequential reveal and the `serviceDraw=false` decision.

## Open questions for the plan

1. `serviceDrawRequired=false, directionDrawRequired=true`: direction flips over
   the whole flip window (recommended, no leak possible) or keep 60/40 + blank?
2. Placeholder copy: "方向 ？" (issue) vs "進行方向 ？" (HUD label wording).
3. Exact split: 60/40 of `lotteryFlipMs` only (settle unchanged) — confirm.
