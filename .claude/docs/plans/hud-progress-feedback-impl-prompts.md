# Issue #65 per-step implementer prompts (Codex Luna xhigh)

Each step's prompt = **Common body** (below) + that step's **Step block**. Replace `<STEP>` and `<BASE_SHA>` (`git
rev-parse HEAD` before the call). Write the concatenation to `.claude/logs/codex/prompt-hud65-s<STEP>.md`, then run:

```bash
mkdir -p .claude/logs/codex
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-hud65-s<STEP>.md --label hud65-s<STEP>-implement --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 --caller claude-main
```

Review after each step (Sol low, read-only; body at the end of this file):

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-hud65-s<STEP>-review.md --label hud65-s<STEP>-review --sandbox read-only --config model_reasoning_effort=low --timeout 1200 --caller claude-main
```

Lead verification after each step:

```bash
python3 .claude/skills/_shared/verify_delegation.py --base <BASE_SHA> --forbid-outside src --forbid-outside tests --label hud65-s<STEP>
git diff --stat <BASE_SHA> -- src/features/game/engine src/types/network.ts src/features/game/shareText.ts public data package.json package-lock.json   # must be empty
git diff <BASE_SHA> --stat -- tests/unit tests/e2e   # existing files only as allowed by the step (Steps 12/13)
```

---

# Common body

# Objective
Implement Step <STEP> of issue #65 (HUD progress feedback: A 「山手線まで あとN駅（近づく／遠ざかる）」, B milestones at
10/20/25/29, C 訪れた駅 / 乗った路線 counters, D phone hamburger) exactly as specified in
`.claude/docs/plans/hud-progress-feedback-plan.md` ("Decisions" D1-D22, "Architecture", "Interfaces", "Step details" →
Step <STEP>, "Affected existing tests", "Validation amendments"). The Step block below is the binding summary for this
step; where it and the plan disagree, the plan's Decisions win — report the conflict. Earlier steps are committed on
branch `feature/hud-progress-feedback` at `<BASE_SHA>` (status: `.claude/docs/plans/hud-progress-feedback-handoff.md`).
Background: brief `.claude/docs/research/feature-hud-progress-feedback-brief.md` (user decisions binding), scan
`.claude/docs/research/feature-hud-progress-feedback-codebase.md`, design `.claude/logs/codex/20261115T111604Z-hud65-design.md`.

# Constraints
- Scope is Step <STEP> only: touch only the files the Step block lists. Do not start the next step. Hard cap ~150
  handwritten changed lines incl. tests; if the step cannot fit, stop and report why with a proposed split.
- Tests first (TDD) for new behaviour. Existing test files stay byte-identical unless the Step block names the exact
  title to edit; never delete, skip or loosen an assertion, widen a geometry bound or a timing tolerance. Lean tests:
  outcomes and boundaries, not one test per branch.
- Presentation only. Forbidden: edits under `src/features/game/engine/**` (read-only imports allowed), RNG,
  save/persistence behaviour or format, `src/types/network.ts`, `src/features/game/shareText.ts`, `public/**`,
  `data/**`, dependencies/lockfiles, version numbers.
- Components read only `turnDisplay` (or props derived from it), never `session.game`. No new live region, reducer,
  timer or publication boundary.
- New CSS classes `.hud-progress*`, `.target-progress__flash`, `.phone-menu*`, `.clear-collection*` only; the phone
  pair uses `data-stat="proximity"`; do not reuse the six existing `data-stat` values. Visible names come from the
  presentation resolver, never raw IDs.
- Repo conventions: TypeScript strict, explicit types, named constants (no magic numbers; px values as TS constants
  or CSS custom properties), early returns, immutable updates, no `any`, no swallowed errors, no TODO/placeholders.
  Japanese visible text through `PhraseText`; title/aria strings plain. Reduced-motion CSS beside each animation.
- Do not commit, create branches or change git state.
- E2E: targeted titles only with `--grep '<title>$'` (suffix anchor), `--workers=2`; never the full suite. Tag every
  phone case `{ tag: "@layout" }`. Default host. Never `pkill -f` / `pgrep -f`. Firefox needs `xvfb-run -a`.
- If a fixture predicate (e.g. "this turn crosses 10 segments") does not hold, fail with diagnostic state; never
  substitute another scenario or hard-code expected values not derived from the replayed state.

# Acceptance checks (run them and report results)
- The Step block's acceptance commands.
- `npm run typecheck`; `npx vitest run` (full) if the step changed `src/` or `tests/unit/`; `npm run build` if the step
  changed a component or CSS.
- `git status --porcelain` shows only the Step block's files (plus pre-existing untracked `.claude/docs/**` docs).

# Output format
## Changes Made
## Tests Written (new files/cases) and confirmation that existing test files are unchanged (or only the named titles)
## Validation Results (command + pass/fail counts)
## Measurements (layout steps: px heights/widths, viewport results)
## Deviations from the plan (if any, with reason)
## Remaining Risks

---

# Step blocks

## Step 1 — Proximity model
Files: new `src/features/game/targetProximity.ts`; new `tests/unit/target-proximity.test.ts`.
Change: `deriveTargetProximity(input: TargetProximityInput, network): TargetProximity | null` per D1-D4. Use
`targetHopDistances(network, targetServiceId)` and `nextStationId(...)` read-only. Hidden (null) when riding the target
service, distance 0, `targetComplete`, or current distance unknown. `trend` = "closer" / "farther" / null (equal, no
next stop, unknown next distance). Text 「山手線まで あとN駅」 + 「（近づく）」/「（遠ざかる）」 only when trend is set;
copy constants exported.
Tests: closer, farther, equal, terminus (no next stop), rapid segment counts as 1 hop, each hidden case, exact text.
Acceptance: `npx vitest run tests/unit/target-proximity.test.ts`; `npm run typecheck`.

## Step 2 — Collection model
Files: new `src/features/game/collectionProgress.ts`; new `tests/unit/collection-progress.test.ts`.
Change: `deriveCollectionProgress(startStationId, visits: CollectionVisit[], network, presentation)` per D5-D8: start
station + `from`/`to` of each traversed segment (deduplicated); ridden = line group of each traversed segment's
service (deduplicated; groups from the presentation resolver, consistent with `lineGroups()`); a visit with
`relocationDestinationId` adds that station and no group. Totals `network.stationsById.size`,
`presentation.lineGroups().length`. Texts 「訪れた駅 n/1,586」「乗った路線 n/134」 with `toLocaleString("ja-JP")`. Reads
no session or history types.
Tests: fresh `1/<total>` and `0/<total>`, repeated stops, rapid endpoints only, two services in one group count once,
deadhead destination without group, runtime totals from the fixture, digit grouping.
Acceptance: `npx vitest run tests/unit/collection-progress.test.ts`; `npm run typecheck`.

## Step 3 — Gated A+C publication
Files: `src/features/game/turnMomentPresentation.ts`; new `tests/unit/hud-progress-publication.test.ts`.
Change: add `proximity: TargetProximity | null` and `collection: CollectionProgress` to `TurnMomentDisplay`. A from
`visibleProgress().stationId` + the gated ride (`visibleRide()`), target service from config, `targetComplete` from the
displayed completed required count. C from a private visible-traversal projection (plan "Architecture"): pre-move
excludes the unpublished target record; moving includes its first `progress.stepsCompleted` segments; arrival onward
the full record; deadhead destination at arrival only; pending-discard record deduplicated by turn; classic animation
identified by `session.animation.turn`, not by `attempt` presence. No new derivation inputs.
Tests (phase matrix, lean): pre-move with committed attempt, mid-move prefix, arrival / lottery / pickup / published,
classic animation, staged ticket draft does not change A, deadhead, omitted presentation, pending discard counted once.
Acceptance: `npx vitest run tests/unit/hud-progress-publication.test.ts tests/unit/turn-moment-presentation.test.ts`; typecheck.

## Step 4 — Crossings and toast builder
Files: new `src/features/game/progressMilestones.ts`; `src/features/game/toastQueue.ts`; new
`tests/unit/progress-milestones.test.ts`.
Change: `PROGRESS_THRESHOLDS`, `deriveProgressCrossings(records, requiredSegmentIds)` replaying unique required IDs in
movement order (generalising `firstTargetCompletionTurn` in `mapGuidance.ts`, which stays unchanged), one crossing per
turn = highest threshold crossed, chronological. `progressMilestoneToast(sessionId, crossing)` for thresholds < 30:
key `${sessionId}:milestone:target-segments:<n>`, `eventIndex` 10→-5, 20→-4, 25→-3, 29→-2, copy per D11; the existing
`targetSegmentsMilestoneToast` (30, -1) is unchanged. Queue capacity, cursor and sticky save-failure reservation
untouched.
Tests: exact hit, two thresholds in one turn → highest, duplicate/repeated IDs, jump to 30, a milestone input before a
same-turn item event passes the existing reducer cursor, sticky save failure still reserved.
Acceptance: `npx vitest run tests/unit/progress-milestones.test.ts tests/unit/toast.test.ts`; typecheck.

## Step 5 — Milestone publication and once-only announcement
Files: `src/features/game/turnMomentPresentation.ts`; the existing consumer of `turnDisplay.announcement` only if the
consumed-key set must live there (name it in the report); new `tests/unit/progress-milestone-publication.test.ts`.
Change: replace the 30-only producer with crossing-driven toast inputs: all historical public crossings in
chronological order (so `GameApp` `toastBaseline` suppresses them on resume), then the current turn's crossing once
movement completes, before item events. 30 per D10: existing builder and existing `goalGuidance` condition; when it
suppresses 30 do not fall back to 29 or lower. Announcement per D12: milestone sentence appended to the existing
polite announcement once per `session:turn:threshold` via a consumed-key set (30 included). Add
`milestoneFlash: MilestoneFlash | null` per D13 (current turn only, < 30, null under `entryTurn` history, omitted
motion, Skip, 演出なし, OS reduced motion).
Tests: nothing public while `moving`; arrival publishes toast before item events; arrival → Skip → published announces
once; fresh turn under 演出なし / reduced motion still toasts and announces, flash null; restored history suppressed;
same-turn clear keeps the existing 30 behaviour with no fallback; the full flash-suppression matrix lives here only.
Acceptance: `npx vitest run tests/unit/progress-milestone-publication.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/toast.test.ts`; typecheck.

## Step 6 — Progress-bar flash
Files: `src/features/game/components/TargetProgressBar.tsx`, `src/features/game/components/GameHud.tsx` (prop pass-through
only), `src/styles.css`; new `tests/unit/hud-progress-components.test.ts`.
Change: optional `milestoneFlash` prop; render a keyed `aria-hidden` `.target-progress__flash` child (key = flash key)
with a one-iteration animation using motion tokens; `prefers-reduced-motion: reduce` block beside it; the
`role="progressbar"` element and its value attributes are not remounted.
Tests (DOM identity only, no suppression matrix): same key → same node, new key → new node, null → none, guidance mode
(30) → none. Render via `tests/unit/helpers/reactDom.ts`.
Acceptance: `npx vitest run tests/unit/hud-progress-components.test.ts`; typecheck; `npm run build`.

## Step 7 — Desktop A+C row
Files: `src/features/game/components/GamePanel.tsx`, `src/features/game/components/GameHud.tsx`, `src/styles.css`;
`tests/unit/hud-progress-components.test.ts`; new `tests/e2e/hud-progress-feedback.spec.ts`.
Change: pass `turnDisplay.proximity` / `collection` / `milestoneFlash` to `GameHud`; render one `.hud-progress` row after
the stats `dl` per D15 (24px fixed height, no extra margin; left A in two 12px lines, right C in two 12px lines at
10-11px; row kept when A is null); hidden at `(max-width: 600px)` and in short landscape.
Tests: component render (A present/absent, C texts). New E2E `desktop progress row preserves populated no-scroll budget`
(desktop-chromium, `test.use({ dataset: "real" })`; reuse the existing populated-state helper from
`tests/e2e/support/turnResult.ts` / `ui-pop.spec.ts` approach): A visible, C texts not truncated
(`scrollWidth ≤ clientWidth`), panel `scrollHeight ≤ clientHeight + 1`.
Acceptance:
```bash
npx vitest run tests/unit/hud-progress-components.test.ts
npx playwright test tests/e2e/hud-progress-feedback.spec.ts --project=desktop-chromium --workers=2 --grep 'desktop progress row preserves populated no-scroll budget$'
npx playwright test tests/e2e/turn-result-card.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium --workers=2 --grep 'populated result preserves desktop budget$|desktop populated HUD fits without scrolling$'
npm run build
```

## Step 8 — Clear-screen counters
Files: `src/features/game/components/ClearScreen.tsx`, `src/app/GameApp.tsx`, `src/styles.css` (only if needed);
`tests/unit/hud-progress-components.test.ts`.
Change: `ClearScreenProps.collection`; `GameApp` passes `turnDisplay.collection` (the published model, not a
recomputation); two more rows 「訪れた駅」「乗った路線」 in the existing stats `<dl>`; `summarizeGame` and share text
unchanged.
Tests: component render of both rows with totals. No new E2E (existing `clear-screen wrapping` is the layout gate).
Acceptance:
```bash
npx vitest run tests/unit/hud-progress-components.test.ts
npx playwright test tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --workers=2 --grep 'clear-screen wrapping$'
npx playwright test tests/e2e/text-wrapping.spec.ts --project=phone-chromium --workers=2 --grep 'clear-screen wrapping$'
npm run build
```

## Step 9 — Phone A cell and short-landscape A+C
Files: `src/features/game/components/GameHud.tsx`, `src/features/game/components/GamePanel.tsx`,
`src/features/game/components/TurnLogDrawer.tsx` (optional `progress?: React.ReactNode` rendered first in the region),
`src/styles.css`; `tests/e2e/hud-progress-feedback.spec.ts`.
Change: append a 7th `dt/dd` pair after 出目 (`dt` visually hidden 「山手線まで」, `dd` `data-stat="proximity"`, rendered
only when A is non-null); hidden on desktop and short landscape; on phone `grid-column: 3 / 5; grid-row: 3`, height
exactly 34px, two 17px lines, overriding the 18px cap / `nowrap` / `overflow` defaults, break before the parenthetical.
The first six `nth-of-type` rules untouched. Short landscape: A+C node at the top of the log region (D17).
Tests: new E2E `phone proximity reuses the roll cell without moving dice` (`@layout`; 320x568 and the project
viewport; cell inside row 3 cols 3-4, no horizontal overflow, dice rect unchanged vs. A hidden) and `short landscape
progress stays in the current log` (`@layout`; 667x375; stats rows still 3×18px; A+C in the open log).
Acceptance:
```bash
npx playwright test tests/e2e/hud-progress-feedback.spec.ts --project=desktop-chromium --workers=2 --grep 'phone proximity reuses the roll cell without moving dice$|short landscape progress stays in the current log$'
npx playwright test tests/e2e/hud-progress-feedback.spec.ts --project=phone-chromium --workers=2 --grep 'phone proximity reuses the roll cell without moving dice$'
npx playwright test tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts --project=desktop-chromium --workers=2 --grep 'phone HUD budget$|HUD breakpoint isolation$|keeps the dice button at one HUD position across variable content and save states$'
npx playwright test tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2 --grep 'phone HUD budget$|keeps the dice button at one HUD position across variable content and save states$'
npm run build
```

## Step 10 — Embedded disclosure mode
Files: `src/features/game/components/TurnLogDrawer.tsx`, `src/features/game/components/GameMenu.tsx`; new
`tests/unit/phone-game-menu.test.ts`.
Change: `embedded?: boolean` (default false): when true, no own trigger button and no own Escape `keydown` listener;
region id, label and content unchanged. `GameMenu` gets an optional parent trigger ref used for 新規/タイトル focus
return when embedded. Non-embedded output and behaviour identical to today.
Tests: embedded renders no trigger and registers no keydown listener; non-embedded still renders its trigger.
Acceptance: `npx vitest run tests/unit/phone-game-menu.test.ts`; typecheck.

## Step 11 — Phone hamburger wrapper (unmounted)
Files: new `src/features/game/components/PhoneGameMenu.tsx`, `src/styles.css`; `tests/unit/phone-game-menu.test.ts`.
Change: `PhoneGameMenu` per the plan's `PhoneGameMenuProps`, D18 and D21: one 44px trigger (hamburger icon + visible
「メニュー」, `aria-expanded`, `aria-controls`), then C summary, 「ログ」/「設定」 section buttons (`aria-pressed`), both
sections mounted and the unselected one `hidden`; the only Escape owner while open (yields when `modalDialogOpen()`),
focus returns to a visible `openerRef` element else the trigger; selecting 設定 clears `openerRef`. No ARIA
menu/tab roles. `GamePanel` does not mount it in this step.
Tests: section switch, hidden section not focusable, Escape closes and returns focus, native modal keeps Escape, opener
fallback to trigger.
Acceptance: `npx vitest run tests/unit/phone-game-menu.test.ts`; typecheck; `npm run build`.

## Step 12 — Layout-aware E2E helpers (legacy UI stays green)
Files: `tests/e2e/support/app.ts`; `tests/e2e/text-wrapping.spec.ts` title `panel wrapping` only;
`tests/e2e/game-settings.spec.ts` title `presentation cycles and survives reload and new game with one-line menu labels at ${width}px` only.
Change: `openGameLog` / `closeGameLog` / `openGameMenu` / `closeGameMenu` detect the UI, not the viewport: if the legacy
trigger whose `aria-controls` targets the requested region is visible, use it as today; otherwise open the phone
hamburger (button 「メニュー」 controlling the phone wrapper) and press the section button 「ログ」/「設定」; closing either
section closes the phone surface; keep the labelled-region visibility assertions. In `panel wrapping` replace the
direct phone 「ログ」 click with `openGameLog()`; in the settings test route the phone reopen through `openGameMenu()`
(1280px variant behaviour unchanged). Keep every measurement and assertion. No `src/` change.
Acceptance (must pass on the current legacy UI):
```bash
npx playwright test tests/e2e/text-wrapping.spec.ts tests/e2e/game-settings.spec.ts --project=desktop-chromium --workers=2 --grep 'panel wrapping$|presentation cycles and survives reload and new game with one-line menu labels at (390|1280)px$'
npx playwright test tests/e2e/hud-layout.spec.ts tests/e2e/lottery.spec.ts tests/e2e/real-data.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/map-visual.spec.ts --project=phone-chromium --workers=2 --grep 'keeps the dice button at one HUD position across variable content and save states$|arrival lottery, both endpoint kinds and a direction-only draw are visible$|the Oedo legend checkbox groups both services and works by keyboard and phone touch$|the shipped Tokyo suburban product network starts, moves and restores without console errors$|regional target view and full overview fit outside the panel; operator line groups are selectable$|phone 全体 fits the collapsed-legend map area and remains clear when expanded$|the service legend collapses; 山手線 progress and 現在地 stay visible$'
```

## Step 13 — Phone surface and pill integration
Files: `src/features/game/components/GamePanel.tsx`, `src/styles.css`; `tests/unit/phone-game-menu.test.ts`;
`tests/e2e/hud-progress-feedback.spec.ts`; existing titles only: `tests/e2e/turn-result-card.spec.ts` `pill repeatedly
reveals log and restores focus`, `pill-opened log does not leave a stale opener`, `native dialog Escape preserves log`;
`tests/e2e/ui-pop.spec.ts` `tab order follows the visual inventory, staged, effects, and disclosure order`.
Change: under `usePhoneLayout()` render `PhoneGameMenu` (embedded `TurnLogDrawer` + `GameMenu`) in the disclosures
area instead of the legacy pair; `activeSurface` adds `"phone-menu"`, plus `phoneSection` state; the #66 pill opens
`"phone-menu"` + `"log"`, bumps the existing reveal counter and focuses the log (D20); breakpoint changes map the open
section to the equivalent surface; auto-roll pause and shortcut suppression via the existing `activeSurface !== null`.
Desktop and short landscape unchanged. Test edits per the plan's "Affected existing tests" rows for Step 13 (keep
repeated reveal, scroll, resize, two-stage Escape, forward/reverse tab sequence). New E2E `phone hamburger switches
between log and settings` (`@layout`; one trigger, C summary visible, section switch, hidden section out of tab order).
If the diff exceeds ~150 lines, stop and propose moving the breakpoint translation to Step 13a.
Acceptance:
```bash
npx vitest run tests/unit/phone-game-menu.test.ts
npx playwright test tests/e2e/turn-result-card.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/hud-progress-feedback.spec.ts --project=desktop-chromium --workers=2 --grep 'pill repeatedly reveals log and restores focus$|pill-opened log does not leave a stale opener$|native dialog Escape preserves log$|tab order follows the visual inventory, staged, effects, and disclosure order$|phone hamburger switches between log and settings$|auto roll publishes result and pauses for log$'
npx playwright test tests/e2e/turn-result-card.spec.ts tests/e2e/hud-progress-feedback.spec.ts --project=phone-chromium --workers=2 --grep 'pill repeatedly reveals log and restores focus$|pill-opened log does not leave a stale opener$|native dialog Escape preserves log$|phone hamburger switches between log and settings$|phone pill follows measured panel$'
# plus the Step 12 phone-chromium helper-covered command, unchanged
npm run build
```

## Step 14 — Final acceptance
Files: `tests/e2e/hud-progress-feedback.spec.ts` only.
Change: new E2E `milestone feedback publishes once and does not replay on resume` (desktop-chromium, fixture dataset;
bounded deterministic replay to a state whose next turn crosses 10 required segments, restored via `writeSaveText`;
fail with diagnostics if none found): one milestone toast and one announcement sentence, `.target-progress__flash`
present with reduced motion `no-preference` and absent with `reduce`; reload → no toast/announcement/flash replay.
No source changes; if a gate fails, report it instead of fixing outside scope.
Acceptance:
```bash
npm run typecheck && npx vitest run && npm run build
npx playwright test tests/e2e/hud-progress-feedback.spec.ts --project=desktop-chromium --workers=2
npx playwright test tests/e2e/hud-progress-feedback.spec.ts --project=phone-chromium --workers=2
# plus the two commands under "Regression list (final step)" in the plan
```

---

# Review prompt body (Sol low) — `.claude/logs/codex/prompt-hud65-s<STEP>-review.md`

Objective: Review the uncommitted diff of Step <STEP> of issue #65 against `.claude/docs/plans/hud-progress-feedback-plan.md`
(Decisions D1-D22, Step <STEP>, "Affected existing tests", "Validation amendments") and return APPROVE or
REQUEST_CHANGES. Base: `<BASE_SHA>` (`git diff <BASE_SHA>` plus untracked files).
Check: reveal leaks (A/C/B visible before their phase in the plan's publication-timing table, incl. classic animation,
Skip, pending discard, deadhead, resume); milestone order vs. the toast cursor and `goalGuidance` (30 compatibility, no
fallback); once-only announcement; flash suppression and identity; layout budgets (phone 252px / rows 18-34-34-18,
short landscape 3×18px, desktop no-scroll) untouched; existing test files unchanged except the titles the step names,
and no weakened assertion there; forbidden paths untouched; naming (`.hud-progress*`, `.target-progress__flash`,
`.phone-menu*`, `.clear-collection*`, `data-stat="proximity"`); a11y (no new live region, single Escape owner, focus
return); placeholders, swallowed errors, hard-coded results, scope creep beyond the step, LOC over ~150.
Output: ## Verdict (APPROVE / REQUEST_CHANGES) ## Findings (P1/P2/P3, file:line, why, fix) ## Verified ## Not verified
