// Pure movement building blocks. Turn orchestration owns dice, landing and items.

import type { SegmentId, StationId } from "../../../types/network";
import { GameEngineError } from "./errors";
import { deadheadDestination, type RelocationOutcome } from "./itemOptions";
import { advance, assertSettledPosition, type Advance, type GamePosition } from "./movement";
import { nextStationId, type RailwayNetwork } from "./network";

const OVERSLEEP_LOOP_HOPS = 6;
const RAPID_MIN_SERVICES = 2;

export type RideMovementRequest = { mode: "normal" | "rapid"; pips: number } | { mode: "oversleep" };
export type MovementRequest = RideMovementRequest | { mode: "deadhead" };

export interface RideMovement extends Advance {
  mode: RideMovementRequest["mode"];
  /** Counted transfer arrivals for rapid; physical hop budget for other rides. */
  pips: number;
  /** Planned physical hops before normal goal truncation. */
  hopBudget: number;
  physicalHops: number;
}

export interface DeadheadMovement {
  mode: "deadhead";
  stationId: StationId;
  pips: null;
  hopBudget: null;
  physicalHops: 0;
  traversedSegmentIds: [];
  completedSegmentIds: SegmentId[];
  events: [];
  cleared: false;
  stopReason: "relocation";
  unusedPips: null;
  relocation: RelocationOutcome;
}

export type ItemMovementResult = RideMovement | DeadheadMovement;

function isRapidStop(network: RailwayNetwork, stationId: StationId): boolean {
  return (network.servicesByStation.get(stationId)?.length ?? 0) >= RAPID_MIN_SERVICES;
}

/** Plan to the last counted arrival or endpoint without the spike's hop cap. */
function rapidHopBudget(state: GamePosition, pips: number, network: RailwayNetwork): number {
  const service = network.servicesById.get(state.currentServiceId)!;
  if (service.circular && !service.stationIds.some((id) => isRapidStop(network, id))) {
    throw new GameEngineError("INVALID_STATE", `Rapid movement cannot spend pips on ${service.id}: no transfer stops`);
  }
  let stationId = state.currentStationId;
  let remaining = pips;
  let hops = 0;
  while (remaining > 0) {
    const next = nextStationId(network, service.id, stationId, state.direction);
    if (next === undefined) break;
    stationId = next;
    hops += 1;
    if (isRapidStop(network, stationId)) remaining -= 1;
  }
  return hops;
}

function oversleepHopBudget(state: GamePosition, network: RailwayNetwork): number {
  const service = network.servicesById.get(state.currentServiceId)!;
  if (service.circular) return OVERSLEEP_LOOP_HOPS;
  const index = service.stationIds.indexOf(state.currentStationId);
  return state.direction === 1 ? service.stationIds.length - index - 1 : index;
}

/**
 * Rides reuse advance for progress, hop events and the goal policy. Rapid's
 * final planned hop defines an exact stop, as in the spike. Only its pip and
 * endpoint metadata are corrected after traversal. Oversleep has no die-pip
 * budget: its pips are the forced endpoint/six-hop budget.
 */
export function advanceWithMode(state: GamePosition, request: RideMovementRequest, network: RailwayNetwork): RideMovement;
export function advanceWithMode(state: GamePosition, request: { mode: "deadhead" }, network: RailwayNetwork): DeadheadMovement;
export function advanceWithMode(state: GamePosition, request: MovementRequest, network: RailwayNetwork): ItemMovementResult;
export function advanceWithMode(
  state: GamePosition,
  request: MovementRequest,
  network: RailwayNetwork,
): ItemMovementResult {
  assertSettledPosition(state, network);
  if (request.mode === "deadhead") {
    const relocation = deadheadDestination(state, network);
    return {
      mode: "deadhead", stationId: relocation.toStationId, pips: null, hopBudget: null,
      physicalHops: 0, traversedSegmentIds: [], completedSegmentIds: [...state.completedSegmentIds],
      events: [], cleared: false, stopReason: "relocation", unusedPips: null, relocation,
    };
  }
  if (request.mode !== "oversleep" && (!Number.isSafeInteger(request.pips) || request.pips < 1)) {
    throw new GameEngineError("INVALID_ROLL", "Movement pips must be a positive safe integer");
  }
  const hopBudget = request.mode === "rapid"
    ? rapidHopBudget(state, request.pips, network)
    : request.mode === "oversleep" ? oversleepHopBudget(state, network) : request.pips;
  const pips = request.mode === "oversleep" ? hopBudget : request.pips;
  const moved = advance(state, hopBudget, network);
  const physicalHops = moved.traversedSegmentIds.length;
  if (request.mode === "normal") return { ...moved, mode: "normal", pips, hopBudget, physicalHops };

  const spentPips = request.mode === "rapid"
    ? moved.events.filter((event) => event.type === "segment-traversed" && isRapidStop(network, event.toStationId)).length
    : physicalHops;
  const unusedPips = pips - spentPips;
  // A planned endpoint is an explicit stop even though advance's hop budget
  // ends there exactly. Goal retains precedence over endpoint metadata.
  const endpoint = !moved.cleared && (request.mode === "rapid"
    ? unusedPips > 0
    : !network.servicesById.get(state.currentServiceId)!.circular);
  return {
    ...moved, mode: request.mode, pips, hopBudget, physicalHops, unusedPips,
    stopReason: endpoint ? "endpoint" : moved.stopReason,
    events: endpoint ? [...moved.events, {
      type: "endpoint-reached", stationId: moved.stationId, step: physicalHops, discardedPips: unusedPips,
    }] : moved.events,
  };
}
