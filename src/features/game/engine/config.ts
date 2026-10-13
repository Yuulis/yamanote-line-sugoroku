import type { Direction, GameConfig, ServicePattern } from "../../../types/network";
import { SERVICE_KINDS } from "../../../types/network";
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

/** Policy components are bounded independently of the uint32 draw total. */
export const MAX_POLICY_INTEGER = 1000;

function policyRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !keys.includes(key)) ||
      keys.some((key) => !Object.hasOwn(raw, key))) {
    invalid(`${path} must contain exactly ${keys.join(", ")}`);
  }
  return raw;
}

function policyInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_POLICY_INTEGER) {
    invalid(`${path} must be an integer 1-${MAX_POLICY_INTEGER}`);
  }
  return value;
}

/** Validate unknown input and return fresh policies; also used by save parsing. */
export function parseLotteryPolicies(
  serviceValue: unknown,
  directionValue: unknown,
): Pick<GameConfig, "serviceLottery" | "directionLottery"> {
  const service = policyRecord(serviceValue, ["kindWeights", "target"], "serviceLottery");
  const bases = policyRecord(service.kindWeights, SERVICE_KINDS, "serviceLottery.kindWeights");
  const targetValue = service.target;
  if (typeof targetValue !== "object" || targetValue === null || Array.isArray(targetValue)) {
    invalid("serviceLottery.target must be an object");
  }
  const kind = (targetValue as Record<string, unknown>).kind;
  let target: GameConfig["serviceLottery"]["target"];
  if (kind === "weight") {
    const raw = policyRecord(targetValue, ["kind", "weight"], "serviceLottery.target");
    target = { kind, weight: policyInteger(raw.weight, "target.weight") };
  } else if (kind === "share") {
    const raw = policyRecord(targetValue, ["kind", "numerator", "denominator"], "serviceLottery.target");
    const numerator = policyInteger(raw.numerator, "target.numerator");
    const denominator = policyInteger(raw.denominator, "target.denominator");
    if (numerator >= denominator) invalid("Target share must satisfy 0 < numerator < denominator");
    target = { kind, numerator, denominator };
  } else {
    invalid("Unknown serviceLottery.target.kind");
  }
  const direction = policyRecord(directionValue, ["towardTargetWeight"], "directionLottery");
  return {
    serviceLottery: {
      kindWeights: {
        local: policyInteger(bases.local, "kindWeights.local"),
        rapid: policyInteger(bases.rapid, "kindWeights.rapid"),
        "special-rapid": policyInteger(bases["special-rapid"], "kindWeights.special-rapid"),
        "medium-distance": policyInteger(bases["medium-distance"], "kindWeights.medium-distance"),
      },
      target,
    },
    directionLottery: { towardTargetWeight: policyInteger(direction.towardTargetWeight, "towardTargetWeight") },
  };
}

/** Isolate all nested policy objects when creating or returning a game state. */
export function copyGameConfig(config: GameConfig): GameConfig {
  return {
    ...config,
    serviceLottery: {
      kindWeights: { ...config.serviceLottery.kindWeights },
      target: { ...config.serviceLottery.target },
    },
    directionLottery: { ...config.directionLottery },
  };
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
  parseLotteryPolicies(config.serviceLottery, config.directionLottery);
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
