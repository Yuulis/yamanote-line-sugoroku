# Auto-roll 「おまかせで進む」 (issue #64, stage 2) — Implementation Plan

Status: **awaiting user approval** (nothing implemented). Branch: `feature/auto-roll` (from `develop`, stage 1 merged).
Implementer: Codex Sol (default effort), one step per commit, verified by the lead.

- Brief (validated, MODERATE): `.claude/docs/research/feature-auto-roll-brief.md`
- Codebase scan: `.claude/docs/research/feature-auto-roll-codebase.md`
- Codex consults (Sol, low effort, read-only): scope + architecture
  `.claude/logs/codex/20261109T033024Z-autoroll-scope-arch.md`; plan `.claude/logs/codex/20261109T033501Z-autoroll-plan.md`;
  validation: round 1 and 2 NEEDS_REVISION (all edits applied), round 3 PASS — see section 9.
- Handoff: `.claude/docs/plans/auto-roll-handoff.md`
- DESIGN input (dry-run only; the lead applies it after approval): `.claude/logs/design-input-auto-roll.json`

## 1. Scope

In: a toggle 「おまかせで進む」 in the HUD actions row; a pure predicate module and a `useAutoRoll` hook; automatic
rolls through the existing `guardedRoll` only; stop / wait / pause rules below; OFF on hidden tab; announcements in
the existing live region; 3-button layout on phone and compact landscape; deliberate test updates.

Out: persistence of the toggle; goal-proximity stop; answering adjust or discard automatically; any engine, RNG,
save-format, `SAVE_VERSION` or settings-storage (`store/settings.ts`, `useGameSettings.ts`) change; analytics; new
toasts; a keyboard shortcut for the toggle; any change to speed / 演出 behaviour or to `useGameShortcuts.ts`.

## 2. Behaviour (settled decisions + Codex refinements)

| # | Rule | Source |
|---|------|--------|
| B1 | Toggle sits after 「スキップ」 in the actions row (DOM: dice → スキップ → おまかせ). One new tab stop. Always enabled (also during a presentation, so it can always be stopped). Visible text 「おまかせ: OFF」 / 「おまかせ: ON」, fixed accessible name 「おまかせで進む」, `aria-pressed`. The name never matches `/サイコロを振る|移動中…/`. | settled; label: Codex |
| B2 | While ON, a roll is requested **1,200 ms** after the state becomes ready (`canRoll` and no pause). Any pause, OFF or ready-key change cancels the pending timer; the full 1,200 ms restarts once ready again. Unrelated re-renders do not restart it. Independent of speed, 演出 and OS reduced motion. | settled; value: Codex |
| B3 | Stop (toggle OFF) after a **published** turn, newer than the ON baseline, whose record contains `pickup-retained`, `harmful-scheduled` or `cancelled-by-certificate`. Holding items never stops it. | settled; harmful = stop: Codex |
| B4 | `pickup-pending-discard`: wait (ON) during the discard dialog and until the resolved record is published; then stop if an old item was discarded (the new item is kept), resume if the new item itself was discarded (`record.discardedInstanceId === event.item.id`, engine/itemTurn.ts:143). **Open question Q1.** | refinement (lead R1, Codex agreed) |
| B5 | Adjust dialog: wait (ON); after the answer, the presentation completes, then a fresh 1,200 ms gap, unless that turn also triggers B3/B4. **Open question Q2.** | settled (lead assumption) |
| B6 | Pause (ON, no roll): presentation running / not idle (`!canRoll`), menu, log or item card open (`activeSurface`), item-use dialog, native confirm (`confirmationOpen` prop), any other `dialog[open]` (fire-time defence), staged draft item. A manual roll (click, Space/Enter) stays allowed in every pause where `canRoll` is true, including a staged draft. | settled + draft pause: Codex (refinement) |
| B7 | OFF on `visibilitychange` → hidden; never resumes on visible; ON is refused while hidden. Reload / new game / title / resume / edition change / clear start or end OFF through the `GamePanel` remount or unmount (no reset code). | settled |
| B8 | Save failure neither stops nor pauses (existing warning and sticky toast stay). No analytics event. No new toast. | Codex |
| B9 | Announcements reuse the single panel `role=status` (GamePanel.tsx:357): ON → 「おまかせで進みます。」 once; while ON the region text changes only on a newly published turn summary (intermediate stage copy is held); pickup stop → 「アイテムを拾ったため、おまかせを止めました。」 + the published summary in one update; manual OFF → 「おまかせを止めました。」; hidden stop → 「タブが非表示になったため、おまかせを止めました。」; staged-draft pause → 「アイテムを選択中です。手動で振るか、選択を解除してください。」. Decisions keep the dialogs' own status (the panel status is already removed while a decision is presented). Nothing unpublished is ever announced. | lead R2 + Codex |
| B10 | Manual rolls while ON (dice click, Space/Enter) go through the same guard; they do not turn the toggle OFF. Space/Enter on the focused toggle toggles it natively and never rolls (`useGameShortcuts` excludes buttons). | Codex |

Priority inside the predicate: OFF/hidden → wait (decision presented, or unresolved published pending discard) →
stop (B3/B4) → pause (B6) → ready. The stop wins over a surface that is open when the result is published.

## 3. Architecture

State lives in a hook mounted by `GamePanel` (keyed by `sessionId`, unmounted on title and clear), so lifecycle
resets are free. `GameApp.tsx` gains one prop line (`confirmationOpen={confirm !== null}`; 476 → ~477, cap 488).

| File | Change | Responsibility |
|------|--------|----------------|
| `src/features/game/autoRoll.ts` | new (~65-90) | `AUTO_ROLL_GAP_MS`, `autoRollReadyKey`, record-aware `autoRollPickupOutcome`, `autoRollDisposition` (pure) |
| `src/features/game/useAutoRoll.ts` | new (~185-250 after S4) | enabled state, ON baseline, latest-snapshot ref, consumed ready key, timer generation, visibility listener, `requestRoll`, announcement selection |
| `src/features/game/components/GamePanel.tsx` | modify (383 → ≤ ~400) | build the hook input, pass `requestRoll` to `GameHud.onRoll` and `useGameShortcuts.onRoll`, render the hook's announcement in the existing status |
| `src/features/game/components/GameHud.tsx` | modify | toggle button; explicit classes on スキップ and おまかせ |
| `src/app/GameApp.tsx` | modify (+1) | `confirmationOpen` |
| `src/styles.css` | modify | phone 3-column actions; compact landscape actions on a full row with the inventory below (the half-width column, ~205 px of a 440 px panel, cannot fit three buttons); replace `.game-panel__actions button:last-child` (2196-2200) with class selectors; ON style; `white-space: nowrap` for the toggle |

### Interfaces

```ts
// autoRoll.ts
export const AUTO_ROLL_GAP_MS = 1200;
export function autoRollReadyKey(session: GameSession): string;
// `${sessionId}:${game.turn}:${item?.decisionRevision ?? 0}` — changes on every accepted roll, adjust, discard,
// save acknowledgement and animation end (itemSession.ts:101, 123-124, 140, 149-152, 163; gameSession.ts:162).

export type AutoRollPickupOutcome = "none" | "stop" | "await-discard" | "discarded-new";
export function autoRollPickupOutcome(record: DeepReadonly<ItemTurnRecord> | null | undefined): AutoRollPickupOutcome;

export interface AutoRollSnapshot {
  readonly readyKey: string;
  readonly visible: boolean;
  readonly canRoll: boolean;
  readonly phase: TurnMomentDisplay["phase"];
  readonly decision: TurnMomentDisplay["decision"];
  readonly publishedMove: LastMove | null;   // turnDisplay.itemNoticeMove; used only when phase === "published"
  readonly surfaceOpen: boolean;
  readonly itemDialogOpen: boolean;
  readonly confirmationOpen: boolean;
  readonly draftSelected: boolean;
}
export type AutoRollDisposition =
  | { readonly kind: "off" }
  | { readonly kind: "wait"; readonly reason: "adjust" | "discard" }
  | { readonly kind: "stop"; readonly reason: "hidden" | "pickup" }
  | { readonly kind: "pause"; readonly reason: "presentation" | "surface" | "dialog" | "draft" }
  | { readonly kind: "ready" };
export function autoRollBaseline(publishedMove: LastMove | null): number;   // effective baseline at ON (see 3.2)
export function autoRollDisposition(snapshot: AutoRollSnapshot, enabled: boolean, baselinePublishedTurn: number): AutoRollDisposition;

// useAutoRoll.ts
export interface UseAutoRollInput {
  readonly session: GameSession;
  readonly turnDisplay: TurnMomentDisplay;
  readonly surfaceOpen: boolean;
  readonly itemDialogOpen: boolean;
  readonly confirmationOpen: boolean;
  readonly onRoll: () => void;               // GameApp's guardedRoll, via GamePanel props.onRoll
}
export interface AutoRollControls {
  readonly enabled: boolean;
  readonly announcement: string;             // S4: text for the existing panel status (falls back to turnDisplay.announcement)
  readonly toggle: () => void;
  readonly requestRoll: () => void;          // shared by timer, dice click and Space/Enter
}
export function useAutoRoll(input: UseAutoRollInput): AutoRollControls;

// Props
GamePanelProps.confirmationOpen?: boolean;   // default false
GameHudProps.autoRollEnabled: boolean;       // required; tests/unit/game-hud.test.ts:61 factory updated
GameHudProps.onToggleAutoRoll: () => void;
```

### Data flow and guards

1. `GamePanel` render → hook builds the snapshot from `session`, `turnDisplay`, `activeSurface !== null`,
   `itemDialogOpen`, `confirmationOpen`, `document.visibilityState`, and the draft (`turnDisplay.itemView?.draft`).
2. ON baseline = turn of the last **completed published** outcome at the moment of ON (so re-enabling right after a
   stop does not stop again, and a restored save's old pickup never stops it; enabling during a presentation still
   stops for that presentation's pickup once published). An **unresolved pending-discard outcome is never baseline
   history**: the pure helper `autoRollBaseline(publishedMove)` returns `N - 1` when the published record of turn `N`
   is an unresolved `pickup-pending-discard` (no `discardedInstanceId`), otherwise the published record turn (0 when
   none). This holds when ON begins while the discard dialog is open or during the following `resolving` window
   (the published move is still the pending record, itemSession.ts:157-161), so the resolved record `N` is judged by
   B4. The predicate itself only ever compares `record.turn > baseline`.
2a. Hidden ⇔ `document.visibilityState === "hidden"` (jsdom reports `"prerender"` with `hidden: true`, so new ON-path
   tests set the descriptor to `"visible"` explicitly and restore it; OFF-mode suites stay independent of it).
3. Disposition `stop` → the stop announcement is selected **synchronously in the same render** that publication
   becomes visible (from the disposition, not from the later state change), then an effect sets OFF and retains the
   stop copy (see B9 retention rule in S4). No intermediate unprefixed summary is ever committed.
4. Disposition `ready` → one `setTimeout(AUTO_ROLL_GAP_MS)`. The effect depends only on scheduling primitives
   (`enabled`, `readyKey`, disposition kind/reason as strings, timer generation) — never on the snapshot object or the
   whole `turnDisplay` — so ordinary memoised-panel re-renders never restart the gap; cleanup clears it (StrictMode
   replay leaves exactly one live timer). On fire: re-check enabled, visible, generation, ready key, latest disposition
   `ready`, and `modalDialogOpen()`; a DOM-only dialog arms a bounded recheck, every invalidation path (OFF, hidden,
   pause, key change, unmount) cancels that recheck too, and closing the dialog starts a full new gap.
5. `requestRoll`: if the latest snapshot has `canRoll` and its ready key is not yet consumed → consume synchronously,
   invalidate the timer, call `onRoll`. A call with `canRoll === false` consumes nothing (no stuck dice). Manual calls
   ignore auto-only pauses (draft, surface) and visibility because `canRoll` and the existing UI already gate them, so
   OFF-mode manual play is unchanged in jsdom and hidden documents. The guard intentionally collapses duplicate handler
   invocations for one ready state; gameplay, presentation starts and announcements stay equivalent (the duplicate-click
   tests in `tests/unit/game-app-item-progress.test.ts` must keep passing unchanged).
6. Readiness requires `canRoll` (session `idle`), so the pending-discard animation under the prior engine turn
   (`animating` → `awaiting-discard`, itemSession.ts:123-128) can never be ready with the old key.

## 4. Steps

Each step: tests first, then code; targeted local checks; commit; update the handoff; pause for review.

| Step | Title | Prod LOC | Test LOC |
|------|-------|---------:|---------:|
| S1 | Pure scheduling and pickup-stop predicates (not wired) | 65-90 | 120-160 |
| S2 | `useAutoRoll` hook and shared roll guard (not wired) | 145-190 | 240-310 |
| S3 | Wire the toggle, manual inputs, confirm pause and 3-button layout | 60-85 | 180-250 |
| S4 | Coalesced announcements in the existing status | 40-60 | 110-150 |
| S5a | Browser coverage: decisions, pauses, input races | 0 | 170-230 |
| S5b | Browser coverage: lifecycle, motion modes, save failure | 0 | 140-190 |
| S6 | Final local validation and full diff review | 0 | 0 |
| | **Total** | **~310-425** | **~960-1,290** |

### S1 — Pure scheduling and pickup-stop predicates (not wired)

- Files: new `src/features/game/autoRoll.ts`, new `tests/unit/auto-roll.test.ts`.
- Tests first: stop for `pickup-retained`, `harmful-scheduled`, `cancelled-by-certificate`; `pickup-pending-discard`
  without `discardedInstanceId` → wait; discarded the new item → resume eligibility; discarded an old item → stop;
  resolving snapshot with no visible decision but an unresolved published pending-discard record → wait;
  `consumed` / `discarded` / `effect-*` alone, held inventory, absent record, classic record, and records at or before
  the baseline → none; unpublished records (every phase other than `published`, including `pickup`) never stop;
  decision wait precedes stop, stop precedes surface pause; every pause reason (presentation, surface, item dialog,
  confirm, draft) blocks ready; hidden → stop `hidden`; ready keys differ by session, turn and revision;
  `autoRollBaseline`: no record → 0, completed record N → N, unresolved pending-discard record N → N − 1, resolved
  discard record N → N; with the baseline taken during a pending discard, the resolved record N yields both B4
  outcomes (discard old → stop, discard new → none).
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/auto-roll.test.ts`.
- Risks: treating every `discarded` event as a pickup; the disputed B4 rule must stay one predicate branch.

### S2 — `useAutoRoll` hook and shared roll guard (not wired)

- Files: new `src/features/game/useAutoRoll.ts` (returns `enabled`, `toggle`, `requestRoll`; `announcement` =
  `turnDisplay.announcement` passthrough until S4), new `tests/unit/use-auto-roll.test.ts` (≤ 400 lines).
- Tests first (fake timers, `describe.each([false, true])` StrictMode harness like
  `tests/unit/use-game-settings.test.ts:43`): no roll at 1,199 ms, one at 1,200 ms; none again for the same key;
  manual→timer, timer→manual and two synchronous manual calls → downstream once; `requestRoll` with
  `canRoll === false` consumes nothing and a later valid call succeeds; draft blocks the timer but not a manual
  roll; every pause cancels elapsed time and restarts the full gap; a new `onRoll` identity is used without
  resetting the gap; OFF→ON, hidden (dispatch `visibilitychange` with a stubbed `document.visibilityState`), unmount
  and a stale timer callback cannot roll; ON while hidden is refused; re-enable after a pickup stop does not stop on
  the same record; ON during a presentation stops at that pickup's publication; pending discard → resolving →
  resolved publication follows both B4 outcomes; ON while the discard dialog is open and ON during the `resolving`
  window: discard old → stop, discard new → fresh gap and roll; a DOM-only `dialog[open]` → repeated blocked checks →
  close → full gap, and OFF / hidden / unmount cancel every pending check; unmount with a pending timer → no downstream
  call. Use reducer-produced sessions (`reduceAppState` / `reduceItemSession`) for a classic sequence and for the
  adjust and pending-discard sequences so ready keys are real, not fabricated. Every ON-path test sets
  `document.visibilityState` to `"visible"` explicitly and restores the original descriptor in cleanup. The hook
  contract assumes the app's keyed `GamePanel` remount on session replacement; in-place session replacement is out of
  contract (one test documents that the remount starts OFF).
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/auto-roll.test.ts tests/unit/use-auto-roll.test.ts`.
- Risks: effect replay, stale closures, timer/manual races.

### S3 — Wire the toggle, manual inputs, confirm pause and 3-button layout

- Files: modify `src/features/game/components/GameHud.tsx`, `src/features/game/components/GamePanel.tsx`,
  `src/app/GameApp.tsx` (+1 line), `src/styles.css`; modify `tests/unit/game-hud.test.ts` (factory :61 + toggle
  assertions), `tests/unit/turn-moment-components.test.ts` (`hudProps()` factory :701 also builds `GameHudProps`),
  `tests/unit/game-shortcuts.test.ts` (an `aria-pressed` button target never rolls); new
  `tests/unit/game-app-auto-roll.test.ts` (mounted GameApp harness like `game-app-item-progress.test.ts`);
  `tests/e2e/ui-pop.spec.ts` (tab order :813), `tests/e2e/hud-layout.spec.ts`; new `tests/e2e/auto-roll.spec.ts`
  (test-owned `AUTO_ROLL_GAP_MS = 1_200` constant; no production timing import).
- Tests first: HUD toggle name, visible ON/OFF text, `aria-pressed`, click callback, enabled during movement;
  tab order gains exactly 「おまかせ: OFF」 right after the dice (forward and reverse, all three viewports, visual
  order checks kept); three actions fit at 320 / 390 px and 667x375 / 640x400 (56 px row, toggle text not clipped
  — `scrollWidth <= clientWidth`, single line); dice position stable across states; E2E core: ON → gap → roll →
  gap → roll; manual OFF cancels a pending roll and does not interrupt an active turn; published
  `pickup-retained` turns OFF and no further roll follows. Mounted unit (`game-app-auto-roll.test.ts`): readiness
  changes reach the hook through the memoised `GamePanel`; an unrelated re-render keeps the elapsed gap; toggling
  `confirmationOpen` alone (open the 新規 confirm near timer expiry, then cancel) cancels the timer and restarts a full
  gap; dice click and Space/Enter both go through `requestRoll` (one roll when racing the timer).
- Compact landscape: update `grid-template-areas` **and** `grid-template-rows` together; the lottery / options
  visibility checks of `accessibility.spec.ts:603` must pass unchanged.
- Intermediate state: after S3 the feature works but announcements are still the OFF-mode copy; the branch is not
  shipped before S4 passes.
- Local checks: `npm run typecheck`;
  `npx vitest run tests/unit/auto-roll.test.ts tests/unit/use-auto-roll.test.ts tests/unit/game-app-auto-roll.test.ts tests/unit/game-hud.test.ts tests/unit/turn-moment-components.test.ts tests/unit/game-shortcuts.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/item-controls.test.ts tests/unit/capital-region-scaling.test.ts`;
  `npx playwright test tests/e2e/auto-roll.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts --project=desktop-chromium --project=phone-chromium`;
  `wc -l src/app/GameApp.tsx src/features/game/components/GamePanel.tsx`.
- Risks: compact-landscape height/scroll regressions (keep `accessibility.spec.ts:603` unchanged); a manual roll path
  left outside `requestRoll`.

### S4 — Coalesced announcements in the existing status

- Files: modify `src/features/game/useAutoRoll.ts`, `src/features/game/components/GamePanel.tsx` (status text from
  the hook); new `tests/unit/auto-roll-announcements.test.ts`; modify `tests/unit/game-app-auto-roll.test.ts`,
  `tests/e2e/auto-roll.spec.ts`.
- Rules: (a) never enabled in this mount → return `turnDisplay.announcement` directly (no filtering, dedupe or
  effects), so OFF mode is identical to today; (b) ON → start copy, then only newly published summaries, deduplicated
  by publication identity (session + record turn + resolved/pending), not by raw text, so a resolved discard can
  replace its pending state; (c) a pickup stop is selected synchronously from the published disposition and rendered
  as one combined text; (d) **retention**: stop copy (pickup / manual / hidden) survives passive transitions (save
  acknowledgement, animation end, reveal stages — all of which change the ready key, itemSession.ts:123-128, 143-152)
  and is released only by a meaningful player transition: a `requestRoll` that reached `onRoll` (dice click or
  Space/Enter), a draft edit, or re-enabling (ON copy takes precedence); after release ordinary
  `turnDisplay.announcement` resumes; (e) draft-pause copy shows once while paused and clears on deselection.
- Tests first: start copy once and held through intermediate stages; exactly one published summary per automatic
  turn; re-renders and draft revisions do not repeat it; pickup stop copy and its summary arrive together, with no
  intermediate unprefixed summary; a pending discard does not consume the resolved record's announcement; manual
  OFF and hidden stop use only already-public text; OFF mode is byte-identical to today's announcements; one panel
  `role=status` during ON, stop, adjust and discard (DOM check in E2E); committed-DOM transitions across a pickup
  publication never show an unprefixed summary before the combined stop copy; manual OFF / hidden stop → unrelated
  re-render → next manual turn: the stop reason survives the re-render, then ordinary copy resumes; manual OFF and
  hidden stop **during an active item presentation** → passive completion (save acknowledgement, animation end,
  reveal) keeps the stop copy → a manual roll releases it; draft-pause copy appears once and clears after deselection.
- Local checks: `npm run typecheck`;
  `npx vitest run tests/unit/use-auto-roll.test.ts tests/unit/auto-roll-announcements.test.ts tests/unit/game-app-auto-roll.test.ts tests/unit/game-hud.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts`;
  `npx playwright test tests/e2e/auto-roll.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: duplicate status mutations; lost stop reason; early disclosure. DOM tests do not prove screen-reader delivery.

### S5a — Browser coverage: decisions, pauses, input races

- Files: new `tests/e2e/auto-roll-decisions.spec.ts` (≤ 400 lines); shared helpers (toggle locator, gap constant,
  visibility override) live in a non-spec module `tests/e2e/support/autoRoll.ts` — never import one spec from another.
- Tests first: discard stays ON and unanswered; discard an old item → OFF after the resolved publication; discard
  the new item → stays ON, fresh gap, rolls; adjust stays unanswered, after the answer waits for the presentation and
  a full gap (the `adjust` fixture's next plain turn picks up 寝過ごし, a harmful drop → assert that stop separately);
  `certificate` scenario → stop; menu, log, item card, item dialog and 新規 confirm pause without disabling the
  toggle and each close restarts the gap; staged draft blocks auto but a manual roll works; Space/Enter from
  non-interactive focus while ON → exactly one roll; Space/Enter on the focused toggle toggles without rolling.
- Local checks: `npm run typecheck`;
  `npx playwright test tests/e2e/auto-roll.spec.ts tests/e2e/auto-roll-decisions.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: mistaking a later pickup stop for a failed adjust resume; seeded fixture assumptions — assert each boundary.

### S5b — Browser coverage: lifecycle, motion modes, save failure

- Files: new `tests/e2e/auto-roll-lifecycle.spec.ts` (≤ 400 lines).
- Tests first: hidden → OFF and the pending roll is cancelled, visible does not resume (page-side
  `visibilityState` override + dispatched event; labelled as handler coverage); new game, title → resume, reload →
  resume, edition switch start OFF; clear screen leaves no pending callback; OS reduced motion and 演出:なし keep the
  full gap; one `reducedMotion: "no-preference"` run stays ON through movement / reveal / pickup stage and stops only
  at publication; save failure alone neither pauses nor stops; toggling never writes the settings key.
- Local checks: `npm run typecheck`;
  `npx playwright test tests/e2e/auto-roll.spec.ts tests/e2e/auto-roll-lifecycle.spec.ts tests/e2e/resume.spec.ts tests/e2e/save-errors.spec.ts tests/e2e/game-settings.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: clocks advanced before effects arm; animated tests silently running under reduced motion.

### S6 — Final local validation and full diff review

- `npm run typecheck`; `npm test`; all specs touched in S3-S5b plus `game-settings`, `resume`, `save-errors`,
  `layout`, `ui-pop-turn-moments` on desktop-chromium and phone-chromium; `git diff --check develop`;
  `git diff --stat develop`; a full read of `git diff develop -- src tests` plus every untracked file;
  `wc -l` of every new file and of `GameApp.tsx` / `GamePanel.tsx`;
  `python3 .claude/skills/_shared/verify_delegation.py --base develop --forbid-outside src --forbid-outside tests`.
- Codex Sol low review of the full diff; then push, PR → develop, check CI (4-browser matrix).

Dependencies: S1 → S2 → S3 → S4 → {S5a, S5b} → S6.

## 5. Test plan and known breakages

| Existing test | Handling | Reason |
|---------------|----------|--------|
| `tests/unit/game-hud.test.ts:61` (`props()` factory) | add the two required toggle props | `GameHudProps` grows |
| `tests/unit/turn-moment-components.test.ts:701` (`hudProps()` factory) | add the two required toggle props | `GameHudProps` grows; `npm run typecheck` covers tests |
| `tests/e2e/ui-pop.spec.ts:799-852` (expected list :813) | prepend 「おまかせ: OFF」 after the dice; keep reverse and visual-order checks | one new enabled tab stop (idle スキップ is disabled) |
| `tests/e2e/hud-layout.spec.ts:82` | extend for three actions at 320/390 and 667x375 / 640x400; keep dice-position comparisons | actions row and landscape grid change |

Invariants (must pass unchanged): `tests/e2e/accessibility.spec.ts:595` and `tests/e2e/items.spec.ts:53` (one panel
`role=status`); `tests/e2e/accessibility.spec.ts:603` (panel ≤ 75% height, 5 menu buttons); every `diceButton()`
locator; `tests/e2e/accessibility.spec.ts:37-104` shortcut tests; `persistence.test.ts:215`; settings tests.
No skipped or weakened tests; no production module as an E2E timing oracle.

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Pickup revealed before publication | judge only `phase === "published"` + `itemNoticeMove` (turnMomentPresentation.ts:251); animated E2E in S5b |
| Re-stop loop after re-enabling | ON baseline = `autoRollBaseline(publishedMove)`: last completed published turn; an unresolved pending discard N gives N − 1 |
| Double roll (StrictMode, manual + timer) | shared per-ready-key consumption in `requestRoll`; timer generation; fire-time re-check |
| Stuck dice after a no-op request | consume only on a `canRoll` snapshot; key changes on every accepted roll |
| Discard resolution window (`resolving` keeps the old `lastMove`, itemSession.ts:157-161, replaced at :149-152) | unresolved published pending-discard record → wait; never baseline history |
| jsdom `visibilityState` is `"prerender"` | hidden ⇔ `"hidden"` only; ON-path tests set `"visible"` explicitly |
| Live-region flood vs lost information | coalesce to one published summary per turn while ON; stop reason always announced |
| Compact landscape height | actions on a full row; panel-fit test unchanged; measure in hud-layout |
| GamePanel / GameApp line budgets | all logic in the hook; GameApp +1 line |
| Hidden-tab simulation in Playwright is synthetic | label as handler coverage; unit tests cover the listener |

## 7. Open questions for the user — resolved 2026-11-09

All three were answered by the user with the plan's defaults:

- **Q1 (discard)**: resume if the player discarded the new item itself; stop (OFF) if the player kept the new item.
- **Q2 (adjust)**: wait while the roll-adjust dialog is open, then resume (stay ON) after the answer.
- **Q3 (draft pause)**: a staged item pauses auto (never spent by auto); a manual roll uses it and auto continues.

Implementer (user, 2026-11-09): Codex **Luna at xhigh** by default, pause after every step for user review.

## 8. Codex recommendations that refine the settled decisions

- Gap 1,200 ms from ready (not from the previous roll).
- Harmful drops (`harmful-scheduled`, `cancelled-by-certificate`) stop, like beneficial pickups.
- Staged draft pauses auto (Q3). Save failure neither stops nor pauses. No analytics, no new toasts.
- Compact landscape: the actions row takes the full panel width and the inventory moves below it.
- Fixed accessible name 「おまかせで進む」 + `aria-pressed`; visible 「おまかせ: OFF/ON」.
- While ON, the live region announces one published summary per turn (intermediate stage copy held).
- DESIGN row 「…後の「おまかせで進む」トグルは version 1 に任意項目として追加できる」 (2026-11-08) is superseded:
  the toggle is not persisted and adds no settings field.

## 9. Codex validation

| Round | Log | Verdict | Required edits (all applied) |
|-------|-----|---------|------------------------------|
| 1 | `.claude/logs/codex/20261109T033934Z-autoroll-validate.md` | NEEDS_REVISION | baseline must not absorb an unresolved pending discard (ON during the dialog / resolving window); `turn-moment-components.test.ts:701` factory missing from S3; mounted GameApp ON-path tests (memo re-render, `confirmationOpen`, shared guard); synchronous stop-copy selection + retention/release rule + never-enabled passthrough; scheduling-primitive effect deps and DOM-dialog recheck cancellation; jsdom `visibilityState` is `"prerender"`; non-spec E2E helper module; full diff read in S6; citations itemSession.ts:149-152 and gameSession.ts:162. Not applied: "treat adjust (Q2) as settled" — kept open on the lead's instruction. |
| 2 | `.claude/logs/codex/20261109T034248Z-autoroll-revalidate.md` | NEEDS_REVISION | the baseline exception was not representable by the pure interface → `autoRollBaseline(publishedMove)` (N − 1 for an unresolved pending discard) with matching S1 tests; stop-copy release keyed on any ready-key change would drop it on passive transitions → released only by an accepted manual roll, draft edit or re-enable, with tests during an active presentation; citation itemSession.ts:123-128. |
| 3 | `.claude/logs/codex/20261109T034436Z-autoroll-revalidate2.md` | **PASS** | none (no blocking defect; Q2 open by instruction) |
