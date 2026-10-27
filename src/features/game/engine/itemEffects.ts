import type { ItemEffectsState, ItemEvent, ItemInstance, ServiceId } from "../../../types/network";
import { GameEngineError } from "./errors";

export function createItemEffectsState(): ItemEffectsState {
  return { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false };
}

function copyState(state: ItemEffectsState): ItemEffectsState {
  return {
    ...state,
    delayDueTurns: [...state.delayDueTurns],
    suspensions: state.suspensions.map((entry) => ({ ...entry })),
  };
}

export function isDelayDue(state: ItemEffectsState, turn: number): boolean {
  return state.delayDueTurns.includes(turn);
}

export function consumeDelayDue(
  state: ItemEffectsState,
  turn: number,
): { state: ItemEffectsState; consumed: boolean } {
  const consumed = isDelayDue(state, turn);
  return {
    state: consumed
      ? { ...copyState(state), delayDueTurns: state.delayDueTurns.filter((dueTurn) => dueTurn !== turn) }
      : copyState(state),
    consumed,
  };
}

export function pruneExpiredSuspensions(state: ItemEffectsState, turn: number): ItemEffectsState {
  return { ...copyState(state), suspensions: state.suspensions.filter((entry) => entry.expiresTurn >= turn).map((entry) => ({ ...entry })) };
}

export function clearDetour(state: ItemEffectsState): ItemEffectsState {
  return { ...copyState(state), detourPending: false };
}

export function clearOversleep(state: ItemEffectsState): ItemEffectsState {
  return { ...copyState(state), oversleepPending: false };
}

export function consumeInventoryInstance(
  inventory: readonly ItemInstance[],
  id: string,
): { inventory: ItemInstance[]; consumed: ItemInstance; events: ItemEvent[] } {
  const index = inventory.findIndex((item) => item.id === id);
  if (index < 0) throw new GameEngineError("INVALID_STATE", `Unknown inventory item ${id}`);
  const consumed = inventory[index]!;
  return {
    inventory: inventory.filter((item) => item.id !== id).map((item) => ({ ...item })),
    consumed: { ...consumed },
    events: [{ type: "consumed", item: { ...consumed } }],
  };
}

export function scheduleDelay(state: ItemEffectsState, dueTurn: number): ItemEffectsState {
  return {
    ...copyState(state),
    delayDueTurns: [...new Set([...state.delayDueTurns, dueTurn])].sort((left, right) => left - right),
  };
}

export function scheduleSuspension(
  state: ItemEffectsState,
  serviceId: ServiceId,
  expiresTurn: number,
): ItemEffectsState {
  const refreshed = state.suspensions.filter((entry) => entry.serviceId !== serviceId);
  refreshed.push({ serviceId, expiresTurn });
  refreshed.sort((left, right) => left.serviceId < right.serviceId ? -1 : left.serviceId > right.serviceId ? 1 : 0);
  return { ...copyState(state), suspensions: refreshed.map((entry) => ({ ...entry })) };
}

export function scheduleDetour(state: ItemEffectsState): ItemEffectsState {
  return { ...copyState(state), detourPending: true };
}

export function scheduleOversleep(state: ItemEffectsState): ItemEffectsState {
  return { ...copyState(state), oversleepPending: true };
}
