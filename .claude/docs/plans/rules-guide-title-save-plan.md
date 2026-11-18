# Issues #60 + #68 rules guide and title / save UX — plan

Branch `feature/rules-guide-title-save` (from develop a8fc2b7, v0.16.0). One PR → develop.
Status: **plan only, not approved, nothing implemented.** Codex validation: **PASS** (round 3, after 2 revision rounds; see "Validation verdict").

Sources (read for full text; this plan overrides them where they conflict):
- Brief: `.claude/docs/research/feature-rules-guide-and-title-save-ux-brief.md` (user decisions binding)
- Scan: `.claude/docs/research/feature-rules-guide-and-title-save-ux-codebase.md`
- Codex scope: `.claude/logs/codex/20261117T012737Z-rgts-scope.md` (COMPLEX)
- Codex architecture: `.claude/logs/codex/20261117T013256Z-rgts-arch.md`
- Codex plan: `.claude/logs/codex/20261117T013724Z-rgts-plan.md`
- Codex validation: `.claude/logs/codex/20261117T014327Z-rgts-validate.md` (NEEDS_REVISION → applied below as
  "Revision 1"), re-validation: see end.

## Scope Assessment

COMPLEX: about 37-47 files. Codex's first estimate was 1,500-2,250 handwritten lines. After the validation splits,
the plan totals about 3,200 lines incl. tests and CSS. Presentation only. The hard parts are save-success identity,
pending-aware resume numbers, toast/live-region delivery, focus handoff around native dialogs, and the map
title/game mode transitions — not the rules text itself.

## Decisions

### User (2026-11-17, binding — see brief "Scope")
1. All of #60 and #68 in one PR; presentation only (engine, RNG, save format/version, data unchanged).
2. Short title copy (≤ 3 short sentences: 新橋 start, all 30 segments of 山手線外回り, lottery at transfer stations,
   items to finish in fewer turns) + 「遊び方」 button.
3. One shared rules body (title + in-game modal), sections goal / lottery / items / controls / save, numbers from
   `edition.config`, prose from `docs/manual/tokyo-suburban/rules.md` shortened, phone reduced variant,
   shortcuts only under `(hover: hover) and (pointer: fine)`.
4. Entry points: menu 「遊び方」, item card 「詳しく」 → items, persistent lottery result 「詳しく」 → lottery;
   section-id API reusable by #67.
5. First-save toast 「自動で保存しています。いつでも閉じて、続きから遊べます」 once per browser after the first
   completed turn's successful save; separate key without "save"; live-region announcement; fixtures seeded.
6. Tappable save mark + popover; phone HUD 252px at 320x568 unchanged.
7. 「つづきから　踏破 N/30・Mターン目から・駅」, M = next turn to play; same counting in the overwrite confirm.
8. 「セーブを削除」 = small low-emphasis link under 「つづきから」; confirm flow and names unchanged.
9. Title background = Yamanote overview fitted for the title; SVG loop placeholder while loading; controls hidden.
10. Pause after every step; Luna implements, Sol low reviews, lead verifies; targeted local E2E, full matrix in CI.

### Codex (scope / architecture), adopted
- Map controls (zoom, 全体, 目標路線) hidden on title, while loading, on the clear screen and on the
  network-failure title; attribution and map error / retry UI stay.
- Wording: the lottery can draw the current line again — the title copy must not promise a forced change.
- Title rules = Credits-style sub-screen (`"title" | "credits" | "rules"`); in-game = native `<dialog>`.
- Menu 「遊び方」 goes **outside** `.game-panel__options` (the 5-button tests stay byte-identical); PhoneGameMenu
  inherits it through the embedded `GameMenu` (not edited).
- Lottery 「詳しく」 goes on the persistent `<p className="game-panel__lottery">` that `GamePanel` passes to
  `TurnLogDrawer`; never on `LotteryReveal` / `TurnMomentHost` (aria-hidden, click-to-skip).
- Save-mark explanation renders **outside** `.game-panel__save`, so its exact `textContent` / `title` tests hold.
- First-save notice: explicit queue entry kind (no synthetic `(turn, eventIndex)`), key
  `yamanote-line-sugoroku:notice:auto-resume:v1` value `"1"`, flag persisted only after actual visible,
  announceable display; in-memory guard if the write fails.
- Shortcut gating is CSS-only (default hidden, shown under `(hover: hover) and (pointer: fine)`), also applied to
  the existing `.game-panel__shortcut-hint` (text unchanged; no existing assertion changes — verified by Codex).

### Lead amendments (accepted by Codex in the plan consult)
- `buildRulesGuide(config, { targetSegmentCount? })`: the count comes from `targetSegmentIds(edition.config,
  network).size` when the network is loaded; the goal prose omits the number when absent. No literal 30 in the
  rules model. (Intentional change from the architecture's count-free body.)
- About 10-14 steps targeted; the validation then split 7 steps (Revision 1), giving **21 paused steps**. Each step is at most
  ~200 handwritten changed lines incl. tests and CSS.

### Verified turn semantics (Codex scope, from `itemTurnPreparation.ts:49`, `itemTurn.ts:27/123/128-148`)
| Save | 「Mターン目から」 | Station / 踏破 from |
|---|---|---|
| playing, no pending | `game.turn + 1` | top-level position |
| pending roll | `pending.turn` (= `game.turn + 1`) | top-level position |
| pending discard | `pending.turn` (= `game.turn + 1`) | `pending.position` |
| completed | label unchanged `クリア結果を見る（Cターンでクリア）` | final position |

Never `pending.position.turn + 1` for a pending discard (that is the turn after the discard). 踏破 = unique
`completedSegmentIds` ∩ `requiredIds` of the chosen position (history is stripped by `titleSave`, not needed).

## Architecture

Five presentation parts, connected by explicit callbacks and save-result identities. The session stays mounted.
The save and settings formats stay unchanged.

1. **Rules model + shared body.** Pure `rulesGuide.ts` → `RulesGuide.tsx`. Hosts: the title sub-screen and
   `RulesDialog.tsx` (native modal).
2. **Resume presentation.** Pure `resumePresentation.ts`, used by the title button and the overwrite confirm.
3. **Save-status popover.** Pure `saveStatusPresentation.ts` + `SaveStatusPopover.tsx` inside `GameHud`.
4. **First-save notice.** `useGameApp` publishes `SaveAttempt`, then `saveNotice.ts` checks eligibility. The flag
   lives in `store/notices.ts`. The `toastQueue` notice entry is delivered through the `useFirstTurnNotice` hook,
   and the existing `GamePanel` status region announces it.
5. **Map mode.** `RailwayMap` gets `mode: "title" | "game" | "clear"`. Mode controls the title camera, the paint
   readiness latch (`TitleMapPlaceholder` SVG) and navigation visibility. `EditionApp` loading and failure paths
   render the same title, rules and placeholder.

### Module Structure
| File | Change |
|---|---|
| new `src/features/game/resumePresentation.ts` | resume turn, position, progress, label, overwrite text |
| new `src/features/game/rulesGuide.ts` | `RulesSectionId`, `OpenRules`, model, config-derived figures, prose |
| new `src/features/game/components/RulesGuide.tsx` | shared body, section nav, item rows (ItemIcon) |
| new `src/features/game/components/RulesDialog.tsx` | native modal, subtitle, section targeting, focus restore |
| new `src/features/game/saveStatusPresentation.ts` | status label + explanation model |
| new `src/features/game/components/SaveStatusPopover.tsx` | trigger, Popover API + inline fallback |
| new `src/features/game/saveNotice.ts` | `SaveAttempt`, eligibility, notice text, announcement arbitration |
| new `src/features/game/store/notices.ts` | notice flag on injected `StorageLike`, failure-safe |
| new `src/features/game/useFirstTurnNotice.ts` | pending → shown → persisted lifecycle |
| new `src/features/map/components/TitleMapPlaceholder.tsx` | decorative inline SVG loop |
| modify `src/features/editions/registry.ts` | shortened `ruleParagraphs` (type unchanged) |
| modify `TitleScreen.tsx`, `GameApp.tsx`, `EditionApp.tsx` | rules sub-screen, resume model, delete link, model supply, notice wiring, map mode, loading title |
| modify `useGameApp.ts` | shared write helper publishing `saveAttempt` (acknowledgements unchanged) |
| modify `GamePanel.tsx`, `GameMenu.tsx`, `InventoryPanel.tsx`, `ItemCard.tsx` | entry points, fallback focus, `rulesOpen` suspension, live-region handshake |
| modify `GameHud.tsx` | save status via popover component |
| modify `toastQueue.ts`, `ToastHost.tsx` | notice entry kind, announceability input, shown callback |
| modify `RailwayMap.tsx`, `camera.ts` | mode prop, title fit helper, paint latch, controls visibility |
| modify `src/styles.css` | `.rules-guide*`, `.rules-dialog*`, `.save-status*`, `.title-screen__resume*`, `.title-map-placeholder*` |

Not edited: engine, RNG, `persistence.ts` serialization, `settings.ts`, `src/types/network.ts`, `public/`, `data/`,
`PhoneGameMenu.tsx`, `LotteryReveal.tsx`, `TurnMomentHost.tsx`, `useGameShortcuts.ts`, `autoRoll.ts`,
dependencies, version.

### Interface Design (contracts; full rationale in the architecture log)

```ts
// rulesGuide.ts
export type RulesSectionId = "goal" | "lottery" | "items" | "controls" | "save";
export type OpenRules = (sectionId?: RulesSectionId) => void;
export interface RulesGuideItem { readonly kind: ItemKind; readonly name: string; readonly effect: string; readonly timing: string; }
export interface RulesGuideSection { readonly id: RulesSectionId; readonly heading: string; readonly paragraphs: readonly string[]; }
export interface RulesGuideModel { readonly sections: readonly RulesGuideSection[]; readonly items: readonly RulesGuideItem[]; readonly shortcuts: readonly string[]; }
export interface RulesGuideOptions {
  readonly targetSegmentCount?: number;
  // Added during 2A/2B (lead decision 2026-11-17): proper names are injected, never hard-coded.
  readonly targetServiceName?: string;     // fallback 「目標路線」
  readonly startStationName?: string;      // fallback 「出発駅」
  readonly targetDirectionLabel?: string;  // no fallback; direction sentences omitted when absent
}
export function buildRulesGuide(config: GameConfig, options?: RulesGuideOptions): RulesGuideModel;
```
Figures: target share from `serviceLottery.target` (`"share"` → numerator/denominator; `"weight"` → relative wording,
no fixed probability); other routes equal only when `kindWeights` are equal; direction
`towardTargetWeight : (awayFromTargetWeight ?? 1)` plus equal-distance / single-direction prose; pickup
`dropChancePerMille / 10` %; harmful `harmfulChancePercent` % *of pickups*; capacity, max active items per turn,
delay / suspension turns from `itemPolicy`; item rows only for configured `beneficialKinds` / `harmfulKinds`.
Names and effects from `ITEM_DESCRIPTIONS`, except delay and suspension, which are rebuilt with config durations.
`itemTiming` applies to beneficial items; harmful items say "拾うと自動で発動". Classic config without `itemPolicy`
keeps the items section with "このルールではアイテムはありません". Speed and 演出 labels come from `ANIMATION_SPEEDS` /
`PRESENTATION_LEVELS`. Shortcuts: Space / Enter roll, S / Escape skip, Escape clears an item draft, Escape keeps
the roll in the 出目調整 dialog.

```ts
// RulesGuide.tsx / RulesDialog.tsx
export interface RulesGuideProps { model: RulesGuideModel; idPrefix: string; }
export interface RulesDialogProps {
  model: RulesGuideModel; sectionId?: RulesSectionId;
  returnFocus: HTMLElement | null; getFallbackFocus: () => HTMLElement | null; onClose: () => void;
}
export interface RulesRequest { readonly sectionId?: RulesSectionId; readonly returnFocus: HTMLElement | null; }
```
`GameApp` owns `RulesRequest | null` and passes `openRules` down as props (no context). The dialog subtitle reads
「ゲームの進行はそのままです。閉じると続きから遊べます。」. Focus restores to a connected, visible, enabled opener
outside hidden/inert subtrees. Otherwise the `GamePanel` fallback takes focus: menu trigger → dice → panel heading.
Section ids are prefixed. Section headings are focusable (`tabIndex=-1`) and scrolled with
`scrollIntoView({ block: "start" })`, without animation. A plain open focuses the guide title.

```ts
// resumePresentation.ts
export interface ResumePresentation { readonly label: string; readonly nextTurn: number | null; readonly stationText: string; readonly completedCount: number; readonly requiredCount: number; }
export function resumeTurn(game: SavedGameState): number | null;
export function buildResumePresentation(game: SavedGameState, network: RailwayNetwork, requiredIds: ReadonlySet<string>, presentation?: PresentationResolver): ResumePresentation;
export function overwriteProgressText(game: SavedGameState): string; // 「5ターン目から再開」 / 「96ターンでクリア」
```
Label example: `つづきから　踏破 7/30・5ターン目から・新橋`. The overwrite confirm reads
`保存中のゲーム（5ターン目から再開）は上書きされます。…`.

```ts
// saveNotice.ts / store/notices.ts
export interface SaveAttempt { readonly id: number; readonly sessionId: number; readonly game: SavedGameState; readonly result: SaveWriteResult; readonly entryTurn: number; }
// GameAppControls gains: saveAttempt: SaveAttempt | null
export function isFirstTurnNoticeEligible(attempt: SaveAttempt | null, currentSessionId: number | null, alreadyDelivered: boolean): boolean;
export const FIRST_TURN_NOTICE_KEY = "yamanote-line-sugoroku:notice:auto-resume:v1";
export function readFirstTurnNotice(storage: StorageLike | null): boolean;   // "1" only; errors → false
export function writeFirstTurnNotice(storage: StorageLike | null): boolean;  // errors → false
export const FIRST_TURN_NOTICE_TEXT = "自動で保存しています。いつでも閉じて、続きから遊べます";
```
Eligible = current session ∧ result `"saved"` ∧ `game.turn >= 1` ∧ `game.turn > entryTurn` ∧ not delivered.
`entryTurn` is the top-level turn when the session was created or resumed. `id` increases per distinct write.
Repeated effects for the same write reuse the same id. Resuming a turn-10 save shows nothing at once; the
successful save of turn 11 qualifies. A failed save followed by a later success qualifies once.

```ts
// toastQueue.ts / ToastHost.tsx
export interface NoticeToastInput extends ToastInput { readonly kind: "notice"; }
// ToastInput gains optional kind?: "turn" | "notice"; queue gains enqueueNotice (bypasses and never advances the
// cursor, per-scope dedupe, survives old-turn pruning, shares FIFO and the two ordinary slots; slot 3 stays reserved
// for save failure).
// ToastHost gains: notice?: NoticeToastInput | null; announceable?: boolean; onNoticeShown?: (key: string) => void;
```
`onNoticeShown` fires once, when the notice is visible and the host is not obscured, the document is visible and
`announceable` is true. While hidden, obscured or not announceable, the notice's reading clock does not run.

```ts
// RailwayMap.tsx / camera.ts
export type RailwayMapMode = "title" | "game" | "clear";   // prop `mode`, default "game" for compatibility
export const TITLE_FIT_PADDING_PHONE_PX = 24; export const TITLE_FIT_PADDING_PX = 48; // named, clamped helper
export function titleFitPadding(viewport: { width: number; height: number }, phone: boolean): PaddingOptions;
```
Title mode fits the target service with symmetric padding and no panel padding. It re-fits when railway layers
appear, on entry into title mode and on resize. Follow, overview and preview effects run only in game mode.
`mode` is a dependency of the effects that must re-run on mode entry, but never of map construction. Clear mode
does not touch the camera. Paint readiness needs railway layers, the first `load`, a later `render` and the next
animation frame. It never waits for `idle`, resets on retry, and ignores stale callbacks. Navigation is visible
only in game mode with layers ready and no fatal failure.

### Data Flow
- Rules, title: 「遊び方」 → `view = "rules"`. `main aria-labelledby` points to the rules `h1` (the Credits
  pattern). Escape or 戻る returns to the title and focuses the 「遊び方」 button.
- Rules, in game: the menu, the item card or the lottery result calls `openRules(sectionId)`. `GameApp` captures
  the opener and mounts `RulesDialog` next to `GamePanel`, which stays mounted. `rulesOpen` feeds
  `confirmationOpen`-style suspension (auto-roll and shortcuts), ToastHost `obscured` and notice readiness. A
  decision that becomes ready while the rules are open (adjust, discard) keeps its state. Its modal appears only
  after the rules close. Closing restores focus to the opener or the fallback. No game action is dispatched on
  open or close.
- First-save notice: `useGameApp` publishes `saveAttempt`. `useFirstTurnNotice` checks eligibility and keeps the
  notice pending until the turn's publication boundary is reached and no decision, confirm or rules dialog is
  open. It then enqueues the notice through ToastHost. On `onNoticeShown` it marks the notice delivered in
  memory, writes the flag, and sends one announcement request to `GamePanel`. An announcement selector gives
  ordinary turn and auto-roll announcements priority, so the notice speaks on a later commit, once. If the player
  returns to the title before delivery, the flag stays unset.
- Map: `GameApp` derives the mode: `screen === "title"` → title, `showClear` → clear, otherwise game.
  `EditionApp` loading and failure render the title with `TitleMapPlaceholder`, and the failure path passes
  `mode="title"` to `RailwayMap`.

### Error Handling Strategy
- Notice read fails → treated as unset. Notice write fails → the in-memory guard stays set, so it is not shown
  again in this mount. A reload may show it again. Durable once-only is not claimed when storage refuses writes.
- Save failed or unavailable → no notice; the existing sticky failure toast is unchanged. Stale success and
  restored baselines are rejected by identity.
- Popover API missing → inline fallback with `hidden`, Escape and focus restore. Opening the rules closes an open
  save popover without restoring focus into the modal background.
- Map style failure or WebGL unsupported → the SVG stays, attribution, error and retry stay, navigation is
  hidden. A retry resets readiness.
- Data loading or failure → rules are available from config without a target count. Play actions keep the
  existing behaviour: absent while loading, disabled on the failure title.
- Storage helpers catch storage errors only. No other error is swallowed.

## Shared rules for every step (Luna must follow)
1. Self-contained prompt per step (`rules-guide-title-save-prompts.md`): only the files the step lists, no next step.
2. TDD for new behaviour: write failing tests first, then the smallest complete change.
3. Each step leaves the app shippable: `npm run typecheck`, `npx vitest run` (full) and `npm run build` pass.
   Preparatory modules may stay unconnected. No placeholders or TODOs.
4. At most ~200 handwritten changed lines (source + CSS + unit + E2E + fixture + changed existing expectations).
   No minified or dense code to fit; if a step cannot fit, stop and report a split.
5. Forbidden: `src/features/game/engine/**`, RNG, `src/features/game/store/persistence.ts` serialization, save
   format or version, `src/features/game/store/settings.ts` format, `src/types/network.ts`, `public/**`, `data/**`,
   `package.json`, lockfiles, version numbers.
6. Existing tests change only where a step lists them under "Deliberate existing-test edits". The following stay
   byte-identical:
   - engine, RNG and save-format test files, and `tests/unit/toast.test.ts`;
   - toast and milestone text, count and order;
   - the completed resume label;
   - the five `.game-panel__options` assertions;
   - HUD height, overlap, safe-area and desktop no-scroll assertions;
   - the delete-confirm names.

   Never skip a test, weaken an assertion or broaden a selector to mask a failure. If an unlisted existing test
   fails, stop and report it.
7. Conventions:
   - TypeScript strict, named exports, `XxxProps`, `React.JSX.Element`, type annotations, early returns,
     immutable updates, no `any`.
   - Named constants: no magic numbers, including padding px, 44px targets and gaps (TS constants or CSS custom
     properties).
   - New BEM classes only (`.rules-guide*`, `.rules-dialog*`, `.save-status*`, `.title-screen__resume*`,
     `.title-map-placeholder*`).
   - Visible Japanese prose goes through `PhraseText`. aria, title and live-region strings stay plain.
   - Storage only through injected `StorageLike`.
8. E2E: targeted specs only, `--workers=2`. For any case tagged `@layout` use the grep `'TITLE(?: @layout)?$'`
   (Playwright matches tags as part of the title). Run the command with `--list` first and check that the intended
   case and project are selected. Never use `--pass-with-no-tests`. Tag phone cases `{ tag: "@layout" }`. Never
   use `pkill -f` / `pgrep -f`. Firefox locally needs `xvfb-run -a`, WebKit locally needs `E2E_WEBKIT=1` (normally
   CI only).
9. Do not commit or change git state. Preserve the untracked research and plan documents.
10. Report: changed files, actual handwritten LOC, commands and pass/fail counts, screenshots under
    `.claude/logs/screenshots/rgts-<step>-*.png`, deliberate existing-test edits, deviations, risks.

Common acceptance for every step (in addition to the step's own commands):
```bash
npm run typecheck && npx vitest run && npm run build
```

## Implementation Plan (21 paused steps, Revision 1)

Each step runs the same loop: Luna implements → lead verifies → Sol low reviews → commit and push → CI check →
user pause. Steps marked "(no visual)" change nothing on screen.

| Step | Title | LOC (src/CSS/tests) |
|---|---|---|
| 1A | Resume presentation model (no visual) | 40/0/70 = 110 |
| 1B | Resume label + overwrite confirm + delete link | 30/15/90 = 135 |
| 2A | Rules model: interfaces and config figures (no visual) | 55/0/55 = 110 |
| 2B | Rules model: full sections, items, prose (no visual) | 70/0/60 = 130 |
| 3 | Shared `RulesGuide` body + phone reduction (unrouted) | 55/35/60 = 150 |
| 4 | Title 「遊び方」 sub-screen + short title copy | 75/15/100 = 190 |
| 5 | `RulesDialog` lifecycle (unrouted) | 65/25/105 = 195 |
| 6A | Menu + lottery entry points, `rulesOpen` suspension | 70/5/110 = 185 |
| 6B | Item-card 「詳しく」 handoff + pointer visibility E2E | 45/0/100 = 145 |
| 7A | Save-status model + standalone popover (unrouted) | 75/30/80 = 185 |
| 7B | HUD integration + hit area + geometry | 25/15/70 = 110 |
| 8A | Save-attempt identity in `useGameApp` (no visual) | 60/0/90 = 150 |
| 8B | Notice store, eligibility, announcement arbitration (no visual) | 60/0/80 = 140 |
| 9 | Toast queue notice entry + host announceability (no visual) | 65/0/125 = 190 |
| 10A | Notice hook + fixture seeding (no visual) | 50/0/90 = 140 |
| 10B | Visible notice delivery + live region | 60/0/110 = 170 |
| 11 | Map modes + title camera | 80/0/115 = 195 |
| 12A | Paint readiness + SVG placeholder + retry | 60/15/100 = 175 |
| 12B | Navigation visibility + layout readiness waits | 25/10/70 = 105 |
| 13 | EditionApp loading / failure title paths | 50/5/110 = 165 |
| 14 | Final integration + boundary audit | 0/0/110 = 110 |
| | **Total** | **≈ 1,115 / 170 / 1,910 ≈ 3,200** |

Steps 5, 6A, 7A, 9, 11 and 12A are close to the cap. Before Luna starts each of them, the lead runs a LOC preflight
(the prompt asks Luna to stop and report a split rather than compress).

### Step 1A — Resume presentation model (no visual)
- Files: new `src/features/game/resumePresentation.ts`; new `tests/unit/resume-presentation.test.ts`.
- Interfaces: `ResumePresentation`, `resumeTurn`, `buildResumePresentation`, `overwriteProgressText` (above).
- Tests first, in a table-driven `resume-presentation.test.ts`:
  - `plays the turn after the last completed turn`
  - `uses pending roll turn`
  - `uses pending discard turn and arrival position` (the fixture's pending position must differ from the
    top-level one)
  - `counts unique completed target segments only`
  - `preserves the completed resume label`
  - `shares next-turn wording with overwrite confirmation`
- Deliberate existing-test edits: none.
- Acceptance: `npx vitest run tests/unit/resume-presentation.test.ts` + common.
- Pause review: the label strings for every case (printed in the report).
- Risks: the denominator comes from `requiredIds.size`, not a literal.

### Step 1B — Resume label, overwrite confirm, delete link
- Files:
  - modify `TitleScreen.tsx`: `resumeLabel` from the model; `.title-screen__resume` group with the resume button
    and, directly below, the delete button styled as a transparent, underlined, small link with a 44px min height;
  - modify `GameApp.tsx`: overwrite confirm via `overwriteProgressText`; pass `requiredIds` to the title;
  - modify `src/styles.css`;
  - new `tests/e2e/title-save-ux.spec.ts`.
- Tests first (E2E):
  - `resume shows progress and next turn`
  - `delete stays secondary and preserves confirmation`
  - `resume progress wraps on a narrow title` (`@layout`)
- Deliberate existing-test edits: only the playing-save resume labels, changed to the new exact progress / next
  turn wording, in these six existing specs: `resume.spec.ts` (~L64, L111, L229), `real-data.spec.ts` (~L363),
  `map-failure.spec.ts` (~L60), `lottery.spec.ts` (~L71), `capital-region.spec.ts` (~L224),
  `ui-pop-turn-moments.spec.ts` (~L248). Completed labels and confirm names stay byte-identical. No selector
  loosening.
- Acceptance (+ common):
  ```bash
  npx playwright test tests/e2e/title-save-ux.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/resume.spec.ts tests/e2e/real-data.spec.ts tests/e2e/map-failure.spec.ts tests/e2e/lottery.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/title-save-ux.spec.ts --project=phone-chromium --workers=2 --grep 'resume progress wraps on a narrow title(?: @layout)?$'
  ```
- Pause review: screenshots of the title with a normal, a pending-discard and a completed save, at desktop and
  320x568; delete link hit area.
- Risks: existing title layout assertions. Codex verified that none depend on the old button order; re-run
  `layout.spec.ts` if anything moves.

### Step 2A — Rules model: interfaces and config figures (no visual)
- Files: new `src/features/game/rulesGuide.ts` (types, `buildRulesGuide` skeleton returning complete lottery and
  item-policy figures); new `tests/unit/rules-guide.test.ts`.
- Tests first:
  - `derives share lottery figures from config`
  - `describes weighted lottery without a fixed probability`
  - `handles unequal route weights and direction exceptions`
  - `derives pickup and conditional harmful probability`
  - `derives capacity activation limit and durations`

  Use changed-config fixtures with values different from production.
- Deliberate existing-test edits: none. Acceptance: `npx vitest run tests/unit/rules-guide.test.ts` + common.
- Pause review: the figure strings.
- Risks: no literal production numbers in the module.

### Step 2B — Rules model: full sections, items, prose (no visual)
- Files: `rulesGuide.ts`, `rules-guide.test.ts` (extend the new files only).
- Content: all five sections. Goal: N segments, then stop at 新橋 (Yamanote stops at 新橋, other lines must stop
  exactly), and leftover pips at a terminus, area edge or system edge are discarded. Lottery: the current line can
  be drawn again. Items: configured rows; delay and suspension effects rebuilt with config durations; harmful rows
  say they activate automatically. Controls: 速度 / 演出 / おまかせで進む / 追尾. Save: saved every turn, can close
  and resume. Also the shortcuts list.
- Tests first:
  - `renders only configured item kinds`
  - `uses automatic timing for harmful items`
  - `keeps an unavailable items section for classic rules`
  - `includes target count only when supplied`
  - `uses settings labels from their existing tables`
  - `overrides delay and suspension durations from config`
- Deliberate existing-test edits: none. Acceptance: as 2A.
- Pause review: the full Japanese copy, printed in the report.
- Risks: `ITEM_DESCRIPTIONS` itself stays unchanged.

### Step 3 — Shared `RulesGuide` body + phone reduction (unrouted)
- Files: new `src/features/game/components/RulesGuide.tsx`; `src/styles.css` (`.rules-guide*`: section nav,
  stacked item rows on `(max-width: 600px)`, nav and duplicate timing detail hidden on phones,
  `.rules-guide__shortcuts` hidden by default and shown under `(hover: hover) and (pointer: fine)`); new
  `tests/unit/rules-guide-components.test.ts`.
- Tests first:
  - `renders all five labelled sections with prefixed ids`
  - `renders configured item icons names and effects`
  - `navigation focuses the requested section`
  - `keeps shortcut content semantically separate`
  - `marks only duplicate detail for phone reduction`
- Acceptance: `npx vitest run tests/unit/rules-guide-components.test.ts` + common.
- Pause review: DOM and CSS; no public route yet.
- Risks: phones hide only the nav and duplicate detail, never a section, a probability, an icon, a name or an
  effect.

### Step 4 — Title 「遊び方」 sub-screen + short title copy

> Amendment (2026-11-17, after 2B review): every `buildRulesGuide` caller with a network passes `targetServiceName` (target service display name), `startStationName` (start station name) and `targetDirectionLabel` (`directionLabel(network, targetServiceId, targetDirection)`, `presentation.ts`) in addition to `targetSegmentCount`.
- Files:
  - `TitleScreen.tsx`: view `"title" | "credits" | "rules"` and an optional `rulesModel` prop. **When `rulesModel`
    is absent, the 「遊び方」 button is not rendered.**
  - `registry.ts`: short `ruleParagraphs`, at most 3 short sentences that do not promise a line change.
  - `GameApp.tsx`: `buildRulesGuide(edition.config, { targetSegmentCount: requiredIds.size })`.
  - `EditionApp.tsx`: the existing multi-edition loading and failure TitleScreens get the model without a count.
    The single-edition loading layout is Step 13.
  - `src/styles.css`; extend `rules-guide-components.test.ts`; new `tests/e2e/rules-guide.spec.ts`.
- Tests first:
  - unit: `title rules screen changes main naming and restores focus`, `Escape returns from rules without opening
    credits`, `title without network renders rules without a target count`;
  - E2E: `title rules navigation restores focus`, `rules retain essential content on phone` (`@layout`).
- Deliberate existing-test edits:
  - `tests/unit/edition-registry.test.ts`: the exact `ruleParagraphs` value;
  - `tests/e2e/layout.spec.ts` (~L148-151): the exact first title paragraph.

  `credits-screen.test.ts` stays unchanged: its networkless fixture passes no `rulesModel`, so no 「遊び方」 button is
  added and the button order stays as it is today. Note (Revision 2): its first button is the disabled はじめから,
  not クレジット, so its existing Escape case never proves that Credits opened. This false positive predates this
  feature and is out of scope; record it as a follow-up.
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/rules-guide-components.test.ts tests/unit/edition-registry.test.ts tests/unit/credits-screen.test.ts
  npx playwright test tests/e2e/rules-guide.spec.ts tests/e2e/layout.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/rules-guide.spec.ts --project=phone-chromium --workers=2 --grep 'rules retain essential content on phone(?: @layout)?$'
  ```
- Pause review: short title and all five sections, desktop and 320x568; return focus; scrolling.
- Risks: Credits and the rules view stay mutually exclusive; the title disabled-state logic is unchanged.

### Step 5 — `RulesDialog` lifecycle (unrouted)
- Files: new `src/features/game/components/RulesDialog.tsx` (`.rules-dialog`: wider than `.dialog`, internal
  scroll, safe-area max-height); `src/styles.css`; new `tests/unit/rules-dialog.test.ts`.
- Tests first:
  - `opens natively and focuses the guide title`
  - `focuses and scrolls to a requested section`
  - `cancel requests React closure without closing early` (the stub keeps `open` until unmount)
  - `restores a connected visible enabled opener`
  - `rejects hidden inert disabled and disconnected openers`
  - `uses the fallback when the opener disappears`
  - `closing Escape does not reach the game shortcut handler`
  - `StrictMode replay keeps the dialog open and focused`
- Acceptance: `npx vitest run tests/unit/rules-dialog.test.ts` + common.
- Pause review: semantics, the subtitle 「ゲームの進行はそのままです。閉じると続きから遊べます。」, scroll
  containment.
- Risks: never call `dialog.close()` synchronously in keydown; validate the opener before restoring focus.

### Step 6A — Menu + lottery entry points, `rulesOpen` suspension

> Amendment (2026-11-17, from the Step 5 review). RulesDialog contracts for 6A/6B:
> 1. Capture the opener from `event.currentTarget`, never `document.activeElement` (Safari does not focus buttons on click).
> 2. `getFallbackFocus` walks menu trigger → dice → panel heading with the exported `isFocusRestorable`; on phones resolve the phone menu trigger (the desktop trigger is not rendered).
> 3. RulesDialog restores focus in a microtask and yields if another `dialog[open]` exists, so render a deferred RollAdjustment/DiscardChoice in the same commit as the rules unmount (gated on `!rulesOpen`); check GamePanel's restore-roll-focus effect (~`GamePanel.tsx:423`) does not fight the opener restore.
> 4. `rulesOpen` is React state at render time; autoRoll/useGameShortcuts keep detecting `dialog[open]` after the layout effect.
> 5. Escape: the closing Escape sees `dialog.open === true`; capture-phase Escape handlers must not `preventDefault`. The E2E presses Escape once.
> 6. (6B) `showModal()` hides an open item-card popover; test that the card's cleanup does not steal focus from the rules dialog.
- Files:
  - `GameApp.tsx`: `RulesRequest` state, `openRules`, renders `RulesDialog`, `rulesOpen` passed to `GamePanel` and
    to ToastHost `obscured`;
  - `GamePanel.tsx`: the lottery 「詳しく」 button inside the persistent `.game-panel__lottery` (visible text
    詳しく, accessible name 抽選のルールを詳しく見る); a stable fallback-focus resolver; `rulesOpen` merged into
    the existing `confirmationOpen`-style auto-roll and shortcut suspension; decision modals (`RollAdjustment`,
    `DiscardChoice`) **deferred** while `rulesOpen`, with their state retained. Only modal rendering is gated:
    auto-roll keeps receiving the original `turnDisplay.decision`, so its adjust and discard waits stay intact. When
    the rules close with a retained decision, the decision modal gets the final focus, and opener restoration must
    not pull focus behind it;
  - `GameMenu.tsx`: a 遊び方 button immediately after `.game-panel__options`, before the legend;
  - `src/styles.css`: `.game-panel__shortcut-hint` hidden by default, shown under
    `(hover: hover) and (pointer: fine)`, text unchanged;
  - new `tests/unit/rules-entry-points.test.ts`; extend `tests/e2e/rules-guide.spec.ts`.
- Tests first:
  - unit: `menu rules action sits outside the five options`, `persistent lottery details targets lottery`,
    `auto-roll stays paused while rules are open`, `movement completing under rules keeps focus in the guide`,
    `a decision ready under rules appears after closure`;
  - E2E: `menu rules preserves draft and saved progress`, `lottery details open the lottery section`,
    `closing rules Escape does not skip or clear draft`.
- Deliberate existing-test edits: none. `accessibility.spec.ts` L87-93 and `game-hud.test.ts` L355-369 must pass
  unchanged (verified: text and tab-stop assertions only; desktop has a fine pointer).
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/rules-entry-points.test.ts tests/unit/rules-dialog.test.ts tests/unit/game-hud.test.ts tests/unit/phone-game-menu.test.ts
  npx playwright test tests/e2e/rules-guide.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2 --grep 'the menu owns shortcuts and its hint adds no tab stop(?: @layout)?$'
  npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2 --grep 'menu, log, and item card transitions preserve a selected draft(?: @layout)?$'
  npx playwright test tests/e2e/auto-roll-lifecycle.spec.ts --project=desktop-chromium --workers=2
  ```
- Pause review: menu and lottery entry, section landing, progress preserved, phone menu.
- Risks: define `rulesOpen` once and use it for all suspension. Render-time protection must not rely only on the
  dialog's layout effect.

### Step 6B — Item-card 「詳しく」 handoff + pointer visibility
- Files (Revision 2):
  - `GamePanel.tsx`: forward the existing `openRules` to `InventoryPanel`;
  - `InventoryPanel.tsx`: a typed rules callback prop; focus the durable inventory slot trigger, call
    `openRules("items")`, then close the card without cleanup stealing dialog focus;
  - `ItemCard.tsx`: a 「詳しく」 action next to the footer actions (accessible name アイテムのルールを詳しく見る),
    plus callback plumbing through its existing wrappers;
  - extend `rules-entry-points.test.ts` and `rules-guide.spec.ts`.

  Do not pre-implement the InventoryPanel interface in 6A.
- Tests first:
  - unit: `item details captures the inventory trigger before card closure`, `card cleanup does not steal dialog
    focus` (native and fallback popover), `missing opener falls back to the panel`;
  - E2E: `item details open the items section`, `rules shortcuts follow pointer capabilities` (`@layout`; checks
    computed visibility of `.rules-guide__shortcuts` and `.game-panel__shortcut-hint` on fine vs coarse pointer).
- Deliberate existing-test edits: none.
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/rules-entry-points.test.ts tests/unit/item-controls.test.ts
  npx playwright test tests/e2e/rules-guide.spec.ts tests/e2e/items.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/rules-guide.spec.ts --project=phone-chromium --workers=2 --grep 'rules shortcuts follow pointer capabilities(?: @layout)?$'
  ```
- Pause review: the item card path, the focus after close, the phone sheet card.
- Risks: `PhoneGameMenu`, `LotteryReveal` and `TurnMomentHost` stay unedited.

### Step 7A — Save-status model + standalone popover (unrouted)
- Files: new `src/features/game/saveStatusPresentation.ts`; new
  `src/features/game/components/SaveStatusPopover.tsx` (trigger button + `popover="auto"` explanation sibling +
  inline `hidden` fallback, close button, viewport clamp, Escape, focus restore); `src/styles.css`
  (`.save-status*`); new `tests/unit/save-status-popover.test.ts`.
- Copy:
  - saved: 「自動保存済みです。ページを閉じても、タイトルの「つづきから」で再開できます。」
  - failed: 「保存に失敗しました。この進行は未保存です。」
  - unavailable: 「この環境では保存できません。ページを閉じると進行は失われます。」
  - null: 「未保存です。まだ保存の完了を確認できていません。」
- Tests first:
  - `models all four statuses`
  - `opens and dismisses native popover by keyboard`
  - `supports inline fallback and restores trigger focus`
  - `renders explanation outside the given wrapper`
  - `closes without restoring focus when a modal opens`
- Acceptance: `npx vitest run tests/unit/save-status-popover.test.ts` + common.
- Pause review: the copy, plus a standalone render in the report.

### Step 7B — HUD integration + hit area + geometry

> Amendment (2026-11-17, from the Step 7A review). Use the `wrapper` render prop: the saved mark is `wrapper={(t) => <p className="game-panel__save game-panel__save--inline" title={...}>{t}</p>}` with children `<SaveIcon/><span className="visually-hidden">セーブ: …</span>`, so the `<p>` keeps no role, its `title`, and textContent exactly `セーブ: 自動保存済み`; the explanation is a sibling outside it. Same wrapper for failed/unavailable/null lines. 44px hit box: `position: relative` on `.save-status__trigger` plus an absolutely positioned pseudo-element; check it does not overlap 現在駅 or neighbours. The inline-fallback popover sits in normal flow and pushes the HUD while open — do not measure the 252px budget with it open. The popover focuses its 閉じる button on open (so Enter/Space never reach the roll shortcut). 7B's E2E must prove in a real browser that (a) Enter/Space with the popover open does not roll, and (b) opening the RulesDialog (or another native modal) while the popover is open closes it via `focusout` without stealing focus.
- Files:
  - `GameHud.tsx`: the saved mark's `<p class="game-panel__save …">` stays a paragraph with no role, the same
    `title` and the visually-hidden text. A trigger `<button>` goes inside it and the explanation is a sibling
    outside it. Failed / unavailable / null: the status line text becomes the trigger.
  - `src/styles.css`: the 16px visual, a 44x44 absolutely positioned hit box, scoped inward padding, no row-height
    change.
  - new `tests/e2e/save-status.spec.ts`.
- Tests first (E2E): `save explanations work by keyboard and tap`, `save hit target preserves the phone HUD budget`
  (`@layout`; measures the full hit box against 現在駅 and neighbouring controls).
- Deliberate existing-test edits: `tests/unit/game-hud.test.ts` saved-mark block (~L322-350) and
  `tests/unit/item-controls.test.ts` (~L1021-1047) **add** trigger and explanation assertions. The no-role, exact
  text, title, icon and visually-hidden assertions are retained.
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/save-status-popover.test.ts tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts
  npx playwright test tests/e2e/save-status.spec.ts tests/e2e/hud-progress-feedback.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2 --grep 'desktop populated HUD fits without scrolling(?: @layout)?$'
  npx playwright test tests/e2e/save-status.spec.ts tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
  ```
- Pause review: all four explanations, the fallback, the 320x568 HUD (252px), the populated desktop HUD.

### Step 8A — Save-attempt identity (no visual)
- Files: `useGameApp.ts` (a shared internal write helper for both save effects; `saveAttempt: SaveAttempt | null`;
  immutable `entryTurn` per session; dedupe by game object, storage, key and session; existing item
  acknowledgement dispatch and phase conditions unchanged); new `src/features/game/saveNotice.ts` (`SaveAttempt`
  type only); new `tests/unit/game-app-save-attempt.test.ts`.
- Tests first:
  - `publishes one attempt per distinct write`
  - `deduplicates classic and item writes without losing acknowledgements`
  - `retains attempt identity under StrictMode`
  - `records entry turn for new, resumed, pending roll and pending discard sessions`
  - `isolates sessions`
- Acceptance (+ common): `npx vitest run tests/unit/game-app-save-attempt.test.ts
  tests/unit/game-app-item-progress.test.ts tests/unit/game-app-turn-moments.test.ts`.
- Pause review: identity traces in the report.
- Risks: a reused write must never suppress an item acknowledgement.

### Step 8B — Notice store, eligibility, announcement arbitration (no visual)

> Amendment (2026-11-18, from the Step 8A review). Eligibility is evaluated on the **latest** attempt only: `attempt !== null && attempt.sessionId === currentSessionId && attempt.result === "saved" && attempt.game.status === "playing" && !(pending !== null) && attempt.game.turn > attempt.entryTurn && !alreadyDelivered`. A pending (roll/discard) write never qualifies — wait for the resolved write. Finished games never qualify. Compare against the current game session id (null on the title), never `lastSessionId`; ids restart per GameApp mount, never persist them. `entryTurn` = top-level `game.turn` of the session's first write. For 10A: if a later attempt in the same session is not `"saved"` before delivery, cancel the queued notice (or re-check the latest attempt at delivery). Step 10A also makes `GameAppControls.saveAttempt` required by adding `saveAttempt: null` to `inject()` in `game-app-turn-moments.test.ts` (setup-only edit); until then read `app.saveAttempt ?? null`.
- Files: `saveNotice.ts` (`isFirstTurnNoticeEligible`, `FIRST_TURN_NOTICE_TEXT`, a pure `selectAnnouncement` with
  named types `NoticeAnnouncementState` / `NoticeAnnouncementInput`); new `src/features/game/store/notices.ts`; new
  `tests/unit/save-notice.test.ts`.
- Tests first:
  - `rejects turn zero restored baseline and wrong-session attempts`
  - `accepts a successful completed turn beyond session entry`
  - `accepts resolved pending discard progress`
  - `failed save then later success is eligible once`
  - `notice storage handles absent invalid and throwing storage`
  - `ordinary announcements take priority and notice waits`
  - `decision ownership defers notice announcement`
- Acceptance: `npx vitest run tests/unit/save-notice.test.ts` + common.
- Risks: the key must not contain "save" (asserted in a test).

### Step 9 — Toast queue notice entry + host announceability (no visual)
- Files: `toastQueue.ts` (`kind`, `NoticeToastInput`, `enqueueNotice`); `ToastHost.tsx` (`notice`, `announceable`,
  `onNoticeShown`); new `tests/unit/toast-notice.test.ts`.
- Tests first:
  - `notice bypasses and does not advance the turn cursor`
  - `notice deduplicates within its scope`
  - `scope reset permits a new delivery`
  - `old-turn pruning retains waiting notices`
  - `notice shares FIFO and two ordinary slots`
  - `save failure retains its reserved slot`
  - `obscuring pauses notice clocks`
  - `shown acknowledgement waits for visible unobscured announceable display`
  - `hidden to visible restores reading time and acknowledges once`
  - `repeated renders acknowledge once`
- Deliberate existing-test edits: none (`toast.test.ts` byte-identical).
- Acceptance: `npx vitest run tests/unit/toast-notice.test.ts tests/unit/toast.test.ts` + common.

### Step 10A — Notice hook + fixture seeding (no visual)
- Files: new `src/features/game/useFirstTurnNotice.ts`; new `tests/unit/helpers/notices.ts`
  (`seedFirstTurnNotice(storage)`); `tests/e2e/fixtures.ts` (option `firstTurnNoticeSeen: boolean`, default true,
  one `addInitScript` that seeds the flag; `false` installs nothing and never erases it); existing GameApp unit
  storage setups gain seed calls only where needed; new `tests/unit/game-app-save-notice.test.ts` (hook-level
  cases).
- Tests first:
  - `never notices turn zero or a resumed baseline`
  - `keeps mounted dedupe when flag writing fails`
  - `leaves the flag unset when returning to title before delivery`
  - `waits for publication and dialog closure`
- Deliberate existing-test edits: `tests/e2e/fixtures.ts` (the option + seed);
  `game-app-item-progress.test.ts` / `game-app-turn-moments.test.ts` (and any other GameApp suite named in the
  report) get setup-only `seedFirstTurnNotice` calls. Throwing-storage setups are preserved. No assertion changes.
- Acceptance: `npx vitest run tests/unit/game-app-save-notice.test.ts tests/unit/game-app-item-progress.test.ts
  tests/unit/game-app-turn-moments.test.ts` + common.

### Step 10B — Visible notice delivery + live region
- Files: `GameApp.tsx` (connect the hook, ToastHost `notice` / `announceable` / `onNoticeShown`); `GamePanel.tsx`
  (an explicit announcement-request / acknowledgement handshake through the existing status region via
  `selectAnnouncement`; no new live region); extend `game-app-save-notice.test.ts`; new
  `tests/e2e/first-turn-notice.spec.ts` (uses `test.use({ firstTurnNoticeSeen: false })`).
- Tests first:
  - unit: `notices the next successful completed classic or item turn`, `rejects failed unavailable and stale
    attempts`, `persists only after actual announceable display`, `announces once through the existing status
    region`, `failed save then recovery notices once`, `resumed pending progress then failed save then success
    notices once`, `rules open defers the notice`;
  - E2E: `first completed save notices once across reload`, `restored baseline waits for newly completed progress`,
    `hidden tab delays the notice until visible`.
- Deliberate existing-test edits: none. Existing toast assertions must pass with the fixture seed.
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/game-app-save-notice.test.ts tests/unit/save-notice.test.ts tests/unit/toast-notice.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/game-app-turn-moments.test.ts
  npx playwright test tests/e2e/first-turn-notice.spec.ts tests/e2e/resume.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2 --grep 'the arrival and pickup stages hold turn results, then publish them together(?: @layout)?$'
  npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2
  ```
- Pause review: turn 0 shows nothing; the first eligible notice; deferral while the rules are open; reload shows
  nothing; the live-region DOM transitions.

### Step 11 — Map modes + title camera
- Files: `RailwayMap.tsx` (`mode` prop, default `"game"`; title fit effect; follow, overview and preview effects
  gated to game mode, with `mode` in the dependencies that must re-run on entry; preview cleanup must not reset
  padding after a title fit; clear mode does not touch the camera); `camera.ts` (`titleFitPadding` + named
  constants); `GameApp.tsx` (passes `mode`); new `tests/unit/title-map-mode.test.ts`; new
  `tests/e2e/title-map.spec.ts`.
- Tests first:
  - unit: `title padding is symmetric and clamped`, `title fits the explicit target service without panel padding`,
    `entry into title and resize refit the existing map`, `game camera effects cannot override title fitting`,
    `title to turn-zero game restores panel-aware overview`, `preview cleanup does not clear title padding`,
    `clear retains camera`, `mode changes do not construct another map`;
  - E2E: `title refits target loop on return and resize`.
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/title-map-mode.test.ts
  npx playwright test tests/e2e/title-map.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/capital-region.spec.ts --project=desktop-chromium --workers=2 --grep 'regional target view and full overview fit outside the panel; operator line groups are selectable(?: @layout)?$'
  npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --workers=2
  ```
- Pause review: initial title, game → title, resized desktop and phone; the full loop visible; no panel padding.

### Step 12A — Paint readiness + SVG placeholder + retry
- Files: new `src/features/map/components/TitleMapPlaceholder.tsx` (inline SVG, `aria-hidden`, not focusable,
  `pointer-events: none`); `RailwayMap.tsx` (paint latch separate from `loadedMap`; reset on retry; stale-callback
  guard; RAF cleanup); `src/styles.css`; extend `title-map-mode.test.ts` and `title-map.spec.ts`.
- Tests first:
  - unit: `placeholder waits for load layers and a subsequent rendered frame`, `retry resets readiness and cancels
    stale callbacks`, `webgl unsupported keeps the placeholder`, `fatal failure retains title placeholder and
    retry controls`;
  - E2E: `title placeholder survives delayed paint and failure` (`@layout`).
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/title-map-mode.test.ts
  npx playwright test tests/e2e/title-map.spec.ts tests/e2e/map-failure.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/title-map.spec.ts --project=phone-chromium --workers=2 --grep 'title placeholder survives delayed paint and failure(?: @layout)?$'
  ```
- Pause review: delayed loading, first paint, style failure, WebGL unsupported, retry.

### Step 12B — Navigation visibility + layout readiness waits
- Files: `RailwayMap.tsx` (NavigationControl container and `.map-overview` hidden or unmounted unless game mode,
  layers ready and no fatal failure; attribution kept); `src/styles.css`; extend `title-map.spec.ts` and
  `tests/unit/title-map-mode.test.ts`.
- Tests first:
  - unit: `navigation is hidden outside ready playable game mode`;
  - E2E: `map navigation follows title game and clear modes` (`@layout`; visual absence and keyboard absence).
- Deliberate existing-test edits: `tests/e2e/layout.spec.ts`, explicit in-game readiness and visible-control waits
  before the safe-area geometry measurement (~L47-87) and the Zoom-in visibility check (~L126-136). Rectangle
  counts, safe-area, no-scroll and overlap limits stay unchanged. No other spec's map-control assertions change; a
  failure elsewhere means a product fix.
- Acceptance (+ common):
  ```bash
  npx playwright test tests/e2e/title-map.spec.ts tests/e2e/layout.spec.ts tests/e2e/map-failure.spec.ts tests/e2e/turn-result-card.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/title-map.spec.ts tests/e2e/layout.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
  ```
- Pause review: title, game and clear screenshots; controls absent from the tab order on the title.

### Step 13 — EditionApp loading / failure title paths

> Amendment (2026-11-17): these paths have no network, so the rules guide would fall back to 「目標路線」/「出発駅」. Prefer names available without the network (e.g. edition display metadata) if they exist; otherwise accept the generic labels and say so in the step report.
- Files (Revision 2): production files `EditionApp.tsx`, `GameApp.tsx` and `TitleScreen.tsx`; new
  `tests/unit/edition-title-states.test.ts`; extend `title-map.spec.ts` and `rules-guide.spec.ts`.
  - `EditionApp`: single-edition loading renders `TitleScreen` (loading; play actions **absent**, as in the
    existing loading behaviour; 「遊び方」 present with a count-free model) over `TitleMapPlaceholder`. The failure
    path passes `mode="title"` and the model. There is exactly one placeholder at a time.
  - **Loading-completion policy:** `TitleScreen` exposes an optional typed callback (e.g.
    `onRulesViewChange?: (open: boolean) => void`) reporting whether its rules view is open. `EditionApp` uses it to
    keep the loading title mounted, with its count-free model, while the rules are open, even after the data has
    loaded.
  - After the player returns from the rules, `EditionApp` switches to `GameApp` and passes a narrowly scoped
    initial-focus request (e.g. `initialTitleFocus?: "rules-trigger"`) through `GameApp` to `TitleScreen`, which
    focuses 「遊び方」 after mounting. The request is issued only when a rules visit actually deferred the switch.
    Ordinary loading completion and edition switching keep the existing picker-focus behaviour.
- Tests first:
  - unit: `single-edition loading shows title without play actions and with rules`, `network failure preserves rules
    attribution and error presentation`, `unknown target count is omitted until network availability`, `loading
    completion while rules are open defers the switch and restores focus`;
  - E2E: `loading title keeps rules available without a target count` (`@layout`), `network failure keeps
    decorative title and disabled play` (`@layout`).
- Deliberate existing-test edits: none (existing loading and failure assertions stay valid; stop if not).
- Acceptance (+ common):
  ```bash
  npx vitest run tests/unit/edition-title-states.test.ts tests/unit/rules-guide-components.test.ts tests/unit/title-map-mode.test.ts tests/unit/credits-screen.test.ts
  npx playwright test tests/e2e/title-map.spec.ts tests/e2e/map-failure.spec.ts tests/e2e/rules-guide.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/title-map.spec.ts tests/e2e/rules-guide.spec.ts --project=phone-chromium --workers=2 --grep 'loading title keeps rules available without a target count(?: @layout)?$|network failure keeps decorative title and disabled play(?: @layout)?$'
  ```
- Pause review: slow single-edition loading and failed network, desktop and 320x568, including open rules.

### Step 14 — Final integration + boundary audit
- Files: new feature test files only; bounded product fixes trigger the relevant reruns. No existing-test edits.
- Tests first:
  - `rules preserve pending roll and discard decisions`
  - `notice waits through rules and announces after ordinary progress`
  - `save popover and rules restore their own openers`
  - `rules and title remain readable at compact viewports` (`@layout`)

  All use existing valid fixture recipes.
- Acceptance:
  ```bash
  npm run typecheck && npx vitest run && npm run build
  npx playwright test tests/e2e/title-save-ux.spec.ts tests/e2e/rules-guide.spec.ts tests/e2e/save-status.spec.ts tests/e2e/first-turn-notice.spec.ts tests/e2e/title-map.spec.ts --project=desktop-chromium --workers=2
  npx playwright test tests/e2e/title-save-ux.spec.ts tests/e2e/rules-guide.spec.ts tests/e2e/save-status.spec.ts tests/e2e/title-map.spec.ts tests/e2e/layout.spec.ts tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
  npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2 --grep 'desktop populated HUD fits without scrolling(?: @layout)?$|short landscape keeps staged slots visible and card reachable(?: @layout)?$'
  npx playwright test tests/e2e/hud-progress-feedback.spec.ts tests/e2e/save-errors.spec.ts tests/e2e/resume.spec.ts --project=desktop-chromium --workers=2
  git diff --check a8fc2b7
  git diff --stat a8fc2b7 -- src/features/game/engine src/types/network.ts src/features/game/store/persistence.ts src/features/game/store/settings.ts public data package.json package-lock.json   # must be empty
  ```
- Pause review: desktop and phone screenshots of every feature; CI status (full matrix on the PR).

## File Changes
See the "Module Structure" table and each step's "Files". New E2E specs (exactly five): `title-save-ux.spec.ts`,
`rules-guide.spec.ts`, `save-status.spec.ts`, `first-turn-notice.spec.ts`, `title-map.spec.ts`. New unit files:
`resume-presentation`, `rules-guide`, `rules-guide-components`, `rules-dialog`, `rules-entry-points`,
`save-status-popover`, `game-app-save-attempt`, `save-notice`, `toast-notice`, `game-app-save-notice`,
`title-map-mode`, `edition-title-states` (`.test.ts`), plus `tests/unit/helpers/notices.ts`.

Deliberately edited existing tests, complete list:
| Step | File | Edit |
|---|---|---|
| 1B | `resume.spec.ts`, `real-data.spec.ts`, `map-failure.spec.ts`, `lottery.spec.ts`, `capital-region.spec.ts`, `ui-pop-turn-moments.spec.ts` | playing-save resume label wording only |
| 4 | `edition-registry.test.ts`, `layout.spec.ts` (~L148-151) | short title paragraphs |
| 7B | `game-hud.test.ts` (~L322-350), `item-controls.test.ts` (~L1021-1047) | added trigger and explanation assertions |
| 10A | `tests/e2e/fixtures.ts`, GameApp unit storage setups | notice seed (setup only) |
| 12B | `layout.spec.ts` (~L47-87, ~L126-136) | readiness waits only |

## Test Plan
| Step | Primary proof | Existing reruns |
|---|---|---|
| 1A/1B | pending-aware resume and overwrite wording; delete link accessible | six resume-label specs |
| 2A/2B | every rule figure follows the config; optional count | full unit suite |
| 3/4 | shared sections; title route, focus, short copy | credits, registry, layout |
| 5 | modal ordering, StrictMode, safe focus restore | full unit suite |
| 6A/6B | three deep links; auto-roll, animations and decisions under the modal; pointer gating | HUD, phone menu, accessibility, ui-pop draft, auto-roll, items |
| 7A/7B | four explanations; native and fallback popover; HUD geometry | HUD units, save-errors, hud-progress, populated HUD, hud-layout |
| 8A/8B | write identity, entry baseline, StrictMode, eligibility, storage errors | GameApp units |
| 9 | cursor-independent notice, capacity, pruning, clocks, visibility | `toast.test.ts` unchanged |
| 10A/10B | once-per-browser delivery, live region, reload, failure → recovery | resume, save-errors, ui-pop, publication case |
| 11 | title fit, mode transitions, map reuse | regional camera, map-visual |
| 12A/12B | paint latch, WebGL unsupported, retry, controls hidden | layout, map-failure, turn-result-card |
| 13 | loading and failure titles keep rules; loading-completion policy | map-failure, credits |
| 14 | combined interactions and boundary audit | full units and build; invariant E2E |

## Dependencies Between Steps
```text
1A → 1B
2A → 2B → 3 → 4 ─────────────┐
          3 → 5 → 6A → 6B    │
7A → 7B (after 6B: rules-open closes popover)
8A → 8B → 9 → 10A → 10B (needs 6A rulesOpen)
11 → 12A → 12B → 13 (needs 4 and 12A)
all → 14
```
Steps run strictly in order: 1A, 1B, 2A … 14.

## Risks and Mitigations
- Stale or duplicated save success leading to a wrong notice: `SaveAttempt` identity plus entry turn; StrictMode
  tests (8A, 8B, 10B).
- A notice lost or a toast reordered: an explicit queue kind, no synthetic positions, `toast.test.ts` byte-identical (9).
- Test churn from the one-time notice: the fixture seed lands in 10A, before visible delivery in 10B.
- Rules modal vs decision modals, auto-roll and Escape: one `rulesOpen` contract, decision modals deferred, ordering
  tests (5, 6A).
- Phone HUD 252px: a 16px visual with a separate 44px hit box; existing geometry assertions unchanged (7B).
- Title camera or game camera regressions on mode switches: mode-gated effects, title → turn-0 test, no map
  re-creation (11).
- Placeholder flash or a stuck placeholder: paint latch, retry reset, stale guard (12A).
- Step budget overruns: preflight on 5, 6A, 7A, 9, 11, 12A; split rather than compress (extra pause reported).
- Local E2E does not prove Firefox or WebKit: the full matrix runs in CI on the PR; push CI is checked after every step.

## Validation verdict
- Round 1 (`.claude/logs/codex/20261117T014327Z-rgts-validate.md`): **NEEDS_REVISION**. All 10 binding decisions
  were covered. The revisions requested were: tagged-grep selection, the auto-roll / animation / decision-modal
  contract under the rules modal, the loading-completion policy, failure → recovery and hidden → visible notice
  cases, explicit WebGL-unsupported tests, the `rulesModel`-absent button policy, named camera constants and
  notice types, and seven step splits. All were applied above (Revision 1).
- Round 2 (`.claude/logs/codex/20261117T015133Z-rgts-revalidate.md`): **NEEDS_REVISION**. Round 1 was applied,
  with file-boundary gaps: 6B lacked `GamePanel.tsx`, 13 lacked `GameApp.tsx` / `TitleScreen.tsx` and the
  rules-view signal, and 12B lacked `title-map-mode.test.ts`. The notes were the Credits fixture explanation, the
  combined recovery case, decision-modal final focus with auto-roll still fed the original decision, and 7A in
  the preflight list. All were applied above (Revision 2).
- Round 3 (`.claude/logs/codex/20261117T015613Z-rgts-revalidate2.md`): **PASS**. Every round-2 item was applied.
  Plan and prompts are consistent. Remaining risks (step size, focus ordering, notice timing, browser behaviour)
  are covered by the preflight, the stop-and-split rule and the per-step tests.

**Final verdict: PASS** (Codex Sol, low effort, after 2 revision rounds).
