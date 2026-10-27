# Item system (A6) handoff

Branch: `feature/item-system` (branched from `docs/item-system-roadmap`, which is pushed but has no PR yet by user request).

## Status

| Step | State | Commit | Evidence |
|---|---|---|---|
| Plan | Done (Codex Sol, read-only) | this commit | `.claude/docs/plans/item-system-plan.md`; prompt `item-system-plan-prompt.md` |
| Open questions | Answered 2026-10-27 (DESIGN.md; plan addendum) | this commit | Round 3 simulation confirms targets with one-item-per-turn and choose-discard |
| S1-S12 | Not started | — | — |

## Decisions in force

- DESIGN.md Key Decisions 2026-10-27: mild weighting (Yamanote 1/2, direction 3:2), drop 0.30, harmful 30%, cap 3, 11 items.
- Players see only the item ruleset; classic `tokyo-suburban-1` stays internal (engine, config, tests, simulation).

## Next

1. Start S1 (isolate and freeze classic). S7 parity targets the round-3 "both rules" rows.
