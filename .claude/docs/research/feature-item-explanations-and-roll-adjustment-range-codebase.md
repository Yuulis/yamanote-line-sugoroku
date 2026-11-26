# Issue #61 affected-area scan: item explanations, roll-adjustment range, ruleset bump, preview map interaction

Scope: read-only scan at `develop` @ 8023570 (v0.20.0), 2026-11-25.
Legend: **[C]** = confirmed by reading the cited code; **[G]** = inference / guess, not executed.

Issue #61 body and comments were read via `gh issue view 61 --json body,comments`. The issue's
line references (ver.0.13.1) are mostly still accurate. The ones that drifted are corrected below.

---

## 0. Item model (context for idea proposals; adding kinds is OUT of scope)

### Where an item kind is defined [C]
| Concern | Location |
|---|---|
| Kind lists (7 beneficial, 4 harmful) | `src/types/network.ts:92-98` |
| Pools used by the drop draw | `src/features/game/gameConfig.ts:28-40` (`ITEM_POLICY.beneficialKinds/harmfulKinds`) |
| Pre-roll command union (route/direction/double/rapid/deadhead) | `src/types/network.ts:165-168` |
| Post-roll adjustment shape `{instanceId, delta: -1 \| 1}` | `src/types/network.ts:174-177` |
| Pre-roll validation and per-kind effect switch | `src/features/game/engine/itemTurnPreparation.ts:43-114` (switch at `:71`) |
| Harmful pickup application, certificate cancel | `src/features/game/engine/items.ts:150-203` |
| Drop draw (per-mille → harmful% → uniform kind) | `src/features/game/engine/items.ts:206-250` |
| Effect state helpers | `src/features/game/engine/itemEffects.ts` |
| Save schema per-kind tags (hard-coded list of pre-roll kinds) | `src/features/game/engine/saveSchema.ts:59-66` |
| Names, short names, effect text, timing text | `src/features/game/itemPresentation.ts:3-15`, `:50-71`, `:67-71` |
| Icons (`Record<ItemKind, …>`) | `src/features/game/components/ItemIcon.tsx:23` (roll-adjust entry) |
| Usability reasons in the view | `src/features/game/itemSession.ts:256-272` |
| Rules guide rows (computed from policy) | `src/features/game/rulesGuide.ts:170-190` |
| Simulation policy priorities | `tests/simulation/item-engine/policy.ts:8` |

### Effect model [C]
- `route-ticket`: choose the ride service at the current station; the direction is still drawn (`itemPresentation.ts:52`).
- `direction-ticket`: choose the direction on a non-target service (`itemSession.ts:265-266`).
- `roll-adjust`: post-roll ±1. It is the only post-roll item (`itemTurn.ts:44-56`).
- `double`: pips = face × 2 (`itemTurn.ts:63`).
- `rapid`: counts only stations served by ≥2 services (`itemMovement.ts:44-46,49-65`).
- `deadhead`: exclusive, relocates to the nearest target station, no die (`itemTurn.ts:23-26`, `itemOptions.ts:88-97`).
- `delay-certificate`: passive. It cancels the next harmful pickup and is consumed (`items.ts:159-168`).
- `delay`: due on turn+`delayTurns`(3), and the face becomes 1 (`items.ts:170-178`, `itemTurn.ts:43`).
- `suspension`: one arrival service is blocked for `suspensionTurns`(5) (`items.ts:186-202`).
- `detour`: the next landing excludes the current service (`itemTurn.ts:80`).
- `oversleep`: the next turn rides to the endpoint, or 6 hops on a loop (`itemMovement.ts:9,64-69`).
- Max 1 active item per turn. A pre-roll item, or a delay/oversleep turn, forbids adjustment (`itemTurn.ts:46-48`, `itemSession.ts:46-52`).

**[C] Cost driver for new kinds:** adding a kind lengthens the pool, so `kindDraw` changes for every seed
(`items.ts:224-227`). All pinned E2E item scenarios were found by seed search under the current config
(`tests/e2e/fixtures/itemScenarios.ts:5-18`). So are the committed fixture saves
(`tests/e2e/fixtures/regenerate-saves.ts`). A new kind therefore means re-searching seeds and regenerating fixtures.
Widening the adjust range on the *same* ticket draws no RNG and leaves every seed intact.

---

## 1. Explanations for harmful items, effect chips, and toasts (display only)

### Current state [C]
- Inventory tooltip and card mechanism: `src/features/game/components/InventoryPanel.tsx`.
  - Hover/focus tooltip state lives inline in the component (`:101-202`): pointer-type gating (`:264-276`), focus rules (`:293-303`), WCAG 1.4.13 pointer tracking (`:186-202`), Escape (`:155-167`).
  - Click toggles the card through `ItemCardPopover` (`:304-315`, `:53-83`).
  - None of this is extracted into a reusable hook. Reuse means extracting it.
- `ItemCardPopover` (native `popover="auto"` with an inline fallback) and `ItemCard` live in `src/features/game/components/ItemCard.tsx:94-273` and `:281-345`.
  - `ItemCard` accepts any `ItemKind`, harmful kinds included (`:302`).
  - It prints `itemTiming(kind)` (`:318`). For harmful kinds that returns "サイコロを振る前に使う" (`itemPresentation.ts:67-71`), which is **wrong**.
  - The rules guide uses `AUTOMATIC_ITEM_TIMING = "拾うと自動で発動"` instead (`rulesGuide.ts:61,182`).
- A second, simpler tap-to-explain primitive already exists: `SaveStatusPopover.tsx:42-197`.
  - It came from #68: native popover, a close button, Escape, light dismiss, focus return, and viewport placement `placeSaveStatus` (`:17-32`).
  - It is click-only, with no hover tooltip.
- Effect chips: `src/features/game/components/EffectChips.tsx:9-24`.
  - Each chip is a `<span title=…>` (`:14`) with visually-hidden full text (`:19`). It is not focusable or clickable.
  - Models come from `hudPresentation.ts:83-121`.
  - Labels: "遅延 あと{n}" (`:103`), "運休"+badge+"あと{n}" (`:111-112`), "寄り道" (`:115`), "寝過ごし" (`:118`).
  - Full text comes from `presentation.ts:146-157` (`activeItemEffectTexts`).
  - Rendered in `GameHud.tsx:145`, inside `<main class="game-panel">`.
- Turn-result chips also rely on `title` only (`TurnResultCard.tsx:45`). These chips show harmful pickups (#66). They are not in #61's stated scope, but they have the same touch gap.
- Toast copy: `toastQueue.ts:63-89`.
  - Harmful pickup reads "{名前}を拾ってしまった！" (`:81`). Suspension reads "{路線}が運休！" (`:80`).
  - `ToastInput` has a single `text` (`:14-25`).
  - `ToastHost.tsx:19` renders one `<span>`. The host is `aria-hidden` (`:12`), so the 2nd line is visual only; the live region and log already carry the full text.
  - Reading time is fixed at `TOAST_READING_MS = 4000` (`toastQueue.ts:10`). The toast is `min-height: 44px` and `display:flex` (`styles.css:92-98`).
- Reusable outcome sentences: `presentation.ts:137-141` (`itemEventTexts`, harmful-scheduled cases, with concrete turn numbers) and `presentation.ts:150-155`.
- Harmful effect text has production numbers baked in: `ITEM_DESCRIPTIONS.delay` says "3ターン後" and `ITEM_DESCRIPTIONS.suspension` says "5ターン" (`itemPresentation.ts:62-63`). Only the rules guide substitutes policy values (`rulesGuide.ts:170-176`).
- The first-play hint for the first harmful pickup already exists (#67): `firstPlayGuide.ts:445-449`.

### Test invariants that the change will hit [C]
- `tests/e2e/ui-pop.spec.ts:450-531` (phone, 320/390/400/412):
  - every visible `button` in `.game-panel` must be ≥44×44 (`:473-475,508`);
  - the panel must be ≤45% of the viewport height (`:497`);
  - the chip row is `nowrap` and horizontally scrollable, and must overflow at 320px (`:503-507`).
  - If chips become buttons they must be ≥44px tall on phones. Today a chip is padding 4px + a 20px icon (`styles.css:1109-1119`), about 30px **[G]**. That may push the panel past 45%.
- `tests/e2e/ui-pop.spec.ts:806-858` (tab order at 320/667/1280):
  - The expected sequence is inventory slots → "選択を解除" → `effects` (the scroller itself, only when it overflows and not on WebKit) → "ログ"/"メニュー".
  - Focusable chips replace the single "effects" stop with N stops. This test must be rewritten.
- `tests/e2e/hud-layout.spec.ts:115-116,146-148` covers chip presence at phone sizes. `tests/e2e/accessibility.spec.ts:592` checks the chip label text.
- Unit tests: `tests/unit/game-hud.test.ts`, `tests/unit/hud-presentation.test.ts`, `tests/unit/toast.test.ts`, `tests/unit/toast-notice.test.ts`, `tests/unit/item-card.test.ts`, and `tests/unit/item-controls.test.ts` (inventory tooltip behaviour).
- `tests/e2e/text-wrapping.spec.ts` covers toast and dialog wrapping.

---

## 2. Roll adjustment: ±2/±3 and results above 6

### Every place the delta or face range is fixed [C]
| Layer | Location | Current rule |
|---|---|---|
| Type | `src/types/network.ts:176` | `delta: -1 \| 1` |
| Legal options | `src/features/game/itemSession.ts:46-52` | `[-1, 1]` filtered to `1 ≤ raw+delta ≤ 6` |
| View type | `itemSession.ts:203` | `allowedDeltas: readonly (-1 \| 1)[]` |
| Engine | `src/features/game/engine/itemTurn.ts:50-52` | rejects delta ∉ {−1,+1}; `face < 1 \|\| face > 6` → `INVALID_ROLL` |
| Save replay | `src/features/game/engine/saveItemReplay.ts:91-95` | same 1..6 check → `INVALID_SAVE` |
| Save schema | `src/features/game/engine/saveSchema.ts:66` | `delta: oneOf(-1, 1)` |
| Save schema | `saveSchema.ts:92` | `effectiveFace: integer(1, 6)` (**a face of 7–9 would be rejected as a corrupt save**) |
| Save schema | `saveSchema.ts:92,107` | `rawRoll: integer(1, 6)` (stays valid; the die is unchanged) |
| Presentation helper | `src/features/game/itemPresentation.ts:111-113` | `adjustedPips(raw, delta: -1\|0\|1)` |
| Landing preview | `src/features/game/mapGuidance.ts:16-26,112-134` | `delta: -1\|0\|1`; iterates `[-1, 0, 1]` (`:120`) |
| Map callouts | `src/features/map/rollAdjustmentPreview.ts:108-113,144-147` | `delta: -1\|0\|1`; label "−1"/"+1" |
| Dialog | `src/features/game/components/RollAdjustment.tsx:23,54-58,66,73` | `AdjustmentChoice = -1\|0\|1`; ordering; hint "±1を選ぶと…"; label |
| HUD modifier and dice stamp | `src/features/game/hudPresentation.ts:63` | hard-coded "調整+1"/"調整-1" (feeds `DiceTumble.tsx:96-100` stamps) |
| Item text | `itemPresentation.ts:54` | "出目を見てから ±1 できる" (also used by the rules guide and the card) |
| Simulation policy | `tests/simulation/item-engine/policy.ts:95` | duplicates the `[-1,1]` + 1..6 rule |
| Frozen spike reference | `tests/simulation/item-spike/sim.ts:419` | ±1 with MIN/MAX_FACE (the frozen reference; do not edit) |
| Phone dialog CSS | `src/styles.css:2384-2392` | 3 segmented radios (`grid-auto-flow: column`), comment at `:2358-2359` says "three segmented native radios" |

### Lower and upper bounds [C]
- Lower bound: face ≥ 1 is enforced in three places (`itemTurn.ts:52`, `saveItemReplay.ts:95`, `itemSession.ts:51`).
- Movement itself needs only `pips ≥ 1` and a safe integer (`itemMovement.ts:267-269`). It has **no upper bound**: `double` already produces up to 12 pips (`itemTurn.ts:63`).
- So results above 6 need no movement change, only the guards listed above.

### Where the adjusted roll flows (consumers) [C]
- Engine record: `effectiveFace` and `adjustment` (`itemTurn.ts:113-116`). Pips are `face × (double?2:1)`, though double and adjust are mutually exclusive.
- Session last move: `roll: record.effectiveFace` (`itemSession.ts:82`).
- HUD compact roll "{pips}マス" plus a modifier (`hudPresentation.ts:50-57`). The modifier is hard-coded ±1 (`:63`).
- Dice cube shows only `rawRoll`, and `isDiceFace` guards 1..6 (`DiceTumble.tsx:6,55,69-72`; `TurnMomentHost.tsx:313`). This stays correct because the raw die never exceeds 6.
- Log / last-roll text: "{raw} → 調整後{face}（{pips}マス…）" (`presentation.ts:68-71`). This is generic.
- Turn result card: "出目調整 ±N" and "(出目a → b)" (`turnResultCard.ts:134-142`). This already uses `Math.abs(delta)`.
- History rows: "出目a→b" (`historyRows.ts:75-82,170-189`). Generic.
- Turn moments `rawRoll` (`animation/turnMoments.ts:88,220-222`) and compact roll text (`turnMomentPresentation.ts:350-358,559`). Generic.
- Map preview landings (`turnMomentPresentation.ts:211-216` → `mapGuidance.ts:112`) and `RailwayMap.tsx:769-777` keying by delta.
- Screen-reader prompt: `presentation.ts:189`. It is generic.
- Sim runner: `tests/simulation/item-engine/runner.ts:78-80` → `policy.ts:91-123`. Greedy scoring evaluates every delta in the list (`:114-122`), so it generalises once `deltas` widens.

### Simulation parity risk [C, consequence G]
`tests/simulation/item-engine/item-engine.test.ts:99` asserts, for the 5000-game run, that every policy row
matches the frozen round-3 spike distribution (`parityVerdict`). The spike is ±1 only (`item-spike/sim.ts:419`).
A wider product adjust range will very likely **[G]** break parity for the policies that use roll-adjust.
`npm run sim` would then need a deliberate re-baseline, or that assertion would need scoping. This decision must not be left to the implementer.

### Unit/E2E tests pinning ±1 [C]
- `tests/unit/engine-item-turn.test.ts:259-270` (1−1 and 6+1 rejected; delta 0 rejected).
- `tests/unit/game-session-items.test.ts:461`, `tests/unit/item-presentation.test.ts:18`, `tests/unit/hud-presentation.test.ts:76,111`.
- `tests/unit/game-app-turn-moments.test.ts:1270,1641,2220` and `tests/unit/turn-moment-components.test.ts:1114-1119` ("調整±1" stamps).
- `tests/unit/item-controls.test.ts:661-1174` (`allowedDeltas` fixtures), `tests/unit/turn-moment-hooks.test.ts`, `tests/unit/turn-moments.test.ts:36`, `tests/unit/roll-adjustment-preview.test.ts`, `tests/unit/engine-save-v4.test.ts:142`, `tests/unit/engine-save.test.ts:152`.
- E2E: `tests/e2e/items.spec.ts:46` (`ADJUSTMENT_DELTAS = [-1,0,1]`), `:410-425` (accessible names and the `Math.max(1, …)` clamp), and `:603`. Also `tests/e2e/turn-result-card.spec.ts:887`.

### Dialog / phone layout [C, impact G]
- On phones the dialog is a bottom strip, `max-height: 45%` (`styles.css:2360-2367`), with segmented radios in one row.
- Seven choices (−3..+3) at 320px leave about 35px per segment **[G]**. A wrap or a different control (for example a stepper) is needed.
- `assignLanes` callouts (`rollAdjustmentPreview.ts:166-189`) stack up to 7 rows and lanes, so the map gets crowded **[G]**.

---

## 3. Ruleset change handling

### Mechanics [C]
- `rulesetVersion: "tokyo-suburban-items-1"` is defined at `gameConfig.ts:45`.
- `sameConfig` compares `rulesetVersion` plus every `ItemPolicy` field (`engine/save.ts:340-372`). A mismatch raises `CONFIG_MISMATCH` (`:454-456`). That maps to the `rules` problem, "ルールが異なるセーブデータのため読み込めません。" (`store/persistence.ts:46-57`).
- **`ItemPolicy` has no adjust-range field** (`types/network.ts:126-136`).
  - Option A (constant in code): the range changes without touching the policy. Only a `rulesetVersion` bump would then reject old saves.
  - Option B (add a policy field, for example `rollAdjustMaxDelta`): `parseItemPolicy` is exact-keys (`engine/config.ts:19-29,97-122`). An old save without the key then fails **inside `parseState`** as `INVALID_SAVE` → "corrupt" → "セーブデータが壊れているため読み込めません。" (`persistence.ts:54`). That happens before `sameConfig` runs (`save.ts:445-456`), so the message would be misleading.
- Check order: `parseSaveVersion` (`save.ts:148-157`) → shape (`parseState`, `:199-223`, which includes `saveSchema` bounds) → dataVersion → `sameConfig` → replay.
  - With `SAVE_VERSION` 4→5 (`engine/game.ts:24`), every old save reports `unsupported-version`: "このバージョンでは読み込めない形式のセーブデータです。" (`persistence.ts:55`), regardless of the rules.
  - Without a version bump but with the `saveSchema` changes from §2, old saves stay shape-valid. The `rulesetVersion` bump then yields the `rules` message.
- The message is shown at `TitleScreen.tsx:87-95` with a "セーブデータを破棄" button.
- There are no other editions in the registry: `editions/registry.ts:13-33` has only tokyo-suburban.

### Things that hard-code the ruleset or save version [C]
- `tests/unit/edition-registry.test.ts:45`, `tests/e2e/items.spec.ts:209`.
- Committed fixture saves `tests/e2e/fixtures/tokyo-suburban-{before-clear,korakuen-before-transfer,oedo-before-lottery}-save.json`, plus `item-saves.provenance.json` and `tests/unit/fixtures/edition-save-compatibility.json`. All are regenerated by `tests/e2e/fixtures/regenerate-saves.ts`; the command is in `tests/e2e/fixtures/README.md:22-34`.
- Docs: `docs/manual/tokyo-suburban/implementation-status.md:7` (ruleset and "v4"); `data/README.md:16,95,400`.
- The saveVersion bump also touches the "v4" comments and test names (`saveSchema.ts:1`, `save.ts:161`, `tests/unit/engine-save-v4.test.ts`), plus the v2/v3 rejection tests **[G: likely need a v4-rejected case]**.

### Rule text that carries numbers [C]
- Title paragraphs: `editions/registry.ts:25-29` contain no item numbers, so nothing to change.
- Rules guide (#60): generated from config (`rulesGuide.ts:192-204`; pickup %, harmful %, capacity, durations). The 出目調整券 row text comes from `ITEM_DESCRIPTIONS["roll-adjust"].effect` (`itemPresentation.ts:54`). The controls text "Escape：出目調整の画面で「そのまま」を選ぶ" (`rulesGuide.ts:69`) is still valid.
- `docs/manual/tokyo-suburban/rules.md`:
  - `:14` "±1するか";
  - `:32` "出目を見てから±1します。1未満・6より大きい目にはできません。" (must change if results >6 are allowed);
  - `:18` 30%/30% (drop rates; out of scope, unchanged);
  - `:50` "セーブ形式はv4です" (change if SAVE_VERSION bumps).
- `docs/manual/development-roadmap/proposal.md:234` also says ±1. It is historical, so editing it is optional.
- In-dialog hint `RollAdjustment.tsx:66` "±1を選ぶと出目調整券を1枚使います。"

---

## 4. Preview map cannot be panned or zoomed during roll adjustment

### Root cause [C]
- The "arrows map" is the **main** `RailwayMap`, not a separate map.
  - During the decision, `GameApp.tsx:825` passes `adjustmentCandidates={turnDisplay?.adjustmentLandings}`.
  - `RailwayMap` then mounts speech-bubble callouts with leader tails (`rollAdjustmentPreview.ts:231-257`; the elements are `pointer-events:none` and `aria-hidden`, `:202-207`).
  - It also re-fits the camera (`RailwayMap.tsx:862-887`, `fitAdjustmentPreview` at `:376-440`).
- `RollAdjustment` opens with **`dialog.showModal()`** (`RollAdjustment.tsx:33-39`). A native modal dialog makes everything outside it inert, including the map canvas, the NavigationControl zoom buttons and the 全体/目標路線 buttons.
  - The CSS removes only the dim: `.item-adjustment::backdrop { background: transparent }`. Its own comment says "The native modal still isolates the page" (`styles.css:2314-2318`).
  - `RollAdjustment.tsx:15-16` documents the same inertness for the panel's skip button.
- MapLibre itself is interactive. `createMap` passes no `interactive:false` (`RailwayMap.tsx:537-552`); the only `interactive:false` in the map code is the offscreen route-image export (`routeImage.ts:364`).
- There is no camera lock tied to the phase. Following is suppressed while the preview is open (`RailwayMap.tsx:895`, `:906-909`), and the preview re-fits on every layout revision (`:850-852`, `:862-887`).

### How pan/zoom works elsewhere [C]
- MapLibre default gestures, plus `NavigationControl({showCompass:false})` when in game mode (`RailwayMap.tsx:924-933`), plus the overview buttons (`:953-966`).
- A user gesture is detected via `USER_CAMERA_EVENTS` and `isUserCameraEvent` (`camera.ts:241-259`, `RailwayMap.tsx:717-723`). It sets `userMovedRef` and calls `follow.onUserCameraMove`, which turns following off.
- The wrapper `<div inert={inert}>` (`RailwayMap.tsx:951`) is driven by `GameApp.tsx:831`, for the title or clear screens only.

### What a fix must handle [C facts; approach G]
- The dialog is rendered **inside `<main class="game-panel">`** (`GamePanel.tsx:740,810-817,822`). Making the panel inert while using a non-modal `dialog.show()` would make the dialog inert too. It must be moved out, or only its siblings made inert.
- `onCancel` (Escape → "そのまま") only fires for modal dialogs (`RollAdjustment.tsx:50-53`). A non-modal dialog needs its own keydown handling. `tests/e2e/accessibility.spec.ts:525-537` relies on Escape closing it.
- Shortcuts are guarded by `modalDialogOpen()`, which checks `document.querySelector("dialog[open]")` and so matches non-modal dialogs too (`GameMenu.tsx:34-36`). **[G]** That guard keeps working.
- After a user pans, any layout revision (resize, pill layout event) re-runs `fitAdjustmentPreview` and snaps the camera back (`RailwayMap.tsx:850-852,862-887`). A "user moved during preview" flag must suppress the refit.
- A gesture during preview calls `onUserCameraMove`, so following stays OFF after the decision. That is a product decision.
- Callout lanes already re-layout on `moveend` (`rollAdjustmentPreview.ts:250-253`).
- Tests: `tests/e2e/items.spec.ts:388-449` (`@layout`, preview fit and callouts across a style reload and resize) and `tests/unit/item-controls.test.ts` (dialog mount and `showModal` stubs at `:23`, `:959`). E2E `ui-pop.spec.ts:76`, `text-wrapping.spec.ts:527,623` and `ui-pop-turn-moments.spec.ts:51` locate the dialog by role and name.

---

## 5. Conventions and test layout [C]
- Unit tests: `tests/unit/*.test.ts` (vitest, jsdom); helpers in `tests/unit/helpers/`, fixtures in `tests/unit/fixtures/`.
- E2E: `tests/e2e/*.spec.ts`, helpers in `tests/e2e/support/{app,layout,turnMoments,turnResult,…}.ts`, seeded fixtures in `tests/e2e/fixtures/` (`itemScenarios.ts`, `seeds.ts`).
- The `phone-chromium` project runs only `@layout`-tagged tests (`playwright.config.ts:77-79`).
- Simulation: `npm run sim` → `vitest.simulation.config.ts` → `tests/simulation/**/*.test.ts`.
- Patterns:
  - Presentation is pure (`*Presentation.ts`), and components are thin.
  - Copy uses `PhraseText` for Japanese line breaking.
  - Popovers use native `popover="auto"` with an inline fallback (`ItemCard.tsx:96`, `SaveStatusPopover.tsx:50`).
  - Modal decisions use native `<dialog>.showModal()`.
  - Tap targets are ≥44px.
  - The shortcut guard is `modalDialogOpen()`.
