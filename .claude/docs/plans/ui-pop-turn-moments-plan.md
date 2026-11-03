# UI Pop P2 (Turn Moments) — Implementation Plan

## Summary

Implement the approved architecture in 17 independently verifiable steps. Land presentation plumbing first, then enable dice, arrival, lottery, and pickup moments one at a time. Every intermediate commit must remain shippable.

- **Baseline:** `70decd6`, P0+P1, v0.11.0.
- **Complexity:** COMPLEX.
- **Architecture:** `.claude/logs/codex/20261103T131001Z-p2-architecture.md`.
- **Inputs:** `.claude/docs/research/feature-ui-pop-turn-moments-{brief,codebase}.md`, `.claude/logs/codex/20261103T130704Z-p2-scope.md`.
- **Handoff:** `.claude/docs/plans/ui-pop-turn-moments-handoff.md`, maintained by the lead after every step.
- **Status:** Implementation plan only. No implementation, application tests, build, or browser verification was performed while preparing this document.

Use two presentation sequences and one shared display derivation:

1. A roll-attempt reducer controls saved raw-roll observation, tumble, adjustment, stamps, and movement release.
2. `useRevealSequence` controls arrival, lottery flip/settle, and pickup.
3. `deriveTurnMomentDisplay()` owns publication across HUD, map, log, candidates, inventory, decisions, announcements, toasts, and ClearScreen.

The engine remains ahead of presentation and saves at its existing boundaries. Presentation state never becomes save input.

**Hard scope boundaries**

Do not modify engine/RNG logic, persistence, save schemas, `src/types/network.ts`, or `public/data/**`. Keep `gameSession.ts`, `itemSession.ts`, and `useGameApp.ts` unchanged; wrap their existing handlers from `GameApp`. Add no dependencies, runtime feature flags, sound, P3 features, or release work.

**Incremental activation**

Unused components and hooks may land with tests before integration. Production must never run an invisible timed stage. Keep production post-move stages empty until S12; add lottery stages in S14 and pickup in S15 alongside their complete rendering and publication wiring. This is implementation sequencing, not a permanent feature-toggle mechanism.

**Execution contract for every step**

1. The lead writes a bounded prompt containing the step’s files, invariants, tests, and acceptance commands.
2. Codex Luna, high effort, writes tests with or before implementation.
3. Codex Sol, low effort and read-only, reviews the complete step diff.
4. The lead independently runs acceptance commands, inspects deletions and test changes, and checks the forbidden paths.
5. The lead updates the handoff with implementation/review references, commands and results, screenshots, risks, and the next step.
6. The lead commits the verified step and **pauses for user review**. Do not begin the next step until the user resumes.

Changed-LOC budgets include tests and CSS. Keep each implementation step below approximately 400 changed LOC. If a written prompt cannot fit, revise its boundary before execution; do not leave a partially enabled visible moment.

**Local verification policy**

Use targeted Vitest and Playwright suites. The full four-browser E2E matrix belongs to CI. The actual local projects are `desktop-chromium`, `phone-chromium`, and `desktop-firefox`; `desktop-webkit` is conditional in `playwright.config.ts`. The commands below deliberately select Chromium projects.

Run this forbidden-path audit at every implementation checkpoint:

```bash
git diff --exit-code 70decd6 -- src/features/game/engine src/features/game/store src/features/game/gameSession.ts src/features/game/itemSession.ts src/features/game/useGameApp.ts src/types/network.ts public/data
```

Also inspect untracked files and the complete delegated diff; a successful audit or verification script does not replace review.

**Screenshot convention**

Capture browser checkpoints into `.claude/logs/screenshots/` using `page.screenshot({ path, fullPage: false })` at explicit frozen-clock checkpoints. Use the filenames specified below. Screenshots supplement assertions and are not snapshot baselines that may be updated to hide regressions.

Abbreviations in file lists:

- `G/` = `src/features/game/`
- `C/` = `src/features/game/components/`
- `M/` = `src/features/map/`
- `U/` = `tests/unit/`
- `E/` = `tests/e2e/`

## Implementation Steps

| ID | Title | Size, changed LOC including tests | Depends on |
|---|---|---:|---|
| S1 | First-commit omission and future-key Skip support | XS, 40–70 | — |
| S2 | Pure timing, accepted facts, and roll-attempt reducer | M, 260–350 | S1 |
| S3 | Shared movement, ride, and log publication model | S, 180–250 | S2 |
| S4 | Safe item view, decisions, and announcements | M, 220–300 | S3 |
| S5 | Movement start gate and sequence hook | M, 260–350 | S1–S4 |
| S6 | Adopt the shared display model across consumers | M, 220–320 | S3–S5 |
| S7 | Presented-decision handoffs and action guards | S, 170–240 | S6 |
| S8 | Overlay placement and animation target refs | M, 240–330 | S6–S7 |
| S9 | E2E readiness and explicit checkpoint helpers | S, 120–190 | S6–S7 |
| S10 | Dice cube and modifier visuals, unmounted | S, 160–230 | S2, S8 |
| S10b | Integration fixtures and timing-sensitive test preparation | S, 120–190 | S9, S10 |
| S11 | Enable tumble, adjustment, stamps, and one Skip | M, 260–350 | S5–S10b |
| S12 | Enable arrival and delayed goal presentation | M, 200–290 | S11 |
| S13 | Concurrent completed-segment flash | M, 270–370 | S12 |
| S14 | Enable lottery flip, settle, and atomic ride publication | M, 290–390 | S12–S13 |
| S15 | Enable pickup and delayed discard handoff | M, 290–390 | S14 |
| S16 | Combined lifecycle and responsive browser verification | M, 180–280 | S15 |
| S17 | Lead-owned design and final handoff documentation | S, 80–140 documentation LOC | S16 |

## Step Details

### S1 — First-commit omission and future-key Skip support

**Goal**

Fix the known reduced-motion first-commit bug before any nonempty production stage exists.

**File changes**

- Modify `G/animation/useRevealSequence.ts`.
- Modify `U/reveal-sequence.test.ts`.

Fold `reducedMotion || skipRequested` into both new-key and same-key observation branches. Add optional `skipRequested`, remove effect-delayed reduced-motion completion, and keep completion sticky for the key.

**Tests**

Extend the existing `useLayoutEffect` commit-recording harness:

- A fresh nonempty key under reduced motion never commits `busy:true` or an active stage.
- Before movement completes: `stage:"done"`, `busy:false`, `ready:false`.
- After movement completes: `ready:true`.
- Skip supplied before a record exists omits that future key on its first observation.
- Turning reduced motion off does not replay the key.
- Equivalent stage arrays preserve deadlines; omission and unmount leave no timers.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/reveal-sequence.test.ts
npm run build
```

No E2E is required: production stages remain empty.

**User review checkpoint**

Review the first-commit assertions and unchanged production behavior. Capture the initial reference image:

`.claude/logs/screenshots/p2-s01-desktop-baseline.png`

**Risks**

Changing `ready` to mean omission alone would publish results before logical movement completion. Preserve its dependency on `movementComplete`.

---

### S2 — Pure timing, accepted facts, and roll-attempt reducer

**Goal**

Define the pre-move state machine and its identities without connecting it to production.

**File changes**

- New `G/animation/turnMoments.ts`.
- New `U/turn-moments.test.ts`.

Implement timing, normalized accepted observations, origin snapshots, and reducer actions `begin`, `observe`, `advance`, `skip`, and `reset`.

Use:

- Attempt key: `${sessionId}:roll:${game.turn + 1}:${decisionRevision}`.
- Expected record turn stored on the attempt.
- Existing reveal key: `${sessionId}:${recordTurn}`.

Read raw rolls only from acknowledged `awaiting-adjust` or accepted records. Capture newly completed target segments from movement events while available. Keep Skip intent until the next accepted roll or session boundary.

Reserve the post-stage types here; production stage planning is added with the visible integrations.

**Tests**

Table-driven tests for:

- Slow/normal/fast durations, using the `"normal"` entry in `ANIMATION_SPEEDS`.
- One tumble across adjustment and later record attachment.
- Stale key/stage actions, duplicate observations, and reset.
- Skip before acknowledgement, before record creation, and through adjustment.
- Restored pending rolls omitting tumble while allowing a subsequently created arrival.
- Deadhead without a die.
- Delay activation when raw roll is already 1.
- Segment IDs restricted to newly completed target segments.

Normal timings: tumble 600 ms, stamps 240 ms, arrival 800 ms, lottery flip 1,600 ms, settle 400 ms, pickup 500 ms.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/reveal-sequence.test.ts
npm run build
```

**User review checkpoint**

Review the reducer transition table and timing expectations. No new UI is mounted; use the S1 reference screenshot.

**Risks**

A record-based tumble identity causes adjustment to tumble twice. Reading `pending.rawRoll` during `committing` violates the existing save-attempt boundary.

---

### S3 — Shared movement, ride, and log publication model

**Goal**

Create the pure display derivation for progress, ride, roll, candidates, and ClearScreen eligibility.

**File changes**

- New `G/turnMomentPresentation.ts`.
- New `U/turn-moment-presentation.test.ts`.

Reuse domain types and existing presentation helpers. Accept sequencing state and the existing `AnimationView`; do not introduce another gameplay model.

**Tests**

Assert publication across pre-move, movement, arrival, lottery flip/settle, and completion:

- Origin station/progress remain visible while movement is gated.
- Progress follows completed hops during movement.
- Before lottery publication, the arrival marker uses the ridden service’s platform.
- HUD ride, upcoming-station input, map highlight, lottery text, and candidates publish together after settle.
- Forced rides publish after arrival.
- Detailed roll text with physical hops/unused pips remains hidden before arrival.
- Goal eligibility remains false through arrival.
- Restored results display immediately.

Use independent expected values and engine-built records rather than expectations calculated by the function under test.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/animation.test.ts tests/unit/game-presentation.test.ts
npm run build
```

**User review checkpoint**

Review the publication-boundary test matrix. No production wiring or new screenshot is required.

**Risks**

Masking the service label while exposing the next platform, candidates, remaining-section list, or full roll text still leaks results.

---

### S4 — Safe item view, decisions, and announcements

**Goal**

Complete the shared display model’s inventory, effects, interaction permissions, announcement, and toast outputs.

**File changes**

- Modify `G/turnMomentPresentation.ts`.
- Modify `G/presentation.ts`.
- New `U/turn-moment-items.test.ts`.
- Modify `U/game-presentation.test.ts`.

Construct the safe item view from the origin snapshot. Preserve live action identity for callbacks without exposing final item contents.

**Tests**

Cover:

- Pre-move consumed items disappear at stamp completion.
- Pickup, arrival effects, certificate consumption, hints, and availability remain masked until their publication boundary.
- Retained pickup versus full-inventory pending discard.
- Harmful drops and certificate cancellation publish without a pickup flight.
- Adjustment appears after tumble; discard appears after pickup.
- `canRoll`, `canSkip`, and `itemUseLocked` throughout the sequence.
- Announcements contain no hidden roll, ride, pickup, or early ready instruction.
- Toast inputs remain unpublished until eligible.
- A same-turn discard update exposes new notices without changing the stage plan.
- Goal announcement ownership passes to ClearScreen without duplicate completion wording.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-items.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/game-presentation.test.ts tests/unit/toast.test.ts
npm run build
```

**User review checkpoint**

Review the inventory/certificate/discard boundary cases. No production behavior changes or new screenshot is required.

**Risks**

Removing only the new inventory instance is insufficient: final effects, certificate removal, and hints can reveal the outcome. Do not fabricate a new domain unavailable-reason value.

---

### S5 — Movement start gate and sequence hook

**Goal**

Implement the hooks that coordinate timers, movement release, omission, and Skip without enabling production moments.

**File changes**

- Modify `G/animation/useMoveAnimation.ts`.
- New `G/animation/useTurnMoments.ts`.
- New `U/move-animation-gate.test.ts`.
- New `U/turn-moment-hooks.test.ts`.

Add the final optional `MoveAnimationOptions` parameter, defaulting `startAllowed` to true. Continue constructing the plan and view while gated; never replace the animation input with `null`.

The new hook owns the pre-move reducer, delegates post-move sequencing to `useRevealSequence`, and accepts the production stage list. Freeze timing at the accepted attempt and stage configuration at the reveal key.

**Tests**

Use stable jsdom harnesses and fake timers/frame schedulers:

- Closed gate: origin view with `frame:null`, empty live position, no movement frame request.
- Opening the gate starts once.
- Instant movement, stale finish identities, session replacement, and cleanup.
- Only the current presentation stage has a timer.
- Same-turn event append and equivalent inputs do not restart timers.
- Latched Skip finishes an animation appearing after adjustment/save without running it.
- Reduced motion mid-turn irreversibly omits sequences and releases instant movement.
- Restored pending-adjust resolution is a fresh arrival, not a replayed tumble.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/move-animation-gate.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/turn-moments.test.ts tests/unit/reveal-sequence.test.ts tests/unit/animation.test.ts
npm run build
```

**User review checkpoint**

Review timer/frame cleanup evidence and the closed-gate assertions. Production callers retain default behavior; use the S1 reference screenshot.

**Risks**

An unstable stage list can restart deadlines. Losing Skip at modal closure can start unwanted movement after the user has already skipped.

---

### S6 — Adopt the shared display model across consumers

**Goal**

Make the shared derivation the production source for visible values while retaining the existing timing.

**File changes**

- Modify `src/app/GameApp.tsx`.
- Modify `C/GamePanel.tsx`.
- Modify `U/game-hud.test.ts` and affected `U/item-controls.test.ts` fixtures.
- New `U/game-app-turn-moments.test.ts`.

Feed the shared display into panel values, map progress/highlight, log, candidates, inventory/effects, announcements, toast acceptance, and ClearScreen eligibility. Remove corresponding independent raw-session derivations.

Do not connect the new pre-move sequence yet. Production post stages remain empty. Update direct component fixtures to supply a coherent display model.

**Tests**

- Existing idle/resume/classic behavior and canonical strings remain intact.
- Mounted production composition reads injected publication boundaries consistently.
- Remaining sections use displayed progress.
- No consumer independently reads hidden landing/item outcomes.
- Toast resume filtering and save-failure visibility remain intact.
- Existing toast-expiry render-count expectations remain valid.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts
npm run build
npx playwright test tests/e2e/hud-layout.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium
```

**User review checkpoint**

Capture `.claude/logs/screenshots/p2-s06-desktop-display-adoption.png`.

Compare the idle HUD, open log, inventory, and resumed state with P1. This step introduces the shared source, not a new delay.

**Risks**

Leaving one raw-state consumer defeats the mask. Avoid a permanent alternate derivation for active P2 turns.

---

### S7 — Presented-decision handoffs and action guards

**Goal**

Make dialogs, focus, toast obscuration, and action permissions consume the same presented decision.

**File changes**

- Modify `C/GamePanel.tsx`.
- Modify `C/GameHud.tsx`.
- Modify `C/InventoryPanel.tsx`.
- Modify `src/app/GameApp.tsx`.
- Modify `U/game-app-turn-moments.test.ts`, `U/game-hud.test.ts`, and `U/item-controls.test.ts`.

Add independent `canSkip`. Keep the dice focusable with `aria-disabled`, a guarded handler, and its existing accessible-name pattern.

Guard item use, draft editing/clearing, Escape draft clearing, and route/direction selection. Keep public-item inspection available; disable its use action with presentation wording during a lock.

**Tests**

- Engine `idle` does not permit actions during a presented lock.
- Direct/stale callback invocation cannot bypass guards.
- Inspection remains available for public passive/unusable items.
- Panel/dialog handoffs preserve exactly one gameplay status region.
- Cards close when a presented decision opens.
- Toast obscuration begins with that same decision.
- Adjustment teardown has a safe dice focus target; final restoration is not lost.
- Automatic decisions preserve P1 menu/log behavior.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts tests/unit/item-card.test.ts tests/unit/toast.test.ts
npm run build
npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium
```

**User review checkpoint**

Capture `.claude/logs/screenshots/p2-s07-desktop-item-inspection.png`.

Review inspection/use separation and keyboard focus. New moments remain inactive.

**Risks**

Button-only guards leave Escape and callbacks active. Native-disabled dice would break the existing focus contract.

---

### S8 — Overlay placement and animation target refs

**Goal**

Build and test the fixed overlay host and target measurement without mounting a visible production moment.

**File changes**

- New `C/TurnMomentHost.tsx`.
- Modify `C/GameHud.tsx`, `C/InventoryPanel.tsx`, and `C/GamePanel.tsx` for optional target refs.
- Modify `src/styles.css`.
- New `U/turn-moment-components.test.ts`.

Keep the pure rectangle-selection helper with the host. Measure viewport-clipped map/panel rectangles and choose the largest free rectangle above, beside, or below the panel.

Add optional ride/direction, inventory-slot, and inventory-header targets without changing existing `<dt>`, `<dd>`, `data-stat`, or slot contracts.

**Tests**

- Desktop, phone, short landscape, clipping, long content, and missing rectangles.
- Host is outside `.game-panel`, fixed, `aria-hidden`, and has no focusable descendants.
- Only the visible card receives pointer events.
- Pointer-down prevents focus movement.
- Missing targets select a local fade fallback.
- Measurement listeners/observers clean up.
- No panel dimension or camera-observer contract changes.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-components.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts tests/unit/map-panel-observer.test.ts
npm run build
npx playwright test tests/e2e/layout.spec.ts tests/e2e/hud-layout.spec.ts --project=desktop-chromium --project=phone-chromium
```

**User review checkpoint**

Capture `.claude/logs/screenshots/p2-s08-phone-target-refs.png`.

Review unchanged panel dimensions. Host positioning is reviewed through its tests now and through actual moments beginning in S11.

**Risks**

Assuming free space is always above the panel fails in landscape. Target wrappers must not alter layout or overlap attribution, zoom controls, map errors, or toasts.

---

### S9 — E2E readiness and explicit checkpoint helpers

**Goal**

Prepare browser helpers before new timing becomes visible.

**File changes**

- Modify `E/support/app.ts`.
- New `E/support/turnMoments.ts`.
- Modify helper consumers in `E/dice.spec.ts` and `E/accessibility.spec.ts` where readiness assertions currently depend on text alone.

`rollOnce()` must wait for a presented discard dialog when required, then a dice button with `aria-disabled="false"` or ClearScreen. A visible dice label is not completion.

Keep ordinary helpers usable under reduced motion. Provide explicit frozen-clock helpers for later tumble, adjustment, movement, and reveal checkpoints; never silently Skip a natural-completion test.

**Tests**

- Existing reduced-motion consumers retain exact gameplay/save assertions.
- Readiness requires enabled interaction semantics.
- Adjustment helpers wait for the presented dialog.
- Frozen-clock helpers advance one timed stage at a time and prime movement rAF explicitly.
- Use saved records and independently specified timings as the oracle; do not calculate all expectations through the production planner.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/e2e-fixture-seeds.test.ts tests/unit/game-hud.test.ts
npm run build
npx playwright test tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/resume.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium
```

**User review checkpoint**

Review helper diffs against the re-pointing map below. No visual change or new screenshot is required.

**Risks**

Playwright’s large `fastForward()` calls do not reliably model an entire chain of newly scheduled timers. Advance and assert each boundary explicitly.

---

### S10 — Dice cube and modifier visuals, unmounted

**Goal**

Build the complete dice visual before connecting its delay.

**File changes**

- New `C/DiceTumble.tsx`.
- Modify `src/styles.css`.
- Modify `U/turn-moment-components.test.ts`.

Use six fixed CSS faces, deterministic final orientations, and transform/opacity animation. Reuse `compactRollFor()` wording; use accepted effect facts to catch delay activation on raw 1.

The component supports tumble and stamp models but owns no sequence progression.

**Tests**

- All six committed raw rolls map to the correct final orientation.
- Final tumble pose is held briefly within the existing tumble duration.
- ×2, ±1, rapid, oversleep, and delay labels.
- Deadhead renders no die.
- No presentation RNG or animation-end dependency.
- Reduced-motion/CSS-3D fallback behavior.
- Decorative accessibility and no focusable children.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-components.test.ts tests/unit/turn-moments.test.ts tests/unit/hud-presentation.test.ts
npm run build
```

**User review checkpoint**

Review component tests and CSS. No visible production component is mounted; the first production dice screenshots belong to S11.

**Risks**

Showing the effective face as the cube result would misrepresent the saved raw roll. CSS capability must never block completion.

---

### S10b — Integration fixtures and timing-sensitive test preparation

**Goal**

Prepare reusable integration fixtures and assertions for the production activation steps without enabling production delays.

**File changes**

- Modify `U/game-app-turn-moments.test.ts` and `U/game-app-item-progress.test.ts` with reusable accepted-save observation, pending-adjust/resume, save-failure, speed-capture, and same-task duplicate-click fixtures/assertions.
- Modify `E/support/app.ts` and `E/support/turnMoments.ts` to expose the S9 checkpoint helpers needed by timing-sensitive specs.
- Prepare affected cases in `E/dice.spec.ts`, `E/resume.spec.ts`, and `E/save-errors.spec.ts` to use the S9 helpers while retaining their baseline assertions.

Keep all baseline assertions passing. Production stage lists remain empty; do not enable production delays.

**Tests**

- Accepted-save observations remain tied to the acknowledged save boundary.
- Pending adjustment can resume without replaying the tumble.
- Save failures remain visible and do not start the accepted sequence more than once.
- Captured speed is stable for the active attempt and changes apply to the next turn.
- Same-task duplicate clicks accept exactly one turn.
- Timing-sensitive specs use explicit S9 checkpoints without changing baseline completion behavior.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/turn-moment-hooks.test.ts
npm run build
npx playwright test tests/e2e/dice.spec.ts tests/e2e/resume.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium
```

**User review checkpoint**

Review the reusable fixtures and checkpoint-helper use. Confirm the existing baseline assertions pass and no production delay is active.

**Risks**

Fixtures that observe state before save acceptance can mask a duplicate or failed attempt. Keep accepted-save observation distinct from pending and failure states.

**Size**

S, 120–190 changed LOC including tests.

**Depends on**

S9 and S10.

---

### S11 — Enable tumble, adjustment, stamps, and one Skip

**Goal**

Connect the complete pre-move moment in one shippable commit.

**File changes**

- Modify `src/app/GameApp.tsx`.
- Modify `G/animation/useTurnMoments.ts` and `G/turnMomentPresentation.ts` as needed for integration.
- Modify `C/TurnMomentHost.tsx`, `C/RollAdjustment.tsx`, and its `GamePanel` wiring.
- Extend `U/game-app-turn-moments.test.ts` and the S10b integration fixtures for activation behavior.
- New `E/ui-pop-turn-moments.spec.ts`.
- Re-point affected tests in `E/dice.spec.ts`, `E/capital-region.spec.ts`, `E/resume.spec.ts`, `E/items.spec.ts`, and `E/accessibility.spec.ts` using the S10b preparations.

Begin an attempt and call `app.roll()` in the same accepted handler. Capture timing then. Keep `session.animation` supplied while its runner is gated.

Expose adjustment only after tumble. Add the optional shared Skip action inside `RollAdjustment`; Skip preserves the chosen radio and required Continue action.

**Tests**

- Saved raw roll is the cube’s final face.
- No movement frame or adjustment dialog before tumble ends.
- One tumble across adjustment; stamps precede movement.
- One Skip works before record creation, during tumble/stamps, inside adjustment, and during movement.
- Pending-save Skip survives until the accepted animation exists.
- Reduced motion and restored pending rolls omit tumble.
- Existing save-order tests assert no movement rAF before release, then assert it starts after release.
- Existing toast-clock tests reach the presented modal explicitly. Where appropriate, Skip tumble without consuming reading time so the exact remaining-time assertions remain intact.
- Double/triple clicks still commit exactly one turn.
- Enable then disable reduced motion while save acceptance is pending and during movement; the active attempt remains omitted and is not replayed.
- Resume during tumble and while adjustment is pending without replaying the tumble.
- A save failure does not advance the sequence; after a successful retry it advances exactly once.
- A speed change during tumble does not change the captured speed used for that turn's movement.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/move-animation-gate.test.ts tests/unit/turn-moment-components.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/game-hud.test.ts
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/resume.spec.ts tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/save-errors.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=phone-chromium
```

**User review checkpoint**

Capture:

- `.claude/logs/screenshots/p2-s11-desktop-dice-landed.png`
- `.claude/logs/screenshots/p2-s11-desktop-adjust-after-tumble.png`
- `.claude/logs/screenshots/p2-s11-phone-stamp.png`

Review face readability, stamp wording, focus retention, modal Skip, and absence of a second tumble.

**Risks**

This is the tightest integration budget. Avoid unrelated refactoring. Production post stages remain empty, so the app never waits for an unrendered arrival/lottery/pickup.

---

### S12 — Enable arrival and delayed goal presentation

**Goal**

Add the arrival banner and keep the panel mounted until a goal banner finishes.

**File changes**

- Modify `G/animation/turnMoments.ts` to add `buildTurnRevealStages()` with the arrival stage.
- Modify `C/TurnMomentHost.tsx`, `G/turnMomentPresentation.ts`, `src/app/GameApp.tsx`, and `src/styles.css`.
- Modify `U/turn-moments.test.ts`, `U/game-app-turn-moments.test.ts`, `E/ui-pop-turn-moments.spec.ts`, `E/items.spec.ts`, `E/dice.spec.ts`, and the natural-completion case in `E/capital-region.spec.ts`.

Keep the natural-completion test current with every newly activated post stage. Preserve its movement, final position/progress/platform and interaction-readiness assertions; do not replace natural completion with Skip.

At this step, arrival is the only production post stage. Publish next-ride/item results at its completion until their own moments are added later.

**Tests**

- Every fresh item arrival, including deadhead and no-new-segment turns, gets the banner.
- Goal: movement → arrival → ClearScreen.
- During the goal banner, panel remains mounted, dice/items are unavailable, and Skip works.
- ClearScreen focus, map inertness, and `game_clear` reporting share `display.showClear`.
- Goal announcement is owned by ClearScreen.
- Reduced motion and restored results mount no banner.
- Reduced motion toggled on and off during arrival omits that arrival without replay; Skip during arrival completes it, and a resumed arrival does not replay.
- On a goal arrival, ClearScreen focus does not move before the arrival banner completes; Skip completes the banner before ClearScreen receives focus.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/analytics.test.ts
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=phone-chromium
```

**User review checkpoint**

Capture:

- `.claude/logs/screenshots/p2-s12-desktop-arrival.png`
- `.claude/logs/screenshots/p2-s12-desktop-goal-banner.png`
- `.claude/logs/screenshots/p2-s12-desktop-clear-after-banner.png`

Review banner placement and the goal transition.

**Risks**

Engine status is already completed during the banner. Any remaining raw-status condition can mount ClearScreen, make the map inert, or report completion early.

---

### S13 — Concurrent completed-segment flash

**Goal**

Flash newly completed Yamanote geometry during arrival, without adding another stage.

**File changes**

- Modify `M/mapConfig.ts`, `M/railwayLayers.ts`, and `M/RailwayMap.tsx`.
- Modify `src/app/GameApp.tsx` to pass `display.segmentFlash`.
- New `U/map-flash.test.ts`.
- Modify `U/map-station-markers.test.ts` and affected mocks in `U/capital-region-scaling.test.ts`.
- Extend `E/support/app.ts` map observation and `E/ui-pop-turn-moments.spec.ts`.

Add exactly one flash layer above completed segments and below stations. Keep the completed layer’s ID and filter shape unchanged.

**Tests**

- Exact layer count changes from 10 to **11**, with exact order asserted.
- Flash initializes with empty filter and zero opacity.
- One bounded opacity pulse over the arrival duration.
- Only new target feature IDs flash.
- Null request, Skip, reduced motion, screen change, and teardown clear it.
- Style reload reapplies remaining state without resetting its deadline.
- A reload after expiry leaves the layer empty.
- Missing map/layer never blocks presentation.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/map-flash.test.ts tests/unit/map-station-markers.test.ts tests/unit/capital-region-scaling.test.ts tests/unit/map-panel-observer.test.ts tests/unit/game-app-turn-moments.test.ts
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/capital-region.spec.ts --project=desktop-chromium
```

**User review checkpoint**

Capture `.claude/logs/screenshots/p2-s13-desktop-arrival-flash.png`.

Review a single restrained pulse and confirm no lingering highlight after Skip or screen change.

**Risks**

A surviving frame callback can write into a replaced style. Arbitrary progress diffs can mistakenly flash resumed or previously completed segments.

---

### S14 — Enable lottery flip, settle, and atomic ride publication

**Goal**

Add the complete two-row lottery moment and publish its result consistently after settle.

**File changes**

- New `C/LotteryReveal.tsx`.
- Modify `C/TurnMomentHost.tsx`, `G/animation/turnMoments.ts`, `G/turnMomentPresentation.ts`, and `src/styles.css`.
- Modify `U/turn-moments.test.ts`, `U/turn-moment-components.test.ts`, and `U/game-app-turn-moments.test.ts`.
- Extend `E/ui-pop-turn-moments.spec.ts`; re-point `E/lottery.spec.ts`, `E/dice.spec.ts`, and natural landing assertions in `E/capital-region.spec.ts`.

Keep the natural-completion test current with every newly activated post stage. Preserve its movement, final position/progress/platform and interaction-readiness assertions; do not replace natural completion with Skip.

Add `lottery-flip` and `lottery-settle` only when a service or direction draw occurred. Only drawn rows flip. Forced rows stay stable. Use existing `LineBadge`, service names, and direction resolution.

**Tests**

- Service-only, direction-only, both draws, and forced choices.
- Flip 1,600 ms plus settle 400 ms at normal speed; captured speed scaling.
- Board stops on saved landing service/direction.
- Before publication: HUD, map highlight/platform, log, candidates, upcoming stations, and live region remain masked.
- After settle: all those consumers publish together.
- No probabilities/weights or invented line codes.
- Missing HUD target uses local fade with the same deadline.
- Skip during either lottery stage completes the turn presentation.
- Goal/deadhead omit lottery.
- Reduced motion toggled on and off during flip and settle omits lottery without replay; Skip works during each stage, and resuming during lottery does not replay it.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/turn-moment-components.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/line-badge.test.ts
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=phone-chromium
```

**User review checkpoint**

Capture:

- `.claude/logs/screenshots/p2-s14-desktop-lottery-flip.png`
- `.claude/logs/screenshots/p2-s14-desktop-lottery-settle.png`
- `.claude/logs/screenshots/p2-s14-phone-lottery.png`

Review row readability, forced-row stability, landing accuracy, and travel toward the HUD.

**Risks**

The board may reveal its result while other surfaces publish earlier. Assert the ridden arrival platform separately from the highlighted service.

---

### S15 — Enable pickup and delayed discard handoff

**Goal**

Add pickup flight and expose final inventory/discard state at its completion.

**File changes**

- New `C/ItemPickupMoment.tsx`.
- Modify `C/TurnMomentHost.tsx`, `G/animation/turnMoments.ts`, `G/turnMomentPresentation.ts`, `src/app/GameApp.tsx`, and `src/styles.css`.
- Modify `U/turn-moments.test.ts`, `U/turn-moment-components.test.ts`, `U/game-app-turn-moments.test.ts`, and relevant `U/game-app-item-progress.test.ts` cases.
- Extend `E/ui-pop-turn-moments.spec.ts`, `E/items.spec.ts`, `E/resume.spec.ts`, and `E/dice.spec.ts`.

Keep the natural-completion test current with every newly activated post stage. Preserve its movement, final position/progress/platform and interaction-readiness assertions; do not replace natural completion with Skip.

Add `pickup` only for `pickup-retained` or `pickup-pending-discard`.

For retained items, fly to the empty target slot and publish its contents at completion. For full inventory, fly to the header/rail, then mount the existing four-choice `DiscardChoice`.

**Tests**

- Target slot remains empty until landing.
- Full inventory remains three owned slots; no temporary replacement/fourth slot.
- Pickup, decision, card closure, live-region ownership, toast obscuration, and modal focus change at one boundary.
- Accepted pickup toast remains paused behind the discard dialog.
- Same-turn discard update adds its toast without replaying stages.
- Harmful drops/certificate cancellation have no flight and publish at sequence completion.
- Missing target fades locally.
- Skip during pickup reveals the final inventory or required discard dialog.
- Restored pending discard opens immediately without pickup replay.
- Reduced motion toggled on and off during pickup omits it without replay; Skip during pickup reveals the final inventory or required discard, and resuming during pickup does not replay it.
- A full-inventory pickup retains the mandatory discard decision through Skip, reduced-motion omission, and resume.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-items.test.ts tests/unit/turn-moment-components.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/item-controls.test.ts tests/unit/toast.test.ts
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/items.spec.ts tests/e2e/resume.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=phone-chromium
```

**User review checkpoint**

Capture:

- `.claude/logs/screenshots/p2-s15-desktop-pickup-flight.png`
- `.claude/logs/screenshots/p2-s15-phone-full-inventory-flight.png`
- `.claude/logs/screenshots/p2-s15-phone-discard-after-pickup.png`

Review target alignment, absence of early item contents, and dialog focus.

**Risks**

Final inventory/effects can leak through card hints even if the slot is hidden. Do not modify `DiscardChoice` or toast clock behavior to accommodate integration errors.

---

### S16 — Combined lifecycle and responsive browser verification

**Goal**

Close cross-feature gaps with the complete production composition.

**File changes**

- Extend `E/ui-pop-turn-moments.spec.ts`.
- Modify affected `E/layout.spec.ts`, `E/accessibility.spec.ts`, and `E/resume.spec.ts`.
- Extend `U/game-app-turn-moments.test.ts` and `U/turn-moment-hooks.test.ts` for any uncovered lifecycle boundaries.
- Permit only small production corrections within the remaining step budget.

**Tests**

Re-run and extend lifecycle coverage introduced at each activation step. S16 must not be the first verification of omission, resume, Skip, save-failure handling, or captured speed for an already enabled moment.

- Reload during movement restores committed state without replay; retain map failure, session replacement, title/new-game exit, and cleanup coverage.
- Reduced motion from the first commit remains covered as a cross-feature regression.
- Movement retains distance scaling and the 6,000 ms cap.
- Public item inspection during reveal; use/draft callbacks remain blocked.
- Desktop, phone touch, 320 px narrow layout, and 667×375 / 640×400 landscape.
- Host remains in usable map space, panel dimensions stay unchanged, and attribution/zoom/toasts remain usable.
- One gameplay live region and correct focus throughout.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/resume.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/layout.spec.ts tests/e2e/accessibility.spec.ts --project=phone-chromium
```

**User review checkpoint**

Capture:

- `.claude/logs/screenshots/p2-s16-phone-320-lottery.png`
- `.claude/logs/screenshots/p2-s16-landscape-667-arrival.png`
- `.claude/logs/screenshots/p2-s16-landscape-640-pickup.png`
- `.claude/logs/screenshots/p2-s16-desktop-map-failure.png`

Review the complete turn at all three speeds. Record any real-device performance observation separately from automated evidence.

**Risks**

Software-rendered browser tests do not establish low-end device performance. Record unmeasured device behavior honestly. Full four-browser E2E remains a CI gate.

---

### S17 — Lead-owned design and final handoff documentation

**Goal**

Record the delivered architecture, verification evidence, and remaining limits. This step contains no release activity.

**File changes**

- Modify `.claude/docs/DESIGN.md` **by the lead through the typed writer**.
- Finalize `.claude/docs/plans/ui-pop-turn-moments-handoff.md` **by the lead**.
- Modify this plan only to record approved implementation deviations or final step status.

Luna does not edit these files.

Record:

- Two sequences and the shared display derivation.
- Attempt/reveal identities and save-attempt publication boundary.
- Captured speed timings and conditional stages.
- One Skip preserving mandatory decisions.
- Reduced-motion/resume behavior.
- Atomic ride/item publication and single live-region ownership.
- Dedicated flash layer and cleanup.
- Actual checks, screenshot paths, CI status, and unmeasured device limits.

**Tests and documentation checks**

Check every implementation step’s handoff entry, commit, review result, command result, and screenshot reference. Do not report pending CI or device checks as passed.

Resolve the writer input path:

```bash
python3 .claude/skills/_shared/workspace.py --skill design-tracker --title "UI Pop P2 turn moments" --create
```

The resolved path is `.claude/logs/design-input-ui-pop-p2-turn-moments.json`. The lead writes typed decision/section input there, then previews:

```bash
python3 .claude/skills/_shared/update_design.py --input .claude/logs/design-input-ui-pop-p2-turn-moments.json
```

After inspecting the returned preview file, apply and validate:

```bash
python3 .claude/skills/_shared/update_design.py --input .claude/logs/design-input-ui-pop-p2-turn-moments.json --apply --require-change
python3 .claude/skills/_shared/validate_doc.py --contract design-doc --file .claude/docs/DESIGN.md
git diff --check
git diff --exit-code 70decd6 -- src/features/game/engine src/features/game/store src/features/game/gameSession.ts src/features/game/itemSession.ts src/features/game/useGameApp.ts src/types/network.ts public/data
```

Require writer `result:"applied"` and a nonzero appended/updated count; report skipped duplicates. If the intended decisions are already recorded, verify that explicitly instead of claiming a new write.

No application tests/build/E2E need repeating for documentation-only changes; reference S16 evidence.

**User review checkpoint**

Review the final handoff, approved deviations, and S16 screenshot set. Commit documentation and pause. Do not create release steps.

**Risks**

Freehand replacement of DESIGN sections can discard history. Use the typed writer and inspect its actual diff.

## Dependencies Between Steps

```text
S1 → S2 → S3 → S4 → S5
                    ↓
                   S6 → S7 → S8
                         └────→ S9
S2 + S8 → S10
S9 + S10 → S10b
S5 + S6 + S7 + S8 + S9 + S10b → S11
S11 → S12 → S13 → S14 → S15 → S16 → S17
```

Execution remains serial because each step ends with a user-review pause.

The activation boundaries are mandatory:

| Boundary | What becomes active | What remains immediate/absent |
|---|---|---|
| S1–S10b | Fixes, shared display, guards, tested plumbing, and integration fixtures | New visual delays remain absent |
| S11 | Tumble → adjustment if needed → stamps → movement | Post-move results use existing completion timing |
| S12 | Arrival; goal waits for its banner | Lottery/item outcomes publish after arrival |
| S13 | Segment flash concurrent with arrival | No additional duration |
| S14 | Conditional lottery flip/settle | Item outcome publishes after arrival/lottery |
| S15 | Conditional pickup | Discard publishes after pickup; complete P2 sequence |

These intermediate publication rules end when the corresponding moment is integrated. Do not leave temporary runtime flags, duplicate planners, fabricated facts, or empty timed stages.

## E2E Re-pointing Map

Line numbers refer to baseline `70decd6`; preserve the named test when subsequent edits move lines.

| Existing spec:line | New checkpoint | Step |
|---|---|---|
| `tests/e2e/support/app.ts:156` — `rollOnce()` | After saved result and any **presented** discard, wait for dice `aria-disabled="false"` or ClearScreen. Preserve save-turn assertion. | S9 |
| `tests/e2e/support/app.ts:172` — `revealUnadjustedRoll()` | Wait for the actual adjustment dialog before continuing. Frozen-clock callers explicitly advance tumble first. | S9, S11 |
| `tests/e2e/dice.spec.ts:132` — repeated clicks | Prepare explicit checkpoints while retaining baseline assertions; assert one accepted turn and disabled dice through tumble/movement; retain both browser-click and same-task `.click()` cases. One Skip completes presentation. | S10b, S11 |
| `tests/e2e/dice.spec.ts:190` — half-hop | Prepare explicit checkpoints while retaining baseline assertions; assert origin during tumble, advance pre-move completion, prime movement rAF, then run `STEP_MS / 2`. Keep between-stations assertions. | S10b, S11 |
| `tests/e2e/dice.spec.ts:203` — natural completion | Verify natural movement completion, then explicitly advance each active post stage and assert ready. Preserve final station/progress/platform assertions; do not replace with Skip. | S10b–S15 |
| `tests/e2e/lottery.spec.ts:57` — moving lottery text | Reach actual movement before asserting exact `抽選: 移動中…`. Separately assert arrival/lottery masking in the new P2 spec. | S11, S14 |
| `tests/e2e/lottery.spec.ts:58` — one Skip | Retain one press and exact saved-state/platform equality. Add no-replay overlay assertion after resume. | S11, S14 |
| `tests/e2e/resume.spec.ts:79` — reload during movement | Prepare explicit checkpoints while retaining the baseline movement reload assertion; advance tumble and establish movement before reload. Add separate tumble/lottery/pickup reload cases at activation. | S10b, S11, S14–S16 |
| `tests/e2e/resume.spec.ts:118` — pickup toast after Skip | Keep one Skip, exact toast text/count, saved pickup equality, and zero replay after resume. | S11, S15 |
| `tests/e2e/capital-region.spec.ts:235` — forward midpoint | Advance pre-move completion before the existing 16 ms frame setup and composed-hop calculation. Retain geometry/direction/progress/highlight assertions. | S11 |
| `tests/e2e/capital-region.spec.ts:276` — reverse midpoint | Same pre-move checkpoint; preserve reversed geometry and marker assertions. | S11 |
| `tests/e2e/capital-region.spec.ts:319` — natural reverse midpoint | Start the movement clock after tumble/stamps. Retain the existing midpoint oracle. | S11 |
| `tests/e2e/capital-region.spec.ts:325` — natural landing | After movement, assert arrival on the ridden platform with ridden highlight. After arrival/lottery settle, assert committed landing service, highlight, and platform. Finish pickup if present before readiness. | S12, S14–S15 |
| `tests/e2e/items.spec.ts:340` — rapid/oversleep repeated clicks | Keep physical-hop, movement-mode, and save-equality assertions; include pre-move lock and one Skip across the remaining sequence. | S11 |
| `tests/e2e/items.spec.ts:398` — reduced-motion Skip | Keep Skip disabled after instant completion; add absence of any moment overlay. | S11–S15 |
| `tests/e2e/items.spec.ts:436` — long rapid goal | Complete tumble/stamps, prime movement, verify the 6,000 ms movement cap, assert goal banner with no ClearScreen, then advance arrival and assert focused ClearScreen. Preserve notice/history/save assertions. | S11–S12 |
| `tests/e2e/accessibility.spec.ts:51` — dice focus | Use explicit frozen-clock pre/move/post checkpoints and assert focus at each. End with enabled dice; do not rely on the previous real-clock 7-second window. | S9, S11–S15 |
| `tests/e2e/save-errors.spec.ts` — failed save | Prepare reusable accepted-save observations and checkpoint helpers while preserving baseline failure visibility and retry assertions; verify sequence activation at S11. | S10b, S11 |
| New `tests/e2e/ui-pop-turn-moments.spec.ts` | Saved raw/landing values, all publication surfaces, conditional stages, modal Skip, pickup/discard, omission/resume, placement, and cleanup. Add cases with each feature’s activation. | S11–S16 |

Additional unit re-pointing required in S11:

- `tests/unit/game-app-item-progress.test.ts:422`: replace “movement rAF immediately after click” with “no movement rAF while gated, then rAF after release.” Keep save-order and origin assertions.
- Existing adjustment/toast helpers must explicitly reach the presented adjustment dialog.
- Preserve exact toast remaining-time assertions. Do not consume extra tumble time accidentally and then loosen their expected lifetime.

## Estimated Effort per Step

These estimates include test authoring, implementation, one normal review/correction pass, and lead verification. User-review waiting time is excluded. Browser runtime depends on software WebGL performance.

| ID | Luna implementation | Sol review + lead verification/docs | Main uncertainty |
|---|---:|---:|---|
| S1 | 15–25 min | 10–20 min | Commit-phase omission assertions |
| S2 | 35–55 min | 20–30 min | Restored-roll and acknowledgement facts |
| S3 | 25–40 min | 15–25 min | Arrival platform and log boundaries |
| S4 | 30–50 min | 20–30 min | Certificate/effect/hint masking |
| S5 | 35–55 min | 20–30 min | Stable timers, frames, and deferred Skip |
| S6 | 30–45 min | 25–40 min | Consumer coverage and fixture migration |
| S7 | 25–40 min | 20–35 min | Focus and callback guards |
| S8 | 30–45 min | 25–40 min | Short-landscape placement |
| S9 | 20–35 min | 25–40 min | Helper consumers and clock behavior |
| S10 | 25–40 min | 15–25 min | CSS face orientation/fallback |
| S10b | 20–35 min | 20–35 min | Fixtures that distinguish accepted, pending, and failed saves |
| S11 | 35–55 min | 35–55 min | Pre-move activation and lifecycle verification |
| S12 | 30–45 min | 25–40 min | Goal focus/reporting boundary |
| S13 | 35–55 min | 25–45 min | Style reload and frame cleanup |
| S14 | 40–60 min | 30–50 min | Atomic publication across every surface |
| S15 | 40–60 min | 30–50 min | Pickup/discard/live-region handoff |
| S16 | 30–50 min | 40–65 min | Combined lifecycle and responsive checks |
| S17 | Lead only | 20–35 min | Writer validation and evidence completeness |

The scope assessment’s 1,400–2,200 LOC was an initial estimate. This plan budgets approximately 3,700–4,900 changed LOC across the small commits, including explicit lifecycle, masking, placement, and browser coverage plus intermediate integration edits. That is a planning allowance rather than a target; reuse existing fixtures and helpers, keep diffs minimal, and avoid adding tests that merely mirror implementation.
