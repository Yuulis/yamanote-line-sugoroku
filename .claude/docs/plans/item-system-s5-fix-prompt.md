# Item system S5 — fix two review findings in the uncommitted turn kernel

## Objective
Fix the two defects an independent review found in the uncommitted S5 change, with regression tests, without changing any other behaviour.

## Context
- Task spec: `.claude/docs/plans/item-system-s5-prompt.md`. Files: `src/features/game/engine/itemTurn.ts`, `src/features/game/engine/itemTurnPreparation.ts`, types in `src/types/network.ts`, tests in `tests/unit/engine-item-turn.test.ts` (all uncommitted on branch `feature/item-system`). Do not commit, push or switch branches.

## Findings to fix
1. [P1] `itemTurn.ts` `finishItemTurn` (~line 35): after `beginItemTurn` reveals the roll, a caller can mutate the returned `pending.command` (e.g. `{ items: [] }` → a `double` command) and `finishItemTurn` accepts it, because it rebuilds from `pending.command` and only compares roll, RNG state and ride. Reproduction: hold a double ticket, begin with no items, change `pending.command` to use the double, finish → revealed 5 becomes `pips: 10`. Fix: make committed pending transcripts immutable snapshots (deep-freeze the pending transcript and its nested objects at creation, and type them `readonly`), so mutation throws in strict mode / has no effect; keep the existing equality checks. Add a regression test that attempts this mutation and proves the finished turn still uses the originally committed command (or that the mutation is rejected).
2. [P2] `itemTurn.ts` `resolveItemDiscard` (~line 144): the returned state/record shallow-spread `pending.position` / `pending.record`, so `result.state.effects`, `result.state.completedSegmentIds`, `result.record.command` etc. are the same objects as in the input pending transcript; mutating the result mutates the input. Fix: return independent copies (or rely on the deep-frozen transcript from fix 1 and copy only what is returned as mutable state — the returned `GameState` must not alias the input transcript). Add a test asserting no aliasing (`!==` on effects, completedSegmentIds, inventory, record.command) and that mutating the result leaves the input transcript unchanged.

## Constraints
Only touch the files listed above. Keep classic code paths and `tests/unit/item-classic-regression.test.ts` untouched. Follow `.claude/rules/coding-principles.md` and `.claude/rules/testing.md`.

## Acceptance checks
```bash
npm run typecheck
npx vitest run tests/unit/engine-item-turn.test.ts tests/unit/item-classic-regression.test.ts
npm test
git status --short
```

## Output (under 20 lines)
What changed for each finding, new tests, acceptance results with pass counts.
