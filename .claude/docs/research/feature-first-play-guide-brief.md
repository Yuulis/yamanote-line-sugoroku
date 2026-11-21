## Feature Brief: Issue #67 first-play guide and control labels (+ #113 remove おまかせ)

### Current State
- Architecture: React + TypeScript + MapLibre presentation over a pure engine. `GameApp` owns storage, session start/resume and the toast host; `GamePanel` coordinates HUD, dialogs, shortcuts (`useGameShortcuts`), auto-roll (`useAutoRoll`) and the single status live region; `deriveTurnMomentDisplay` (`turnMomentPresentation.ts`) is the reveal-gated source for everything published per turn (`lotteryPublished`, `resultPublished`).
- Relevant files: see `.claude/docs/research/feature-first-play-guide-codebase.md` (scan at 3b048f4) and Codex scope `.claude/logs/codex/20261120T055618Z-first-play-scope.md`. Key: `src/app/GameApp.tsx`, `src/features/game/components/{GamePanel,GameHud,RollAdjustment,RulesDialog,RulesGuide,GameMenu}.tsx`, `turnMomentPresentation.ts`, `saveNotice.ts`, `rulesGuide.ts`, `useAutoRoll`/auto-roll settings, `useGameShortcuts.ts`, `src/features/map/RailwayMap.tsx`, `src/styles.css`, `tests/e2e/fixtures.ts`, `tests/unit/helpers/notices.ts`.
- Patterns: pure model + hook; show-once precedent from #68 (`yamanote-line-sugoroku:notice:auto-resume:v1` = "1", try/catch on every access, read once then in-memory ref, write only after shown; keys must not contain "save"); native `<dialog>` / Popover with fallback; `PhraseText` for Japanese copy; phone HUD budget 252px of 255.6px at 320x568; E2E fixtures seed seen flags via `addInitScript`; phone geometry checks tagged `@layout`.

### Feature Goal
A first-time player understands how to play within the first two minutes, through a 3-step coach mark and one-time contextual hints, and control labels say what they do. The unreliable おまかせ auto-roll mode is removed.

### Scope
- Include:
  - S0 (#113): remove おまかせ entirely — toggle button, `useAutoRoll`, its keyboard shortcut, settings field (old stored values ignored without error), rules guide/menu copy, tests, DESIGN row 253 superseded. Action row becomes dice + skip (phone 2 columns).
  - Coach mark: first new game only; 3 steps (dice button → 踏破区間 progress bar → Yamanote loop on the map), one sentence each; 前へ / 次へ / とばす; blocks dice and shortcuts while open (registers as an open surface); replayable from the 遊び方 guide; text fallback when WebGL is unavailable.
  - Hints: persistent toast-like card (not auto-expiring, not inside the aria-hidden ToastHost), buttons 閉じる / もう表示しない / 詳しく (`openRules(sectionId)`); game keeps running; one card at a time with a queue; shown only after the reveal boundary. Events: first lottery, first time leaving Yamanote, first item, first unfavourable item, terminus reached with leftover pips. 「もう表示しない」 disables all hints.
  - First-time detection: players with an existing save or the #68 auto-resume flag set are not first-time (no coach mark, no hints); decided before the new game's first auto-save and held for the session.
  - Labels: HUD skip and RollAdjustment skip renamed 「演出をスキップ」; HUD skip stays visible and disabled when idle; the dialog skip stays and is visually separated from 「そのまま続ける」; menu/rules copy follows the new name.
  - Escape hint in RollAdjustment shown only under `(pointer: fine)`, split from 「出目を見た後はターンを取り消せません。」.
  - Pitch line 「サイコロと抽選まかせで、山手線を一周して新橋へ。」 used in the coach mark (edition-aware).
- Exclude: engine, RNG, save format, public data, edition registry data; toast queue behaviour; redesign of the rules guide; hiding the HUD skip when idle; removing the dialog skip (DESIGN row 262 stays).

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: 35-45 (incl. tests), plus the おまかせ removal
- Estimated LOC: 1,200-1,900 changed incl. tests (removal adds deletions)
- Implementation route: team-execute style paced steps (Codex implements per step, lead verifies), as in previous COMPLEX features

### Integration Points
- `GameApp.tsx` (storage injection ~94, resume ~205, `startNewGame` ~318, `useFirstTurnNotice` ~394, ToastHost ~483): first-time decision and guide state ownership.
- `turnMomentPresentation.ts` `deriveTurnMomentDisplay` (~238, `lotteryPublished` ~243, `resultPublished` ~308): published hint candidates.
- `GamePanel.tsx` (`useAutoRoll` ~359 removed, `useGameShortcuts` ~400, `openRules` ~414, status region ~656) and `saveNotice.ts` `selectAnnouncement` (~79) generalised for hint text.
- `GameHud.tsx` (progress ~99, dice ~126, skip ~135) and `RailwayMap.tsx` (target route ~921, WebGL fallback ~929): coach targets.
- `RollAdjustment.tsx` (~86-87): label, separation, pointer-gated Escape hint.
- `RulesDialog.tsx` / `RulesGuide.tsx` / `rulesGuide.ts`: coach replay entry, label copy.
- `styles.css` (action row ~2698, layers ~40): 2-column row, coach/hint placement clear of the #66 pill and TurnMomentHost.

### Risks
- First-time self-interference (the new game's auto-save or #68 flag flips eligibility mid-session): decide once before start, hold in memory.
- Phone layout (3.6px HUD slack, #66 pill, TurnMomentHost): card outside the HUD, `@layout` checks at 320x568 and short landscape.
- Shortcut/focus interplay: coach blocks Space/Enter/S/Escape and restores focus; hint card never steals focus; rules dialog focus restore must not fight the coach.
- Reveal spoilers and skip/reduced-motion paths: hints only from published data; instant-publish paths must still queue hints; resumed turns never show hints.
- Same-turn multiple events: stable-order queue; 「もう表示しない」 clears current and queued.
- Test isolation: seed coach/hint seen state by default in E2E fixtures and unit helpers without masking #68 tests; ~20 exact-text label lookups to update.
- おまかせ removal: stale stored setting must not break settings load; DESIGN rows 249/253 superseded.

### Success Criteria
- New player (no save, no #68 flag) sees the 3-step coach mark at the first new game, can go 前へ/次へ/とばす, cannot roll while it is open, and can replay it from 遊び方.
- Each of the 5 hints appears at most once, only after its reveal boundary, with working 閉じる / もう表示しない / 詳しく; 「もう表示しない」 stops all hints across reloads.
- Existing players (save or #68 flag) see no coach mark or hints.
- Both skip buttons read 「演出をスキップ」; HUD skip disabled when idle; Escape hint hidden on coarse pointers.
- おまかせ is gone from UI, shortcuts, settings and copy; an old stored setting loads without error.
- `npm run typecheck`, lint, `npm test`, `npm run build` and targeted E2E (incl. `@layout` at 320x568) pass; full 4-browser suite green in CI.
