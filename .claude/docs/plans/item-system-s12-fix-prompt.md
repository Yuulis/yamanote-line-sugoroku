# Item system S12 — fix three final-review findings

## Objective
Fix the three P2 defects from the final feature review, each with a regression test, without changing game rules, save format or unrelated behaviour.

## Context
Branch `feature/item-system` (S1-S11 committed). Review notes: `.claude/logs/codex/` latest `*item-s12-review.md`. Plan constraint (`.claude/docs/plans/item-system-plan.md` section 4): deadhead must not use a fake roll of 0 or fabricated segments; `landing: null` must not imply cleared. Do not commit, push or switch branches.

## Findings
1. `src/app/GameApp.tsx:90` — during the `resolving` phase the post-move `game` is passed to the display while `session.animation` is still `null`, so the arrival station/progress flashes before the save attempt, then jumps back to the animation start (reproduced: fixture data, seed `review-order`, first roll: 浜松町 shown during save, then 新橋 before the first animation frame). Fix: keep showing the pre-move position/progress while resolving; switch to the animation only after the save attempt. Add a test that asserts the displayed station during `resolving` is the origin (unit/JSDOM or the existing session/presentation test style; an E2E assertion is welcome if cheap).
2. `src/app/GameApp.tsx:93` — the display adapter converts deadhead records into legacy move records with `roll: 0`, `stopReason: "roll"`, `landing: null`. Remove the fake record: pass `displayedProgress` what it needs through a dedicated type or handle item records directly. Add a test that a deadhead history (live and restored) renders/derives progress without any `roll: 0` record and shows the relocation correctly.
3. `src/features/game/itemPresentation.ts:40` — reason `fixed-direction` is shown as 「山手線は向きが固定」 even on non-Yamanote services where only one direction is movable (e.g. 京急本線 普通 at 泉岳寺). Split the reason: Yamanote → 「山手線は向きが固定です」 (or the existing copy), single movable direction elsewhere → 「この駅では進める向きが1つです」. Update the session view reason type if needed and add tests for both cases.

## Constraints
Only touch files needed for these fixes and their tests (`GameApp.tsx`, presentation/session helpers, `itemPresentation.ts`, `itemSession.ts`, related tests). Keep `tests/unit/item-classic-regression.test.ts` untouched. Follow `.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

## Acceptance checks
```bash
npm run typecheck
npm test
npm run build
npx playwright test tests/e2e/items.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/resume.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --retries=0
git status --short
```

## Output (under 25 lines)
Per finding: what changed and the new test; acceptance results with pass counts.
