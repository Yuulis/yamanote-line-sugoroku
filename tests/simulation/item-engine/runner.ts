import * as engine from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import type { GameConfig, ItemGameState, ItemTurnRecord } from "../../../src/types/network";
import { chooseAdjustment, chooseDiscard, choosePreRoll, type Policy } from "./policy";

/** Frozen pre-range rules used to preserve the round-3 simulation baseline. */
export const LEGACY_ITEM_CONFIG = {
  rulesetVersion: "tokyo-suburban-items-1",
  targetServiceId: "jr-yamanote",
  startStationId: "shimbashi",
  targetDirection: 1,
  goalArrivalPolicy: "truncate-on-target-service",
  serviceLottery: {
    kindWeights: { local: 1, rapid: 1 },
    target: { kind: "share", numerator: 1, denominator: 2 },
  },
  directionLottery: { towardTargetWeight: 3, awayFromTargetWeight: 2 },
  itemPolicy: {
    dropChancePerMille: 300,
    harmfulChancePercent: 30,
    inventoryCapacity: 3,
    maxActiveItemsPerTurn: 1,
    delayTurns: 3,
    suspensionTurns: 5,
    fullInventoryPolicy: "player-chooses-discard",
    beneficialKinds: ["route-ticket", "direction-ticket", "roll-adjust", "double", "rapid", "deadhead", "delay-certificate"] as const,
    beneficialWeights: [1, 1, 1, 1, 1, 1, 1] as const,
    harmfulKinds: ["delay", "suspension", "detour", "oversleep"] as const,
  },
} satisfies GameConfig;

export interface SimulationRunConfig {
  gameConfig: GameConfig;
  /** Omit the cap when the simulation should allow every legal adjusted face. */
  maxFace?: number;
}

export const LEGACY_SIMULATION_CONFIG: SimulationRunConfig = {
  gameConfig: LEGACY_ITEM_CONFIG,
  maxFace: 6,
};

export const PRODUCT_SIMULATION_CONFIG: SimulationRunConfig = {
  gameConfig: ITEM_GAME_CONFIG,
};

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

export function runProductionGame(network: engine.RailwayNetwork, seed: string, policy: Policy, cap: number, runConfig: SimulationRunConfig, sample: boolean = false, trace: boolean = false): GameMeasurement {
  let state = engine.createItemGame(runConfig.gameConfig, seed, network);
  let rng = engine.seedRng(`${seed}|policy`);
  const result: GameMeasurement = { seed, turns: 0, completed: false, counters: {}, saveChecks: {}, trace: [], error: null };
  const targets = new Set(engine.targetSegmentIds(state.config, network));
  const count = (key: string): void => { result.counters[key] = (result.counters[key] ?? 0) + 1; };
  const roundTrip = (kind: string): void => {
    if (!sample || result.saveChecks[kind]) return;
    const saved = engine.serializeGame(state);
    const restored = engine.restoreGame(saved, network, { expectedConfig: { ...runConfig.gameConfig, itemPolicy: runConfig.gameConfig.itemPolicy! }, requireSeededRolls: true });
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
        const adjusted = chooseAdjustment(state, network, policy, choice.adjust, rng, {
          maxFace: runConfig.maxFace,
        });
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
