# Auto-roll per-step implementer prompt (Codex Luna xhigh)

Replace <STEP>. Run:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-autoroll-<step>.md --label autoroll-<step>-implement --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 3000 --caller claude-main
```

---

# Objective
Implement step <STEP> of issue #64 stage 2 (auto-roll 「おまかせで進む」) in this repository, exactly as specified in
`.claude/docs/plans/auto-roll-plan.md` section "<STEP> — …", together with the interfaces, data flow, error
handling and keyboard contract sections it references. Earlier steps are already committed on branch
`feature/auto-roll` (see `.claude/docs/plans/auto-roll-handoff.md`).

# Constraints
- Scope is <STEP> only: touch only the files that section lists (plus fixtures the type changes force, as the plan
  says). Do not start the next step. Do not expose controls the plan says belong to a later step.
- Tests first (TDD) for every case listed in the step's "Tests first" bullet. Never delete, skip or loosen existing
  assertions to make tests pass; when the plan says an expectation changes (e.g. click counts, menu lists), update it
  to the new spec and say so.
- Follow repo conventions: TypeScript strict, existing naming/style, type annotations, no magic numbers, early
  returns, immutable updates, no `any`, no swallowed errors, no TODO/placeholders. Keep `src/app/GameApp.tsx` from
  growing past 488 lines; put new logic in hooks/modules as the plan says.
- Auto-roll is never persisted and only ever calls the existing guarded roll; it never answers adjust/discard
  decisions and never spends a staged item. User answers 2026-11-09: resume after discarding the new item itself,
  stop if the new item was kept; resume after answering the roll-adjust dialog; a staged item pauses auto.
- No rule/RNG changes, no `SAVE_VERSION` change, no analytics changes.
- Do not commit, do not create branches, do not change git state.
- E2E: use the repository default host (do not set E2E_HOST). Never use pkill -f / pgrep -f.

# Acceptance checks (run them and report results)
- `npm run typecheck`
- The step's "Local checks" commands from the plan (vitest files and, if listed, the Playwright specs/projects).
- `npx vitest run` (full unit suite) must stay green.
- `git status --porcelain` shows only the files the step names (plus pre-existing untracked
  `.claude/docs/research/ux-improvement-analysis.md`).

# Output format
## Changes Made
## Tests Written / Updated (and why any existing expectation changed)
## Validation Results (command + pass/fail counts)
## Deviations from the plan (if any, with reason)
## Remaining Risks
