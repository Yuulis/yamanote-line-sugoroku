# Codebase scan: Issue #66 always-visible "前のターン" turn-result card

Date: 2026-11-12. Branch `feature/turn-result-card` (from develop 4174377, post v0.13.0 + #62 + #70 + auto-roll).
Scope: read-only analysis for the Feature Brief. Line numbers are current on this branch.

## 1. Stale references in the issue

- Issue #66 / UX-02 cite `TurnLogDrawer.tsx:186-221` and `GamePanel.tsx:293-326`. The drawer was extracted
  during UI pop P1: `TurnLogDrawer.tsx` is now 91 lines (region at `:71-88`) and the drawer props are built at
  `GamePanel.tsx:324-356`. `GameHud.tsx:79-80` (#65) is now `:86-91` (踏破区間 row).

## 2. Affected area (current architecture)

| Concern | Location | Notes |
|---|---|---|
| Panel coordinator | `src/features/game/components/GamePanel.tsx:277-403` | `<main class="game-panel">`; renders `GameHud`, then `.game-panel__disclosures` (TurnLogDrawer + GameMenu), dialogs. Memoised. `activeSurface` state (`:153`) owns log/menu/card exclusivity; `setLogExpanded` (`:160`) is the hook a phone strip tap must call. |
| HUD | `components/GameHud.tsx:57-126` | Order: header, subtitle, stats `<dl>` (6 dt/dd pairs, `data-stat` spans), `.game-panel__actions` (dice/skip/auto), `{inventory}` slot, `EffectChips`, save line. The card goes between actions and inventory ("under the dice"). A new prop/slot (like `inventory`) keeps GameHud presentational. |
| Log drawer | `components/TurnLogDrawer.tsx:53-90` | Trigger button `.game-panel__log-trigger` (aria-expanded/controls), region `section.game-panel__log[aria-label=ターンのログ]` with 「このターン」 roll, `.item-arrival`, `.game-panel__lottery`, ItemEventNotice, effect texts, route summary, candidates. Stays the detail surface; no structural change needed. |
| Single display derivation | `src/features/game/turnMomentPresentation.ts:162-322` | `deriveTurnMomentDisplay()` is the only source for HUD/log/map/live region (DESIGN.md row 2026-11-03). The card model must be added here (or derived from its outputs) to stay reveal-gated. |
| Text helpers | `src/features/game/presentation.ts` | `lastRollText` `:59`, `landingText` `:84` (long form 「駅：A・Bから抽選 → X ／ 方向抽選 → Y」), `landingTransitionText` `:34` (「乗換: X（Y）」, null for same group), `itemEventTexts` `:118`, `arrivalLogText` `:159` (「15ターン目：半蔵門に到着。踏破 5/30」), `itemHistoryText` `:259`. |
| Compact roll | `src/features/game/hudPresentation.ts:31-80` | `compactRollFor/compactRollText` build 「3マス」, modifiers (倍/快速/寝過ごし), 回送. Reusable for line 1. |
| Effect chips | `components/EffectChips.tsx`, `hudPresentation.ts:83` | Pattern for chip markup: `ItemIcon` + `aria-hidden` short label + `visually-hidden` full text, `LineBadge size="sm"`. Only harmful ongoing effects today. |
| Item icons / line badges | `components/ItemIcon.tsx:68` (`kind`, `size`), `lineBadge.ts:199` `lineBadgeFor(serviceId, presentation, color)`, `components/LineBadge.tsx` | Use for 「抽選: [badge] 半蔵門線・渋谷方面」 and the picked-item chip. |
| Wrapping | `components/PhraseText.tsx` | Render-time `<wbr>` for JP text; title/aria strings stay plain (#70 decision). Card lines use `PhraseText`; phone strip uses `white-space: nowrap; text-overflow: ellipsis` instead. |
| Clear screen history | `components/ClearScreen.tsx:88-100` | Per-turn rows (`itemHistoryText` or classic row). 10-turn log history (deferred) would reuse this. |
| Turn-moment host | `components/TurnMomentHost.tsx:97-136, 345-372, 396-465` | Fixed, `aria-hidden`, chooses the largest free rect around `.game-panel` (selector `:59`); measures `.map-overview` and top-right zoom group as controls. On phones the chosen region is "above" the panel, i.e. the strip's area. |
| Map camera / obstructions | `src/features/map/RailwayMap.tsx:229-249, 435-443, 454-470` | Follow camera bottom padding = map bottom − `.game-panel` top (`phonePanelBottomPadding`); adjust-preview fit avoids `PREVIEW_OBSTRUCTION_SELECTORS` (`.game-panel`, `.item-adjustment`, `.map-overview`, MapLibre corners). A strip outside `.game-panel` is invisible to both unless added. `map-panel-observer.test.ts` covers the observer. |
| Settings / policy | `store/settings.ts`, `gameSettings.ts`, `animation/turnMomentPolicy.ts:49-61` | 演出 levels all / important / none; `none` plans no reveal stages, so results publish when movement ends. Auto-roll (#64 stage 2) is merged (`useAutoRoll.ts`, `GamePanel.tsx:169`). |
| Toasts | `toastQueue.ts`, `components/ToastHost.tsx`, CSS `styles.css:68-150,161-196` | Visual only. Phone stack: top, below attribution, right inset 84px (clears zoom + overview). Milestone toast for 30/30 exists (`toastQueue.ts` `targetSegmentsMilestoneToast`), with negative event indexes reserved for #65 milestones (DESIGN 2026-11-10 row). |
| Proximity (#65) | `engine/proximity.ts:38` `nearestTargetStation`, `:72` `targetHopDistances` | Used only by `itemOptions.ts:89` and `landing.ts`. Pure; #65 can derive "あとN駅" without engine change. |

## 3. Reveal gating: what the card can show and when

`deriveTurnMomentDisplay` phases: `pre-move` → `moving` → `arrival`/`segment-flash` → `lottery-flip` →
`lottery-settle` → `pickup` → `published` (`turnMomentPresentation.ts:79-90`). Existing precedents:

- `lotteryPublished = isPublished || phase === "pickup"` (`:167`); log lottery/candidates read
  `lotteryPublished ? current : previousLastMove(input)` (`:215-221`). This is exactly the "card move" selector.
- Items/effects/notices publish at `resultPublished = isPublished` (`:228, 244, 311-312`), per DESIGN.md row
  2026-11-07 (ride/log at lottery-settle end, items at pickup end).
- `previousLastMove` comes from `attempt.origin.previousLastMove` (`:92-94`), so during pre-move/moving the
  previous turn's move is available in item mode.
- `restoredOrOmitted` (resume, reduced motion) → `published` at once (`:80`). Skip → `attempt.motionOmitted`.
  `演出: なし` → no reveal stages (`turnMoments.ts:134-155`) → published when movement finishes. So "immediate
  under なし / skip / auto-roll" needs no new mechanism.

Recommended gating (to confirm with Codex): card turn and lines 1-2 switch at `lotteryPublished` (same instant as
the log and HUD ride); item chips switch at `resultPublished`. During pre-move/moving the card keeps showing the
previous turn. A whole-card switch at `published` is the simpler alternative (one boundary, slight delay of
lines 1-2 during the pickup stage only).

Classic mode (no `itemPolicy`, tests only; production `DEFAULT_GAME_CONFIG` is item mode, `gameConfig.ts:51-55`):
there is no attempt, so during `moving` `session.lastMove` is already the new move and `previousLastMove` is null.
Classic needs `movementHistory.at(-2)` or "hide while moving" to avoid publishing early.

## 4. Derivability of the card content (presentation-only check)

All fields are derivable from existing `LastMove` / `ItemTurnRecord` / `MoveRecord` / `movementHistory`; no engine,
RNG, save or public-data change is needed.

| Card element | Source |
|---|---|
| Heading 「前のターン（15ターン目）」 | `record.turn` (`move.itemRecord?.turn`), same as `arrivalLogText`. |
| Line 1 「出目3 → 半蔵門」 | `ItemRideRecord.rawRoll/effectiveFace/adjustment/movementMode` via `compactRollFor`; station `move.stopStationId` via `stationName`. Deadhead: `stopReason === "relocation"` → 「回送 → X」. Endpoint/unused pips: `lastRollText` detail stays in the log. |
| Line 2 「抽選: 半蔵門線・渋谷方面」 | `move.landing` (`LandingResolvedEvent`: `serviceId`, `direction`, `serviceDrawRequired`, `directionDrawRequired`, `changedService`). New short formatter needed (not `landingText`, which is long). Forced ride (no draw): wording TBD (e.g. 「乗車: 山手線・外回り」). Goal turn: ClearScreen replaces the panel. |
| +N区間 | Replay `movementHistory` (plus a pending-discard `record`, as `turnMomentPresentation.ts:186-195` already does): `record.traversedSegmentIds ∩ targetSegmentIds` minus the union of earlier records. Matches engine semantics (`movement.ts:94-99`: completion = first traversal). Pure, O(history); memoise per history length. `attempt.newlyCompletedTargetSegmentIds` is attempt-only and lost on resume, so replay is the robust source. |
| 乗換 | `landingTransitionText(record)` non-null and not same-group (`presentation.ts:34-47`); route-ticket ride change before movement is `record.resolvedRide` vs the previous ride (`gameSummary.ts:27-33` shows the logic). |
| Picked item | `itemEvents`: `pickup-retained`, `pickup-pending-discard` (item kind/name via `ITEM_DESCRIPTIONS`, icon via `ItemIcon`), `harmful-scheduled`, `cancelled-by-certificate`, `discarded`. |
| Triggered effect | `itemEvents`: `effect-activated` (delay/oversleep/detour), `consumed` (item used this turn), `effect-expired`. |

## 5. Layout constraints

### Desktop (>600px wide, >500px tall)
- `.game-panel` `styles.css:614-632`: fixed, left 12px, bottom 28px, width 310px, **height `calc(100% - 120px)`**
  (fixed so the dice stays put; comment `:621-622`), `overflow-y: auto`. At 1280x800: 680px tall, y≈92..772; content
  ends ≈490 → ≈280px blank (UX-13).
- Budget proposal: card ≈ 90-110px (heading 18 + two 20px lines + chip row 24 + padding/margins). #65 later: a
  proximity row (≈24px in stats or a line under the bar) + optional next-segment line (≈18px) + milestone pulse
  (no height). Total ≈ 150px of 280px, so keep the fixed height; do not shrink the panel now (shrinking would
  have to be undone by #65 and would move nothing since the top is fixed by height).
- Smaller desktops (1280x720 → 600px panel) still fit; the panel already scrolls.
- `ui-pop.spec.ts:420-440` asserts `scrollHeight <= clientHeight + 1` at 1280x800 with a populated state
  (inventory + staged summary + chips). The card must keep that true or the test needs an explicit, justified
  viewport/state update (not a weakening).

### Phone (≤600px wide)
- Panel `styles.css:2126-2150`: grid areas stats/actions/inventory/staged/chips/save/disclosures, height and
  max-height 45%, bottom 8px. #70: 252px at 320x568 against the 255.6px cap (DESIGN 2026-11-10 row,
  `text-wrapping.spec.ts:180-205` enforces rows, budget, `scrollTop 0`).
- User decision: strip overlays the map just above the panel. It cannot be a child of `.game-panel` positioned
  with `bottom: 100%`, because the panel is `overflow-y: auto` and would clip it. It must be a fixed sibling
  (render it next to `<main>` from GamePanel via a fragment, or from GameApp), positioned at
  `bottom: calc(8px + 45% + gap + safe-area)`.
- Overlay map at 320x568: panel top ≈ 304px. Strip (≈28-32px incl. gap) ≈ 270-300px.
  - `.map-overview` (全体 / 目標路線): fixed `top: 156px`, right 10px, two 44px buttons + 4px gap → ≈156-248px.
  - Zoom group: top-right, 10px + 2×44px → ≈10-98px. Attribution (collapsed 44px) top-left.
  - Toasts: top, below attribution, right inset 84px, up to 3 × ≥44px + 8px gaps → ≈60-212px.
  - **Collision threshold**: strip top ≈ 0.55·H − 42px meets the overview bottom (≈248px) when H < ≈527px.
    Real phones hit this: iPhone SE Safari innerHeight ≈ 460-548px with toolbars, and phone landscape
    (e.g. 568x320, still ≤600px wide) already has the overview overlapping the panel. Mitigation: right inset
    84px (same column rule as toasts, `styles.css:187-196`) or hide/shorten below a height threshold.
  - TurnMomentHost picks the "above" region (map minus panel) and centres the card there; a tall card
    (split-flap lottery, pickup) can reach the strip. Options: include the strip in the measured panel rect
    (resolvePanel union), or hide the strip while `turnDisplay.itemUseLocked` (moments active) — it would then
    reappear with the new result at publication, which is also the reveal boundary.
  - RollAdjustment phone sheet (`styles.css:1986-1994`, max-height 45%, same bottom) covers the panel; the strip
    would sit over the map where the landing speech bubbles (`.map-adjustment-callout`, `styles.css:521-560`)
    are fitted. Add the strip to `PREVIEW_OBSTRUCTION_SELECTORS` or hide it while a decision is open (the modal
    makes it inert anyway). DiscardChoice is a modal too.
  - ItemPickupMoment flight passes through the strip area; it is on `--layer-turn-moment` (15) above
    `--layer-panel` (10). Fine if the strip uses `--layer-panel`.
  - ClearScreen phone sheet (max-height 60%) replaces the panel; strip must not render with `showClear`.
  - Follow camera: marker is centred in map-above-panel (≈y 152 at 320x568), clear of the strip. Optionally
    extend `phonePanelBottomPadding` by the strip height (16px recentre shift); not required.
- Tap → open the log: strip as a `<button>` calling `setLogExpanded(true)` with `aria-controls` = log region id
  (TurnLogDrawer owns `useId` today, `TurnLogDrawer.tsx:31`; the id or an open callback must be lifted). The log
  opens at the bottom of the scrolling panel (`disclosures` area), so the open must scroll it into view; focus
  return on Escape goes to the drawer trigger today (`:42`).
- Phone landscape ≤600px wide and very short heights: decide whether to hide the strip (the panel is ≈144px tall
  at 568x320).

### Short landscape (≥601px wide, ≤500px tall)
- Panel `styles.css:2467-2520`: 2-column grid, `min(75vh, 100% - 16px)` tall, areas
  stats/actions/inventory/staged/chips/save/log-trigger+menu-trigger/lottery/legend/shortcuts; the log region is
  `max-height: 120px` in the `lottery` area. The user decisions do not cover this layout: an in-panel one-line
  row under the actions (phone wording) is the natural fit. Tests: `ui-pop.spec.ts:538-560` (667x375, 640x400
  dice/scroll), `hud-layout.spec.ts:141-176`, `accessibility.spec.ts:617`.

## 6. Accessibility and announcements

- Single polite live region stays the only announcer (`GamePanel.tsx:377`); the card must not be `aria-live`
  (its text duplicates `turnDisplay.announcement`). Desktop card: a `<section aria-label="前のターン">` with a
  heading. Phone strip: a button whose accessible name is the full sentence; visible text truncates.
- Chips: follow `EffectChips` (icon + `aria-hidden` label + `visually-hidden` full text).
- `TurnMomentHost` is `aria-hidden`; nothing there changes.

## 7. Test patterns and consumers to update

- Unit (Vitest, `tests/unit/`): pure derivation tests in `turn-moment-presentation.test.ts` (phase-by-phase
  publication, e.g. `:99`, `:122`, `:183`, `:302` resumed), `game-app-turn-moments.test.ts` (`:106` injected
  publication boundary, `:348` "publishes map, HUD, inventory, effects, log and interaction together"),
  `hud-presentation.test.ts`, `item-presentation.test.ts`, `game-hud.test.ts`, `phrase-text.test.ts`. A new
  pure `turnResultCard.ts` model gets its own `turn-result-card.test.ts` (roll/deadhead/modifier, forced vs
  drawn lottery, +N with history replay incl. pending discard and revisited segments, 乗換 vs same-group,
  pickup/harmful/cancelled/consumed/activated chips, turn 0 empty).
- E2E (Playwright, `tests/e2e/`): helpers `support/app.ts` (`gamePanel :80`, `panelStat :104`,
  `openGameLog :111`, `rollOnce :186`, `waitForRollOutcome :244`), `support/layout.ts`
  (`measureTextLayout :216`, `expectSingleLine :236`), `support/turnMoments.ts`. Layout specs are tagged
  `@layout` (phones run `@layout` only in CI): `text-wrapping.spec.ts` (9), `ui-pop.spec.ts` (6),
  `map-visual.spec.ts` (7), `hud-layout.spec.ts` (2), `ui-pop-turn-moments.spec.ts` (5).
- Locator collision risk: 20 test references use `.game-panel__lottery` / `.item-arrival`, and real-data
  asserts `gamePanel(page).not.toContainText("toei-oedo")` (`real-data.spec.ts:170,175`). The card must use new
  class names (e.g. `.turn-result`) and the same presentation-resolved names (never raw IDs). No test uses
  `page.getByText(/ターン目|抽選|到着/)`, so duplicated text does not create strict-mode violations.
- Phone budget tests (`text-wrapping.spec.ts:180-205`, `items.spec.ts:441`) must keep passing unchanged: the
  strip is outside `.game-panel`, so its height is not in `panelHeight`.

## 8. Downstream consumers / coupling

- `deriveTurnMomentDisplay` output type `TurnMomentDisplay` (`:41-75`) is consumed by GamePanel, GameApp
  (`GameApp.tsx:209-224`), RailwayMap props, ToastHost, ClearScreen and `useAutoRoll`; adding a field is
  additive.
- GameHud props interface grows by one slot; `game-hud.test.ts` renders it directly.
- #65 will want the same panel slot / a HUD row and its milestone toasts (negative event indexes); #61 item chip
  wording; #68 turn wording 「N ターン目」 vs 「Nターン目」 (current log: no space).
- #71 phone sheet work (two-state sheet) will interact with the strip's `bottom` offset (it assumes 45%).
