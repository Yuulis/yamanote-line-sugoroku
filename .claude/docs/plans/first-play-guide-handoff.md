# First-play guide (#67) + remove おまかせ (#113) — Handoff

Resume from here. Plan: `.claude/docs/plans/first-play-guide-plan.md` (Codex validation: Revision 1 NEEDS_REVISION → Revision 2 **PASS**; Revision 3 = lead edit for the user's off-target copy choice). **Approved by the user 2026-11-20.** Brief: `.claude/docs/research/feature-first-play-guide-brief.md`. Scan: `.claude/docs/research/feature-first-play-guide-codebase.md`. Step prompts: `.claude/docs/plans/first-play-guide-prompts.md`.

Codex consults:
- scope `.claude/logs/codex/20261120T055618Z-first-play-scope.md` (COMPLEX)
- architecture `.claude/logs/codex/20261120T060000Z-first-play-arch.md`
- plan R1 `.claude/logs/codex/20261120T060300Z-first-play-plan.md`, validation `.claude/logs/codex/20261120T060707Z-first-play-validate.md` (NEEDS_REVISION)
- plan R2 `.claude/logs/codex/20261120T060947Z-first-play-plan-r2.md`, re-validation `.claude/logs/codex/20261120T061512Z-first-play-validate-r2.md` (**PASS**)

Process:
- Branch: `feature/first-play-guide` (from develop 3b048f4, v0.17.1). Flow: feature → PR → develop → PR → master. The release PR lists `Closes #67` and `Closes #113`.
- Pacing: **stop after every step** for user review (user 2026-11-20); verify, review, commit, push, check CI per step.
- Roles: Codex Luna xhigh implements (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --timeout 2400`), Sol low reviews, the lead verifies, commits, pushes and checks CI.
- Local E2E: targeted specs only, `--workers=2`. The full 4-project matrix runs in CI (branch push = desktop-chromium; PR = full matrix; phone = `@layout`).
- Hard constraints: presentation only (no engine / RNG / save format / `src/types/network.ts` / public / data / deps). `lint` is not configured. Phone HUD 252px at 320x568.
- User decisions 2026-11-20: DESIGN.md rows dated 2026-11-20; off-target hint is one sentence and only shown where it applies (plan Revision 3).

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1 remove おまかせ (#113) | in progress | | |

## Next

Step 1.
