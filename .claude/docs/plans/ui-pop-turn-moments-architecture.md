## Architecture Design

Use **two presentation sequences and one shared displayed-state derivation**:

1. A new pre-move reducer controls the saved raw roll, one dice tumble, optional adjustment, and modifier stamps.
2. Extend `useRevealSequence` for the post-move stages: arrival with concurrent segment flash, conditional lottery flip/settle, and conditional inventory pickup.
3. A pure `deriveTurnMomentDisplay()` produces every visible gameplay value and interaction permission. `GamePanel`, map progress, announcements, toasts, and ClearScreen consume that result.

Keep engine execution and save acknowledgements unchanged. The engine can remain ahead of the display; presentation state never becomes save input.

This follows the existing separation in `itemSession.ts`, `displayedProgress.ts`, and `useRevealSequence.ts`. No changes are required in the engine, RNG, save format, `src/types/network.ts`, or public data.

**Pre-move movement gate**

Add a `startAllowed` option to `useMoveAnimation`. Continue passing `session.animation` immediately and constructing its move plan and `AnimationView`. While the gate is closed:

- Do not start `runMoveAnimation` or request a frame.
- Return the current animation’s view with `frame: null`.
- Keep `livePosition` empty.
- `displayedProgress()` therefore shows zero completed hops and the origin.

Do not gate movement by passing `null` as the animation. That removes the origin mask and exposes the committed arrival position.

The gate opens after tumble, adjustment if required, and stamps. `animation-finished` remains the sole transition that finishes an engine session’s movement presentation.

**Identity and lifetime**

Use two identities with different responsibilities:

- **Roll attempt key**, created by the accepted dice click:  
  `${sessionId}:roll:${game.turn + 1}:${decisionRevision}`.
- **Reveal key**, unchanged:  
  `${sessionId}:${itemRecord.turn}`.

Store the expected record turn on the roll attempt. An eventual record attaches to that attempt by session and record turn; it does not create another tumble.

The attempt retains its origin snapshot, timing, raw-roll completion, and Skip intent until the next accepted roll or session change. In particular, do not discard its Skip intent when an adjustment dialog closes or movement finishes.

**Post-move stage plan**

| Stage | Inclusion | Normal duration | Publication boundary |
|---|---|---:|---|
| `arrival` | Every fresh item-mode arrival, including goal and deadhead | 800 ms | Show the arrival station immediately; hold lottery and item outcomes |
| `lottery-flip` | A service or direction draw actually happened | Part of 2,000 ms total | Keep next ride, result text, and candidates masked |
| `lottery-settle` | Immediately after `lottery-flip` | Last 400 ms of lottery total | Board shows its committed result and moves into the HUD |
| `pickup` | `pickup-retained` or `pickup-pending-discard` exists | 500 ms | Inventory pickup and discard decision publish at completion |

The flip portion occupies the lottery total minus the settle duration. At the transition out of `lottery-settle`, publish the landed ride simultaneously to HUD, map highlight, platform marker position, log, candidates, and live message.

Arrival and map flash are concurrent, not successive stages. The flash adds no delay.

When no lottery happened, omit both lottery stages and publish the forced next ride when `arrival` ends. When no new target segments were completed, retain `arrival` and omit its flash. Do not insert empty stages or placeholder delays.

A goal turn has only `arrival` after movement, followed by ClearScreen. The engine already omits its landing lottery and item drop.

**Speed**

Derive the factor from existing speed configuration:

```ts
factor = selectedStepMs / normalStepMs;
durationMs = Math.round(baseDurationMs * factor);
```

Resolve `normalStepMs` from the `"normal"` entry in `ANIMATION_SPEEDS`, currently 450 ms.

| Duration | Slow: 600 ms/hop | Normal: 450 ms/hop | Fast: 300 ms/hop |
|---|---:|---:|---:|
| Tumble | 800 ms | 600 ms | 400 ms |
| Modifier stamps, when present | 320 ms | 240 ms | 160 ms |
| Arrival and flash | 1,067 ms | 800 ms | 533 ms |
| Lottery, including settle | 2,667 ms | 2,000 ms | 1,333 ms |
| Pickup | 667 ms | 500 ms | 333 ms |

Capture this timing and movement `stepMs` at the accepted roll. Changing 速度 affects the next turn. This avoids changing a running stage’s deadline or changing the movement speed after a delayed tumble. Preserve existing distance-based hop timing and the 6,000 ms movement cap.

Reduced motion is a separate omission flag, not a zero multiplier applied to a chain of timed stages.

**Visual components and layout**

Render `TurnMomentHost` as a sibling of `.game-panel`, like `ToastHost`.

- Host is fixed, visual-only, and never calls `focus()` or `showModal()`.
- Host has `pointer-events: none`; only its visible card captures pointer taps for Skip.
- The decorative subtree is `aria-hidden="true"` with no focusable descendants.
- Keep the existing keyboard Skip path.
- Prevent pointer-down on the decorative tap target from moving keyboard focus.
- Place the host above the panel and below map errors/toasts, using a dedicated layer token.
- Do not cover navigation controls, attribution, or the toast column.

Measure the map rectangle and panel rectangle, clipped to the viewport. A pure rectangle helper selects the largest available rectangle above, beside, or below the panel. Its centre is the visible map centre. This handles phone and short landscape correctly without assuming that the free area is always above the panel.

Measure the HUD’s ride/direction values and inventory slot targets through optional refs. Keep all current `<dt>`, `<dd>`, and `data-stat` contracts. Use transforms and opacity for settling and pickup; measurement must not alter panel dimensions.

Use six fixed CSS cube faces with a deterministic orientation for each committed raw roll. No presentation randomness is necessary. Modifier stamps reuse the labels from `compactRollFor()`; effect-event checks additionally catch an activated delay when the raw roll was already 1.

The lottery board has two rows: existing `LineBadge` plus service name, then direction. Only a drawn row flips; a forced row remains stable. Use deterministic intermediate frames and the committed result. Do not display weights or probabilities.

## Module Structure (new files and modifications)

Paths below use `G = src/features/game`, `C = G/components`, and `M = src/features/map`.

| File | Change | Responsibility |
|---|---|---|
| `G/animation/turnMoments.ts` | New | Pure pre-move reducer, roll-attempt identity, timing, accepted observations, stage planning |
| `G/animation/useTurnMoments.ts` | New | Thin hook over the pre-move reducer and existing reveal hook; current-stage timer; stable callbacks |
| `G/turnMomentPresentation.ts` | New | Pure shared display derivation, publication rules, overlay models, safe item view |
| `G/animation/useRevealSequence.ts` | Modify | First-commit omission fix; support Skip intent before a record key exists |
| `G/animation/useMoveAnimation.ts` | Modify | Runner start gate while preserving `AnimationView` |
| `src/app/GameApp.tsx` | Modify | Wrapped roll/Skip handlers, hook integration, shared display, toast inputs, delayed ClearScreen, overlay host |
| `G/presentation.ts` | Modify | Stage-aware single announcement helper, reusing existing canonical text helpers |
| `C/TurnMomentHost.tsx` | New | Overlay placement, arrival banner, measurements, component selection |
| `C/DiceTumble.tsx` | New | CSS cube and modifier stamps |
| `C/LotteryReveal.tsx` | New | Two-row board and settle transform |
| `C/ItemPickupMoment.tsx` | New | Item icon flight to the inventory target |
| `C/GamePanel.tsx` | Modify | Consume shared display; consistent decision/focus handling; guard item actions |
| `C/GameHud.tsx` | Modify | Independent `canSkip`, presentation-disabled dice, optional settle target refs |
| `C/InventoryPanel.tsx` | Modify | Slot target refs; presentation lock for use actions; consume masked item view |
| `C/RollAdjustment.tsx` | Modify | Optional instance of the same Skip action inside the modal |
| `M/mapConfig.ts` | Modify | Dedicated flash layer ID and paint constants |
| `M/railwayLayers.ts` | Modify | Optional flash request on `MapProgress`, one new line layer, guarded updates |
| `M/RailwayMap.tsx` | Modify | Flash lifetime and local frame loop; style reload and teardown cleanup |
| `src/styles.css` | Modify | Cube, flap, arrival, settle, pickup, responsive limits, reduced-motion rules |

`RollAdjustment` needs a small extension because its native modal makes the panel’s existing Skip button inert. Merely changing the panel button cannot make Skip usable while that dialog is open.

Reuse `ToastHost`, `LineBadge`, `ItemIcon`, `DiscardChoice`, and `ClearScreen` without changing their presentation responsibilities. Keep `hudPresentation.ts` as the source of compact roll wording.

Recommended implementation order is: reduced-motion fix → pure sequencing/display model → movement gate/Skip → visual stages → map flash → pickup/decision integration → browser verification.

## Interface Design (function signatures, types, component props)

These are proposed interfaces; reuse existing domain types rather than copying their definitions.

```ts
export type PreMoveStage =
  | "waiting-roll"
  | "tumble"
  | "awaiting-adjust"
  | "waiting-record"
  | "stamps"
  | "released";

export type TurnRevealStageKey =
  | "arrival"
  | "lottery-flip"
  | "lottery-settle"
  | "pickup";

export interface TurnMomentTiming {
  stepMs: number;
  tumbleMs: number;
  stampsMs: number;
  arrivalMs: number;
  lotteryFlipMs: number;
  lotterySettleMs: number;
  pickupMs: number;
}

export interface TurnOrigin {
  stationId: string;
  ride: Readonly<{ serviceId: string; direction: Direction }>;
  completedSegmentIds: readonly string[];
  turn: number;
  itemView: ItemSessionView;
  previousLastMove: LastMove | null;
}

export interface RollAttempt {
  key: string;
  sessionId: number;
  recordTurn: number;
  source: "click" | "restored-roll";
  origin: TurnOrigin;
  timing: TurnMomentTiming;
  stage: PreMoveStage;
  rawRoll: number | null;
  tumbleCompleted: boolean;
  skipRequested: boolean;
  motionOmitted: boolean;
}

export function turnMomentTiming(stepMs: number): TurnMomentTiming;

export function turnMomentsReducer(
  state: TurnMomentsState,
  action: TurnMomentsAction,
): TurnMomentsState;

export function buildTurnRevealStages(
  facts: TurnMomentFacts,
  timing: TurnMomentTiming,
): readonly RevealStage[];

export function deriveTurnMomentDisplay(
  input: TurnMomentDisplayInput,
): TurnMomentDisplay;
```

`TurnMomentsAction` should be a discriminated union with:

- `begin`: accepted roll identity, origin snapshot, captured timing.
- `observe`: normalized session facts and omission preference.
- `advance`: attempt key and expected pre-move stage.
- `skip`: active attempt identity.
- `reset`: session/screen boundary.

The pure observation adapter accepts a raw roll for display only after its save attempt: from an `awaiting-adjust` decision or the accepted current record. Reading `game.pending.rawRoll` during `committing` must not start the tumble before acknowledgement.

`TurnMomentFacts` contains the accepted current record, lottery flags, pickup event, goal/deadhead flags, and newly completed target segment IDs. Capture the segment IDs while movement events are available. Do not infer the flash from arbitrary React-to-React progress differences: those differences also occur during hops, Skip, and session replacement.

Freeze stage configuration for a reveal key. A discard resolution appends events to the same record turn; it must update final notices/toasts without changing or replaying that key’s stage plan.

**Shared displayed model**

```ts
export interface TurnMomentDisplay {
  turn: number;
  progress: DisplayedProgress;
  ride: Readonly<{ serviceId: string; direction: Direction }>;

  compactRoll: string;
  rollText: string;
  arrivalText: string | null;
  lotteryText: string;
  candidateRows: readonly PresentationCandidateRow[];

  itemView: ItemSessionView | null;
  decision: ItemSessionView["decision"];
  effectModels: readonly EffectChipModel[];
  showItemNotice: boolean;

  announcement: string;
  toastInputs: readonly ToastInput[];
  showClear: boolean;

  canRoll: boolean;
  canSkip: boolean;
  itemUseLocked: boolean;

  overlay: TurnMomentOverlay | null;
  segmentFlash: SegmentFlashRequest | null;
}
```

`PresentationCandidateRow` should be a local alias of the existing resolver’s candidate-row return element, not a new domain schema.

The model owns publication decisions. Consumers must not call `displayedRide(session)`, `landingText(session.lastMove)`, or `itemTurnAnnouncement()` independently with unmasked state during P2.

| Consumer | Required source |
|---|---|
| HUD service/direction and upcoming stations | `display.ride` |
| HUD compact roll and detailed log roll | `display.compactRoll`, `display.rollText` |
| Current station, progress count, remaining sections | `display.progress` |
| Map highlighted service | `display.ride.serviceId` |
| Map marker at rest | `display.progress.position` |
| Lottery log and candidate disclosure | `display.lotteryText`, `display.candidateRows` |
| Inventory, hints, effect chips | `display.itemView`, `display.effectModels` |
| Adjustment/discard mount and card closure | `display.decision` |
| Single live region | `display.announcement` |
| Toast acceptance | `display.toastInputs`, followed by existing resume-baseline filtering |
| ClearScreen and clear analytics | `display.showClear` |

Before lottery publication, the arrival marker uses the **ridden service’s arrival platform**, not the committed next service’s platform. This closes a less obvious result leak left by masking only `highlightedServiceId`.

Before movement finishes, detailed roll text must not call `lastRollText()` on the full new record: that text includes final physical hops and unused pips. Show a placeholder during tumble, then the raw roll, then published modifier wording. Publish the full historical roll description after arrival.

Construct the masked item view from the origin snapshot and explicit publication boundaries. Do not merely remove the picked-up item from the final inventory: final effects, certificate consumption, route hints, and item availability can also expose the drop.

For the initial implementation:

- Keep safe origin hints during the locked interval.
- Remove known pre-move consumed items when stamps finish.
- Hold arrival effects, certificate consumption, and retained pickup until the item-results boundary.
- Publish final item state when pickup completes, or at reveal completion if there is no pickup stage.
- Render `ItemEventNotice` only after its result is public; never feed it an unmasked new record earlier.

**Hook extensions**

```ts
export interface MoveAnimationOptions {
  startAllowed?: boolean; // default true
}

// Add as a final optional parameter to preserve current callers.
useMoveAnimation(
  animation,
  network,
  geometry,
  stepMs,
  onFinished,
  options?: MoveAnimationOptions,
): MoveAnimationState;
```

For `useRevealSequence`, add `skipRequested?: boolean` to options and an omission boolean to its pure `observe` action. Fold:

```ts
omit = reducedMotion || skipRequested;
```

into **both** new-key and existing-key observation branches:

```ts
done = alreadySeen || stageCount === 0 || omit; // new key
done = state.done || stageCount === 0 || omit; // same key
```

Remove the effect that completes reduced motion after commit. Return values must derive from the observed state immediately:

- `stage: "done"`
- `busy: false`
- `ready: movementComplete`

Completion is sticky for the key, so turning reduced motion off does not restart it. `skipRequested` similarly marks a future record done on its first observation.

```ts
export interface RollAdjustmentProps {
  // Existing props retained.
  onSkip?: () => void;
  canSkip?: boolean;
}

export interface SegmentFlashRequest {
  key: string;
  featureIds: readonly string[];
  durationMs: number;
}

export function segmentFlashOpacity(
  elapsedMs: number,
  durationMs: number,
): number;
```

Add independent `canSkip` to `GameHud`. Retain the current focusable dice button with `aria-disabled={!canRoll}` and its guarded handler. This provides disabled behaviour while preserving the existing focus contract. Keep its name within `/サイコロを振る|移動中…/`.

## Data Flow (per-turn timeline: normal, adjust path, discard path, goal turn, reduced motion, resume, skip at each point)

**Normal turn**

1. Guard the accepted roll with displayed `canRoll`.
2. In the same event handler, begin the presentation attempt and call `app.roll()`.
3. Preserve the existing pending/result saves and acknowledgements.
4. Once saved raw-roll facts are available, run the tumble once.
5. Run stamps if required; otherwise release immediately.
6. Open the movement gate. Existing hop progress drives station and completed segments.
7. Movement completion starts `arrival`; flash only newly completed target segments.
8. Run lottery flip/settle only when `serviceDrawRequired || directionDrawRequired`.
9. Publish landed ride after settle, or after arrival for forced choices.
10. Run pickup if present.
11. Publish final item state and enable rolling/item use, or present the required discard decision.

The ordinary extra duration is approximately 0.6 + 0.8 + 2.0 seconds, plus conditional stamps and pickup.

**Adjustment path**

1. The initial save exposes `awaiting-adjust` and its raw roll.
2. The displayed model withholds that decision while tumble runs.
3. Tumble completion publishes the raw roll and mounts `RollAdjustment`.
4. Its existing `showModal()` and heading focus run now.
5. Choosing a delta or “そのまま” resolves and saves the turn normally.
6. The resulting record attaches to the same attempt.
7. Run adjustment stamps, then movement and post-move stages.

The record’s appearance never starts another tumble.

Do not restore dice focus immediately after adjustment while the presentation is still active. Keep the restore request pending until interaction becomes available. If focus would otherwise fall to the document body after modal teardown, restore it to the existing focusable, presentation-disabled dice button; the overlay itself remains unfocusable.

**Discard path**

The engine can already be `awaiting-discard` while arrival, lottery, and pickup are still playing. The displayed decision remains `null`.

For a retained item, keep its target slot empty until the pickup lands. For a full inventory, animate toward the inventory header/rail, then open the existing four-candidate dialog. Do not temporarily replace an owned item or invent a fourth inventory slot.

At pickup completion, one display derivation:

- Publishes the item outcome.
- Exposes `decision.kind === "discard"`.
- Removes the panel live region and mounts the dialog’s existing live region.
- Closes any item card.
- Sets toast obscuration from that same presented decision.
- Allows the existing dialog to take focus.

Toasts accepted at this boundary enter paused behind the dialog. After selection and save acknowledgement, use the existing focus restoration and toast reading clocks. The appended discard event produces its new toast; the same reveal key prevents any replay.

Harmful drops and certificate cancellation are not inventory pickups. They publish through final effect state, canonical notices, and toasts after the arrival/lottery sequence. They do not fly into a nonexistent inventory slot.

**Goal turn**

Tumble → optional stamps → movement → arrival banner/optional flash → ClearScreen.

During the banner:

- Keep `GamePanel` mounted even though engine status is completed.
- Keep dice/item use unavailable and Skip available.
- Do not mount ClearScreen or run its focus effect.

After the banner, `display.showClear` becomes true. Use that same value for panel replacement, map inertness, and existing clear reporting. Announce goal completion through ClearScreen’s existing live region, avoiding a duplicate completion announcement immediately before replacement.

**Reduced motion**

Omit all P2 visual stages from the first committed render. Release the movement gate and retain the existing zero-step movement completion.

`busy` is false immediately; `ready` still waits for the accepted movement finish. This avoids publishing a result before movement is logically complete without showing an overlay frame or scheduling zero-duration stage timers.

If reduced motion turns on mid-turn, complete the current pre/post sequences irreversibly, finish movement instantly, clear flash, and expose any mandatory decision. Turning it off does not replay the current turn.

**Resume**

- Restored completed/idle record: show committed results immediately, with no moments or replayed toasts.
- Restored pending discard: show the discard dialog immediately; no pickup replay.
- Restored pending adjust: show the saved raw roll and dialog immediately; no tumble.
- Resolving that restored adjustment creates a new arrival result. Its newly chosen adjustment stamp, movement, arrival, lottery, and pickup may play normally.
- A restored pending roll that is automatically resolved because adjustment is unavailable also skips tumble. Treat any subsequently created arrival record as new, rather than replaying a restored result.

Keep the reveal baseline tied to restored records and pending discard records. Do not raise it to a restored pending roll’s future record turn, which would incorrectly suppress the new arrival.

**One Skip**

Skip is a presentation instruction, not an engine choice.

| Point of activation | Immediate effect | Remaining behaviour |
|---|---|---|
| Waiting for a saved raw roll | Latch Skip intent | After save, omit tumble/stamps; finish any resulting movement and reveal |
| Tumble/stamps, animation already exists | Complete pre-sequence and call `finishAnimation()` for that animation | Reveal’s first observation is already done |
| Tumble, adjustment still required | End tumble and show adjustment | Preserve Skip through the choice; later movement/reveal finish immediately |
| Adjustment dialog | Its Skip button latches the same intent | Leave selected radio and required choice intact; after Continue, omit all remaining animation |
| Resolving after adjustment | Retain Skip while waiting for save | Finish the eventual accepted animation without starting its runner |
| Movement | Finish current animation and complete reveal | Final result or required discard dialog appears |
| Arrival/lottery/pickup | Complete all remaining post stages | Publish final values, clear flash, then show discard/ClearScreen if required |
| Discard dialog | No presentation remains to skip | Required discard choice remains mandatory |

A small effect handles an animation that appears after a previously latched Skip: call `finishAnimation()` with its full identity. Keep its runner gated off. Repeated calls are harmless under the existing session reducer guards.

Use stable callbacks reading current identity through refs, following existing patterns. Stale timer/frame actions must also be rejected by attempt/reveal key and expected stage.

**Announcements**

Announce outcomes at publication boundaries, never when the engine first commits them:

- Tumble: neutral progress wording; no raw face.
- Adjustment: existing raw-roll instruction once the dialog is visible.
- Movement: published raw face/modifiers and movement wording; no final hop/landing/drop details.
- Arrival/lottery: arrival wording and “抽選結果を表示しています”; no selected next ride yet.
- Lottery completion: canonical landing wording.
- Pickup completion: canonical item outcome and any discard instruction.
- Ready: existing full announcement and “サイコロを振れます”.

This deliberately announces lottery results after the board has stopped and settled. It is never earlier than the visual reveal and avoids exposing hidden results through assistive technology. Preserve one gameplay live region, owned by panel, active decision, or ClearScreen.

**Dice and item interaction**

During reveal, `canRoll` is false even if engine phase is `idle`. The dice does not act as Skip.

Lock item use, draft editing, draft clearing, and route/direction selection until reveal completes. Guard callbacks as well as buttons; engine phase alone is insufficient.

Keep inspection of already-public inventory items available, including passive/unusable items, as required by P1. Cards use the masked view and disable “使う” with presentation wording such as `演出中は使えません`. Close a card when a presented decision opens. No arrival-derived hints or hidden pickup instance may enter its content.

## Error Handling Strategy

**Timers and stale work**

Each hook owns only its current stage’s timer. Cancel it on stage/key change, Skip, omission, screen change, and unmount. Duplicate observations return the same reducer state. Timer actions carry both key and expected stage.

Do not wait for CSS `animationend` or `transitionend` to progress gameplay presentation. Hidden tabs, unsupported transforms, and interrupted animations must still reach the committed result.

**Map flash**

Add exactly one layer, for example `railway-segments-flash`, above completed segments and below stations. Reuse the existing segments source and target-scoped feature-ID filter helper. Leave the completed layer’s ID and filter shape unchanged.

Initialize flash with an empty filter and zero opacity. Use one bounded opacity pulse over the arrival duration, with opacity sampled by a pure envelope helper. Avoid a repeated strobe.

`RailwayMap` owns the local frame loop:

- Key the start time by the flash request.
- Check layer existence before writes.
- Cancel callbacks and clear filter/opacity on Skip, null request, screen change, and teardown.
- Reapply current state on `layersRevision`.
- Preserve the original deadline through style reload; do not restart a full flash.
- If the deadline expired during reload, keep the new layer empty.

A failed/unavailable map does not block stages or decisions.

**Missing measurement or visual capability**

If a HUD/inventory target is absent or has no usable rectangle, finish the card with a local fade instead of a travel transform. Keep the same publication deadline.

If CSS 3D is unavailable, show the committed die face with a simple transform/opacity treatment. No rendering capability may determine the game result or prevent completion.

**Persistence and invalid data**

Preserve the existing “save attempt before presentation” rule, including save-failure behaviour and its sticky toast. Do not retry engine resolution or draw another result to recover an animation.

Distinguish valid absence from invalid state: no lottery, no pickup, and no new segments are ordinary cases; malformed committed records must not be silently replaced with fabricated results.

The principal implementation risks are missed raw-state consumers, Skip intent lost before record creation, modal focus restoration, and flash callbacks surviving style replacement. The test plan below targets these directly. Low-end CSS/GPU performance remains a browser/device verification item.

## Test Strategy

This task produced an architecture only. No files were changed and no test, typecheck, or build commands were run.

**Pure Vitest coverage**

Add table-driven coverage for:

- Timing at all three speeds, including the lottery split and normal-speed reference.
- Stage inclusion for service-only, direction-only, both draws, forced choices, goal, deadhead, pickup, and no pickup.
- Arrival retained when there are no new segments; flash restricted to newly completed target segments.
- Accepted click identity; duplicate observations; stale stage actions; one tumble across the adjustment path.
- Skip before raw-roll acknowledgement, before record creation, during adjustment, movement, every reveal stage, and repeated Skip.
- Restored idle/discard/adjust baselines and newly resolved arrival after restored adjustment.
- Reduced motion on initial observation and mid-stage, with no replay after preference reversal.
- Displayed ride, raw/effective roll, inventory, effects, hints, decision, announcement, toast eligibility, and ClearScreen at every stage.
- Marker staying at the ridden service’s arrival platform until landing publication.
- Current-turn candidates and full roll/arrival details absent before their publication boundaries.
- Inventory removal/publication for pre-move consumption, pickup, harmful scheduling, certificate cancellation, and discard resolution.
- Visible-map rectangle selection for desktop, phone, short landscape, clipping, and missing targets.
- Flash opacity and expired deadlines.

**Hook/jsdom coverage**

Extend `reveal-sequence.test.ts` with committed-value recording through `useLayoutEffect`, following its existing harness:

- Fresh nonempty key under reduced motion has no committed `busy:true` value.
- Omitted key before movement has `ready:false`; after movement, `ready:true`.
- Skip intent predating a record creates no stage timer.
- Equivalent stage arrays and ordinary rerenders do not reset deadlines.
- Session replacement and unmount leave no timers.

Extend movement tests to prove that a closed gate retains origin progress and schedules no frame, opens once, and handles instant completion and stale finish callbacks.

Use `mountReact`, `dispatchReactEvent`, and dialog polyfills for integration checks:

- No adjustment dialog before tumble completion.
- One gameplay live region throughout every handoff.
- Overlay never takes focus.
- Dice retains disabled semantics and its existing accessible-name pattern.
- Item use and draft actions remain blocked despite engine `idle`.
- Card inspection reads only public values.
- Pickup precedes DiscardChoice and toast pausing starts with the presented dialog.
- ClearScreen focus occurs only after the goal banner.
- A same-turn discard update appends notices without replaying moments.

Map mock tests must assert **11 layers**, the exact new order, unchanged completed-filter structure, empty flash initialization, and cleanup/reapplication across style reload and screen changes.

**Playwright coverage**

Add a motion-enabled `ui-pop-turn-moments.spec.ts` using saved engine outcomes as the oracle:

- Cube lands on saved `rawRoll`.
- Flap lands on saved landing service/direction.
- HUD, map, log, candidate list, inventory, and live region publish at the defined boundaries.
- One Skip covers each pre/move/post point, including inside adjustment.
- Reload during tumble, movement, lottery, or pickup does not replay restored results.
- Goal banner precedes ClearScreen.
- Phone and short-landscape placement keeps panel dimensions, attribution, and controls usable.

Update timing-sensitive dice/capital-region tests to advance through the captured pre-move duration before testing half-hop positions. Replace the old “6.1 seconds implies ClearScreen” assumption with explicit movement and arrival checkpoints.

Update `rollOnce()` to wait for enabled rolling or ClearScreen, not merely a visible dice label. A post-reveal disabled dice still retains that label. Adjustment/discard helpers must wait for the actual presented dialog rather than treating a saved pending record as proof it is mounted.

Run focused suites per implementation step. Final integration gates:

```bash
npm run typecheck
npx vitest run
npm run build
npm run test:e2e -- tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/resume.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts
```

The full four-browser matrix remains a CI gate. Review the complete diff to confirm that engine, save/RNG, network types, and public data boundaries remain untouched.

## Open Questions for the user (only genuinely product-level ones)

None are required to implement this design.

The technical defaults are explicit: full-inventory pickup targets the inventory header before the four-item choice; harmful drops use existing effect/notices rather than an inventory flight; Skip preserves mandatory adjustment/discard decisions; a newly resolved arrival after a restored pending adjustment receives normal post-move presentation.
