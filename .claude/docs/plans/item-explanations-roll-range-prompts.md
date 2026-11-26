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
