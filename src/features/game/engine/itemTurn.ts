// Saveable item-mode turns. Only completed decisions advance top-level state.
import type {
  ItemGameState, ItemLandingSnapshot, ItemPosition, ItemRollAdjustment,
  ItemTurnCommand, ItemTurnRecord, LandingChoice,
} from "../../../types/network";
import { GameEngineError } from "./errors";
import { clearDetour, consumeInventoryInstance } from "./itemEffects";
import { advanceWithMode, type ItemMovementResult } from "./itemMovement";
import { itemLandingOptions } from "./itemOptions";
import { drawItemDrop, resolvePendingItemDiscard } from "./items";
import { assertItemPlaying, deepFreeze, invalidItemTurn, ownedItem, prepareItemTurn, revealItemRoll, type PreparedItemTurn } from "./itemTurnPreparation";
import { drawLanding, resolveLandingEvent } from "./landing";
import type { RailwayNetwork } from "./network";
import type { ItemTurnEvent, ItemTurnResult } from "./types";

const NO_ITEMS: ItemTurnCommand = { items: [] };

/** Freeze the pre-roll command and reveal a die, or resolve exclusive deadhead. */
export function beginItemTurn(state: ItemGameState, command: ItemTurnCommand, network: RailwayNetwork): ItemTurnResult {
  assertItemPlaying(state);
  if (state.pending !== null) invalidItemTurn("Resolve the pending decision before starting another turn");
  const prepared = prepareItemTurn(state, command, network);
  if (prepared.command.items[0]?.kind === "deadhead") {
    const moved = advanceWithMode(state, { mode: "deadhead" }, network);
    return resolveArrival(state, prepared, moved, null, null, prepared.rngState, network);
  }
  return { state: { ...state, pending: revealItemRoll(prepared) }, events: [], record: null };
}

/** Resolve the revealed roll with zero or one adjustment; pre-actions stay frozen. */
export function finishItemTurn(state: ItemGameState, adjustment: ItemRollAdjustment | null, network: RailwayNetwork): ItemTurnResult {
  assertItemPlaying(state);
  const pending = state.pending;
  if (pending?.kind !== "roll") invalidItemTurn("A revealed roll is required");
  const prepared = prepareItemTurn(state, pending.command, network);
  const expected = revealItemRoll(prepared);
  if (pending.turn !== expected.turn || pending.rawRoll !== expected.rawRoll ||
      pending.rngStateAfterRoll !== expected.rngStateAfterRoll ||
      pending.resolvedRide.serviceId !== expected.resolvedRide.serviceId ||
      pending.resolvedRide.direction !== expected.resolvedRide.direction) {
    invalidItemTurn("Pending roll does not match the committed turn");
  }
  let face = prepared.delayed ? 1 : pending.rawRoll;
  if (adjustment !== null) {
    if (!adjustment || typeof adjustment.instanceId !== "string") invalidItemTurn("An adjustment item instance is required");
    if (prepared.command.items.length > 0 || prepared.delayed || prepared.oversleep) {
      invalidItemTurn("Adjustment requires an unforced turn with no pre-roll item");
    }
    ownedItem(state, adjustment.instanceId, "roll-adjust");
    if (adjustment.delta !== -1 && adjustment.delta !== 1) invalidItemTurn("Adjustment must be -1 or +1");
    face += adjustment.delta;
    if (face < 1 || face > 6) throw new GameEngineError("INVALID_ROLL", "Adjusted face must stay within 1-6");
    const consumed = consumeInventoryInstance(prepared.inventory, adjustment.instanceId);
    prepared.inventory = consumed.inventory;
    prepared.events.push(...consumed.events);
  }
  // Oversleep consumes the raw die without applying the coincident delay override.
  if (prepared.oversleep) face = pending.rawRoll;
  const action = prepared.command.items[0];
  const moved = advanceWithMode({ ...state, currentServiceId: prepared.ride.serviceId, direction: prepared.ride.direction },
    prepared.oversleep ? { mode: "oversleep" } : {
      mode: action?.kind === "rapid" ? "rapid" : "normal",
      pips: face * (action?.kind === "double" ? 2 : 1),
    }, network);
  return resolveArrival(state, prepared, moved, face, adjustment, pending.rngStateAfterRoll, network);
}

function resolveArrival(
  state: ItemGameState, prepared: PreparedItemTurn, moved: ItemMovementResult,
  face: number | null, adjustment: ItemRollAdjustment | null, rngState: string, network: RailwayNetwork,
): ItemTurnResult {
  const events: ItemTurnEvent[] = [...prepared.events, ...moved.events];
  let landing: LandingChoice | null = null;
  let landingSnapshot: ItemLandingSnapshot | null = null;
  let effects = prepared.effects;
  if (!moved.cleared && moved.mode !== "deadhead") {
    const filtered = itemLandingOptions({ ...state, currentStationId: moved.stationId,
      currentServiceId: prepared.ride.serviceId, direction: prepared.ride.direction }, {
      turn: prepared.turn, suspensions: effects.suspensions,
      ...(effects.detourPending ? { detourServiceId: prepared.ride.serviceId } : {}),
    }, network);
    const { options } = filtered;
    landingSnapshot = {
      stationId: options.stationId, suspensionIgnored: filtered.suspensionIgnored, detourConsumed: filtered.detourConsumed,
      services: options.services.map((serviceId, index) => ({ serviceId, weight: options.serviceWeights[index]!,
        directions: [...options.directionsByService.get(serviceId)!], directionWeights: [...options.directionWeightsByService.get(serviceId)!] })),
    };
    if (filtered.detourConsumed) {
      effects = clearDetour(effects);
      const event = { type: "effect-activated" as const, effect: "detour" as const };
      prepared.events.push(event);
      events.push(event);
    }
    const drawn = drawLanding(options, rngState);
    rngState = drawn.nextRngState;
    const resolved = resolveLandingEvent(options, prepared.ride.serviceId, drawn.choice);
    landing = resolved.choice;
    events.push(resolved.event);
  }
  const drop = moved.cleared ? null : drawItemDrop(state.itemRngState, prepared.turn, state.config.itemPolicy,
    prepared.inventory, effects, network.servicesByStation.get(moved.stationId) ?? []);
  events.push(...(drop?.events ?? []));
  const common = {
    turn: prepared.turn, fromStationId: state.currentStationId, toStationId: moved.stationId,
    command: prepared.command, resolvedRide: { ...prepared.ride }, traversedSegmentIds: [...moved.traversedSegmentIds],
    landing, landingSnapshot, itemEvents: [...prepared.events, ...(drop?.events ?? [])], discardedInstanceId: null,
  };
  const record: ItemTurnRecord = moved.mode === "deadhead" ? {
    ...common, kind: "deadhead", resolvedRide: null, rawRoll: null, effectiveFace: null, adjustment: null,
    movementMode: "deadhead", pips: null, hopBudget: null, physicalHops: 0, unusedPips: null,
    stopReason: "relocation", relocation: moved.relocation,
  } : {
    ...common, kind: "item-ride", rawRoll: state.pending?.kind === "roll" ? state.pending.rawRoll : invalidItemTurn("Missing roll"),
    effectiveFace: face!, adjustment: adjustment ? { ...adjustment } : null, movementMode: moved.mode,
    pips: moved.pips, hopBudget: moved.hopBudget, physicalHops: moved.physicalHops,
    unusedPips: moved.unusedPips, stopReason: moved.stopReason,
  };
  // Keep transcripts JSON-safe and independent of the growing history.
  const { movementHistory: _history, pending: _pending, ...base } = state;
  const nextRide = moved.mode === "deadhead" ? moved.relocation : landing ?? prepared.ride;
  const position: ItemPosition = {
    ...base, status: moved.cleared ? "completed" : "playing", currentStationId: moved.stationId,
    currentServiceId: nextRide.serviceId, direction: nextRide.direction, turn: prepared.turn,
    completedSegmentIds: [...moved.completedSegmentIds], rngState,
    inventory: drop?.inventory ?? prepared.inventory, effects: drop?.effects ?? effects,
    itemRngState: drop?.nextItemRngState ?? state.itemRngState,
  };
  if (drop?.pendingDiscard) {
    const pending = deepFreeze({ kind: "discard" as const, turn: prepared.turn,
      ...drop.pendingDiscard, position, record });
    return { state: { ...state, pending }, events, record: null };
  }
  return { state: { ...position, pending: null, movementHistory: [...state.movementHistory, record] }, events, record };
}

/** Commit any one of the four discard candidates, including the new pickup. */
export function resolveItemDiscard(state: ItemGameState, instanceId: string): ItemTurnResult {
  assertItemPlaying(state);
  const pending = state.pending;
  if (pending?.kind !== "discard" || pending.turn !== state.turn + 1) invalidItemTurn("A pending discard is required");
  const resolved = resolvePendingItemDiscard(pending, pending.position.inventory, instanceId);
  const recordSnapshot = structuredClone(pending.record) as ItemTurnRecord;
  const record: ItemTurnRecord = { ...recordSnapshot, discardedInstanceId: instanceId,
    itemEvents: [...pending.record.itemEvents, ...resolved.events] };
  const position = structuredClone(pending.position) as ItemPosition;
  return {
    state: { ...position, inventory: resolved.inventory.map((item) => ({ ...item })), itemRngState: resolved.nextItemRngState,
      movementHistory: [...state.movementHistory, record], pending: null },
    events: resolved.events, record,
  };
}

export interface ItemTurnDecisions {
  command?: ItemTurnCommand;
  adjustment?: ItemRollAdjustment | null;
  discardedInstanceId?: string;
}

/** Compose the phased API. Missing discard choice leaves the saveable decision. */
export function playItemTurn(state: ItemGameState, decisions: ItemTurnDecisions, network: RailwayNetwork): ItemTurnResult {
  let result = beginItemTurn(state, decisions.command ?? NO_ITEMS, network);
  if (result.state.pending?.kind === "roll") {
    result = finishItemTurn(result.state, decisions.adjustment ?? null, network);
  } else if (decisions.adjustment != null) {
    invalidItemTurn("Deadhead cannot be combined with adjustment");
  }
  if (result.state.pending?.kind === "discard" && decisions.discardedInstanceId !== undefined) {
    const resolved = resolveItemDiscard(result.state, decisions.discardedInstanceId);
    return { ...resolved, events: [...result.events, ...resolved.events] };
  }
  if (decisions.discardedInstanceId !== undefined) invalidItemTurn("No discard choice is pending");
  return result;
}
