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
- `item-spike.test.ts`: grid definition, metrics, table, shard merge.

```bash
# Smoke (100 games per variant, all variants; prints the markdown table)
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
`ITEM_SPIKE_MERGE`. Seeds are `s1m-20261012-<i>` (same set as S7); item draws
use a separate stream seeded with `<seed>|items`.
