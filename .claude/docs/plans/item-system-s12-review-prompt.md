# Final review: station item system (branch feature/item-system vs origin/develop)

## Objective
Decide whether the complete item-system feature (`git diff origin/develop...HEAD`, ~15 commits S1-S11) is ready to be proposed for merge into develop, and list any defect that must be fixed first.

## Spec
`.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27 (product rules), `.claude/docs/plans/item-system-plan.md` (incl. Addendum and S12), `.claude/docs/plans/item-system-handoff.md` (per-step evidence), `.claude/docs/research/item-system-simulation.md` Round 4.

## Checklist (report only concrete findings with file:line and a failing scenario)
1. Unrelated edits or scope creep (map, README, data docs, roadmap): justified or not.
2. Weakened, skipped or deleted tests; e2e expectations loosened without reason (the S11 commit rewrote many product e2e assertions — check they still assert real behaviour).
3. Fake movement records (e.g. roll 0, fabricated segments), swallowed errors, duplicate turn implementations (session/UI must go through the engine kernel only).
4. Any production entry point that still offers or silently uses the classic ruleset; e2e-only switches leaking into production.
5. Product-rule mismatches vs DESIGN.md (one item per turn incl. adjust, choose discard of 4, drops only at final non-clearing stop, deadhead never clears, route ticket single-eligible rule, suspension on Yamanote with fallback, delay/oversleep timing, certificate cancels before suspension target draw).
6. Save/restore integrity for item games (pending roll/discard) and v1-v3 rejection with bytes preserved.
7. Japanese UI copy problems (unnatural, wrong item names, inconsistent terms).

## Constraints
Read-only. Do not modify files. Skip style nits.

## Output
## Findings (most severe first) · ## Verdict (ready for PR / fix first) · ## Residual risks (unverified device/browser/a11y items)
