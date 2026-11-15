# Issue #65 HUD progress feedback — plan

Status: **awaiting user approval.** Codex (Sol, low effort, read-only) design
`.claude/logs/codex/20261115T111604Z-hud65-design.md`; one validation round
`.claude/logs/codex/20261115T112140Z-hud65-validate.md` → **NEEDS_REVISION**, the five required revisions are applied by
the lead below (see "Validation amendments"); no second validation round (per instruction). Brief:
`.claude/docs/research/feature-hud-progress-feedback-brief.md` (validate_doc feature-brief: ok). Scan:
`.claude/docs/research/feature-hud-progress-feedback-codebase.md`. Scope: `.claude/logs/codex/20261115T110512Z-hud65-scope.md`
(COMPLEX). Branch to create: `feature/hud-progress-feedback` from develop `05cace4`. Prompts:
`.claude/docs/plans/hud-progress-feedback-impl-prompts.md`. Handoff: `.claude/docs/plans/hud-progress-feedback-handoff.md`.

## Decisions

User decisions 2026-11-15 (binding) are in the brief ("User Decisions"). Design decisions below resolve the lead
defaults and the points the brief left open; **L** = lead default accepted by Codex, **C** = Codex decision, **V** =
added by validation. Items marked (?) are repeated in "Open items" for the user.

| # | Point | Decision |
|---|---|---|
| D1 | A hidden | Riding the target (Yamanote) service, distance 0, all 30 required segments complete, or current distance unknown (L). |
| D2 | A direction | Distance of `nextStationId(displayed ride, direction)` vs current station: smaller → 「（近づく）」, larger → 「（遠ざかる）」, equal / no next stop → no parenthetical (L). `directionHint()` is not reused (it compares directions with each other). |
| D3 | A timing | From gated `turnDisplay` only (station = `progress.stationId`, ride = gated ride); updates per completed displayed hop; a staged route/direction ticket does not preview it (C). |
| D4 | A copy | 「山手線まで あとN駅」 + optional 「（近づく）」/「（遠ざかる）」; N = gameplay hops from `targetHopDistances` (rapid segment = 1) (L). |
| D5 | C visited | Start station + `segment.from`/`segment.to` of every displayed traversed segment (rapid pass-through excluded); grows per displayed hop (C). |
| D6 | C ridden | Presentation line group of each traversed segment's service; starts at 0 (being assigned a line is not riding it) (C). |
| D7 | C deadhead (?) | Destination counts as visited at arrival; the relocation service does not count as ridden (`physicalHops: 0`) (C, matches lead proposal). |
| D8 | C copy | 「訪れた駅 n/1,586」「乗った路線 n/134」 with runtime totals `network.stationsById.size` / `presentation.lineGroups().length`, digit grouping via `toLocaleString("ja-JP")`. Share text unchanged (L). |
| D9 | B thresholds | First crossings of 10/20/25/29/30 by replaying unique required segment IDs; per turn only the highest crossed threshold is notified, 30 included (L). |
| D10 | B 30 compatibility | If 30 is the highest, notify through the existing `targetSegmentsMilestoneToast` path and its existing `goalGuidance` condition; if that condition suppresses it (e.g. clear on the same turn) do **not** fall back to 29 or lower (V1). |
| D11 | B copy / index | 10「10区間突破！」-5, 20「20区間突破！あと10区間」-4, 25「あと5区間！」-3, 29「あと1区間！」-2, 30 existing text -1 (L/C). |
| D12 | B announcement | Milestone sentence appended to the existing polite `announcement` exactly once per session/turn/threshold, tracked by a consumed-key set (history, toast baseline and `entryTurn` are not substitutes): arrival announce → Skip → published must not re-announce (V2). The same set also covers 30, which fixes the #62 residual "Skip during arrival announces 30/30 twice" (?). |
| D13 | B flash | Decorative child flash on the bar, one iteration, keyed `session:turn:threshold`, only for the current turn after movement completes; none for 30 (goal guidance replaces the bar); suppressed for session-entry history (`entryTurn`), omitted motion, Skip, 演出なし and OS reduced motion; toast + announcement still shown (L). |
| D14 | B resume | Historical milestone toast keys are returned on entry so `GameApp` `toastBaseline` suppresses them; `entryTurn` suppresses announcement/flash (C). |
| D15 | Desktop placement | One 24px row after the stats `dl`, no extra margin: left ≈180px A (two 12px lines: distance, parenthetical), right ≈100px C (two 12px lines, 10-11px text); row height kept when A is hidden because C remains (C). |
| D16 | Phone placement | A as a 7th `dt/dd` pair appended after 出目 (first six ordinals unchanged); label visually hidden; `dd` in row 3 cols 3-4, explicitly 34px = 2×17px lines, overriding the 18px cap / `nowrap` / `overflow` defaults; desktop row hidden on phone. C only in the hamburger and the clear screen (user). |
| D17 | Short landscape (?) | No new stats row (3×18px kept); desktop row and phone pair hidden; A+C shown at the top of the existing log; separate ログ / メニュー triggers kept (C). |
| D18 | Phone hamburger | One nonmodal inline disclosure, trigger = hamburger icon + visible 「メニュー」 (44px), inside: C summary, 「ログ」/「設定」 section buttons, then the selected existing region (`ターンのログ` / `メニュー`); opens on the log section; no ARIA menu/tab roles (C). |
| D19 | Legend ON (?) | Interpreted as: all lines visible on the map by default and the static legend visible inside 設定 — both as today; the 134-group list keeps its current collapse rule; nothing persisted (C). |
| D20 | Pill destination | #66 pill opens the hamburger on the log section, scrolls and focuses the log; `aria-controls` still targets the log region (C). |
| D21 | Surfaces | `activeSurface` gains `"phone-menu"`; separate `phoneSection: "log" \| "settings"`; any open surface still pauses auto-roll and suppresses shortcuts; embedded log/menu relinquish Escape to the wrapper; native dialogs keep Escape priority; focus returns to a visible opener, else the hamburger; at a breakpoint change the open section maps to the equivalent surface (C). |
| D22 | Budgets | **No budget-test change planned**: `text-wrapping.spec.ts` `phone HUD budget` (252px, rows 18/34/34/18), `HUD breakpoint isolation` (short landscape 3×18px) and the desktop populated no-scroll checks stay byte-identical and must pass (C). |

## Architecture

- **Publication boundary unchanged:** `deriveTurnMomentDisplay()` (`src/features/game/turnMomentPresentation.ts`) gains
  three fields `proximity: TargetProximity | null`, `collection: CollectionProgress`, `milestoneFlash: MilestoneFlash |
  null`; components never aggregate from `session.game`. No new publication input: `RollAttempt.recordTurn`, classic
  `session.animation.turn`, history, pending discard record and `progress.stepsCompleted` suffice (validated).
- **Visible traversal projection** (private, in `turnMomentPresentation.ts`): pre-move excludes the unpublished target
  record; moving includes the target record up to `stepsCompleted` hops; arrival and later include it fully; deadhead
  contributes only its destination at arrival; a pending-discard record is deduplicated against history by turn;
  classic animation identifies the active record from the animation identity, not from `attempt` presence.
- **Pure models:** `targetProximity.ts` (A), `collectionProgress.ts` (C), `progressMilestones.ts` (B crossings). The
  toast builder for new thresholds lives in `toastQueue.ts` next to the existing 30 builder.
- **Phone D:** new `components/PhoneGameMenu.tsx` wraps `TurnLogDrawer` and `GameMenu` in an `embedded` mode (no own
  trigger, no own Escape listener); `GamePanel` renders it only under `usePhoneLayout()`.

### Publication timing

| Phase | A proximity | C collection | B milestone |
|---|---|---|---|
| `pre-move` | Origin station + gated origin ride | History through the previous turn | Earlier public crossings only |
| `moving` | Displayed station + gated ride, per hop | + current record prefix of `stepsCompleted` hops | Current turn withheld |
| `arrival`, `segment-flash` | Arrival station, ridden service | Full current traversal; deadhead destination counts | Current crossing public (toast, announce once, flash) |
| `lottery-flip`, `lottery-settle` | Ridden service until existing lottery publication | Unchanged | Kept public, no second notification |
| `pickup` | Newly published ride | Unchanged (lottery/items add nothing) | Item toasts follow the milestone |
| `published` | Fully public | Complete, pending-discard movement once | Omitted/classic fresh turns publish here; restored turns never replay |

### Interfaces (exported)

```ts
// targetProximity.ts
export interface TargetProximity { readonly hops: number; readonly trend: "closer" | "farther" | null; readonly text: string }
export interface TargetProximityInput {
  readonly stationId: string;
  readonly ride: Readonly<{ serviceId: string; direction: Direction }>;
  readonly targetServiceId: string;
  readonly targetComplete: boolean;
}
export function deriveTargetProximity(input: TargetProximityInput, network: RailwayNetwork): TargetProximity | null;

// collectionProgress.ts
export interface CollectionVisit { readonly traversedSegmentIds: readonly string[]; readonly relocationDestinationId?: string }
export interface CollectionProgress {
  readonly visitedStations: number; readonly totalStations: number;
  readonly riddenLines: number; readonly totalLines: number;
  readonly stationsText: string; readonly linesText: string;
}
export function deriveCollectionProgress(startStationId: string, visits: readonly CollectionVisit[],
  network: RailwayNetwork, presentation: PresentationResolver): CollectionProgress;

// progressMilestones.ts
export const PROGRESS_THRESHOLDS = [10, 20, 25, 29, 30] as const;
export type ProgressThreshold = typeof PROGRESS_THRESHOLDS[number];
export interface ProgressCrossing { readonly turn: number; readonly threshold: ProgressThreshold }
export interface MilestoneFlash { readonly key: string; readonly threshold: Exclude<ProgressThreshold, 30> }
export function deriveProgressCrossings(
  records: readonly Readonly<{ turn: number; traversedSegmentIds: readonly string[] }>[],
  requiredSegmentIds: readonly string[],
): readonly ProgressCrossing[]; // highest threshold per turn, chronological

// toastQueue.ts (existing targetSegmentsMilestoneToast stays unchanged)
export function progressMilestoneToast(sessionId: number, crossing: ProgressCrossing): ToastInput; // thresholds < 30

// components
// GameHudProps += proximity: TargetProximity | null; collection: CollectionProgress; milestoneFlash: MilestoneFlash | null
// TargetProgressBarProps += milestoneFlash?: MilestoneFlash | null
// ClearScreenProps += collection: CollectionProgress
// TurnLogDrawerProps / GameMenuProps += embedded?: boolean (GameMenu also gets the parent trigger ref for focus return)
export type PhoneMenuSection = "log" | "settings";
export interface PhoneGameMenuProps {
  expanded: boolean; section: PhoneMenuSection; collection: CollectionProgress;
  openerRef: React.RefObject<HTMLElement | null>; triggerRef: React.RefObject<HTMLButtonElement | null>;
  onExpandedChange: (expanded: boolean) => void; onSectionChange: (section: PhoneMenuSection) => void;
  log: React.ReactNode; settings: React.ReactNode;
}
```

### Data flow

```text
session + displayed progress + attempt/reveal policy + entryTurn
  → deriveTurnMomentDisplay: visibleProgress/visibleRide → proximity; visible traversal → collection;
    crossings + arrival eligibility → toastInputs / announcement (consumed-key once) / milestoneFlash
  → GamePanel → GameHud (desktop row A+C, phone pair A, bar flash) · short-landscape log A+C · PhoneGameMenu (C + log/settings)
  → GameApp toastBaseline → ToastHost;   showClear + collection → GameApp → ClearScreen
```

## Steps

Estimates = handwritten changed lines incl. tests; hard cap ~150 per step — split before execution if the concrete
diff would exceed it. Every committed step must leave the existing suites green.

| Step | Unit | Files (src) | Tests | Depends | Est. LOC |
|---:|---|---|---|---|---:|
| 1 | Proximity model | new `targetProximity.ts` | new `tests/unit/target-proximity.test.ts` | — | 110–140 |
| 2 | Collection model | new `collectionProgress.ts` | new `tests/unit/collection-progress.test.ts` | — | 120–150 |
| 3 | Gated A+C publication | `turnMomentPresentation.ts` | new `tests/unit/hud-progress-publication.test.ts` | 1–2 | 130–150 |
| 4 | Crossings + toast builder | new `progressMilestones.ts`, `toastQueue.ts` | new `tests/unit/progress-milestones.test.ts` | — | 125–150 |
| 5 | Milestone publication + once-only announcement | `turnMomentPresentation.ts` (+ consumer of `announcement` if the consumed set must live there) | new `tests/unit/progress-milestone-publication.test.ts` | 3–4 | 130–150 |
| 6 | Progress-bar flash | `TargetProgressBar.tsx`, `GameHud.tsx`, `styles.css` | new `tests/unit/hud-progress-components.test.ts` | 5 | 85–120 |
| 7 | Desktop A+C row | `GamePanel.tsx`, `GameHud.tsx`, `styles.css` | component suite; new `tests/e2e/hud-progress-feedback.spec.ts` (desktop title) | 3, 6 | 110–150 |
| 8 | Clear-screen counters | `ClearScreen.tsx`, `src/app/GameApp.tsx`, `styles.css` | component suite; existing `clear-screen wrapping` unchanged | 3 | 60–90 |
| 9 | Phone A cell + short-landscape A+C in log | `GameHud.tsx`, `GamePanel.tsx`, `TurnLogDrawer.tsx`, `styles.css` | E2E phone + short-landscape titles | 7 | 100–140 |
| 10 | Embedded disclosure mode | `TurnLogDrawer.tsx`, `GameMenu.tsx` | new `tests/unit/phone-game-menu.test.ts` | — | 75–110 |
| 11 | Phone hamburger wrapper (not yet mounted) | new `components/PhoneGameMenu.tsx`, `styles.css` | phone-menu suite | 10 | 110–150 |
| 12 | Layout-aware E2E helpers (green on the legacy UI) | — | `tests/e2e/support/app.ts`; `text-wrapping.spec.ts` `panel wrapping`; `game-settings.spec.ts` `presentation cycles…` | — | 70–110 |
| 13 | Phone surface + pill integration | `GamePanel.tsx`, `styles.css` | phone-menu suite; E2E hamburger title; edits to `turn-result-card.spec.ts` ×3 and `ui-pop.spec.ts` tab order | 9, 11, 12 | 130–150 |
| 14 | Final acceptance | — | E2E milestone lifecycle title; full gates | all | 40–80 |
| **Total** | | | | | **1,395–1,890** |

Step order note: 1, 2, 4, 10 and 12 have no dependency on each other and can run in any order; the table order keeps
one model in flight at a time.

### Shared rules (every step)

- Forbidden: `src/features/game/engine/**` edits (read-only imports of `targetHopDistances`, `nextStationId` and
  types are fine), RNG, save/persistence behaviour or format, `src/types/network.ts`, `public/**`, `data/**`,
  dependencies/lockfiles, version numbers, share text (`shareText.ts`), unrelated refactors.
- Existing test files byte-identical except the edits listed under Steps 12 and 13. Never skip, delete or loosen an
  assertion, widen a geometry bound or a timing tolerance. A failing geometry gate needs a layout fix.
- Components read only `turnDisplay` (and props derived from it); no new live region, reducer, timer or publication
  boundary; `PhraseText` for visible Japanese text; named constants; reduced-motion CSS next to each animation.
- New CSS classes: `.hud-progress*` (desktop row, phone cell), `.target-progress__flash`, `.phone-menu*`,
  `.clear-collection*`; do not reuse `data-stat` values of the existing six pairs (the phone pair uses
  `data-stat="proximity"`).
- Playwright: targeted titles only, `--grep '<title>$'` (suffix anchor), `--workers=2`; phone cases tagged
  `{ tag: "@layout" }`; never `pkill -f` / `pgrep -f`; never the full suite locally.

### Step details

**Step 1 — Proximity model.** `deriveTargetProximity` per D1–D4. Tests (fixture network via existing unit helpers):
closer, farther, equal, no next stop, rapid hop counts 1, hidden on target service / distance 0 / complete / unknown
distance, exact text. Accept: `npx vitest run tests/unit/target-proximity.test.ts`, `npm run typecheck`.

**Step 2 — Collection model.** `deriveCollectionProgress` per D5–D8; the helper reads no session. Tests: fresh game
`1/<total>` stations and `0/<total>` lines, repeated stops deduplicated, rapid endpoints only, two services in one line
group count once, deadhead destination visited without a ridden group, runtime totals, grouped digits. Accept:
`npx vitest run tests/unit/collection-progress.test.ts`, `npm run typecheck`.

**Step 3 — Gated A+C publication.** Add `proximity` and `collection` to `TurnMomentDisplay`; private visible
traversal projection per "Architecture". Tests: pre-move with a committed attempt (record excluded), moving prefix by
`stepsCompleted`, arrival/lottery/pickup, classic animation without `RollAttempt`, staged ticket draft (no preview),
deadhead, omitted presentation, pending discard counted once. Accept:
`npx vitest run tests/unit/hud-progress-publication.test.ts tests/unit/turn-moment-presentation.test.ts`, typecheck.

**Step 4 — Crossings + toast builder.** `deriveProgressCrossings` (unique required IDs in movement order, highest per
turn) and `progressMilestoneToast` (D11 keys `${sessionId}:milestone:target-segments:<n>`, indexes -5..-2). Tests: exact
hit, crossing two thresholds in one turn, duplicate / repeated segment IDs, jump to 30, enqueue order before an item
event of the same turn through the existing reducer, sticky save failure still reserved. Accept:
`npx vitest run tests/unit/progress-milestones.test.ts tests/unit/toast.test.ts`, typecheck.

**Step 5 — Milestone publication.** Replace the 30-only producer with crossing-driven inputs: historical crossings
returned in chronological order (for the resume baseline), then current item events; 30 per D10 (existing function
and `goalGuidance` condition; no fallback). Announcement per D12 with a consumed-key set keyed
`session:turn:threshold` — if the set cannot live in the pure derivation, keep it beside the existing announcement
consumer and say so; flash identity per D13. Tests: no leak during `moving`, publication at arrival before item
events, arrival → Skip → published announces once, omitted/no-motion fresh turn still toasts and announces, restored
history suppressed, clear-on-the-same-turn 30 case unchanged and no fallback. Accept:
`npx vitest run tests/unit/progress-milestone-publication.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/toast.test.ts`, typecheck.

**Step 6 — Progress-bar flash.** `TargetProgressBar` renders a keyed `aria-hidden` decorative child when
`milestoneFlash` is set; the `role="progressbar"` node and its value stay stable; CSS one-iteration animation with a
`prefers-reduced-motion: reduce` block beside it. The suppression matrix is tested in Step 5 only (V5); here test DOM
identity: same key does not remount, new key does, null renders nothing, 30 shows guidance. Accept:
`npx vitest run tests/unit/hud-progress-components.test.ts`, typecheck, `npm run build`.

**Step 7 — Desktop A+C row.** Wire `proximity`/`collection` from `turnDisplay` in `GamePanel`; `GameHud` renders the
D15 row after the `dl`, hidden at ≤600px and in short landscape. New E2E title `desktop progress row preserves
populated no-scroll budget` (`@layout` not needed: desktop only) — real dataset, A visible, totals 1,586/134 fully
readable (no ellipsis), `scrollHeight ≤ clientHeight + 1`. Accept: component suite; the new title; existing
`populated result preserves desktop budget$` (`turn-result-card.spec.ts`) and `desktop populated HUD fits without
scrolling$` (`ui-pop.spec.ts`) on desktop-chromium; `npm run build`.

**Step 8 — Clear-screen counters.** `GameApp` passes `turnDisplay.collection` to `ClearScreen`; two more stats
「訪れた駅」「乗った路線」 in the existing `<dl>`; share text untouched. Tests: component render in the component suite
(both rows, totals). Regression: existing `clear-screen wrapping$` (`text-wrapping.spec.ts`, `@layout`) on
desktop-chromium and phone-chromium, unchanged (V5: no new clear E2E). Accept: those commands + typecheck.

**Step 9 — Phone A cell + short landscape.** Append the 7th pair per D16 (`dt` visually hidden, `dd` with
`data-stat="proximity"`), hidden on desktop and short landscape; short landscape shows A+C at the top of the log
(`TurnLogDrawer` gets an optional `progress` node) per D17. New E2E titles `phone proximity reuses the roll cell
without moving dice` (`@layout`; 320x568 and Pixel 7, no horizontal overflow, two-line fit) and `short landscape
progress stays in the current log` (`@layout`). Regressions unchanged: `phone HUD budget$`, `HUD breakpoint
isolation$` (text-wrapping), `keeps the dice button at one HUD position across variable content and save states$`
(hud-layout) on desktop-chromium **and** phone-chromium (V4). Accept: those + typecheck + build.

**Step 10 — Embedded disclosure mode.** `embedded?: boolean` on `TurnLogDrawer` and `GameMenu`: no own trigger, no own
Escape listener, region/content unchanged; `GameMenu` routes 新規/タイトル focus return through the supplied parent
trigger ref. Default (non-embedded) behaviour byte-for-byte the same. Tests: embedded renders no trigger and adds no
keydown listener; default unchanged. Accept: `npx vitest run tests/unit/phone-game-menu.test.ts`, typecheck.

**Step 11 — Phone hamburger wrapper.** `PhoneGameMenu.tsx` per D18/D21 (props above): one trigger (icon + 「メニュー」,
`aria-expanded`, `aria-controls`), C summary, 「ログ」/「設定」 section buttons with `aria-pressed`, both sections
mounted with the unselected one `hidden`, the single Escape owner (yields to native modal), focus return to a visible
opener else the trigger, switching to 設定 clears a pill opener. Not mounted by `GamePanel` yet. Tests: section
switch, hidden section out of tab order, Escape owner + native modal priority, opener fallback. Accept:
`npx vitest run tests/unit/phone-game-menu.test.ts`, typecheck, build.

**Step 12 — Layout-aware E2E helpers (V3).** `openGameLog` / `closeGameLog` / `openGameMenu` / `closeGameMenu` in
`tests/e2e/support/app.ts` detect the UI, not the viewport: if the legacy trigger (「ログ」 / 「メニュー」 with
`aria-controls` of that region) is visible use it, else open the hamburger and press the section button; closing
either section closes the phone surface; the labelled-region visibility assertions stay. Replace the direct phone
「ログ」 click in `text-wrapping.spec.ts` `panel wrapping` with `openGameLog()`, and route the phone reopen in
`game-settings.spec.ts` `presentation cycles and survives reload and new game with one-line menu labels at ${width}px`
through `openGameMenu()` (1280px variant unchanged). All measurements/assertions kept. Green on the current (legacy)
UI. Accept: run on desktop-chromium and phone-chromium the helper-covered titles listed in "Affected existing tests".

**Step 13 — Phone surface + pill integration.** `GamePanel` mounts `PhoneGameMenu` under `usePhoneLayout()` (legacy
pair hidden on phone), `activeSurface` `"phone-menu"` + `phoneSection`, pill → hamburger log section with the existing
reveal counter and focus, breakpoint translation, auto-roll pause/shortcut suppression via the existing surface flag.
New-UI-only test edits in the same commit: `turn-result-card.spec.ts` `pill repeatedly reveals log and restores
focus`, `pill-opened log does not leave a stale opener`, `native dialog Escape preserves log`; `ui-pop.spec.ts` `tab
order follows the visual inventory, staged, effects, and disclosure order` (one closed disclosure trigger at ≤600px;
full forward/reverse sequence kept). New E2E title `phone hamburger switches between log and settings` (`@layout`;
internal navigation only, V5 — pill/Escape/auto-roll are covered by the edited existing tests). Accept: phone-menu
suite; the four edited titles + new title on desktop-chromium and phone-chromium; `auto roll publishes result and
pauses for log$`, `phone pill follows measured panel$` and the helper-covered list on phone-chromium; typecheck; build.
If the diff exceeds ~150 lines, move the breakpoint translation into a follow-up step 13a.

**Step 14 — Final acceptance.** New E2E title `milestone feedback publishes once and does not replay on resume`
(desktop, fixture dataset; bounded deterministic replay to a turn that crosses 10; fail with diagnostics if not
found): toast + announcement once, flash present with `no-preference` and absent with reduced motion, reload → no
replay. Then `npm run typecheck`, `npx vitest run`, `npm run build`, the new spec on desktop-chromium and
`--project=phone-chromium`, and the regression list below.

## Affected existing tests

Per-test edits (only these; all assertions kept):

| File | Title | Step | Edit |
|---|---|---|---|
| `tests/e2e/support/app.ts` | helpers `openGameLog`/`closeGameLog`/`openGameMenu`/`closeGameMenu` | 12 | UI-detecting hamburger path |
| `text-wrapping.spec.ts` | `panel wrapping` | 12 | direct 「ログ」 click → `openGameLog()` |
| `game-settings.spec.ts` | `presentation cycles and survives reload and new game with one-line menu labels at ${width}px` (390px) | 12 | reopen via helper/settings section |
| `turn-result-card.spec.ts` | `pill repeatedly reveals log and restores focus` | 13 | hamburger vs pill `aria-controls`, settings hidden on pill activation, desktop trigger after resize |
| `turn-result-card.spec.ts` | `pill-opened log does not leave a stale opener` | 13 | normal opener = hamburger |
| `turn-result-card.spec.ts` | `native dialog Escape preserves log` | 13 | hamburger + settings navigation, focus expectation |
| `ui-pop.spec.ts` | `tab order follows the visual inventory, staged, effects, and disclosure order` | 13 | one disclosure trigger at ≤600px |

Helper-covered (no edit; must be run on phone-chromium at Steps 12 and 13, V4): `hud-layout.spec.ts` `keeps the dice
button at one HUD position across variable content and save states`; `lottery.spec.ts` `arrival lottery, both endpoint
kinds and a direction-only draw are visible`; `real-data.spec.ts` `the Oedo legend checkbox groups both services and
works by keyboard and phone touch` and `the shipped Tokyo suburban product network starts, moves and restores without
console errors`; `capital-region.spec.ts` `regional target view and full overview fit outside the panel; operator line
groups are selectable`; `map-visual.spec.ts` `phone 全体 fits the collapsed-legend map area and remains clear when
expanded` and `the service legend collapses; 山手線 progress and 現在地 stay visible`. `accessibility.spec.ts` direct
trigger cases run at desktop width only and stay unchanged.

**Budget tests: none changed** (`PHONE_HUD_TARGET_BUDGET_PX = 252`, `PHONE_HUD_STATS_ROWS`, short-landscape rows,
desktop `scrollHeight ≤ clientHeight + 1`).

## Validation amendments

| # | Codex revision | Applied as |
|---|---|---|
| V1 | 30/30 vs `goalGuidance` ambiguity | D10; Step 5 test "clear-on-the-same-turn 30 unchanged, no fallback" |
| V2 | Announcement once is not guaranteed by keys/cursor | D12 consumed-key set; Step 5 test arrival → Skip → published |
| V3 | Step 11 (integration) before Step 12 (test updates) leaves red commits | Reordered: helpers first (Step 12, green on legacy UI), integration + new-UI test edits together (Step 13), wrapper built unmounted (Step 11) |
| V4 | Missing helper-covered phone tests; dice-position only on desktop | "Affected existing tests" list; phone-chromium runs in Steps 9, 12, 13, 14 |
| V5 | Step 7 too large; redundant hamburger/flash tests | Step 7 split into 7 (desktop row) and 8 (clear counters, reusing existing `clear-screen wrapping`); dropped the new clear E2E title; hamburger E2E limited to internal navigation; flash suppression tested only in the publication suite |

Rejected: none of the required revisions. Not adopted from the original design (inflation, per the user's lean-test
preference): the new E2E `clear collection remains readable across layouts` and the hamburger E2E re-implementing
pill / Escape / auto-roll scenarios already covered by edited existing tests. Optional suggestions folded in: real
1,586/134 totals in the desktop E2E; explicit 34px/2×17px override for the phone `dd`.

## Regression list (final step)

```bash
npx playwright test tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/turn-result-card.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2 --grep 'phone HUD budget$|HUD breakpoint isolation$|clear-screen wrapping$|populated result preserves desktop budget$|desktop populated HUD fits without scrolling$|phone populated layout keeps controls reachable at four widths$|keeps the dice button at one HUD position across variable content and save states$|auto roll publishes result and pauses for log$|phone pill follows measured panel$'
npx playwright test tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/turn-result-card.spec.ts tests/e2e/lottery.spec.ts tests/e2e/map-visual.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
```

## Risks

1. **High — collection/proximity leak committed travel or a lottery result.** One private visible-traversal
   projection; Step 3 phase matrix incl. classic, Skip, pending discard, deadhead.
2. **High — desktop row exceeds the ~24px slack or ~286px width** (two 12px lines, 10-11px counters at 1,586/134).
   Step 7 E2E with real totals and the two existing populated no-scroll gates; fix layout, never relax. Readability of
   10-11px text is a product risk (see open items).
3. **High — milestone toast lost by the queue cursor** (lower negative index after an item event). Milestones only
   after movement completes and before same-turn item events; Step 4/5 order tests.
4. **Medium — hamburger focus/Escape regressions** (competing listeners, stale pill opener, breakpoint change).
   Embedded children relinquish Escape; Step 11 unit + Step 13 edited pill tests on both projects.
5. **Medium — replayed flash or announcement** after resume or re-render. Stable keys, `entryTurn`, toast baseline,
   consumed-key set; Step 14 browser lifecycle.
6. **Medium — phone test churn larger than listed.** Step 12 runs every helper-covered phone title on the legacy UI
   first, so any miss surfaces before integration.
7. **Low — aggregation cost during animation.** Linear pure helpers; memoise only if measured.

## Open items (need user confirmation; plan proceeds on these defaults)

1. A hidden on Yamanote / distance 0 / after 30/30; tie → no parenthetical; 「駅」 = gameplay hops (D1, D2, D4).
2. Deadhead: destination counts as 訪れた駅, the relocation does not count as 乗った路線 (D7).
3. B: highest threshold only per turn; copy as D11; 演出なし/reduced motion keep toast + announcement, no flash; jump to
   30 shows only the existing toast; no replay on resume (D9–D14).
4. The once-only announcement also fixes the known #62 residual (30/30 announced twice on Skip during arrival) (D12).
5. Short landscape: A and C appear only at the top of the log, not in the HUD (D17) — A is not visible at a glance there.
6. Desktop C uses 10-11px text in the right ~100px of the new row (D15).
7. "Legend ON" = all lines visible + static legend in 設定 as today; the 134-group list stays collapsed (D19).
8. Phone hamburger opens on the log section; the #66 pill opens the same hamburger at the log (D18, D20).
9. A and C update per displayed hop during movement (D3, D5).
10. Size: 14 steps, ~1,400–1,900 LOC incl. tests (larger than one ~150-line step per sub-feature because D needs
    four steps to keep every commit green). Pacing (pause per step or continuous) and implementer lane to confirm.
