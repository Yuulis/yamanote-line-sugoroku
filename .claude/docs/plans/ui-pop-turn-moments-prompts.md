# UI Pop P2 (Turn Moments) — Executor Prompts

Self-contained executor prompts, one per step of `.claude/docs/plans/ui-pop-turn-moments-plan.md`.
A step's prompt file = **§0 Common Contract + the step section**. Build it mechanically (never retype):

```bash
STEP=S1   # S1 … S17, or S10b
mkdir -p .claude/logs/codex
awk -v s="## ${STEP}:" '/^## /{p = ($0 ~ /^## 0\. Common Contract/) || index($0, s) == 1} p' \
  .claude/docs/plans/ui-pop-turn-moments-prompts.md > ".claude/logs/codex/prompt-p2-${STEP}.md"

# Implementer, Luna high (default lane)
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file ".claude/logs/codex/prompt-p2-${STEP}.md" --label "p2-${STEP,,}" \
  --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --timeout 2400 --caller lead
```

Claude Sonnet fallback: pass the same built file as the subagent prompt. Reviewer (Sol low, read-only),
after the implementer finishes and before the lead commits:

```bash
awk '/^## R:/{p=1;next} /^## /{p=0} p' .claude/docs/plans/ui-pop-turn-moments-prompts.md \
  | sed "s/{STEP}/${STEP}/g" > ".claude/logs/codex/prompt-p2-${STEP}-review.md"
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file ".claude/logs/codex/prompt-p2-${STEP}-review.md" --label "p2-${STEP,,}-review" \
  --config model_reasoning_effort=low --sandbox read-only --caller lead
```

The lead commits after verification; executors never commit. Step sections hold only what the plan does not:
the plan's `### {STEP}` section is binding and is read by the executor directly.

---

## 0. Common Contract

You are implementing one step of the "UI pop P2 — turn moments" feature in
`/home/yuulis/yamanote-line-sugoroku` (React 19 + TypeScript 6 + Vite 8 + MapLibre; Vitest; Playwright),
branch `feature/ui-pop-turn-moments`. Implement **only** the step below, completely, as one reviewable change.

Read first:
- `.claude/docs/plans/ui-pop-turn-moments-plan.md` — Summary (hard scope boundaries, incremental activation,
  execution contract) and the step's `### {STEP}` section. That section is binding: its file list, tests and
  acceptance commands define the step.
- `.claude/docs/plans/ui-pop-turn-moments-architecture.md` — interfaces, data flow, Skip and publication rules.
- `.claude/docs/plans/ui-pop-turn-moments-handoff.md` — previous steps' notes and open findings.
- `.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

Fixed decisions (user, 2026-11-03; do not reopen): all four moments (dice tumble + modifier stamps, arrival
banner + completed-segment flash, split-flap lottery board at the visible map centre settling into the HUD,
item pickup before DiscardChoice); durations = base × stepMs / 450, captured at the roll; pseudo-3D CSS cube;
dice disabled (focusable, `aria-disabled`) during post-move reveal; overlay tap and スキップ end the reveal; one
Skip ends tumble + movement + reveal; goal turn = arrival banner then ClearScreen; no moments under
reduced motion or for resumed results; no probabilities shown; no sound.

Hard constraints:
- Do not modify: `src/features/game/engine/**`, `src/features/game/store/**`, `src/features/game/gameSession.ts`,
  `src/features/game/itemSession.ts`, `src/features/game/useGameApp.ts`, `src/types/network.ts`,
  `public/data/**`, `data/**`, `package.json`, `package-lock.json`, `.claude/docs/DESIGN.md`, `.claude/STATE.md`.
  Touch only the files listed for the step plus the handoff doc.
- No new dependencies. No `Math.random`; presentation never imports engine RNG or turn functions and never
  becomes save input.
- Conventions: function components, named exports, `XxxProps` in the same file, BEM-ish classes in the single
  global `src/styles.css`, colours through CSS tokens, constants `UPPER_SNAKE_CASE`, type annotations
  everywhere, early returns, English code/comments, Japanese UI copy. Pure logic in `.ts` modules with
  table-driven Vitest tests.
- Unit tests: `tests/unit/<name>.test.ts` (no `.tsx`), `// @vitest-environment jsdom` when rendering, React via
  `createElement` + `tests/unit/helpers/reactDom.ts`. Lifecycle assertions keep component identity stable
  (`act(() => mount.root.render(createElement(Harness, props)))` with a named `Harness`). Use
  `vi.useFakeTimers()` and record commits with `useLayoutEffect` as `tests/unit/reveal-sequence.test.ts` does.
- E2E: never delete, skip, or loosen an assertion; re-point it to an explicit checkpoint with the same expected
  value. Local runs: `env -u WAYLAND_DISPLAY npx playwright test --workers=2 --project=desktop-chromium …`
  (add `phone-chromium` when the step says so); WebKit and the full matrix are CI-only.
- Accessibility: exactly one gameplay `role=status` live region (panel, active decision dialog, or ClearScreen);
  visual moment layers `aria-hidden="true"` with no focusable descendants; the overlay never takes focus;
  `panelStat` `<dt>`/`<dd>` + `data-stat` contracts kept; the dice name stays within `/サイコロを振る|移動中…/`.
- Forbidden-path audit must print nothing:
  `git diff --exit-code 70decd6 -- src/features/game/engine src/features/game/store src/features/game/gameSession.ts src/features/game/itemSession.ts src/features/game/useGameApp.ts src/types/network.ts public/data`

When done, update the step's row in `.claude/docs/plans/ui-pop-turn-moments-handoff.md` (status
`implemented — pending lead verification`, commands you ran with pass/fail counts, open findings). Do not commit.

Output format (markdown, exactly these level-2 sections, in this order): `Summary`; `Files Changed` (path — new/modify —
one line); `Tests Added or Changed` (exact test names; for E2E re-pointing list old → new checkpoint and confirm the
expected value is unchanged); `Commands Run` (command → result with counts); `Deviations and Assumptions`;
`Open Issues`.

---

## S1: First-commit omission and future-key Skip support

Implement plan `### S1` exactly. Files: `src/features/game/animation/useRevealSequence.ts`,
`tests/unit/reveal-sequence.test.ts` (plus the handoff row).

- Add optional `skipRequested?: boolean` to the hook options and an omission flag to the pure `observe` action.
  `omit = reducedMotion || skipRequested` is folded into both the new-key and the same-key observation branches
  (`done = alreadySeen || stageCount === 0 || omit` / `done = state.done || stageCount === 0 || omit`).
- Remove the effect that completes reduced motion after commit; return values derive from the observed state on
  the same render: omitted key → `stage: "done"`, `busy: false`, `ready: movementComplete`.
- Completion is sticky per key: turning reduced motion off, or `skipRequested` returning to false, never replays.
- Keep every existing test passing unchanged; production callers keep passing empty stages (no behaviour change).
- Tests: the six bullets of plan `### S1` → Tests, each as a named test in the existing harness style.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/reveal-sequence.test.ts
npx vitest run
npm run build
```

No E2E in this step.

---

## S2: Pure timing, accepted facts, and roll-attempt reducer

Implement plan `### S2` exactly. Files: new `src/features/game/animation/turnMoments.ts`, new
`tests/unit/turn-moments.test.ts` (plus the handoff row). Nothing else; nothing is wired into production.

- Pure TypeScript only: no React import, no timers, no DOM. Reuse existing domain types (`ItemSessionView`,
  `LastMove`, `Direction`, item records/events, `ANIMATION_SPEEDS`) by import; do not copy their definitions.
- Export the architecture's interfaces (architecture "Interface Design"): `PreMoveStage`, `TurnRevealStageKey`
  (reserved; no production stage planning yet), `TurnMomentTiming`, `TurnOrigin`, `RollAttempt`,
  `TurnMomentsState`, `TurnMomentsAction` (discriminated union `begin` / `observe` / `advance` / `skip` /
  `reset`), `turnMomentTiming(stepMs)`, `turnMomentsReducer(state, action)`, plus a pure observation adapter
  (e.g. `observeTurnFacts(...)`) that normalises session facts. Name additional helpers clearly; keep the file
  within ~300 lines.
- Timing: factor = stepMs / normal stepMs from the `"normal"` entry of `ANIMATION_SPEEDS` (do not hard-code 450);
  `Math.round(base * factor)`; normal bases tumble 600, stamps 240, arrival 800, lottery flip 1,600, settle 400,
  pickup 500 ms.
- Identity: attempt key `${sessionId}:roll:${game.turn + 1}:${decisionRevision}`, expected record turn stored on
  the attempt; a later record with that session and turn attaches to the attempt and never starts a second
  tumble. Raw roll is read only from an acknowledged `awaiting-adjust` decision or an accepted record — never
  from `pending.rawRoll` while committing.
- Skip intent latches on the attempt and survives adjustment, record creation and movement until the next
  accepted `begin` or a `reset`/session change. Restored pending rolls (`source: "restored-roll"`) omit the
  tumble; a subsequently created arrival record is still new. Reduced motion sets `motionOmitted`.
- Deadhead (no die) skips tumble/stamps. A delay activated when the raw roll was already 1 still needs stamps.
  Newly completed segment IDs are restricted to target (Yamanote outer) segments completed by this move.
- Stale `advance` (wrong key or expected stage) and duplicate `observe` return the same state object.
- Tests: every bullet of plan `### S2` → Tests as table-driven cases; assert exact timings at slow/normal/fast.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/reveal-sequence.test.ts
npx vitest run
npm run build
```

No E2E in this step.

---

## S3: Shared movement, ride, and log publication model

Implement plan `### S3` exactly. Files: new `src/features/game/turnMomentPresentation.ts`, new
`tests/unit/turn-moment-presentation.test.ts` (plus the handoff row). Nothing is wired into production.

- Pure TypeScript, no React. Inputs: the session (whatever `GameApp`/`GamePanel` already pass to the existing
  helpers), the existing `AnimationView` / `displayedProgress` result (`src/features/game/displayedProgress.ts`),
  the S2 pre-move attempt (`RollAttempt | null` from `animation/turnMoments.ts`), and the post-move reveal state
  (current `TurnRevealStageKey | "waiting" | "done"` plus whether the record is restored/omitted). Define one
  small input interface for this; do not add another gameplay model.
- Derive one publication phase (e.g. `pre-move` → `moving` → `arrival` → `lottery-flip` → `lottery-settle` →
  `published`, plus `restored`/`omitted` = published immediately) and from it the architecture's movement/ride/log
  subset of `TurnMomentDisplay`: `turn`, `progress`, `ride`, `compactRoll`, `rollText`, `arrivalText`,
  `lotteryText`, `candidateRows`, `showClear`. Leave item/decision/announcement/toast/overlay/flash fields to S4+
  (do not stub them; define only what S3 owns, in a way S4 can extend).
- Reuse the existing helpers for the final values (`displayedRide`, `landingText`, `lastRollText`, candidate-row
  resolver, `compactRollFor`, `displayedProgress`, …) — find them in `src/features/game/presentation.ts`,
  `hudPresentation.ts`, `displayedProgress.ts` and `components/GamePanel.tsx`. Before publication, the values
  are the origin ride / previous turn's text; the detailed roll text (physical hops, unused pips) is withheld
  until arrival; tumble shows a placeholder, then the raw face, then published modifier wording.
- Before lottery publication the marker/platform input is the ridden service's arrival platform, not the next
  service's; HUD ride, upcoming-station input, map highlight, lottery text and candidates publish together at the
  end of settle; forced rides (no draw) publish when arrival ends; goal `showClear` stays false through arrival.
- Tests: every bullet of plan `### S3` → Tests, with engine-built records/sessions (build them through the
  real engine/session helpers used by `tests/unit/game-presentation.test.ts` or `game-app-item-progress.test.ts`
  fixtures) and independent literal expected values — never values computed by the function under test.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/animation.test.ts tests/unit/game-presentation.test.ts
npx vitest run
npm run build
```

No E2E in this step.

---

## S4: Safe item view, decisions, and announcements

Implement plan `### S4` exactly. Files: modify `src/features/game/turnMomentPresentation.ts` and
`src/features/game/presentation.ts`; new `tests/unit/turn-moment-items.test.ts`; modify
`tests/unit/game-presentation.test.ts` (plus the handoff row). Nothing is wired into production.

- Extend the S3 `TurnMomentDisplay` (do not fork it) with the architecture's remaining non-visual fields:
  `itemView`, `decision`, `effectModels`, `showItemNotice`, `announcement`, `toastInputs`, `canRoll`, `canSkip`,
  `itemUseLocked`. Overlay/flash fields stay for later steps. Extend the input minimally (e.g. the reveal stage
  already covers `pickup`; add the raw toast inputs or item events the existing toast conversion consumes —
  reuse `toastQueue.ts`/existing converters, do not reimplement toast wording).
- Safe item view (architecture "Shared displayed model" → "For the initial implementation"): build it from the
  attempt's origin `itemView` snapshot and explicit boundaries — keep safe origin hints while locked; remove
  known pre-move consumed items when stamps finish (or at release when there are no stamps); hold arrival
  effects, certificate consumption and the retained pickup until the item-results boundary; publish the final
  item state when `pickup` completes, or at reveal completion when there is no pickup stage. Removing only the
  new instance is not enough: effects, certificate removal, hints and availability must not leak. Keep live action
  identity for callbacks without exposing final contents. Do not invent a new domain unavailable-reason value.
- Decisions: the adjust decision is presented only from `awaiting-adjust` (after the tumble); the discard
  decision only when the pickup stage has completed (published). Before that `decision` is `null`.
- Permissions: `canRoll` false whenever any presentation is pending (pre-move stage before `released`,
  animating, or a reveal stage active) even if the engine phase is `idle`; `canSkip` true exactly while there is
  something to skip; `itemUseLocked` true while presentation is active. Restored/omitted results: no lock.
- Announcements (architecture "Announcements"): add one stage-aware helper in `presentation.ts` that reuses the
  existing canonical text helpers; tumble = neutral wording without the face; adjust = the existing raw-roll
  instruction once the dialog is presented; movement = published face/modifiers only; arrival/lottery = arrival
  wording + `抽選結果を表示しています` without the next ride; lottery done = canonical landing wording; pickup done
  = canonical item outcome and any discard instruction; ready = the existing full announcement + `サイコロを振れます`.
  When `showClear` is true the panel announcement is empty — ClearScreen owns the completion wording (no
  duplicate).
- Toasts: `toastInputs` is empty until the item-results boundary; a same-turn discard update (appended events on
  the same record turn) exposes the new notices/toasts without changing the phase or stage plan.
- Tests: every bullet of plan `### S4` → Tests, engine-built sessions/records as input (reuse the fixture style of
  `tests/unit/turn-moment-presentation.test.ts` / `game-app-item-progress.test.ts`), and LITERAL expected values
  (item names/ids, exact announcement strings, booleans) — never values computed by the functions under test.
  Existing `game-presentation.test.ts` assertions stay unchanged; only add cases for the new helper.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-items.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/game-presentation.test.ts tests/unit/toast.test.ts
npx vitest run
npm run build
```

No E2E in this step.

---

## S5: Movement start gate and sequence hook

Implement plan `### S5` exactly. Files: modify `src/features/game/animation/useMoveAnimation.ts`; new
`src/features/game/animation/useTurnMoments.ts`; new `tests/unit/move-animation-gate.test.ts`; new
`tests/unit/turn-moment-hooks.test.ts` (plus the handoff row). Production callers keep the default behaviour
(no caller passes the new option yet; `GameApp` is not touched).

- `useMoveAnimation(animation, network, geometry, stepMs, onFinished, options?)` with
  `MoveAnimationOptions { startAllowed?: boolean }` defaulting to `true`. While closed: keep the plan and the
  `AnimationView` for the current animation (`frame: null`), empty live position, no runner start and no frame
  request; opening starts the runner exactly once. Never substitute `null` for the animation input.
- `useTurnMoments(...)`: a thin hook that owns the S2 `turnMomentsReducer` (current-stage timer only, keyed by
  attempt key + expected stage), delegates post-move sequencing to `useRevealSequence` (pass `skipRequested`
  from the latched attempt, per S1), accepts the production stage list as an input (production will pass an
  empty list until S12), freezes timing at the accepted attempt and the stage configuration at the reveal key,
  and exposes stable callbacks (`begin`, `skip`, …) reading current identity through refs. It returns what the
  S3/S4 `deriveTurnMomentDisplay` input needs (attempt, reveal stage, restored/omitted flag) plus
  `movementStartAllowed`. A latched Skip finishes an animation that appears later (after adjustment/save) by
  calling the provided finish callback with its full identity, without running it. Reduced motion turning on
  mid-turn omits both sequences irreversibly and releases instant movement; turning it off never replays.
  A restored pending-adjust resolution is a fresh arrival (no tumble replay). Reset on session change.
- S2 non-blocking carry-over: add tests for reduced motion on→off mid-stage and for `advance(tumble)` →
  `waiting-record` (in `tests/unit/turn-moment-hooks.test.ts` or `turn-moments.test.ts`).
- Tests: every bullet of plan `### S5` → Tests, with stable `Harness` components
  (`act(() => mount.root.render(createElement(Harness, props)))`), `vi.useFakeTimers()`, a fake
  `requestAnimationFrame` like `tests/unit/animation.test.ts` uses, `vi.getTimerCount()` for timer evidence,
  and commits recorded through `useLayoutEffect`. Literal expected values.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/move-animation-gate.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/turn-moments.test.ts tests/unit/reveal-sequence.test.ts tests/unit/animation.test.ts
npx vitest run
npm run build
```

No E2E in this step (production behaviour unchanged).

---

## S6: Adopt the shared display model across consumers

Implement plan `### S6` exactly. Files: modify `src/app/GameApp.tsx` and
`src/features/game/components/GamePanel.tsx` (and child components only where a prop must change type, e.g.
`GameHud.tsx` / `InventoryPanel.tsx`, keeping their markup contracts); modify `tests/unit/game-hud.test.ts` and
the affected `tests/unit/item-controls.test.ts` fixtures; new `tests/unit/game-app-turn-moments.test.ts` (plus
the handoff row).

- Production computes `deriveTurnMomentDisplay(...)` (S3/S4, `src/features/game/turnMomentPresentation.ts`) once
  per render in `GameApp` and passes the resulting display model down. Every visible value comes from it: HUD
  station/ride/direction/turn/progress/compact roll, upcoming stations, map progress + highlighted service +
  marker at rest, log (arrival/lottery/roll text), candidate disclosure, remaining sections (from displayed
  progress), inventory/effect chips/hints, item notice, decision mounting + card closing, the single live region
  text, toast acceptance input (then the existing resume-baseline filtering), and ClearScreen eligibility.
  Remove the corresponding independent raw-session calls (`displayedRide(session)`, `landingText(lastMove)`,
  `itemTurnAnnouncement(...)`, direct `session.lastMove`/`itemView` reads for display) from these consumers.
- Do NOT connect the S5 pre-move sequence or gate yet: pass `attempt: null`; reveal stage from the existing
  `useRevealSequence` (production stages stay `NO_REVEAL_STAGES`, so it is `done`/`waiting` as today);
  `restoredOrOmitted` from the existing resume/reduced-motion facts. Behaviour, timing and every visible string
  must stay identical to P1 (this step changes the source, not the experience). If an existing string would change,
  stop and report it instead of changing an assertion.
- Keep the dice/Skip semantics as today (`canRoll`/`canSkip` must equal today's enabled states when no attempt
  exists — verify; if they differ, keep today's semantics and report).
- Direct component tests (`game-hud`, `item-controls`) get a coherent display model fixture; never weaken an
  assertion. New `game-app-turn-moments.test.ts`: mounted composition reads injected publication boundaries
  consistently (inject a fake reveal stage/attempt through the props or a test seam you add to the display input
  path — keep any seam minimal and production-neutral), remaining sections use displayed progress, no consumer
  reads hidden landing/item outcomes, toast resume filtering and save-failure visibility intact, toast-expiry
  render counts unchanged.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/hud-layout.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium --workers=2
```

---

## S7: Presented-decision handoffs and action guards

Implement plan `### S7` exactly. Files: modify `src/features/game/components/GamePanel.tsx`, `GameHud.tsx`,
`InventoryPanel.tsx`, `src/app/GameApp.tsx`; modify `tests/unit/game-app-turn-moments.test.ts`,
`tests/unit/game-hud.test.ts`, `tests/unit/item-controls.test.ts` (plus the handoff row). New moments stay
inactive (no pre-move sequence wired; production reveal stages still empty).

- `GameHud` gets an independent `canSkip` prop (Skip enabled by it, not by engine `animating` alone). The dice stays
  a focusable `<button>` with `aria-disabled="true"` when `!canRoll` (never the native `disabled` attribute while a
  presentation lock is active — keep today's native-disabled behaviour only where P1 already used it and a test
  depends on it; report which), a guarded click handler, and its accessible name within `/サイコロを振る|移動中…/`.
- Guard every item action while `itemUseLocked`: use, draft editing, draft clearing (button and Escape), and
  route/direction selection — in the handlers/callbacks themselves, not only by disabling buttons, so a direct or
  stale invocation is a no-op. Inspection of already-public items (incl. passive/unusable) stays available; the card's
  使う action is disabled with the wording `演出中は使えません` during a lock.
- One presented decision (`display.decision`) drives the dialog mount, the single gameplay live region handoff
  (panel ↔ dialog ↔ ClearScreen: exactly one `role=status` at any time), item-card closing, and toast obscuration.
- Adjustment teardown: if focus would fall to `document.body`, it goes to the (aria-disabled) dice; the pending final
  focus restoration is kept until interaction becomes available. Automatic decisions keep P1 menu/log behaviour.
- Tests: every bullet of plan `### S7` → Tests, literal expectations; inject the lock through the display model.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts tests/unit/item-card.test.ts tests/unit/toast.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium --workers=2
```

---

## S8: Overlay placement and animation target refs

Implement plan `### S8` exactly. Files: new `src/features/game/components/TurnMomentHost.tsx`; modify
`src/features/game/components/GameHud.tsx`, `InventoryPanel.tsx`, `GamePanel.tsx`, `src/styles.css`; new
`tests/unit/turn-moment-components.test.ts` (plus the handoff row). `src/app/GameApp.tsx` is NOT in this step:
the host is built and tested but not mounted in production; no visible moment, no timer, no new stage.

- Pure placement helper, exported from `TurnMomentHost.tsx` (keep it with the host): inputs are the viewport,
  the map rectangle and the panel rectangle (either may be missing); it clips both to the viewport and returns the
  largest free rectangle above, beside (left/right) or below the panel inside the visible map, with its centre
  (= visible map centre for the board). Deterministic tie-break order, documented in a comment. Missing/zero-area
  input → a documented fallback (whole clipped map, else viewport); never NaN, never negative sizes.
- Pure settle-motion helper: given a source rectangle and an optional measured target rectangle, return a
  transform/opacity flight, or a local fade fallback when the target is missing, zero-sized or off-viewport.
- `TurnMomentHost` component: fixed-position host rendered as a sibling of `.game-panel` (like `ToastHost`), whole
  subtree `aria-hidden="true"`, no focusable descendants (no `button`/`a`/`tabindex`), never calls `focus()` or
  `showModal()`. Host `pointer-events: none`; only a visible card has `pointer-events: auto` and invokes an optional
  `onTap` (Skip); its `pointerdown`/`mousedown` handler calls `preventDefault()` so keyboard focus does not move.
  With nothing to show it renders no card. Content model is minimal and typed (e.g. a `children`/card slot); the
  real moment visuals arrive in S10+ — do not build dice/board/banner here.
- Measurement hook (in the same file or `TurnMomentHost.tsx`-local): measures map and panel rectangles via
  `getBoundingClientRect`, re-measures on `resize`, `scroll` (capture) and `ResizeObserver`; every listener and
  observer is removed on unmount (test with spies). Measurement must never write styles to the panel.
- Target refs: optional, typed props threaded `GamePanel` → `GameHud` (ride/service and direction values) and
  `GamePanel` → `InventoryPanel` (each slot by index, and the inventory header). Use callback refs or `RefObject`s
  on existing elements, or a wrapper that does not change layout (`display: contents` is NOT measurable — measure a
  real box). Keep every `<dt>`/`<dd>`, `data-stat`, slot count/order and class contract unchanged; absent props =
  today's DOM exactly.
- CSS in `src/styles.css`: new layer token `--layer-turn-moment` between `--layer-panel` (10) and
  `--layer-screen` (20) (so ClearScreen, map errors, toasts and the banner stay above it); `.turn-moment-host`
  (fixed, `inset: 0`, `pointer-events: none`) and a card class with `pointer-events: auto`; colours via tokens;
  `@media (prefers-reduced-motion: reduce)` disables transitions. No change to panel/HUD dimensions.
- Tests (`tests/unit/turn-moment-components.test.ts`, `// @vitest-environment jsdom` for rendering): table-driven
  placement for desktop (map full-screen, panel bottom-right), phone (panel bottom sheet), short landscape (panel
  on a side → free space beside, not above), viewport clipping, long panel content (panel taller than half the
  viewport), missing map/panel rectangles; settle helper flight vs fade fallback (missing, zero-size, off-viewport
  target); host outside `.game-panel`, `position: fixed` class, `aria-hidden`, zero focusable descendants; only the
  card receives pointer events (class contract) and `onTap` fires from it; pointer-down `defaultPrevented`;
  listeners/observers cleaned up on unmount; target refs resolve to the expected elements when passed and the
  rendered HUD/inventory markup is unchanged when absent (compare against literal expectations, not a snapshot of
  the new code). Literal expected numbers in placement tables.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-components.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts tests/unit/map-panel-observer.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/layout.spec.ts tests/e2e/hud-layout.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2
```

---

## S9: E2E readiness and explicit checkpoint helpers

Implement plan `### S9` exactly, including every row of the plan's `## E2E Re-pointing Map` whose Step column
names S9 (`support/app.ts` `rollOnce()` and `revealUnadjustedRoll()`, `accessibility.spec.ts` dice focus). Files:
modify `tests/e2e/support/app.ts`; new `tests/e2e/support/turnMoments.ts`; modify `tests/e2e/dice.spec.ts` and
`tests/e2e/accessibility.spec.ts` only where a readiness assertion depends on text alone (plus the handoff row).
**No production change** (`src/**` untouched), no unit-test change, no new moment, no screenshot.

- `rollOnce()`: after the saved result (keep the existing save-turn assertion) and any **presented** discard
  dialog (the real `role=dialog`, not a saved pending record), wait until the dice has `aria-disabled="false"`
  or ClearScreen is shown. A visible `サイコロを振る` label is not readiness (a post-reveal disabled dice keeps it).
  Ordinary helpers must stay usable under reduced motion and with a real clock.
- `revealUnadjustedRoll()`: wait for the actual adjustment dialog before continuing (no assumption that a saved
  pending adjust means it is mounted). Frozen-clock callers will advance the tumble first (S11) — document it.
- `turnMoments.ts`: explicit frozen-clock checkpoint helpers for later steps, built on Playwright `page.clock`
  (`install` / `runFor` / `pauseAt` as already used by `freezeClock`), each advancing exactly one timed stage:
  tumble, modifier stamps, movement (prime movement rAF explicitly, then advance by an explicit duration), arrival,
  lottery flip + settle, pickup. Timings are **independently specified constants** in the helper (normal speed:
  tumble 600, stamps 240, arrival 800, lottery 1,600 + settle 400, pickup 500 ms; scale by `stepMs / 450` via an
  explicit factor argument) — never imported from `src/**` and never computed through the production planner.
  No helper silently presses スキップ; a separate, explicitly named Skip helper may exist. Each helper documents
  which step activates its stage; until then calling it must not change gameplay results (stage absent → advancing
  the clock is harmless) — say so in a comment, do not add production hooks.
- `accessibility.spec.ts` dice-focus test (baseline `:51`): replace the real-clock 7-second window with explicit
  frozen-clock checkpoints (pre-move, movement, post) asserting focus at each, ending with an enabled dice
  (`aria-disabled="false"`). Keep every existing expected value; list old → new checkpoint in your report.
- `dice.spec.ts`: only change readiness that currently depends on dice text alone; keep both browser-click and
  same-task `.click()` cases and every baseline assertion. Larger dice re-pointing is S10b/S11 — do not start it.
- Never `fastForward()` across a chain of newly scheduled timers; advance and assert each boundary.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/e2e-fixture-seeds.test.ts tests/unit/game-hud.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/resume.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
```

---

## S10: Dice cube and modifier visuals, unmounted

Implement plan `### S10` exactly. Files: new `src/features/game/components/DiceTumble.tsx`; modify
`src/styles.css` and `tests/unit/turn-moment-components.test.ts` (plus the handoff row). The component is **not
mounted** anywhere in production (`GameApp`, `GamePanel`, `TurnMomentHost` callers unchanged); it owns no timer,
no sequence progression, no `animationend`/`transitionend` listener — S11 mounts it and drives it.

- Pure helpers exported from `DiceTumble.tsx` (table-tested):
  - `diceFinalOrientation(rawRoll: 1 | … | 6)` → the fixed rotation that brings that face to the front of a six-face
    CSS cube (standard die: opposite faces sum to 7). Deterministic; no `Math.random`, no presentation RNG.
  - Stamp labels from accepted facts: reuse `itemRideModifierWording()` / `compactRollFor()` wording from
    `src/features/game/hudPresentation.ts` (do not duplicate the strings): `×2`, `調整+1`, `調整-1`, `快速`, `遅延`,
    and `寝過ごし` for oversleep (its compact label; S2 decided 寝過ごし also gets a stamp). Additionally, an
    accepted `effect-activated` delay event for this turn yields `遅延` even when `rawRoll === effectiveFace === 1`
    (the wording helper cannot see it). No duplicate stamps. Deadhead / relocation → no die and no stamps.
  - The cube always lands on the saved **raw** roll, never the effective face (plan risk).
- `DiceTumble` component (`DiceTumbleProps` in the same file): a typed model with the stage (`"tumble"` |
  `"stamps"`), raw roll, stamp labels, stage duration in ms (sets a CSS custom property; animation durations come
  from it), and reduced-motion flag. Six fixed face elements with pips or numerals; transform/opacity animation only.
  The tumble keyframes reach the final orientation before the end and **hold the final pose for the last part of the
  same duration** (document the fraction; no extra time). Stamps animate in during the `stamps` stage. Root
  `aria-hidden="true"`, no focusable descendants, no live region, no text that duplicates the panel announcement
  semantics. Renders nothing for deadhead or a missing raw roll during `stamps`.
- CSS in `src/styles.css` (global BEM, colour tokens, existing layer token from S8 if needed): cube with
  `transform-style: preserve-3d`; `@supports not (transform-style: preserve-3d)` fallback shows a flat final face;
  `@media (prefers-reduced-motion: reduce)` and the reduced-motion flag show the final face/stamps with no animation.
  CSS capability must never block completion (nothing waits on CSS). Respect the existing first reduced-motion block
  that `tests/unit/ui-contrast.test.ts` reads — add new rules after it.
- Tests (extend `tests/unit/turn-moment-components.test.ts`, literal expectations): all six raw rolls → expected
  final rotation literals (and the front face shows that number); hold-fraction/duration custom property literals;
  labels for ×2, ±1, rapid, oversleep, delay (forced face) and delay on raw 1 via the effect event; deadhead renders
  no die; source has no `Math.random` and registers no `animationend`/`transitionend` listener (spy
  `addEventListener`); reduced-motion and `@supports` fallback rules exist in `styles.css` (read the file like the
  S8 tests do); decorative accessibility (`aria-hidden`, zero focusable descendants).

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-components.test.ts tests/unit/turn-moments.test.ts tests/unit/hud-presentation.test.ts tests/unit/ui-contrast.test.ts
npx vitest run
npm run build
```

---

## S10b: Integration fixtures and timing-sensitive test preparation

Implement plan `### S10b` exactly, plus the `## E2E Re-pointing Map` rows whose Step column names S10b
(`dice.spec.ts` repeated clicks / half-hop / natural completion, `resume.spec.ts` reload during movement,
`save-errors.spec.ts`) — **preparation only**: production stage lists stay empty, no production delay, no `src/**`
change. Files: modify `tests/unit/game-app-turn-moments.test.ts`, `tests/unit/game-app-item-progress.test.ts`,
`tests/e2e/support/app.ts`, `tests/e2e/support/turnMoments.ts`, `tests/e2e/dice.spec.ts`,
`tests/e2e/resume.spec.ts`, `tests/e2e/save-errors.spec.ts` (plus the handoff row).

- Unit fixtures/assertions (reusable, named, documented, with literal expectations): accepted-save observation tied
  to the acknowledged save boundary (distinct from pending `committing` and from save failure); pending-adjust
  resume without a tumble replay; save failure stays visible and does not start an accepted sequence twice; speed
  captured for the active attempt, a 速度 change applies to the next turn; same-task duplicate clicks accept exactly
  one turn. Where production has no attempt yet (`attempt: null`), assert today's behaviour and leave a clearly
  named fixture S11 can switch on — do not fake an attempt in production code.
- E2E helpers (S9 open finding): split `revealUnadjustedRoll()` into a click step and an outcome-wait step (e.g.
  `clickDice(page)` + `waitForRollOutcome(page)`), so frozen-clock callers can advance the tumble between them from
  S11; `revealUnadjustedRoll()` keeps its current behaviour by composing the two. Export whatever S9 checkpoint
  helpers the specs below need; keep `turnMoments.ts` free of `src/**` imports and its timings independent.
- Specs: re-point the S10b rows to explicit S9 checkpoints while **retaining every baseline assertion and expected
  value**; keep both browser-click and same-task `.click()` cases in `dice.spec.ts`; no silent Skip in a
  natural-completion test; movement durations are exact (distance-based via P1 `buildMovePlan` + `hopDurationMs`,
  capped at `MAX_MOVE_DURATION_MS`, as `accessibility.spec.ts` and `capital-region.spec.ts` do), never
  `physicalHops × STEP_MS`. Mark with a comment where S11 inserts `advanceTumble`/`advanceStamps`.
- Report every old → new checkpoint and confirm the expected value is unchanged. Run each changed spec twice.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/turn-moment-hooks.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/dice.spec.ts tests/e2e/resume.spec.ts tests/e2e/save-errors.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/capital-region.spec.ts --project=desktop-chromium --workers=2
```

---

## S11: Enable tumble, adjustment, stamps, and one Skip

Implement plan `### S11` exactly — the first visible production moment — plus every `## E2E Re-pointing Map` row and
the "Additional unit re-pointing required in S11" list whose Step column includes S11. Files: modify
`src/app/GameApp.tsx`, `src/features/game/animation/useTurnMoments.ts`, `src/features/game/turnMomentPresentation.ts`
(only as needed), `src/features/game/components/TurnMomentHost.tsx`, `RollAdjustment.tsx`, `GamePanel.tsx` wiring;
tests `tests/unit/game-app-turn-moments.test.ts` (+ the S10b fixtures), `tests/unit/game-app-item-progress.test.ts`
(the `:422` rAF re-point), new `tests/e2e/ui-pop-turn-moments.spec.ts`, and the S11 re-points in
`tests/e2e/dice.spec.ts`, `capital-region.spec.ts`, `resume.spec.ts`, `items.spec.ts`, `accessibility.spec.ts`,
`lottery.spec.ts` (`:57`), `save-errors.spec.ts` (plus the handoff row). Post-move stages stay empty
(`NO_REVEAL_STAGES`): arrival/lottery/pickup are S12–S15; the app must never wait for an unrendered stage.

- `GameApp`: wrap the roll — `begin` the attempt and call `app.roll()` in the same accepted handler; capture timing
  (`turnMomentTiming(stepMs)`) and movement `stepMs` at that moment. Pass the S5 hook's `attempt` into
  `deriveTurnMomentDisplay` (no longer `attempt: null`) and `movementStartAllowed` into `useMoveAnimation(..., {
  startAllowed })`, keeping `session.animation` supplied while gated. Mount `TurnMomentHost` as a sibling of
  `.game-panel` (like `ToastHost`) with `DiceTumble` built by `diceTumbleModelFor(...)` from the **saved raw roll**
  during `tumble`/`stamps`; card tap and スキップ call the one shared Skip.
- Adjustment only after tumble (display model already gates `decision` at `awaiting-adjust`); `RollAdjustment` gets
  an optional shared Skip button that preserves the chosen radio and still requires Continue (Skip ends the
  presentation, not the decision). Focus rules from S7 stay.
- Reduced motion and restored pending rolls omit tumble; one Skip covers waiting-for-save, tumble, stamps, inside
  adjustment and movement; a pending-save Skip survives until the accepted animation exists; double/triple clicks
  commit one turn; reduced motion toggled mid-attempt never replays; save failure does not advance, a successful
  retry advances exactly once; a 速度 change during tumble does not change that turn's movement speed.
- Carry-overs recorded in the handoff for S11 (S7–S10b rows) — resolve each and list it: `guardedAdjustItemRoll` /
  `guardedEditItemDraft` failing-without tests; stable target refs (no inline callback ref churn); host placement must
  not cover MapLibre zoom/attribution controls while the card is `pointer-events: auto`; stamp key uniqueness; a table
  test tying `diceStampLabels(r).length > 0` to the S2 stamps predicate; frozen-clock callers of
  `revealUnadjustedRoll()` use the S10b split helpers with `advanceTumble` between click and dialog wait.
- E2E: new `ui-pop-turn-moments.spec.ts` with motion enabled and saved records as the oracle (cube final face =
  saved `rawRoll`; no movement frame and no adjustment dialog before tumble ends; one tumble across adjustment;
  stamps precede movement; modal Skip; reload during tumble / pending adjust does not replay). Re-pointed specs keep
  every baseline assertion and expected value; movement durations exact (P1 `buildMovePlan` + `hopDurationMs`,
  capped); no silent Skip in natural-completion tests. Report old → new for every re-point.
- Screenshots (cloud: use the helper in the handoff with `E2E_HOST=127.0.0.1`, delete the temporary spec after):
  `.claude/logs/screenshots/p2-s11-desktop-dice-landed.png`, `p2-s11-desktop-adjust-after-tumble.png`,
  `p2-s11-phone-stamp.png` (frozen clock at the named checkpoint).

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/move-animation-gate.test.ts tests/unit/turn-moment-components.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/game-hud.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/resume.spec.ts tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/lottery.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/save-errors.spec.ts --project=desktop-chromium
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=phone-chromium
```

---

## S12: Enable arrival and delayed goal presentation

Implement plan `### S12` exactly, plus the `## E2E Re-pointing Map` rows whose Step column includes S12
(`capital-region.spec.ts:325` natural landing, `items.spec.ts:436` long rapid goal, `dice.spec.ts:203` natural
completion). Files: modify `src/features/game/animation/turnMoments.ts` (add `buildTurnRevealStages()` with the
arrival stage only), `src/features/game/components/TurnMomentHost.tsx`, `src/features/game/turnMomentPresentation.ts`,
`src/app/GameApp.tsx`, `src/styles.css`; tests `tests/unit/turn-moments.test.ts`,
`tests/unit/turn-moment-presentation.test.ts`, `tests/unit/game-app-turn-moments.test.ts`,
`tests/e2e/ui-pop-turn-moments.spec.ts`, `items.spec.ts`, `dice.spec.ts`, `capital-region.spec.ts` (natural-completion
case), `accessibility.spec.ts` (post checkpoint) (plus the handoff row).

- Arrival is the **only** production post stage at this step (`buildTurnRevealStages()` returns `["arrival"]` for a
  fresh item-mode arrival, including deadhead, no-new-segment and goal turns; nothing for classic mode, reduced
  motion, restored or omitted results). Duration from the attempt's captured timing (normal 800 ms). Lottery and
  pickup stay unbuilt (S14/S15): publish the next ride, lottery text, candidates and item results when `arrival`
  ends. The completed-segment flash is S13 — do not add it.
- Arrival banner in `TurnMomentHost` (decorative, `aria-hidden`, no focusable descendants, card tap = shared Skip,
  placement as S8/S11 incl. map-control insets): arrival station name; marker on the ridden service's arrival
  platform until publication (S3 rule).
- Goal: movement → arrival banner → ClearScreen. During the goal banner `GamePanel` stays mounted although the
  engine status is completed, dice/items unavailable, Skip available, ClearScreen not mounted and its focus effect
  not run. ClearScreen mount, map inertness and `game_clear` analytics all key off the same `display.showClear`
  (grep for every raw `status === "completed"`/clear condition in `GameApp` and route it through the display).
  Goal announcement is owned by ClearScreen only (no duplicate before replacement).
- Announcements (architecture "Announcements"): replace the movement-phase P1 `itemTurnAnnouncement` copy (S11
  carry-over: it leaks physical hops, unused pips such as `2駅移動、残り2は使わず`, and landing) with raw face +
  published modifiers + movement wording; arrival: arrival wording, no selected next ride; ready after publication:
  existing full announcement + `サイコロを振れます`. Exactly one gameplay `role=status`, one change per boundary.
- Omission: reduced motion and restored results mount no banner; reduced motion toggled on/off during arrival
  omits that arrival without replay; Skip during arrival completes it; a resumed arrival does not replay.
- E2E: natural-completion tests advance `advanceArrival` explicitly after movement and assert arrival state
  (arrival station, ridden highlight/platform) before publication, then the existing final assertions — never
  replace natural completion with Skip; long rapid goal: movement cap, goal banner with no ClearScreen, advance
  arrival, focused ClearScreen; keep every baseline assertion and value; report old → new.
- Screenshots (frozen clock, temporary `tests/e2e/zz-p2-shot.spec.ts`, deleted after):
  `.claude/logs/screenshots/p2-s12-desktop-arrival.png`, `p2-s12-desktop-goal-banner.png`,
  `p2-s12-desktop-clear-after-banner.png`.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/analytics.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/lottery.spec.ts tests/e2e/resume.spec.ts tests/e2e/full-game.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium --workers=2
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/accessibility.spec.ts --project=phone-chromium --workers=2
```

---

## S13: Concurrent completed-segment flash

Implement plan `### S13` exactly and the architecture's "Map flash" section. Files: modify
`src/features/map/mapConfig.ts`, `src/features/map/railwayLayers.ts`, `src/features/map/RailwayMap.tsx`,
`src/app/GameApp.tsx`; `src/features/game/turnMomentPresentation.ts` (and `animation/turnMoments.ts` only if the
accepted facts need the IDs) to produce `display.segmentFlash: SegmentFlashRequest | null` — `src/**` has no such
field yet; new `tests/unit/map-flash.test.ts`; modify `tests/unit/map-station-markers.test.ts`, the affected mocks in
`tests/unit/capital-region-scaling.test.ts`, `tests/e2e/support/app.ts` (map observation), and
`tests/e2e/ui-pop-turn-moments.spec.ts` (plus the handoff row). No new stage: the flash runs concurrently with
`arrival` and adds no delay; arrival without new target segments keeps its banner and has no flash.

- Flash request (`{ key, featureIds, durationMs }`): `key` = the reveal key; `featureIds` = **newly completed target
  segment IDs captured from the accepted record's movement events** (not a React-to-React progress diff, which also
  changes during hops, Skip, resume and session replacement); `durationMs` = the attempt's captured `arrivalMs`.
  Non-null only while the presented stage is `arrival` with at least one new ID; null for restored/omitted results,
  reduced motion, Skip, classic mode, and after arrival ends.
- Map: exactly one new layer (e.g. `railway-segments-flash`) above completed segments and below stations, reusing
  the segments source and the target-scoped feature-ID filter helper; the completed layer's ID and filter shape
  unchanged. Initialised with an empty filter and opacity 0. Pure `segmentFlashOpacity(elapsedMs, durationMs)`
  envelope (one bounded pulse, 0 at both ends, no strobe; table-tested with literals). `RailwayMap` owns a local rAF
  loop keyed by the request key: check layer existence before every write; cancel and clear filter/opacity on null
  request, Skip, screen change and teardown; reapply current state on `layersRevision` (style reload) without
  restarting — keep the original deadline; if the deadline expired during reload, the new layer stays empty. A missing
  map/layer never blocks stages or decisions.
- Tests: layer count 10 → **11** with the exact new order asserted (update every mock that asserts the count/order;
  never loosen to "at least"); empty init; one bounded pulse; only new target IDs; null/Skip/reduced motion/screen
  change/teardown clear it; style reload reapplies without resetting the deadline; reload after expiry leaves it empty;
  missing map/layer never blocks. Real-GameApp tests (as S11/S12): flash IDs for a turn completing segments, none for
  a no-new-segment turn, none after resume, none under reduced motion toggled mid-turn, cleared by Skip.
- E2E: extend map observation in `support/app.ts` (flash layer filter/opacity) and add a case in
  `ui-pop-turn-moments.spec.ts`: during arrival the flash filter holds exactly the record's newly completed target
  IDs; after `advanceArrival` / Skip / screen change it is empty. Keep every existing `map-visual`/`capital-region`
  assertion and value.
- Screenshot: `.claude/logs/screenshots/p2-s13-desktop-arrival-flash.png` (frozen clock mid-arrival).

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/map-flash.test.ts tests/unit/map-station-markers.test.ts tests/unit/capital-region-scaling.test.ts tests/unit/map-panel-observer.test.ts tests/unit/game-app-turn-moments.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/dice.spec.ts tests/e2e/layout.spec.ts --project=desktop-chromium --workers=2
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=phone-chromium --workers=2
```

---

## S14: Enable lottery flip, settle, and atomic ride publication

Implement plan `### S14` exactly, the architecture's stage table (`lottery-flip` / `lottery-settle` rows and the
paragraphs after it), its lottery-board paragraph, and the `## E2E Re-pointing Map` rows whose Step column includes
S14 (`dice.spec.ts:203` natural completion, `lottery.spec.ts:57`/`:58`, `resume.spec.ts:79` lottery reload case,
`capital-region.spec.ts:325` natural landing, `items.spec.ts:398` reduced-motion overlay absence,
`accessibility.spec.ts:51` post checkpoint). Files: new `src/features/game/components/LotteryReveal.tsx`; modify
`src/features/game/components/TurnMomentHost.tsx`, `src/features/game/animation/turnMoments.ts`
(`buildTurnRevealStages`), `src/features/game/turnMomentPresentation.ts`, `src/features/game/presentation.ts`
(announcement only), `src/app/GameApp.tsx` / `src/features/game/components/GamePanel.tsx` /
`src/features/game/components/GameHud.tsx` only to wire the settle target refs, `src/styles.css`; tests
`tests/unit/turn-moments.test.ts`, `tests/unit/turn-moment-presentation.test.ts`,
`tests/unit/turn-moment-components.test.ts`, `tests/unit/game-app-turn-moments.test.ts`,
`tests/e2e/support/turnMoments.ts`, `tests/e2e/ui-pop-turn-moments.spec.ts`, `tests/e2e/lottery.spec.ts`,
`tests/e2e/dice.spec.ts`, `tests/e2e/capital-region.spec.ts`, `tests/e2e/resume.spec.ts`, `tests/e2e/items.spec.ts`,
`tests/e2e/accessibility.spec.ts` (plus the handoff row). Pickup stays unbuilt (S15).

- Stages: `buildTurnRevealStages()` returns `["arrival", "lottery-flip", "lottery-settle"]` only when the accepted
  record's landing had `serviceDrawRequired || directionDrawRequired`; otherwise `["arrival"]` as at S12. Goal and
  deadhead never get lottery stages; classic mode, reduced motion, restored or omitted results get nothing.
  Durations from the attempt's captured timing (normal flip 1,600 ms + settle 400 ms; scaled by the captured speed).
  Freeze the stage list per reveal key (S5 rule) — no empty stage, no placeholder delay.
- Publication (one `lotteryPublished` predicate, S4): when lottery stages exist, the next ride, HUD ride row, map
  highlight, platform marker (ridden service's arrival platform until then — assert separately from the highlight),
  lottery log text, candidates, upcoming stations and item results publish together at the end of `lottery-settle`;
  without a draw they still publish at the end of `arrival`. Skip during `lottery-flip` or `lottery-settle`
  completes the whole presentation at once.
- `LotteryReveal` in `TurnMomentHost` (decorative, `aria-hidden`, no focusable descendants, card tap = shared Skip,
  placement at the visible map centre as S8/S11/S12 incl. map-control insets): two rows — existing `LineBadge` +
  service name, then direction (existing direction resolution/wording). Only a drawn row flips; a forced row is shown
  stable from the start. Intermediate frames deterministic (derived from the record/candidates, no `Math.random`);
  the board stops on the saved landing service/direction. No probabilities, weights or invented line codes.
  `lottery-settle`: the board travels toward the HUD ride row (`TurnMomentTargets.ride` / `direction`); measure with
  stable `RefObject`s or memoised callbacks (S8 note: inline callback refs re-attach every render). Missing or
  zero-size target → local fade with the same deadline; the stage end never depends on the target.
- Announcements: during `lottery-flip`/`lottery-settle` keep the arrival wording and say `抽選結果を表示しています`
  **only when a draw happened** (`serviceDrawRequired || directionDrawRequired`; carry-over from S12); never name
  the selected next ride before publication; after settle the existing full landing announcement (+ `サイコロを振れます`
  when `canRoll`). Exactly one gameplay `role=status`, one change per boundary.
- Omission: reduced motion toggled on or off during flip or settle omits the rest without replay; reload during
  lottery does not replay (restored); resolving a restored adjust plays normally.
- E2E helpers: `advanceLotteryFlip` / `advanceLotterySettle` in `tests/e2e/support/turnMoments.ts` must
  `awaitStage` their stage first (extend `PresentedStage` and give the board a stage marker such as
  `data-stage`); natural-completion tests advance arrival → flip → settle explicitly when a draw occurs and keep
  every baseline assertion and value; report old → new for every re-pointed line.
- Carry-over for this file only if you touch it: none required in `turn-moment-components.test.ts` beyond the
  new LotteryReveal cases (the `hasCard`/vacuous-assertion cleanup is S16).
- Screenshots (frozen clock, temporary `tests/e2e/zz-p2-shot.spec.ts`, deleted after; never committed):
  `.claude/logs/screenshots/p2-s14-desktop-lottery-flip.png`, `p2-s14-desktop-lottery-settle.png`,
  `p2-s14-phone-lottery.png`.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/turn-moment-components.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/line-badge.test.ts
npx vitest run
npm run build
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/resume.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium --workers=2
env -u WAYLAND_DISPLAY npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/accessibility.spec.ts --project=phone-chromium --workers=2
```

---

## R: Reviewer prompt body (Codex Sol low, read-only)

Objective: Review the uncommitted change for step {STEP} of `.claude/docs/plans/ui-pop-turn-moments-plan.md`
in `/home/yuulis/yamanote-line-sugoroku` (read-only). Read the plan Summary and its `### {STEP}` section, the
`## {STEP}:` section of `.claude/docs/plans/ui-pop-turn-moments-prompts.md`, the architecture
`.claude/docs/plans/ui-pop-turn-moments-architecture.md` where relevant, and `git diff HEAD` plus untracked files.
Check: the step's requirements are fully met (no stubs/TODO); only owned files changed; no forbidden path; no
weakened, skipped or deleted assertion and expected values unchanged; production never runs an invisible timed
stage before its activation step; no result published before its boundary; reduced-motion and resume omission;
Skip semantics; timers cancelled on key/stage change, skip and unmount; exactly one gameplay status region;
overlay aria-hidden and never focused; dice text contract; conventions (named exports, `XxxProps`, global BEM
CSS, `.test.ts`, stable harness for lifecycle tests); no new dependencies.
Output format: `## Verdict (ACCEPT / CHANGES_REQUIRED)`, `## Blocking Findings` (file:line, why, fix),
`## Non-blocking`, `## Checks Not Verifiable From the Diff`.
