# Item system S2 — 3:2 direction policy and the internal item config

## Objective
Let the direction lottery express a 3:2 weighting and define the (not yet shipped) item ruleset configuration with a validated item-policy block, while classic behaviour and RNG stay bit-for-bit unchanged.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` sections "3. Lottery weights", "4. State, records and save v4" (first paragraph: item-policy block in `GameConfig`, absent for classic), "5. Configuration and edition wiring", "S2", and the 2026-10-27 addendum. Handoff: `.claude/docs/plans/item-system-handoff.md`. S1 is done: `CLASSIC_GAME_CONFIG` + `MVP_GAME_CONFIG` alias in `src/features/game/gameConfig.ts`, pinned by `tests/unit/item-classic-regression.test.ts`.
- Decided values (DESIGN.md Key Decisions 2026-10-27): mild weighting = Yamanote share 1/2 at transfer stations, direction toward Yamanote 3 : away 2; drop 30% per final stop; 30% of drops harmful; inventory capacity 3; at most one active item per turn; full inventory → player chooses which of the four to discard; delay fires 3 turns after pickup; suspension lasts 5 turns.
- Item pools in draw order must match the spike (`tests/simulation/item-spike/sim.ts` `BENEFICIAL_V2` / `HARMFUL_V2`): beneficial `route, direction, adjust, double, rapid, deadhead, certificate`; harmful `delay, suspension, detour, oversleep`. Use descriptive product ids (e.g. `route-ticket`, `direction-ticket`, `roll-adjust`, `double`, `rapid`, `deadhead`, `delay-certificate`; `delay`, `suspension`, `detour`, `oversleep`) but keep that order; document the mapping to spike names in a comment.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In:
1. Direction policy (`src/types/network.ts`, `src/features/game/engine/config.ts`, `src/features/game/engine/landing.ts`): add optional `awayFromTargetWeight` (absent ⇒ 1) exactly as the plan's section 3 describes — strict validation (explicit `undefined`/invalid rejected, positive-integer bounds like `towardTargetWeight`), absent property preserved through copy/parse (classic object stays `{ towardTargetWeight: 2 }` with no new key), weights `[toward, away]` in canonical direction order, ties `[1,1]`, forced single direction consumes no RNG, no GCD normalisation.
2. Item policy block: add an optional `items` (name it as you see fit, e.g. `itemPolicy`) to `GameConfig` holding the fixed settings above (drop per-mille 300, harmful percent 30, capacity 3, max active items per turn 1, delay turns 3, suspension turns 5, full-inventory policy "player-chooses-discard", ordered beneficial/harmful kind lists). Validate it in config parsing (reject unknown kinds, duplicates, empty pools, out-of-range numbers, unknown keys). Classic has no block. Export the `ItemKind` types for later steps. No behaviour uses the block yet.
3. Config equality in `src/features/game/engine/save.ts`: compare the optional away weight and the item block (absent vs present must differ). Do not change `SAVE_VERSION` or the save format in this step.
4. `src/features/game/gameConfig.ts`: add `ITEM_GAME_CONFIG` (`rulesetVersion: "tokyo-suburban-items-1"`, same target/start/goal policy as classic, `serviceLottery.target` share 1/2, `directionLottery: { towardTargetWeight: 3, awayFromTargetWeight: 2 }`, the item block). Do NOT change `MVP_GAME_CONFIG`, editions, or any product consumer.
5. Tests (extend the existing files named in the acceptance commands; add a focused new file only if clearer): 3:2 in both canonical direction orders, ties, unreachable/tied distances, forced direction, invalid away weight values, absent-property preservation, item-block validation cases, `ITEM_GAME_CONFIG` parses/round-trips, config equality differences, and that classic weights/RNG results are unchanged (the S1 regression test must stay untouched and green).
Out / must not touch: turn engine behaviour beyond the direction-weight computation, inventory/drop logic, save format/version, UI, editions registry, data, existing snapshots, `tests/unit/item-classic-regression.test.ts`.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Match surrounding code style, naming and comment density.

## Acceptance checks (all must pass)
```bash
npm run typecheck
npx vitest run tests/unit/engine-policy-config.test.ts tests/unit/engine-lottery-policy.test.ts tests/unit/engine-weighted-rng.test.ts tests/unit/engine-save-v3.test.ts tests/unit/item-classic-regression.test.ts
npm test
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
git status --short   # only files implied by Scope
```

## Output
Return (under 30 lines): files changed, the type/field names you chose (direction policy, item block, ItemKind ids), validation rules added, acceptance results with pass counts, anything not done and why.
