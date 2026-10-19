# C3 Accessibility / Mobile Audit (Tokyo suburban edition)

Date: 2026-10-19. Branch `feature/map-performance-a11y` (no source changes made).
Scope: keyboard, screen-reader (SR) output, phone touch/layout, reduced motion,
colour signalling. References: `railway_sugoroku_mvp_spec.md` §6.2/§6.3,
`.claude/docs/DESIGN.md` non-functional rows (Usability, Accessibility).

## Method

- Code review of `src/app/*`, `src/features/game/components/*`,
  `src/features/map/*`, `src/styles.css`, `index.html`.
- Runtime: e2e-mode production bundle (`npx vite build --mode e2e --outDir
  .claude/logs/a11y/dist`) served by `vite preview` on `[::1]:4190`, driven by
  Playwright Chromium through the repo's own fixtures (`tests/e2e/fixtures.ts`:
  hermetic map stub + deterministic seed `PRODUCT_HUB_GAME_SEED`, real Tokyo
  suburban data). Specs: `.claude/logs/a11y/a11y.spec.ts`, `a11y2.spec.ts`,
  config `.claude/logs/a11y/playwright.a11y.config.ts`. 10/10 passed.
- "Announcements" were approximated by a MutationObserver on every
  `aria-live` / `role=status|alert` region (what a SR would be offered, not
  what a real SR speaks). Accessibility tree via `locator.ariaSnapshot()`.
- Evidence directory: `.claude/logs/a11y/out/` (all paths below are relative
  to it).

## Verdict per area

| Area | Verdict |
|------|---------|
| Keyboard | Every game action is reachable and operable (Tab/Enter/Space); no keyboard trap; dialog is correct. But focus is dropped to `<body>` on every screen transition and after every animated roll, and 11 map/attribution tab stops precede the panel. Significant friction, no hard blocker. |
| Screen reader | Game state is fully available as text (stats `<dl>`, lottery text, clear history). Announcements are fragmentary: the roll is spoken as a bare number, a repeated roll is silent, the arrival station and progress are never announced, the clear is not announced. A SR user must re-read the panel every turn. Map is an opaque `region "Map"` with no text alternative for "what is left / what is ahead". |
| Mobile touch & layout | Portrait 320–390 px works: panel ≤ 43 % of the viewport, all game buttons ≥ 44 px tall, no horizontal overflow, zoom not disabled. Problems: attribution clipped under zoom buttons at 320 px; landscape / 200 % zoom pushes lottery text and option buttons below the panel fold; follow-camera centres the marker at the panel's top edge; station popups need tapping ~7–14 px circles. |
| Reduced motion | Correct: `usePrefersReducedMotion` makes moves instant, follow camera jumps, speed button disabled, MapLibre fit uses `duration: 0`; no CSS transitions exist. Minor labelling mismatch on the speed button. No in-app "animation off" switch (only per-move スキップ). |
| Colour | Completed vs pending Yamanote uses colour + solid/dashed + legend text (spec §6.3 met). Current ride is named in text. Current-position marker is shape-distinct. Only gaps: the highlighted "current ride" line has no legend entry; focus ring on the green primary button is dark-on-dark. |

## Findings

Severity: High = blocks a task for some users, Med = significant friction,
Low = polish. Effort: S (< ½ day), M (1–2 days), L (more).

No High (blocking) issue was found: every task can be completed with keyboard
only and with a SR, and on a 320 px phone. The Med items below are the
recommended C3 scope, ordered by impact.

| id | sev | area | evidence | proposed fix | effort |
|----|-----|------|----------|--------------|--------|
| A1 | Med (top) | keyboard, SR | With default animation, Enter on サイコロを振る disables the focused button (`GamePanel.tsx:95`, `disabled={!canRoll}`); focus falls to `<body>` during and after the move and is not restored. Next Tab lands on 追尾 and it takes 19 Tabs (or one non-obvious Shift+Tab) to reach the dice again. `animated.json`, `animated-recovery.json`. With reduced motion focus happens to survive (`keyboard-turns.json`). | Keep the button focusable during the move: `aria-disabled="true"` + ignore clicks instead of `disabled`, or move focus to スキップ while animating and back to the dice when idle. | S |
| A2 | Med | SR | Live regions: 出目 `<dd aria-live>` (`GamePanel.tsx:92`) speaks only "4" with no label; an identical consecutive roll is silent (turn 5 in `keyboard-turns.json`); 抽選 region (`GamePanel.tsx:122`) names the station only when a service draw happened, so arrival (e.g. 西早稲田, turn 4) is never announced; 踏破区間 progress is never announced; two regions update in the same tick ("4" + "抽選: 移動中…"), which SRs may merge or drop. | Replace with one polite turn-summary region written once when the move finishes, e.g. 「3ターン目：出目2、渋谷に到着。東京メトロ副都心線 各停（和光市方面）に乗換（11系統から抽選）。踏破 9/30」; make the existing regions non-live. Include turn number so identical text still changes. | S–M |
| A3 | Med | keyboard, SR | Focus is lost to `<body>` on はじめから / つづきから (title unmounts, `GameApp.tsx:153`/`166`), on タイトル, and nothing is announced (`game-start.focus.json`, `to-title.focus.json`, `clear.json` `afterResume`). | On mount, focus the panel heading (`tabIndex={-1}`) or the dice button; on return to title focus the title `<h1>` or the primary button. | S |
| A4 | Med | keyboard | DOM order puts the map first: canvas, Zoom in/out, attribution toggle, 5 attribution links, 全体, 目標路線 = 11 stops before the panel (`game.tabs.json`, `RailwayMap.tsx:290-304` rendered before the panel in `GameApp.tsx:146`). On the title screen the same 11 stops are behind the dimmed overlay before はじめから (`title.tabs.json`, `desktop-title-focus.png`). No skip link, no `main` landmark in the game screen. | Render the panel before the map in DOM order (visual order is CSS-fixed anyway) or add a skip link; make the map `inert` while the title screen is shown. Wrap the game panel in `<main>`. | S |
| A5 | Med | SR, map | The map is `canvas role=region aria-label="Map"` (`map-canvas.json`) with no text alternative. The panel says where you are and how many of 30 segments are done, but not which Yamanote sections remain or what stations lie ahead on the current ride, which sighted users read off the map. | Add a collapsible text view in the panel: remaining Yamanote sections (or "次の未踏破区間"), and the next N stations in the current direction. Data already exists in the engine. | M |
| A6 | Med | SR | Clear: panel (with its live regions) unmounts and `ClearScreen` focuses もう一度遊ぶ (`ClearScreen.tsx:75` `autoFocus`); the last offered announcement is 「抽選: 移動中…」 and "クリア！" is never announced (`clear.json`). On a phone the autofocus scrolls the bottom sheet so the "クリア！" heading is off-screen (`phone-375x667-clear.png`). | Focus the `クリア！` heading (`tabIndex={-1}`) instead of the button, or announce a summary via a live region; keep the sheet scrolled to top. | S |
| M1 | Med | mobile | Landscape phone 667×375 and desktop at 200 % zoom (640×400) use the desktop layout (`@media (max-width: 600px)` only, `styles.css:463`): panel 310×255 scrolls (496 px content), lottery text and the option row are below the fold; attribution is partly under the panel (`landscape-667x375.png`, `landscape-667x375.json`, `zoom200-640x400.json`). | Add a short-viewport rule (`max-height: 500px`): two-column compact panel or collapse title/subtitle/legend; keep attribution clear of the panel. | M |
| M2 | Med | mobile, map | Follow camera centres the marker at the viewport centre (`RailwayMap.tsx:101-106`, no padding), which on phones is right at the panel's top edge, so the track ahead is often under the panel (`phone-320x568-after-rolls.png`, `phone-375x667-after-rolls.png`). | Apply the same bottom padding as `phonePanelBottomPadding` when recentring on phones (`easeTo/jumpTo` with `padding`). | S |
| M3 | Low | mobile | At 320 px the expanded attribution is clipped under the zoom buttons ("Data from", "CC BY 4.0" cut, `phone-320x568-*.png`); `max-width: calc(100vw - 80px)` (`styles.css:470`) does not account for the 44 px buttons + margins. Spec §6.2 requires attribution to stay visible. | Increase the reserved width (≈ 100vw − 70px with box-sizing), or start the attribution collapsed on phones. | S |
| M4 | Low | mobile, map | Station popup (`stationInteraction.ts:21`) is pointer-only on circles of radius 2.5–5 px (`mapConfig.ts:75-78`): hard to tap, impossible by keyboard/SR. Information (lines at a station) is non-essential for play. | Hit-test with a pixel buffer (`queryRenderedFeatures` on a bbox) for touch; optionally list station lines for the current station in the panel. | S–M |
| M5 | Low | mobile | Sub-44 px targets: legend toggle / すべて表示 / summaries 32 px tall (`styles.css:550,563,584,603`), attribution toggle 24×24 and text links 14 px tall (MapLibre). All pass WCAG 2.5.8 (24 px) but not the 44 px used elsewhere. (`phone-*.json` `smallTargets`) | Raise legend controls to 44 px on phones; leave MapLibre links. | S |
| K1 | Low | keyboard | Focus ring is the browser default only (no `:focus-visible` rules in `styles.css`); on `.button-primary` (dark green, `styles.css:31-37`) the dark ring has low contrast (`desktop-title-focus.png`). | Add a global `:focus-visible { outline: 3px solid #1565c0; outline-offset: 2px }`. | S |
| K2 | Low | keyboard | Arrow keys on the focused map canvas silently switch 追尾 to OFF (`map-keyboard.json`); a Tab-through user can do it accidentally and nothing is announced. | Announce "追尾をOFFにしました" via the status region, or only treat drag/wheel as user moves. | S |
| S1 | Low | SR | MapLibre UI strings are English in a `lang="ja"` page: "Map", "Zoom in", "Zoom out", "Toggle attribution", popup "Close popup" (`game.aria.yaml`). | Pass MapLibre `locale` option (`Map.Title`, `NavigationControl.ZoomIn/ZoomOut`, `AttributionControl.ToggleAttribution`, `Popup.Close`). | S |
| S2 | Low | SR | Speed button: `aria-label` says 「アニメーション速度: ふつう」 while the visible text says 「速度: 省略」 under reduced motion; the explanation is only in `title` on a disabled button (unreachable) (`GamePanel.tsx:106-114`, `game.aria.yaml`). | Build the label from what is shown; put the reason in visible text or `aria-describedby`. | S |
| S3 | Low | SR | Operator "select all" checkbox: visible label 「すべて選択」, accessible name 「〇〇の路線をすべて表示」 (`GameLegend.tsx:90-96`) — label-in-name mismatch for voice control. `.map-overview` `aria-label` on a plain `div` is ignored (`RailwayMap.tsx:291`). | Include the visible text in the name; add `role="group"`. | S |
| S4 | Low | SR | Phone layout hides the panel `<h1>` (`styles.css:484-490`), so the game screen has no heading for SR heading navigation on phones. | Visually hide instead of `display: none`. | S |
| C1 | Low | colour | Map legend lists completed/pending/current position but not the thick "current ride" highlight line (`GameLegend.tsx` legend list; `CURRENT_SERVICE_LINE_WIDTH`, `mapConfig.ts:56`). Text names the ride, so not colour-only. | Add a legend row 「乗車中の路線（太線）」. | S |
| R1 | Low | motion | No in-app "animation off"; users without the OS setting must press スキップ each turn (speed options are 300–600 ms/hop, `gameConfig.ts:29-31`). Spec §6.3 is met (skip + reduced motion). | Add a 「省略」 entry to the speed cycle. | S |

## Already works well

- Native modal `<dialog>` (`ConfirmDialog.tsx`): focus starts on キャンセル, Tab stays in the dialog, Escape cancels, focus returns to the opener (`dialog.json`).
- Clear screen paging has a `role=status` page indicator and `nav` label; history is a real list.
- All game buttons are real `<button>`s with text names; 追尾 uses `aria-pressed`; legend toggle uses `aria-expanded`/`aria-controls`; indeterminate operator checkboxes expose `mixed`.
- Map failure: `role=alert` with a 再試行 button; WebGL2 unsupported: `role=status` and the game continues without a map.
- Text equivalents for everything the map shows about the current state (station, ride, direction, turn, progress count, roll, lottery with candidates, full candidate list in `<details>`).
- `prefers-reduced-motion` is honoured live (`useSyncExternalStore`), including mid-move.
- Viewport meta allows zoom; no horizontal overflow at 320 px; game buttons are 44 px tall; panel share ≤ 43 % in portrait.
- Completed/pending Yamanote segments are solid vs dashed with a text legend.

## Not checked, and why

- Real screen readers (NVDA/JAWS/VoiceOver/TalkBack): not available on this WSL2 host. Live-region timing and merging of two simultaneous polite updates must be verified on a real SR; findings A2/A6 are from DOM mutations, not speech.
- Real devices and iOS Safari / WebKit (needs `sudo playwright install-deps`); touch was Chromium `hasTouch`/`isMobile` emulation only. Map pinch/drag vs panel scroll and OS text scaling (Android font size, iOS Dynamic Type) were not exercised.
- Firefox keyboard behaviour (focus fixup on disabled buttons differs by engine; A1 may behave differently there).
- Automated contrast/axe scan: axe-core is not installed and was out of scope. Spot checks only (#555 on white ≈ 7.5:1, white on #2e7d32 ≈ 5.1:1); MapLibre attribution text over the map and map label legibility not measured.
- 400 % zoom (320×200 CSS px) and Windows High Contrast / forced-colors mode.
