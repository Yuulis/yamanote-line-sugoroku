import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { gameSeed, presetConfig, runGame, summarizeTurns } from '../../../../tests/simulation/harness';
import { loadResearchCatalog, sha256 } from '../../../../tests/simulation/inputs';

// Shard only independent games; all transitions use the production createGame/playTurn.
it('R2 independent real-engine seed shard', () => {
  const task = JSON.parse(readFileSync(process.env.R2_TASK!, 'utf8'));
  const input = loadResearchCatalog(task.catalog, task.services, 'jr-yamanote', 'shimbashi');
  const config = presetConfig(task.preset, input.targetServiceId, input.startStationId);
  if (task.targetShare) config.serviceLottery.target = { kind: 'share', numerator: task.targetShare[0], denominator: task.targetShare[1] };
  if (task.directionWeight) config.directionLottery.towardTargetWeight = task.directionWeight;
  if (task.passThrough) config.goalArrivalPolicy = 'pass-through';
  const turns: number[] = [], censored: number[] = [], seeds: string[] = [];
  let totalPlayedTurns = 0;
  const started = performance.now();
  for (let i = task.offset; i < task.offset + task.games; i++) {
    const seed = gameSeed(20261012, i);
    seeds.push(seed);
    const game = runGame(input.network, config, seed, 20000);
    totalPlayedTurns += game.turn;
    if (game.status !== 'completed') censored.push(i);
    turns.push(game.status === 'completed' ? game.turn : 20001);
  }
  const report = { task, config, input: input.provenance, turns, censored,
    statistics: summarizeTurns(turns, censored, totalPlayedTurns),
    seedSetSha256: sha256(seeds.join('\n')+'\n'), runtimeSeconds: (performance.now()-started)/1000 };
  writeFileSync(task.output, JSON.stringify(report, null, 2)+'\n');
  expect(turns.length).toBe(task.games);
  expect(censored.every((index) => turns[index - task.offset] === 20001)).toBe(true);
  // Censoring is reported; run_matrix.py rejects it as a completed measurement after aggregation.
}, 3_600_000);
