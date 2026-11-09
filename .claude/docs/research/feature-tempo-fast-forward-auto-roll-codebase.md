# Issue #64 (tempo / long-game pacing): affected-area codebase scan

Mode: existing codebase. Read-only scan at `develop` @ a8e928e (v0.12.0). Audience: Codex (design).
Candidates: (a) 4th speed "とても速い", (b) persisted 演出 level, (c) auto-skip of uneventful turns,
(d) 「おまかせで進む」 auto-roll, (e) settings persisted under a dedicated localStorage key,
(f) global keyboard shortcuts.

All paths are relative to the repo root. `file:line` refers to the current tree.

---

## 1. Affected modules and what each does today

| File | Lines | Role today | Candidates |
|------|------:|-----------|-----------|
| `src/features/game/gameConfig.ts` | 69 | `ANIMATION_SPEEDS` (60-65): slow 600 / normal 450 / fast 300 ms per hop; `DEFAULT_ANIMATION_SPEED = "normal"` (69). | a, e |
| `src/app/GameApp.tsx` | 488 | Composition root. `speedId`/`follow` are plain `useState` (101-102), so they reset on every remount. `speedById`/`nextSpeedId` cycle (73-80). Wires `useTurnMoments` (148-176), `useMoveAnimation` (197-204), the shared `skip` (332-337), `guardedRoll` (290-294), the reveal stage list (143-147), the lottery and pickup models (348-365), and the `TurnMomentHost` overlay (429-433). Already near the 400-line target, so new logic should go into hooks. | a-f |
| `src/features/game/animation/turnMoments.ts` | 252 | Pure attempt reducer. `turnMomentTiming(stepMs)` scales every stage by `stepMs/450` (83-97). `buildTurnRevealStages` (138-156) produces arrival, then optional lottery-flip+settle, then optional pickup. `beginAttempt` treats reduced motion and restored rolls as `omitted` (182). The `skip` action (169-172) sets `released` and `motionOmitted`. `observeAttempt` (207-239) derives `newlyCompletedTargetSegmentIds` and `stampsRequired`. | a, b, c |
| `src/features/game/animation/useTurnMoments.ts` | 207 | Hook around that reducer. Timers for tumble and stamps (122-132). `begin` captures `turnMomentTiming(current.stepMs)` (134-142). The reveal stage durations are frozen per reveal key from the attempt's timing (144-152, `durationForStage` 68-78). `skip` (165-169). It auto-finishes the owned animation on skip (176-185). `movementStartAllowed` (193-194). | a, b, c |
| `src/features/game/animation/useRevealSequence.ts` | 164 | Post-move stage sequencer keyed `${sessionId}:${recordTurn}`. `omit` = reducedMotion OR skipRequested (129). An empty stage list means done at once (84, 156-159). One `setTimeout` per stage (142-149). | a, b, c |
| `src/features/game/animation/timeline.ts` | 69 | `hopDurationMs` scales by the square root of the distance, clamped to [2/3, 8/3] × stepMs (224-234). `MAX_MOVE_DURATION_MS = 6000` is a fixed value, independent of speed (236). | a |
| `src/features/game/animation/useMoveAnimation.ts` | 101 | Reads `stepMs` once per move. `stepMs <= 0` finishes the move instantly (342-363). | a, b |
| `src/features/game/turnMomentPresentation.ts` | 332 | `deriveTurnMomentDisplay` (145-259) is the single source of the permissions `canRoll` (208), `canSkip` (228) and `itemUseLocked` (256 = `active`, from 188). It also derives the publication phase (70-80), the announcements and the toasts. | b, c, d, f |
| `src/features/game/components/GamePanel.tsx` | 371 | Panel. Owns `activeSurface` ("log"/"menu"/"card", 141), `itemDialog` (136-139), the Escape-to-clear-draft listener (213-224), and the dice focus restore after decisions (228-243; the issue cites this spot). It renders `RollAdjustment` and `DiscardChoice` (357-368) and passes `speedLabel`/`onCycleSpeed` to `GameMenu` (327-343). | d, f |
| `src/features/game/components/GameHud.tsx` | 106 | The dice button (85-93: `aria-disabled={!canRoll}`, label 「移動中…」/「この内容でサイコロを振る」/「サイコロを振る」) and the スキップ button (94: `disabled={!canSkip}`). | d, f |
| `src/features/game/components/GameMenu.tsx` | 123 | Menu buttons 追尾 / 速度 / 新規 / タイトル (96-111). The speed button is disabled and shows 「省略」 under reduced motion (100-107). `modalDialogOpen()` = `dialog[open]` exists (26-28). Capture-phase Escape closes the menu (51-64). | a, b, d, e, f |
| `src/features/game/components/TurnMomentHost.tsx` | 465 | Overlay host (aria-hidden, no focus). `turnMomentDiceModel` (265-276) returns null if `motionOmitted`/`skipRequested`. `turnMomentArrivalModel` (287-294) applies only in the `arrival` stage. A card tap calls Skip (458). | a, b, c |
| `src/features/game/components/LotteryReveal.tsx` | 63 | 8-frame flap. Timing comes only from the `--lottery-ms` CSS variable (58). CSS: `src/styles.css:2418-2437`. | a |
| `src/features/game/components/DiceTumble.tsx`, `ItemPickupMoment.tsx` | 175 / 71 | Their durations come from props, as `--dice-stage-ms` (`styles.css:354,358`) and `--pickup-ms` (`styles.css:2468`). | a |
| `src/features/game/components/RollAdjustment.tsx`, `DiscardChoice.tsx`, `ItemUseDialog.tsx`, `ConfirmDialog.tsx` | 90/66/187/70 | Native `<dialog>.showModal()`. Escape in RollAdjustment means 「そのまま続ける」 (57, 80). DiscardChoice refuses to close (46: `onCancel=preventClose`, reopens). | d, f |
| `src/features/game/components/TurnLogDrawer.tsx` | 91 | Disclosure with a capture-phase Escape (37-45), the same pattern as GameMenu. | f |
| `src/features/game/useGameApp.ts` | 151 | Owns the app reducer and the save effects (68-87). `roll` dispatches `item-commit` or `roll` with identity (100-104). `trackEvent("game_start")` (116, 120). | d |
| `src/features/game/gameSession.ts` | 235 | `SessionPhase` = idle/committing/awaiting-adjust/resolving/animating/awaiting-discard (25). Classic roll path (156-172). `reduceAppState` (191-223). | d |
| `src/features/game/itemSession.ts` | 274 | Item turn state machine (120-168). `adjustmentOptions` (46-52) decides whether an adjust decision exists. `itemSessionView` (213-274) computes `decision` (230-235) and `usableItems[].usable/reason` (256-272). | d |
| `src/features/game/store/persistence.ts` | 140 | `SAVE_STORAGE_KEY = "yamanote-line-sugoroku:save:v1"` (21). `StorageLike` (24-28). Guarded read/write/delete (99-140). | e |
| `src/features/game/store/browserStorage.ts` | 14 | `getBrowserStorage()` returns null when touching localStorage throws. | e |
| `src/features/game/usePrefersReducedMotion.ts` | 22 | Live `matchMedia` via `useSyncExternalStore`. | b |
| `src/features/map/lineVisibilityStore.ts` | 50 | Module-level `useSyncExternalStore` store, not persisted. It is a precedent for a shared settings store. | e |
| `src/features/game/toastQueue.ts`, `components/ToastHost.tsx` | — | `MAX_VISIBLE_TOASTS = 3`, `TOAST_READING_MS = 4000` (8-9). `obscured` pauses the toasts (GameApp.tsx:438). | d |
| `src/features/analytics/analytics.ts` | 165 | Whitelisted events `game_start`/`game_clear`/`result_share` (6, 26-35). Opt-out key `yamanote-line-sugoroku:analytics-opt-out` with try/catch (1, 57-62, 128-129). | d (optional) |
| `src/features/editions/registry.ts` | — | Per-edition save key: `saveKeyForEdition` (7-11). Settings should be global, not keyed by edition. | e |
| `src/features/game/engine/proximity.ts`, `engine/goal.ts` | — | `nearestTargetStation`, `targetHopDistances` (distance to the target *service*). `checkGoal` = on the start station with every target segment complete. No "near goal" helper exists. | d |

`SAVE_VERSION = 4` lives at `src/features/game/engine/game.ts:24`. None of the candidates needs to touch it.

---

## 2. Turn sequencing and decision points (auto-roll stop conditions)

### Item-mode turn (the product default: `DEFAULT_GAME_CONFIG = ITEM_GAME_CONFIG`, gameConfig.ts:43-55)

1. **Pre-roll, `phase: "idle"`.** The player may stage one item (`item-draft`, itemSession.ts:132-135).
   Usability comes from `itemSessionView().usableItems` (itemSession.ts:256-272):
   - `delay-certificate` → `passive`;
   - `roll-adjust` → `after-roll`;
   - during forced turns (oversleep pending, or delay due), every item → `forced-turn`.
   - **Decision point A:** `usableItems.some(u => u.usable)` or a non-empty `draft.items`.
2. **Roll click.** `GameApp.guardedRoll` (290-294) checks `turnDisplayRef.current.canRoll`, then calls `beginTurnMoment("click")` and `roll()`.
   - `roll` dispatches `item-commit` (useGameApp.ts:100-104).
   - `beginItemTurn`: if the result is a pending roll, the phase becomes `committing`; otherwise `stageResolution` sets `resolving` (itemSession.ts:136-142).
3. **Save effect.** It writes, then dispatches `item-save-attempted` (useGameApp.ts:71-87). That leads to one of:
   - `awaiting-adjust`, when `adjustmentOptions` is non-empty (itemSession.ts:143-147);
   - auto-resolution (145);
   - `animating`/`idle` with `lastMove` (148-152).
4. **Pre-move presentation** (attempt reducer). `waiting-roll`, then `tumble` (timer `tumbleMs`). Then one of:
   - `awaiting-adjust`, when the decision is observed (turnMoments.ts:198-200, 229-231);
   - `waiting-record`;
   - `stamps` (timer `stampsMs`);
   - `released`.

   `turnDisplay.decision` stays hidden until the tumble finishes (`visibleDecision`, turnMomentPresentation.ts:200).
   - **Decision point B:** `RollAdjustment` modal (GamePanel.tsx:357-363). It only exists while `roll-adjust` is held and a ±1 move is legal (itemSession.ts:46-52). While such an item is held, this fires on *every* roll.
5. **Movement.** `useMoveAnimation` is gated by `movementStartAllowed` (GameApp.tsx:197-204, useTurnMoments.ts:193-194). The cap is `MAX_MOVE_DURATION_MS` (itemSession.ts:110).
   - `animation-finished` leads to `idle` or `awaiting-discard` (itemSession.ts:123-129).
6. **Post-move reveal.** `buildTurnRevealStages` (turnMoments.ts:138-156):
   - `arrival` always;
   - `lottery-flip` + `lottery-settle` only when the landing snapshot has more than one service or more than one direction;
   - `pickup` only on `pickup-retained` / `pickup-pending-discard`;
   - nothing after a goal, restore, or reduced motion.

   The lottery is engine RNG, so **it is not a player decision**.
7. **Discard.** `phase: "awaiting-discard"`.
   - **Decision point C:** the `DiscardChoice` modal (GamePanel.tsx:364-368). It is mandatory and cannot be cancelled (DiscardChoice.tsx:46).
8. **Ready.** `canRoll = !active && phase === "idle" && status === "playing"` (turnMomentPresentation.ts:208).
   - `active` = the pre-move attempt is active, or the session is animating, or a reveal stage is running (188).
   - This is the single, already-guarded signal that "the turn is fully presented".
9. **Goal.** `game.status === "completed"` plus publication gives `showClear` (turnMomentPresentation.ts:183-184), and `ClearScreen` replaces the panel (GameApp.tsx:441-455).
   - **Decision point D ("ゴール間際"):** no helper exists. Candidates:
     - remaining target segments (count from `targetSegmentIds` minus completed);
     - all segments complete plus hop distance to `config.startStationId` (`nearestTargetStation` and `targetHopDistances` measure distance to the target *service*, not to 新橋).

     The threshold is a product decision.

### Classic mode (internal or test only)

- `turnOrigin` is null, so `begin` is a no-op (GameApp.tsx:120-127, useTurnMoments.ts:136).
- There are no item decisions. Only the goal applies.

### How the UI waits

- **The UI never polls.** Every wait is a React re-render driven by reducer state plus `setTimeout` stage timers (useTurnMoments.ts:126-132, useRevealSequence.ts:142-149) and the rAF move runner.
- **Auto-roll trigger.** Auto-roll should react to the `turnDisplay.canRoll` false→true edge. It should call the existing `guardedRoll`, which already re-checks `canRoll` through the ref, and the reducer rejects stale identities (gameSession.ts:122-134, itemSession.ts:115-118).

### Additional stop or pause conditions to consider for (d)

- **Save failures.** `app.saveStatus === "failed"` means progress is unsaved. `"unavailable"` should probably not stop auto-roll.
- **Open UI.** A `confirm` dialog (GameApp state), `itemDialogOpen` (GameApp.tsx:105), any `dialog[open]`, and `activeSurface !== null` (menu, log, or item card open).
- **Leaving the session.** The title screen, a new `sessionId`, or `leaveAfterSave` (gameSession.ts:210-221).
- **Hidden tab.** There is no existing `visibilitychange` usage anywhere in `src/`, so this is a new pattern. Stage timers keep firing in hidden tabs (throttled), so auto-roll must explicitly pause.
- **StrictMode.** `src/main.tsx:10` enables StrictMode. Effects run twice, so the auto-roll timer must be idempotent and cleared in cleanup.
- **Reduced motion.** Turns resolve instantly, so a minimum inter-roll delay constant is needed. It lets the user see and stop auto-roll, and it keeps the live region from being flooded: `role=status aria-live=polite` (GamePanel.tsx:345) announces every turn.

---

## 3. How timings derive from speed, and where Skip lives

### Derivation

- `turnMomentTiming(stepMs)` (turnMoments.ts:83-97) multiplies `NORMAL_BASES` (tumble 600, stamps 240, arrival 800, lotteryFlip 1600, lotterySettle 400, pickup 500) by `stepMs/450`.
- This is a DESIGN decision: `.claude/docs/DESIGN.md:239`, where the factor is fixed at roll time.
- Per-hop movement comes from `hopDurationMs` (timeline.ts:229-234). It is clamped to 2/3..8/3 of stepMs, so at 120 ms a hop takes 80-320 ms. Item rides are capped at 6000 ms regardless of speed.

### What a 120 ms speed gives today, proportionally

| Stage | Proportional value | Issue target |
|-------|-------------------:|--------------|
| tumble | 160 | — |
| stamps | 64 | — |
| arrival | 213 | no card |
| lottery (flip 427 + settle 107) | 533 | ≤ 400 |
| pickup | 133 | — |

So (a) needs a non-proportional per-speed table, or clamps, instead of the single factor.

### Where timing is captured

- **The attempt.** `begin` captures it into `attempt.timing` (useTurnMoments.ts:134-142).
- **Reveal durations.** They are frozen from that attempt (useTurnMoments.ts:144-152).
- **Stage presence.** It is decided by `buildTurnRevealStages(..., turnMomentTiming(fallbackStepMs))` using the **current** speed (GameApp.tsx:139-147).
  - Risk: if presence becomes speed-dependent (no arrival at very fast), presence must come from the attempt's captured timing. Otherwise a speed change mid-turn mismatches presence and durations.
- **Fallback values.** Lottery and pickup durations fall back to `turnMomentTiming(fallbackStepMs)` when no attempt exists (GameApp.tsx:351-352, 361).
- **Movement.** `stepMs` for the movement is the attempt's step when the attempt owns the animation; it is 0 under reduced motion (GameApp.tsx:195-196).

### Arrival coupling

- The map segment flash exists only during the `arrival` stage and lasts `arrivalMs` (`arrivalSegmentFlash`, turnMomentPresentation.ts:267-282).
- Dropping the arrival card at very fast also drops the flash, unless it is decoupled.
- An arrival stage with 0 ms would still render one frame of the banner, so it must be removed from the list, not zeroed.

### Skip

- **One shared `skip`** (GameApp.tsx:332-337):
  - guard `turnDisplayRef.current.canSkip`;
  - `moments.skip()`: attempt `skip` (turnMoments.ts:169-172) plus reveal `skip` (useRevealSequence.ts:107-108, 151-154);
  - `finishAnimation(current)`.
- **Belt and braces.** useTurnMoments.ts:176-185 also finishes the owned animation once `skipRequested`.
- **Callers:**
  - the HUD スキップ button (GameHud.tsx:94);
  - a tap on the overlay card (TurnMomentHost.tsx:458, GameApp.tsx:430);
  - the RollAdjustment dialog's own Skip, because the modal makes the panel inert (RollAdjustment.tsx:11-15, GamePanel.tsx:361-362).
- **Omission paths that already exist and can be reused by (b) and (c):**
  - reduced motion → `omitted` at begin (turnMoments.ts:182) and in observe (223);
  - restored roll (182);
  - deadhead → released (226);
  - `useRevealSequence` `omit` (129).

  "なし" is closest to the reduced-motion path. "重要なときだけ" and (c) need per-stage filtering in `buildTurnRevealStages` and an early `released` decision in `observeAttempt` once the record is accepted. At tumble start the record and movement events are usually already observed: the tumble starts on `recordMatches && rawRoll !== null`, turnMoments.ts:229.

---

## 4. Persistence patterns to mirror

- **Storage access.** `getBrowserStorage()` returns null when access throws, with no write probe (browserStorage.ts:3-13). GameApp memoises it once (GameApp.tsx:84).
- **Guarded calls.** Every call is wrapped in try/catch and failures become values:
  - `readSave` returns `unavailable` on a throw (persistence.ts:99-114);
  - `writeSave` returns `"saved" | "unavailable" | "failed"` (117-129);
  - `deleteSave` returns a boolean (132-140).
  - Analytics uses the same pattern for its opt-out flag (analytics.ts:57-62, 128-129).
- **Key naming.** The pattern is `yamanote-line-sugoroku:<area>[:v<layout>]`. The `v1` suffix is the *storage layout* version; the payload has its own version (persistence.ts:16-21). A suggested settings key is `yamanote-line-sugoroku:settings:v1`, holding JSON with a payload `version` field.
  - Validate the payload field by field and fall back to defaults per field (never throw).
  - Never touch `SAVE_STORAGE_KEY`/`SAVE_VERSION`.
- **Global, not per edition.** Edition saves use `saveKeyForEdition` (registry.ts:7-11). GameApp is remounted per edition (EditionApp.tsx:102), which is another reason today's `useState` resets.
- **StrictMode-safe writes.** useGameApp.ts:73-82 caches the write identity so a repeated effect does not write twice. Settings writes should be idempotent: write in an effect on value change, or in the setter.
- **Shared store precedent.** `lineVisibilityStore.ts` shows the `useSyncExternalStore` module-store pattern, in case the settings must be readable outside GameApp.
- **Test seam.** `StorageLike` (persistence.ts:24-28) is injected; unit tests use `memoryStorage` (tests/unit/persistence.test.ts:192). `persistence.test.ts:215` asserts that the save module writes only `[SAVE_STORAGE_KEY]` into its injected storage. Keep the settings in a separate module so that assertion stays valid.

---

## 5. Keyboard, focus and dialog patterns; existing a11y tests

### Patterns

- **Modals.** All modals are native `<dialog>` opened with `showModal()`, so the page behind is inert. `modalDialogOpen()` (GameMenu.tsx:26-28) is the existing "is a modal open" check.
- **Escape ownership, in priority order:**
  1. native dialog cancel. RollAdjustment cancel = 「そのまま続ける」 (RollAdjustment.tsx:57, 80). DiscardChoice refuses to close (DiscardChoice.tsx:46). ItemUseDialog and ConfirmDialog cancel.
  2. GameMenu and TurnLogDrawer **capture-phase** window listeners (GameMenu.tsx:51-64, TurnLogDrawer.tsx:37-45). Each yields to `modalDialogOpen()` and checks `defaultPrevented`.
  3. GamePanel bubble-phase draft clear (GamePanel.tsx:213-224). It is only active when idle with a draft and no lock, so it never overlaps a presentation (`itemUseLocked`). An "Escape = skip during presentation" handler therefore does not collide with it.
- **Surface state.** `activeSurface` (GamePanel.tsx:141) means only one of menu, log or item card is open. A global shortcut needs it, so the handler belongs in GamePanel, or GamePanel must expose it. Confirm-dialog state lives in GameApp (103), but ConfirmDialog is a native modal and is covered by `modalDialogOpen()`.
- **Dice focus contract.**
  - The dice stays focusable with `aria-disabled` during presentations (GameHud.tsx:85-93, DESIGN.md:240).
  - After a decision, focus returns to the dice (GamePanel.tsx:228-243).
  - On mount the heading takes focus (245-249).
  - Today Enter and Space only work through native button activation on the focused dice (the issue's point).
- **Global Space/Enter hazards:**
  - native activation of any focused button: dice, menu trigger, inventory slots, スキップ. The handler must ignore events whose target is interactive (button, input, summary, a, [tabindex]), or it double-fires. Double firing is harmless because of the `canRoll` ref and reducer identity, but it is unclean;
  - Space scrolls `.game-panel` → `preventDefault`;
  - `event.isComposing`, `repeat`, and modifier keys;
  - the S key under a Japanese IME.
- **Menu hint.** GameMenu's options list (96-111) is where the shortcut hint goes. A visually hidden hint precedent exists: 「Escapeキーで選択を解除できます。」 (GamePanel.tsx:266).

### Existing a11y tests that constrain (f)

| Test | What it constrains |
|------|--------------------|
| `tests/e2e/accessibility.spec.ts:63` | Focuses the dice and presses Enter; the dice must stay focused through the frozen-clock stages. |
| `tests/e2e/accessibility.spec.ts:347` | Enter or Space on the menu trigger opens it; Escape closes it and restores `:focus-visible`. A global Space/Enter must not also roll here. |
| `tests/e2e/accessibility.spec.ts:415, :431` | Escape ordering: the adjust dialog before the menu; the 新規 confirm before the draft clear. |
| `tests/e2e/accessibility.spec.ts:492` | The log drawer keyboard toggle. |
| `tests/e2e/accessibility.spec.ts:37` | The item card's Escape before the draft clear. |
| `tests/e2e/ui-pop.spec.ts:293` | The item slot's Escape focus return. |
| `tests/e2e/ui-pop.spec.ts:799-852` | **Exact tab order** from the dice: slots → 選択を解除 → (effects) → ログ → メニュー. A new focusable toggle in the HUD or actions row changes this list. |
| `keyboard.press` users | accessibility (14), items (7), real-data (4), layout (3), ui-pop-turn-moments (2), ui-pop (2). |

---

## 6. Test conventions and E2E hooks for speed and animations

### Unit tests (Vitest + jsdom)

- Mounting goes through `tests/unit/helpers/reactDom.ts`.
- Heavy suites mock `useGameApp`, `GameHud`, `RailwayMap` and analytics (e.g. `tests/unit/game-app-turn-moments.test.ts:33-60`). They use fake timers, and `matchMedia` is stubbed for reduced motion (187, 634).
- localStorage cleanup is **per file**, not global:
  - `game-app-turn-moments.test.ts:86`;
  - `game-app-item-progress.test.ts:58`;
  - `map-flash.test.ts:586`;
  - `edition-app.test.ts:15`;
  - `game-hud.test.ts:616`, in one block only.

  Persisted settings would leak across tests in files that do not clear storage.
- The pure-reducer tests are in `tests/unit/turn-moments.test.ts` (22 references to `turnMomentTiming`/`buildTurnRevealStages`/`ANIMATION_SPEEDS`), plus `reveal-sequence.test.ts`, `turn-moment-hooks.test.ts`, `turn-moment-presentation.test.ts`, `move-animation-gate.test.ts` and `analytics.test.ts`.
- Naming follows `.claude/rules/testing.md`: AAA, `test_{target}_{condition}_{expected}`-style descriptions.

### E2E (Playwright)

- **Motion default.** `reducedMotion: "reduce"` is the project default (`playwright.config.ts:59`). Animated specs opt in with `test.use({ reducedMotion: "no-preference" })`: accessibility 61, dice 175, items 334/429, lottery 42, resume 84/162/219, save-errors 240, capital-region 231/319, and ui-pop-turn-moments 44 for the whole file.
- **Seeds and storage.** Seeds are injected by overriding `crypto.getRandomValues` in an init script (`tests/e2e/fixtures.ts:18-31, 52-62`). Each test gets a new browser context, so localStorage starts fresh. Within-test `page.reload()` (resume, save-errors) *would* carry persisted settings.
- **Frozen clock.** `page.clock.install()` + `freezeClock` (`tests/e2e/support/app.ts:288-291`), then one helper per stage (`tests/e2e/support/turnMoments.ts:88-203`).
  - The helpers use deliberately independent constants: `NORMAL_STEP_MS = 450`, `NORMAL_STAGE_MS`, and the proportional `speedFactor`/`stageDurationMs` (28-56).
  - A non-proportional very-fast table breaks the "factor" contract. Those helpers need a per-speed table.
- **Speed selection in E2E.** There is no URL or storage hook; tests click the menu button N times.
  - `SPEED_CASES` in `tests/e2e/ui-pop-turn-moments.spec.ts:749-753` encodes the cycle order: slow = 2 clicks from normal.
  - The S16 test at 781-830 clicks once more mid-turn.
  - Inserting very-fast after fast makes slow = 3 clicks.
- **Roll helpers.** `rollOnce`, `clickDice`, `waitForRollOutcome` and `diceReady` (`support/app.ts:168-257`) rely on the dice being the only thing that rolls. A persisted auto-roll ON would break them, so it must default OFF and stay OFF in fresh contexts.
- **Unit tests that click 速度.** `game-app-item-progress.test.ts:720-763`, `map-flash.test.ts:618-628` and `game-app-turn-moments.test.ts:1486` expect normal → 「はやい」 on one click. That still holds if very-fast is inserted after fast.
- **Exact menu buttons.** `tests/unit/game-hud.test.ts:305-308` asserts the exact list `["追尾: ON","速度: ふつう","新規","タイトル"]` and a count of 4. Any new menu button (演出, おまかせ, shortcut hint as a button) breaks this test.
- **Quality gate.** `npm run typecheck` (tsc -b), `npm test` (vitest run), and `npm run test:e2e` locally for the affected specs only (memory: targeted local E2E; the full 4-browser run happens in CI).

---

## 7. Downstream consumers and risks

1. **DESIGN decisions.** `DESIGN.md:239` (timings scale with speed and are captured at roll), `:240` (the dice is disabled during presentations; one Skip ends everything) and `:243-244` (the publication boundaries) are recorded decisions. A non-proportional very-fast table, a 演出 level, and auto-skip each need a new decision row (design-tracker).
2. **Stage presence vs. captured timing** (§3). Presence uses the current speed (GameApp.tsx:143-147); durations use the attempt's speed. This is safe today only because presence does not depend on speed.
3. **The segment flash is coupled to the arrival stage** (turnMomentPresentation.ts:267-282). "No arrival card" silently removes the map flash, and `map-flash.test.ts` covers that flash.
4. **Reduced motion.**
   - The OS preference must keep overriding any setting: GameMenu disables 速度 and shows 「省略」 (GameMenu.tsx:100-107).
   - Under reduced motion, auto-roll would chain turns with no visual gap, so it needs its own minimum delay.
   - `ToastHost` and the map follow (`immediate`, GameApp.tsx:280) also read `reducedMotion`. Mapping 演出:なし to that same flag would change toast and camera behaviour too. Decide whether "なし" means the same thing as reduced motion or only stage omission.
5. **Toast flood under auto-roll.** Toasts hold 4 s each, with 3 visible at most (toastQueue.ts:8-9). Fast auto-turns that pick up or lose items queue toasts faster than they expire. `obscured` (GameApp.tsx:438) is the only pause.
6. **Live-region flood.** One polite announcement per turn (GamePanel.tsx:345) at very-fast or auto speed. Consider coalescing them, or announcing auto start/stop only.
7. **Tests that encode defaults or order:** `SPEED_CASES` click counts; the `game-hud.test.ts` exact menu list; the `ui-pop.spec.ts:799` tab order; the per-file `localStorage.clear()` hygiene; and the `persistence.test.ts:215` key assertion if settings are written via the save module.
8. **Analytics.** The whitelist is strict (analytics.ts:26-47). A new event such as an auto-roll toggle needs `EVENT_KEYS`/`EVENT_VALUES` entries and `tests/unit/analytics.test.ts`. Nothing is required unless the product wants the metric.
9. **Determinism.** Auto-roll does not touch the RNG: the seed and the turn identity flow through the existing reducer. The rule "do not change rules" holds as long as auto-roll only calls `guardedRoll` and never answers adjust or discard.
10. **File size.** GameApp.tsx is already 488 lines (target 200-400, max 800). Settings, auto-roll and shortcuts should be extracted into hooks: `useGameSettings`, `useAutoRoll`, `useGameShortcuts`. Pure predicates such as `autoRollStopReason(display, view, …)` should be unit-testable without mounting.
11. **Hidden tab.** `visibilitychange` is a new pattern; there is no precedent to mirror. Pause the auto-roll on hidden. Whether it resumes on visible is a product decision; the issue says 「止まる」, so stop rather than pause.

---

## 8. Rough size estimate per candidate

These are estimates of production LOC (net added or changed) and test LOC. They exclude CSS and docs unless noted.

| Candidate | Prod files | Prod LOC | Test files | Test LOC | Notes |
|-----------|-----------:|---------:|-----------:|---------:|-------|
| (a) とても速い | 3-4: `gameConfig.ts`, `turnMoments.ts` (per-speed table or clamps; omit arrival), `GameApp.tsx` (presence from attempt timing), maybe `turnMomentPresentation.ts` (flash) | 40-70 | 4-6: `turn-moments.test.ts`, `map-flash.test.ts`, `ui-pop-turn-moments.spec.ts` (`SPEED_CASES`), `support/turnMoments.ts` (per-speed table) | 80-150 | Smallest high-value item. Needs a DESIGN row replacing the pure-factor rule. |
| (b) 演出 level | 4-5: new type/constant, `GameApp.tsx`, `turnMoments.ts` (stage filter), `useTurnMoments.ts` (omit at begin), `GameMenu.tsx` + `GamePanel.tsx` props | 60-120 | 3-5: turn-moments, game-app-turn-moments, game-hud (menu list), one E2E | 120-200 | "なし" is cheap through the omitted path. "重要なときだけ" needs a product definition of "important" (lottery? pickup? stamps? new segment?). |
| (c) auto-skip uneventful | 2-3: `turnMoments.ts` (`observeAttempt` early release; stage filter), `GameApp.tsx` | 40-80 | 2-3 | 100-160 | Overlaps (b) "重要なときだけ"; consider merging. The definition of "uneventful" (lottery shown? stamps?) is a product decision. |
| (d) おまかせで進む | 4-6: new `useAutoRoll.ts` (120-180), pure stop predicate (~50), goal-proximity helper (~30), `GameApp.tsx` wiring, toggle UI (`GameHud`/`GameMenu`), maybe toast/announcement tweaks | 220-330 | 4-6: predicate unit, hook unit (fake timers, visibility, StrictMode), game-app integration, one or two E2E (stop on usable item, discard, adjust, hidden tab), plus tab-order/menu-list fixes | 300-500 | Largest. Depends on (e) for persistence of the toggle, though the issue says auto ON should probably not persist across sessions. Decide. |
| (e) settings persistence | 2-3: new `store/settings.ts` (parse/validate/read/write, ~60-90), `GameApp.tsx` lazy init + write (~20), maybe a `useGameSettings` hook | 80-120 | 1-2: settings unit (corrupt JSON, unknown fields, throwing storage, unavailable), GameApp remount test | 100-150 | Prerequisite for (b) and (d). Global key; `SAVE_VERSION` untouched. |
| (f) keyboard shortcuts | 2-3: new `useGameShortcuts.ts` (60-90) in `GamePanel` (owns `activeSurface`/`itemDialog`), `GameMenu.tsx` hint | 70-110 | 2-3: unit (target filtering, dialog/drawer suppression, IME/repeat), `accessibility.spec.ts` additions; keep the existing Enter/Space menu tests green | 120-180 | Low priority per the issue. Escape is only safe during a presentation, because the draft-clear handler is inactive then. |

Suggested order (it matches the issue's priority and the dependencies): (e) → (a) → (b)/(c) merged → (d) → (f).
Total: about 510-830 production LOC and 820-1340 test LOC if every candidate ships.

### Open product questions for Codex and the user

1. The very-fast table values: tumble, stamps, and the lottery split within 400 ms. Should the segment flash survive without the arrival card?
2. What does 演出「重要なときだけ」 keep? Is (c) the same feature?
3. Goal-proximity threshold for auto-roll: remaining segments ≤ N, or all segments complete and within K hops of 新橋?
4. Does auto-roll ON persist across reloads or sessions, or only within a session?
5. Should a save failure stop auto-roll?
6. Does 演出:なし equal OS reduced motion, which also affects toasts and the map camera?
