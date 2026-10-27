import * as engine from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import type { ItemGameState, ItemTurnRecord } from "../../../src/types/network";
import { chooseAdjustment, chooseDiscard, choosePreRoll, type Policy } from "./policy";

export interface GameMeasurement {
  seed: string;
  turns: number;
  completed: boolean;
  counters: Record<string, number>;
  saveChecks: Record<string, number>;
  trace: TurnTrace[];
  error: string | null;
}
export interface TurnTrace {
  turn: number;
  station: string;
  service: string;
  direction: number;
  main: string;
  items: string;
  inventory: string[];
  targets: string[];
  rawRoll: number | null;
  face: number | null;
  action: string | null;
  ride: string | null;
  mode: string;
  hops: number;
  fromStation: string;
  fromService: string;
  routes: readonly string[];
  rideDirection: number | null;
  effects: { delay: readonly number[]; suspension: readonly (readonly [string, number])[]; detour: boolean; oversleep: boolean };
}
export function turnTrace(state: ItemGameState, record: ItemTurnRecord, targetIds: ReadonlySet<string>, before: ItemGameState, network: engine.RailwayNetwork): TurnTrace {
  return {
    turn: state.turn, station: state.currentStationId, service: state.currentServiceId,
    direction: state.direction, main: state.rngState, items: state.itemRngState,
    inventory: state.inventory.map((item) => item.kind),
    targets: state.completedSegmentIds.filter((id) => targetIds.has(id)),
    rawRoll: record.rawRoll, face: record.effectiveFace,
    action: record.command.items[0]?.kind ?? (record.adjustment ? "roll-adjust" : null),
    ride: record.resolvedRide?.serviceId ?? null, mode: record.movementMode, hops: record.physicalHops,
    fromStation: before.currentStationId, fromService: before.currentServiceId,
    routes: engine.routeTicketOptions(before, { turn: before.turn + 1, suspensions: before.effects.suspensions }, network).options.services,
    rideDirection: record.resolvedRide?.direction ?? null,
    effects: { delay: [...state.effects.delayDueTurns].sort((a, b) => a - b),
      suspension: state.effects.suspensions.filter((s) => s.expiresTurn > state.turn).map((s) => [s.serviceId, s.expiresTurn] as const).sort((a, b) => a[0].localeCompare(b[0])),
      detour: state.effects.detourPending, oversleep: state.effects.oversleepPending },
  };
}

export function runProductionGame(network: engine.RailwayNetwork, seed: string, policy: Policy, cap: number, sample: boolean = false, trace: boolean = false): GameMeasurement {
  let state = engine.createItemGame(ITEM_GAME_CONFIG, seed, network);
  let rng = engine.seedRng(`${seed}|policy`);
  const result: GameMeasurement = { seed, turns: 0, completed: false, counters: {}, saveChecks: {}, trace: [], error: null };
  const targets = new Set(engine.targetSegmentIds(state.config, network));
  const count = (key: string): void => { result.counters[key] = (result.counters[key] ?? 0) + 1; };
  const roundTrip = (kind: string): void => {
    if (!sample || result.saveChecks[kind]) return;
    const saved = engine.serializeGame(state);
    const restored = engine.restoreGame(saved, network, { expectedConfig: { ...ITEM_GAME_CONFIG, itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, requireSeededRolls: true });
    // Full recursive equality, including every record and pending transcript.
    if (!sameValue(state, restored)) throw new Error(`Save structure mismatch: ${kind}`);
    state = restored;
    result.saveChecks[kind] = 1;
  };
  try {
    while (state.status === "playing" && state.turn < cap) {
      const before = state;
      const choice = choosePreRoll(state, network, policy, rng);
      rng = choice.rng;
      if (choice.decision) count("decisionTurns");
      state = engine.beginItemTurn(state, choice.command, network).state;
      if (state.pending?.kind === "roll") {
        if (state.turn >= 3) roundTrip("pending-roll");
        const adjusted = chooseAdjustment(state, network, policy, choice.adjust, rng);
        rng = adjusted.rng;
        state = engine.finishItemTurn(state, adjusted.adjustment, network).state;
      }
      if (state.pending?.kind === "discard") {
        roundTrip("pending-discard");
        const pending = state.pending;
        if (pending?.kind !== "discard") throw new Error("Discard sample lost pending state");
        const discarded = chooseDiscard(pending.candidates, policy, rng);
        rng = discarded.rng;
        state = engine.resolveItemDiscard(state, discarded.instanceId).state;
      }
      const record = state.movementHistory.at(-1)!;
      const active = record.command.items.length + (record.adjustment ? 1 : 0);
      if (active > 1) throw new Error("Multiple active items in a turn");
      if (record.resolvedRide?.serviceId === state.config.targetServiceId) count("targetTurns");
      if (record.movementMode === "oversleep") {
        count("oversleepTurns");
        if (record.resolvedRide?.serviceId === "toei-oedo-loop") count("oedoOversleepTurns");
      }
      for (const event of record.itemEvents) {
        count(`event:${event.type}`);
        if ("item" in event) count(`${event.type}:${typeof event.item === "string" ? event.item : event.item.kind}`);
      }
      if (trace) result.trace.push(turnTrace(state, record, targets, before, network));
      if (!sample) state = { ...state, movementHistory: [] };
    }
    if (state.status === "completed") roundTrip("completed");
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  result.turns = state.turn;
  result.completed = state.status === "completed";
  return result;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  }
  return false;
}
