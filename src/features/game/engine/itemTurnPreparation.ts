// Reconstruct a committed pre-roll action from the last completed position.
import type {
  ItemEffectsState, ItemEvent, ItemGameState, ItemInstance, ItemTurnCommand, LandingChoice, PendingItemRoll,
} from "../../../types/network";
import { GameEngineError } from "./errors";
import {
  clearOversleep, consumeDelayDue, consumeInventoryInstance, isDelayDue, pruneExpiredSuspensions,
} from "./itemEffects";
import { routeTicketOptions } from "./itemOptions";
import { assertSettledPosition } from "./movement";
import { movableDirections, type RailwayNetwork } from "./network";
import { drawWeightedIndex, rollDie } from "./rng";

export function invalidItemTurn(message: string): never {
  throw new GameEngineError("INVALID_STATE", message);
}

export function assertItemPlaying(state: ItemGameState): void {
  if (!state.config.itemPolicy || !state.effects || !state.inventory || !state.itemRngState) {
    invalidItemTurn("Item mode state is required");
  }
  if (state.status !== "playing") throw new GameEngineError("GAME_NOT_PLAYING", `Game is ${state.status}`);
}

export function ownedItem(state: ItemGameState, instanceId: string, kind: ItemInstance["kind"]): void {
  if (!state.inventory.some((item) => item.id === instanceId && item.kind === kind)) {
    invalidItemTurn(`Item ${instanceId} is not an owned ${kind}`);
  }
}

export interface PreparedItemTurn {
  turn: number;
  command: ItemTurnCommand;
  ride: LandingChoice;
  rngState: string;
  inventory: ItemInstance[];
  effects: ItemEffectsState;
  events: ItemEvent[];
  delayed: boolean;
  oversleep: boolean;
}

export function prepareItemTurn(state: ItemGameState, command: ItemTurnCommand, network: RailwayNetwork): PreparedItemTurn {
  assertItemPlaying(state);
  assertSettledPosition(state, network);
  if (!command || !Array.isArray(command.items) || command.items.length > 1) {
    invalidItemTurn("At most one active item may be used per turn");
  }
  const turn = state.turn + 1;
  const delayed = isDelayDue(state.effects, turn);
  const oversleep = state.effects.oversleepPending;
  if ((delayed || oversleep) && command.items.length > 0) invalidItemTurn("Forced turns prohibit active items");
  const events: ItemEvent[] = state.effects.suspensions
    .filter((entry) => entry.expiresTurn < turn)
    .map((entry) => ({ type: "effect-expired", effect: "suspension", serviceId: entry.serviceId }));
  let effects = consumeDelayDue(pruneExpiredSuspensions(state.effects, turn), turn).state;
  if (delayed && !oversleep) events.push({ type: "effect-activated", effect: "delay" });
  if (oversleep) {
    effects = clearOversleep(effects);
    events.push({ type: "effect-activated", effect: "oversleep" });
  }
  let inventory = state.inventory.map((item) => ({ ...item }));
  let ride: LandingChoice = { serviceId: state.currentServiceId, direction: state.direction };
  let rngState = state.rngState;
  const action = command.items[0];
  if (command.items.length === 1 && (!action || typeof action.instanceId !== "string")) {
    invalidItemTurn("An active item command requires an inventory instance");
  }
  if (action) {
    ownedItem(state, action.instanceId, action.kind);
    switch (action.kind) {
      case "route-ticket": {
        const { options } = routeTicketOptions(state, { turn, suspensions: effects.suspensions }, network);
        if (options.services.length < 2 || !options.services.includes(action.serviceId)) {
          invalidItemTurn("Route ticket requires a choice of eligible services");
        }
        const directions = options.directionsByService.get(action.serviceId)!;
        let direction = directions[0]!;
        if (directions.length > 1) {
          const drawn = drawWeightedIndex(rngState, options.directionWeightsByService.get(action.serviceId)!);
          direction = directions[drawn.index]!;
          rngState = drawn.nextRngState;
        }
        ride = { serviceId: action.serviceId, direction };
        break;
      }
      case "direction-ticket":
        if (state.currentServiceId === state.config.targetServiceId ||
            movableDirections(network, state.currentServiceId, state.currentStationId).length !== 2 ||
            (action.direction !== 1 && action.direction !== -1)) {
          invalidItemTurn("Direction ticket requires two movable non-target directions");
        }
        ride = { ...ride, direction: action.direction };
        break;
      case "rapid": {
        const service = network.servicesById.get(state.currentServiceId)!;
        if (service.circular && service.stationIds.every((id) => (network.servicesByStation.get(id)?.length ?? 0) < 2)) {
          invalidItemTurn("Rapid requires a reachable transfer stop or endpoint");
        }
        break;
      }
      case "double":
      case "deadhead":
        break;
      default:
        invalidItemTurn("Unknown pre-roll item");
    }
    const consumed = consumeInventoryInstance(inventory, action.instanceId);
    inventory = consumed.inventory;
    events.push(...consumed.events);
  }
  return { turn, command: { items: command.items.map((item) => ({ ...item })) }, ride, rngState, inventory, effects, events, delayed, oversleep };
}

export function revealItemRoll(prepared: PreparedItemTurn): PendingItemRoll {
  const drawn = rollDie(prepared.rngState);
  return deepFreeze({
    kind: "roll", turn: prepared.turn, command: prepared.command,
    resolvedRide: { ...prepared.ride }, rawRoll: drawn.value, rngStateAfterRoll: drawn.nextRngState,
  }) as PendingItemRoll;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  Object.freeze(value);
  return value;
}
