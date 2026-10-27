# Item system S1 — isolate and freeze the classic ruleset

## Objective
Make the current ruleset an explicitly named, frozen "classic" configuration and pin its behaviour with regression tests, without changing any product behaviour, so later item-system steps can change the shipped default safely.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` sections "5. Configuration and edition wiring" and "S1 — Isolate and freeze classic". Handoff: `.claude/docs/plans/item-system-handoff.md`.
- Decision: players will only play the item ruleset; classic `tokyo-suburban-1` stays internal (engine, config, tests, simulation). This step does NOT add the item ruleset yet.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In:
1. `src/features/game/gameConfig.ts`: export `CLASSIC_GAME_CONFIG` holding exactly the current config contents (same object values, same `rulesetVersion` `tokyo-suburban-1`). Keep `MVP_GAME_CONFIG` as an alias of it (`export const MVP_GAME_CONFIG = CLASSIC_GAME_CONFIG;` or equivalent) with a one-line comment that it becomes the shipped item config at S11. Product code keeps using `MVP_GAME_CONFIG` unchanged.
2. Tests whose purpose is classic trajectory/length preservation import `CLASSIC_GAME_CONFIG` explicitly instead of `MVP_GAME_CONFIG`: `tests/simulation/suburban-product.test.ts`, `tests/simulation/suburban-observations.ts`, `tests/simulation/measurement.test.ts`, `tests/simulation/item-spike/item-spike.test.ts` (and `sim.ts` if it imports it). Leave product-shape tests (edition registry, product data, e2e, save fixtures) on `MVP_GAME_CONFIG` — they should follow the shipped default later.
3. New `tests/unit/item-classic-regression.test.ts` that pins classic:
   - `CLASSIC_GAME_CONFIG` deep-equals a literal snapshot of today's values (rulesetVersion, lottery policy incl. `{ towardTargetWeight: 2 }` direction policy and the Yamanote 2/3 share, goal policy, etc.) — write the literal out, do not derive it from the object under test.
   - `MVP_GAME_CONFIG === CLASSIC_GAME_CONFIG` for now (document that S11 flips this; the assertion will be replaced then).
   - The first N die draws and a short mixed-turn trajectory (several `playTurn` calls on the shipped bundle or the existing small fixture network, covering at least one landing lottery) for a fixed seed match literal expected values. Reuse existing fixtures/helpers from `tests/unit/` where they exist (e.g. the ones behind `engine-rng`, `engine-landing`, mixed-turn snapshot tests) rather than inventing new loaders.
Out / must not touch: engine behaviour, any value of the config, saves/save format, UI, data under `public/data/`, e2e specs, existing snapshot files (they must stay byte-identical). Do not add item APIs.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Match surrounding code style and comment density.

## Acceptance checks (all must pass)
```bash
npm run typecheck
npx vitest run tests/unit/item-classic-regression.test.ts
npm test
npx vitest run --config vitest.simulation.config.ts tests/simulation/suburban-product.test.ts
git status --short   # only the files listed in Scope changed/added
```
If `suburban-product.test.ts` is too slow by default, run it as it normally runs and report what it executed.

## Output
Return (under 30 lines): files changed, the literal values pinned, acceptance command results (pass counts), anything you could not do and why.
