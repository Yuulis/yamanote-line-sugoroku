# Issue #62 per-step implementer prompt (Codex Luna xhigh)

Replace <STEP>. Write to `.claude/logs/codex/prompt-mg-<step>.md`, then run:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-mg-<step>.md --label mg-<step>-implement --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 --caller claude-main
```

---

# Objective
Implement Step <STEP> of issue #62 (map guidance and direction) exactly as specified in
`.claude/docs/plans/map-guidance-plan.md` ("Implementation Plan" → "Step <STEP>"), following its "Decisions" table and
"Architecture" section. Earlier steps are committed on branch `feature/map-guidance`
(see `.claude/docs/plans/map-guidance-handoff.md`). Background: brief
`.claude/docs/research/feature-map-guidance-and-direction-brief.md` (user decisions are binding), scan
`.claude/docs/research/feature-map-guidance-and-direction-codebase.md`.

# Constraints
- Scope is Step <STEP> only: touch only the files the step lists. Do not start the next step.
- Tests first (TDD) where the step has new behavior. Never delete, skip or loosen existing assertions; if the plan says
  an expectation changes, change it to the new spec and say so.
- Repo conventions: TypeScript strict, existing naming/style, type annotations (Python too), named constants (no magic
  numbers), early returns, immutable updates, no `any`, no swallowed errors, no TODO/placeholders.
- Global forbidden areas (plan): engine source, RNG, save/persistence behavior, SAVE_VERSION, `src/types/network.ts`,
  dependencies/lockfiles, version numbers, frozen data/staging, `product_suburban verify` — except the data/validator
  changes the step explicitly allows.
- Do not commit, create branches or change git state.
- E2E: targeted specs only with the exact `--grep`, `--workers=2`; never the full suite. Default host (no E2E_HOST).
  Never use pkill -f / pgrep -f. Firefox needs `xvfb-run -a`; WebKit locally needs `E2E_WEBKIT=1`.
- Python: always through `uv run`.

# Acceptance checks (run them and report results)
- The step's acceptance commands from the plan.
- `npx vitest run` (full) only if the step changed `src/` or `tests/unit/`.
- `git status --porcelain` shows only the files the step names (plus pre-existing untracked
  `.claude/docs/research/ux-improvement-analysis.md` and the lead's plan/handoff/research docs).

# Output format
## Changes Made
## Tests Written / Updated (and why any existing expectation changed)
## Validation Results (command + pass/fail counts)
## Deviations from the plan (if any, with reason)
## Remaining Risks
