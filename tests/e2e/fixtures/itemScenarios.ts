import type { ItemGameState } from "../../../src/types/network";
import { createItemGame, playItemTurn, resolveItemDiscard, type RailwayNetwork } from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";

// First ascending 128-bit hex seeds with the scenario, replayed with no active
// items and choosing the new pickup on overflow. Turns name the completed base.
// Scenario pins were re-searched with weighted items-2 drops. The adjustment
// pin keeps the original raw-2 / turn-8 presentation fixture; discard-adjust
// holds an adjustable ticket before a full-inventory decision. adjust-wide is
// the first ascending seed through 0x560b (decimal 22027) with all three ticket
// kinds, a raw 4+, and an untruncated +3 ride beyond face 6. double-adjust is
// the phone card-switching scenario: it holds a double and ±1 ticket and stays
// playing after a doubled turn on both the fixture and real datasets.
// route-rapid-pickup preserves the arrival-turn pickup predicate at turn 7.
export const ITEM_SCENARIOS = {
  double: { seed: "00000000000000000000000000000003", turn: 2 },
  "double-adjust": { seed: "0000000000000000000000000000006b", turn: 10 },
  "rapid-long": { seed: "00000000000000000000000000000002", turn: 1 },
  rapid: { seed: "00000000000000000000000000000002", turn: 2 },
  "route-rapid-pickup": { seed: "0000000000000000000000000000000c", turn: 6 },
  delay: { seed: "00000000000000000000000000000002", turn: 4 },
  adjust: { seed: "000000000000000000000000000000c8", turn: 8 },
  "adjust-lottery": { seed: "00000000000000000000000000000009", turn: 8 },
  "adjust-toast": { seed: "0000000000000000000000000000000f", turn: 8 },
  "adjust-harmful": { seed: "00000000000000000000000000000024", turn: 7 },
  "adjust-wide": { seed: "0000000000000000000000000000560b", turn: 5 },
  oversleep: { seed: "00000000000000000000000000000004", turn: 8 },
  "oversleep-pickup": { seed: "00000000000000000000000000000002", turn: 8 },
  discard: { seed: "00000000000000000000000000000004", turn: 6 },
  "discard-adjust": { seed: "00000000000000000000000000000009", turn: 13 },
  certificate: { seed: "00000000000000000000000000000005", turn: 19 },
  deadhead: { seed: "00000000000000000000000000000032", turn: 8 },
  route: { seed: "0000000000000000000000000000000c", turn: 2 },
  direction: { seed: "00000000000000000000000000000005", turn: 15 },
} as const;
export type ItemScenario = keyof typeof ITEM_SCENARIOS;

/** Build a legitimate v5 save by replaying the pinned fixture seed. */
export function itemScenario(name: ItemScenario, network: RailwayNetwork): ItemGameState {
  const { seed, turn } = ITEM_SCENARIOS[name];
  let game = createItemGame(ITEM_GAME_CONFIG, seed, network);
  while (game.turn < turn) {
    game = playItemTurn(game, {}, network).state;
    if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
  }
  return game;
}
