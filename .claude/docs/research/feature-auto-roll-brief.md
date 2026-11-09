## Feature Brief: 「おまかせで進む」 auto-roll (issue #64, stage 2)

Mode: existing. Workspace slug `auto-roll`. Branch `feature/auto-roll` (from develop, tempo stage 1 merged).
Scan: `.claude/docs/research/feature-auto-roll-codebase.md`. Codex scope + architecture (Sol, low, read-only):
`.claude/logs/codex/20261109T033024Z-autoroll-scope-arch.md`.

### Current State
- Architecture: `GameApp.tsx` (476 lines, cap 488) is the composition root; `guardedRoll` (GameApp.tsx:276-280)
  re-checks `turnDisplayRef.current.canRoll` and calls `beginTurnMoment("click")` + `roll()`. `deriveTurnMomentDisplay`
  (turnMomentPresentation.ts:146-260) is the single source of `canRoll`, `canSkip`, `decision`, `phase` and the
  published move (`itemNoticeMove`, :251). `GamePanel` (383 lines) is keyed by `sessionId` and unmounted on the
  title and clear screens; it owns `activeSurface` (menu/log/card), the item dialog, the keyboard shortcuts
  (`useGameShortcuts`), the single panel live region (:357) and the adjust/discard modals.
- Relevant files: `src/app/GameApp.tsx`, `src/features/game/components/GamePanel.tsx`,
  `src/features/game/components/GameHud.tsx` (actions row :84-95), `src/features/game/useGameShortcuts.ts`,
  `src/features/game/turnMomentPresentation.ts`, `src/types/network.ts` (`ItemEvent` :114-124),
  `src/features/game/engine/itemTurn.ts` (`discardedInstanceId` :143), `src/styles.css` (actions row :794-806,
  phone :1891-1915, compact landscape :2086-2090 and :2167-2200).
- Patterns: hooks with a latest-values ref plus keyed `setTimeout` effects cleared in cleanup (StrictMode-safe);
  pure predicate modules unit-tested without mounting (`gameShortcutAction`); `describe.each([false, true])`
  StrictMode harnesses; native `<dialog>` modals detected by `modalDialogOpen()`; Japanese UI copy; one polite
  `role=status` per panel; E2E with seeded item scenarios, `reducedMotion: "reduce"` default, `page.clock`.

### Feature Goal
Let the player switch on 「おまかせで進む」 so the game keeps rolling by itself through turns with nothing to decide,
and hands control back right after a turn that brought a new item, without any rule, RNG or save change.

### Scope
- Include: a toggle in the HUD actions row (dice → スキップ → おまかせ, one new tab stop); a `useAutoRoll` hook and a
  pure `autoRoll.ts` predicate module; rolls only through the existing guarded roll after a 1,200 ms ready gap;
  stop (OFF) after a published turn with a new pickup-family event (beneficial and harmful drops); wait (stays ON)
  during the roll-adjust and discard decisions; pause while a presentation runs, a menu / log / item card / item
  dialog / confirm dialog is open, or an item is staged; OFF on `visibilitychange` to hidden; start/stop
  announcements in the existing live region with per-turn coalescing while ON; 3-button layout at 320/390 px and
  compact landscape 667x375 / 640x400; deliberate updates of the tab-order and HUD tests.
- Exclude: persistence of the toggle (always starts OFF), goal-proximity stop, auto-answering adjust or discard,
  any engine / RNG / save / `SAVE_VERSION` / settings-storage change, analytics events, new toasts, a keyboard
  shortcut for the toggle, changes to speed / 演出 behaviour.

### Complexity Classification (from Codex)
- Classification: MODERATE
- Estimated files: 6 production (2 new: `autoRoll.ts`, `useAutoRoll.ts`; 4 modified: `GamePanel.tsx`, `GameHud.tsx`,
  `GameApp.tsx` (+1 line), `styles.css`) and 3 new + 4-6 modified test files
- Estimated LOC: production ~260-350, tests ~450-650 (scope estimate; the validated plan revises this to
  production ~310-425, tests ~960-1,290)
- Implementation route: Codex + review (Codex Sol implements each step; lead verifies; review per step)

### Integration Points
- `guardedRoll` (GameApp.tsx:276): the only downstream action auto-roll may call, passed as `GamePanel.onRoll`.
- `turnDisplay.canRoll` / `decision` / `phase` / `itemNoticeMove` (turnMomentPresentation.ts:209, :201, :148, :251):
  readiness, waits, and the published record judged for the pickup stop.
- `GamePanel` state `activeSurface` (:145) and `itemDialogOpen` (:160): pause conditions; `useGameShortcuts` (:161-166)
  and `GameHud.onRoll` (:296) route manual rolls through the hook's `requestRoll` so manual and auto rolls share one
  per-ready-key guard.
- `GameApp` → `GamePanel` new optional prop `confirmationOpen={confirm !== null}` (native ConfirmDialog is outside the panel).
- Panel live region (GamePanel.tsx:357): reused for start/stop/pause copy; stays the only `role=status`.
- `GameHud` actions row (:84-95) and `styles.css` phone / compact-landscape rules: third button, explicit classes
  replacing `button:last-child`.

### Risks
- Early stop reveals a pickup before its publication: judge only `phase === "published"` via `itemNoticeMove`.
- Re-stop loop after re-enabling: baseline = last published record turn at the moment of ON.
- Double roll (auto + manual in one tick, StrictMode replay): one per-ready-key consumption shared by auto and manual,
  consumed only when the latest snapshot says `canRoll`; timer token checked at fire time.
- Dice stuck after a consumed key with no roll: consume only on a `canRoll` snapshot; key changes on every accepted roll.
- Discard-vs-stop conflict (every discard follows a pickup): resolved by the plan's rule (stop only if the new item
  was kept) — open question for the user.
- Live-region flood and lost information: coalesce to one published summary per turn while ON, never suppress the
  stop reason or decisions; verify the single `role=status` tests.
- Compact landscape cannot fit three buttons in the half-width actions column: actions take the full row and the
  inventory moves below; verify panel ≤ 75% height tests without loosening them.
- GamePanel line budget (~17 lines): all timer, snapshot and announcement logic lives in the hook.

### Success Criteria
- With the toggle ON in a fresh game, the game rolls by itself with ≥ 1,200 ms between the end of one presentation and
  the next roll (also under OS reduced motion and 演出:なし), and never rolls while any dialog, menu, log, item card,
  item dialog or staged item is present.
- The toggle turns OFF right after the published turn that picked up an item (beneficial or harmful), and not
  before publication; holding items alone never stops it; re-enabling does not stop on the same record.
- Adjust and discard decisions are never answered automatically; auto resumes after the adjust answer.
- Toggle starts OFF on reload / new game / title / resume / edition change and turns OFF when the tab is hidden.
- Exactly one roll per ready state under StrictMode, with manual click / Space / Enter racing the timer.
- No change to engine, RNG, save format, settings storage, analytics; `GameApp.tsx` ≤ 488 lines.
- `npm run typecheck`, the targeted Vitest files and the affected Playwright specs on desktop-chromium and
  phone-chromium pass; tab order and panel-fit tests updated deliberately, never loosened.
