# Tempo stage 1 — per-step implementer prompt (Codex Sol, default effort)

Substitute `<STEP>` (e.g. S2) and `<EXTRA>` (step-specific notes; may be empty). Run with:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file .claude/logs/codex/prompt-tempo-<step>.md --label tempo-<step>-implement \
  --sandbox danger-full-access --timeout 2400 --caller claude-main
```

---

# Objective
Implement step <STEP> of issue #64 stage 1 in this repository, exactly as specified in
`.claude/docs/plans/tempo-stage1-plan.md` section "<STEP> — …", together with the interfaces, data flow, error
handling and keyboard contract sections it references. Earlier steps are already committed on branch
`feature/tempo-stage1` (see `.claude/docs/plans/tempo-stage1-handoff.md`).

# Constraints
- Scope is <STEP> only: touch only the files that section lists (plus fixtures the type changes force, as the plan
  says). Do not start the next step. Do not expose controls the plan says belong to a later step.
- Tests first (TDD) for every case listed in the step's "Tests first" bullet. Never delete, skip or loosen existing
  assertions to make tests pass; when the plan says an expectation changes (e.g. click counts, menu lists), update it
  to the new spec and say so.
- Follow repo conventions: TypeScript strict, existing naming/style, type annotations, no magic numbers, early
  returns, immutable updates, no `any`, no swallowed errors, no TODO/placeholders. Keep `src/app/GameApp.tsx` from
  growing past 488 lines; put new logic in hooks/modules as the plan says.
- Follow persistence is menu-toggle only; a manual pan's 追尾 OFF is session-only and never written (user decision
  2026-11-08).
- No rule/RNG changes, no `SAVE_VERSION` change, no analytics changes.
- Do not commit, do not create branches, do not change git state.
<EXTRA>

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
