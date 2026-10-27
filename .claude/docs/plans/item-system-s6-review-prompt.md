# Review: item system S6 save v4 (uncommitted diff on feature/item-system)

## Objective
Find correctness bugs in the uncommitted S5 change (`git diff HEAD` plus untracked `src/features/game/engine/saveItemReplay.ts`, `src/features/game/engine/saveSchema.ts`, `tests/unit/engine-save-v4.test.ts`, `tests/e2e/fixtures/regenerate-saves.ts`) before it is committed.

## Spec
`.claude/docs/plans/item-system-s6-prompt.md` (task, incl. product rules that override the plan), `.claude/docs/plans/item-system-plan.md` sections 1, 2, 4 and the Addendum, `.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27.

## Focus
- Untrusted-input handling: can a crafted v4 payload pass restore while differing from what the seed + recorded commands produce (forged die, landing, drop, suspension target, certificate cancellation, timers, inventory, discard choice, either RNG state, pending transcript)? Crash/DoS paths (huge arrays, deep nesting, prototype keys like `__proto__`).
- Structural vs seeded replay: does item restore always run both; can a pending transcript be accepted without reconstruction; are restored transcripts deep-frozen.
- v1-v3 rejection before replay with stored bytes preserved; error code mapping unchanged for classic.
- Classic save/restore behaviour changes beyond the intended version bump (note: unknown extra keys are now rejected instead of ignored - judge whether that is safe).
- Tests that assert the wrong behaviour or were weakened.

## Constraints
Read-only. Do not modify files. Report only concrete defects with file:line and a failing scenario; skip style nits.

## Output
## Findings (most severe first: file:line, defect, failing scenario, suggested fix) · ## Verdict (ship / fix first)
