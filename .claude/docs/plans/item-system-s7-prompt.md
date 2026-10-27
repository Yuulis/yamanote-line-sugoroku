# Item system S7 — real-engine simulation and parity evidence

## Objective
Measure the item ruleset through the production engine (S5 phased API) and prove (a) classic is still exact and (b) the item ruleset reproduces the round-3 reference distributions, so the product default can be switched safely in S11.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — "S7" and "Simulation parity plan" (three acceptance layers, tolerances, report contents, failure handling). **Override:** the reference is the round-3 "both rules" rows, not round 2 (see the plan's Addendum and `.claude/docs/research/item-system-simulation.md` "Round 3"): mild weighting, drop 0.30, harmful 30%, one active item per turn incl. adjust, player-chosen discard.
  | Policy | median | p90 | p99 | max | over 500 |
  |---|---:|---:|---:|---:|---:|
  | Greedy (round-3 priority) | 65 | 143 | 241 | 433 | 0% |
  | Random (policy RNG `<seed>|policy`) | 113 | 232 | 370 | 565 | 0.12% |
- Production engine: `createItemGame`, `beginItemTurn`, `finishItemTurn`, `resolveItemDiscard`, `playItemTurn` and the hint/option queries (`routeTicketOptions`, `directionHint`, `rapidHeadsTowardTarget`, `deadheadDestination`, `nearestTargetStation`) exported from `src/features/game/engine/index.ts`; `ITEM_GAME_CONFIG` / `CLASSIC_GAME_CONFIG` in `src/features/game/gameConfig.ts`; save v4 `serializeGame` / `restoreGame`.
- Reference policy: the round-3 greedy single-item priority and discard keep-priority, and the round-3 random policy, as implemented in `tests/simulation/item-spike/sim.ts` and described in the report's Round 3 section. Port the *policy decisions* only; do not import spike landing/movement/drop logic. Keep the spike frozen (no edits under `tests/simulation/item-spike/`).
- Known intentional differences from the spike that may cause per-seed divergence: production movement metadata (rapid/oversleep), the 6-hop oversleep on `toei-oedo-loop`, the route-ticket direction drawn on the main stream before the die, any other S3–S5 interpretation recorded in `.claude/docs/plans/item-system-handoff.md`. Per the plan, investigate the first divergent decision/event for greedy before relying on distribution tolerance, and explain each divergence class in the report.
- Branch `feature/item-system`. Do not commit, push or switch branches. Long runs: shard by seed range if needed (the spike's sharding pattern is a fine model) and keep raw outputs under `.claude/logs/item-engine/` (git-ignored).

## Scope
In: new `tests/simulation/item-engine/` (runner, policy adapters, report logic; opt-in via `ITEM_ENGINE_SIM=1`, games via `ITEM_ENGINE_GAMES`, default small), new unit tests `tests/unit/item-simulation-policy.test.ts` and `tests/unit/item-simulation-report.test.ts`, `tests/simulation/README.md`, and a new dated section "Round 4 (production engine, 2026-10-27)" appended to `.claude/docs/research/item-system-simulation.md`.
1. Runner drives the real phased API for every turn, uses a separate policy RNG for random choices, records the report contents the plan lists (config, seed list hash, bundle hashes, engine/policy hashes, raw turns, quantile convention, item-use/drop/discard counters, certificate cancellations, errors), and round-trips a sample of complete histories (incl. some pending-roll/pending-discard states) through `serializeGame` → `restoreGame`.
2. Classic exactness: run the existing classic product simulation (`tests/simulation/suburban-product.test.ts`, `SIM_BUNDLE=public/data`) for seeds `s1m-20261012-0..4999` and compare per-seed turn counts and statistics with the frozen S7 evidence (find it in the repo / `.claude/docs/research/` / `.claude/logs/`; if the per-seed evidence is not available, compare the published statistics: median 55, p90 146, p99 261, mean 69.3858, max 446, zero cap hits, zero >500 — and say so).
3. Item parity: 5,000 games per policy on seeds `s1m-20261012-0..4999`, compared against the round-3 reference with the plan's predeclared tolerances (median ≤ max(5, 10%), p90 ≤ max(10, 10%), p99 ≤ max(20, 10%), p99 < 400, over-500 ≤ 0.5%, zero cap hits, 100% completion). Also report the oversleep-on-Oedo-loop frequency and its effect if measurable.
4. Determinism: rerun one fixed subset and show identical output (excluding runtime).
Do NOT retune weights, seeds or tolerances to pass. If parity fails, stop after diagnosing the first divergence and report it.
Out / must not touch: `src/` (if you find a genuine engine bug, do not fix it — report it with a reproduction), `tests/simulation/item-spike/`, gameplay snapshots, `tests/unit/item-classic-regression.test.ts`.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

## Acceptance checks
```bash
npm run typecheck
npx vitest run tests/unit/item-simulation-policy.test.ts tests/unit/item-simulation-report.test.ts
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=5000 npm run sim -- tests/simulation/item-engine   # or the sharded equivalent; state which
SIM_BUNDLE=public/data S5_OFFSET=0 S5_GAMES=5000 S5_OUTPUT=.claude/logs/item-engine/classic/sim-0.json npm run sim -- tests/simulation/suburban-product.test.ts   # adapt env names to what the test actually reads
npm test
npm run sim   # without ITEM_ENGINE_SIM the new runner must skip
git status --short
```

## Output (English, under 45 lines)
Parity verdict (pass/fail per layer); a table: reference vs production for greedy and random (median/p90/p99/max/over-500/cap hits); classic exactness evidence and what it was compared against; greedy per-seed divergence findings (first divergence class, count, cause); any engine bug found (with reproduction); files changed; exact commands run and runtimes.
