# UI Pop Overhaul P0+P1 (HUD + Inventory) — Implementation Plan

- Date: 2026-10-28 · Slug `ui-pop-hud-inventory` · Branch `feature/ui-pop-hud-inventory` (from develop `4368673`, v0.10.0)
- Mode: `/feature MODE=existing` Phases 1E/2E. Complexity (Codex): **COMPLEX** (37–43 files, ~2.7–4.4k changed LOC).
- Status: **planned, awaiting user approval**. Nothing implemented.
- Inputs: brief `.claude/docs/research/feature-ui-pop-hud-inventory-brief.md`; codebase scan
  `.claude/docs/research/feature-ui-pop-hud-inventory-codebase.md`; audit
  `.claude/docs/research/ui-pop-overhaul-audit.md`; badge research
  `.claude/docs/research/official-line-symbols-usage.md`; DESIGN.md decisions dated 2026-10-28; `brand/README.md`.
- Codex record (Sol, read-only): scope `.claude/logs/codex/20261028T040528Z-uipop-scope.md`, architecture
  `.claude/logs/codex/20261028T041115Z-uipop-arch.md`, plan `.claude/logs/codex/20261028T042448Z-uipop-plan.md`,
  validation round 1 `.claude/logs/codex/20261028T043558Z-uipop-validate.md` (NEEDS_REVISION; deltas folded in
  below), round 2: see §9.
- Companion docs: per-step prompts `.claude/docs/plans/ui-pop-hud-inventory-prompts.md`; handoff
  `.claude/docs/plans/ui-pop-hud-inventory-handoff.md`.

## 1. Scope

In: P0 tokens + brand buttons, line-badge code table + `LineBadge`, 11 inline SVG item icons, reveal-sequence
hook (no added delay; empty production stages), visual toast host; P1 HUD, log disclosure, menu disclosure,
straight 30-segment progress bar, effect chips, inventory icon slots + item card popover, discard cards, phone /
short-landscape layout, collapsed phone attribution.

Out: P2 (split-flap lottery display, dice tumble, arrival banner), sound, dark mode (none exists), title/clear
redesign, player pawn, any change to engine/RNG/reducers/save/`public/data`/`data`/share text, new dependencies
(no icon library, no Testing Library, no webfont).

## 2. Architecture

```text
GameApp                              reveal hook, toast inputs, coordinated skip, panelKey for the map
├─ GamePanel  <main class="game-panel" aria-label="ゲーム操作">   memo; key = sessionId; coordinator
│  ├─ GameHud            6-label <dl>, LineBadge, TargetProgressBar, dice/skip, save indicator (.game-panel__save)
│  ├─ InventoryPanel     3 icon slot openers (.item-slot + <h3> name, one button each), tooltips
│  ├─ EffectChips        aria-label="続いている効果", canonical countdown text, no live region
│  ├─ [ログ] [メニュー]  disclosure buttons (aria-expanded / aria-controls; NOT role=menu)
│  ├─ TurnLogDrawer      mounted, `hidden` when closed: arrival, .game-panel__lottery, full roll (data-stat="roll"),
│  │                     ItemEventNotice(showEffects=false), 地図なしで確認 <details>, all candidates
│  ├─ GameMenu           mounted, `hidden` when closed: .game-panel__options (追尾/速度/新規/タイトル) + GameLegend
│  ├─ ItemCardPopover    native Popover API (popover="auto", role="dialog", no aria-modal); inline fallback
│  ├─ single gameplay live region (itemTurnAnnouncement) — unchanged ownership
│  └─ existing native modal dialogs (ItemUseDialog, RollAdjustment, DiscardChoice)
├─ ToastHost             outside the panel; aria-hidden; local queue/timers; no interactive descendants
├─ ConfirmDialog, ClearScreen (unchanged behaviour)
└─ RailwayMap            persistent; observes `.game-panel` root, rebinds on panelKey change
```

State ownership: session/store unchanged (all gameplay); `GameApp` reveal hook + confirm state + toast inputs;
`GamePanel` one active surface (`log | menu | card | none`) + item-dialog state + focus refs; `InventoryPanel`
tooltip state only; `ToastHost` queue/cursor/timers; `GameLegend` keeps its own expansion state (mounted while
the menu is hidden). No context provider, global store, or per-frame React updates.

Key contracts (from the adopted Codex architecture, round-1 validation deltas included):

- **Stats.** The HUD keeps a `<dl>` with the six `<dt>` labels 現在駅 / 乗車中 / 進行方向 / ターン数 / 踏破区間 / 出目.
  Plain values sit in `<span class="hud-stat__value" data-stat="station|ride|direction|turn|progress|roll-compact">`;
  badge and progress graphics sit outside the value span. The full roll string (`lastRollText`, unchanged) lives
  only in the log as `data-stat="roll"`. `panelStat(page, "出目")` maps to `roll` and callers open the log first.
  Compact roll comes from typed record fields (`compactRollFor`), never from parsing text.
- **Dice CTA.** Accessible name and `textContent` stay exactly `サイコロを振る` / `この内容でサイコロを振る` /
  `移動中…`; any icon is an `aria-hidden` SVG with no `<title>`/`<text>` descendants. Brand fill `#d9502f` with
  white text only at large-bold size (≥ 18.7px/700); normal-size white text uses `--color-brand-strong #b83f24`
  (5.56:1). White on `#d9502f` is 4.09:1.
- **Progress.** One `role="progressbar"` (`aria-valuenow`/`aria-valuemax`, label 山手線の踏破区間) with
  `requiredCount` straight, `aria-hidden` segments (30 in production, 4 in fixtures), filled up to
  `displayedCompletedCount`. Never a ring. Segment positions do not claim to be specific sections.
- **Effects.** `effectChipModels` take text from `activeItemEffectTexts` (no second wording); container keeps
  `aria-label="続いている効果"`; wraps on desktop, scrolls horizontally on narrow phones.
- **Log / menu.** Inline disclosure regions inside `.game-panel`, mounted and `hidden` when closed (`[hidden]`
  must win over component display rules). One surface open at a time. Closing restores focus to the trigger.
  E2E helpers open the destination and assert it is visible before reading it; hidden content never satisfies
  an assertion.
- **Item card.** Every occupied slot is an enabled details opener (also unusable/passive items) with
  `aria-expanded`, `aria-controls`, `aria-describedby` → persistent visually hidden description; no
  `aria-pressed` (selection is shown by `.item-slot--selected` + text + staged summary + announcement). Card
  shows name/effect/timing/hint/reason and a 使う action that re-validates current `usableItems` and phase, then
  calls the existing `selectItem` path. Tooltip = non-interactive visual duplicate of the description.
- **Focus / Escape order.** native modal → card → tooltip/disclosure → existing draft clear; a handled Escape
  calls `preventDefault` and never also clears the draft. Card 使う for route/direction tickets: hide card, focus
  slot opener, open `ItemUseDialog`; closing it restores the slot opener. Menu 新規: focus menu trigger before
  hiding the menu and opening `ConfirmDialog`. Automatic decisions (adjust/discard) close card/menu/log first and
  suppress restoration during the handoff.
- **Reveal hook** (`src/features/game/animation/useRevealSequence.ts`): pure `revealReducer` + hook; key
  `${sessionId}:${recordTurn}` where `recordTurn = lastMove.itemRecord.turn` (not `game.turn`, not
  `decisionRevision`); resumed/baseline records start done; empty stages ⇒ `stage:"done"`, no timers, `ready`
  once movement completes; `GameApp.skip` marks reveal skipped and finishes the animation; idempotent.
- **Toasts** (`toastQueue.ts` pure + `ToastHost.tsx`): ≤ 3 visible, one slot reserved for a sticky save
  failure (cleared on successful save or session exit); keys `${sessionId}:${recordTurn}:${eventIndex}`;
  current-turn seen cursor prevents resurrection; discard appends only the new event; ordinary reading time
  4,000 ms after becoming visible; reduced motion removes transitions, not reading time. **Obscured state:**
  `GameApp` computes `obscured = confirm !== null || itemView?.decision != null || itemDialogOpen`, where
  `itemDialogOpen` comes from a new stable optional `GamePanel` prop `onItemDialogOpenChange`; queued toasts do
  not start their timer while obscured, and a visible toast's remaining time pauses while obscured.
- **Map.** Keep `.game-panel` on the HUD root. Remove the `.game-panel__route-summary` observation; observe the
  map container + panel root; new optional `RailwayMap` prop `panelKey` (session id while the panel is mounted)
  in the observer effect deps only (never map-initialisation deps). Phone attribution starts collapsed by
  activating the existing MapLibre toggle when expanded (no private APIs, no CSS-hidden credits, never re-collapse
  after the user opens it; re-apply on reattachment after rotation).
- **Badges** (`lineBadge.ts` + `LineBadge.tsx`): `serviceId → presentation.lineGroupId() → LINE_BADGE_CODES`;
  `NO_CODE_LINE_GROUP_IDS` = exactly the 21 JR ids below; unknown ids → colour + name, no code; never infer codes
  from ids/names/operators. Shape: horizontal pennant/parallelogram colour block with unskewed system-font code,
  line name as adjacent plain text; forbidden: rounded square framing letters, ring around a letter, station
  numbers, operator artwork/typeface. Text colour = black or white by computed contrast (≥ 4.5:1 for every
  catalogue colour). Generic `contrastRatio` lives in `src/features/game/uiContrast.ts`; badge-specific
  `badgeTextColor` lives in `lineBadge.ts`.
  Uncoded ids: `jr-hachiko, jr-kawagoe-west, jr-sagami, jr-narita-abiko, jr-kashima, jr-sotobo, jr-uchibo,
  jr-kururi, jr-togane, jr-chuo-tatsuno, jr-koumi, jr-oito, jr-shinetsu-yokokawa, jr-joetsu, jr-agatsuma,
  jr-ryomo, jr-mito, jr-nikko, jr-karasuyama, jr-suigun, jr-suigun-ota` (113 coded + 21 uncoded = 134 groups,
  135 services; 大江戸線 = one group with two services).

Error handling: save failure keeps one `.game-panel__save` with `セーブ:` + the full `saveStatusMessage` text and
a persistent visible warning; unknown badge → no code; stale reveal/toast callbacks ignored by key/index;
removed item while its card is open → card closes, focus to dice; popover API missing → inline card; map
unavailable → all information still in the panel; tiny viewport → scroll, never shrink targets below 44px.

## 3. Common step contract (applies to every step)

- One commit per step on `feature/ui-pop-hud-inventory`; stage only the step's files plus the handoff doc.
  Never touch the pre-existing uncommitted `.claude/docs/DESIGN.md` change or untracked research files.
- Forbidden paths: `src/features/game/engine/**`, `src/features/game/gameSession.ts`,
  `src/features/game/itemSession.ts`, `src/features/game/store/**`, `src/types/network.ts`, `public/data/**`,
  `data/**`, `src/features/game/shareText.ts`. No dependency changes (`package.json`, lockfile).
- Tests: unit tests are `tests/unit/*.test.ts` using `createElement` + `mountReact` / `renderToStaticMarkup`.
  **Lifecycle/update assertions use a stable component identity** (`act(() => mount.root.render(createElement(Harness, props)))`
  with a named `Harness`), never `mountReact().render()`, which remounts.
- E2E: never skip, delete or loosen an assertion; re-point it to the real visible destination with the same
  expected value; no hidden compatibility markup kept only for tests; `rollOnce()` never opens disclosures.
- Gates (shell functions; define once per session):

  ```bash
  ui_gate() { npm run typecheck && npm test && npm run build; }
  ui_e2e() { env -u WAYLAND_DISPLAY npx playwright test --workers=2 \
    --project=desktop-chromium --project=phone-chromium --project=desktop-firefox "$@"; }
  ```

  `ui_e2e` with no arguments = full local suite. WebKit runs in CI (`E2E_WEBKIT=1` only where its deps exist).
- Done criteria: acceptance commands pass; lead runs
  `python3 .claude/skills/_shared/verify_delegation.py --base HEAD --expect-files <step files> --forbid-outside src --forbid-outside tests --forbid-outside .claude/docs --label uipop-s<N>`
  and reads the diff; reviewer (Codex Sol low, read-only) has no blocking finding;
  **`.claude/docs/plans/ui-pop-hud-inventory-handoff.md` updated** (status, commit, commands + results, open
  findings, next-step constraints) before the step is reported done.
- Lanes: implementer **Codex Luna high** by default (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --timeout 2400`);
  **Claude Sonnet** fallback for UI/CSS/mechanical work when Codex is limited; reviewer **Codex Sol low**
  (`--config model_reasoning_effort=low --sandbox read-only`). Judgment work (S2 mapping) goes to **Codex Sol
  high**. Luna xhigh (user-permitted) only if a Luna-high run fails on a well-specified step.

## 4. Steps

Abbreviations: `G/`=`src/features/game/`, `C/`=`src/features/game/components/`, `M/`=`src/features/map/`,
`U/`=`tests/unit/`, `E/`=`tests/e2e/`. Every step also owns the handoff doc. Sizes = changed LOC (adds+dels).

### P0 — foundations

| # | Step | Files | Tests | Acceptance | Lane | Size | Deps |
|---|------|-------|-------|-----------|------|------|------|
| S1 | Tokens + accessible brand buttons | `src/styles.css` (tokens: brand/brand-strong/ink/cream/surface/text/border/good/bad/focus/radius/shadow/motion; `@media (prefers-reduced-motion: reduce)` zeroes motion tokens; `button`, `.button-primary`, `:focus-visible`; replace every green UI primary, keep railway colours); new `G/uiContrast.ts` (`contrastRatio`, `parseHexColor`) | new `U/ui-contrast.test.ts`: known ratios (black/white 21:1), brand 4.09, strong ≥ 4.5, CSS token presence, no `#2e7d32`/`#1b5e20` left in `src/styles.css`, reduced-motion override present | `ui_gate && ui_e2e` (full) | Luna high / Sol low; Sonnet fallback | S ~140 | — |
| S2 | Line-badge catalogue (source-verified) | new `G/lineBadge.ts` (`LINE_BADGE_CODES`, `NO_CODE_LINE_GROUP_IDS`, `lineBadgeFor`, `badgeTextColor`), new `.claude/docs/research/line-badge-codes.md` (134 rows: group id, code/none, source URL, note) | new `U/line-badge.test.ts`: exact equality with the 134 manifest group ids; 113/21 split; exact 21 ids; disjoint sets; both 大江戸線 services → same badge; **operator-symbol membership** (codes per operator id prefix ⊆ research §2 symbol sets, encoded in the test); **independent spot expectations** written from research/common knowledge, not from the table (≥ 20: jr-yamanote JY, jr-keihin-tohoku JK, jr-chuo-sobu-local JB, jr-chuo-rapid JC, jr-saikyo JA, jr-keiyo JE, jr-yokohama JH, jr-joban-local JL, metro-ginza G, metro-marunouchi M, metro-namboku N, toei-asakusa A, toei-mita I, toei-oedo E, tokyu-toyoko TY, keio-main KO, odakyu-odawara OH, sotetsu-main SO, tx TX, mm-minatomirai MM, hokuso-main HS, keikyu-main KK, keisei-main KS, tobu-tojo TJ, seibu-ikebukuro SI, yokohama-blue B); unknown id + invalid colour fallback; black/white text ≥ 4.5:1 for every catalogue colour | `ui_gate` | **S2A: Codex Sol high (read-only, live web) authors the mapping doc; lead spot-checks; S2B: Luna high transcribes + tests** / Sol low review (one commit) | M ~300 | S1 |
| S3 | `LineBadge` + 11 item icons | new `C/LineBadge.tsx`, `C/ItemIcon.tsx` (exhaustive `Record<ItemKind, …>` path data, `currentColor` + accent, `aria-hidden`, no `<title>`/`<text>`, no `id`s), `src/styles.css` | new `U/item-icon.test.ts` (every `ItemKind` renders one SVG, decorative, no text nodes/ids/external refs); extend `U/line-badge.test.ts` (coded badge shows code + adjacent name; uncoded/unknown shows colour + name, no code; markup has no ring/rounded-square class; no station numbers) | `ui_gate && ui_e2e tests/e2e/layout.spec.ts` | Luna high / Sol low; Sonnet fallback | M ~250 | S2 |
| S4 | HUD pure models + progress bar + effect chips | new `G/hudPresentation.ts` (`compactRollFor`, `progressSegments`, `effectChipModels`), `C/TargetProgressBar.tsx`, `C/EffectChips.tsx`, `src/styles.css` | new `U/hud-presentation.test.ts`: empty/normal/adjusted/double/rapid/oversleep/deadhead compact rolls; 30 and 4 segments, 0/partial/full; one progressbar with values, decorative segments; chip text === `activeItemEffectTexts` for every combination incl. expiry boundaries, multiple delays/suspensions, pending detour/oversleep without numeric countdown; stable distinct keys | `ui_gate` | Luna high / Sol low | M ~320 | S1, S3 |
| S5 | Reveal reducer + hook (no added delay) | new `G/animation/useRevealSequence.ts` | new `U/reveal-sequence.test.ts`: reducer first, then stable-identity hook harness with fake timers: empty stages/no timers; natural multi-stage completion; skip while armed/active; repeated skip; reduced motion toggled live; stale advance ignored; unmount/session replacement cancels timers; duplicate observations and new stage-array identity do not replay; idle / pending-roll / pending-discard resume start done; record turn ≠ game turn | `ui_gate` | Luna high / Sol low | M ~380 | S1 |
| S6 | Toast conversion + bounded queue | new `G/toastQueue.ts` (`turnToasts`, `toastQueueReducer`) | new `U/toast.test.ts`: capacity 3; sticky failure reserves a slot and clears on success/session exit; keys use original event index; pickup dedupe consistent with `itemEventTexts`; discard appends only the new event; expired toast never resurrects (seen cursor); prior-turn/stale inputs rejected; session reset | `ui_gate` | Luna high / Sol low | M ~240 | S1 |
| S7 | Visual `ToastHost` with local timers | new `C/ToastHost.tsx`, `src/styles.css` | extend `U/toast.test.ts` (stable harness, fake timers): 4,000 ms reading time after visible; deferred while `obscured`; remaining time pauses when obscured mid-read; reduced motion keeps reading time; cleanup on unmount/session change; failure persists until success; host `aria-hidden`, no `role=status`/`aria-live`/interactive descendants; icons via `ItemIcon` | `ui_gate` | Luna high / Sol low | M ~220 | S3, S6 |
| S8 | GameApp integration: reveal readiness, coordinated skip, toasts, obscured wiring | `src/app/GameApp.tsx` (hook, ToastHost mount, `skip` finishes reveal + animation, `obscured` from confirm/decision/`itemDialogOpen`); `C/GamePanel.tsx` (only the optional stable `onItemDialogOpenChange` prop); `U/game-app-item-progress.test.ts`; `tests/e2e/resume.spec.ts`; `tests/e2e/save-errors.spec.ts` | keep `keeps the origin visible until the %s movement save attempt` (saved/failed) unchanged in expectations; add: toast appears after movement settles (not before), no toast replay on resume (motion enabled), failed-save toast persists past 4 s and clears after a later successful save; toast deferred while `ItemUseDialog`/adjust/discard/confirm are open (unit, production wiring); dice/items skip tests and saved-result equality unchanged | `ui_gate && ui_e2e` (full) | Luna high / Sol low | M ~240 | S5, S7 |

### P1 — HUD, menu, log, inventory, layout

| # | Step | Files | Tests | Acceptance | Lane | Size | Deps |
|---|------|-------|-------|-----------|------|------|------|
| S9 | Stable stat markers + shared E2E helpers (once) | `C/GamePanel.tsx` (value spans with `data-stat`, full roll `data-stat="roll"` in place), `tests/e2e/support/app.ts` (`panelStat` label→`data-stat` map, synchronous; idempotent `openGameLog`/`closeGameLog`/`openGameMenu`/`closeGameMenu` that check `aria-expanded` **and** assert the region is visible; `inventoryItem`; `useInventoryItem` two-step helper prepared for S21), `U/game-app-item-progress.test.ts` (read value spans) | all 66 `panelStat` assertions unchanged in expected values; the log/menu helpers are added now and first called in S13/S15/S16 (no caller before the disclosures exist); open helpers assert the region is visible, close helpers assert it is hidden | `ui_gate && ui_e2e` (full) | Luna high / Sol low | S ~150 | S8 |
| S10 | Extract and show the HUD | new `C/GameHud.tsx` (6 labels, `LineBadge` outside ride value, `TargetProgressBar`, dice CTA with exact text contract, skip, `.game-panel__save` indicator with full text + persistent failure), `C/GamePanel.tsx`, `C/ItemEventNotice.tsx` (`showEffects?: boolean = true`), `src/styles.css`, `U/item-controls.test.ts`, `tests/e2e/items.spec.ts`; new `U/game-hud.test.ts` | displayed station/ride/progress (not committed), supplied `requiredCount`, roll focus restore + click suppression while moving, exact dice texts in 3 states, one progressbar, `.game-panel__save` contains `セーブ:`, exactly one `[role=status]` in `.game-panel` in item and legacy paths (the legacy save paragraph drops its extra `role=status`; the visible save text stays), effect assertions in `items.spec` (`続いている効果` countdowns) re-scoped to `gamePanel(page)` with identical text; subtitle `東京近郊版` stays in the panel (visible desktop, hidden phone — `real-data.spec.ts` L227); ClearScreen `ItemEventNotice` output and completion announcement unchanged | `ui_gate && ui_e2e` (full) | Luna high / Sol low | M ~340 | S3, S4, S9 |
| S11 | Map observes the real panel across sessions | `M/RailwayMap.tsx` (`panelKey?` prop, observe container + `.game-panel` root, drop route-summary observation), `src/app/GameApp.tsx` (pass `panelKey`), `U/game-app-item-progress.test.ts` (or new `U/map-panel-observer.test.ts`), `tests/e2e/accessibility.spec.ts` | rebinding observes the replacement panel after new game/resume with follow on; map instance persists (no re-init); phone/landscape follow padding tests pass; disclosure open/close updates phone padding; desktop camera unchanged | `ui_gate && ui_e2e tests/e2e/accessibility.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/layout.spec.ts tests/e2e/resume.spec.ts` | Luna high / Sol low | S ~160 | S10 |
| S12 | Menu disclosure, initially expanded | new `C/GameMenu.tsx` (`.game-panel__options` with exactly the 4 actions + memoised `GameLegend`), `C/GamePanel.tsx` (trigger outside `.game-panel__options`), `src/styles.css` (44×44 legend toggles/checkbox labels; current 32px overrides fixed), `U/capital-region-scaling.test.ts`, `U/game-hud.test.ts` | `aria-controls`/`aria-expanded`, plain labelled section (no `role=menu`), 4 actions, focus to trigger on close, 新規 → ConfirmDialog handoff, Escape closes menu before draft clear, legend state preserved, `[hidden]` precedence | `ui_gate && ui_e2e tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts tests/e2e/dice.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/real-data.spec.ts` | Luna high / Sol low | M ~220 | S11 |
| S13 | Migrate every menu consumer | `tests/e2e/accessibility.spec.ts`, `tests/e2e/layout.spec.ts`, `tests/e2e/dice.spec.ts`, `tests/e2e/map-visual.spec.ts`, `tests/e2e/capital-region.spec.ts`, `tests/e2e/real-data.spec.ts` | open menu via helper before 追尾/速度/新規/タイトル/legend; keep `toHaveCount(4)`, exact 4 legend strings incl. the note (dice [8.3-3]), solid/dashed + rendered-layer checks; map-visual: keep the menu open while collapsing the *service list* and assert 山手線 踏破済み/未踏破/現在地 rows stay visible, then close the menu before geometry; close menu before camera/dice geometry | same as S12 | Luna high / Sol low | S ~110 | S12 |
| S14 | Menu closed by default | `C/GamePanel.tsx`, `U/game-hud.test.ts`, `tests/e2e/accessibility.spec.ts` | initial closed; keyboard open; Escape + focus restore; hidden descendants not tabbable; legend expansion/filter state survives close/open; visible focus origin for 新規 confirmation | `ui_gate && ui_e2e` (full) | Luna high / Sol low | S ~90 | S13 |
| S15 | Turn log disclosure, initially expanded | new `C/TurnLogDrawer.tsx` (arrival, `.game-panel__lottery` incl. `抽選: 移動中…`, `ItemEventNotice showEffects={false}`, suspension-ignored note, 地図なしで確認 `<details>`, `.game-panel__candidates`), `C/GamePanel.tsx`, `src/styles.css`, `U/game-hud.test.ts`, `U/item-controls.test.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/real-data.spec.ts` | mounted/hidden; route `<details>` state retained; canonical transcript texts; no live region added; menu/log mutual exclusion; focus restore; flows in the two specs that also open the menu reopen the log explicitly | `ui_gate && ui_e2e tests/e2e/accessibility.spec.ts tests/e2e/real-data.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/dice.spec.ts` | Luna high / Sol low | M ~260 | S14 |
| S16 | Migrate remaining log consumers | `tests/e2e/dice.spec.ts`, `tests/e2e/lottery.spec.ts`, `tests/e2e/items.spec.ts`, `tests/e2e/capital-region.spec.ts`, `tests/e2e/tokyo-suburban.spec.ts` | open the log before every lottery (12), arrival (`.item-arrival`), candidates, route view, full `panelStat("出目")` and gameplay `notices(page)` read — enumerated incl. after reload/resume (new panel session); `notices()` helper stays un-opening for ClearScreen reads (items.spec L281 unchanged); close the log before unrelated geometry; keep `not.toHaveAttribute("aria-live")` checks | `ui_gate && ui_e2e tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/tokyo-suburban.spec.ts` | Luna high / Sol low | S ~180 | S15 |
| S17 | Log closed by default; compact roll in HUD | `C/GamePanel.tsx`, `C/GameHud.tsx` (`roll-compact`), `C/TurnLogDrawer.tsx` (sole `data-stat="roll"`), `src/styles.css`, `U/game-hud.test.ts`, `tests/e2e/accessibility.spec.ts` | compact/full separation, full text unchanged; six HUD labels kept; desktop camera-resize test first proves opening log/route changes panel geometry, then camera centre unchanged; landscape 75% bound, scrollability when expanded, 4 menu actions in their visible destination | `ui_gate && ui_e2e` (full) | Luna high / Sol low | M ~190 | S16 |
| S18 | Shared presentational `ItemCard` + metadata | new `C/ItemCard.tsx` (`ItemCard`), `G/itemPresentation.ts` (short names, tone; existing strings unchanged), `src/styles.css`, `U/item-presentation.test.ts`; new `U/item-card.test.ts` | metadata first; all 11 kinds; passive certificate, after-roll timing, unavailable reasons, rapid/deadhead hints, draft-replacement note, selected/new markers, supplied action label; no nested buttons; no engine/store imports | `ui_gate` | Luna high / Sol low | S ~170 | S3, S17 |
| S19 | `ItemCardPopover` lifecycle | `C/ItemCard.tsx`, `src/styles.css`, `U/item-card.test.ts` | jsdom Popover stubs + stable harness: heading focus on open; Close/Escape restore; native light-dismiss (`toggle` event) syncs state; Tab-out closes without stealing focus; opener/item removal; resize/scroll listener cleanup; inline fallback when `showPopover` missing; pure placement (flip/clamp, short-viewport bottom sheet) tests; transitions disabled under reduced motion; no live region | `ui_gate` | Luna high / Sol low | M ~340 | S18 |
| S20 | Icon inventory visuals + tooltips (selection unchanged) | `C/InventoryPanel.tsx`, `src/styles.css`, `U/item-controls.test.ts`, `tests/e2e/items.spec.ts` | 3 slots, `.item-slot` + `<h3>`, current one-click selection and `aria-pressed` still as today in this commit, reasons/hints present in persistent descriptions; tooltip on hover/focus, hoverable, Escape dismiss without clearing draft, no tooltip-only info, reduced-motion no transition, 44×44 slots; empty slots keep 空き枠 as accessible text | `ui_gate && ui_e2e tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts` | Luna high / Sol low; Sonnet fallback | M ~250 | S18, S19 |
| S21 | Inspect-then-use interaction | `C/InventoryPanel.tsx`, `C/GamePanel.tsx`, `src/styles.css`, `U/item-card.test.ts`, `U/item-controls.test.ts`, `tests/e2e/items.spec.ts`; new `tests/e2e/ui-pop.spec.ts` | items.spec one-click uses → `useInventoryItem`; `aria-pressed` assertions → selected marker + staged summary + announcement (same values); opening a card leaves save and draft unchanged; passive/unusable cards inspectable with reason, action absent/disabled; phone-chromium `.tap()` open/use/close/inspect another; keyboard; light dismiss; Tab-out; Escape precedence; card → route/direction dialog → slot focus; direct pre-roll selection; removed item → dice focus; automatic adjust/discard closes card and suppresses restoration before `showModal()`; exactly one gameplay status | `ui_gate && ui_e2e` (full) | Luna high / Sol low | M ~370 | S19, S20 |
| S22 | Discard dialog reuses cards | `C/DiscardChoice.tsx`, `src/styles.css`, `U/item-controls.test.ts`, `tests/e2e/items.spec.ts` | keep the two discard specs' expectations; exactly 4 buttons, no nested buttons, no extra Close; Escape non-cancellable; announcement ownership; reload keeps the pending save; chosen item removed; dice focus restored; NEW marker on the pickup | `ui_gate && ui_e2e tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/full-game.spec.ts` | Luna high / Sol low | S ~160 | S18, S21 |
| S23 | Populated phone + short-landscape layouts | `src/styles.css`, `tests/e2e/layout.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/ui-pop.spec.ts` | fixture state: 3 occupied slots, selected draft, ≥ 2 long effect chips, save failure, long station/line names; 1280×800 HUD without scrolling; 320/390/400/412 px: closed HUD ≤ 45% viewport height, panel area / map area < 0.5 (as `layout.spec.ts` computes it), no horizontal page overflow, chips scroll and are reachable, targets ≥ 44×44 (both dimensions), visible keyboard focus; 667×375 and 640×400: ≤ 75% height, scrollable when expanded; zoom clearance; camera padding | `ui_gate && ui_e2e` (full) | Luna high / Sol low; Sonnet fallback | M ~250 | S22 |
| S24 | Phone attribution starts collapsed | `M/RailwayMap.tsx`, `M/attribution.ts` (pure DOM helper), `tests/e2e/layout.spec.ts`; new `U/map-ui.test.ts` | helper: expanded → collapses once; already collapsed → no-op; empty then populated; reattachment after rotation; never re-collapse after user opens; layout.spec opens based on actual state; exact credit/licence links reachable by keyboard; no private MapLibre APIs, no CSS-hidden credits | `ui_gate && ui_e2e tests/e2e/layout.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/real-data.spec.ts` | Luna high / Sol low | S ~150 | S11, S23 |
| S25 | Cross-feature regression + validation record | `tests/e2e/ui-pop.spec.ts`, `U/game-hud.test.ts`; new `.claude/docs/reviews/ui-pop-hud-inventory-validation.md` | combined menu/log/card transitions with a selected draft; failed-save visibility after toast expiry; populated phone interaction; render-count proof on mounted production composition that toast expiry does not re-render HUD/legend; record full-suite durations; WebKit result from CI or marked pending; forbidden-path audit (`git diff --exit-code "$UI_POP_BASE" -- <forbidden paths>`) | `ui_gate && ui_e2e` (full); CI all projects | Luna high / Sol low + lead | S ~130 | S1–S24 |

Full local E2E gates: S1, S8, S9, S10, S14, S17, S21, S23, S25 (nine). Measure the first run and budget ~9×.

## 5. File table (final branch)

| File | Change | Steps |
|------|--------|-------|
| `src/styles.css` | modify | S1, S3, S4, S7, S10, S12, S15, S17–S23 |
| `src/features/game/uiContrast.ts` | new | S1 |
| `src/features/game/lineBadge.ts` | new | S2 |
| `src/features/game/hudPresentation.ts` | new | S4 |
| `src/features/game/animation/useRevealSequence.ts` | new | S5 |
| `src/features/game/toastQueue.ts` | new | S6 |
| `src/features/game/itemPresentation.ts` | modify | S18 |
| `src/features/game/components/{LineBadge,ItemIcon}.tsx` | new | S3 |
| `src/features/game/components/{TargetProgressBar,EffectChips}.tsx` | new | S4 |
| `src/features/game/components/ToastHost.tsx` | new | S7 |
| `src/features/game/components/GameHud.tsx` | new | S10, S17 |
| `src/features/game/components/GameMenu.tsx` | new | S12 |
| `src/features/game/components/TurnLogDrawer.tsx` | new | S15, S17 |
| `src/features/game/components/ItemCard.tsx` | new | S18, S19 |
| `src/features/game/components/GamePanel.tsx` | modify | S8, S9, S10, S12, S14, S15, S17, S21 |
| `src/features/game/components/{InventoryPanel,ItemEventNotice,DiscardChoice}.tsx` | modify | S20/S21, S10, S22 |
| `src/app/GameApp.tsx` | modify | S8, S11 |
| `src/features/map/RailwayMap.tsx`, `src/features/map/attribution.ts` | modify | S11, S24 |
| `tests/unit/{ui-contrast,line-badge,item-icon,hud-presentation,reveal-sequence,toast,game-hud,item-card,map-ui}.test.ts` | new | S1–S7, S10, S18, S24 |
| `tests/unit/{item-controls,game-app-item-progress,capital-region-scaling,item-presentation}.test.ts` | modify | S3?, S8–S22 |
| `tests/e2e/support/app.ts` | modify | S9 |
| `tests/e2e/{accessibility,layout,dice,map-visual,capital-region,real-data,lottery,items,tokyo-suburban,resume,save-errors,full-game}.spec.ts` | modify | S8–S24 |
| `tests/e2e/ui-pop.spec.ts` | new | S21, S23, S25 |
| `.claude/docs/research/line-badge-codes.md` | new | S2 |
| `.claude/docs/reviews/ui-pop-hud-inventory-validation.md` | new | S25 |
| `.claude/docs/plans/ui-pop-hud-inventory-handoff.md` | modify | every step |

Unchanged by design: `GameLegend.tsx`, `RollAdjustment.tsx`, `ItemUseDialog.tsx`, `ClearScreen.tsx`, `TitleScreen.tsx`
(token restyle only through CSS).

## 6. Test plan summary

- Pure helpers (TDD first): contrast, badge catalogue, compact roll, progress segments, effect chips, reveal
  reducer, toast queue, popover placement, attribution helper.
- Components (jsdom, stable harness): icons, badges, progress, chips, toast host, HUD, menu, log, item card +
  popover, inventory, discard; one gameplay status region; ClearScreen notice unchanged.
- E2E: helpers migrated once (S9); menu consumers (S13) and log consumers (S16) migrated before the defaults
  close; new `ui-pop.spec.ts` for inventory/card/touch/keyboard/layout/combined flows; motion-enabled checks for
  skip, no replay on resume and no added delay; every existing expected gameplay value and saved-result
  equality retained.
- Accessibility: keyboard paths, focus restoration, Escape precedence, `aria-expanded`/`aria-controls`,
  progressbar values, no tooltip-only info, 44×44 targets, visible focus, phone `.tap()`, reduced motion
  (tokens to 0 ms, no tooltip/popover/toast transitions), 320–412 px and 667×375 / 640×400. No dark mode.

## 7. Dependencies

```text
S1 ─┬─ S2 → S3 → S4
    ├─ S5
    └─ S6 → S7 (needs S3)
S5 + S7 → S8                                   [P0 complete]
S8 → S9 → S10 → S11 → S12 → S13 → S14 → S15 → S16 → S17
S17 → S18 → S19 → S20 → S21 → S22 → S23 → S24 → S25
```

Transition rules: no badge/progress markup inside values before S9; menu/log not closed by default before their
consumers migrate (S13/S16); full roll not moved before every detailed-roll assertion opens the log; slot
activation not changed before the two-step helper and card lifecycle exist; toast timers never run while a
native modal obscures them; reveal completion or toast expiry never gates saving or the next turn.

## 8. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| E2E churn (66 `panelStat`, 12 lottery, inventory, menu/legend, landscape, camera) | Weakened or broken regression evidence | Helpers once (S9); consumer migration before defaults close; reviewer reads every removed assertion; verify_delegation `weakened_tests` |
| Wrong line codes pass coverage tests | Misleading badges | S2 Sol-high source doc + operator-symbol membership + ≥ 20 independent spot expectations + reviewer row check |
| Badge shape drifts toward official signs | Brand/trademark guardrail breach (DESIGN 2026-10-28, brand/README) | Shape spec in S3 prompt; reviewer checks; no rounded-square/ring classes |
| Camera padding / map coupling | Marker hidden under HUD on phone | `.game-panel` kept; `panelKey` rebinding; follow-camera specs at every map-touching step |
| Focus fights between popover, disclosures and native `<dialog>` | Keyboard users lose place | Explicit handoff table; S21 browser tests; suppression before `showModal()` |
| Reveal/toast lifecycle bugs (stale timers, replay on resume) | Duplicate or ghost feedback | Pure reducers, stable-identity harnesses, motion-enabled E2E |
| White on `#d9502f` = 4.09:1 | WCAG AA failure | `--color-brand-strong #b83f24` for normal text; contrast unit test |
| Legend moved behind menu vs NFR 「色だけに頼らず…凡例」 | Accessibility regression perception | Legend still one tap away; line style (solid/dashed) on map + progress bar text; spec [8.3-3] test keeps exact items |
| Full-suite runtime (9 gates) on WSL | Slow iteration | Targeted specs between gates; per-project CI rerun |
| Scope creep into P2 | Bigger diff, delays | Reveal stages empty in production; no animation work |

## 9. Codex validation

- Round 1 (`.claude/logs/codex/20261028T043558Z-uipop-validate.md`): **NEEDS_REVISION**. Deltas applied above:
  handoff in every step's done criteria; S1 contrast ownership + `ui-contrast.test.ts` + `:focus-visible`; S2
  independent expectations, operator-symbol membership, Sol-high mapping lane (no unapproved xhigh); stable
  identity harnesses (S5/S7/S19/S21/S25); obscured-state wiring through `onItemDialogOpenChange` and confirm/decision
  (S7–S8, `GamePanel.tsx` added to S8); visibility-asserting disclosure helpers (S9); exact dice text, subtitle
  and ClearScreen contracts from S10; 4 legend strings + 44px legend controls (S12–S14); enumerated `notices()`
  reads (S15–S16); reduced-motion, `.tap()` and modal handoff checks (S19–S21); populated fixtures (S23);
  durations/WebKit evidence (S25).
- Round 2 (`.claude/logs/codex/20261028T044343Z-uipop-validate2.md`): **PASS** — all 12 round-1 deltas ADDRESSED; no
  blocking issue. Non-blocking polish applied (full `tests/e2e/` paths, helper visible/hidden assertions, S23
  share wording). Optional tests adopted: pause a toast part-way through its 4,000 ms and switch modal causes
  (S7/S8); replace the session while `ItemUseDialog` is open — no inherited obscuration or stale toasts (S8);
  keep a card open while its item becomes unusable, activate → rejected without draft/save change (S21).
  Watch points: S2/S5/S19/S21 have the tightest size budgets — split if churn exceeds ~400 LOC / 8 files while
  keeping every intermediate commit green.

## 10. Open questions for the user (defaults let work proceed)

1. Multi-code groups (e.g. 東武伊勢崎線 TS/TI, 相鉄・JR直通線 JA/JS): show one source-verified representative code
   (default: Tokyo-side section, TS / JA) or both codes? Default: one code, name beside it.
2. Partial-coverage JR lines (宇都宮線・高崎線 JU, 成田線・総武本線 JO): show the code (default) or treat as uncoded?
3. Toast reading time: default 4,000 ms; save failure sticky until a successful save.
4. Which item outcomes toast: default all canonical pickup/use/cancel/discard/activation summaries (bounded to 3).
