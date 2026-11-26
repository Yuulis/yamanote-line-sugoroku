# Issue #61 delegation prompts

Prompts for Codex runs (Luna xhigh implements, Sol low reviews). Re-run with:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file <extracted prompt> --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" \
  --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 \
  --label issue61-s13 --caller claude-main
```

## Step 1.3 — implement

Objective: implement Step 1.3 of `.claude/docs/plans/item-explanations-roll-range-plan.md`
(harmful-pickup toast gets a second line describing the consequence) as one uncommitted step.

Scope:
- IN: exactly the "Step 1.3" section of the plan and the files it names
  (`src/features/game/toastQueue.ts`, `src/features/game/components/ToastHost.tsx`,
  `src/styles.css` toast block, `tests/unit/toast.test.ts`, `tests/unit/toast-notice.test.ts`,
  `tests/e2e/ui-pop.spec.ts` toast clearance test). Copy is fixed by the user (plan section 7, C2):
  - 遅延: 「{n}ターン後の出目が1になります」
  - 運休 (line 1 stays 「{路線}が運休！」): 「あと{n}ターン、この路線に乗れません」
  - 寄り道: 「次に乗り換えられる駅で、別の路線に移ります」
  - 寝過ごし: 「次のターンは終点まで進みます（環状線は6駅）」
  - {n} = the event's `dueTurn` / `expiresTurn` minus the recorded move turn (as in plan C2).
  Line 1 stays byte-identical. Cancelled-by-certificate, effect-activated and expiry toasts stay
  single-line. Display time stays 4000 ms.
- OUT: everything in other steps (dialog, map, ±2/±3), DESIGN.md, STATE.md, the plan file.
  No new dependencies. Do not commit or push.
- Hard constraints: do not weaken, skip or delete any test assertion; toast `min-height: 44px`
  stays; the toast must still clear map attribution and controls on desktop and phone.

Context: Steps 1.1–1.2 already landed (commits 14f55b2, d3b8b6f, 76a4b66). Read plan sections 1–2
and the research map `.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`.
Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; iterate with --grep on one project; do NOT run the whole E2E suite or other
browsers; keep Playwright LOCAL_WORKERS at 2; never `pkill -f`):

```bash
npm run typecheck
npx vitest run tests/unit/toast.test.ts tests/unit/toast-notice.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/ui-pop.spec.ts --project=desktop-chromium --grep "ordinary item toast|toasts clear attribution"
npx playwright test tests/e2e/ui-pop.spec.ts --project=phone-chromium --grep "toasts clear attribution"
```

Output (markdown): changed files (one line each); the exact strings rendered for each harmful kind
with an example turn count; acceptance results with pass/fail counts; any assertion edited
(before/after, why); risks.

## Step 1.4 — implement

Objective: implement Step 1.4 of `.claude/docs/plans/item-explanations-roll-range-plan.md`
(the roll-adjustment dialog becomes non-modal so the map can be panned and zoomed while it is
open) as one uncommitted step.

Scope:
- IN: exactly the "Step 1.4" section of the plan, including the paragraph "Added after the 1.2
  review" (`EffectChips` closes an open chip card while the adjustment decision is open). Design
  is fixed by plan decision D6 (sibling of `<main class="game-panel">`, `inert` on the panel and
  the phone result pill while the decision is open, `dialog.show()`, heading focused on open,
  window-level Escape = 「そのまま」 consumed before menu/map/shortcut handlers, existing
  post-decision dice focus path kept).
- OUT: Step 1.5 (no-refit after a camera move, restoring following) and everything later;
  DESIGN.md, STATE.md, the plan file. No new dependencies. Do not commit or push.
- Hard constraints:
  - Do not weaken, skip or delete test assertions. `accessibility.spec.ts:523-537` (first
    Escape closes the dialog, menu stays open) keeps its assertion.
  - Without the top layer the dialog must still sit above the map and the panel on desktop,
    phone portrait and short landscape, and stay fully reachable (the phone decision-sheet fit
    tests must pass unchanged).
  - Known traps from earlier steps: the global `button { min-height: 44px }` rule
    (`src/styles.css` ~545) applies to every new `<button>`; Firefox makes overflowing
    scrollers tab stops. React 19 supports the boolean `inert` prop.

Context: Steps 1.1–1.3 landed (14f55b2, d3b8b6f, 76a4b66, ead66f0). Read plan sections 1–2 and
the research map `.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`
(RollAdjustment.tsx:33-53, GamePanel.tsx:740/810/822/625-641, styles.css:2314-2318,
RailwayMap.tsx). Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; iterate with --grep on one project; do NOT run the whole E2E suite or
other browsers; keep Playwright LOCAL_WORKERS at 2; never `pkill -f`):

```bash
npm run typecheck
npx vitest run tests/unit/item-controls.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/rules-entry-points.test.ts tests/unit/game-hud.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "roll adjustment landing map preview|pending reload retains|map failure keeps the adjust"
npx playwright test tests/e2e/resume.spec.ts --project=desktop-chromium --grep "pending-discard|item pickup toast|adjust"
npx playwright test tests/e2e/items.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/text-wrapping.spec.ts --project=phone-chromium --grep "roll adjustment landing map preview|decision sheet fit|phone populated layout|dialog wrapping"
```

(`accessibility.spec.ts` and `ui-pop.spec.ts` run in full on desktop-chromium because this step
changes focus, inert and Escape handling across the panel.)

Output (markdown): changed files (one line each); behaviour of open/Escape (dialog focus, map
focus, menu open)/Tab reaching the map/decision → focus; how stacking (z-index) is done per
layout; acceptance results with pass/fail counts; any assertion edited (before/after, why); risks.

## Step 1.4 — fix after Sol review (CHANGES)

Objective: fix the two blocking findings from the Sol review of the uncommitted Step 1.4 diff
(non-modal roll-adjustment dialog) without changing anything else.

1. `src/features/game/components/RollAdjustment.tsx` (~line 45, window capture Escape handler):
   in a game already in progress, opening 「新規」 (new game confirmation) from the menu during the
   roll presentation lets the modal confirmation and the adjustment dialog coexist; the
   adjustment handler then consumes the Escape meant for the confirmation and commits the roll
   while the confirmation stays open. Fix: return early (do nothing) when a higher modal dialog is
   open (e.g. `document.querySelector("dialog:modal")` or the existing `modalDialogOpen()` helper
   if it distinguishes modal from this non-modal dialog — check `GameMenu.tsx:34-36`). Add a
   regression test (unit in `tests/unit/item-controls.test.ts` or e2e in
   `tests/e2e/accessibility.spec.ts`, whichever reproduces it reliably): with both open, the first
   Escape closes the confirmation only and the adjustment dialog stays open; the next Escape
   closes the adjustment (continue without adjustment).
2. `tests/e2e/items.spec.ts` (~line 377): the status-count assertion moved from the panel to the
   dialog, so an extra status left in the panel would go unnoticed. Assert that
   `.game-panel [role="status"], .item-adjustment [role="status"]` together count exactly 1
   (keep the in-dialog assertion too).

Constraints: no other changes; do not weaken or remove assertions; do not commit or push;
LOCAL_WORKERS 2; never `pkill -f`; no full E2E suite or other browsers.

Acceptance:

```bash
npm run typecheck
npx vitest run tests/unit/item-controls.test.ts tests/unit/game-app-turn-moments.test.ts
npx playwright test tests/e2e/accessibility.spec.ts --project=desktop-chromium --grep "adjust|Escape|new game|新規"
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "roll adjustment landing map preview|pending reload retains"
```

Output (markdown): changed files and lines; how the modal check works; the new test name;
acceptance results.

## Step 1.5 — implement

Objective: implement Step 1.5 of `.claude/docs/plans/item-explanations-roll-range-plan.md`
(during the roll-adjustment preview, a user camera move stops the auto refit, and following is
restored when the decision closes the dialog) as one uncommitted step.

Scope:
- IN: exactly the "Step 1.5" section of the plan and decision D7; user decision C3 (plan
  section 7, changed 2026-11-25): a camera move during the adjustment preview must not leave
  following OFF — when the decision is made (any choice or 「そのまま」) and the dialog closes,
  following returns to the state it had when the dialog opened, so the camera follows the token
  as it starts moving. Manual moves outside the adjustment dialog keep today's behaviour
  (following OFF until the menu toggle). Use the existing owner of the follow state (find where
  `onUserCameraMove` turns following off); do not add a second source of truth.
- OUT: Step 1.6 and PR2 work; DESIGN.md, STATE.md, the plan file. No new dependencies. Do not
  commit or push.
- Hard constraints: do not weaken, skip or delete test assertions; existing no-gesture refit
  assertions in "roll adjustment landing map preview" stay.

Context: Step 1.4 landed in 69350be (dialog is non-modal; the map is operable while it is open;
`tests/e2e/items.spec.ts` already zooms during the preview). Research map:
`.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`
(RailwayMap.tsx:717-723 onUserCameraMove, :850-852 and :862-887 fitAdjustmentPreview).
Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (iterate with --grep on one project; no full E2E suite, no other browsers;
LOCAL_WORKERS 2; never `pkill -f`):

```bash
npm run typecheck
npx vitest run tests/unit/roll-adjustment-preview.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "roll adjustment landing map preview"
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --grep "roll adjustment landing map preview"
npx playwright test tests/e2e/map-guidance.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --grep "follow|追尾|camera"
```

(If `map-guidance.spec.ts` does not exist, grep tests/e2e for the specs that cover following /
「追尾」 and run those instead; list them.)

Output (markdown): changed files (one line each); how the override flag and the follow restore
work (where state lives, when it resets); acceptance results; any assertion edited; risks.

## Step 2.1 — implement (branch feature/roll-adjust-range from develop after PR1 #133)

Objective: implement Step 2.1 of `.claude/docs/plans/item-explanations-roll-range-plan.md`
(simulation harness split into a test-only legacy config and the product config) as one
uncommitted step; no production behaviour changes.

Scope:
- IN: exactly the "Step 2.1" section of the plan and decision D4 (files
  `tests/simulation/item-engine/{runner,policy,item-engine.test}.ts`,
  `tests/unit/item-simulation-policy.test.ts`). In this step the legacy and product configs are
  identical, so every existing number must stay green.
- OUT: anything under `src/`; `tests/simulation/item-spike/` (frozen, do not touch); Steps
  2.2+; DESIGN.md, STATE.md, the plan file. No new dependencies. Do not commit or push.
- Hard constraints: do not weaken, skip or delete assertions; the frozen parity and
  greedy-reference assertions keep their exact expected values (they now run on the legacy
  config only); product rows assert structure only (no errors, cap hits 0, determinism, save
  checks) and record statistics.

Context: PR1 (#133) is merged into develop. Research map:
`.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`
(item-engine.test.ts:99, item-spike/sim.ts:419, policy.ts:95). Rules: AGENTS.md,
.claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance:

```bash
npm run typecheck
npx vitest run tests/unit/item-simulation-policy.test.ts
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
npx vitest run
```

(Check `package.json` for the exact `sim` script and env names; if they differ from the plan,
use the real ones and say so.)

Output (markdown): changed files (one line each); how the run config is threaded (game
creation, restore checks, chooser `maxFace`); acceptance results with counts and the sim
summary lines; any assertion edited; risks.

## Step 2.2 — implement

Objective: implement Step 2.2 of `.claude/docs/plans/item-explanations-roll-range-plan.md`
(generalise the roll adjustment to magnitudes with only ±1 existing — a refactor with no rule,
save or visible change) as one uncommitted step.

Scope:
- IN: exactly the "Step 2.2" section of the plan and decisions D2 and D11. User decisions
  (plan section 2 / 7): a ±N ticket offers exactly −N and +N (not "up to N"); the adjusted face
  must stay ≥ 1; distinct legal deltas map to the first owned instance of their kind
  (inventory order). In this step only `roll-adjust` exists and the face stays 1..6 through the
  temporary `MAX_ADJUSTED_FACE = 6` constant (removed in 2.3).
- OUT: new item kinds, drop weights, ruleset/SAVE_VERSION, save schema (stays ±1 and 1..6),
  fixtures under tests/e2e/fixtures, docs, DESIGN.md, STATE.md, the plan file. No new
  dependencies. Do not commit or push.
- Hard constraints: no visible change for today's ±1 ticket (labels, order, focus, copy stay
  byte-identical unless the plan says otherwise — list any string you change); do not weaken,
  skip or delete assertions (fixture-shape updates only for the `allowedDeltas` +
  `itemInstanceIds` → `choices` contract); 5,000-game legacy parity must still pass.

Context: Step 2.1 (7248632) split the simulation into `LEGACY_SIMULATION_CONFIG` (maxFace 6) and
`PRODUCT_SIMULATION_CONFIG` (temporary `supportedMaxFace: 6` in runner.ts — leave it for 2.3).
PR1 made the dialog non-modal (RollAdjustment.tsx uses `show()` and a window Escape handler —
keep that behaviour). Research map:
`.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`.
Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (iterate with --grep on one project; no full E2E suite, no other browsers;
LOCAL_WORKERS 2; never `pkill -f`):

```bash
npm run typecheck
npx vitest run tests/unit/item-roll-adjust.test.ts tests/unit/engine-item-turn.test.ts tests/unit/game-session-items.test.ts tests/unit/item-controls.test.ts tests/unit/hud-presentation.test.ts tests/unit/roll-adjustment-preview.test.ts tests/unit/item-presentation.test.ts tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/item-simulation-policy.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --grep "adjust|map failure keeps"
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --grep "decision sheet fit|roll adjustment landing map preview"
npx playwright test tests/e2e/accessibility.spec.ts --project=desktop-chromium --grep "adjust|Escape"
```

(Check `package.json` for `npm test`; the lead runs the 5,000-game simulation separately.)

Output (markdown): changed files (one line each); the new decision contract (`choices` shape) and
where kind ↔ |delta| and the face bounds are validated; any user-visible string changed
(expected: none); acceptance results with counts; any assertion edited (before/after, why); risks.

## Step 2.3 — implement

Objective: implement Step 2.3 of `.claude/docs/plans/item-explanations-roll-range-plan.md`
(ruleset switch: 出目調整券±2/±3 as new kinds, no upper bound on the adjusted face, weighted
beneficial drops, ruleset `tokyo-suburban-items-2`, SAVE_VERSION 5, regenerated fixtures, docs)
as ONE uncommitted step.

Scope:
- IN: the whole "Step 2.3" section of the plan INCLUDING the paragraph "Added after the 2.1
  review" (remove the temporary `supportedMaxFace: 6` cap in
  `tests/simulation/item-engine/runner.ts`; boundary test on the real `PRODUCT_SIMULATION_CONFIG`
  asserting 6→7 and 6+3→9 are reachable; the legacy-config identity test becomes an assertion
  against the frozen legacy literal). Decisions D1, D2, D3, D11 and user decisions (plan §2/§7),
  all final:
  - three separate kinds; a ±N ticket offers exactly −N and +N; adjusted face ≥ 1, no upper
    bound (remove `MAX_ADJUSTED_FACE`).
  - weights: six other beneficial kinds 6 each, ±1/±2/±3 = 3/2/1; 300‰ drop chance and 30%
    harmful share unchanged.
  - names (C4): 「出目調整券±1」「出目調整券±2」「出目調整券±3」; short 「調整±1」「調整±2」「調整±3」;
    effect 「出目を見てから、出目にNを足すか引くかできる（1より小さくはできない）」.
  - old v4 save in the same data version (C5): 「ゲームのルールが変わったため、このセーブデータは続きから遊べません。」;
    historical classic v4 keeps 「路線データが更新されたため…」; other unsupported versions keep
    「このバージョンでは読み込めない形式のセーブデータです。」; malformed stays 「壊れている」.
- OUT: drop chance, harmful share, any new item kind besides the two tickets, DESIGN.md,
  STATE.md, the plan file. No new dependencies. Do not commit or push.
- Hard constraints: do not weaken, skip or delete assertions (fixture regeneration and
  v4→v5 / name changes per C4 are expected — list each); historical fixtures keep their bytes;
  the frozen spike `tests/simulation/item-spike/` is untouched; the legacy sim config keeps
  passing frozen parity (seven explicit equal weights). Phone decision sheet with 7 choices:
  every choice visible, ≥ 44px, sheet ≤ 45% of the viewport — if that cannot hold, STOP and
  report measurements instead of loosening thresholds.

Context: Steps 2.1 (7248632) and 2.2 (2a37bf7) landed: `choices: {delta, instanceId}[]`
contract, `src/features/game/itemRollAdjust.ts` (`ROLL_ADJUST_MAGNITUDE`, `legalAdjustments`,
temporary `MAX_ADJUSTED_FACE = 6`), sim `LEGACY_SIMULATION_CONFIG` / `PRODUCT_SIMULATION_CONFIG`.
PR1 made the adjustment dialog non-modal. Fixture regeneration command:
`tests/e2e/fixtures/README.md`. Research map:
`.claude/docs/research/feature-item-explanations-and-roll-adjustment-range-codebase.md`.
Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (iterate with --grep on one project; do NOT run the whole E2E suite or other
browsers; LOCAL_WORKERS 2; never `pkill -f`):

```bash
npm run typecheck
npx vitest run tests/unit/engine-items.test.ts tests/unit/engine-item-turn.test.ts tests/unit/engine-save.test.ts tests/unit/engine-save-v2.test.ts tests/unit/engine-save-v3.test.ts tests/unit/engine-save-v4.test.ts tests/unit/engine-game.test.ts tests/unit/persistence.test.ts tests/unit/engine-policy-config.test.ts tests/unit/edition-registry.test.ts tests/unit/game-session-items.test.ts tests/unit/item-controls.test.ts tests/unit/item-presentation.test.ts tests/unit/rules-guide.test.ts tests/unit/e2e-fixture-seeds.test.ts tests/unit/real-data-e2e-scenarios.test.ts tests/unit/item-simulation-policy.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/items.spec.ts tests/e2e/save-errors.spec.ts --project=desktop-chromium --grep "adjust|decision sheet|map failure keeps|unsupported format|historical classic v4"
npx playwright test tests/e2e/turn-result-card.spec.ts tests/e2e/resume.spec.ts --project=desktop-chromium --grep "adjust"
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --grep "decision sheet fit|roll adjustment landing map preview"
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
```

Also grep tests/e2e for `roll-adjust`, `出目調整券`, `tokyo-suburban-items-1` and `SAVE_VERSION`/`version: 4`
and run the affected specs with `--grep` on desktop-chromium.

Output (markdown): changed files grouped (rules/persistence, UI, sim, fixtures, docs, tests);
seeds that drifted and the new `adjust-wide` seed; the exact user-visible strings added/changed;
phone 7-choice sheet measurements at 320×568 and 390×844; acceptance results with counts and the
100-game product/legacy sim summary; every assertion edited (before/after, why); risks.

## Step 2.3 — fix after Sol review (CHANGES)

Objective: fix the blocking findings of the Sol review of the uncommitted Step 2.3 diff (ruleset
switch: ±2/±3 tickets, weights, save v5) without changing anything else. The rest of Step 2.3 is
done and green (typecheck, vitest, build, E2E acceptance, 5,000-game sim) — keep it that way.

Blocking:
1. `src/features/game/engine/save.ts` (~:366 `sameConfig` / `sameList`): `beneficialWeights` are
   not compared, so a v5 save with different draw weights passes `expectedConfig`. Make `sameList`
   work for number arrays and compare the weights in order. Regression test: a v5 save whose
   config differs only in weights is rejected like any other config mismatch.
2. `src/features/game/engine/config.ts` (~:114): weights validation uses `map`, which skips holes,
   so a sparse array of the right length passes and fails later at draw time. Validate every
   index (positive integer, length = kinds). Regression test with a sparse array.
3. `src/features/game/engine/save.ts` (~:151): the v4 peek compares `dataVersion` without checking
   it is a string, so `{"saveVersion":4}` is classified as "路線データ更新". Validate it as a
   string first: same current dataVersion → rules-changed problem; a different valid string →
   data-version problem (historical classic v4 unchanged); missing/invalid → the generic
   unsupported/malformed path (choose the existing problem that matches today's behaviour for a
   malformed envelope; say which). Regression tests for missing and non-string dataVersion.

Non-blocking (do these too):
4. `tests/unit/fixtures/current-product-records.json` (new, untracked) must be produced by the
   existing regeneration script `tests/e2e/fixtures/regenerate-saves.ts` (~:31) so the command in
   `tests/e2e/fixtures/README.md` regenerates it; verify the regenerated bytes equal the current
   file.
5. `docs/manual/tokyo-suburban/rules.md:18`: state that the six ordinary beneficial kinds have
   weight 6 each (so the 3/2/1 ticket ratio reads correctly).
6. `tests/e2e/fixtures/README.md` (~:41): the "seeded turn-41 restore" text must match the current
   test (a v4 save now yields RULES_VERSION_MISMATCH even with the old data version).

Constraints: no other changes; do not weaken or remove assertions; do not commit or push;
LOCAL_WORKERS 2; never `pkill -f`; no full E2E suite or other browsers.

Acceptance:

```bash
npm run typecheck
npx vitest run tests/unit/engine-save.test.ts tests/unit/engine-save-v4.test.ts tests/unit/engine-policy-config.test.ts tests/unit/persistence.test.ts tests/unit/real-data-e2e-scenarios.test.ts tests/unit/e2e-fixture-seeds.test.ts
npx vitest run
npx playwright test tests/e2e/save-errors.spec.ts --project=desktop-chromium
```

Output (markdown): changed files and what changed; the classification table for v4 envelopes
(current dataVersion / other string / missing / non-string → problem + copy); regeneration
check result for item 4; acceptance results with counts.

## Step 2.3 — CI fix: re-pin drifted seeds and fixtures

Objective: make branch `feature/roll-adjust-range` (HEAD a0e32c5 + any later docs commits) green
on desktop-chromium and phone `@layout` again after the ruleset switch, by re-pinning every
seed/scenario/fixture that drifted because the beneficial drop pool changed — never by weakening
tests.

Evidence: CI run on a0e32c5 failed 6 unit tests and 57 desktop-chromium E2E tests. List:
`.claude/logs/issue61-s23-ci/failing-e2e.txt`. Error mix: mostly `toHaveText` mismatches,
`element(s) not found`, and `Seed 00000000000000000000000000000004 did not reach turn 255`
(clear-replay-share and other clear/replay specs rely on pinned clears). Unit failures (reproduce
with `npx vitest run`): history-rows, hud-progress-publication, turn-moment-items (3),
turn-moment-presentation — all consumers of `itemScenario("double")`.

Known cause of the unit failures: a debugger re-pinned `double` in
`tests/e2e/fixtures/itemScenarios.ts` to seed …6b turn 10 so that the phone test
`tests/e2e/ui-pop.spec.ts:201` ("phone tap opens, closes, and uses the item card") finds both
倍速券 and 出目調整券±1. Fix it properly: restore `double` to the pin the unit tests were written
for (the one at a0e32c5's parent change, seed …03 turn 2 — check git log -p of itemScenarios.ts)
and give the phone test a dedicated scenario (e.g. `double-adjust`, seed …6b turn 10, valid on
both `fixture` and `real` datasets: status playing, no pending decision, holds `double` and
`roll-adjust`, still playing after a doubled turn) — or another approach that keeps every
consumer's intent. Add a unit pin guard for the new scenario in
`tests/unit/e2e-fixture-seeds.test.ts` next to the `adjust-wide` one.

Scope:
- IN: seeds and pins (`tests/e2e/fixtures/seeds.ts`, `itemScenarios.ts`, support helpers),
  regenerated fixture saves via the documented command (`tests/e2e/fixtures/README.md`), and
  expected values in specs/unit tests that legitimately follow a re-pinned scenario (same intent,
  same predicates). When re-pinning, search with the dataset each consuming spec uses
  (`test.use({ dataset })`: `fixture` vs `real`).
- OUT: product code under `src/` (only if you prove a real product bug — then stop and report it
  instead of fixing), thresholds, the frozen sim spike, docs other than fixture READMEs.
- Hard constraints: do not weaken, skip or delete assertions; do not change what a test checks;
  historical fixtures keep their bytes; do not commit or push; LOCAL_WORKERS 2; never
  `pkill -f`; no firefox/webkit runs.

Acceptance (run all; run the affected spec files in full on desktop-chromium, not the whole suite):

```bash
npm run typecheck
npx vitest run
npx playwright test $(cut -d' ' -f3 .claude/logs/issue61-s23-ci/failing-e2e.txt | cut -d: -f1 | sort -u | tr '\n' ' ') --project=desktop-chromium
npx playwright test tests/e2e/ui-pop.spec.ts tests/e2e/items.spec.ts tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --grep @layout
```

Write progress notes to `.claude/logs/issue61-s23-ci/progress.md` as you go (which spec is done)
so a timeout does not lose the state.

Output (markdown): each re-pinned seed/scenario (old → new, predicate, datasets checked); expected
values changed and why each is a pin follow-up rather than a weakening; acceptance results with
counts; anything left failing with its error.
