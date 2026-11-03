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
