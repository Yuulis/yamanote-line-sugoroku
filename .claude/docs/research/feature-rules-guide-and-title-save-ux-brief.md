## Feature Brief: rules guide (#60) and title / save UX (#68)

MODE=existing. Branch `feature/rules-guide-title-save` (from develop a8fc2b7, v0.16.0).
Inputs: codebase scan `.claude/docs/research/feature-rules-guide-and-title-save-ux-codebase.md`,
Codex scope consult `.claude/logs/codex/20261117T012737Z-rgts-scope.md`, issues #60 and #68,
user decisions 2026-11-17 (binding, listed under Scope).

### Current State
- Architecture: React + TypeScript SPA over an always-mounted MapLibre `RailwayMap`. `EditionApp` loads the
  edition/network and mounts `GameApp`; `GameApp` switches `screen` between `title` (fixed full-viewport
  `TitleScreen` overlay, z 20, 35% dim, map `inert`) and `game` (`GamePanel` + `TurnMomentHost` + `ToastHost` +
  `ClearScreen` + `ConfirmDialog`s). Saves are written in effects of `useGameApp.ts` (L68-87) and surface as
  `saveStatus: "saved" | "unavailable" | "failed" | null`; the turn-0 state is saved right after はじめから.
- Relevant files: `src/features/editions/registry.ts` (title `ruleParagraphs`, 3 hard-coded paragraphs),
  `src/features/game/components/TitleScreen.tsx` (resume label L47-50, `SaveSection`, Credits sub-screen
  pattern), `src/app/GameApp.tsx` (`titleSave` strips `movementHistory`, overwrite confirm L304, ToastHost
  `obscured` L428, RailwayMap `inert` L478), `src/app/EditionApp.tsx` (loading / network-failure title paths),
  `GameMenu.tsx` (5 option buttons + shortcut hint), `GamePanel.tsx` (`activeSurface`, live region ~L588, lottery
  display passed to log ~L490), `InventoryPanel.tsx` / `ItemCard.tsx` (Popover API card), `GameHud.tsx` (16px
  inline save mark, `title` tooltip only), `ToastHost.tsx` / `toastQueue.ts` (aria-hidden, monotonic
  `(turn, eventIndex)` cursor), `src/features/map/RailwayMap.tsx` (NavigationControl, `.map-overview` 全体 /
  目標路線, `loadedMap` readiness, `fitNetworkOverview` with phone panel padding), `gameConfig.ts`
  (`ITEM_GAME_CONFIG`, `ITEM_POLICY`, `ANIMATION_SPEEDS`), `gameSettings.ts` (`PRESENTATION_LEVELS`),
  `itemPresentation.ts` (`ITEM_DESCRIPTIONS`, `ITEM_SHORT_NAMES`), `ItemIcon.tsx`, `useGameShortcuts.ts`,
  `store/settings.ts` (frozen v1 format), `docs/manual/tokyo-suburban/rules.md` (prose source).
- Patterns: native `<dialog>` + `showModal()` in `useLayoutEffect` with heading focus and opener restore
  (`ConfirmDialog`); any `dialog[open]` automatically suspends shortcuts, menu Escape, item card and auto-roll
  (`modalDialogOpen()`); Popover API `popover="auto"` with inline `hidden` fallback (`ItemCard`); pure
  presentation helpers in `src/features/game/*.ts` consumed by components; BEM-like classes in the single
  `src/styles.css`; Japanese visible text through `PhraseText` (aria/title strings plain); injected
  `StorageLike` for storage; Vitest + jsdom unit tests with `showModal` stubs, Playwright E2E with
  `tests/e2e/fixtures.ts` auto-fixtures and `@layout` tag for phone-chromium.

### Feature Goal
Players learn the minimum needed to clear on the title, can re-read the full rules at any time from the title
or mid-game without losing progress, and understand that the game auto-saves and can be resumed — with the
resume button showing accurate progress and the title showing the Yamanote loop instead of grey.

### Scope
- Include (user decisions 2026-11-17, binding):
  1. All items of #60 and #68 in one PR; presentation only (engine, RNG contract, save format/version, public
     data unchanged).
  2. Title text shortened to the minimum (start 新橋, all 30 segments of 山手線外回り, transfer-station lottery
     events, items to finish in fewer turns) plus a 「遊び方」 button. Codex note: wording must not imply a
     forced line change — the current line can be drawn again.
  3. One shared rules component (title sub-screen and in-game modal) with sections: goal/clear conditions,
     lottery, items (ItemIcon + ITEM_DESCRIPTIONS, pickup probability), settings & controls (速度 / 演出 /
     おまかせで進む / 追尾; keyboard shortcuts only under `(hover: hover) and (pointer: fine)`), save. Numbers
     derived from `edition.config` where feasible. Prose from `docs/manual/tokyo-suburban/rules.md`, shortened.
     Phones get a reduced variant where sensible.
  4. In-game entry points: menu 「遊び方」, 「詳しく」 from the item card (→ items) and from the persistent
     lottery result display (→ lottery); reusable section-id deep-link API for #67.
  5. One-time first-save toast 「自動で保存しています。いつでも閉じて、続きから遊べます」 after the first
     completed turn's successful save (not turn 0); separate localStorage key without "save"; also announced via
     the existing live region; fixtures seed the flag; dedicated tests.
  6. Tappable HUD save mark opening a small popover (Popover API pattern) explaining saved / failed /
     unavailable / 未保存; phone HUD 252px budget unchanged.
  7. 「つづきから」 label with progress: 「つづきから　踏破 N/30・Mターン目から・駅」; M = the turn the player
     plays next (`game.turn + 1`; equals `pending.turn` for pending roll and pending discard); station and 踏破
     from the top-level position, or `pending.position` for pending discard; same turn helper for the new-game
     overwrite confirm; completed label `クリア結果を見る（Cターンでクリア）` unchanged.
  8. 「セーブを削除」 as a small low-emphasis text link under 「つづきから」 (hit area not shrunk); existing
     ConfirmDialog and accessible names kept.
  9. Title background: Yamanote overview camera fitted for the title layout (re-fit on game → title and resize,
     camera update only, no map re-creation); decorative SVG loop placeholder until the map is really painted;
     zoom / 全体 / 目標路線 hidden on the title, while loading, on the clear screen and on the network-failure
     title (Codex decision); attribution and map error / retry UI kept.
  10. Step-by-step delivery with a pause after every step; Codex Luna implements, Codex Sol low reviews, lead
      verifies; targeted local E2E, full 4-browser matrix in CI.
- Exclude: engine / RNG / save format and version / `src/types/network.ts` / `public/` data changes; settings
  store format; #67 first-run hints and coach marks (only the deep-link API is provided); 10-turn log history;
  #71 phone sheet; new i18n layer; changing existing toast / milestone texts or order.

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: about 37-47 (19-23 product incl. CSS/SVG, 18-24 test/fixture)
- Estimated LOC: about 1,500-2,250 handwritten added/changed lines (850-1,250 product, 650-1,000 tests)
- Implementation route: per-step Codex Luna implementation + Codex Sol (low) review + lead verification, one
  paused step at a time (user decision 10; replaces team-execute for this feature)

### Integration Points
- `edition.config` / `gameConfig.ts`: read-only source for lottery share, direction weights, drop / harmful
  chances, inventory capacity, effect durations in the rules model.
- `TitleScreen`: short text, 「遊び方」 sub-screen (Credits pattern), resume progress label, delete link; also
  rendered by `EditionApp` loading / network-failure paths.
- `GameApp`: rules-modal open state + section id, `openRules(sectionId)` callback down the tree, ToastHost
  `obscured`, first-save notice wiring, overwrite-confirm turn helper, map display mode prop.
- `GamePanel` → `GameMenu` / `InventoryPanel` → `ItemCard` / lottery result display: entry points; the visual
  `LotteryReveal` / `TurnMomentHost` (aria-hidden, click-to-skip) must not get a focusable link.
- `useGameApp`: expose save-attempt identity (session, saved game turn) so a first successful save of a
  completed turn is distinguishable from a stale `"saved"`.
- `ToastHost` / `toastQueue`: first-save toast delivery that is not rejected by the `(turn, eventIndex)` cursor
  and does not displace or reorder existing toasts; pauses while the rules modal is open.
- Existing `role=status` live region in `GamePanel`: one announcement of the first-save message, coordinated
  with turn announcements.
- `GameHud`: save mark becomes a button + popover without moving the HUD.
- `RailwayMap` / `EditionApp`: title camera fit, real-paint readiness, SVG placeholder, controls visibility.

### Risks
- Stale or misattributed save success (turn-0 save, carried-over `"saved"`): expose save identity from
  `useGameApp`; fire only when the saved game has `turn >= 1` and the result is a new success; StrictMode-safe.
- First-save toast lost or colliding with the toast cursor: explicit delivery rule; persist the flag only after
  the toast is actually accepted/shown; dedicated toastQueue and GameApp tests.
- Test churn from the one-time toast in every fresh context: seed the flag in `tests/e2e/fixtures.ts` and the
  unit storage setup; unrelated existing assertions stay byte-identical; dedicated tests clear it.
- Escape inside the rules modal reaching the S/Escape skip shortcut: native `cancel` + React unmount in the same
  tick (ConfirmDialog pattern); ordering test.
- Phone HUD budget (252px at 320x568) and overlaps when the save mark becomes a 44px-hit button: separate visual
  size from hit area; existing HUD height / overlap assertions kept.
- SVG placeholder removed before tiles paint (grey flash) or never removed on failure: distinct readiness for
  first `load` vs railway layers; keep SVG on failure / WebGL unsupported.
- Title camera not re-fitted on game → title: explicit camera update on screen-mode change and resize.
- Map-control hiding racing existing layout tests that measure controls right after start: add explicit
  readiness waits in those tests (deliberate update).
- Deliberately updated existing tests (title text, resume label / overwrite confirm wording, menu button count,
  save-mark role/textContent, map-control readiness waits, flag seeding) vs tests that must stay unchanged
  (engine / RNG / save format, toast and milestone texts / counts / order, HUD height, desktop no-scroll,
  safe-area, delete-confirm names, completed resume label): boundary recorded in the plan and checked per step.

### Success Criteria
- Title rules text is at most about 3 short sentences plus a working 「遊び方」 button; full rules readable from
  the title and from the in-game menu, item card and lottery result, landing on the right section; closing the
  in-game modal returns focus to the opener with session, dice and pending decisions intact.
- Every number shown in the rules screen that exists in `edition.config` is derived from it (unit-tested against
  the config, not literals).
- Keyboard shortcut section visible only under `(hover: hover) and (pointer: fine)`.
- First-save toast appears exactly once per browser after the first completed turn's successful save, never for
  turn 0, never again after reload; announced once in the live region; not shown when the save failed or storage
  is unavailable.
- HUD save mark opens a popover for saved / failed / unavailable / 未保存 by tap and keyboard; phone HUD height
  at 320x568 stays 252px; existing overlap assertions pass.
- 「つづきから」 shows 踏破 N/30, (next turn)ターン目から and the station, correct for pending roll and pending
  discard saves; overwrite confirm uses the same number; completed label unchanged.
- 「セーブを削除」 is a low-emphasis link under 「つづきから」 with unchanged confirm flow and names.
- Title shows the Yamanote loop (SVG placeholder while loading, real map after paint); zoom / 全体 / 目標路線
  are not visible or focusable on the title, while loading, on the clear screen or on the network-failure title,
  and are visible in game after load.
- `npm run typecheck`, `npm test`, `npm run build` pass; targeted E2E per step; full CI matrix green on the PR;
  engine / RNG / save format / data diffs empty.
