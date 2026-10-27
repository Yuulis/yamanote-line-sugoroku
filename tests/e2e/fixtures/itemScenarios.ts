import type { ItemGameState } from "../../../src/types/network";
import { createItemGame, playItemTurn, resolveItemDiscard, type RailwayNetwork } from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";

// First ascending 128-bit hex seeds with the scenario, replayed with no active
// items and choosing the new pickup on overflow. Turns name the completed base.
export const ITEM_SCENARIOS = {
  double: { seed: "00000000000000000000000000000004", turn: 5 },
  "rapid-long": { seed: "00000000000000000000000000000001", turn: 7 },
  rapid: { seed: "0000000000000000000000000000000c", turn: 8 },
  delay: { seed: "00000000000000000000000000000002", turn: 4 },
  adjust: { seed: "00000000000000000000000000000002", turn: 8 },
  oversleep: { seed: "00000000000000000000000000000010", turn: 3 },
  discard: { seed: "00000000000000000000000000000004", turn: 6 },
  certificate: { seed: "00000000000000000000000000000004", turn: 7 },
  deadhead: { seed: "00000000000000000000000000000009", turn: 4 },
  route: { seed: "0000000000000000000000000000000c", turn: 2 },
  direction: { seed: "00000000000000000000000000000022", turn: 6 },
} as const;
export type ItemScenario = keyof typeof ITEM_SCENARIOS;

/** Build a legitimate v4 save by replaying the pinned fixture seed. */
export function itemScenario(name: ItemScenario, network: RailwayNetwork): ItemGameState {
  const { seed, turn } = ITEM_SCENARIOS[name];
  let game = createItemGame(ITEM_GAME_CONFIG, seed, network);
  while (game.turn < turn) {
    game = playItemTurn(game, {}, network).state;
    if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
  }
  return game;
}
