# Codebase Scan: UI pop P2 "turn moments" (presentation only)

- Date: 2026-11-03 · Branch `feature/ui-pop-turn-moments` (= `origin/develop` @ `70decd6`, v0.11.0 = P0+P1)
- Mode: affected-area scan, read-only. Complements `.claude/docs/research/ui-pop-overhaul-audit.md`
  (B.1 lottery, C.1 dice, C.4 toasts, C.5 arrival, D order) and
  `.claude/docs/plans/ui-pop-hud-inventory-handoff.md` (S5 reveal hook, S8 integration).
- Hard boundary: no change to `src/features/game/engine/**`, RNG, save format, `src/types/network.ts`,
  `public/data/**`. Everything below is data the UI already reads.
- Abbreviations: `G/` = `src/features/game/`, `C/` = `src/features/game/components/`, `M/` = `src/features/map/`,
  `E/` = `tests/e2e/`, `U/` = `tests/unit/`.

The product has a single edition and it is item mode (`src/features/editions/registry.ts:17` →
`DEFAULT_GAME_CONFIG = ITEM_GAME_CONFIG`, `G/gameConfig.ts:43-55`). Classic (`playTurn`) sessions exist only in
tests; for them `lastMove.itemRecord` is undefined, so the reveal key is always `null` (no P2 moments).

---

## A. Per-turn event order today (item mode)

### A.1 Sequence (reducer phases + save effect)

| # | Trigger | Code | Phase after | What changes |
|---|---------|------|-------------|--------------|
| 1 | Dice click | `G/useGameApp.ts:100-104` → `item-commit` | — | `C/GameHud.tsx:81` only calls `onRoll` when `canRoll` (`C/GamePanel.tsx:85`: `status==="playing" && phase==="idle"`). |
| 2 | `item-commit` | `G/itemSession.ts:136-142` → engine `beginItemTurn` (`G/engine/itemTurn.ts:19-28`) | `committing` | `game.pending = { kind:"roll", turn, rawRoll, resolvedRide, ... }` (die revealed, not shown yet). Deadhead skips the die: `beginItemTurn` resolves arrival at once → `stageResolution` → `resolving`. |
| 3 | Save effect | `G/useGameApp.ts:71-87` (write, then `item-save-attempted`) | — | Pending roll is **saved before anything is shown**. `itemTurnAnnouncement` returns `""` in `committing`/`resolving` (`G/presentation.ts:185`); `itemSessionView.events` is `[]` there (`G/itemSession.ts:247`). |
| 4a | No legal ±1 | `G/itemSession.ts:144-145` → `finishItemTurn` → `stageResolution` | `resolving` | Engine moves, draws landing (service then direction), draws item drop — all in `resolveArrival` (`G/engine/itemTurn.ts:67-133`). |
| 4b | ±1 legal | `G/itemSession.ts:146` | `awaiting-adjust` | `itemView.decision = { kind:"adjust", turn, rawRoll, ... }` (`G/itemSession.ts:230-232`); `RollAdjustment` dialog opens showing `rawRoll` (`C/GamePanel.tsx:366-370`, `C/RollAdjustment.tsx:22-28`). On choice: `item-adjust` → `finishItemTurn` → `resolving` (`G/itemSession.ts:154-156`). |
| 5 | `stageResolution` | `G/itemSession.ts:100-113` | `resolving` | `game` = final state (or `pending: discard` with `pending.position` + `pending.record`); `item.beforeMove` keeps the origin; `item.stagedAnimation` = `MoveAnimation` (`maxDurationMs: 6000`); `item.events` = full engine events incl. `segment-traversed` / `landing-resolved`. |
| 6 | Save effect | `G/useGameApp.ts:71-87` | — | **The completed turn (or pending discard) is saved here, before movement is shown.** Map/HUD still show `beforeMove` (`G/animation/displayedProgress.ts:38`). |
| 7 | `item-save-attempted` (resolving) | `G/itemSession.ts:148-152` | `animating` (or `idle` when no staged animation) | `session.lastMove = itemLastMove(record)` (landing, roll, record), `session.animation = stagedAnimation`. Reveal key `${sessionId}:${record.turn}` appears now. |
| 8 | Movement | `G/animation/useMoveAnimation.ts:64-77`, `runner.ts:25-56` | `animating` | rAF loop; `onDone` → `finishAnimation` → `animation-finished`. Skip calls the same (`src/app/GameApp.tsx:217-221`). Reduced motion: `stepMs = 0` (`GameApp.tsx:146`) → `runMoveAnimation` finishes synchronously (`runner.ts:33-36`). |
| 9 | `animation-finished` | `G/itemSession.ts:123-129` | `idle`, or `awaiting-discard` if `game.pending.kind === "discard"` | HUD ride/direction flip to the landed service (`G/presentation.ts:48-56`); log lottery line switches from `移動中…` to `landingText` (`C/GamePanel.tsx:304`); live region announces arrival + lottery + item outcomes (`G/presentation.ts:196-205`); `reveal.ready` → toasts (`GameApp.tsx:113-116`). |
| 10 | Discard (if full) | `C/GamePanel.tsx:371-375` → `item-discard` (`G/itemSession.ts:157-164`) | `resolving` → save → `idle` | No replay of movement (`stagedAnimation: null`). `lastMove` becomes the committed record (same turn → same reveal key; record gains a `discarded` event → one new toast). |

So in the user's terms: **roll click → (save pending die) → [adjust dialog] → engine resolves move + landing
lottery + item drop → save → movement animation → landing presented (HUD/log/live region) + pickup toasts →
[discard dialog → save]**. The lottery is drawn by the engine in step 4/5 and is already in
`session.lastMove.landing` during the whole movement animation; the UI just hides it until step 9.

### A.2 Where each committed value lives

| Value | Field (read-only) | Available from |
|-------|-------------------|----------------|
| Raw die | `game.pending.rawRoll` (kind `roll`) during `committing`/`awaiting-adjust`; `itemView.decision.rawRoll` for adjust; afterwards `lastMove.itemRecord.rawRoll` (`src/types/network.ts:207`) | Step 2 (die) / step 7 (record) |
| Effective face | `record.effectiveFace` (`network.ts:208`); also `lastMove.roll` (`G/itemSession.ts:82`) | Step 7 |
| ×2 | `record.command.items[].kind === "double"`; `pips = face × 2` (`G/engine/itemTurn.ts:61-64`) | Step 7 (pre-roll item already in `pending.command`) |
| ±1 | `record.adjustment = { instanceId, delta }` (`network.ts:209`) | Step 7 (choice made in the adjust dialog) |
| 寝過ごし | `record.movementMode === "oversleep"` (face = raw die, `itemTurn.ts:58`; moves to terminus / 6 stations) | Step 7 |
| 遅延 | `effectiveFace = 1` while `rawRoll` is the real die (`itemTurn.ts:43`); detected as `effectiveFace !== rawRoll && !adjustment` | Step 7 |
| 快速 | `movementMode === "rapid"`, `hopBudget` = station count | Step 7 |
| Ready-made label | `compactRollFor(lastMove)` → `{ face, label, modifier }` with modifier `×2` / `調整+1` / `調整-1` / `遅延` / `快速`, label `寝過ごし` (`G/hudPresentation.ts:36-60`) | Step 7 — reuse for stamps |
| Landing service + direction | `lastMove.landing.serviceId` / `.direction` (`LandingResolvedEvent`, `G/itemSession.ts:85-91`); next ride also = `game.currentServiceId/direction` (or `pending.position.*`) | Step 7 |
| Lottery candidates / flags | `landing.serviceCandidates`, `serviceDrawRequired`, `directionCandidates`, `directionDrawRequired`, `changedService`; weights in `record.landingSnapshot.services[]` (do not display: DESIGN 2026-10-28) | Step 7 |
| Ride during the move | `lastMove.serviceId/direction` = `record.resolvedRide` | Step 7 |
| Picked-up item | `record.itemEvents[]` `pickup-retained` / `pickup-pending-discard` (`network.ts:113-123`); pending discard: `game.pending.item`, `.candidates` | Step 7 |
| Newly completed segments | `segment-traversed` events with `newlyCompleted` in `session.animation.events` (while animating) and `session.item.events` (until the next decision; empty of move events after resume because it is rebuilt from `record.itemEvents`, `G/itemSession.ts:63`); per hop: `StepPath.newlyCompleted` (`G/animation/movePath.ts:18-22`, `129`) | Step 5/7 |

### A.3 When there is no lottery to reveal

`G/engine/landing.ts:9-13` (contract) and `G/itemSession.ts:88-90` (`serviceDrawRequired = snapshot.services.length > 1`,
`directionDrawRequired = service.directions.length > 1`):

- **Goal turn**: `landing === null` (`itemTurn.ts:74`, cleared). `ClearScreen` replaces the panel as soon as
  `status==="completed" && phase==="idle"` (`GameApp.tsx:228`).
- **Deadhead (回送列車)**: `landing === null`, `stopReason: "relocation"` (`G/itemSession.ts:74-78`).
- **Single service at the station** and **single direction**: forced, no draw. Yamanote (target) direction is
  always `config.targetDirection` (外回り), never drawn (`landing.ts:137-140`), so a Yamanote-only station or a
  Yamanote landing has at most a service draw and never a direction draw.
- **Endpoint reversal**: one movable direction → forced (`landingText` "…のため折り返し", `G/presentation.ts:109-112`).
- **Filtered to one**: suspension / detour filtering happens before the snapshot (`itemTurn.ts:75-93`);
  `landingSnapshot.suspensionIgnored` = every candidate was suspended; `detourConsumed` = ridden service removed.
- Service draw only / direction draw only are both possible; `landingText` (`G/presentation.ts:83-114`) is the
  canonical classification (`…から抽選 → X`, `Xのみ`, `方向抽選 → D`, `Dに固定`, `折り返し`, `乗車方向はDのみ`).
- Not a landing lottery: the route ticket's "向きは抽選" is drawn at turn start (`prepareItemTurn`), already in
  `record.resolvedRide`.

---

## B. `useRevealSequence` wiring (S5 hook, S8 integration)

Hook: `G/animation/useRevealSequence.ts` (168 lines). Pure `revealReducer` (`:61-106`) + hook (`:117-168`).

- **Observation** (`GameApp.tsx:99-109`):
  `sessionId`, `recordTurn = session.lastMove?.itemRecord?.turn ?? null`, `gameTurn = game.turn`,
  `pendingDecisionTurn = itemView.decision ? game.turn : null` (note: `game.turn`, not `decision.turn`),
  `movementComplete = phase !== "animating"`.
- **Key** = `${sessionId}:${recordTurn}` (`:69-71`). Baseline = `max(gameTurn, recordTurn, pendingDecisionTurn)`
  captured only on session change (`:55-61`, `:67`), so resumed records start `done` (no replay). A turn
  resolved after resuming into a pending **adjust** has `record.turn = game.turn + 1 > baseline` and *would*
  reveal (it is a fresh draw); a resumed pending **discard** does not (its record turn is the baseline).
- **Stages**: `NO_REVEAL_STAGES` module constant (`GameApp.tsx:52`, passed at `:107`). With `stageCount === 0`
  the reducer marks every key `done` immediately (`:78`, `:82`); `busy` is always false and `ready ===
  movementComplete`.
- **Timers**: a stage only runs when `armed = pending && movementComplete` (`:131`) — **stages can only play
  after the movement**, never before it. Only the current stage's `durationMs` is a timer dependency (`:142-149`).
- **Outputs** `{ key, stage, busy, ready, skip }` (`:160-167`); `stage` is `"waiting"` while moving, the stage
  key while armed, `"done"` otherwise.
- **Consumers today**: `reveal.ready` gates toasts (`GameApp.tsx:113-116`, `:131-135`); `reveal.skip` is called
  by the panel スキップ via a ref (`:110-111`, `:217-221`), which also calls `finishAnimation`, so **one Skip ends
  both the reveal and the move**. `busy` and `stage` are unused. `GamePanel` does not receive the reveal at all.
- **Interaction with movement**: none beyond `movementComplete`. `useMoveAnimation` gets `session.animation`
  directly (`GameApp.tsx:147-153`); the reveal cannot delay or hold movement.
- **Known reduced-motion issue** (handoff S5 "Open"): under reduced motion with non-empty stages, completion is
  dispatched from an effect (`:136-139`), so the first commit of a new key has `done:false` → `busy:true`,
  `stage:<first>`/`"waiting"`, `ready:false`. Effects run after paint, so a split-flap overlay would flash one
  frame and `ready` (toasts, any decision gate) lags one commit. Fix candidate (hook-local, pure): fold
  `reducedMotion` into the render-phase observe (`done: alreadySeen || stageCount === 0 || reducedMotion`) or
  return `busy = … && !reducedMotion`; the existing tests at `U/reveal-sequence.test.ts:215`, `:224`, `:262`
  pin the related behaviour and need one new first-commit-under-reduced-motion case.
- Unit tests: `U/reveal-sequence.test.ts` (25 tests; `Harness` at `:45-50` records commits via
  `useLayoutEffect`, asserts `vi.getTimerCount()`).

**Implications for P2**: the split-flap, arrival banner, segment flash and pickup can be post-move reveal stages
on this hook. The **dice tumble is pre-move** and is not expressible with the current hook (stages arm only after
`movementComplete`); it needs either a second, pre-move sequence or a "hold" on movement start (see G.2).
Stage lists vary per turn (draw vs forced, pickup vs none, goal) — the hook tolerates a new array as long as its
content is stable per key.

---

## C. Map: completed segments, flash hook point, camera

- **Layers** (`M/mapConfig.ts:48-65`, added in `M/railwayLayers.ts:72-209`) in order: `railway-base`,
  `railway-services`, `railway-current-service` (highlight, filter by featureId), `railway-segments-pending`
  (grey dash), `railway-segments-completed` (solid target colour), station circles ×2, labels ×2,
  `game-current-position-circle` (marker). Sources: `railway-segments`, `railway-stations`,
  `game-current-position`.
- **Progress data path**: `GameApp.tsx:154-170` → `displayedProgress(sessionProgress(session), network, view)`
  (`G/animation/displayedProgress.ts:43-73`) → `visibleCompletedSegmentIds(committed, steps, stepsCompleted)`
  (`G/animation/timeline.ts:56-69`: committed minus segments this move completes in later hops) → filtered to
  target ids → mapped to `geometryFeatureIds` → `MapProgress.completedFeatureIds` (`M/railwayLayers.ts:52-56`).
- **Apply**: `RailwayMap.tsx:378-383` keys the effect by content (`completedKey`), calls
  `updateCompletedSegments` (`M/railwayLayers.ts:242-250`) which sets both filters via
  `completedSegmentFilter`/`pendingSegmentFilter` (`M/progressStyle.ts:10-23`). The list already grows **per hop**
  during the move, so a "newly completed" moment is observable as a diff of `completedFeatureIds` between renders,
  or from `view.steps[i].newlyCompleted` as `frame.stepsCompleted` passes `i`.
- **Flash hook point** (none exists today): add an optional `MapProgress` field (e.g. flash feature ids), a new
  line layer above `railway-segments-completed` with a featureId filter, and drive it with
  `setFilter`/`setPaintProperty` (or a `line-opacity-transition`). Constraints:
  - `U/map-station-markers.test.ts:135` asserts `order.toHaveLength(10)` layers and the source list at `:134`
    (re-point to the new count, do not delete).
  - `E/support/app.ts:270-275` `readMap` reads `segmentsCompleted`'s filter shape
    `["all", target, ["in", featureId, literal]]` — the completed filter must stay exactly that; flash in its own layer.
  - Layers are re-added on style reload (`layersRevision` in every effect, `RailwayMap.tsx:381-404`); a flash
    effect must depend on `layersRevision` too and guard `map.getLayer`.
  - Reduced motion: no flash (or a static highlight).
- **Highlight**: `progress.highlightedServiceId = displayedRide(session).serviceId` (`GameApp.tsx:166`) — flips to
  the landed service at `animation-finished`, i.e. before any split-flap would finish (spoiler, see G.1).
- **Camera** (`RailwayMap.tsx`): follow recentres on every `position` change (`:431-436`), `immediate` while
  animating or under reduced motion (`GameApp.tsx:182`). Phone / short-landscape (`max-width: 600px` or
  `max-height: 500px`) pad the bottom by the **visible `.game-panel` height** (`phonePanelBottomPadding`,
  `:164-172`, read via `document.querySelector(".game-panel")`). `useCameraLayoutObserver` (`:87-120`)
  ResizeObserves the map container and the `.game-panel` root and recentres when `cameraLayoutKey` changes
  (`:188-192`, `:439-448`). The network overview fit also uses the panel top (`fitNetworkOverview`, `:143-162`).
  ⇒ A P2 overlay must not resize or reflow `.game-panel` (the panel has a fixed height on every layout:
  desktop `styles.css:340-358`, phone `:1566-1592` `height: 45%`, short landscape `:1840-1864`; dice position was
  fixed deliberately in S10b) — mount it as a fixed-position sibling like `ToastHost` (`GameApp.tsx:283-289`).
- E2E hook: `M/e2eHook.ts:14-22` publishes `window.__sugorokuE2E.map` only in `--mode e2e`.

---

## D. Dialogs relative to movement; toast pausing

- **ItemUseDialog** (route / direction ticket): only before the roll. `activateInventoryItem` requires
  `phase === "idle" && !decision && usable` (`C/GamePanel.tsx:193-201`); `selectItem` re-checks idle
  (`:182-191`). Open state is reported up via `onItemDialogOpenChange` (`:172-177`) → `itemDialogOpen` in GameApp.
- **Item card popover** (inspect): `ItemCardPopover`, auto-closed when a decision appears (`C/GamePanel.tsx:208-212`).
  Opening it does not obscure toasts.
- **RollAdjustment**: between die reveal and movement (`awaiting-adjust`), `showModal()` + heading focus in
  `useLayoutEffect` (`C/RollAdjustment.tsx:22-28`); Escape = そのまま (`C/RollAdjustment.tsx:39-42`).
- **DiscardChoice**: after movement. It mounts the moment `phase` becomes `awaiting-discard`
  (`animation-finished`, `G/itemSession.ts:127`) → `itemView.decision.kind === "discard"`
  (`G/itemSession.ts:233-234`) → `C/GamePanel.tsx:371-375`. `showModal()` in `useLayoutEffect`, mandatory
  (cancel prevented, reopens on forced close; `C/DiscardChoice.tsx:19-42`). It shows 4 `ItemCard`s with
  `isNew` on the pickup (`:56`).
- **Live region while a decision is open**: the panel's single `role=status` is unmounted when
  `itemView.decision` is non-null (`C/GamePanel.tsx:350`); both dialogs render their own `role=status` with the
  same `announcement` (`C/DiscardChoice.tsx:48`, `C/RollAdjustment.tsx:52`). So exactly one live region exists
  at any time.
- **Focus**: decision open → `restoreRollFocusRef = true`; back to idle → dice button focus
  (`C/GamePanel.tsx:231-240`). Panel heading is focused on mount unless a decision is pending (`:255-259`).
- **Toast pausing**: `ToastHost obscured = confirm !== null || itemView.decision != null || itemDialogOpen`
  (`GameApp.tsx:287`); `ToastHost` pauses each toast's reading clock and clears its timer while obscured
  (`C/ToastHost.tsx:60-95`). Toast inputs exist only after `reveal.ready` (`GameApp.tsx:113-116`). Reading time
  4,000 ms, max 3 visible (`G/toastQueue.ts:8-9`). Toasts are `aria-hidden` and `pointer-events: none`
  (`C/ToastHost.tsx:105`, `src/styles.css:47-58`, `:76`).
- **Pickup vs discard today**: with a pending discard, the pickup toast (`pickup-pending-discard`) is enqueued
  at `ready` in the same commit in which `DiscardChoice` opens, so it sits paused behind the modal until the
  choice (`U/game-app-item-progress.test.ts:366-389` pins this: 2,499 ms visible / 2,500 ms gone after the choice).
- **Inventory during the move**: `itemSessionView` uses `pending.position` only for a pending discard
  (`G/itemSession.ts:217-218`); for a retained pickup `view.inventory = game.inventory` already contains the
  new item **while the marker is still moving** (the inventory is rendered throughout, `C/GamePanel.tsx:265`).
  A pickup "fly into the inventory" animation must mask that slot until its stage (presentation-only view
  filter), otherwise the item is visible before it is picked up.
- **ClearScreen** has its own live region (`ItemEventNotice` `completionAnnouncement`, `GameApp.tsx:290-305`)
  and appears as soon as movement finishes on the goal turn.

---

## E. Speed, reduced motion, motion-enabled specs

- **Speed (速度)**: `ANIMATION_SPEEDS` slow 600 / normal 450 / fast 300 ms per hop (`G/gameConfig.ts:59-64`),
  default `normal` (`:68`). State `speedId` in `GameApp.tsx:83`, cycled by the menu button
  (`C/GameMenu.tsx:100-108`; disabled and labelled `速度: 省略` under reduced motion). `stepMs = reducedMotion ? 0
  : speed.stepMs` (`GameApp.tsx:146`); hop time scales with √distance, 2/3–8/3 × stepMs
  (`G/animation/timeline.ts:17-27`), whole item move capped at 6,000 ms (`MAX_MOVE_DURATION_MS`, `timeline.ts:29`). The
  speed is read when a move starts (`useMoveAnimation.ts:33-37`). Nothing else scales with speed today; reveal
  stage durations would need an explicit factor (e.g. `stepMs / 450`; audit suggests はやい → ~0.6 s lottery).
- **CSS motion tokens**: `--motion-fast/normal/slow` 120/200/300 ms (`src/styles.css:37-39`), forced to 0 under
  `prefers-reduced-motion` (`:207-213`); toast enter animation disabled there (`:215-220`); progress-bar segment
  transition disabled (`:492-496`). Layer tokens: panel 10, screen 20, map-error 25, toast 30, banner 40
  (`:40-44`); dialogs are in the browser top layer.
- **Reduced-motion detection**: `usePrefersReducedMotion()` (`G/usePrefersReducedMotion.ts`, live via
  `useSyncExternalStore` on `(prefers-reduced-motion: reduce)`; `false` when `matchMedia` is missing, so **jsdom
  unit tests run with motion on**). Read once in `GameApp.tsx:82`, passed to `GamePanel`, `ToastHost`,
  `useRevealSequence`, `mapFollow.immediate`.
- **E2E default**: `playwright.config.ts:57-59` `reducedMotion: "reduce"` for every project ("tests that need
  the animation opt out"). Opt-outs (`reducedMotion: "no-preference"`):
  - `E/dice.spec.ts:128-213` — triple click during a move (`:132`); marker half a hop in at `STEP_MS/2`
    after `freezeClock` (`:170-212`, `:190`).
  - `E/lottery.spec.ts:40-67` — "skip reveals the committed transfer…": one スキップ, then 乗車中 = landed
    service, marker on its platform, reload does not redraw.
  - `E/resume.spec.ts:76-134` — reload mid-move; pickup toast after skip (count 1) and no replay after reload.
  - `E/items.spec.ts:332-356` (rapid/oversleep skip), `:418-445` (long rapid goal: `runFor(32)` +
    `fastForward(6_100)` → `クリア！` focused).
  - `E/capital-region.spec.ts:211-…` and `:297-…` — mid-hop timing computed from `frameAt`/`hopDurationMs`
    after `runFor(16)`; the second expects 乗車中 and the map highlight to be the **landing** service right after
    `fastForward(remaining + 50)`.
  - `E/accessibility.spec.ts:48-62` — real clock: dice keeps focus during and after a move and returns to
    `サイコロを振る` within the 7 s expect timeout.
- Explicit `reduce` blocks also exist (`hud-layout`, `save-errors`, `accessibility`, `ui-pop`) — unaffected.
- There is no P2 motion spec yet; audit D asks for one that checks the flap lands on the saved
  `landing.serviceId` and that Skip ends it.

---

## F. Test conventions

- **jsdom component tests**: `// @vitest-environment jsdom`; `U/helpers/reactDom.ts` — `mountReact(node)` (sets
  `IS_REACT_ACT_ENVIRONMENT`, returns `{container, root, render, cleanup}`), `flushReact()` (two
  `setImmediate` under `act`), `dispatchReactEvent(el, event)`.
- **GameApp integration** (`U/game-app-item-progress.test.ts`): `RailwayMap` mocked (`:18-22`, records props);
  `HTMLDialogElement.showModal/close` polyfilled (`:38-47`); `requestAnimationFrame` stubbed to never fire
  (`:62`, `:94`) so a move only ends via `click("スキップ")`; `click(label)` finds a button by `textContent`
  **substring** (`:84-89`) — button labels `サイコロを振る` / `スキップ` are load-bearing; `advanceTime(ms)` =
  `act(() => vi.advanceTimersByTime(ms))` after `vi.useFakeTimers()` (`:105-107`); engine-built scenarios from
  `E/fixtures/itemScenarios`. `:391-429` asserts `requestAnimationFrame` **was called right after the roll
  click** and that station/progress stay at the origin until Skip (a pre-move tumble hold changes this).
- **Reveal hook tests**: `U/reveal-sequence.test.ts` (Harness + `vi.getTimerCount()`), pattern to copy for any
  new sequence reducer.
- **Other affected unit suites**: `U/game-hud.test.ts`, `U/toast.test.ts`, `U/animation.test.ts`,
  `U/game-presentation.test.ts` (landing/roll text), `U/map-station-markers.test.ts:135` (layer count),
  `U/capital-region-scaling.test.ts:155-169` (mock map with `addLayer/getLayer/setFilter/setPaintProperty`).
- **E2E helpers** (`E/support/app.ts`): `gamePanel` = `main[aria-label=ゲーム操作]` (`:64`); `diceButton` matches
  `/サイコロを振る|移動中…/` (`:68-70`) — any tumble label must stay within that; `panelStat(label)` by
  `data-stat` (`:72-93`; `出目` → `data-stat="roll"` inside the log, `C/TurnLogDrawer.tsx:76`);
  `hudCompactRoll` (`:83-86`); `openGameLog/closeGameLog` (`:95-109`); `inventoryItem(name)` = `.item-slot`
  with heading (`:131-134`); `useInventoryItem` (`:137-142`); `rollOnce` (waits on the save, clicks the last
  discard choice, then waits for `サイコロを振る` or `クリア！`, `:156-170`); `revealUnadjustedRoll` (`:172-182`);
  `freezeClock` after `page.clock.install()` (`:188-191`); `readMap` (`:210-280`).
- **Text that P2 must keep** (re-point, never loosen):
  - `.game-panel__lottery` exact/contains text — 13 occurrences in 6 specs (capital-region 4, lottery 3,
    accessibility 3, real-data 1, items 1, tokyo-suburban 1); `抽選: 移動中…` during the move
    (`E/lottery.spec.ts:57`, `E/capital-region.spec.ts` mid-hop).
  - `panelStat(page, "出目")` — 8 uses (dice 2, lottery 2, items 2, capital-region 1, hud-layout 1), e.g.
    `3（3マス、2駅移動、残り1は使わず）`; `hudCompactRoll` 4 uses in `E/hud-layout.spec.ts`.
  - Live region (`getByRole("status")`) — `E/items.spec.ts` asserts exactly one `[role=status]` in the panel
    (`:52`) and texts `サイコロを振れます`, `倍速券を選択中`, `出目は${raw}` (inside the adjust dialog, `:213`),
    `調整後${raw+delta}` (`:225`), `遅延が発動しました` (`:308`), `快速券を使いました` / `寝過ごしが発動しました`
    (`:399`), `ゴールに到着しました` (`:441`); accessibility 9 assertions.
  - Under reduced motion `スキップ` stays disabled after an instant move (`E/items.spec.ts:398`).
- Local policy (memory): run only affected specs per step; the 4-browser matrix is CI's job.

---

## G. Risks for a P2 overlay

1. **Spoilers through existing channels.** At `animation-finished` the HUD ride/direction
   (`G/presentation.ts:48-56`), the map highlight (`GameApp.tsx:166`), the log lottery line
   (`C/GamePanel.tsx:304`) and the live region (`G/presentation.ts:196-205`) all show the landing at once; the
   inventory shows a retained pickup during the move (D). A split-flap / pickup moment needs a presentation-level
   "displayed" view (ride, highlight, inventory, maybe announcement) gated on its stage, or it reveals nothing
   new. Tests that read 乗車中/highlight right after movement under motion (`E/lottery.spec.ts:59`,
   `E/capital-region.spec.ts:300-…`) must then also advance or skip the reveal.
2. **Holding the move for the dice tumble.** Withholding `session.animation` from `useMoveAnimation` is unsafe:
   in `animating` the committed `game` is already the arrival state and only `AnimationView` masks it
   (`displayedProgress.ts:48-55`), so with `view === null` the marker, station, progress and segments jump to the
   arrival before the move. Hold the runner instead (keep the `AnimationView` with `frame: null` →
   `stepsCompleted 0` = origin), e.g. a start gate in `useMoveAnimation`. Skip must still end tumble + move +
   stages in one press (`GameApp.tsx:217-221`), and `animation-finished` stays the only phase transition.
   Adjust path: the die is shown in the `RollAdjustment` dialog immediately at `awaiting-adjust`, so a tumble
   must land before that dialog opens; resume into `awaiting-adjust` must not tumble (no click happened).
3. **Single live region.** Do not add `role=status`/`aria-live` to overlays (`E/items.spec.ts:52`); mark
   flap/dice/banner `aria-hidden` and keep `itemTurnAnnouncement` as the only text source. Deferring the
   DiscardChoice mount while `itemView.decision` is already non-null would also unmount the panel live region
   (`C/GamePanel.tsx:350`) and pause toasts (`GameApp.tsx:287`) with no dialog on screen — gate a
   "presented decision" consistently across the panel, `ToastHost.obscured`, focus restore and card close.
4. **Focus and interaction.** Overlays must not be `<dialog>` (`modalDialogOpen()` = `dialog[open]`,
   `C/GameMenu.tsx:26-28`, suppresses Escape handling in the menu and draft) and must not take focus — the dice
   keeps focus through a move (`E/accessibility.spec.ts:51`). During a post-move stage `phase` is `idle`, so the
   dice (`canRoll`), item use and card opening are live: decide "roll/tap = skip" or block. `スキップ` is
   disabled whenever `!animating` (`C/GameHud.tsx:86`); a post-move reveal needs it (or the overlay tap) enabled
   only while `reveal.busy`, while keeping it disabled under reduced motion.
5. **Pointer events over the map.** `ToastHost` is `pointer-events: none`; a tap-to-skip overlay captures map
   drags/pinches for ~2 s. Keep the hit area to the card, and keep it off the attribution (top-left on phone,
   `--map-attribution-bottom`), zoom buttons (right), and the toast column (phone: left 10px / right 84px,
   `src/styles.css:155-160`). Choose a z-index between panel (10) and toast (30) or above toasts deliberately.
6. **Layout.** Do not render inside `.game-panel`: phone and short-landscape use named grid areas
   (`src/styles.css:1566-1592`, `:1840-1864`) and the camera pads by the panel (C). Phone: map is the top ~55%;
   short landscape: map is right of a ≤440px panel.
7. **Goal turn.** No landing; `ClearScreen` appears on `animation-finished` (`GameApp.tsx:228`) and takes
   focus. An arrival banner / pickup stage on the goal turn would race it; `E/items.spec.ts:419-445` expects
   `クリア！` after `fastForward(6_100)` — a pre-move tumble eats into that budget.
8. **Timing-sensitive tests.** Pre-move tumble shifts every frozen-clock motion test: `E/dice.spec.ts:190`
   (half hop at `STEP_MS/2`), `E/capital-region.spec.ts` (`runFor(16)` + computed `fastForward`),
   `U/game-app-item-progress.test.ts:422` (rAF called right after the click). Post-move stages delay
   `reveal.ready` → toasts; tests that click スキップ once are fine only if Skip completes all stages. Real-clock
   `E/accessibility.spec.ts:51` adds ~0.6 + 2 + 0.8 s per turn to the 7 s expect timeout. Re-point with the new
   durations; do not loosen.
9. **Reduced motion one-commit `busy`** (B): fix in the hook before wiring non-empty stages, otherwise the
   overlay flashes one frame and toasts lag a commit under the default E2E setting.
10. **Determinism / boundary.** Flap and dice faces must be derived from committed fields only (no
    `Math.random`; precomputed sequences ending on `landing.serviceId` / `rawRoll`), no engine value imports in
    components beyond types and existing presentation helpers. Same-group services (大江戸線) should use
    `presentation.candidateRows` / `sameLineGroup` and `lineBadgeFor` (`G/lineBadge.ts:199`) like the log.
11. **Pace.** ~55-turn median game × (0.6 + 2 + 0.8 s) ≈ +3 min; couple durations to 速度 and keep tap-to-skip.
