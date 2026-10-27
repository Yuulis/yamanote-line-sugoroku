import type { Direction, GameConfig, ItemPolicy, ServicePattern } from "../../../types/network";
import { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS, SERVICE_KINDS } from "../../../types/network";
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
  if (typeof directionValue !== "object" || directionValue === null || Array.isArray(directionValue)) {
    invalid("directionLottery must be an object");
  }
  const direction = directionValue as Record<string, unknown>;
  if (Object.keys(direction).some((key) => !["towardTargetWeight", "awayFromTargetWeight"].includes(key)) ||
      !Object.hasOwn(direction, "towardTargetWeight")) {
    invalid("directionLottery must contain towardTargetWeight and optional awayFromTargetWeight");
  }
  const towardTargetWeight = policyInteger(direction.towardTargetWeight, "towardTargetWeight");
  const awayFromTargetWeight = Object.hasOwn(direction, "awayFromTargetWeight")
    ? policyInteger(direction.awayFromTargetWeight, "awayFromTargetWeight")
    : undefined;
  return {
    serviceLottery: {
      kindWeights: {
        local: policyInteger(bases.local, "kindWeights.local"),
        rapid: policyInteger(bases.rapid, "kindWeights.rapid"),
      },
      target,
    },
    directionLottery: awayFromTargetWeight === undefined
      ? { towardTargetWeight }
      : { towardTargetWeight, awayFromTargetWeight },
  };
}

function boundedInteger(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(`${path} must be an integer ${min}-${max}`);
  }
  return value;
}

/** Parse the not-yet-shipped item policy without accepting future/unknown keys. */
export function parseItemPolicy(value: unknown): ItemPolicy {
  const keys = ["dropChancePerMille", "harmfulChancePercent", "inventoryCapacity", "maxActiveItemsPerTurn", "delayTurns", "suspensionTurns", "fullInventoryPolicy", "beneficialKinds", "harmfulKinds"];
  const raw = policyRecord(value, keys, "itemPolicy");
  if (raw.fullInventoryPolicy !== "player-chooses-discard") invalid("itemPolicy.fullInventoryPolicy is unknown");
  const parseKinds = <T extends string>(input: unknown, allowed: readonly T[], path: string): T[] => {
    if (!Array.isArray(input) || input.length === 0) invalid(`${path} must be a non-empty array`);
    const result = input.map((kind, index) => {
      if (typeof kind !== "string" || !allowed.includes(kind as T)) invalid(`${path}[${index}] is unknown`);
      return kind as T;
    });
    if (new Set(result).size !== result.length) invalid(`${path} must not contain duplicates`);
    return result;
  };
  const capacity = boundedInteger(raw.inventoryCapacity, 1, 10, "itemPolicy.inventoryCapacity");
  const activeLimit = boundedInteger(raw.maxActiveItemsPerTurn, 1, capacity, "itemPolicy.maxActiveItemsPerTurn");
  return {
    dropChancePerMille: boundedInteger(raw.dropChancePerMille, 0, 1000, "itemPolicy.dropChancePerMille"),
    harmfulChancePercent: boundedInteger(raw.harmfulChancePercent, 0, 100, "itemPolicy.harmfulChancePercent"),
    inventoryCapacity: capacity,
    maxActiveItemsPerTurn: activeLimit,
    delayTurns: boundedInteger(raw.delayTurns, 1, 100, "itemPolicy.delayTurns"),
    suspensionTurns: boundedInteger(raw.suspensionTurns, 1, 100, "itemPolicy.suspensionTurns"),
    fullInventoryPolicy: "player-chooses-discard",
    beneficialKinds: parseKinds(raw.beneficialKinds, BENEFICIAL_ITEM_KINDS, "itemPolicy.beneficialKinds"),
    harmfulKinds: parseKinds(raw.harmfulKinds, HARMFUL_ITEM_KINDS, "itemPolicy.harmfulKinds"),
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
    ...(config.itemPolicy ? { itemPolicy: {
      ...config.itemPolicy,
      beneficialKinds: [...config.itemPolicy.beneficialKinds],
      harmfulKinds: [...config.itemPolicy.harmfulKinds],
    } } : {}),
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
  if (Object.hasOwn(config, "itemPolicy")) parseItemPolicy(config.itemPolicy);
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
