// Structural outcomes use the same S5 validators and movement/effect primitives;
// seeded replay independently drives the public S5 phased API with player commands.
import type {
  ItemGameState, ItemLandingSnapshot, ItemPosition, ItemTurnRecord, PendingItemRoll,
} from "../../../types/network";
import { GameEngineError } from "./errors";
import { createItemGame } from "./game";
import { clearDetour, consumeInventoryInstance, scheduleDelay, scheduleDetour, scheduleOversleep, scheduleSuspension } from "./itemEffects";
import { advanceWithMode } from "./itemMovement";
import { itemLandingOptions, routeTicketOptions } from "./itemOptions";
import { beginItemTurn, finishItemTurn, resolveItemDiscard } from "./itemTurn";
import { ownedItem, prepareItemTurn, type PreparedItemTurn } from "./itemTurnPreparation";
import { resolvePendingItemDiscard, type ItemDropResult } from "./items";
import { resolveLandingEvent } from "./landing";
import type { RailwayNetwork } from "./network";
import { invalidSave, sameJson } from "./saveSchema";

function match(actual: unknown, saved: unknown, message: string): void {
  if (!sameJson(actual, saved)) invalidSave(message);
}

/** Supply only the selected outcome; recompute its consequences and event payload. */
function recordedDrop(state: ItemGameState, prepared: PreparedItemTurn, record: ItemTurnRecord, network: RailwayNetwork): ItemDropResult {
  const policy = state.config.itemPolicy;
  const event = record.itemEvents[prepared.events.length];
  const inventory = prepared.inventory.map((item) => ({ ...item }));
  const effects = structuredClone(prepared.effects);
  const base: ItemDropResult = { inventory, effects, events: [], nextItemRngState: state.itemRngState };
  if (event === undefined || event.type === "discarded") {
    if (policy.dropChancePerMille === 1000) invalidSave("A guaranteed drop is missing");
    return base;
  }
  if (policy.dropChancePerMille === 0) invalidSave("A drop is impossible under this policy");
  if (event.type === "pickup-retained" || event.type === "pickup-pending-discard") {
    const kind = event.item.kind;
    if (policy.harmfulChancePercent === 100 || !policy.beneficialKinds.includes(kind as typeof policy.beneficialKinds[number])) invalidSave("Illegal beneficial drop");
    const item = { id: `item-${prepared.turn}`, kind };
    if (inventory.length < policy.inventoryCapacity) {
      return { ...base, inventory: [...inventory, item], events: [{ type: "pickup-retained", item }] };
    }
    const candidates = [...inventory, item];
    return { ...base, events: [{ type: "pickup-pending-discard", item, candidates }],
      pendingDiscard: { item, candidates, nextItemRngState: state.itemRngState } };
  }
  if (event.type !== "harmful-scheduled" && event.type !== "cancelled-by-certificate") invalidSave("Illegal drop event");
  const kind = event.item;
  if (policy.harmfulChancePercent === 0 || !policy.harmfulKinds.includes(kind)) invalidSave("Illegal harmful drop");
  const certificate = inventory.find((item) => item.kind === "delay-certificate");
  if (certificate) {
    return { ...base, inventory: consumeInventoryInstance(inventory, certificate.id).inventory,
      events: [{ type: "cancelled-by-certificate", item: kind, certificate }] };
  }
  if (event.type === "cancelled-by-certificate") invalidSave("Certificate cancellation requires an owned certificate");
  switch (kind) {
    case "delay": {
      const dueTurn = prepared.turn + policy.delayTurns;
      return { ...base, effects: scheduleDelay(effects, dueTurn), events: [{ type: "harmful-scheduled", item: kind, effect: kind, dueTurn }] };
    }
    case "detour": return { ...base, effects: scheduleDetour(effects), events: [{ type: "harmful-scheduled", item: kind, effect: kind }] };
    case "oversleep": return { ...base, effects: scheduleOversleep(effects), events: [{ type: "harmful-scheduled", item: kind, effect: kind }] };
    case "suspension": {
      if (event.effect !== "suspension" || !(network.servicesByStation.get(record.toStationId) ?? []).includes(event.serviceId)) invalidSave("Illegal suspension target");
      const expiresTurn = prepared.turn + policy.suspensionTurns;
      return { ...base, effects: scheduleSuspension(effects, event.serviceId, expiresTurn),
        events: [{ type: "harmful-scheduled", item: kind, effect: kind, serviceId: event.serviceId, expiresTurn }] };
    }
  }
}

function preparedRecord(state: ItemGameState, record: ItemTurnRecord | PendingItemRoll, network: RailwayNetwork): PreparedItemTurn {
  const prepared = prepareItemTurn(state, record.command, network);
  if (record.resolvedRide !== null && record.command.items[0]?.kind === "route-ticket") {
    const { options } = routeTicketOptions(state, { turn: prepared.turn, suspensions: prepared.effects.suspensions }, network);
    if (record.resolvedRide.serviceId !== record.command.items[0].serviceId ||
        !options.directionsByService.get(record.resolvedRide.serviceId)?.includes(record.resolvedRide.direction)) invalidSave("Illegal route ticket ride");
    prepared.ride = { ...record.resolvedRide };
  }
  if (record.resolvedRide !== null) match(prepared.ride, record.resolvedRide, "Illegal resolved ride");
  return prepared;
}

/** Rebuild a full record from supplied outcomes without trusting derived metadata. */
function structuralTurn(state: ItemGameState, record: ItemTurnRecord, network: RailwayNetwork, pendingDiscard: boolean): ItemGameState {
  const prepared = preparedRecord(state, record, network);
  const action = prepared.command.items[0];
  const deadhead = action?.kind === "deadhead";
  if (deadhead !== (record.kind === "deadhead")) invalidSave("Record variant does not match the command");
  let face = record.rawRoll;
  if (record.kind === "item-ride") {
    face = prepared.delayed && !prepared.oversleep ? 1 : record.rawRoll;
    if (record.adjustment !== null) {
      if (action || prepared.delayed || prepared.oversleep) invalidSave("Illegal roll adjustment");
      ownedItem(state, record.adjustment.instanceId, "roll-adjust");
      face += record.adjustment.delta;
      if (face < 1 || face > 6) invalidSave("Adjusted roll is outside 1-6");
      const consumed = consumeInventoryInstance(prepared.inventory, record.adjustment.instanceId);
      prepared.inventory = consumed.inventory;
      prepared.events.push(...consumed.events);
    }
  }
  const moved = advanceWithMode({ ...state, currentServiceId: prepared.ride.serviceId, direction: prepared.ride.direction },
    deadhead ? { mode: "deadhead" } : prepared.oversleep ? { mode: "oversleep" }
      : { mode: action?.kind === "rapid" ? "rapid" : "normal", pips: face! * (action?.kind === "double" ? 2 : 1) }, network);
  let landing = null;
  let landingSnapshot: ItemLandingSnapshot | null = null;
  if (!moved.cleared && moved.mode !== "deadhead") {
    const filtered = itemLandingOptions({ ...state, currentStationId: moved.stationId,
      currentServiceId: prepared.ride.serviceId, direction: prepared.ride.direction }, {
      turn: prepared.turn, suspensions: prepared.effects.suspensions,
      ...(prepared.effects.detourPending ? { detourServiceId: prepared.ride.serviceId } : {}),
    }, network);
    const { options } = filtered;
    if (record.landing === null) invalidSave("Missing landing");
    landing = resolveLandingEvent(options, prepared.ride.serviceId, record.landing).choice;
    landingSnapshot = { stationId: options.stationId, suspensionIgnored: filtered.suspensionIgnored, detourConsumed: filtered.detourConsumed,
      services: options.services.map((serviceId, index) => ({ serviceId, weight: options.serviceWeights[index]!,
        directions: [...options.directionsByService.get(serviceId)!], directionWeights: [...options.directionWeightsByService.get(serviceId)!] })) };
    if (filtered.detourConsumed) {
      prepared.effects = clearDetour(prepared.effects);
      prepared.events.push({ type: "effect-activated", effect: "detour" });
    }
  }
  const drop = moved.cleared ? null : recordedDrop(state, prepared, record, network);
  let inventory = drop?.inventory ?? prepared.inventory;
  const itemEvents = [...prepared.events, ...(drop?.events ?? [])];
  if (drop?.pendingDiscard) {
    if (!pendingDiscard) {
      if (record.discardedInstanceId === null) invalidSave("Missing discard choice");
      const resolved = resolvePendingItemDiscard(drop.pendingDiscard, inventory, record.discardedInstanceId);
      inventory = resolved.inventory;
      itemEvents.push(...resolved.events);
    } else if (record.discardedInstanceId !== null) invalidSave("Pending discard already has a choice");
  } else if (pendingDiscard || record.discardedInstanceId !== null) invalidSave("No discard is required");
  const common = { turn: prepared.turn, fromStationId: state.currentStationId, toStationId: moved.stationId,
    command: prepared.command, traversedSegmentIds: moved.traversedSegmentIds, landing, landingSnapshot, itemEvents,
    discardedInstanceId: record.discardedInstanceId };
  const expected: ItemTurnRecord = moved.mode === "deadhead" ? {
    ...common, kind: "deadhead", resolvedRide: null, rawRoll: null, effectiveFace: null, adjustment: null,
    movementMode: "deadhead", pips: null, hopBudget: null, physicalHops: 0, unusedPips: null, stopReason: "relocation", relocation: moved.relocation,
  } : {
    ...common, kind: "item-ride", resolvedRide: prepared.ride, rawRoll: record.rawRoll!, effectiveFace: face!, adjustment: record.adjustment,
    movementMode: moved.mode, pips: moved.pips, hopBudget: moved.hopBudget, physicalHops: moved.physicalHops,
    unusedPips: moved.unusedPips, stopReason: moved.stopReason,
  };
  match(expected, record, "Item record contradicts its structural replay");
  const nextRide = moved.mode === "deadhead" ? moved.relocation : landing ?? prepared.ride;
  return { ...state, status: moved.cleared ? "completed" : "playing", turn: prepared.turn,
    currentStationId: moved.stationId, currentServiceId: nextRide.serviceId, direction: nextRide.direction,
    completedSegmentIds: moved.completedSegmentIds, inventory, effects: drop?.effects ?? prepared.effects };
}

function withoutRng<T>(value: T): unknown {
  if (Array.isArray(value)) return value.map(withoutRng);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["rngState", "itemRngState", "rngStateAfterRoll", "nextItemRngState"].includes(key))
    .map(([key, nested]) => [key, withoutRng(nested)]));
}
function position(state: ItemGameState): ItemPosition {
  const { movementHistory: _history, pending: _pending, ...rest } = state;
  return rest;
}
function seededRecord(state: ItemGameState, record: ItemTurnRecord, network: RailwayNetwork, complete: boolean): ItemGameState {
  let result = beginItemTurn(state, record.command, network);
  if (result.state.pending?.kind === "roll") result = finishItemTurn(result.state, record.adjustment, network);
  if (complete && result.state.pending?.kind === "discard") {
    if (record.discardedInstanceId === null) throw new GameEngineError("RNG_MISMATCH", "Seed requires a discard choice");
    result = resolveItemDiscard(result.state, record.discardedInstanceId);
  }
  matchSeeded(complete ? result.record : result.state.pending?.kind === "discard" ? result.state.pending.record : null, record);
  // Drop the one-record output before processing the next turn.
  return { ...result.state, movementHistory: [] };
}
function matchSeeded(actual: unknown, saved: unknown): void {
  if (!sameJson(actual, saved)) throw new GameEngineError("RNG_MISMATCH", "Item save differs from seeded replay");
}

export function replayItemSave(saved: ItemGameState, network: RailwayNetwork, seeded: boolean): void {
  try {
    let replayed = createItemGame(saved.config, saved.rngSeed, network);
    for (const record of saved.movementHistory) {
      if (replayed.status !== "playing") invalidSave("History follows a completed game");
      replayed = seeded ? seededRecord(replayed, record, network, true) : structuralTurn(replayed, record, network, false);
    }
    const compare = seeded ? matchSeeded : (actual: unknown, expected: unknown): void => match(withoutRng(actual), withoutRng(expected), "Saved item position contradicts its history");
    compare(position(replayed), position(saved));
    const pending = saved.pending;
    if (pending?.kind === "roll") {
      const prepared = preparedRecord(replayed, pending, network);
      if (prepared.command.items[0]?.kind === "deadhead" || pending.turn !== prepared.turn) invalidSave("Deadhead cannot await a roll");
      if (seeded) compare(beginItemTurn(replayed, pending.command, network).state.pending, pending);
    } else if (pending?.kind === "discard") {
      if (seeded) {
        const next = seededRecord(replayed, pending.record as ItemTurnRecord, network, false);
        compare(next.pending, pending);
      } else {
        const next = structuralTurn(replayed, pending.record as ItemTurnRecord, network, true);
        compare(position(next), pending.position);
        const pickup = pending.record.itemEvents.find((event) => event.type === "pickup-pending-discard");
        if (pickup?.type !== "pickup-pending-discard") invalidSave("Missing pending pickup");
        compare(pending.item, pickup.item);
        compare(pending.candidates, pickup.candidates);
      }
    }
  } catch (error) {
    if (error instanceof GameEngineError) {
      if (seeded) throw new GameEngineError("RNG_MISMATCH", `Seeded item replay failed: ${error.code}`);
      invalidSave(`Structural item replay failed: ${error.message}`);
    }
    throw error;
  }
}
