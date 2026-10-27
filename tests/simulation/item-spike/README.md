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
- `item-spike.test.ts`: grid definition, metrics, tables, shard merge. Round 3
  (chosen ruleset under the one-item-per-turn and choose-discard rules; ids end
  in `-r3`, `-r3-single`, `-r3-discard`, `-r3-none`) is the default grid;
  `ITEM_SPIKE_ROUND=2` selects round 2 (mild vs mid, item sets `v1` / `v2` /
  `v2-no-<item>`) and `ITEM_SPIKE_ROUND=1` round 1. Variant ids without an
  item-set suffix use the round-1 item set (`v1`), so their shards stay comparable.

```bash
# Smoke (100 games per round-3 variant; prints the turn and per-item tables)
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
`ITEM_SPIKE_MERGE`, `ITEM_SPIKE_ROUND` (`1` or `2` = earlier grid; default round 3). Seeds are `s1m-20261012-<i>` (same set as S7); item draws
use a separate stream seeded with `<seed>|items`; round-3 random-user choices
and discards use a third stream `<seed>|policy`.
