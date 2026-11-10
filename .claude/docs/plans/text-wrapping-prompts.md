# Issue #70 per-step implementer prompt (Codex Luna xhigh)

Replace <STEP>. Write to `.claude/logs/codex/prompt-ttw-<step>.md`, then run:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-ttw-<step>.md --label ttw-<step>-implement --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 --caller claude-main
```

---

# Objective
Implement Step <STEP> of issue #70 (text wrapping and phone HUD readability) exactly as specified in
`.claude/docs/plans/text-wrapping-plan.md`: the "Revision 3 — lean test scope" table row for Step <STEP> overrides
the detailed §3 "Step <STEP>" section where they differ; otherwise follow §3, §1 (scope, display treatment,
forbidden areas) and §2 (architecture). Earlier steps are committed on branch `feature/text-wrapping`
(see `.claude/docs/plans/text-wrapping-handoff.md`). Background: brief
`.claude/docs/research/feature-text-wrapping-readability-brief.md`, scan
`.claude/docs/research/feature-text-wrapping-readability-codebase.md`.

# Constraints
- Scope is Step <STEP> only: touch only the files the step lists. Do not start the next step.
- Tests first (TDD) where the step has new behavior. Never delete, skip or loosen existing assertions; if the plan says
  an expectation/comment changes, change it to the new spec and say so.
- Repo conventions: TypeScript strict, existing naming/style, type annotations, named constants (no magic numbers),
  early returns, immutable updates, no `any`, no swallowed errors, no TODO/placeholders.
- Keep existing single-selector CSS blocks that unit regex tests require (plan Step 5 "CSS guardrail"): add
  declarations, never merge/move those blocks.
- Presentation only: no engine/RNG/save/`src/types/network.ts`/public data/pipeline/dependency changes.
- Do not commit, create branches or change git state.
- E2E: targeted specs only with the exact `--grep`, `--workers=2`; never the full suite. Default host (no E2E_HOST).
  Never use pkill -f / pgrep -f. Firefox needs `xvfb-run -a`; WebKit locally needs `E2E_WEBKIT=1`.

# Acceptance checks (run them and report results)
- `npm run typecheck`
- The step's acceptance commands from the plan (minus dropped titles per Revision 3).
- `npx vitest run` only if the step changed `src/` or `tests/unit/`.
- `git status --porcelain` shows only the files the step names (plus pre-existing untracked
  `.claude/docs/research/ux-improvement-analysis.md` and the lead's plan/handoff/research docs).

# Output format
## Changes Made
## Tests Written / Updated (and why any existing expectation changed)
## Validation Results (command + pass/fail counts)
## Deviations from the plan (if any, with reason)
## Remaining Risks
