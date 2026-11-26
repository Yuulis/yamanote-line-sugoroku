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
