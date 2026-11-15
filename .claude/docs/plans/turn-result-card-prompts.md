# Issue #66 per-step implementer prompt (Codex Luna xhigh)

One self-contained prompt per step. Replace `<STEP>` (1-13) and `<BASE_SHA>` (the commit the step starts from:
`git rev-parse HEAD` before the call). Write the body below to `.claude/logs/codex/prompt-trc-<step>.md`, then run:

```bash
mkdir -p .claude/logs/codex
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-trc-<step>.md --label trc-<step>-implement --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 --caller claude-main
```

Review after each step (Sol low, read-only):

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-trc-<step>-review.md --label trc-<step>-review --sandbox read-only --config model_reasoning_effort=low --timeout 1200 --caller claude-main
```

Lead verification after each step:

```bash
python3 .claude/skills/_shared/verify_delegation.py --base <BASE_SHA> --forbid-outside src --forbid-outside tests --label trc-<step>
git diff --stat <BASE_SHA> -- src/features/game/engine src/types/network.ts public data package.json package-lock.json   # must be empty
git diff <BASE_SHA> -- tests/unit tests/e2e | grep -E '^diff --git' # only new files (plus tests/e2e/support/turnResult.ts)
```

---

# Objective
Implement Step <STEP> of issue #66 (always-visible 「前のターン」 turn-result card, compact phone pill and short-landscape
compact row; phone HUD hides 出目) exactly as specified in `.claude/docs/plans/turn-result-card-plan.md` ("Step details" → "Step <STEP>"),
following its "Decisions", "Architecture", "Interfaces", "Validation amendments" and "Revision 2 — phone slimming"
sections, plus "Revision 3 — roll wording" (amendments, Revision 2 and Revision 3 override older step text where they conflict; there is no phone "strip", only the pill; the card roll text carries no modifier marks — 「出目N → 駅」 / 「回送 → 駅」, modifiers are shown only by item/effect chips). Earlier steps are committed on branch `feature/turn-result-card` at `<BASE_SHA>`
(status: `.claude/docs/plans/turn-result-card-handoff.md`). Background: brief
`.claude/docs/research/feature-turn-result-card-brief.md` (user decisions are binding), scan
`.claude/docs/research/feature-turn-result-card-codebase.md`, architecture
`.claude/logs/codex/20261112T072821Z-turn-result-card-arch.md`.

# Constraints
- Scope is Step <STEP> only: touch only the files the step lists. Do not start the next step. Stay within the step's
  LOC estimate (hard cap ~150 handwritten changed lines incl. tests); if the step cannot fit, stop and report why.
- Tests first (TDD) where the step has new behaviour. Existing test files must stay byte-identical: new unit cases go
  to the new files the plan names (`tests/unit/turn-result-*.test.ts`), new E2E cases to
  `tests/e2e/turn-result-card.spec.ts` (and the optional new helper `tests/e2e/support/turnResult.ts`). Never delete,
  skip or loosen an assertion.
- Presentation only. Forbidden: `src/features/game/engine/**`, RNG, save/persistence behaviour or format,
  `src/types/network.ts`, `public/**`, `data/**`, dependencies/lockfiles, version numbers.
- Components read only `turnDisplay.turnResult`; never `session.lastMove`, live inventory or `compactRollFor` labels
  for the card. No new live region, timer, reducer or publication boundary.
- New CSS classes are `.turn-result*` only; do not reuse `.game-panel__lottery`, `.item-arrival` or `data-stat`.
  Visible names come from the presentation resolver, never raw IDs.
- Repo conventions: TypeScript strict, existing naming/style, type annotations, named constants (no magic numbers —
  e.g. the 84px overview column inset, the 8px pill gutter and the 48px #65 reserve are named, as TS constants or CSS
  custom properties), early returns, immutable updates, no `any`, no
  swallowed errors, no TODO/placeholders. Japanese visible text through `PhraseText`; title/aria strings plain.
- Do not commit, create branches or change git state.
- E2E: targeted specs only with the exact `--grep '<title>$'` (suffix anchor; Playwright matches the full title
  path), `--workers=2`; never the full suite. Tag every phone case `{ tag: "@layout" }`. Default host (no E2E_HOST).
  Never use `pkill -f` / `pgrep -f`. Firefox needs `xvfb-run -a`; WebKit locally needs `E2E_WEBKIT=1`.
- Phone pill = compact content only (face, station, `+N区間` when N ≥ 1); no ride line, 乗換, item chips or modifier
  wording on phones. The phone HUD 出目 is hidden by CSS only (DOM unchanged); never edit an existing test to make that
  pass — if an existing assertion conflicts, stop and report it.
- If a fixture recipe's predicate (e.g. "this turn drew a lottery and completed a target segment") does not hold,
  fail with diagnostic state; do not silently substitute another scenario or hard-code expected strings that were not
  derived from the replayed state.

# Acceptance checks (run them and report results)
- The step's acceptance commands from the plan (including any added by "Validation amendments").
- `npx vitest run` (full) only if the step changed `src/` or `tests/unit/`.
- `git status --porcelain` shows only the files the step names (plus pre-existing untracked
  `.claude/docs/research/*.md` and the lead's plan/handoff docs).

# Output format
## Changes Made
## Tests Written (new files/cases) and confirmation that existing test files are unchanged
## Validation Results (command + pass/fail counts)
## Measurements (step-specific: px budgets, rectangles, viewport results, where the plan asks for them)
## Deviations from the plan (if any, with reason)
## Remaining Risks

---

# Review prompt body (Sol low) — `.claude/logs/codex/prompt-trc-<step>-review.md`

Objective: Review the uncommitted diff of Step <STEP> of issue #66 against
`.claude/docs/plans/turn-result-card-plan.md` (Step <STEP> plus "Validation amendments") and return APPROVE or
REQUEST_CHANGES. Base: `<BASE_SHA>` (`git diff <BASE_SHA>` plus untracked files).
Check: reveal leaks (new roll/lottery/item visible before its boundary, incl. `compact` and accessible names),
mixed-turn chips, roll wording per the plan's table (Revision 3: no modifier marks; effective face, never hopBudget/pips/rawRoll), +N区間/乗換 replay correctness, existing test files unchanged,
forbidden paths untouched, `.turn-result*` naming, no raw IDs, a11y (no new live region, one active variant),
measured-geometry (no 45% literal; pill right edge always clear of the 84px overview column; no overview measurement),
phone compact content only and phone 出目 hidden by CSS only, placeholders, swallowed errors, hard-coded results, scope creep beyond the step.
Output: ## Verdict (APPROVE / REQUEST_CHANGES) ## Findings (P1/P2/P3, file:line, why, fix) ## Verified ## Not verified
