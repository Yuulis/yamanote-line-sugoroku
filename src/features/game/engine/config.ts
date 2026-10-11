import type { GameConfig } from "../../../types/network";
import { GameEngineError } from "./errors";
import { findSegment, type RailwayNetwork, servicePairs } from "./network";

export const GOAL_ARRIVAL_POLICIES = [
  "truncate-on-target-service",
  "exact-stop",
  "pass-through",
] as const satisfies readonly GameConfig["goalArrivalPolicy"][];

function invalid(message: string): never {
  throw new GameEngineError("INVALID_CONFIG", message);
}

/**
 * Check that `config` describes a playable game on `network`: the target
 * service exists, is circular (the goal is a return to the start), stops at
 * the start station, and has every directed segment in the target direction.
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
  const service = network.servicesById.get(config.targetServiceId);
  if (!service) invalid(`Unknown target service ${config.targetServiceId}`);
  if (!service.circular) invalid("Target service must be circular");
  if (!service.stationIds.includes(config.startStationId)) {
    invalid(`Start station ${config.startStationId} is not on the target service`);
  }
  for (const [from, to] of servicePairs(service, config.targetDirection)) {
    if (!findSegment(network, service.id, from, to)) {
      invalid(`No segment ${from} -> ${to} in the target direction`);
    }
  }
}
