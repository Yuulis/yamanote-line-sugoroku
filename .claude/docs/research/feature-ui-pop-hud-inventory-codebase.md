# Codebase Scan: UI pop overhaul P0+P1 (HUD + inventory)

- Date: 2026-10-28 · Branch `feature/ui-pop-hud-inventory` (= `develop` @ `4368673`, v0.10.0)
- Mode: MODE=existing affected-area scan. Complements (does not repeat)
  `.claude/docs/research/ui-pop-overhaul-audit.md` §A (UI inventory) and §B.2/B.3
  (blast radius). Badge rules: `.claude/docs/research/official-line-symbols-usage.md`.

## 1. Affected areas

| Area | Files | Role today | Change expected |
|------|-------|-----------|-----------------|
| Global CSS | `src/styles.css` (1,144 lines) | Only custom properties are `--layer-*` z-indexes. Green primary `#2e7d32`/`#1b5e20` hard-coded at L37-39, 251, 598, 641, 686, 716, 760, 820, 1013. No `prefers-color-scheme`, no `prefers-reduced-motion`, no transitions/keyframes. Media queries: `max-width: 360px`, `max-width: 600px` (phone bottom sheet), `min-width: 601px`, `min-width: 601px and max-height: 500px` (landscape grid areas). | Add tokens; restyle `button`, `.button-primary`; new HUD/inventory/drawer/menu/toast sections; rewrite phone + landscape blocks. |
| Panel | `src/features/game/components/GamePanel.tsx` (340) | `memo` component, `<main class="game-panel" aria-label="ゲーム操作">`, owns: stats `<dl>`, roll/skip, staged summary, InventoryPanel, options row, arrival/lottery paragraphs, single live region, `<details>` route summary, candidates `<details>`, save line, GameLegend, item dialogs, roll-focus restore, Escape-clears-draft, heading focus on mount. | Becomes the HUD shell; sub-sections extracted. |
| Inventory | `InventoryPanel.tsx` (67) | 3 text rows `.item-slot`, `<h3>` name, one button with `aria-pressed`, `aria-describedby` reason. | Icon slot box + item card. |
| Item notices | `ItemEventNotice.tsx` (37) | `<section aria-label="アイテムのお知らせ">`: per-turn outcome list + `続いている効果` list. Also rendered by `GameApp` inside `ClearScreen` with `completionAnnouncement` (its own live region on the clear screen). | Outcome list → log drawer; effects → chips; keep component for ClearScreen. |
| Dialogs | `DiscardChoice.tsx` (50), `RollAdjustment.tsx` (82), `ItemUseDialog.tsx` (187) | Native `<dialog>` + `showModal()` in `useLayoutEffect`, heading focus, `useId` ids. | Discard: item cards; RollAdjustment: unchanged except tokens (die buttons are P2-ish polish, optional). |
| Legend | `GameLegend.tsx` (127), `legendCollapse.ts` | 3 fixed rows + note (`role=list` name 凡例) and 134-line checkbox tree toggle `/路線の凡例/`. | Moves into the menu unchanged. |
| App shell | `src/app/GameApp.tsx` (272) | Owns speed/follow/confirm state, passes ~25 props to memoised `GamePanel` (callbacks kept stable on purpose). | Mount toast host; maybe pass save status for toast. |
| Map | `src/features/map/RailwayMap.tsx` | **Queries `.game-panel` by class** (L111 phone fit padding, L345 ResizeObserver for follow padding) and `.game-panel__route-summary` (L346). Attribution: `AttributionControl({ compact: true })` already; position top-left on phone, bottom-right otherwise. | Keep `.game-panel` class on the HUD root; replace the route-summary observe with the drawer element (or rely on panel resize). Compact attribution: collapse by default on phone. |
| Presentation | `presentation.ts`, `presentationResolver.ts`, `itemPresentation.ts` | Pure text helpers; `lineGroupColor`, `lineGroupId`, `candidateRows`; `ITEM_DESCRIPTIONS` (11 kinds), `itemTiming`, `itemUnavailableLabel`. | Add `lineBadge.ts` (code table + resolver), item short names. No change to existing strings used by tests. |
| Reduced motion | `usePrefersReducedMotion.ts` | `useSyncExternalStore` on the media query. | Reused by reveal hook and toasts. |

Not affected (frozen): `src/features/game/engine/**`, `gameSession.ts`/`itemSession.ts` reducers, `store/persistence.ts` save format, `src/types/network.ts`, `public/data/**`, `data/**`.

## 2. Conventions to follow

- **Components**: function components, named exports, props interface `XxxProps` in the same file, `memo` only on the panel. CSS classes BEM-ish (`block__element--modifier`), one global stylesheet, no CSS modules, no CSS-in-JS, no UI library. Inline `style` only for data-driven colours (`service-swatch`).
- **Pure helpers** live next to components in `src/features/game/*.ts`; components never import engine RNG (`engine/rng.ts`, `playTurn`, `drawLanding`); `presentation.ts` imports engine *types* and pure lookups only.
- **Constants**: `UPPER_SNAKE_CASE` (`INVENTORY_SLOT_COUNT`, `UPCOMING_STATION_COUNT`, `LOTTERY_INLINE_LIMIT`).
- **Dialogs**: native `<dialog>` with `showModal()` in `useLayoutEffect`, focus heading, cancel handling via `onCancel`. Unit tests stub `showModal`/`close` on `HTMLDialogElement.prototype`.
- **A11y**: exactly one polite live region in `.game-panel` (`items.spec.ts` L56, `item-controls.test.ts` L259/L264); dialogs carry their own `role=status` copy of the announcement; roll button regains focus after a decision dialog; heading focus on mount; 44 px minimum touch target (global `button { min-height: 44px }`).
- **Text**: Japanese UI copy; code/comments English.

## 3. Test patterns

- **Unit** (`vitest run`, `tests/unit/**/*.test.ts` — `.ts` only, no `.tsx`): React via `createElement`, `// @vitest-environment jsdom` header, `tests/unit/helpers/reactDom.ts` (`mountReact`, `flushReact`, `dispatchReactEvent`), or `renderToStaticMarkup` (`game-legend.test.ts`, `capital-region-scaling.test.ts` L113 renders `GamePanel` for the legend). **Testing Library is not installed**; do not add it.
  Fixtures: `tests/unit/fixtures/multiService.ts`, real fixture data from `tests/e2e/fixtures/data/*`. `game-app-item-progress.test.ts` mounts `GameApp` with `RailwayMap` mocked and reads stats via `dt.textContent === label` → `nextElementSibling.textContent` (現在駅, 踏破区間) and clicks buttons by `textContent.includes("サイコロを振る"|"スキップ"|"つづきから")`.
- **E2E** (`playwright test`): role/name selectors via `tests/e2e/support/app.ts` (`gamePanel`, `diceButton`, `panelStat`, `rollOnce`, `revealUnadjustedRoll`, `freezeClock`, `readSave`, `readMap`). `reducedMotion: "reduce"` by default; motion-enabled describes in `accessibility`, `dice`, `lottery`, `items`, `capital-region`, `resume`. Local run: `env -u WAYLAND_DISPLAY npx playwright test` (memory note), 2 workers; WebKit only on CI.
- Projects: desktop-chromium (1280x800), phone-chromium (Pixel 7, 412x839, touch), desktop-firefox, desktop-webkit (CI).

## 4. Blast radius (counted on this branch)

- `panelStat(` call sites per spec: dice 15, lottery 10, capital-region 10, tokyo-suburban 6, real-data 6, map-failure 5, items 4, resume 4, full-game 3, accessibility 2, map-unsupported 1 (= 66). Labels: ターン数, 現在駅, 乗車中, 踏破区間, 出目, 進行方向. Exact-text values include `"テスト南線"`, `"大森方面"`, `"4/30"`, `"3（3マス、2駅移動、残り1は使わず）"`.
- `.game-panel__lottery` (12): lottery.spec L14/51/59, capital-region L177/233/273/386, tokyo-suburban L53, real-data L164, accessibility L124/230/238. Includes `"抽選: 移動中…"` and `"抽選: テスト南線のみ ／ 方向抽選 → 品川方面"` and `not.toHaveAttribute("aria-live")`.
- Options row (追尾/速度/新規/タイトル): accessibility L56/103/135/170/231/239/241 (`toHaveCount(4)`), layout L35/125, capital-region L137 (`追尾: OFF` visible), real-data L363 (`新規`).
- Legend: dice L79 (`list 凡例` exact 4 items — spec [8.3-3]), map-visual L184/L286-306, real-data L110/115/190/265, capital-region L139; unit `game-legend.test.ts`, `capital-region-scaling.test.ts` L113.
- Route summary: accessibility L183-195/321/358 (`.game-panel__route-summary > summary`, regions 山手線の未踏破区間 / 乗車中の次の駅), items L222-223; RailwayMap L346 observes it. The desktop test at accessibility L358 grows the panel by opening it to prove follow padding ignores desktop panel resizes.
- Candidates `<details>`: capital-region L179-196 (`.game-panel__candidates`, 6 list items, `not.toHaveAttribute("aria-live")`).
- Inventory: items.spec `inventoryItem()` (`.item-slot` filtered by `heading` name, then its only `button`, `aria-pressed`) L62/159/180/204/232/265; heading `アイテム（3枠）` visible L55/L247; region `アイテムのお知らせ` + `getByLabel("続いている効果")` L144/147; `.item-arrival` L166; `.game-panel__save` contains `セーブ:` L255. Unit `item-controls.test.ts` L81-125, L245-286 (`.item-slot`, `.item-slot--empty` ×3, `button[aria-pressed]`, `[aria-label='前のターンの結果']`, `[aria-label='続いている効果']`, `.game-panel__roll` focus).
- Layout: layout.spec `MAX_PANEL_SHARE_OF_MAP = 0.5`, zoom-button overlap; accessibility L220-247 landscape 667x375 & 640x400 (panel ≤ 75% height, lottery+options in viewport, panel scrolls); follow-camera tests read `.game-panel` top; map-visual phone overview fit with legend expanded.

## 5. Dependencies

- Upstream data for the HUD: `GameSession` (`phase`, `lastMove`, `animation`), `ItemSessionView` (`inventory`, `usableItems[].{usable,reason,selected,recommended}`, `hints`, `decision`, `effects`, `draft`), `displayedRide`, `displayedStationId`, `displayedCompletedCount`, `requiredCount`, `saveStatus` (`SaveWriteResult`, `saveStatusMessage`).
- Downstream consumers of panel DOM: `RailwayMap` (`.game-panel`, `.game-panel__route-summary`), every E2E spec via `support/app.ts`, two unit tests that mount `GamePanel`/`GameApp`.
- Line data: `manifest.json` `uiPresentation.lineGroups` = 134 groups (ids such as `jr-yamanote`, `metro-ginza`, `toei-oedo` with two services), `services.json` `lines` = 135. No letter codes anywhere in data → frontend table keyed by line-group id required; DESIGN.md freezes `public/data`.
- No dark mode exists (only `favicon.svg` switches); DESIGN.md audit C.15 defers it.

## 6. Shared utilities to reuse

`usePrefersReducedMotion`, `presentationResolver.lineGroupId/lineGroupColor/serviceName/candidateRows`, `presentation.directionLabel/lastRollText/landingText/arrivalSummary/itemEventTexts/activeItemEffectTexts/itemTurnAnnouncement`, `itemPresentation.ITEM_DESCRIPTIONS/itemTiming/itemUnavailableLabel`, `.visually-hidden`, `tests/unit/helpers/reactDom.ts`, `support/app.ts` helpers.
