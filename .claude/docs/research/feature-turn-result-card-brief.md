## Feature Brief: Issue #66 always-visible "前のターン" turn-result card

Date: 2026-11-12. Branch `feature/turn-result-card` (from develop 4174377). MODE=existing.
Codebase scan: `.claude/docs/research/feature-turn-result-card-codebase.md`.
Codex scope consult (Sol, low effort, read-only): `.claude/logs/codex/20261112T072202Z-turn-result-card-scope.md`.

### Current State
- Architecture: `GamePanel` (`src/features/game/components/GamePanel.tsx:277-403`) coordinates `GameHud` (stats,
  dice/skip/auto actions, inventory slot, effect chips, save line) and the `.game-panel__disclosures` (log drawer +
  menu, one open at a time via `activeSurface`). Every displayed value comes from the pure, reveal-gated
  `deriveTurnMomentDisplay()` (`src/features/game/turnMomentPresentation.ts:162-322`); ride/log publish at the
  lottery-settle boundary, items/effects/notices at the pickup boundary (DESIGN.md row 2026-11-07). After the
  moments end the panel shows only stat values; the turn sentence (「15ターン目：半蔵門に到着。踏破 5/30」,
  「抽選: …」) is only inside the collapsed log drawer (`TurnLogDrawer.tsx:71-88`, props `GamePanel.tsx:324-356`).
  Desktop panel is a fixed `calc(100% - 120px)` tall (`styles.css:614-632`) with ~280px blank; phone panel is 45%
  tall at 252px of the 255.6px cap at 320x568 (#70); short landscape is a 2-column 75vh panel.
- Relevant files: `turnMomentPresentation.ts`, `presentation.ts` (`lastRollText :59`, `landingText :84`,
  `landingTransitionText :34`, `itemEventTexts :118`, `arrivalLogText :159`), `hudPresentation.ts`
  (`compactRollFor`, `effectChipModels`), components `GamePanel`, `GameHud`, `TurnLogDrawer`, `EffectChips`,
  `ItemIcon`, `LineBadge`, `PhraseText`, `TurnMomentHost` (free-rect placement around `.game-panel`),
  `src/features/map/RailwayMap.tsx` (`phonePanelBottomPadding :435`, `PREVIEW_OBSTRUCTION_SELECTORS :241`),
  `src/styles.css` (desktop `:614`, phone `:2126`, short landscape `:2467`, toasts `:161-196`, overview `:2349`).
- Patterns: pure TS derivation + Vitest (`turn-moment-presentation.test.ts` phase-by-phase publication);
  presentational components fed by `turnDisplay`; `PhraseText` `<wbr>` for Japanese visible text with plain
  title/aria strings; chips = `ItemIcon` + `aria-hidden` label + `visually-hidden` full text; single polite live
  region (no new announcers); fixed overlays as siblings of `.game-panel` on `--layer-*` tokens; Playwright
  `@layout`-tagged layout specs with `support/app.ts` / `support/layout.ts` helpers.

### Feature Goal
After every turn the player can see, without opening the log, what happened last turn and why they are on
their current line: roll, arrival station, the line/direction lottery result, and small chips for new
segments, transfers and item events — on desktop as a 2-line card under the dice, on phones as a one-line strip
above the panel that opens the log.

### Scope
- Include:
  - Pure card model module (e.g. `src/features/game/turnResultCard.ts`): heading 「前のターン（Nターン目）」,
    line 1 「出目3 → 半蔵門」 (deadhead 「回送 → X」), line 2 short lottery text 「抽選: 半蔵門線・渋谷方面」 with
    line badge, chips +N区間 (history replay incl. pending-discard record), 乗換 (group change), picked item
    (pickup-retained / pending-discard / harmful-scheduled / cancelled-by-certificate), triggered effect
    (effect-activated / consumed).
  - Reveal gating inside `deriveTurnMomentDisplay`: card move = `lotteryPublished ? current : previousLastMove`;
    item chips only at `resultPublished` and only for the card's own turn (empty chips for the new turn during
    the pickup stage, never the previous turn's chips under the new heading). Immediate under 演出: なし, Skip,
    reduced motion, resume and auto-roll via the existing boundaries (no new timers). Classic-mode moving
    fallback handled locally.
  - Desktop card in a new `GameHud` slot between actions and inventory; fixed panel height kept; space budget:
    card ≈ 90-110px + reserved ≈ 40-60px for #65 inside the ~280px blank.
  - Phone one-line strip: fixed sibling of `.game-panel` (the panel's `overflow-y:auto` would clip a child),
    ellipsis truncation, full sentence as accessible name, tap → `setLogExpanded(true)` + scroll the log into
    view, focus/Escape return handled; registered with `TurnMomentHost` placement and the map
    adjust-preview obstructions; positioned from the measured/shared panel geometry, not a hard-coded 45%.
  - Short-landscape treatment (pending user answer; default proposal: one-line row under the actions).
  - Unit tests (new `turn-result-card.test.ts` + publication cases) and E2E (new `@layout` spec + targeted runs of
    existing ui-pop / text-wrapping / hud-layout / accessibility specs).
- Exclude:
  - 10-turn log history with 「もっと見る」 (deferred, issue rates it low).
  - #65 proximity/milestone features themselves (only their space is reserved).
  - Any engine, RNG, save-format, `src/types/network.ts` or public-data change.
  - Changes to the phone panel height budget or the #70 HUD rows; #71 two-state sheet.
  - New live regions, new dependencies, turn wording changes for #68.

### Complexity Classification (from Codex)
Verbatim from `.claude/logs/codex/20261112T072202Z-turn-result-card-scope.md` (Codex answered in Japanese):

- Classification: **MODERATE** — データ変更は不要ですが、2段階の公開制御、履歴からの区間数復元、複数画面幅の配置、ログのフォーカス操作を横断します。
- Estimated files: **src 8〜10ファイル、tests 7〜9ファイル、合計15〜19ファイル**。
- Estimated LOC: **src 約350〜550行、tests 約400〜650行**の追加・変更。既存ファイル全体の行数ではなく、差分量の概算です。
- Implementation route: **Codex + review** — 公開制御とレイアウトを一貫して実装し、独立レビューで情報漏れ・配置回帰・アクセシビリティを確認する構成が適切です。

(English gloss: MODERATE; 15-19 files (src 8-10, tests 7-9); diff ≈ 350-550 LOC src + 400-650 LOC tests;
route Codex + review.)

### Integration Points
- `deriveTurnMomentDisplay` / `TurnMomentDisplay`: add an additive, reveal-gated `turnResult` field; components
  never read raw `session.lastMove`. Consumers (GamePanel, GameApp, map, toasts, ClearScreen, useAutoRoll) are
  unaffected by an additive field.
- History: `movementHistory` (+ pending discard `record`, as `turnMomentPresentation.ts:186-195`) for +N区間;
  set-based so revisits and same-turn duplicates do not count; memo key must not be history length alone.
- `GameHud`: one presentational slot after `.game-panel__actions`.
- `GamePanel` / `TurnLogDrawer`: strip rendered next to `<main>`; log region id (now `useId` inside the drawer)
  or an open-and-reveal callback lifted; reuse `activeSurface` exclusivity.
- `TurnMomentHost`: placement must avoid the strip (Codex recommends the host avoids it rather than the strip
  hiding); measure its size/visibility changes.
- `RailwayMap`: add the strip to `PREVIEW_OBSTRUCTION_SELECTORS` and layout observation; follow-camera padding
  change optional, decide by measurement.
- `src/styles.css`: desktop card, phone strip (right inset vs `.map-overview`), short-landscape row.
- Downstream: #65 (shared desktop space, milestone toasts), #71 (phone sheet geometry the strip depends on),
  #61 (item chip wording), #68 (turn wording).

### Risks
- Reveal leak (new roll/lottery/item visible before its boundary; `compactRoll` already shows the new roll while
  moving): derive the card from the selected card move only; unit-test every phase incl. pickup, Skip, なし,
  resume, auto-roll.
- Roll semantics (`compactRollFor` returns stations for 快速, consumed pips for 倍, labels for 寝過ごし/回送):
  specify raw vs effective face per mode in the plan; test 快速 / 倍 / 出目調整 / 遅延 / 寝過ごし / 回送.
- +N区間 wrong on resume or pending discard (attempt facts are lost on resume): history replay with explicit
  pending-record handling; tests for resume, pending discard, revisited segments.
- Phone strip collisions below ≈527px viewport height (`.map-overview` at top 156px, phone landscape 568x320,
  iPhone SE with toolbars) and with TurnMomentHost cards, adjust speech bubbles, toasts: right inset 84px like the
  toast column, host avoidance, obstruction registration; E2E at 320x568, <527px height, 568x320.
- Desktop no-scroll assertion `ui-pop.spec.ts:420-440` (1280x800 populated state) and long names / many chips:
  measure; keep the assertion intact (no weakening).
- Log open from the strip lands off-screen at the bottom of the scrolling panel: scroll into view and define
  focus/Escape return.
- A11y duplication (card text vs live region; hidden responsive variant still in the a11y tree): no aria-live on
  the card; `display:none` for the inactive variant; chips read once.
- Locator collisions in tests (20 refs to `.game-panel__lottery` / `.item-arrival`, `not.toContainText` raw-ID
  checks): new `.turn-result*` class names, resolver-based names only.
- Coupling with #71: derive the strip offset from the measured panel top / a shared variable, not a literal 45%.

### Success Criteria
- After any published turn, desktop shows 「前のターン（Nターン目）」 with roll → station, lottery line and the
  applicable chips without opening the log; phone shows the same as one truncated line above the panel; tapping
  it opens and reveals the log.
- No value appears before its publication boundary (unit tests per phase: pre-move, moving, arrival,
  lottery-flip/settle, pickup, published; plus Skip, 演出: なし, reduced motion, resume, auto-roll).
- +N区間, 乗換 and item chips match the engine record for fixture turns (incl. resume and pending discard).
- Phone panel budget unchanged: `text-wrapping.spec.ts` phone budget (252px at 320x568, cap 255.6px) passes
  unmodified; strip does not overlap `.map-overview`, zoom controls or the panel at 320x568, 390x844, a
  <527px-tall phone and 568x320.
- Desktop: `ui-pop.spec.ts` no-scroll at 1280x800 passes unmodified; card + #65 reserve fit within the panel.
- No engine/RNG/save/public-data diff (`git diff --stat -- src/features/game/engine src/types public` empty);
  `npm run typecheck`, targeted Vitest and targeted Playwright pass; full 4-browser matrix green in CI.

### Open questions for the user
1. Phone strip during turn moments: keep showing the previous turn while the dice/lottery/pickup cards play
   (moment cards must then avoid the strip — Codex's recommendation), or hide it while moments run and show the
   new result at publication (simpler, but not "always visible")?
2. Phone strip on short screens where it would hit the 全体 / 目標路線 buttons (viewport height under ≈527px, e.g.
   iPhone SE with browser toolbars, phone landscape 568x320): narrow it to the left column (right inset 84px,
   ≈ 236px of text at 320px wide) always, narrow only when it collides, or hide it below a height threshold?
3. Short landscape (e.g. 667x375, panel on the left, map on the right): one-line row under the dice inside the
   panel (proposal), the 2-line desktop card, or nothing?
4. Line 2 wording when no lottery was drawn (forced ride / only one candidate): 「乗車: 山手線・外回り」, keep
   「抽選:」 with 「のみ」, or omit line 2? And for turn 0 (no previous turn yet): hide the card/strip, or show a
   placeholder such as 「まだ移動していません」?
5. Desktop space split with #65: confirm "card now (~100px) + reserve ~40-60px for #65, keep the fixed panel
   height" rather than shrinking the panel to content.
