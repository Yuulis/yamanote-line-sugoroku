## Feature Brief: UI pop overhaul P0+P1 (design tokens, line badges, item icons, HUD, inventory box)

- Date: 2026-10-28 · Slug: `ui-pop-hud-inventory` · Branch: `feature/ui-pop-hud-inventory`
- Inputs: codebase scan `.claude/docs/research/feature-ui-pop-hud-inventory-codebase.md`,
  audit `.claude/docs/research/ui-pop-overhaul-audit.md`, badge research
  `.claude/docs/research/official-line-symbols-usage.md`, DESIGN.md Key Decisions dated
  2026-10-28, `brand/README.md`, Codex scope consult
  `.claude/logs/codex/20261028T040528Z-uipop-scope.md`.

### Current State
- Architecture: static React 19 / TypeScript 6 / Vite 8 app; one persistent MapLibre
  `RailwayMap` behind Title / `GamePanel` / ClearScreen screens (`src/app/GameApp.tsx`).
  Game state machine in `gameSession.ts` + `itemSession.ts` (`ItemSessionView` is the UI view).
  All results (roll, landing lottery, item events) are committed and saved before any
  presentation; the panel only reads `displayedRide` / displayed station / displayed progress.
- Relevant files: `src/features/game/components/{GamePanel,InventoryPanel,ItemEventNotice,DiscardChoice,RollAdjustment,ItemUseDialog,GameLegend}.tsx`,
  `src/styles.css` (single global stylesheet, no tokens, green primary `#2e7d32`),
  `src/features/game/{presentation,presentationResolver,itemPresentation}.ts`,
  `src/features/game/usePrefersReducedMotion.ts`, `src/features/map/RailwayMap.tsx`
  (queries `.game-panel` and `.game-panel__route-summary` for camera padding),
  `tests/e2e/support/app.ts` (`panelStat`, `diceButton`, `rollOnce`), `tests/unit/helpers/reactDom.ts`.
- Patterns: function components with named exports and `XxxProps`; BEM-ish global CSS;
  native `<dialog>` + `showModal()` in `useLayoutEffect`; pure text helpers in `*.ts`;
  exactly one polite live region in `.game-panel`; 44 px touch targets; unit tests are
  `.test.ts` using `createElement` + `mountReact` or `renderToStaticMarkup` under jsdom
  (Testing Library is not installed and must not be added); E2E uses role/name selectors
  and runs with `reducedMotion: "reduce"` by default.

### Feature Goal
Make the in-game screen read as a game instead of a form: a compact brand-coloured HUD that
answers "where am I, what am I riding, what can I do" every turn, with an icon inventory box,
original line badges, and the per-turn text moved behind a log drawer — while keeping the
same information reachable, accessible, and test-verified, and building the P0 foundations
(tokens, badges, icons, reveal hook, toast host) that P2 animations will use.

### Scope
- Include:
  - P0: design tokens (`--color-brand #d9502f`, ink `#263238`, cream `#faf7ef`, surfaces,
    good/bad, radius, shadow, motion durations that collapse under reduced motion) replacing the
    green primary; restyled `button` / `.button-primary` / dice CTA.
  - P0: `LineBadge` = official letter code + line colour in an original shape; frontend
    code table keyed by line-group id; 21 JR lines without a code get a colour-only badge with
    the line name beside it; no invented codes; `public/data` unchanged.
  - P0: 11 self-made inline SVG item icons (`ItemIcon`).
  - P0: `useRevealSequence` hook (presentation-only stages keyed by session/turn; instant under
    reduced motion; skippable via the existing スキップ / roll; no replay on resume).
  - P0: visual toast host (no extra `role=status` inside `.game-panel`; failures sticky).
  - P1: `GamePanel` → HUD (riding badge + direction, current station, turn, straight
    30-segment progress bar, dice CTA, inventory box, effect chips; save status icon with a
    persistent visible failure state).
  - P1: "ログ" drawer (arrival sentence, lottery sentence, item-event transcript, full roll text,
    地図なしで確認 route view, full candidate list) and a menu (追尾 / 速度 / 新規 / タイトル,
    134-line legend).
  - P1: inventory box (3 icon slots, hover/focus tooltip, click/tap opens an item card with
    使う; unusable items still open the card with the reason; passive 遅延証明書 explained);
    harmful effects as countdown chips; discard dialog reuses the cards; roll-adjust dialog
    restyled via tokens.
  - P1: phone layout (~400 px; 320/390 px still pass), short-landscape layout, compact
    map attribution on phone.
  - Test migration: E2E helpers updated once, unit tests for every new pure helper and component.
- Exclude:
  - P2: split-flap lottery display, dice tumble, arrival banner, pickup fly-in animations.
  - Sound; title / clear screen redesign; player pawn; dark mode (the app has none).
  - Any change to `src/features/game/engine/**`, RNG, reducers (`gameSession.ts`,
    `itemSession.ts`), save format / persistence, `src/types/network.ts`, `public/data/**`,
    `data/**`, share text.
  - New runtime or test dependencies (no icon library, no Testing Library, no webfont).

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: 37–43 (source 19–21, tests 18–22, plus 4–7 new test files)
- Estimated LOC: 2,700–4,400 changed (source 1,800–2,800; tests 900–1,600)
- Implementation route: team-execute — executed as dependency-ordered single-commit steps
  (`.claude/docs/plans/ui-pop-hud-inventory-plan.md`), each implemented by Codex Luna (high)
  or Claude Sonnet when Codex is limited, reviewed by Codex Sol (low), verified by the lead.

### Integration Points
- `GameApp` → `GamePanel`: keep `key={session.sessionId}`, stable callbacks and `memo`; mount
  the toast host outside the panel; extend `skip` so it also completes active reveal stages.
- Displayed vs committed state: HUD reads `displayedRide`, `displayedStationId`,
  `displayedCompletedCount`, `requiredCount` (fixtures use 4, production 30) — never the save.
- `RailwayMap`: `.game-panel` must stay on the HUD root (phone fit padding, follow padding
  ResizeObserver); the `.game-panel__route-summary` observation must follow the drawer.
- Live region: `itemTurnAnnouncement` stays the single gameplay announcement; toasts, chips and
  the drawer are not live regions; decision dialogs keep their own status copy.
- `ItemEventNotice` is also used inside `ClearScreen` with `completionAnnouncement`; keep that
  path working while the HUD uses chips and the log uses the outcome list.
- Item selection: opening a card never stages an item; 使う calls the existing `selectItem`
  path (route/direction tickets → `ItemUseDialog`; double/rapid/deadhead → `onEditItemDraft`).
- Native dialogs and focus: close card/menu before opening `ItemUseDialog` / `ConfirmDialog`;
  Escape closes the foremost dismissible layer before clearing the draft; roll-focus restore kept.
- Badges: resolve `serviceId` → `presentation.lineGroupId()` → code table; 大江戸線 two-slot
  group kept; unknown ids fall back to colour + name.
- Attribution: `AttributionControl({ compact: true })` already exists; the change is the
  default collapsed state on phone, links still reachable.

### Risks
- E2E selector churn (66 `panelStat` calls, 12 `.game-panel__lottery`, `inventoryItem()`,
  options/legend visibility, landscape and camera specs): update `tests/e2e/support/app.ts`
  once (`panelStat` targets a value span; idempotent `openGameLog` / `openGameMenu`;
  two-step `useInventoryItem`); re-point assertions to the new location with the same expected
  text; never delete or loosen them; no hidden compatibility DOM that exists only for tests.
- Camera padding regressions on phone/landscape: keep `.game-panel` on the HUD root; keep the
  drawer inside the panel box so its height is observed; re-run follow-camera specs.
- A11y regressions (tooltip-only info, focus loss, second live region): reasons stay in the card
  and `aria-describedby`; disclosure buttons with `aria-expanded`/`aria-controls`; single status
  region asserted in unit and E2E.
- Brand colour contrast: white on `#d9502f` ≈ 4.09:1 (< 4.5:1 AA for normal text) → use a darker
  vermilion token for small text-on-fill, or ink text, and assert with a unit contrast check.
- Badge correctness: lines that span two official codes (e.g. 東武伊勢崎線 TS/TI, 相鉄直通 JA/JS)
  and partial-coverage lines (宇都宮線/高崎線 JU) need an explicit rule; table is test-checked
  for full coverage of 134 groups and the exact 21 uncoded ids.
- Reveal hook lifecycle (timers, stale sessions, resume replay): pure stage reducer unit-tested;
  one motion-enabled E2E proves skip and no replay.
- Performance: legend tree and HUD must not re-render on toast ticks or reveal stages.

### Success Criteria
- `npm run typecheck`, `npm test`, `npm run build` pass; full Playwright suite passes on
  desktop-chromium, phone-chromium and desktop-firefox locally and all projects (incl. WebKit) in CI.
- No diff under `src/features/game/engine/`, `src/types/network.ts`, `public/data/`, `data/`,
  `src/features/game/gameSession.ts`, `src/features/game/itemSession.ts`,
  `src/features/game/store/`; existing saved-result equality assertions unchanged.
- No green primary remains in `src/styles.css`; all brand colours come from tokens.
- Every line group renders a badge: code + colour for coded lines, colour-only + name for the
  exact 21 uncoded JR lines; no rounded-square-with-two-letters or ring-around-letter shape.
- HUD at 1280x800 shows riding badge + direction, station, turn, progress bar, dice CTA,
  inventory and effect chips without scrolling; at 400 px wide the HUD covers ≤ 45 % of the
  viewport height and the map share stays < 50 %.
- All previous information is reachable: log drawer (turn text, lottery, full roll, route view,
  candidates) and menu (4 actions, legend) by keyboard and touch; exactly one polite status
  region in `.game-panel`; a failed save stays visible without opening anything.
- E2E assertions keep their expected values (re-pointed, not weakened); new unit tests cover
  badge table, icons, reveal reducer, toast queue, HUD, inventory card, chips, progress bar.
