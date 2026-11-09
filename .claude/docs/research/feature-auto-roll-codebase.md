# Issue #64 stage 2 (「おまかせで進む」 auto-roll): affected-area codebase scan

Mode: existing codebase. Read-only scan of `feature/auto-roll` @ 18cd487 (develop with tempo stage 1 merged).
Supersedes sections 2 and 7 of `.claude/docs/research/feature-tempo-fast-forward-auto-roll-codebase.md` for
auto-roll; that file's line numbers predate stage 1. Paths are relative to the repo root.

---

## 1. Affected modules (current tree)

| File | Lines | Role for auto-roll |
|------|------:|--------------------|
| `src/app/GameApp.tsx` | 476 (cap 488) | Composition root. `guardedRoll` (276-280) re-checks `turnDisplayRef.current.canRoll` (225-226) then `beginTurnMoment("click")` + `roll()`. `confirm` state (97) renders native `ConfirmDialog` (444-461). `itemDialogOpen` (99) is lifted from GamePanel. Renders `<GamePanel key={session.sessionId}>` only while `session && shown && turnDisplay && !showClear` (388-416). ToastHost `obscured` = confirm / decision / item dialog (426). |
| `src/features/game/components/GamePanel.tsx` | 383 | Memoised panel, **remounted per session** (`key`), unmounted on title and on the clear screen. Owns `activeSurface` "log"/"menu"/"card" (145), `itemDialog` (140-143, `itemDialogOpen` 160), mounts `useGameShortcuts` (161-166), dice-focus restore after a presented decision (238-253), heading focus on mount (255-259), the single panel live region `role=status aria-live=polite` (357, hidden while a decision is presented), `RollAdjustment` (369-375) and `DiscardChoice` (376-380). Passes `onRoll`/`onSkip` to `GameHud` (296-297). |
| `src/features/game/components/GameHud.tsx` | 106 | Actions row `.game-panel__actions` (84-95): dice `.game-panel__roll` (`aria-disabled={!canRoll}`, label 「移動中…」/「この内容でサイコロを振る」/「サイコロを振る」) then `<button disabled={!canSkip}>スキップ</button>`. The toggle goes here. |
| `src/features/game/useGameShortcuts.ts` | 85 | Pure `gameShortcutAction` (160-173) + bubble-phase window listener (176-191). Space/Enter → roll only when `canRoll` and the target is not interactive; S/Escape → skip. Suppressed when a surface, the item dialog, or any `dialog[open]` is open. A focused toggle button is an interactive target, so Space/Enter on it toggles natively and never rolls. |
| `src/features/game/components/GameMenu.tsx` | 140 | `modalDialogOpen()` = `document.querySelector("dialog[open]") !== null` (29-31). Menu buttons 追尾/速度/演出/新規/タイトル (103-126); shortcut hint text (136). Not touched by the settled placement. |
| `src/features/game/turnMomentPresentation.ts` | 326 | `deriveTurnMomentDisplay` (146-260): `active` (189), `canRoll = !active && phase idle && playing` (209), `canSkip` (229), `decision` via `visibleDecision` (131-139: adjust only once the attempt reached `awaiting-adjust`; discard only after publication), `phase` (70-81; `"published"` = result public), `itemNoticePublished` (250), `toastInputs` (207-208, only once published). `hasPickup` (323-326) is the existing pickup test (retained / pending-discard only). |
| `src/features/game/animation/useTurnMoments.ts` | 238 | Pre-move timers (131-137) and reveal timers (via `useRevealSequence`) — both `setTimeout` keyed effects, StrictMode-safe by cleanup. `begin` (139-148) builds attempt key `${sessionId}:roll:${turn+1}:${decisionRevision}`. |
| `src/features/game/animation/useRevealSequence.ts` | 164 | Stage `"waiting"` only while movement is incomplete (session `animating`, so `active` is true anyway); `ready` = movement complete and done. |
| `src/features/game/itemSession.ts` | 274 | `itemSessionView` (213-274): `decision` adjust/discard (230-235); `usableItems[].usable/reason` (256-272). Held `roll-adjust` with a legal ±1 → adjust decision on **every** roll. |
| `src/features/game/useGameApp.ts` | 151 | `roll` dispatches `item-commit` or `roll` with the action identity; the reducer rejects stale identities (gameSession.ts / itemSession.ts). `saveStatus`. |
| `src/types/network.ts` | — | `ItemEvent` (114-124). Pickup-family events: `pickup-retained`, `pickup-pending-discard` (beneficial, enters inventory), `harmful-scheduled` (harmful drop, never held; starts delay/suspension/detour/oversleep), `cancelled-by-certificate` (harmful drop cancelled by a held 遅延証明書). Harmful kinds: `HARMFUL_ITEM_KINDS` (95). |
| `src/features/game/toastQueue.ts` | 235 | Toasts only from item events (`turnToasts`); `MAX_VISIBLE_TOASTS = 3`, `TOAST_READING_MS = 4000`. Harmful drop → tone `bad`. |
| `src/features/analytics/analytics.ts` | 165 | Strict whitelist `game_start`/`game_clear`/`result_share` (5, 26-35). |
| `src/styles.css` | — | Actions row: base flex (794-806, roll `flex: 2`); phone `@media (max-width: 600px)` grid `minmax(0,2fr) minmax(0,1fr)`, 56px fixed height (1891-1915); compact landscape `@media (min-width: 601px) and (max-height: 500px)` puts `actions` beside `inventory` in a 2-column panel (2086-2090) with the same 2-column row (2167-2200) and **`.game-panel__actions button:last-child` = nowrap 12px for スキップ** (2196-2200) — a third button becomes `:last-child`. |
| `src/main.tsx` | — | `StrictMode` (10). No `visibilitychange` usage exists anywhere in `src/`. |

`SAVE_VERSION`, the engine, RNG, settings storage (`store/settings.ts`, `useGameSettings.ts`) need no change: the
toggle is not persisted (settled), so the stage-1 settings payload stays as is.

## 2. Lifecycle facts that make "not persisted" almost free

- New game → new `sessionId` → `GamePanel` remounts (GameApp.tsx:390) → any state inside it resets.
- タイトル / clear screen → `GamePanel` unmounts (388, `!showClear`).
- Edition change → only possible from the title screen (`picker` is passed to `TitleScreen` only, GameApp.tsx:378),
  where `GamePanel` is already unmounted → resets. (`EditionApp.tsx:102` renders `GameApp` without a `key`; do not
  rely on a GameApp remount.)
- Reload → fresh mount.
- Therefore auto-roll state owned **inside GamePanel** (or a hook it mounts) satisfies new game / title / edition /
  reload / clear without any reset code. Only `visibilitychange` → OFF needs explicit code.
- Resume (つづきから) also mounts a fresh panel → OFF, consistent with "always starts OFF".

## 3. Turn sequencing and the auto-roll decision points (item mode)

1. Idle: `canRoll` true. Player may open an item card / item dialog / menu / log (`activeSurface`, `itemDialog`).
2. Roll accepted → `active` true until the whole presentation (tumble, stamps, movement, reveal stages) is done.
3. Adjust decision (held `roll-adjust` with a legal ±1): `turnDisplay.decision.kind === "adjust"`, native
   `RollAdjustment` modal, `canRoll` false. Auto must wait; player answers (or Escape = 「そのまま続ける」).
4. Pickup with full inventory: `pickup-pending-discard` → `awaiting-discard` → `DiscardChoice` modal (cannot be
   cancelled) once published. Auto must wait; after the discard the record still carries the pickup event.
5. Published: `turnDisplay.phase === "published"`, `canRoll` true again (for non-goal turns). The record of the
   turn just presented is `session.lastMove.itemRecord` (`turn`, `itemEvents`).
6. Goal: `showClear` → GamePanel unmounts → auto ends.
7. Forced turns (oversleep / delay due) still need a roll click; `canRoll` covers them, items show `forced-turn`.

**Publication boundary matters for the stop.** The pickup is public only after the reveal (`pickup` stage, then
`published`). Turning the toggle OFF at record acceptance (during movement) would reveal the pickup early and
contradict DESIGN rows 「公開境界…」 (DESIGN.md Key Decisions). The stop must be evaluated on the published state:
`canRoll` true (or `phase === "published"`) for a record whose turn is newer than the record present when auto was
switched ON.

**Turning ON right after a stop.** The record that caused the stop is still `lastMove`. A predicate that looks only
at "latest record has a pickup" would stop again immediately. A baseline (record turn at ON) is required.

**Manual rolls while ON.** Space/Enter (global) or a dice click still call the same `guardedRoll`; their records
are judged by the same predicate (newer than baseline).

## 4. Pause conditions available to a hook inside GamePanel

| Condition | Source | Notes |
|-----------|--------|-------|
| Presentation running / decision / not idle | `!turnDisplay.canRoll` | Single source; covers adjust, discard, movement, reveal, committing/resolving. |
| Menu, log, item card open | `activeSurface !== null` | GamePanel state. |
| Item use dialog open | `itemDialogOpen` | GamePanel state. |
| 新規 / delete confirm | native `dialog[open]` (ConfirmDialog in GameApp) | Not a GamePanel prop. Either check `modalDialogOpen()` at fire time and re-arm, or pass a boolean prop from GameApp (1 line). |
| Tab hidden | `document.visibilityState` + `visibilitychange` | New pattern; settled = turn OFF, no resume. |
| Save failed | `saveStatus === "failed"` (prop) | Not a settled condition; candidate for Codex. |

Timers: `setTimeout` in an effect keyed by the "ready" identity (session, record turn, canRoll), cleared in cleanup
→ StrictMode double-invoke creates and clears one timer, then creates one. A fire-time re-check of every condition
plus a per-ready-key "already fired" ref prevents a double roll (note: `guardedRoll` reads `turnDisplayRef`, which
only updates on render, so two synchronous calls in one tick both pass its `canRoll` check; the reducer identity
then rejects the second `roll`, but `beginTurnMoment` would still run twice).

## 5. UI, focus and accessibility constraints

- **Tab order test** `tests/e2e/ui-pop.spec.ts:799-852`: from the focused dice, Tab visits
  `[slots…, 選択を解除, (effects), ログ, メニュー]` at 320x568, 667x375, 1280x800, and Shift+Tab back to the dice.
  スキップ is `disabled` when idle, so it is not a stop. A toggle placed after スキップ in the actions row adds one
  stop right after the dice: the expected list gains the toggle's text first. Visual order check (top, then left)
  holds for a same-row button to the right.
- **Exactly one live region** in the panel: `tests/e2e/accessibility.spec.ts:595` and `tests/e2e/items.spec.ts:53`
  assert `[role=status]` count 1. Auto start/stop announcements must reuse that region (or rely on
  `aria-pressed` for user-initiated toggles) rather than adding a second `role=status`.
- **Dice locator** `diceButton()` = name `/サイコロを振る|移動中…/` (tests/e2e/support/app.ts:77-79); the toggle's
  accessible name must not contain 「サイコロを振る」. Unit tests find スキップ by exact text — unaffected.
- **Panel fit**: `tests/e2e/accessibility.spec.ts:603` (667x375 and 640x400: panel ≤ 75% viewport height, options
  count 5 in the menu) and `tests/e2e/hud-layout.spec.ts:82` (dice at one HUD position across states; real data).
  Phone and landscape rows are fixed 56px high, so the toggle label must fit one line (no mid-word wrap):
  「おまかせ: OFF」 / 「おまかせ: ON」 at ≥12px. Landscape actions column is roughly half the panel width.
- `.game-panel__actions button:last-child` (styles.css:2196) must be retargeted with explicit classes.
- `tests/unit/game-hud.test.ts` mounts `GameHud` with a `props()` factory; new required props break it unless
  optional or added to the factory.
- `aria-pressed` styling precedent: `.game-panel__options button[aria-pressed="true"]` (styles.css:943), and the
  追尾 toggle in GameMenu (103-105).

## 6. Test conventions to mirror

- Unit: Vitest + jsdom, `tests/unit/helpers/reactDom.ts` (`mountReact`, `dispatchReactEvent`), fake timers,
  `describe.each([false, true])` StrictMode harness (`tests/unit/use-game-settings.test.ts:43`,
  `tests/unit/game-shortcuts.test.ts`). Pure-predicate tests without mounting (e.g. `gameShortcutAction`).
- GamePanel/GameApp mounts: `tests/unit/game-app-turn-moments.test.ts`, `game-app-item-progress.test.ts`,
  `item-controls.test.ts`, `turn-moment-components.test.ts`, `capital-region-scaling.test.ts`.
- E2E: `reducedMotion: "reduce"` default (playwright.config.ts:59), seeded games via
  `tests/e2e/fixtures/itemScenarios.ts` (`discard` turn 6, `adjust` turn 8 — its next plain turn picks up 寝過ごし,
  a harmful drop; `certificate`, `delay`, …), saves injected with `writeSaveText` + reload + つづきから,
  `page.clock.install()` / `freezeClock` for timers, projects `desktop-chromium` / `phone-chromium` locally.
- Commands: `npm run typecheck`, `npx vitest run <files>`, `npx playwright test <specs> --project=desktop-chromium --project=phone-chromium`.

## 7. Risks

1. Early stop reveals a pickup before publication (§3) — evaluate on published state only.
2. Re-stop loop after re-enabling (§3) — baseline record turn at ON.
3. Double roll per ready state (§4) — per-key fired ref + fire-time re-check.
4. Timer surviving a hidden tab — visibility handler turns OFF and the effect cleanup clears the timer.
5. Live-region flood: one polite announcement per turn at ~1 turn/s under 演出:なし / reduced motion. The toggle
   start/stop must be announced once; per-turn copy may need coalescing while ON.
6. Toasts: pickups stop auto, so the frequent toast sources end the run; remaining sources (consumed, effect
   activated/expired, discarded) are at most a few per turn and expire after 4 s, 3 visible.
7. Layout: a third button in fixed 56px rows at 390px and 667x375; `:last-child` CSS.
8. Tab-order and live-region-count tests must be updated deliberately (tab order) or kept (one live region).
9. GameApp.tsx at 476/488 — keep logic in GamePanel + a `useAutoRoll` hook and a pure predicate module.
10. Held `roll-adjust` makes auto wait on every turn (by design); a held item never stops auto (settled).
