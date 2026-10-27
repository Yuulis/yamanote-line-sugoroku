# Station-item spike (throwaway, 2026-10-27)

Monte Carlo measurement of a random-drop station-item system on the shipped
Tokyo-suburban bundle (`public/data`, `MVP_GAME_CONFIG` geometry and goal rule).
Not product code; nothing under `src/` is changed. Report:
`.claude/docs/research/item-system-simulation.md`.

- `sim.ts`: item game loop. Reuses the engine's `advance` (movement + goal),
  `rollDie` / `drawIndex` / `drawWeightedIndex`, `transferOptions`,
  `movableDirections`, `targetHopDistances`. Only the landing lottery is
  re-implemented so items and alternative weightings can change candidates and
  weights. With items off and the current weighting it is draw-for-draw equal
  to `engine.playTurn` (checked on the first 100 seeds of every run).
- `moves.ts` (round 2): hop counts for 快速券 (rapid) and 寝過ごし (oversleep), and
  the nearest Yamanote station for 回送列車 (deadhead); moves still go through
  the engine's `advance`.
- `item-spike.test.ts`: grid definition, metrics, tables, shard merge. Round 2
  (mild vs mid, item sets `v1` / `v2` / `v2-no-<item>` ablations) is the default
  grid; `ITEM_SPIKE_ROUND=1` selects the round-1 grid. Variant ids without a
  suffix use the round-1 item set (`v1`), so their shards stay comparable.

```bash
# Smoke (100 games per round-2 variant; prints the turn and per-item tables)
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike

# One variant at full size, saved as a shard
ITEM_SPIKE=1 ITEM_SPIKE_GAMES=5000 ITEM_SPIKE_FILTER='^mild-d200-h30-greedy$' \
  ITEM_SPIKE_OUTPUT=.claude/logs/item-spike/shards/mild-d200-h30-greedy.json \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike

# Merge every shard in a directory into merged.json + table.md
ITEM_SPIKE_MERGE=.claude/logs/item-spike/shards \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
```

Env: `ITEM_SPIKE=1` (required; the grid is skipped otherwise, so `npm run sim`
does not run it), `ITEM_SPIKE_GAMES` (default 100), `ITEM_SPIKE_CAP` (default 20000),
`ITEM_SPIKE_FILTER` (regex on variant id), `ITEM_SPIKE_OUTPUT`,
`ITEM_SPIKE_MERGE`, `ITEM_SPIKE_ROUND` (`1` = round-1 grid; default round 2). Seeds are `s1m-20261012-<i>` (same set as S7); item draws
use a separate stream seeded with `<seed>|items`.
