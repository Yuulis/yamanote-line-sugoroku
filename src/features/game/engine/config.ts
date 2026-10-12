import type { Direction, GameConfig, ServicePattern } from "../../../types/network";
import { GameEngineError } from "./errors";
import { DIRECTIONS, findSegment, type RailwayNetwork, servicePairs } from "./network";

export const GOAL_ARRIVAL_POLICIES = [
  "truncate-on-target-service",
  "exact-stop",
  "pass-through",
] as const satisfies readonly GameConfig["goalArrivalPolicy"][];

function invalid(message: string): never {
  throw new GameEngineError("INVALID_CONFIG", message);
}

function assertSegments(
  network: RailwayNetwork,
  service: ServicePattern,
  direction: Direction,
): void {
  for (const [from, to] of servicePairs(service, direction)) {
    if (!findSegment(network, service.id, from, to)) {
      invalid(`Service ${service.id} has no segment ${from} -> ${to}`);
    }
  }
}

/**
 * Check that `config` describes a playable game on `network`:
 * - the target service exists, is circular (the goal is a return to the
 *   start), stops at the start station, and has every directed segment in
 *   the target direction;
 * - every other service has both directions for every adjacent pair, so
 *   missing track data can never look like a terminus;
 * - the start station is not an end of any linear service (an endpoint
 *   truncation there would blur the exact-stop goal rule).
 *
 * @throws GameEngineError `INVALID_CONFIG`
 */
export function validateConfig(config: GameConfig, network: RailwayNetwork): void {
  if (config.rulesetVersion.length === 0) invalid("rulesetVersion is empty");
  if (!GOAL_ARRIVAL_POLICIES.includes(config.goalArrivalPolicy)) {
    invalid("Unknown goalArrivalPolicy");
  }
  if (config.targetDirection !== 1 && config.targetDirection !== -1) {
    invalid("targetDirection must be 1 or -1");
  }
  const target = network.servicesById.get(config.targetServiceId);
  if (!target) invalid(`Unknown target service ${config.targetServiceId}`);
  if (!target.circular) invalid("Target service must be circular");
  if (!target.stationIds.includes(config.startStationId)) {
    invalid(`Start station ${config.startStationId} is not on the target service`);
  }
  assertSegments(network, target, config.targetDirection);
  for (const service of network.servicesById.values()) {
    if (service.id === target.id) continue;
    for (const direction of DIRECTIONS) assertSegments(network, service, direction);
    const ends = [service.stationIds[0], service.stationIds.at(-1)];
    if (!service.circular && ends.includes(config.startStationId)) {
      invalid(`Start station ${config.startStationId} is an end of ${service.id}`);
    }
  }
}
