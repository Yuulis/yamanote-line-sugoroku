// Playwright-free product trajectory driver. Never stages a ticket or adjusts a
// die; when inventory is full, discards the newly drawn ticket explicitly.
import type { ItemGameState, ItemRideRecord } from "../../../src/types/network";
import { createItemGame, playItemTurn, resolveItemDiscard, type MoveEvent, type RailwayNetwork } from "../../../src/features/game/engine";

export { createItemGame as createGame };
export interface ProductTurnResult {
  state: ItemGameState;
  record: ItemRideRecord;
  events: MoveEvent[];
  roll: number;
  stopReason: ItemRideRecord["stopReason"];
  unusedPips: number;
}

export function playTurn(game: ItemGameState, network: RailwayNetwork): ProductTurnResult {
  let result = playItemTurn(game, {}, network);
  const events = [...result.events];
  if (result.state.pending?.kind === "discard") {
    result = resolveItemDiscard(result.state, result.state.pending.item.id);
    events.push(...result.events);
  }
  if (result.record?.kind !== "item-ride") throw new Error("Expected a committed product ride");
  const record = result.record;
  return { state: result.state, record, roll: record.rawRoll, stopReason: record.stopReason,
    unusedPips: record.unusedPips,
    events: events.filter((event): event is MoveEvent =>
      ["segment-traversed", "goal-reached", "endpoint-reached", "landing-resolved"].includes(event.type)),
  };
}
