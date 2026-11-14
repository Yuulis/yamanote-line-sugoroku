# Issue #66 turn-result card (「前のターン」) — plan

Status: Codex validated **PASS after one revision** (first verdict NEEDS_REVISION: R2 pre-roll activation and the R1 auto-roll trajectory were wrong; fixed in the recipe table and "Validation amendments"). **Revision 2 (user 2026-11-12, phone slimming):** the phone one-line strip became a small content-width pill with reduced content and a fixed overview clearance, and the phone HUD drops its 出目 stat; see "Revision 2 — phone slimming" (it overrides any older strip/narrowing wording). Re-validated by Codex (Sol low, read-only): **PASS**, `.claude/logs/codex/20261112T075926Z-turn-result-card-revalidate2.md`; its non-blocking suggestions are folded into Steps 7, 8 and 12. **Revision 3 (user 2026-11-12, roll wording):** the desktop/tablet line 1 carries no modifier marks (「出目N → 駅」 only); modifiers are communicated by item/effect chips; see "Revision 3 — roll wording" (it overrides any older modifier-suffix wording). **Revision 4 (user 2026-11-14, desktop budget):** heading inline with line 1, #65 reserve 0px (named slot only), card font fix; see "Revision 4 — desktop budget" (it overrides the older 48px reserve and card-height wording). **Approved by the user 2026-11-12.** Branch: `feature/turn-result-card` from develop 4174377. Brief: `.claude/docs/research/feature-turn-result-card-brief.md`. Scan: `.claude/docs/research/feature-turn-result-card-codebase.md`. Codex (Sol, low effort, read-only): scope `.claude/logs/codex/20261112T072202Z-turn-result-card-scope.md`, architecture `.claude/logs/codex/20261112T072821Z-turn-result-card-arch.md`, plan `.claude/logs/codex/20261112T073147Z-turn-result-card-plan.md`, validation `.claude/logs/codex/20261112T073626Z-turn-result-card-validate.md` (NEEDS_REVISION) → `.claude/logs/codex/20261112T074010Z-turn-result-card-revalidate.md` (PASS). Pacing: stop after every step. Implementer: Codex Luna xhigh; Sol low review; lead verifies. Prompts: `.claude/docs/plans/turn-result-card-prompts.md`. Handoff: `.claude/docs/plans/turn-result-card-handoff.md`.

## Scope Assessment

MODERATE (Codex scope consult). Presentation-only: every card field is derivable from `LastMove` / `ItemTurnRecord` / `movementHistory`; no engine, RNG, save-format, `src/types/network.ts`, public-data or dependency change. 13 steps, each ≤ ~150 handwritten changed LOC; planned total 1,030–1,530 LOC incl. tests after Revision 2 (was 1,100–1,580; still above the scope consult's 750–1,200 because the fixed decisions add measured pill geometry with change notifications, repeated log reveal, classic-animation protection, and new companion test files instead of extending existing ones). Expected footprint ≈ 17 paths (10 src, 7 tests/support). Existing test files stay byte-identical.

Out of scope: 10-turn history (「もっと見る」), #65 features (only its desktop space is reserved), #71 sheet, #68 wording, follow-camera padding changes (unless measurement proves a need — then a separate bounded step).

## Decisions

| Topic | Decision | Source |
|---|---|---|
| Desktop card | 2 lines + chips in a new optional `GameHud` slot after `.game-panel__actions`, before inventory. Heading 「前のターン（Nターン目）」; line 1 「出目3 → 半蔵門」 (「回送 → X」) with **no modifier marks** (Revision 3); line 2 「抽選: <service>・<direction>」 + `LineBadge` when `serviceDrawRequired` or `directionDrawRequired`, else 「乗車: …」; chips +N区間 (N>0), 乗換, picked item, triggered effect. | User 2026-11-12 |
| Desktop space | Keep `height: calc(100% - 120px)`; card ≈ 90–110px; a desktop-only 48px reserve slot (named constant/comment) for #65. Existing `ui-pop` no-scroll at 1280x800 passes unmodified. | User 2026-11-12; Codex |
| Phone pill (≤600px wide) | Small **content-width** pill (`.turn-result__pill`, a button, ≥44px target) at the bottom-left of the map just above the panel; fixed sibling of `.game-panel` on `--layer-panel`. Content = compact summary only: face, landing station, `+N区間` only when N ≥ 1 (「3 → 半蔵門 +1区間」). No ride/lottery line, 乗換 chip or item/effect chips: those stay in the log and on desktop, and the HUD already shows the current ride and direction. Accessible name 「<heading>：<compact text>。ターンのログを開く」; tap opens the log, scrolls the panel to reveal it, focuses it; Escape returns focus. Uses no panel budget (252 / 255.6px at 320x568). | User 2026-11-12 (Revision 2) |
| Phone HUD 出目 | At ≤600px wide the HUD's 出目 stat (`data-stat="roll-compact"`, its `<dt>` and `<dd>`) is `display:none` by CSS only (`:has()` selector like the existing ride/direction rules); DOM unchanged. Freed grid cells (row 3, columns 3–4) stay empty; fixed rows `18px 34px 34px 18px` keep the stats at 104px and the panel at 252px. Desktop/tablet and short landscape keep 出目. Other phone trimming is #71. | User 2026-11-12 (Revision 2) |
| Pill during moments | Stays visible; `TurnMomentHost` unions the pill rect with the panel rect before placement; `RailwayMap` registers `.turn-result__pill` as preview obstruction + layout target. | User 2026-11-12; Codex |
| Pill position | Measured: pill bottom = panel top − gap (`bottomPx = documentElement.clientHeight − panelRect.top + gapPx`), pill left = measured panel left. Never a 45% literal; invalid/zero panel geometry → hidden. | User 2026-11-12; Codex |
| Pill width | Content width, capped by CSS so its right edge always stays left of the overview column: right inset = 84px (the toast column rule, `styles.css:182-196`: 10px margin + ~70px controls + 4px gap) + 8px gutter + `env(safe-area-inset-right)`. No overview measurement, no collision test, no narrow/full-width modes. Long station names truncate with an ellipsis **inside the station segment**; face and `+N区間` stay visible. | User 2026-11-12 (Revision 2) |
| Short landscape | ≥601px wide, ≤500px tall: one non-interactive line in a new named grid row under the actions inside the panel, with the **same compact content as the phone pill** (lead assumption, Revision 2) and a visually-hidden heading prefix. | User 2026-11-12; lead assumption |
| Responsive variants | Exactly one active variant; inactive ones `display:none` (out of layout and a11y tree). | Codex |
| Turn 0 / clear | `turnResult === null` → nothing rendered; no pill with ClearScreen. | User 2026-11-12 |
| Publication | Additive `TurnMomentDisplay.turnResult`. Card move = `lotteryPublished ? current : previousLastMove`. Item chips only from the selected move's own `itemRecord.itemEvents`, and only when that turn is published (previous turn: yes; current attempt: `resultPublished`). Pickup stage = new heading, no item chips. No new timers/boundaries. | User 2026-11-12; Codex |
| Classic fallback | While a classic animation is unpublished, rebuild the previous move with `lastMoveOf()` on a shallow state copy whose history excludes the current record; first animated turn → null. Existing log semantics unchanged. | Codex |
| 「出目N」 | Effective face (`effectiveFace` / classic `roll`) before movement-mode expansion and endpoint truncation; never `hopBudget` or `pips`. **No modifier marks** (no （快速）/（×2）/（調整±1）/（遅延）/（寝過ごし））: modifiers are shown only by item/effect chips (Revision 3). See roll table below. `compactRollFor` is not reused. | User 2026-11-12 (Revision 3); Codex |
| +N区間 | Chronological replay of `movementHistory` (+ pending-discard record if its turn is absent; never a pending roll) through the card turn with one seen-set; first traversal of a target segment counts. Uncached. | User asked Codex; Codex |
| 乗換 | Replay like `summarizeGame()`: previous service from `config.targetServiceId` → route-ticket `resolvedRide` / deadhead relocation service → landing service; count only line-group changes; one chip. | Codex |
| Accessibility | No `aria-live` on the card (single existing status stays); desktop = labelled section + heading; chips follow `EffectChips`; log region id lifted to `GamePanel` (`useId`), shared by drawer trigger and pill. Pill and landscape names contain their visible text (label-in-name). | Codex |
| Tests | New files only: `tests/unit/turn-result-card.test.ts`, `turn-result-publication.test.ts`, `turn-result-pill-layout.test.ts`, `turn-result-placement.test.ts`, `tests/e2e/turn-result-card.spec.ts`, optional `tests/e2e/support/turnResult.ts`. Phone cases tagged `@layout`. | User 2026-11-12 |

## Architecture

### Architecture Design

Add a pure `TurnResultModel` to `TurnMomentDisplay`, then render that model in three responsive forms:

- Desktop: heading, two result lines, and chips immediately after the dice actions.
- Phone: a small fixed, content-width pill button (compact summary only) rendered as a sibling of `.game-panel`.
- Short landscape: the same compact summary as one line inside the panel, immediately after the actions.

Keep publication decisions inside `deriveTurnMomentDisplay()`. Components must never reconstruct the card from raw `session.lastMove`, live inventory, or current HUD roll values.

The existing publication boundaries already provide the required behavior: `lotteryPublished` becomes true at `pickup` or `published`; `resultPublished` becomes true only at `published` (`src/features/game/turnMomentPresentation.ts:162-168`, `:225-228`). Add a field; preserve the behavior of existing fields.

Use history replay for segment counts and transfer detection. This supports restored sessions and pending discards without depending on transient attempt facts.

The implementation should proceed in small checkpoints, with review and a pause after each:

1. Pure model and history replay, with unit tests.
2. Publication integration, with phase-by-phase unit tests.
3. Desktop and short-landscape rendering, with targeted layout E2E.
4. Phone geometry, overlay integration, and log interaction, with targeted phone E2E.

The implementation route remains Codex Luna xhigh, followed by caller verification. This design consultation made no edits and ran no suites.
### Module Structure (new files and modifications)

| File | Responsibility |
|---|---|
| **New** `src/features/game/turnResultCard.ts` | Model types, roll wording, face text, short ride formatter, record normalization, history replay, chips, compact summary. Pure TypeScript; no DOM or React. |
| **New** `src/features/game/components/TurnResultCard.tsx` | Desktop card, short-landscape compact row, phone pill; shared model and chip rendering. |
| **New** `src/features/game/useTurnResultPillLayout.ts` | Pure pill position calculator plus a hook that measures the panel rectangle, sets the pill's bottom/left, and publishes layout changes. No overview measurement. |
| `src/features/game/turnMomentPresentation.ts` | Add `turnResult`; select the published move; enforce item turn ownership; implement local classic fallback. |
| `src/features/game/components/GameHud.tsx` | Optional `turnResult?: ReactNode` slot after `.game-panel__actions`, before inventory (`:94-118`). |
| `src/features/game/components/GamePanel.tsx` | Supply the slot, render sibling pill, own log region ID and pill opener/focus coordination. |
| `src/features/game/components/TurnLogDrawer.tsx` | Accept shared region ID/ref and external opener handling while preserving normal trigger behavior. |
| `src/features/game/components/TurnMomentHost.tsx` | Include visible pill in occupied geometry and observe pill layout changes. |
| `src/features/map/RailwayMap.tsx` | Register pill as preview obstruction and layout target; invalidate preview placement when its position changes. |
| `src/styles.css` | `.turn-result*` styling, explicit responsive grid placement, and the phone-only `display:none` of the HUD 出目 `<dt>`/`<dd>` (selector, no new class). |
| **New** `tests/unit/turn-result-card.test.ts` | Pure model/replay coverage. |
| **New** `tests/e2e/turn-result-card.spec.ts` | Feature and `@layout` acceptance cases. |

Add publication assertions in a new companion unit file if the “existing tests unmodified” constraint is literal. Existing specs remain unchanged.

Reuse `ItemIcon`, `LineBadge`, `PhraseText`, `lineBadgeFor`, and `ITEM_DESCRIPTIONS`. Their implementations need no changes.
### Interface Design

#### Model and derivation API

```ts
type TurnResultRecord = DeepReadonly<MoveRecord | ItemTurnRecord>;

interface TurnResultChipBase {
  readonly key: string;
  readonly label: string;
  readonly text: string;
}

type TurnResultChip =
  | (TurnResultChipBase & {
      readonly kind: "segments";
      readonly count: number;
    })
  | (TurnResultChipBase & {
      readonly kind: "transfer";
      readonly count: number;
    })
  | (TurnResultChipBase & {
      readonly kind: "pickup";
      readonly itemKind: ItemKind;
      readonly outcome:
        | "retained"
        | "pending-discard"
        | "harmful"
        | "cancelled";
    })
  | (TurnResultChipBase & {
      readonly kind: "effect";
      readonly itemKind: ItemKind;
      readonly outcome: "consumed" | "activated";
    });

interface TurnResultRide {
  readonly prefix: "抽選" | "乗車";
  readonly serviceName: string;
  readonly directionText: string;
  readonly lineBadge: LineBadgeModel;
  readonly text: string;
}

interface TurnResultModel {
  readonly key: string; // `${sessionId}:turn:${turn}`
  readonly turn: number;
  readonly heading: string;
  readonly rollText: string;
  readonly arrivalStation: string;
  readonly moveText: string;
  readonly ride: TurnResultRide;
  readonly chips: readonly TurnResultChip[];
  readonly compact: TurnResultCompact; // Phone pill and short-landscape row.
}

// Revision 2: the reduced phone/short-landscape content. Pure, never truncated in data
// (ellipsis is CSS only, on the station segment).
interface TurnResultCompact {
  readonly faceText: string; // "3" (effective face, no modifier wording) or "回送"
  readonly stationText: string; // resolved arrival station (neutral fallback, never a raw ID)
  readonly segmentsText: string | null; // "+1区間" only when N >= 1, else null
  readonly text: string; // "3 → 半蔵門 +1区間" / "3 → 半蔵門"
  readonly accessibleName: string; // "前のターン（5ターン目）：3 → 半蔵門 +1区間"
}

interface TurnResultInput {
  readonly sessionId: number;
  readonly turn: number;
  readonly move: LastMove | null;
  readonly records: readonly TurnResultRecord[];
  readonly targetSegmentIds: readonly string[];
  readonly initialServiceId: string;
  readonly itemsPublished: boolean;
  readonly network: RailwayNetwork;
  readonly presentation: PresentationResolver;
}

function deriveTurnResult(input: TurnResultInput): TurnResultModel | null;

function turnResultRollText(move: LastMove): string;

// Revision 2: bare effective face for the compact summary ("3"; "回送" for a deadhead).
function turnResultFaceText(move: LastMove): string;

function shortTurnResultRide(
  move: LastMove,
  network: RailwayNetwork,
  presentation: PresentationResolver,
): TurnResultRide;

interface TurnResultHistoryFacts {
  readonly newTargetSegmentCount: number;
  readonly transferCount: number;
}

function replayTurnResultHistory(
  records: readonly TurnResultRecord[],
  turn: number,
  targetSegmentIds: readonly string[],
  initialServiceId: string,
  presentation: PresentationResolver,
): TurnResultHistoryFacts;
```

`ItemKind`, `DeepReadonly`, and record types are existing domain types, imported without modification.

#### Roll-text rules

**Define `出目N` as the effective die face, before movement-mode expansion and before endpoint truncation.** It is never physical hops, rapid station budget, or doubled movement pips.

This deliberately differs from the compact HUD’s movement-oriented label. `compactRollFor()` returns `hopBudget` stations for rapid and `pips` squares for ordinary item rides (`src/features/game/hudPresentation.ts:37-73`). Do not parse its label or prepend `出目` to it.

| Mode | Card roll text | Source and interpretation | Chip that carries the modifier (Step 3) |
|---|---|---|---|
| Classic normal | `出目3` | `LastMove.roll`. | — |
| Item normal | `出目3` | `ItemRideRecord.effectiveFace` (= `LastMove.roll`). | — |
| 快速 | `出目3` | Effective face; never `hopBudget`. Station-count details remain in the log. | `consumed` rapid → 快速券 |
| 倍 | `出目3` | Effective face; doubled movement budget remains `record.pips`. Do not display `出目6` for a face of 3. | `consumed` double → 倍速券 |
| 出目調整 | `出目4` (raw 3, +1) or `出目2` (raw 3, −1) | `effectiveFace` after adjustment; original face remains in the log/full detail. | `consumed` roll-adjust → 「出目調整 +1」/「出目調整 -1」; the sign comes from `itemRecord.adjustment.delta` (the event carries none) |
| 遅延 | `出目1` | Effective face forced to 1. | `effect-activated` delay → 遅延 |
| 寝過ごし | `出目3` | Effective face remains the die outcome, although oversleep overrides the movement budget. | `effect-activated` oversleep → 寝過ごし |
| 回送 | `回送` | No numeric outcome (`LastMove.roll === null`); complete line is `回送 → X`. | `consumed` deadhead → 回送列車 |
| Endpoint/goal truncation | Same roll text as above | Do not subtract `unusedPips`; arrival names the actual stopping station. | — |

Revision 3 (user 2026-11-12): the card line never carries modifier marks; `turnResultRollText(move)` is `回送` when `move.roll === null`, else `出目${move.roll}`, and `turnResultFaceText(move)` is the same face without the `出目` prefix. Modifiers reach the player only through the chips above (Step 3) and the log. Engine rules make combined modifiers unreachable (forced delay/oversleep turns prohibit active items; adjustment requires an unforced turn with no pre-roll item; delay does not activate under oversleep), and any combination that did occur would still yield one chip per event.

`pips` is a movement budget, not always consumed movement: the engine separately computes `unusedPips` and `physicalHops` (`src/features/game/engine/itemMovement.ts:97-115`). This distinction should be explicit in unit fixtures.

#### Short ride/lottery formatter

1. If `move.landing` exists, use its service and direction.
2. Prefix is `抽選` if **either** `serviceDrawRequired` or `directionDrawRequired` is true.
3. Otherwise prefix is `乗車`.
4. If there is no landing, use `move.serviceId` and `move.direction`; prefix is `乗車`. This covers deadhead and goal arrivals.
5. Resolve the name through `presentation.serviceName`; resolve direction with the existing `directionLabel`; build the badge using `lineBadgeFor`.

Examples:

```text
抽選: 半蔵門線・渋谷方面
乗車: 山手線・品川方面
```

Do not append `方面` in the formatter: non-circular direction labels already contain it, and circular labels are exempt under #62. Historical item draw flags come from `itemLastMove()`’s stored snapshot conversion (`src/features/game/itemSession.ts:72-95`), not a fresh lottery or current candidate recomputation.

#### `+N区間` history replay

Normalize completed history plus pending discard:

1. Copy references to `movementHistory` records.
2. Append `pending.record` only for `pending.kind === "discard"` and only if that turn is absent.
3. Never append a pending roll; it has no completed movement.
4. Process records chronologically up to the selected card turn. Never include later turns.
5. Start `seen` empty and create `targets = new Set(targetSegmentIds)`.
6. For every traversed segment, test membership in `seen`, then insert it immediately.
7. Increment the selected turn’s count only when the segment was unseen **and** belongs to `targets`.
8. Render `+N区間` only when `N > 0`.

This excludes prior revisits and duplicates within the same record. Deadhead has no traversed segments and contributes zero. It reproduces the engine’s first-traversal semantics (`src/features/game/engine/movement.ts:83-99`) and handles the pending record already recognized by `turnMomentPresentation.ts:186-195`.

Start with uncached replay: it is simple and resume-safe. If profiling later warrants caching, cache by immutable history reference, pending-record reference, target configuration/network identity, resolver identity, and selected turn. **History length alone is invalid**, including for post-discard replacement and same-length resumed games.

Transfer replay follows `summarizeGame()` (`src/features/game/gameSummary.ts:20-39`):

- Carry the previous resulting service, starting from `config.targetServiceId`.
- Compare it with an item ride’s `resolvedRide.serviceId`, or deadhead’s relocation service.
- Compare the ridden service with the landing service.
- Count changes only across different presentation line groups.
- Emit one `乗換` chip if the selected turn contains any such change; its full text can state the count.

This captures route-ticket changes before movement, which `landingTransitionText()` alone cannot capture. Same-group service changes and direction reversals are not transfers.

#### Item chips

Read only the selected move’s own `itemRecord.itemEvents`, after item publication:

- `pickup-retained`: picked-item chip.
- `pickup-pending-discard`: picked-item chip explicitly indicating selection is pending.
- `harmful-scheduled`: harmful pickup chip, with full event explanation.
- `cancelled-by-certificate`: cancelled pickup chip; do not imply retained inventory.
- `consumed`: used-item effect chip.
- `effect-activated`: triggered-effect chip.

Use verified event wording from `itemEventTexts()` where applicable (`src/features/game/presentation.ts:118-147`). Deduplicate retained/pending pickup events by item instance ID, matching its existing behavior. Preserve distinct event kinds and use stable keys containing turn, event kind, and instance/event identity.

Do not add ongoing effects or expiration-only events: those already have their own surfaces.

#### Compact summary (Revision 2: phone pill and short landscape)

`compact` is derived in `deriveTurnResult` from the same selected move as the desktop fields:

- `faceText` = `turnResultFaceText(move)`: the same effective face as `turnResultRollText` (never `hopBudget`, `pips`, or `rawRoll` when an adjustment or delay changed it) with **no** modifier wording; `回送` for a deadhead.
- `stationText` = the same resolved arrival station as `arrivalStation`.
- `segmentsText` = `+N区間` from the history replay only when N ≥ 1, else `null`.
- `text` = `${faceText} → ${stationText}` plus ` ${segmentsText}` when present.
- `accessibleName` = `${heading}：${text}`; the pill appends `。ターンのログを開く`.
- It never contains the ride/lottery line, the 乗換 chip, item chips, or modifier wording, so it carries nothing that item publication gates; it still follows the selected move, so it switches to the new turn only at `lotteryPublished`.

| Case | `text` |
|---|---|
| Normal, one new segment | `3 → 半蔵門 +1区間` |
| 快速 / 倍 (face 3, 2 new) | `3 → 渋谷 +2区間` (no （快速）/（×2）) |
| Adjustment +1 (face 4), no new segment | `4 → 目黒` |
| Deadhead | `回送 → 品川` |
| Long name (rendered at 320px) | `6 → 羽田空港第1・第2ターミナル +2区間` in data; displayed as `6 → 羽田空港第1… +2区間` |
### Data Flow

Add:

```ts
interface TurnMomentDisplay {
  // Existing fields unchanged.
  turnResult: TurnResultModel | null;
}
```

Select a card move and its own turn before deriving any text or chips:

| Phase | Card |
|---|---|
| `pre-move`, `moving` | Previous completed move, including its already-published item chips. |
| `arrival`, `segment-flash`, `lottery-flip`, `lottery-settle` | Same previous move. |
| `pickup` | Current move, new heading, movement/ride/progress/transfer facts; **no item chips**. |
| `published` | Current move and its own published item chips. |
| Restored/omitted result | Follow existing `published` boundary immediately. |
| No completed move | `null`; render nothing. |

For item mode, use the existing selector:

```ts
const cardMove = lotteryPublished ? current : previousLastMove(input);
```

Compute `itemsPublished` by identity/turn ownership:

- Previous card turn: true, because it is already historical.
- Current attempt’s card turn: `resultPublished`.
- Never substitute `origin.itemView`, current inventory, or previous-turn event arrays for missing current-turn chips.

This prevents the pickup-stage mixed-turn bug.

**Classic fallback:** classic commits its new history record before animation finishes and has no attempt origin. While unpublished, reconstruct the previous move from history **excluding the current record**, using `lastMoveOf()` on a shallow classic-state copy with that history prefix (`src/features/game/gameSession.ts:100-125`). Take its turn from the selected history record, not `game.turn`. On the first moving turn, return `null`.

Use this fallback only for the new card field; do not change existing log publication semantics as part of #66. When published, select current normally. Explicitly test attempt-less animation even when omitted/restored flags are present so an active classic animation cannot accidentally expose its new record.

No new timer, reducer, persistence field, RNG call, or auto-roll boundary is needed. Opening the log already pauses auto-roll through `activeSurface !== null` (`src/features/game/components/GamePanel.tsx:169-175`).
### Phone pill positioning mechanism (Revision 2)

Use a fixed sibling with the existing panel layer token. Keep a persistent pill DOM shell while the panel is mounted; hide it with `display:none` when responsive-inactive or when `turnResult === null`, and with `visibility:hidden` while a model exists but geometry is not yet valid (see the Step 8 amendment). This lets observers bind before turn 1 and avoids insertion races.

Calculate its position from measured panel geometry:

```ts
bottomPx =
  document.documentElement.clientHeight
  - panelRect.top
  + gapPx;
```

The resulting pill bottom is `panelRect.top - gapPx`. Panel safe-area and future #71 height changes are already reflected in `panelRect`; do not add the bottom safe-area inset again. The pill's left is the measured `panelRect.left`.

Width is content width, capped in CSS only: `max-width: calc(100vw - <measured left> - var(--turn-result-pill-right-inset))` with `--turn-result-pill-right-inset: calc(84px + 8px + env(safe-area-inset-right, 0px))` (84px = the toast/overview column rule at `styles.css:182-196`, 8px gutter). The overview column is therefore always free, at every phone height, with no measurement of `.map-overview` and no narrow/full-width mode. At 320px wide with the 8px panel inset the pill is at most 220px wide. Inside the pill the face, arrow and `+N区間` segments are `flex: none`; the station segment is `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. One visible line sits inside a ≥44px touch target.

The layout hook observes the panel size with `ResizeObserver` (the pill's own size is observed by its consumers), and responds to window resize/orientation and `visualViewport` resize/scroll when available. Coalesce work with `requestAnimationFrame`; compare computed values before updating. Listen to panel transition/animation movement so future translated sheet geometry can be remeasured while it moves.

Expose one small layout-change notification from this presentation hook after committed geometry changes. Consumers remeasure DOM rectangles; no gameplay state is involved.

**TurnMomentHost:** measure the visible pill and expand the panel’s occupied rectangle upward to encompass it before calling `chooseTurnMomentPlacement()`. This conservative union also works for any pill content width. Observe pill resize (its width changes with content) and the shared layout-change notification. The existing placement function and card-fit behavior remain intact (`src/features/game/components/TurnMomentHost.tsx:97-136`, `:345-372`, `:396-449`). Preserve the pickup icon’s untransformed fixed-position ancestor.

**RailwayMap:** add `.turn-result__pill` to both obstruction selectors and preview layout targets (`src/features/map/RailwayMap.tsx:232-249`). A resize observer alone misses vertical position changes when the pill’s size stays constant, so also subscribe to the layout-change notification and schedule the existing layout update. Hidden shells must be filtered with `isVisibleLayoutTarget()`.

Keep follow-camera padding unchanged initially: this feature requires preview and moment avoidance, while existing follow-camera tests constrain marker positioning. Verify the marker remains above the pill in targeted E2E; change padding only if those measurements establish a need.
### Log-open interaction and accessibility

Lift the log region ID to `GamePanel` with `useId()`. Pass it into `TurnLogDrawer`; both the normal trigger and phone pill reference that same region.

The phone pill is a button with:

```tsx
aria-controls={logRegionId}
aria-expanded={activeSurface === "log"}
aria-label={`${model.compact.accessibleName}。ターンのログを開く`}
```

Keep `compact.text` complete in data; ellipsis is CSS only. The name contains the visible text (label-in-name).

On pill activation:

1. Record the pill as the opener.
2. Call existing `setLogExpanded(true)` so menu/card exclusivity is preserved.
3. After the expanded region commits, scroll the **panel scroll container** enough to reveal the log’s beginning.
4. Focus the log region with `tabIndex={-1}` and `focus({ preventScroll: true })`.

Do not rely on focus alone to scroll, or on an effect depending only on `expanded`: tapping the pill when the log is already open must reveal and focus it again. Use a reveal-request counter or equivalent explicit request.

Preserve one Escape handler. Extend the drawer’s existing captured Escape behavior (`src/features/game/components/TurnLogDrawer.tsx:33-46`) to return focus to the recorded opener. Native modal Escape retains priority through `modalDialogOpen()`.

If the pill became hidden after a responsive change, return focus to the normal visible log trigger, revealing it within the panel if needed. Normal drawer-trigger opening/closing retains its existing behavior.

Responsive rules:

- Desktop card: visible only above 600px and above 500px tall.
- Phone pill: visible only at widths ≤600px. The HUD 出目 stat is `display:none` at the same breakpoint (Revision 2).
- Short-landscape row: visible only at widths ≥601px and heights ≤500px.
- Inactive variants use `display:none`, excluding them from accessibility and layout.
- No card/pill at turn 0; no lingering pill after ClearScreen replaces the panel.
- Native dialogs may make the pill inert through existing modality; moments never hide it.

Desktop uses a labelled section and heading. Chips follow `EffectChips`: icon/visual label hidden from assistive technology where needed, one full hidden explanation. No new `aria-live` or status role.
### Error Handling Strategy

The model consumes validated engine records; do not add a second save validator.

- Missing selected move or turn 0: return `null`.
- Missing optional landing: show `乗車` using the selected move’s ride.
- Missing history fact for an otherwise valid move: omit uncertain progress/transfer chips; do not guess from current aggregate completion.
- Unknown station/service metadata: use a neutral display fallback rather than emitting raw IDs. Resolver calls remain mandatory, but their current fallback can return IDs (`src/features/game/presentationResolver.ts:68-101`), so validate lookup presence before exposing fallback strings.
- Unavailable `ResizeObserver`: retain initial layout-effect measurement and resize/orientation listeners.
- Unavailable/zero panel geometry: keep the pill hidden until a valid measurement; do not fall back to 45%.
- WebGL unavailable: card and log remain fully functional.

Desktop sizing must be explicit: retain `height: calc(100% - 120px)` (`src/styles.css:614-632`), target approximately 110px for the card, and reserve 48px below it for #65 with an empty desktop-only layout slot/comment. Use compact chip layout and containment rather than hiding overflow through a blanket fixed-height crop. Verify the complete populated state before accepting this budget.

Short landscape adds a named result grid row after actions; update the explicit row count (`src/styles.css:2490-2510`). Phone adds no panel grid row and no reserve.

## Implementation Plan

All estimates count handwritten changed lines, including tests. A step must stay at or below approximately 150 lines; split it before execution if its actual diff would exceed that limit.

| Step | Unit | Depends on | Est. LOC |
|---|---|---|---:|
| 1 | Model contracts, roll text, face text, and short ride text | — | 105–145 |
| 2 | History replay and progress/transfer chips | 1 | 90–130 |
| 3 | Item chips, compact summary, and complete result model | 1–2 | 95–135 |
| 4 | Reveal-gated publication and classic fallback | 3 | 100–140 |
| 5 | Desktop card, HUD slot, and reserve | 4 | 100–140 |
| 6 | Short-landscape compact row | 5 | 40–65 |
| 7 | Pill position calculator and measured layout hook | 6 | 90–130 |
| 8 | Phone pill shell, width cap, and phone HUD 出目 omission | 7 | 90–135 |
| 9 | Pill activation, log reveal, and focus return | 8 | 95–140 |
| 10 | Turn-moment placement avoidance (+ desktop chip gating) | 8–9 | 60–95 |
| 11 | Map adjustment-preview avoidance | 8–10 | 65–100 |
| 12 | Responsive, accessibility, and lifecycle acceptance | 9–11 | 60–100 |
| 13 | Final publication and populated-layout acceptance | All | 40–75 |
| **Total** | Source and tests | | **1,030–1,530** |

The estimate exceeds the original scope estimate because the fixed decisions require position-change notifications, repeated log activation, classic animation protection, and new companion tests without modifying existing assertions. It is an upper planning range, not permission to add unnecessary abstractions.

### Shared rules and fixture recipes

**Rules applying to every step**

- **Global forbidden areas:** `src/features/game/engine/**`, RNG behavior, save/persistence implementation or format, `src/types/network.ts`, `public/**`, `data/**`, dependencies, lockfiles, version numbers, and existing test assertions.
- Existing test files remain unmodified. Add new unit cases to the new files listed below and new E2E cases to `tests/e2e/turn-result-card.spec.ts`.
- Only introduce `.turn-result*` CSS class names.
- Components consume `turnDisplay.turnResult`; they must not derive result content from raw session moves or live inventory.
- No additional live region, gameplay timer, reducer, or publication boundary.
- Follow TDD for new behavior. Each completed checkpoint must pass typecheck, its affected unit suites, and build.
- New E2E titles below are contracts to create. Use `{ tag: "@layout" }` for every phone case, including interaction cases, because `phone-chromium` filters to `@layout`.
- Playwright grep matches the full title path. Use a suffix anchor, never a beginning anchor.
- Every handoff includes the base SHA, this step’s complete instructions, its allowed paths, shared rules, fixture recipes, and exact commands. Do not rely on another call’s chat.

**Verified fixture mechanisms**

The following already exist:

- `tests/e2e/support/app.ts`: `writeSaveText`, `gamePanel`, `diceButton`, `diceReady`, `rollOnce`, `readSave`, `freezeClock`, `revealUnadjustedRoll`, `openGameLog`, `openGameMenu`, `readMap`, and `combinedMomentGame`.
- `tests/e2e/fixtures/itemScenarios.ts`: `itemScenario("rapid-long" | "adjust" | "route" | "discard" | "double" | …, network)`.
- `tests/e2e/support/turnMoments.ts`: frozen-clock stage helpers, including `awaitStage`, `advanceTumble`, `advanceStamps`, `advanceStageForSpeed`, and movement helpers.
- `__sugorokuE2E.map` exposes the map for observation. It is **not** a game-state injection hook.
- The fixture bundle is selected with `test.use({ dataset: "fixture" })`; engine helpers may be imported by tests without changing engine source.

Use these named recipes throughout the plan:

| Recipe | Explicit setup |
|---|---|
| **R0: fresh** | Navigate to `/`; click `はじめから`; await `gamePanel`; assert turn 0. |
| **R1: completed fixture turn** | Build `itemScenario("route", railwayBundle.network)`. Navigate to `/`; call `writeSaveText(page, serializeGame(state))`; reload; click `/つづきから/`; await `gamePanel` and ready dice. Read the last completed record for expected values. |
| **R2: active adjustment** (revised after validation) | Restore `itemScenario("adjust", network)` as in R1. Assert a held 出目調整券 and ready dice, then click `diceButton(page)` directly (the ticket is used after the die is revealed; there is no pre-roll activation for `roll-adjust`). Await the 「出目を調整しますか？」 dialog. Do not call `rollOnce()` (it accepts the unchanged roll) or `useInventoryItem()`. |
| **R3: moments** | Use fixture dataset and `combinedMomentGame(bundle)`, which replays seed `00000000000000000000000000001bdc` to turn 10. Install `page.clock` before navigation, set reduced motion to `no-preference`, restore as in R1, freeze the clock, then roll turn 11. Use existing stage helpers and offline replay to identify applicable stages and movement duration. Resolve the eventual discard only after pickup assertions. |
| **R4: populated HUD** | Add a bounded, cached helper in the new support file following the existing `ui-pop.spec.ts` search: seeds 0–255, at most 48 turns each, resolving discard by dropping the new pickup. Require three inventory items, a usable double/rapid ticket, at least two active effects including a suspension, and a non-pending next turn. Restore the predecessor, simulate failed save through the existing test pattern, roll, restore `Storage.prototype.setItem`, then stage the usable ticket through its item card. Preserve existing populated tests unchanged. |
| **R5: longest resolved name** | Use the product dataset (`test.use({ dataset: "real" })`; `"product"` is not a valid option) in a separate describe block. Replay `PRODUCT_HISTORY_GAME_SEED` (`…0000`) through `PRODUCT_HISTORY_SCENARIO_TURNS.completed` (96), resolving pending discard consistently; select, among completed records with at least one new target segment, the one with the longest resolved arrival station name, serialize that valid state, and restore it. Assert actual overflow before claiming ellipsis coverage (Step 12 adds a forced-narrow check when the natural text fits). |
| **R7: uninterrupted auto-roll** (added after validation) | Bounded deterministic replay (fixture dataset) that finds a restorable state whose next **two** accepted turns have no pickup stop (`pickup-retained`/`harmful-scheduled`/`cancelled-by-certificate`), no adjustment or discard decision and no clear; assert those predicates offline before browser use and fail with diagnostics otherwise. `itemScenario("route")` is NOT valid here: its turn 3 picks up a rapid ticket, which stops auto-roll by design. |
| **R6: pending discard** | Replay from `itemScenario("discard", fixtureNetwork)` with `playItemTurn`; retain its pending-discard result instead of resolving it. Assert the pending kind before serializing/restoring. |

If a recipe’s expected predicate does not hold, fail with diagnostic state; do not silently substitute another scenario.

#### Step 1 — Model contracts and wording

**Files**

- New `src/features/game/turnResultCard.ts`.
- New `tests/unit/turn-result-card.test.ts`.

**Forbidden**

Global forbidden areas; publication, components, and CSS.

**Change**

Introduce the architecture’s `TurnResultModel`, `TurnResultCompact`, `TurnResultRide`, discriminated `TurnResultChip`, input, and history-fact types. Implement the roll, face (`turnResultFaceText`) and short ride formatters first; do not export a stubbed `deriveTurnResult`.

Carry this roll table directly into implementation (Revision 3: no modifier marks on any row):

| Mode | Text | Source |
|---|---|---|
| Classic | `出目3` | `LastMove.roll` |
| Item normal | `出目3` | `effectiveFace` (= `LastMove.roll`) |
| Rapid | `出目3` | Effective face, never `hopBudget` |
| Double | `出目3` | Effective face, never doubled `pips` |
| Adjustment | `出目4` (raw 3, +1), `出目2` (raw 3, −1) | Effective face after the accepted adjustment, never `rawRoll` |
| Delay | `出目1` | Effective face |
| Oversleep | `出目3` | Effective face despite overridden movement budget |
| Deadhead | `回送` | No numeric roll (`roll === null`) |
| Endpoint/goal truncation | Unchanged roll wording | Never subtract unused pips |

The text never contains `（`, `快速`, `×2`, `調整`, `遅延` or `寝過ごし`; the modifier chips are Step 3. Do not parse `compactRollFor()`.

Ride formatter:

1. Prefer `move.landing` service/direction.
2. Use `抽選` when either draw-required flag is true; otherwise `乗車`.
3. Without landing, use the move’s ride and `乗車`.
4. Resolve names, direction, and badge using existing presentation helpers.
5. Do not append another `方面`.
6. Unknown metadata gets neutral text, never raw IDs.

**Tests**

Table-driven roll cases (each modifier row asserts the exact `出目N` and the absence of any modifier mark), distinct face/raw-roll/budget/physical-hop values, all draw-flag combinations, absent landing, circular directions, badges, and missing metadata. Face text: the same table yields the bare effective face (`3` for 快速/倍 with distinct `hopBudget`/`pips`, `4` after 調整+1, `1` for 遅延) and `回送` for a deadhead, never with modifier wording.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts
npm run build
```

**Est. LOC:** 105–145.

**Expected outcome**

Pure, independently tested wording contracts; no visible UI change.

#### Step 2 — History replay

**Files**

- Modify `src/features/game/turnResultCard.ts`.
- Modify new `tests/unit/turn-result-card.test.ts`.

**Forbidden**

Global forbidden areas; current aggregate completion as a substitute for history; length-only caching.

**Change**

Implement record normalization and history facts:

1. Copy completed `movementHistory` references.
2. Append `pending.record` only for discard, only if its turn is absent.
3. Never append pending roll.
4. Process chronologically through the selected card turn, excluding future records.
5. Start an empty `seen` set and a target-ID set.
6. For each traversed segment, check whether unseen, then immediately insert.
7. Increment the selected turn only for unseen target segments.
8. Emit `+N区間` only for positive N.

Deadhead contributes zero. Start uncached.

For transfers, start from `config.targetServiceId`; compare previous resulting service → resolved ridden service → landing service. For deadhead use its relocation service. Count only changes between presentation line groups. Emit one `乗換` chip with count in its full explanation. Same-group changes and reversals do not count.

**Tests**

Prior revisits, duplicate traversal within one turn, off-target traversal, future records, deadhead, missing history, pending discard before/after append, same-length different histories, route-ticket changes, landing changes, and same-group transitions.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts
npm run build
```

**Est. LOC:** 90–130.

**Expected outcome**

Selected-turn counts match first-traversal semantics after resume and pending discard, without engine changes.

#### Step 3 — Item chips and complete model

**Files**

- Modify `src/features/game/turnResultCard.ts`.
- Modify new `tests/unit/turn-result-card.test.ts`.

**Forbidden**

Global forbidden areas; current inventory or another turn’s events; ongoing-effect and expiration-only chips.

**Change**

Implement `deriveTurnResult`:

- Null for absent move/turn 0.
- Stable key `${sessionId}:turn:${turn}`.
- Heading `前のターン（Nターン目）`.
- Move sentence `${rollText} → ${resolvedStation}`.
- `compact` per "Compact summary (Revision 2)": face, station, `+N区間` only when N ≥ 1, `accessibleName` = heading + text. No `summaryText` field (Revision 2 removed its only consumer, the strip name).

Only inspect the selected move’s own events when `itemsPublished`:

| Event | Result |
|---|---|
| `pickup-retained` | Retained pickup |
| `pickup-pending-discard` | Pickup explicitly awaiting selection |
| `harmful-scheduled` | Harmful pickup |
| `cancelled-by-certificate` | Cancelled pickup, never retained |
| `consumed` | Used-item effect |
| `effect-activated` | Activated effect |

Reuse verified `itemEventTexts()` wording. Deduplicate retained/pending pickup by item instance ID while preserving distinct event kinds. Keys include turn, kind, and instance/event identity.

Revision 3: these chips are now the only carrier of the roll modifiers (the roll text has none). A `consumed` event for `roll-adjust` gets the label 「出目調整 +1」 or 「出目調整 -1」 from the selected record's `itemRecord.adjustment.delta` (the event carries no sign) and a full text that also states the change, e.g. 「出目調整券を使いました（出目3 → 4）」 from `rawRoll` → `effectiveFace`; if `adjustment` is missing, fall back to the plain item name. Rapid, double and deadhead use their `consumed` chip; delay and oversleep their `effect-activated` chip.

**Tests**

Every event outcome, publication disabled, deduplication, stable keys, distinct effects, missing metadata, and null model. Modifier coverage (Revision 3): rapid, double, roll-adjust ±1 (label carries the sign), delay, oversleep and deadhead each yield exactly one chip while `moveText` stays `出目N → 駅` / `回送 → 駅` with no modifier mark. Compact: the five wording examples in the compact table (normal, 快速/倍 with no modifier text, +0 omitted, deadhead, long name kept whole in data), and that `compact` never contains ride, 乗換 or item text even with item events published.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts
npm run build
```

**Est. LOC:** 95–135.

**Expected outcome**

A complete presentation-only model can be derived without UI or transient attempt facts.

#### Step 4 — Publication integration

**Files**

- Modify `src/features/game/turnMomentPresentation.ts`.
- New `tests/unit/turn-result-publication.test.ts`.

**Forbidden**

Global forbidden areas; changes to existing display-field semantics, existing tests, or global `publicationPhase()` behavior.

**Change**

Add `turnResult: TurnResultModel | null`.

Use `lotteryPublished ? current : previousLastMove(input)` for item-mode move selection. Derive the selected turn before deriving text:

- Through lottery-settle: previous completed move, including historical item chips.
- Pickup: current move and movement/progress/transfer facts, no item chips.
- Published: current move and its own item chips.

Previous-turn items are already published. Current-turn items require `resultPublished`. Never copy origin inventory or previous events into the new heading.

For classic mode, while active animation is unpublished, exclude the current history record and call `lastMoveOf()` on a shallow state copy. Use the selected record’s turn. First animated turn returns null. Apply this protection locally even if omitted/restored flags otherwise label the phase published; preserve existing log behavior.

**Tests**

Use two deliberately different turns. Assert heading, move, ride, chips, and `compact` (text and accessible name) at every phase. Include pending discard, Skip, none, reduced motion, resume, auto-roll-shaped consecutive attempts, classic first/later animation, and contradictory classic omitted/restored flags.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts tests/unit/turn-result-publication.test.ts tests/unit/turn-moment-presentation.test.ts
npm run build
```

**Est. LOC:** 100–140.

**Expected outcome**

No new-turn data appears before its boundary; no mixed-turn item chips.

#### Step 5 — Desktop card

**Files**

- New `src/features/game/components/TurnResultCard.tsx`.
- Modify `GameHud.tsx` and `GamePanel.tsx` under `src/features/game/components/`.
- Modify `src/styles.css`.
- New `tests/e2e/turn-result-card.spec.ts`.

**Forbidden**

Global forbidden areas; phone grid budget, panel-height change, new live region.

**Change**

Add the optional HUD slot after actions and before inventory. Render a labelled section containing heading, two lines, badge, and chips. Reuse `PhraseText`, `LineBadge`, and `ItemIcon`; provide one accessible chip explanation.

Desktop visibility: width >600px and height >500px. Preserve fixed `calc(100% - 120px)` panel height. Target roughly 90–110px result content plus a desktop-only 48px #65 reserve slot/comment. Do not crop content with blanket overflow hiding.

**Tests**

New title: `desktop result and reserve fit`.

Recipe R1 at 1280×800: verify heading, move (`出目N → <station>` with no `（…）` modifier mark, Revision 3), ride, slot order, reserve height, and closed log. Also check R0 has no visible card. Run the existing populated no-scroll case unchanged.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts tests/unit/turn-result-publication.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=desktop-chromium --grep 'desktop result and reserve fit$' --workers=2
npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --grep 'desktop populated HUD fits without scrolling$' --workers=2
```

**Est. LOC:** 100–140.

**Expected outcome**

Result and 48px reserve fit inside the existing desktop panel. Existing populated no-scroll assertions pass unchanged.

#### Step 6 — Short landscape

**Files**

- Modify new `TurnResultCard.tsx`.
- Modify `src/styles.css`.
- Modify new E2E spec.

**Forbidden**

Global forbidden areas; adding a phone panel row or reserve.

**Change**

At width ≥601px and height ≤500px, show one non-interactive row immediately after actions: a visually-hidden `${heading}：` prefix plus `compact.text`, with the same flex/ellipsis structure as the pill (station segment truncates). Update the explicit short-landscape grid rows. Hide desktop content with `display:none`. The HUD 出目 stat stays visible here.

**Tests**

New title: `short landscape shows one result row`, tagged `@layout`.

Recipe R1 at 667×375 and 640×400. Verify exactly one accessible result variant, one text line equal to the compact text derived from the replayed state (face, station, `+N区間`), no 「抽選」/「乗車」/「乗換」 text in the row, no pill, HUD 出目 visible, and reachable inventory/actions.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=desktop-chromium --grep 'short landscape shows one result row$' --workers=2
```

**Est. LOC:** 40–65.

**Expected outcome**

One in-panel compact row at both viewports; desktop card/reserve consume no landscape space.

#### Step 7 — Pill position calculator and measured layout hook (Revision 2)

**Files**

- New `src/features/game/useTurnResultPillLayout.ts`.
- New `tests/unit/turn-result-pill-layout.test.ts` (`// @vitest-environment jsdom`).

**Forbidden**

Global forbidden areas; 45% positioning; safe-area double counting; measuring `.map-overview` or any collision/narrow mode; components, CSS.

**Change**

Pure calculator (exported for tests):

```text
computeTurnResultPillPosition({ panelRect, viewportHeight, gapPx })
  → { visible: false } when the panel rect is missing, non-finite, or zero width/height
  → { visible: true, bottomPx: viewportHeight - panelRect.top + gapPx, leftPx: panelRect.left }
```

`viewportHeight` is `document.documentElement.clientHeight`. Named constant `TURN_RESULT_PILL_GAP_PX`.

Hook `useTurnResultPillLayout(panelRef, active)`: observes the panel with `ResizeObserver`; listens to window `resize`/`orientationchange`, `visualViewport` `resize`/`scroll` when present, and panel `transitionrun`/`transitionend`/`transitioncancel`/`animationstart`/`animationend`/`animationcancel` (remeasure every frame while one runs). Coalesce with one `requestAnimationFrame`; compare with the last committed position and skip unchanged results; return the committed position (or hidden). After a committed change, dispatch the named layout-change notification (`TURN_RESULT_PILL_LAYOUT_EVENT` on `window`) for placement consumers. Without `ResizeObserver`, keep the initial layout-effect measurement plus the listeners. Clean up every observer, listener and pending frame; `active === false` measures nothing.

**Tests**

Calculator: normal, nonzero panel left inset, panel height change, position-only move with unchanged size, repeated identical inputs, invalid/zero/missing geometry. Hook (fake `ResizeObserver`, rAF and `visualViewport`): first measurement, rAF coalescing, unchanged-geometry suppression (no event), one event per committed change, missing `ResizeObserver` fallback, full cleanup on unmount and on `active` false.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-pill-layout.test.ts
npm run build
```

**Est. LOC:** 90–130.

**Expected outcome**

Deterministic, measured pill position independent of the current 45% phone CSS; no UI change yet.

#### Step 8 — Phone pill shell, width cap, and phone HUD 出目 omission (Revision 2)

**Files**

- Modify new `TurnResultCard.tsx` (pill renderer) and `GamePanel.tsx` (persistent sibling shell, hook wiring).
- Modify `src/styles.css`.
- Modify new E2E spec.

**Forbidden**

Global forbidden areas; changing phone panel dimensions or the phone stats grid template; widening 進行方向 into the freed cells; any DOM change to `GameHud`'s stats; exposing a nonfunctional interactive button; new classes outside `.turn-result*`.

**Change**

Mount a persistent fixed sibling shell while GamePanel exists. Render `compact` as noninteractive content for now (face, arrow, station, optional `+N区間` as separate spans); Step 9 supplies button semantics and log behavior. Position from the Step 7 hook through inline custom properties (`--turn-result-pill-bottom`, `--turn-result-pill-left`).

CSS at ≤600px: content-width pill (`display: inline-flex` or `width: max-content`; `box-sizing: border-box; min-width: 0` so padding and border stay inside the cap), `max-width: calc(100vw - var(--turn-result-pill-left) - var(--turn-result-pill-right-inset))`, `--turn-result-pill-right-inset: calc(84px + 8px + env(safe-area-inset-right, 0px))` with a comment naming the toast/overview column rule; ≥44px target; one line; only the station segment ellipsizes. Visibility: `display:none` when responsive-inactive or `turnResult === null`; `visibility:hidden` while a model exists but no valid position has been committed.

Phone HUD 出目: inside the existing `@media (max-width: 600px)` block add

```css
.game-panel__stats dt:has(+ dd > [data-stat="roll-compact"]),
.game-panel__stats dd:has(> [data-stat="roll-compact"]) { display: none; }
```

following the existing `dd:has(> [data-stat="ride"])` convention. No DOM/class change, no grid-template change: the fixed rows `18px 34px 34px 18px` keep the stats at 104px; row 3 columns 3–4 stay empty. Short landscape and desktop keep 出目.

**Tests**

New title: `phone pill follows measured panel`, tagged `@layout`. Recipe R1 at 320×568, 390×844, 320×480, and 568×320: pill bottom = panel top − gap and pill left = panel left (±1px); pill right ≤ viewport width − 92px and no intersection with `.map-overview`, the zoom group or the collapsed attribution; one line; height ≥44px. Change panel geometry with a temporary inline style, prove the pill follows, then remove it. Report the toast stack's maximum bottom against the pill top at 320×480 (measurement only), producing the stack with an existing deterministic toast trigger from the current toast specs; if none yields a full stack, report the largest stack measured. If toasts cover the pill, report it as a separate bounded fix step.

New title: `phone pill appears after first publication`, tagged `@layout`: R0 at 320×568 (shell mounted, no visible pill), roll once, the pill becomes visible with the published compact text (observer binding plus first measurement).

New title: `phone HUD omits roll stat`, tagged `@layout`: R1; at 320×568 the 出目 `<dt>` and `hudCompactRoll` are hidden and `.game-panel__stats` is 104px tall; at 667×375 and 1280×800 both are visible.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-pill-layout.test.ts tests/unit/turn-result-publication.test.ts tests/unit/game-hud.test.ts tests/unit/turn-moment-components.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep '(phone pill follows measured panel|phone pill appears after first publication|phone HUD omits roll stat)$' --workers=2
npx playwright test tests/e2e/text-wrapping.spec.ts --project=phone-chromium --grep '(phone HUD budget|HUD breakpoint isolation)$' --workers=2
npx playwright test tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2
npx playwright test tests/e2e/ui-pop.spec.ts --project=phone-chromium --grep 'phone populated layout keeps controls reachable at four widths$' --workers=2
```

**Est. LOC:** 90–135. Steps 7 and 8 are near the cap: if either would exceed ~150 lines, split before execution (Step 7: calculator vs. hook lifecycle; Step 8: pill shell vs. 出目 omission + regression E2E) per the shared rules.

**Expected outcome**

Pill bottom equals measured panel top minus the gap, within 1px, and never reaches the overview column. Phone panel stays at its existing 252px target and below 255.6px at 320×568; the stats block stays 104px. Existing phone HUD tests pass unmodified with 出目 hidden.

#### Step 9 — Log interaction and focus

**Files**

- Modify `GamePanel.tsx`, `TurnLogDrawer.tsx`, and new `TurnResultCard.tsx`.
- Modify new E2E spec.

**Forbidden**

Global forbidden areas; a second Escape handler; bypassing active-surface exclusivity.

**Change**

Lift `useId()` ownership to GamePanel and pass the same region ID to drawer and pill.

Convert the pill to a button:

- `aria-controls` references the log.
- `aria-expanded` reflects `activeSurface === "log"`.
- Accessible name `${compact.accessibleName}。ターンのログを開く` (contains the visible text).

On every activation, including already-open log:

1. Record the pill opener.
2. Call existing `setLogExpanded(true)`.
3. Increment an explicit reveal request.
4. After commit, scroll the panel container to reveal the log beginning.
5. Focus the region with `tabIndex={-1}` and `preventScroll`.

Extend the existing captured Escape behavior. Native modal Escape retains priority. If the pill becomes hidden, return focus to the normal visible log trigger and reveal it if needed.

**Tests**

New title: `pill repeatedly reveals log and restores focus`, tagged `@layout`.

Recipe R1 at 320×568: activate, assert region visibility/focus; scroll away while log remains open; activate again; Escape returns focus. Repeat after opening menu to verify exclusivity, then resize to desktop while log-focused and verify fallback trigger focus.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-publication.test.ts tests/unit/turn-moment-components.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep 'pill repeatedly reveals log and restores focus$' --workers=2
```

**Est. LOC:** 95–140.

**Expected outcome**

Repeated activation reliably reveals and focuses log content; Escape restores a visible opener.

#### Step 10 — Moment avoidance

**Files**

- Modify `src/features/game/components/TurnMomentHost.tsx`.
- New `tests/unit/turn-result-placement.test.ts`.
- Modify new E2E spec.

**Forbidden**

Global forbidden areas; hiding the pill during moments; transformed pickup-flight fixed-position ancestors.

**Change**

Measure the visible pill and union its occupied area with the panel rectangle before existing placement selection. Observe pill size (content width changes per turn) and subscribe to committed layout-change notifications. Ignore hidden shell geometry; preserve existing placement and fit behavior.

**Tests**

Unit cases: hidden shell, short and long (capped) pill widths, position-only changes, and cleanup.

New title: `moments preserve and avoid previous result`, tagged `@layout`.

Recipe R3 at 320×568 and 320×480. Assert the pill remains visible through applicable tumble, stamps, arrival, lottery, and pickup stages. Compare actual visible moment-card bounds against pill bounds. The pill keeps the previous turn's compact text until `lotteryPublished` and shows the new turn's at pickup.

New title: `desktop card gates item chips until publication` (desktop-chromium, Revision 2: the phone pill carries no item chips): recipe R3 at 1280×800; at pickup the card shows the new heading but no new item chip; after publication the own-turn item chip appears.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-placement.test.ts tests/unit/turn-moment-components.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep 'moments preserve and avoid previous result$' --workers=2
npx playwright test tests/e2e/turn-result-card.spec.ts --project=desktop-chromium --grep 'desktop card gates item chips until publication$' --workers=2
```

**Est. LOC:** 60–95.

**Expected outcome**

Moment surfaces do not intersect the persistent pill; pickup icon positioning remains correct; desktop item chips respect the publication boundary.

#### Step 11 — Map preview avoidance

**Files**

- Modify `src/features/map/RailwayMap.tsx`.
- Modify new `tests/unit/turn-result-placement.test.ts`.
- Modify new E2E spec.

**Forbidden**

Global forbidden areas; initial follow-camera padding changes; gameplay or preview-candidate changes.

**Change**

Add `.turn-result__pill` to preview obstruction selectors and preview layout targets. Subscribe to layout-change notification and schedule the existing layout update. Use existing visibility filtering.

Keep follow-camera padding unchanged unless measured acceptance demonstrates a real failure. Any necessary padding adjustment requires a separately bounded follow-up step and explicit regression checks.

**Tests**

Unit cases prove visible-pill registration, hidden-shell exclusion, position-only notification, and unsubscribe cleanup.

New title: `adjustment preview avoids result pill`, tagged `@layout`.

Recipe R2 at 320×568 and 568×320. Assert an already-populated pill exists before adjustment. Use the existing map hook only to project candidate/origin coordinates. Check preview callout bounds against pill, panel, and dialog. Change panel geometry without changing pill size and verify placement recomputes.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-placement.test.ts tests/unit/map-panel-observer.test.ts tests/unit/roll-adjustment-preview.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep 'adjustment preview avoids result pill$' --workers=2
```

**Est. LOC:** 65–100.

**Expected outcome**

Preview content clears the pill, including after position-only changes. Existing follow-camera behavior remains green.

#### Step 12 — Responsive and accessibility acceptance

**Files**

- Modify new E2E spec.
- New `tests/e2e/support/turnResult.ts` for shared restore/replay helpers if needed.

**Forbidden**

Global forbidden areas; production changes hidden inside a test-only checkpoint. Route discovered implementation defects back to a bounded corrective step.

**Change**

Add focused acceptance cases using shared fixture recipes; keep helper code within this step’s line budget.

**Tests**

Create these tagged `@layout` titles:

- `result variants rotate without duplicates`: R1, 390×844 → 667×375 → 1280×800 → 320×568. Exactly one active accessible variant; no duplicate live region.
- `long result truncates with complete accessible name`: R5 at 320×568. Face, arrow and `+N区間` fully visible; only the station segment has `text-overflow: ellipsis`; pill right edge left of the overview column; accessible name holds the complete compact text and resolved names. R5 selects by the longest resolved **station** name among records with N ≥ 1 (so `+N区間` retention is actually exercised; fail diagnostically if none). If the natural text overflows, assert `scrollWidth > clientWidth` on the station segment; if it fits, also inject a test-only style (`page.addStyleTag`) capping the pill to the measured width of its non-shrinking parts (face, arrow, `+N区間`, padding) plus a few station characters, and assert the station segment overflows with ellipsis while face and `+N区間` remain whole and the name is unchanged.
- `native dialog Escape preserves log`: R2 after opening log through pill. Escape dismisses adjustment first; a subsequent Escape closes log and restores the appropriate opener.
- `turn zero and clear remove visible results`: R0, then restore a valid pre-clear state generated by deterministic replay and complete its final turn. Assert no lingering pill after ClearScreen replaces GamePanel.

For the pre-clear state, replay the pinned fixture seed `000000000000000000000000000005ff` until the next accepted turn clears; retain its predecessor and resolve discards consistently. Bound the replay and assert the predicted clear before browser use.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts tests/unit/turn-result-publication.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep '(result variants rotate without duplicates|long result truncates with complete accessible name|native dialog Escape preserves log|turn zero and clear remove visible results)$' --workers=2
```

**Est. LOC:** 60–100.

**Expected outcome**

Responsive variants have no duplicate accessibility exposure; truncation preserves meaning; lifecycle and native-modal focus rules hold.

#### Step 13 — Final integration and acceptance

**Files**

- Modify new E2E spec.
- Modify new `tests/e2e/support/turnResult.ts` if needed.

**Forbidden**

Global forbidden areas; weakening existing assertions to fit the new card.

**Change**

Close remaining acceptance gaps and perform complete diff review.

**Tests**

New titles:

- `populated result preserves desktop budget`: R4 at 1280×800; verify card, applicable chips, 48px reserve, selected inventory summary, effects, and failed-save status all fit.
- `auto roll publishes result and pauses for log`, tagged `@layout`: **R7** at 390×844; enable auto-roll through existing UI, observe the two predicted publications (the pill's accessible-name turn advances each time), activate the pill during the next scheduled delay, advance the frozen clock beyond the auto-roll delay, and assert the turn is unchanged. Use frozen clock control, not wall-clock sleep.

Resume/pending-discard continuity remains covered by unit tests and R6 where an additional browser assertion is necessary; do not duplicate phase tests without a new integration risk.

**Acceptance commands**

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-card.test.ts tests/unit/turn-result-publication.test.ts tests/unit/turn-result-pill-layout.test.ts tests/unit/turn-result-placement.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/map-panel-observer.test.ts
npm run build
npx playwright test tests/e2e/turn-result-card.spec.ts --project=desktop-chromium --grep 'populated result preserves desktop budget$' --workers=2
npx playwright test tests/e2e/turn-result-card.spec.ts --project=phone-chromium --grep 'auto roll publishes result and pauses for log$' --workers=2
npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --grep 'desktop populated HUD fits without scrolling$' --workers=2
npx playwright test tests/e2e/text-wrapping.spec.ts --project=phone-chromium --grep '(phone HUD budget|HUD breakpoint isolation)$' --workers=2
npx playwright test tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2
git diff --exit-code <BASE_SHA> -- src/features/game/engine src/types/network.ts public data package.json package-lock.json
```

Replace `<BASE_SHA>` with the feature’s recorded base before executing the final scope command.

**Est. LOC:** 40–75.

**Expected outcome**

Existing desktop no-scroll and phone-budget tests pass unchanged. Lead checks the full four-project CI matrix before final acceptance.

Verified project names are `desktop-chromium`, `phone-chromium`, `desktop-firefox`, and opt-in `desktop-webkit`. Local Firefox needs `xvfb-run -a`; local WebKit needs `E2E_WEBKIT=1` and installed system libraries. Do not run the full matrix locally for every step.

## File Changes

Paths below are exact; component abbreviations in earlier sections refer to these paths.

| Step | File path | Change type | Description |
|---|---|---|---|
| 1 | `src/features/game/turnResultCard.ts` | New | Contracts and wording |
| 1 | `tests/unit/turn-result-card.test.ts` | New | Pure formatter cases |
| 2–3 | Both Step 1 files | Modify | Replay, chips, complete model |
| 4 | `src/features/game/turnMomentPresentation.ts` | Modify | Add reveal-gated result |
| 4 | `tests/unit/turn-result-publication.test.ts` | New | Publication and classic protection |
| 5 | `src/features/game/components/TurnResultCard.tsx` | New | Responsive result renderer |
| 5 | `src/features/game/components/GameHud.tsx` | Modify | Result slot after actions |
| 5 | `src/features/game/components/GamePanel.tsx` | Modify | Supply gated model |
| 5 | `src/styles.css` | Modify | Desktop result and reserve |
| 5 | `tests/e2e/turn-result-card.spec.ts` | New | Feature acceptance |
| 6 | New result component, stylesheet, new E2E spec | Modify | Landscape row |
| 7 | `src/features/game/useTurnResultPillLayout.ts` | New | Position calculator and measured layout hook |
| 7 | `tests/unit/turn-result-pill-layout.test.ts` | New | Calculator and hook lifecycle cases |
| 8 | Result component, GamePanel, stylesheet, new E2E spec | Modify | Pill shell, width cap, phone HUD 出目 omission |
| 9 | `src/features/game/components/TurnLogDrawer.tsx` | Modify | Shared ID, reveal/focus support |
| 9 | GamePanel, result component, new E2E spec | Modify | Pill button interaction |
| 10 | `src/features/game/components/TurnMomentHost.tsx` | Modify | Occupied geometry and notification |
| 10 | `tests/unit/turn-result-placement.test.ts` | New | Placement integration |
| 10 | New E2E spec | Modify | Moment persistence and clearance |
| 11 | `src/features/map/RailwayMap.tsx` | Modify | Preview obstruction registration |
| 11 | New placement test and E2E spec | Modify | Preview clearance |
| 12 | `tests/e2e/support/turnResult.ts` | New, if needed | Shared valid-state recipes |
| 12–13 | New E2E spec and support helper | Modify | Final acceptance |

Expected maximum footprint: **17 files**, comprising ten source paths and seven test/support paths. Existing test files are read and executed, not edited.

## Test Plan

| Step | Main verification |
|---|---|
| 1 | Effective face semantics; no modifier marks for any mode (Revision 3); draw prefix; direction wording; neutral metadata fallback |
| 2 | First traversal; pending discard normalization; chronological replay; transfer groups |
| 3 | Event ownership; pickup outcomes; effect events; stable deduplication; complete summary |
| 4 | Every publication phase; historical/current ownership; omitted/resumed results; classic active animation |
| 5 | Desktop content order, fixed height, 48px reserve, unchanged populated test |
| 6 | Exactly one landscape compact row and accessible variant; 出目 kept |
| 7 | Measured position; observer/listener lifecycle; change notification |
| 8 | Pill follows panel at four phone viewports; overview column always free; unchanged panel budget; phone 出目 hidden with existing tests green |
| 9 | Repeated activation, explicit scroll, focus, Escape, responsive fallback |
| 10 | Persistent pill and nonintersecting moment bounds; desktop item-chip gating |
| 11 | Preview obstruction registration and position-only invalidation |
| 12 | Rotation, ellipsis/accessibility, native modal priority, turn 0/clear lifecycle |
| 13 | Populated worst case, auto-roll pause, complete regression and scope review |

Every step’s lead review must inspect the actual diff for deleted code, placeholders, swallowed errors, hardcoded fixture results, forbidden edits, and weakened tests. A passing command alone does not constitute acceptance.

## Dependencies Between Steps

```text
1 Wording/contracts
  → 2 History
  → 3 Complete model
  → 4 Publication
  → 5 Desktop
  → 6 Landscape
  → 7 Pill position hook
  → 8 Pill shell + phone 出目
      → 9 Log interaction
      → 10 Moment avoidance
      → 11 Preview avoidance
  → 12 Responsive/accessibility acceptance
  → 13 Final integration
```

Although Steps 9–11 have partially independent code, execute them sequentially to preserve review checkpoints and clear edit provenance.

## Validation amendments

Codex validation (`.claude/logs/codex/20261112T073626Z-turn-result-card-validate.md`) returned NEEDS_REVISION for two fixture errors (R2 pre-roll activation, R1 auto-roll stop). Both are fixed in the recipe table above (R2 revised, R7 added). The amendments below are part of each step's contract; where they conflict with the step text, the amendment wins.

**All steps**
- `tests/e2e/support/turnResult.ts` is allowed from its first actual use (Step 5 onward), not only from Step 12. R4 stays in Step 13 and R5 in Step 12, with explicit dataset selection and bounded, cached replay; reuse the existing populated describe's 90 s timeout where needed.
- Named constants (TS or CSS custom properties) for the pill gap, the 84px overview column inset and 8px gutter, the 48px #65 reserve and the layout-change notification name.
- Missing metadata is handled locally in `turnResultCard.ts`: existing helpers can fall back to raw IDs or numeric direction strings, so check lookup presence and use neutral text.
- `compact`, `title` and every accessible name are built only from the selected, publication-gated model.

**Step 4** — add a case asserting every chip and accessible text contains no current-turn pickup or effect name before `resultPublished`, and the chips contain it after; `compact` never contains one.

**Step 5** — assert R1's chips explicitly: `+2区間`, `乗換`, and the 「抽選:」 prefix (R1 turn 2 traverses two unseen target segments and lands on `fixture-south` from two service candidates — keep these as predicate assertions derived from the replayed state so fixture drift fails diagnostically). Also run one targeted Firefox pass:
```bash
xvfb-run -a npx playwright test tests/e2e/turn-result-card.spec.ts --project=desktop-firefox --grep 'desktop result and reserve fit$' --workers=2
xvfb-run -a npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-firefox --grep 'desktop populated HUD fits without scrolling$' --workers=2
```

**Step 6** — the existing populated landscape test is stronger than the new case (staged slots visible, `scrollTop === 0`); add:
```bash
npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --grep 'short landscape keeps staged slots visible and card reachable$' --workers=2
npx playwright test tests/e2e/hud-layout.spec.ts --project=desktop-chromium --workers=2
```

**Step 8** — measurable initialization: a `display:none` shell has zero height, so `display:none` is used only for responsive-inactive variants and `turnResult === null`. When a model exists but geometry is not yet valid, the pill is laid out with `visibility: hidden` (box measurable, out of the a11y tree) until the first valid measurement, then shown. The turn 0 → first published result case is the Step 8 title `phone pill appears after first publication`. The unchanged populated-phone and HUD-position checks are in Step 8's acceptance commands (the whole phone `hud-layout.spec.ts` run covers the dice-position case).

**Step 9** — the existing log-disclosure cases are not `@layout`, so run them on desktop-chromium:
```bash
npx playwright test tests/e2e/accessibility.spec.ts --project=desktop-chromium --grep 'turn log disclosure' --workers=2
```
Add a case: after a pill-originated open/Escape, a normal log-trigger open/close returns focus to the trigger (no stale opener).

**Step 10** — assert the pill's accessible name during `pickup` (new heading and compact text) and after publication (unchanged, no item name, Revision 2); item-chip gating in the browser is the desktop title `desktop card gates item chips until publication`.

**Step 11** — measure marker clearance above the pill at 320×480 and 568×320 (follow camera on) before concluding follow padding stays unchanged. If the marker is covered, stop and report; a padding change is a separate bounded step that needs user review.

**Step 12** — with R2 revised: open the log through the pill **before** clicking the dice; after Escape accepts the unchanged roll, await the resulting presentation and any decision handling before testing the next Escape.

**Step 13** — auto-roll case uses R7 (above).

## Revision 2 — phone slimming (user 2026-11-12)

This section overrides any older wording about the phone "strip", its full width, overview-collision narrowing, or a full-sentence strip name.

**User decisions**
1. Phones (≤600px wide) show less information: a small content-width pill at the bottom-left of the map just above the panel (still a fixed sibling of `.game-panel`, bottom = measured panel top − gap, tap opens/reveals/focuses the log). Not a full-width strip.
2. Pill content = face, landing station, `+N区間` only when N ≥ 1 (「3 → 半蔵門 +1区間」). No ride/lottery line, no 乗換 chip, no item chips, no modifier wording. Those stay in the log and on desktop; the HUD shows the current ride and direction.
3. The pill's max-width always leaves the right-side overview column free (right inset 84px + 8px gutter + safe area). The conditional narrowing is dropped. Long station names truncate with an ellipsis inside the pill (station segment only).
4. Lead assumption: the short-landscape row under the dice uses the same compact content.
5. On phones the HUD 出目 stat (`data-stat="roll-compact"`) is omitted because the pill duplicates it. Only that item; other phone trimming (empty inventory row, other stats) is deferred to #71. Desktop/tablet and short landscape keep 出目.
6. Unchanged: desktop card (2 lines + chips, 48px #65 reserve), reveal gating, turn 0 hidden, pill visible during moments with TurnMomentHost and adjust-preview avoidance, presentation only, existing tests unmodified, pause after each step, Luna xhigh implements, Sol low reviews.

**Phone 出目 omission — mechanism and evidence (existing tests stay unmodified)**
- CSS only inside the existing `@media (max-width: 600px)` block: `.game-panel__stats dt:has(+ dd > [data-stat="roll-compact"])` and `.game-panel__stats dd:has(> [data-stat="roll-compact"])` get `display:none`. DOM, classes and `data-stat` are unchanged, so the jsdom unit tests that list the `<dt>` terms or read `roll-compact` (`tests/unit/game-hud.test.ts:130,155,159`, `tests/unit/turn-moment-components.test.ts:751-753`) are unaffected (jsdom applies no stylesheet media rules).
- `tests/e2e/hud-layout.spec.ts:65-69` (phone `@layout`) reads `hudCompactRoll` `innerText()` (length > 2), compares it with `title`, and polls `scrollWidth <= clientWidth`. For a `display:none` element `innerText` falls back to its text content (HTML spec: element not being rendered), `title` is unchanged, and `scrollWidth`/`clientWidth` are both 0, so all three hold. The visually-hidden alternative would fail line 69 (1px clipped box, `scrollWidth` > `clientWidth`), which is why `display:none` is chosen.
- `tests/e2e/text-wrapping.spec.ts` `HUD breakpoint isolation` (phone): `statsRows` and `statsHeight` (104) are fixed by `grid-template-rows: 18px 34px 34px 18px`; `rollColumn` reads the computed `grid-column-start` of the hidden `<dd>`, which remains `4`; `directionWidth < statsWidth / 2` holds because 進行方向 stays in column 2. The `phone HUD budget` (252 / 255.6px) is unchanged because the grid rows are fixed.
- `panelStat(page, "出目")` maps to the log's `data-stat="roll"` (`TurnLogDrawer.tsx:76`), not the HUD; `dice.spec.ts`, `lottery.spec.ts`, `items.spec.ts`, `capital-region.spec.ts` are unaffected. `hud-layout.spec.ts:104` overlap check iterates `.hud-stat__value` rects; the hidden one is a zero rect at the origin and cannot intersect the header save mark.
- Freed space: row 3 columns 3–4 stay empty; nothing grows. Widening 進行方向 into them was rejected because it would break the existing assertion `directionWidth < statsWidth / 2` (`text-wrapping.spec.ts:541`) and belongs to #71's phone re-layout.
- Screen readers: `display:none` removes the stat from the accessibility tree on phones. The roll is still exposed through (a) the existing polite status, whose movement announcement states the face and modifiers (`turnMomentPresentation.ts:259-261`), (b) the pill's accessible name (face + station), and (c) the log's full 出目 row. This matches the "inactive responsive variants use `display:none`" rule.

**Plan delta**
- Model: `summaryText` removed; `compact: TurnResultCompact` added (Step 3) with `turnResultFaceText` (Step 1). Pure and unit tested.
- Step 6 renders `compact` in short landscape.
- Old Step 7 (pure geometry with overview collision) became trivial and was merged with the measurement lifecycle into the new Step 7 (calculator + hook, no overview). The new Step 8 is the pill shell, its CSS width cap, and the phone 出目 omission.
- Steps 9–13: renamed strip → pill; Step 10 adds a desktop item-chip gating title; Step 12's long-name case checks station-only ellipsis with a forced-narrow fallback.
- Total 1,030–1,530 LOC (was 1,100–1,580); still 13 paused steps.

## Revision 3 — roll wording (user 2026-11-12)

This section overrides any older modifier-suffix wording (（快速）, （×2）, （調整±1）, （遅延）, （寝過ごし）, 「出目1（遅延・快速）」).

1. Desktop/tablet line 1 is 「出目N → 駅」 with no modifier marks; N is the effective face that drove movement (`ItemRideRecord.effectiveFace`, classic `LastMove.roll`). Example: an adjustment 3 → 4 reads 「出目4 → 目黒」 and the chip 「出目調整 +1」 explains it. Deadhead stays 「回送 → 品川」.
2. Modifiers are communicated only through item/effect chips and the log. Coverage check (lead, against `src/features/game/engine/itemTurnPreparation.ts` and `itemTurn.ts`): rapid, double and deadhead emit `consumed`; roll-adjust emits `consumed` (sign only in `record.adjustment.delta`, hence the Step 3 label rule); delay and oversleep emit `effect-activated`. Every former mark therefore has a chip source; combined modifiers are unreachable under engine rules.
3. Timing note: chips follow item publication, so for the current turn the modifier chip appears at `resultPublished`, while the card line switches at `lotteryPublished`. Between those boundaries the line reads 「出目4 → 目黒」 without the 調整 chip; the previous turn always shows its chips. No new boundary is added.
4. Confirmed unchanged: short landscape uses the same compact content as the phone pill; the pill shows no visible 「前のターン」 label (accessible name only).
5. Plan delta: Step 1 roll table and tests (no marks, no delay/combination logic), Step 3 roll-adjust chip label and modifier-coverage tests, Step 5 asserts no mark in line 1. No LOC estimate change.

## Revision 4 — desktop budget (user 2026-11-14)

This section overrides the older desktop sizing wording ("2 lines + chips", "card ≈ 90–110px", "48px reserve", "reserve height" checks in Steps 5 and 13).

1. Measured conflict (Step 5): in the populated 1280x800 state the fixed panel (clientHeight 680) has ≈97px free; a 2-line card with chips (≥ ~83px incl. margin) plus a 48px reserve cannot fit without editing the existing no-scroll test. Sol low recommended option A; the user chose it.
2. Desktop card: the heading shares line 1 with the move — 「前のターン（34ターン目） 出目4 → 神奈川」 — then the ride line, then chips (`.turn-result__lead`: flex-wrap, `keep-all`, PhraseText hints). Compact spacing (4px margin/padding, line-height 1.2, chip padding 1px 5px). Measured: R1 63.6px, populated 68.4px; populated scrollHeight 680 = clientHeight 680. On a narrow card the move wraps as a whole and the heading breaks only before 「（」; station names stay intact.
3. #65 reserve is 0px: `.turn-result__reserve` stays as a named empty slot (present at turn 0) with `--turn-result-reserve-height: 0px` and a comment that #65 decides its own space later.
4. Heading spacing: the gap in 「前のターン（ 20ターン目 ）」 is a WSL-only font artifact (Linux Chromium falls back to Droid Sans Fallback, whose full-width parentheses are centred). The card keeps the HUD body font; no card-only override (user 2026-11-14). Real Windows/macOS/phone fonts are unaffected.
5. Plan delta: Step 5 spec title `desktop result, inline heading and #65 slot fit` asserts reserve height 0 and heading/move on one line; Step 13 `populated result preserves desktop budget` checks the 0px slot instead of 48px. Steps 6–12 unchanged.

## Risks and Mitigations

| Risk | Impact | Mitigation / acceptance evidence |
|---|---|---|
| Mixed-turn publication | New heading with previous item events or premature lottery | Two distinct-turn phase fixtures; derive selected turn first |
| Effective face confused with movement budget | Incorrect rapid/double/truncated wording | Explicit roll table and deliberately unequal fixture values |
| Resume or pending-discard replay errors | Incorrect +N or transfer chips | Uncached chronological replay; pending-record deduplication; same-length-history tests |
| Desktop populated overflow | Existing no-scroll contract breaks | Run unchanged populated case from Step 5; full R4 acceptance in Step 13 |
| Phone panel grows | #70 budget regression | Fixed sibling pill; unchanged phone-budget test; no phone reserve/grid row; hiding 出目 leaves the fixed stats rows unchanged |
| Pill reaches the overview column | Covers 全体 / 目標路線 | CSS right inset 84px + 8px gutter + safe area at every phone size; Step 8/12 E2E rect checks at four viewports and with the longest name |
| Long station hides `+N区間` | Progress chip lost on phones | Only the station segment ellipsizes; face and `+N区間` are `flex: none`; Step 12 forced-narrow check |
| Phone 出目 hidden breaks an existing test | Must edit a test (forbidden) | CSS-only `display:none`, DOM unchanged; evidence in "Revision 2"; Step 8 runs the whole phone `hud-layout.spec.ts`, `HUD breakpoint isolation`, `phone HUD budget` and the unit HUD suites unchanged. If any still fails, stop and report the exact assertion instead of editing it |
| Toast stack meets the pill on short phones | Transient visual overlap at 320×480 (toasts ≈60–212px, pill top ≈212px) | Toasts are visual-only and transient; Step 8 reports the measured gap; any change is a separate bounded step |
| Position changes without resize | Stale moments or preview fit | Notification after committed geometry plus transition/animation tracking |
| Shortest phone lacks moment space | Overlay collision | Measure actual bounds at 320×480; preserve existing fit behavior; split any required fit correction |
| Log already open but offscreen | Tap appears ineffective | Explicit reveal request on every activation |
| Responsive focus target disappears | Lost keyboard focus | Visible normal-trigger fallback with panel reveal |
| Native modal Escape consumed by log | Incorrect dialog dismissal | Preserve existing modal guard and single captured handler |
| Broad helper expansion exceeds checkpoint size | Unreviewable step | Bounded recipes, shared new helper, split before exceeding 150 lines |
| Seed assumptions differ by dataset | Flaky or invalid saves | Explicit fixture/product dataset separation and predicate assertions |
| CI phone cases omitted | Missing device coverage | Tag every phone acceptance case `@layout` |
| Final acceptance hides forbidden edits | Scope violation | Base-to-head forbidden-path diff plus independent full-diff review |

## Open Questions for the user (all resolved 2026-11-12)

None blocking. Two items to confirm at approval (Codex-defined, user asked Codex to define them):

1. Resolved (Revision 3, user 2026-11-12): no modifier marks; 「出目N → 駅」 / 「回送 → X」, modifiers shown by chips.
2. Size: 13 paused steps, ≈1,030–1,530 LOC incl. tests after Revision 2 (scope consult estimated 750–1,200); the growth is measured pill geometry, repeated log reveal, classic protection and new test files instead of edits to existing ones.
3. Resolved (user 2026-11-12): short landscape uses the same compact content as the phone pill (no ride line, no chips); the desktop card is unchanged.
4. Resolved (user 2026-11-12): the pill has no visible 「前のターン」 label; the heading is in its accessible name only.
