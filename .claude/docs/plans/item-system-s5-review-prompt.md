# Review: item system S5 turn kernel (uncommitted diff on feature/item-system)

## Objective
Find correctness bugs in the uncommitted S5 change (`git diff HEAD` plus untracked `src/features/game/engine/itemTurn.ts`, `src/features/game/engine/itemTurnPreparation.ts`, `tests/unit/engine-item-turn.test.ts`) before it is committed.

## Spec
`.claude/docs/plans/item-system-s5-prompt.md` (task, incl. product rules that override the plan), `.claude/docs/plans/item-system-plan.md` sections 1, 2, 4 and the Addendum, `.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27.

## Focus
- Product-rule violations: one active item per turn incl. adjust; delay/oversleep timing and collision; suspension/detour application turn; drop only at a non-clearing final stop (deadhead included); discard choice; deadhead never clears.
- RNG contract: main-stream draw order (route direction → die → landing service → landing direction), item stream untouched by anything except drops, no draws on forced choices, classic untouched.
- Pending-state integrity: stale/duplicate completion, mutation of inputs, state shared between pending transcript and returned state, turn numbering.
- Tests that assert the wrong behaviour or miss an obvious case.

## Constraints
Read-only. Do not modify files. Report only concrete defects with file:line and a failing scenario; skip style nits.

## Output
## Findings (most severe first: file:line, defect, failing scenario, suggested fix) · ## Verdict (ship / fix first)
