# Item system S3 — pure item movement and candidate queries

## Objective
Add the pure engine building blocks the item turn (S5) will compose: special movement modes (rapid, oversleep, deadhead), suspension/detour candidate filtering on top of the existing lottery weighting, and side-effect-free option/hint queries — with classic behaviour and RNG unchanged.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — "Reference effects to preserve", sections 1–4 (records: pips vs physical hops, deadhead relocation output), "S3", and the "Addendum (2026-10-27)". Handoff: `.claude/docs/plans/item-system-handoff.md`.
- Product rules: `.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27 (three rows). Notably: suspension can hit Yamanote; if every candidate would be suspended, ignore suspension at that station; at most ONE active item per turn (enforced in S5, not here); rapid counts only stations with ≥2 underlying services, regardless of suspension; deadhead goes to the nearest Yamanote station by directed-hop distance, ties by Yamanote station order, boards Yamanote outer, completes no segments and never clears the game by relocation; oversleep carries to the current service's endpoint in the current direction, or 6 hops on a circular service (Yamanote and any other loop — test whether the shipped graph has another loop and document it).
- Behavioural reference: `tests/simulation/item-spike/moves.ts` and `sim.ts` (round 3). Where the spike converted pips to hops before `advance` and lost endpoint/unused-pip metadata, keep its arrival/progress behaviour but report correct metadata (plan section 4).
- Already in place (S1–S2): `CLASSIC_GAME_CONFIG`, `ITEM_GAME_CONFIG` with `itemPolicy`, `ItemKind` ids (`route-ticket`, `direction-ticket`, `roll-adjust`, `double`, `rapid`, `deadhead`, `delay-certificate`; `delay`, `suspension`, `detour`, `oversleep`), optional `awayFromTargetWeight`.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In (files per plan S3: `engine/landing.ts`, `engine/movement.ts`, `engine/proximity.ts`, new `engine/itemMovement.ts`, new `engine/itemOptions.ts`, `engine/index.ts` exports, new unit tests `tests/unit/engine-item-movement.test.ts`, `tests/unit/engine-item-options.test.ts`):
1. Candidate filtering: given landing candidates plus active suspensions (service id + expiry turn) and a pending detour (the service just ridden), produce filtered candidates with stable canonical ordering, then apply the existing service/direction weighting unchanged to what remains (Yamanote's 1/2 share computed among remaining candidates). Return explicit consumption results (e.g. whether detour was consumed, whether suspension was ignored by the all-suspended fallback). Detour stays pending at stations with no other candidate.
2. Movement modes: normal (existing), rapid (pips spent only at stations with ≥2 services; segments traversed and goal/endpoint truncation behave as normal movement), oversleep (to endpoint / 6 hops on loops), deadhead (relocation result, no segments). Each returns a mode-aware result: pips, physical hops, traversed segments, stop reason, unused pips, and for deadhead an explicit relocation outcome (no fake roll, no fabricated segment). Normal movement for classic must produce byte-identical results to today.
3. Nearest-target search (BFS over directed segments) with deterministic tie order and a typed error when no path to the target service exists.
4. Pure option/hint queries for the UI and policy: which route-ticket candidates exist here (after suspension filtering) and which of them is the target service; which direction is closer to the target; whether a rapid move heads toward the target; deadhead destination preview. These must not draw RNG or reveal future lottery/die outcomes.
5. Tests: the plan's S3 list (all-suspended fallback, single active service, detour persistence, suspension-forced detour consumption, endpoint truncation, target goal truncation, long rapid paths, BFS tie order, no-target-path error) plus classic equivalence for normal movement and lottery weights. Prefer the existing small fixture networks under `tests/unit/fixtures/` and add a tiny fixture only if needed.
Out / must not touch: turn orchestration (`playTurn`/`moveByRoll` behaviour), inventory, drops, RNG streams, save format, UI, gameConfig values, editions, `tests/unit/item-classic-regression.test.ts`, existing snapshots.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Pure engine: no React/DOM/clock/global randomness. Match surrounding naming and comment density; keep new files within ~400 lines each.

## Acceptance checks (all must pass)
```bash
npm run typecheck
npx vitest run tests/unit/engine-item-movement.test.ts tests/unit/engine-item-options.test.ts tests/unit/engine-landing.test.ts tests/unit/engine-game.test.ts tests/unit/item-classic-regression.test.ts
npm test
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
git status --short   # only files implied by Scope
```

## Output (English, under 40 lines)
Files changed; the public API added (function names + one-line purpose); product-rule interpretations you had to make (each with the reason); whether the shipped graph has a non-Yamanote loop; acceptance results with pass counts; anything not done and why.
