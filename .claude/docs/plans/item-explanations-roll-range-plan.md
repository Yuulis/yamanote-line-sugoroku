# Plan: item explanations, interactive adjustment map, ±2/±3 roll tickets (issue #61)

Date: 2026-11-25. Scan: `.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`.
Codex: design `.claude/logs/codex/20261125T020324Z-issue61-design.md`; validation `.claude/logs/codex/20261125T020955Z-issue61-validate.md` (section 9).
Base: `develop` @ 8023570 (v0.20.0).

## 1. Summary

Two PRs to `develop`, both referencing #61 (the release PR carries `Closes #61`).

- **PR1** `feature/item-explanations` (presentation only, saves v4 still load): every active
  effect chip becomes its own button with a hover tooltip (desktop) and a tap card (touch);
  harmful items get correct timing copy and policy-derived numbers; the harmful-pickup toast gets
  a consequence line; the roll-adjustment dialog becomes non-modal so the main map can be
  panned/zoomed, and the preview stops refitting after the player moves the camera.
- **PR2** `feature/roll-adjust-range` (ruleset change): two new kinds 出目調整券±2 / ±3 beside
  the existing ±1, each offering exactly −N and +N; adjusted face ≥ 1 with no upper bound
  (max 6+3 = 9); weighted beneficial pool that keeps the roll-adjust family at its current 1/7
  share; ruleset `tokyo-suburban-items-2` and save v5 (in-progress v4 saves are rejected with a
  rule-change message, no migration); fixtures regenerated; simulation re-baselined.

Out of scope (user decision 2026-11-25): drop probability (300‰, harmful 30% unchanged), any new
item kind other than the two tickets (ideas only, section 8), turn-result card chips (D10).

## 2. Decisions

### User (2026-11-25, final)

- U1 Drop probability out of scope. U2 No new kinds beyond ±2/±3; ideas listed in section 8.
- U3 Three separate kinds ±1/±2/±3; a ±N ticket offers −N and +N only; face ≥ 1 (illegal
  choices are not rendered), no upper bound; drop-weight split must keep 300‰ and 30%;
  seeded scenarios and fixture saves are regenerated.
- U4 Non-modal adjustment dialog; map pannable/zoomable; no auto-refit after a user camera move;
  keyboard access kept (focus, Escape = 「そのまま」, `accessibility.spec.ts` updated, not weakened).
- U5 Each effect chip is a button (hover tooltip desktop, tap card touch, ≥ 44px on phones);
  harmful non-inventory items get explanations; harmful-pickup toast gets a 2nd line.
- U6 PR split as in section 1. Old saves unreadable after PR2, no migration (decided 2026-11-10).

### Codex (Sol, low effort, read-only) — settled technical questions

| # | Decision | Rationale |
|---|---|---|
| D1 Drop split | New required `ItemPolicy.beneficialWeights: readonly number[]` aligned with `beneficialKinds`. Product: six other kinds weight 6, ±1/±2/±3 = 3/2/1 (total 42). Draw with the existing `drawWeightedIndex` (`engine/rng.ts:202`) for pools of ≥ 2, keep the singleton no-draw path. `parseItemPolicy` validates length, positive integers, total bound; `sameConfig` compares weights in order; replay keeps the membership check (`saveItemReplay.ts:36`) and seeded replay verifies the actual draw. **User-confirmable default (C1).** | Each non-adjust kind keeps exactly its 1/7 share; family share unchanged (6/42 = 1/7); the first two draws (300‰, 30%) are untouched. Uniform-over-9 would raise the family to 3/9 and lower every other kind. |
| D2 Range | Magnitude belongs to the kind: typed constant `ROLL_ADJUST_MAGNITUDE: Record<RollAdjustKind, 1 \| 2 \| 3>` (no policy field). Ids: keep `roll-adjust`, add `roll-adjust-2`, `roll-adjust-3`. Delta type `-3 \| -2 \| -1 \| 1 \| 2 \| 3`. The view enumerates distinct legal deltas, each mapped to the first owned instance of its kind (inventory order). Engine and replay validate kind ↔ \|delta\| and face ≥ 1. | `{instanceId, delta}` stays sufficient (\|delta\| identifies the kind); landings stay keyed by delta; a policy field would only duplicate the kind. |
| D3 Save rejection | Bump both: `rulesetVersion` → `tokyo-suburban-items-2`, `SAVE_VERSION` 4 → 5. At the version gate, a v4 envelope is classified by a field peek (no full parse): `dataVersion` ≠ current → the existing data-version problem (keeps `save-errors.spec.ts:137` "historical classic v4" → 「路線データが更新されたため…」 unchanged); otherwise a new problem with copy 「ゲームのルールが変わったため、このセーブデータは続きから遊べません。」; other unsupported versions keep 「このバージョンでは読み込めない形式のセーブデータです。」; malformed stays 「壊れている」. Storage key unchanged so the title still offers 「セーブデータを破棄」. | The version gate runs before the shape parse, so the new `beneficialWeights` key and widened schema can never surface as 「壊れている」. Matches the 2026-11-10 rule "ルールを変えるときは、セーブ形式も変える". |
| D4 Sim parity | Keep frozen round-3 parity and greedy-reference assertions on a **test-only legacy config** (today's policy snapshot: 7 kinds in original order, equal weights → `drawWeightedIndex` falls back to `drawIndex(7)`, same RNG states) with a legacy chooser cap of face ≤ 6. Run the product config separately with full legal choices; assert only structure (no errors, cap hits 0, determinism, save checks) and record its statistics. | Equal-weight fallback is verified in `rng.ts`; the cap is needed because product ±1 now allows 6→7, which the spike never did. Parity stays a real engine-correctness check. |
| D5 Explain primitive | No shared hook extraction. A small chip button in `EffectChips.tsx` with local hover/focus/Escape tooltip logic, reusing `ItemCardPopover` (native popover + inline fallback) for the tap card by passing the effect's content. `InventoryPanel` is not touched. | Smallest diff; `SaveStatusPopover` would still need hover support added; extraction would risk inventory regressions (`item-controls.test.ts`). |
| D6 Non-modal dialog | Render `RollAdjustment` as a sibling after `<main class="game-panel">` (inside the existing `GamePanel` fragment) and set `inert` on the panel while the decision is open; also inert/disable the phone result pill. `dialog.show()`, focus the heading, window-level Escape handler (works from map focus) that calls 「そのまま」 and consumes the event before the menu handler. Tab reaches the map canvas, zoom and 全体/目標路線 buttons in document order (the map precedes the panel in the DOM, so they may be reached after Tab wraps). Focus after the decision keeps the existing lifecycle (`GamePanel.tsx:625-641`: focus parked on the aria-disabled dice while the presentation runs, moved to the dice when rolling is available); no new opener capture. The menu's capture-phase `dialog[open]` guard stays; the adjustment handler consumes Escape before map/shortcut handlers regardless of registration order. React 19 supports the boolean `inert` prop. After a gesture during preview, following is restored when the decision closes the dialog (user decision C3, 2026-11-25; see section 7 and Step 1.5). | A non-modal dialog inside an inert `<main>` would itself be inert; the panel must stay non-operable as the modal guaranteed before. `modalDialogOpen()` (`GameMenu.tsx:34-36`) matches `dialog[open]`, so shortcut guards keep working. |
| D7 No refit | Per-decision `previewCameraOverrideRef` set by user-originated camera events (`isUserCameraEvent`) and explicitly by the 全体/目標路線 handlers (they may emit no user-originated event) while `previewOpen`; when set, skip `fitAdjustmentPreview` for layout revisions, candidate rerenders and style reloads. Callout re-layout and zero-padding cleanup stay independent of the flag. Reset when the preview closes, a new decision opens, or the map leaves game mode. | Candidates do not change within one decision; a style reload must not undo the player's view. |
| D8 Toast line 2 | `ToastInput.detail?: string`, rendered as a second `PhraseText` block in `ToastHost`. Copy derived from the scheduled event (actual turns/service), short. Keep `TOAST_READING_MS = 4000`. Host stays over the map (not the panel); verify the taller stack still clears attribution and map controls. | Live region and log already carry the full sentence; the toast is a visual cue. |
| D9 Chip size / Tab | Real ≥ 44×44 button on phones with the compact chip visual inside; one non-wrapping scrollable row; recover height from row gap/padding if the ≤ 45% panel check fails. Tab-order test: the single scroller stop is replaced by one stop per chip in visual order; check focus scrolls an off-screen chip into view and the 320px row still overflows. | Keeps every `ui-pop.spec.ts:450-531` invariant as-is. |
| D10 Turn-result chips | Leave as-is (`<span title>`). | Active HUD chips + toast cover the gap; result chips would add focus stops and height to another surface. |
| D11 Seven choices | Phone: native radios in a wrapping grid, max 4 columns × 2 rows, DOM order = visual order −3 −2 −1 そのまま / +1 +2 +3; ≤ 3 choices keep today's single row. Callout lanes kept; if crowded at 320px, prioritise the selected candidate's label and keep all landing markers. | One row fewer than a full-width そのまま row; existing 45% cap and 44px targets preserved. |
| D12 Harmful copy | In PR1: `itemTiming` returns 「拾うと自動で発動」 for harmful kinds; one pure policy-aware formatter replaces the hard-coded 「3ターン後」/「5ターン」 in `ITEM_DESCRIPTIONS` for the guide and cards; chip cards also show the live status line (e.g. 「遅延：12ターン目に発動（あと3ターン）」). | Fixes the wrong 「サイコロを振る前に使う」 on harmful cards and keeps numbers tied to policy. |

Additional finding (lead, verified in code): beneficial and harmful draws each consume one
`drawIndex` call regardless of the pool size (rejection sampling makes an extra uint32 draw
astronomically rare), so the item RNG stream advances in step after PR2. Harmful pickups and
movement in "no items used" replays are unchanged unless a changed beneficial kind alters
certificate cancellation or an overflow. Expect mostly beneficial-kind scenario pins to drift;
re-verify every scenario predicate anyway (section 6).

## 3. PR1 steps (`feature/item-explanations`)

Every step: `npm run typecheck`, the listed vitest files, `npm run build`, then the listed
Playwright specs. Firefox/WebKit run in PR CI only.

### Step 1.1 — Harmful item copy and policy-aware descriptions (visible: yes, card/guide text)

Files: `src/features/game/itemPresentation.ts` (`itemTiming` harmful → 「拾うと自動で発動」;
`itemEffectText(kind, policy)` substituting `delayTurns`/`suspensionTurns`),
`src/features/game/rulesGuide.ts` (use the formatter; drop the local `AUTOMATIC_ITEM_TIMING`
duplicate in favour of the shared constant), `src/features/game/components/ItemCard.tsx`
(accept an optional status line; harmful kinds render the automatic timing).
Tests: `tests/unit/item-presentation.test.ts` (timing for all 4 harmful kinds; formatter with a
non-default policy), `tests/unit/rules-guide.test.ts` (numbers follow policy),
`tests/unit/item-card.test.ts` (harmful card timing + status line).

```bash
npx vitest run tests/unit/item-presentation.test.ts tests/unit/rules-guide.test.ts tests/unit/item-card.test.ts
```

### Step 1.2 — Effect chips become explanation buttons (visible: yes)

Files: `src/features/game/components/EffectChips.tsx` (per-chip `<button>`: hover/focus tooltip
with WCAG 1.4.13 pointer tracking, touch suppresses hover, Escape closes; click/tap opens
`ItemCardPopover` with name, effect, timing, live status; tooltip closes when the card opens),
`src/features/game/hudPresentation.ts` (chip model gains the card content; accessible name
= current `text`), `src/features/game/components/GameHud.tsx` (pass policy-derived content),
`src/styles.css` (effect-chip block: button reset, ≥ 44px hit area on phones, focus ring).
Tests:
- `tests/unit/game-hud.test.ts`: chips render as buttons with the full text as name; click opens
  the card; Escape closes the tooltip.
- `tests/unit/hud-presentation.test.ts`: card content per kind (one `it.each` over 4 kinds).
- `tests/e2e/ui-pop.spec.ts`: rewrite the tab-order test (`:806-858`) to expect one stop per chip;
  the phone populated layout (`:450-531`) keeps all assertions; add one `@layout` test
  "effect chip explains on hover and tap" (desktop hover shows tooltip; phone tap opens card,
  light dismiss closes, focus returns).
- `tests/e2e/accessibility.spec.ts:592` (oversleep log test): its chip `title` assertion becomes
  the button's accessible name; `tests/e2e/hud-layout.spec.ts:115-148`: adjust selectors only if
  the role change breaks them (no assertion removed).
- The custom tooltip owns hover, so the native `title` is removed; the tooltip renders outside
  the horizontally scrolling row (not clipped) and stays open while the pointer crosses onto it.

```bash
npx vitest run tests/unit/game-hud.test.ts tests/unit/hud-presentation.test.ts tests/unit/item-controls.test.ts
npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --grep "populated HUD|tab order|effect chip"
npx playwright test tests/e2e/ui-pop.spec.ts tests/e2e/hud-layout.spec.ts --project=phone-chromium --grep @layout
npx playwright test tests/e2e/accessibility.spec.ts --project=desktop-chromium --grep "effect|chip"
```

### Step 1.3 — Harmful-pickup toast consequence line (visible: yes)

Files: `src/features/game/toastQueue.ts` (`ToastInput.detail?: string`; `itemEventToastDetail`
for `harmful-scheduled`; line 1 unchanged), `src/features/game/components/ToastHost.tsx`
(second `PhraseText` block), `src/styles.css` (toast text column; keep `min-height: 44px`).
Copy (default, C2): see section 7. `cancelled-by-certificate`, `effect-activated` and expiry
toasts stay single-line.
Tests: `tests/unit/toast.test.ts` (`it.each` over the 4 scheduled effects: detail text uses the
event's turns/service; non-harmful events have no detail), `tests/unit/toast-notice.test.ts`
(unchanged notices have no detail); `tests/e2e/ui-pop.spec.ts` "toasts clear attribution and map
controls…": make the measured toast a real two-line harmful toast so the clearance check covers
the taller geometry.

```bash
npx vitest run tests/unit/toast.test.ts tests/unit/toast-notice.test.ts
npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --grep "ordinary item toast|toasts clear attribution"
npx playwright test tests/e2e/ui-pop.spec.ts --project=phone-chromium --grep "toasts clear attribution"
```

### Step 1.4 — Non-modal adjustment dialog (visible: yes, map becomes operable)

Files: `src/features/game/components/RollAdjustment.tsx` (`show()` instead of `showModal()`;
window-level Escape → 「そのまま」, consumed before map/shortcut handlers; focus heading on open;
update the JSDoc on `onSkip` — the panel skip is now unreachable because of the panel `inert`,
not the modal), `src/features/game/components/GamePanel.tsx` (render the dialog after
`</main>` in the fragment; `inert` on `<main>` and the phone result pill while
`adjustmentDecision` is set; keep the dice-focus effect `:625-641` as the post-decision focus
path), `src/features/game/components/GameMenu.tsx` (only if its capture-phase guard and the
dialog handler conflict), `src/styles.css` (`.item-adjustment` explicit `position`/`z-index` now
that there is no top layer; remove the backdrop rule and its stale comment).
Tests:
- `tests/unit/item-controls.test.ts`, `tests/unit/game-app-turn-moments.test.ts`,
  `tests/unit/rules-entry-points.test.ts`: adjustment-specific `showModal` stubs/spies and
  synthetic `cancel` tests move to `show()` + window Escape (continues with `null`); panel has
  `inert` while open and not after. Modal stubs used by other dialogs stay.
- `tests/e2e/accessibility.spec.ts:523-537`: keep the assertion (first Escape closes the dialog,
  menu stays open); add: Tab (wrapping if needed) reaches the map zoom button; Escape pressed
  while a map control has focus still closes the dialog.
- `tests/e2e/items.spec.ts` "roll adjustment landing map preview": after the existing
  no-gesture style-reload and resize checks, click zoom-in and assert the zoom changed and the
  dice button is not operable.
- `tests/e2e/resume.spec.ts:182` scopes the adjust dialog to `gamePanel(page)`; it moves to a
  page-level locator (the only panel-scoped one; others already use `page`).

```bash
npx vitest run tests/unit/item-controls.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/rules-entry-points.test.ts
npx playwright test tests/e2e/accessibility.spec.ts --project=desktop-chromium --grep "adjust dialog"
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "roll adjustment landing map preview|pending reload retains"
npx playwright test tests/e2e/resume.spec.ts --project=desktop-chromium --grep "pending-discard|item pickup toast"
npx playwright test tests/e2e/items.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/text-wrapping.spec.ts --project=phone-chromium --grep "roll adjustment landing map preview|decision sheet fit|phone populated layout|dialog wrapping"
```

### Step 1.5 — No preview refit after a user camera move (visible: yes)

Files: `src/features/map/RailwayMap.tsx` (`previewCameraOverrideRef` per D7: set in the
user-camera-event handler and the 全体/目標路線 handlers while `previewOpen`; checked at the top of
the preview-fit effect `:862-887`; callout relayout and padding cleanup unaffected; reset when
`previewOpen` turns false or the mode leaves game). Following (C3, user 2026-11-25): record the
following state when the preview opens; a user camera move during the preview must not
permanently switch following OFF — when `previewOpen` turns false, restore the recorded state
so the camera follows the token's movement. Touch the follow state through its existing owner
(find where `onUserCameraMove` turns following off; do not add a second source of truth).
Tests: `tests/e2e/items.spec.ts` "roll adjustment landing map preview": after the zoom from 1.4,
trigger a second layout change (viewport resize) and assert the camera zoom/center stayed
(within tolerance) and callouts still render; then decide and assert following is ON again
(menu shows 「追尾: ON」 or the existing follow-state test hook); the existing no-gesture refit
assertions stay.

```bash
npx vitest run tests/unit/roll-adjustment-preview.test.ts
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "roll adjustment landing map preview"
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --grep "roll adjustment landing map preview"
```

### Step 1.6 — Design record and PR (visible: no)

Files: `.claude/docs/DESIGN.md` (one row via `/design-tracker`: chip buttons + card, toast
detail, non-modal dialog with inert panel, override flag, following restored after the decision),
`docs/manual/tokyo-suburban/implementation-status.md` (one line). PR → `develop`, body
references #61 and lists the default copy for user review.

```bash
npm test
python3 .claude/skills/_shared/verify_delegation.py --base develop --forbid-outside src --forbid-outside tests --forbid-outside .claude/docs --forbid-outside docs --label issue61-pr1
gh pr checks <pr>
```

## 4. PR2 steps (`feature/roll-adjust-range`, branched after PR1 merges)

### Step 2.1 — Simulation harness: legacy and product configs (visible: no)

Files: `tests/simulation/item-engine/{runner,policy,item-engine.test}.ts`,
`tests/unit/item-simulation-policy.test.ts`. Add a test-only `LEGACY_ITEM_CONFIG` (snapshot of
today's `ITEM_GAME_CONFIG` incl. rulesetVersion) and a chooser `maxFace` option (legacy 6,
product unbounded); thread the run config through game creation and every restore check.
Frozen parity + greedy-reference assertions run on the legacy config only; product rows assert
structure only. In this step both configs are identical, so all numbers stay green. The frozen
spike `tests/simulation/item-spike/` is not touched.

```bash
npx vitest run tests/unit/item-simulation-policy.test.ts
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
```

### Step 2.2 — Generalise the adjustment to magnitudes, ±1 only (visible: no; refactor)

No rule change: only `roll-adjust` exists, face stays 1..6 via a temporary
`MAX_ADJUSTED_FACE = 6` constant removed in 2.3; saves unchanged.
Files: `src/types/network.ts` (`RollAdjustDelta = -3|-2|-1|1|2|3`; `ItemRollAdjustment.delta`),
`src/features/game/itemRollAdjust.ts` (new, ~30 lines: `ROLL_ADJUST_MAGNITUDE`,
`isRollAdjustKind`, `legalAdjustments(rawRoll, inventory)` → `{delta, instanceId}[]` sorted −..+),
`src/features/game/engine/itemTurn.ts` and `saveItemReplay.ts` (validate kind ↔ |delta| and
bounds via the helper), `src/features/game/itemSession.ts` (`adjustmentOptions` and the decision
use the helper; decision carries `choices: {delta, instanceId}[]`),
`src/features/game/components/RollAdjustment.tsx` (render N choices; instance from the choice;
labels 「−N」/「+N」; hint copy from held tickets), `src/features/game/itemPresentation.ts`
(`adjustedPips` delta type), `src/features/game/hudPresentation.ts` (modifier `調整±N` from the
delta), `src/features/game/mapGuidance.ts`, `src/features/map/rollAdjustmentPreview.ts` and
`src/features/game/turnMomentPresentation.ts:215` (read `decision.choices` instead of
`allowedDeltas`; iterate the legal deltas, label from delta; the chosen instance flows through
landing prediction), `src/styles.css` (phone grid per D11),
`tests/simulation/item-engine/policy.ts` (`chooseAdjustment` uses `legalAdjustments` + `maxFace`).
The decision contract (`allowedDeltas` + `itemInstanceIds` → `choices`) migrates in this commit,
including the fixtures in `tests/unit/{turn-moments,turn-moment-hooks,item-controls}.test.ts`.
Save schema (±1) and the 1..6 effective-face range stay.
Tests: `tests/unit/item-roll-adjust.test.ts` (new: magnitude table, lower bound, first instance
per kind, ordering), existing ±1 suites stay green with fixture-shape updates only
(`engine-item-turn`, `game-session-items`, `item-controls`, `hud-presentation`,
`roll-adjustment-preview`, `item-presentation`, `turn-moments`, `turn-moment-hooks`);
`tests/unit/item-controls.test.ts`: one render with a fabricated 7-choice decision (order,
names 「−3」…「+3」, instance mapping). The real 7-choice sheet is measured in the phone E2E (2.3).

```bash
npx vitest run tests/unit/item-roll-adjust.test.ts tests/unit/engine-item-turn.test.ts tests/unit/game-session-items.test.ts tests/unit/item-controls.test.ts tests/unit/hud-presentation.test.ts tests/unit/roll-adjustment-preview.test.ts tests/unit/item-presentation.test.ts tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/item-simulation-policy.test.ts
npm test
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "adjust|map failure keeps"
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --grep "decision sheet fit|roll adjustment landing map preview"
```

### Step 2.3 — Ruleset switch: ±2/±3 kinds, no upper bound, save v5 (visible: yes; one commit)

Rules and persistence: `src/types/network.ts` (kinds `roll-adjust-2`, `roll-adjust-3` appended
to `BENEFICIAL_ITEM_KINDS`; `ItemPolicy.beneficialWeights`), `src/features/game/gameConfig.ts`
(weights per D1, `rulesetVersion: "tokyo-suburban-items-2"`), `src/features/game/engine/config.ts`
(parse weights), `engine/items.ts` (`drawWeightedIndex`), `engine/save.ts` (`sameConfig`
weights; retired-version classification), `engine/game.ts` (`SAVE_VERSION = 5`),
`engine/saveSchema.ts` (delta `oneOf(±1,±2,±3)`, `effectiveFace: integer(1)`; pre-roll tag list
unchanged), `engine/errors.ts` (only if a new error code is needed),
`store/persistence.ts` (new problem + copy per D3), the config deep-copy helper in
`engine/config.ts` (copy `beneficialWeights` like `beneficialKinds`), remove `MAX_ADJUSTED_FACE`.
Weights are required, so every custom policy in tests gets matching weights in this commit:
the 2.1 legacy snapshot (seven explicit equal weights) and singleton/override fixtures in
`tests/unit/{engine-items,engine-save-v4,game-session-items,game-app-save-attempt,save-notice,rules-guide,engine-policy-config,engine-save-v3}.test.ts`.
Kind-sensitive paths (all via `isRollAdjustKind`): `ROLL_ADJUST_MAGNITUDE` gains ±2/±3;
`itemTiming`; `itemSession.ts` usability branches (usable iff that kind has a legal choice;
duplicates stay inspectable); `turnResultCard.ts` (consumed ticket name + 「出目調整 ±N」 chip for
every magnitude); `historyRows.ts` adjustment wording; E2E helpers/specs that match
`roll-adjust` (`tests/e2e/support/turnResult.ts`, `resume`, `turn-result-card`,
`ui-pop-turn-moments`, `hud-progress-feedback`, `first-play-hints`). Pre-roll tag list and raw
die 1..6 unchanged; only the effective-face schema widens.
Simulation: `tests/simulation/item-engine/policy.ts` `KEEP_PRIORITY` gains the new kinds and
`choosePreRoll` routes them through the roll-adjust guard (otherwise a random ±2/±3 pick throws
`Unexpected usable kind`).
UI: `itemPresentation.ts` (names/short names/effects per C4), `components/ItemIcon.tsx`
(same icon + small 「±2」/「±3」 badge), `rulesGuide.ts` (rows come from the policy; verify),
`RollAdjustment.tsx` hint copy.
Fixtures and docs: re-search `tests/e2e/fixtures/itemScenarios.ts` (all 11 pins, same
predicates); add `adjust-wide`: first ascending seed (bound documented in the header) whose
pending roll is actionable, holds `roll-adjust-3` (preferring all three kinds) with raw roll
≥ 4, and whose +3 landing's travelled steps equal the face (no terminal/goal truncation). If no
seed holds all three kinds within the bound, the 7-choice phone check uses a deterministic legal
pending-save fixture built by the same replay (jsdom cannot measure targets or sheet height).
Re-verify `tests/e2e/fixtures/seeds.ts` pins via `tests/unit/e2e-fixture-seeds.test.ts` and
change only drifted ones; regenerate saves with the command in `tests/e2e/fixtures/README.md`
(3 saves, provenance, `tests/unit/fixtures/edition-save-compatibility.json`) and refresh that
README's dates/turns; historical fixtures keep their bytes and expected rejection (D3 peek keeps
the classic v4 data-version message). Current-format assertions move to v5 in
`tests/unit/{engine-game,engine-save-v2,engine-save-v3,engine-save-v4}.test.ts`; exact ±1
names/labels asserted by existing tests follow C4. Docs: `docs/manual/tokyo-suburban/rules.md`
(`:14`, `:32` → lower bound only, `:50` v5), `docs/manual/tokyo-suburban/implementation-status.md:7`,
`data/README.md:16,95,400`.
Tests (smallest set): `engine-items.test.ts` (weighted intervals: one seed per kind, singleton
pool no draw, legacy equal weights reproduce `drawIndex(7)`), `engine-item-turn.test.ts`
(6+3 = 9 accepted, 1−1 rejected, wrong kind for |delta| rejected), `engine-save.test.ts` /
`engine-save-v4.test.ts` → v5 round-trip of a pending ±3 roll and a completed 9-face record;
a v4 save yields the rule-change problem, a v6/unknown the generic one (`persistence.test.ts`),
`engine-policy-config.test.ts` (weights length/positivity), `edition-registry.test.ts:45`,
`items.spec.ts:209` ruleset string; `tests/e2e/items.spec.ts`: `ADJUSTMENT_DELTAS` and the
`Math.max(1, …)` clamp replaced by the decision's legal deltas (incl. the parameterised
"map failure keeps the … decision usable through text" case), one desktop test on
`adjust-wide` choosing +3 to a face > 6 (landing = travelled steps, HUD 「{pips}マス」, log
text), phone `@layout` "decision sheet fit" on `adjust-wide` (all choices visible, ≥ 44px,
sheet ≤ 45%); `tests/e2e/save-errors.spec.ts`: extend the existing unsupported-format coverage
with one items-1 v4 case showing the new copy, reusing its reload/discard assertions.

```bash
npx vitest run tests/unit/engine-items.test.ts tests/unit/engine-item-turn.test.ts tests/unit/engine-save.test.ts tests/unit/engine-save-v2.test.ts tests/unit/engine-save-v3.test.ts tests/unit/engine-save-v4.test.ts tests/unit/engine-game.test.ts tests/unit/persistence.test.ts tests/unit/engine-policy-config.test.ts tests/unit/edition-registry.test.ts tests/unit/game-session-items.test.ts tests/unit/item-controls.test.ts tests/unit/item-presentation.test.ts tests/unit/rules-guide.test.ts tests/unit/e2e-fixture-seeds.test.ts tests/unit/real-data-e2e-scenarios.test.ts tests/unit/item-simulation-policy.test.ts
npm test
npm run build
npx playwright test tests/e2e/items.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium --grep "adjust|decision sheet|map failure keeps|unsupported format|historical classic v4"
npx playwright test tests/e2e/turn-result-card.spec.ts tests/e2e/resume.spec.ts --project=desktop-chromium --grep "adjust"
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --grep "decision sheet fit|roll adjustment landing map preview"
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
```

### Step 2.4 — Product baseline, design record, PR (visible: no)

Files: `.claude/docs/research/item-system-simulation.md` (dated section: legacy vs product,
greedy/random median/p90/p99/max, cap hits, ticket-use counts, same 5,000 seeds),
`.claude/docs/DESIGN.md` (rows: three ticket kinds, weights 6×6+3/2/1, items-2 + v5 with the
rule-change copy, legacy-parity sim). PR → `develop` referencing #61.

```bash
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=5000 npm run sim -- tests/simulation/item-engine
python3 .claude/skills/_shared/verify_delegation.py --base develop --forbid-outside src --forbid-outside tests --forbid-outside .claude/docs --forbid-outside docs --forbid-outside data --label issue61-pr2
gh pr checks <pr>
```

## 5. Test strategy

- One guard per behaviour; extend existing `it.each` / specs before adding files. New files:
  `tests/unit/item-roll-adjust.test.ts` only.
- Unit (vitest/jsdom) carries logic: copy formatters, chip card content, toast detail, legal
  adjustments, weighted draw, save gate. E2E carries what jsdom cannot: hover vs tap, ≥ 44px and
  ≤ 45% on phones, Tab order, map operability and no-refit, 7-choice sheet, rule-change message.
- Lead re-runs typecheck + `npm test` + build + diff check + phone `@layout`; desktop E2E beyond
  the listed greps is left to branch/PR CI. Never the full local E2E suite.
- Not weakened: `ui-pop.spec.ts` phone invariants, `accessibility.spec.ts` Escape priority,
  frozen parity (moved to the legacy config, not removed), historical fixture rejections.

| Step | New / changed tests |
|---|---|
| 1.1 | item-presentation (timing, formatter), rules-guide numbers, item-card harmful |
| 1.2 | game-hud chip button, hud-presentation card content; ui-pop tab-order rewrite + 1 new `@layout` chip test |
| 1.3 | toast `it.each` detail (4 effects) |
| 1.4 | item-controls show/Escape/inert; a11y Tab-to-map + Escape-from-map; items preview zoom |
| 1.5 | items preview: no refit after gesture + resize |
| 2.1 | sim policy unit (maxFace); sim harness |
| 2.2 | item-roll-adjust (new); item-controls 7-choice render; decision-contract fixture updates |
| 2.3 | weighted draw, 9-face, wrong-kind, v5 round-trip, v4 message; items `adjust-wide` desktop + phone; save-errors "rules changed" |
| 2.4 | none (5,000-game run recorded) |

## 6. Risks

- **Non-modal dialog loses top-layer guarantees** (stacking, focus containment): explicit
  z-index, inert panel + pill, window Escape; checked in narrow portrait and short landscape
  (`ui-pop` short-landscape test). The #67 hint card withdraws on the presented phase in
  `GameApp.tsx`, not on modal state (Codex checked), so it is unaffected.
- **Escape ordering** with an open menu and map focus: covered by the kept a11y assertion plus
  the new from-map case.
- **Phone panel height** with 44px chip buttons: D9 recovers from gaps; if the ≤ 45% check still
  fails at 320×568, stop and report instead of changing the threshold.
- **Seed drift (PR2)** beyond pickup names via certificate/overflow: validate scenario predicates
  and provenance; never update expected strings blindly from failing tests. `adjust-wide` search
  may need many seeds; document the bound; if no seed holds all three tickets within it, use a
  deterministic legal pending-save fixture for the 7-choice phone check (jsdom cannot measure it).
- **Legacy parity** depends on pool order, equal-weight fallback and the face ≤ 6 chooser cap.
- **Balance** (game length) shifts with ±2/±3 and faces up to 9; measured in 2.4 only after the
  ruleset ships in the PR; if p99 moves sharply the weight split (C1) is the knob, and changing
  it later needs another ruleset bump.
- **Blast radius PR2**: every in-progress save stops loading (accepted, U6); the clear-replay
  store holds no save version (checked), so clear images/replays are unaffected.

## 7. Defaults for the user to confirm

- C1 Drop split: weights 6 for each non-adjust beneficial kind, ±1/±2/±3 = 3/2/1 (per beneficial
  drop: each other kind 1/7 ≈ 14.3%, ±1 1/14 ≈ 7.1%, ±2 1/21 ≈ 4.8%, ±3 1/42 ≈ 2.4%).
- C2 Toast 2nd lines (line 1 unchanged):
  - 遅延: 「{n}ターン後の出目が1になります」
  - 運休 (line 1 「{路線}が運休！」): 「あと{n}ターン、この路線に乗れません」
  - 寄り道: 「次に乗り換えられる駅で、別の路線に移ります」
  - 寝過ごし: 「次のターンは終点まで進みます（環状線は6駅）」
  - {n} = the event's `dueTurn` / `expiresTurn` minus the recorded move turn. The toast omits the
    edge rules (suspension ignored when every candidate is suspended; oversleep wins over a
    coinciding delay); the card and rules guide keep them.
- C3 **Changed by the user (2026-11-25):** a camera move during the adjustment preview must not
  leave following OFF. When the decision is made (either choice or 「そのまま」) and the dialog
  closes, following is restored to the state it had when the dialog opened (ON in the default
  case), so the camera follows the token as it starts moving. Manual moves outside the
  adjustment dialog keep today's behaviour (following OFF until the menu toggle).
- Confirmed by the user (2026-11-25): C1 (3:2:1) and C2 (copy as listed). C4 and C5 are taken as
  stated unless the user objects.
- C4 Names: 「出目調整券±1」「出目調整券±2」「出目調整券±3」; short names 「調整±1」「調整±2」「調整±3」;
  effect 「出目を見てから、出目にNを足すか引くかできる（1より小さくはできない）」.
- C5 Old-save copy: 「ゲームのルールが変わったため、このセーブデータは続きから遊べません。」

## 8. 新アイテム案（アイデアのみ・未実装）

共通コスト: 種類を足すと抽選プールが変わり、シード固定のシナリオとフィクスチャの再生成、ルール版とセーブ形式の更新が要る（PR2 と同じ手順）。

1. **各停券**（有利）: サイコロを振らず、次の駅まで必ず1駅だけ進む。止まりたい駅の手前で使う「各駅停車」のイメージ。コスト小〜中（倍速券と同じ振る前の券。ただし振らない回の乱数とリプレイの扱いを回送列車にならって決める必要がある）。
2. **振替乗車票**（有利）: 運休中の路線を1つ選び、その運休をすぐ解除する。運休時の振替輸送そのもので、運休の救済策になる。コスト中（対象路線を選ぶ振る前の券。運休中だけ使える判定と、リプレイでの検証が要る）。
3. **乗換案内**（有利）: 次に着いた駅の路線抽選で、山手線の当たりやすさを上げる（重み2倍）。乗換アプリで山手線を探す感覚。コスト中（着駅の抽選重みを変える新しい種類の効果。シミュレーションで偏りの確認が要る）。
4. **振り直し券**（有利）: 出目を見てから、サイコロをもう一度だけ振り直す。出目調整券と同じ「見てから使う」券で、操作の流れを流用できる。コスト中（振り直し分の乱数をセーブとリプレイで再現する必要がある）。
5. **混雑**（不利）: 次のターンの出目が半分（切り上げ）になる。満員電車でなかなか進めない様子。コスト中（寝過ごしに似た「次のターンだけ」の効果。発動・終了の時期と、遅延・寝過ごし・倍速券などとの優先順位を決め、効果の状態とセーブ形式に1項目足す）。

## 9. Codex validation verdict

- Design consult (Sol, low, read-only): `.claude/logs/codex/20261125T020324Z-issue61-design.md`
  → adopted as D1–D12. Author deviations accepted by the validation pass: PR1 split into 6
  steps; PR2 refactor step 2.2 before the atomic switch 2.3; `adjust-wide` scenario.
- Validation consult (Sol, low, read-only): `.claude/logs/codex/20261125T020955Z-issue61-validate.md`
  → **FAIL with 8 must-fixes, all applied in this revision**:
  1. D6/1.4 keep the existing dice-focus lifecycle instead of a new opener capture; Escape
     handler vs the menu's capture-phase guard.
  2. 1.4/1.5 dialog test migration in the API-changing step (`rules-entry-points.test.ts`
     added); 1.5 checks a second layout change after the gesture.
  3. 2.2 migrates the decision contract (`turnMomentPresentation.ts:215` + 3 fixture suites).
  4. 2.3 weights required → every custom policy fixture, legacy snapshot, config deep copy,
     sim `KEEP_PRIORITY`/`choosePreRoll` updated atomically.
  5. 2.3 all kind-sensitive paths (`itemTiming`, usability, `turnResultCard`, `historyRows`,
     E2E helpers).
  6. D3 v4 classification keeps the historical classic v4 data-version message; v5 assertions
     in `engine-game`/`engine-save-v2..v4`.
  7. `adjust-wide` predicate requires an actionable decision and untruncated +3 landing;
     fallback is a legal pending-save fixture, not jsdom.
  8. Acceptance greps fixed (`dialog wrapping`, oversleep chip name, `map failure keeps`,
     two-line toast in the clearance test).
  Should-fixes applied: D7 reset/independence, tooltip outside the scroller + no native
  `title`, C2/C4 copy precision, 新アイテム案 costs, #67 hint risk. Cuts applied: phone-grid CSS
  regex dropped; v4 browser case folded into the existing unsupported-format test.
- Lead additions after validation: `resume.spec.ts:182` panel-scoped dialog locator (only one).
- No unresolved disagreement. A third consult was not run (cap 2); the fixes are mechanical
  corrections of the plan text, verified against the source by the lead where cited.

## 10. LOC estimate (hand-edited; regenerated fixture bytes excluded)

| PR | src | tests | docs |
|---|---|---|---|
| PR1 (1.1–1.6) | 190–300 | 130–200 | 10–20 |
| PR2 (2.1–2.4) | 230–340 | 230–330 | 40–60 |

## 11. Handoff status

Approved by the user 2026-11-25. Pacing: stop after every step (verify → commit → push → CI →
handoff update → report). Implementation: Claude subagents (Sonnet implements, Opus reviews).
PR1 branch `feature/item-explanations` from `develop`; PR2 branches from `develop` after PR1 merges.

| Step | Status | Commit | Verification |
|---|---|---|---|
| 1.1–1.6 | not started | — | — |
| 2.1–2.4 | not started | — | — |
