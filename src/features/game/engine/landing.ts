// Landing resolution at the arrival station (spec 4.1 steps 2-5, design §1).
//
// Ruleset contract (changing any of it changes every seeded game; bump the
// rulesetVersion):
// - Only the station where a move ends triggers a landing; stations passed
//   through never do, and a move that clears the game has no landing.
// - Service candidates: the distinct services stopping at the station, in
//   network (services.json) order, the ridden service included.
// - k >= 2 candidates: policy-weighted service draw; k = 1: no draw.
// - Target service: always `config.targetDirection`, no draw.
// - Any other service: movable directions in [1, -1] order; two movable:
//   policy-weighted direction draw (re-drawn at every landing, even when the service
//   is unchanged: rule R1-a); one movable: forced, no draw.
// - Draw order per turn: rollDie (game.ts), service draw, direction draw.

import type {
  Direction,
  GameConfig,
  GameState,
  LandingChoice,
  ServiceId,
  StationId,
} from "../../../types/network";
import { GameEngineError } from "./errors";
import { movableDirections, nextStationId, type RailwayNetwork, transferOptions } from "./network";
import { targetHopDistances } from "./proximity";
import { drawWeightedIndex } from "./rng";
import type { LandingResolvedEvent } from "./types";

export interface LandingOptions {
  stationId: StationId;
  /** Canonical order, deduplicated, the ridden service included. */
  services: readonly ServiceId[];
  /** Positive integer weights aligned with services (no GCD normalization). */
  serviceWeights: readonly number[];
  serviceDrawRequired: boolean;
  /** Target service -> [targetDirection]; others -> movable directions in [1, -1] order. */
  directionsByService: ReadonlyMap<ServiceId, readonly Direction[]>;
  /** Weights aligned with each service's direction candidates. */
  directionWeightsByService: ReadonlyMap<ServiceId, readonly number[]>;
}

export interface LandingDraw {
  choice: LandingChoice;
  nextRngState: string;
}

/** Minimum candidates for a lottery; fewer means the outcome is forced. */
const LOTTERY_MIN = 2;

function invalidState(message: string): never {
  throw new GameEngineError("INVALID_STATE", message);
}

function serviceWeights(
  services: readonly ServiceId[],
  config: GameConfig,
  network: RailwayNetwork,
): number[] {
  const policy = config.serviceLottery;
  const bases = services.map((id) => {
    const service = network.servicesById.get(id);
    if (!service) invalidState(`Unknown service ${id}`);
    return policy.kindWeights[service.kind ?? "local"];
  });
  const targetIndex = services.indexOf(config.targetServiceId);
  if (targetIndex < 0 || services.length === 1) return bases;
  const target = policy.target;
  if (target.kind === "weight") {
    return bases.map((base, index) => index === targetIndex ? base * target.weight : base);
  }
  const otherTotal = bases.reduce((sum, base, index) => index === targetIndex ? sum : sum + base, 0);
  return bases.map((base, index) => index === targetIndex
    ? target.numerator * otherTotal
    : (target.denominator - target.numerator) * base);
}

function directionWeights(
  directions: readonly Direction[],
  serviceId: ServiceId,
  stationId: StationId,
  config: GameConfig,
  network: RailwayNetwork,
): number[] {
  const weight = config.directionLottery.towardTargetWeight;
  if (weight === 1 || directions.length < LOTTERY_MIN) return directions.map(() => 1);
  const distances = targetHopDistances(network, config.targetServiceId);
  const nextDistances = directions.map((direction) => {
    const next = nextStationId(network, serviceId, stationId, direction);
    return next === undefined ? Infinity : distances.get(next) ?? Infinity;
  });
  const [forward = Infinity, backward = Infinity] = nextDistances;
  if (forward === backward) return [1, 1];
  return forward < backward ? [weight, 1] : [1, weight];
}

/**
 * The landing options at `arrival.currentStationId` (pure, no RNG). The
 * ridden service (`arrival.currentServiceId`) must stop there.
 *
 * @throws GameEngineError `INVALID_STATE`
 */
export function landingOptions(
  arrival: Pick<GameState, "config" | "currentStationId" | "currentServiceId" | "direction">,
  network: RailwayNetwork,
): LandingOptions {
  const { config, currentStationId: stationId, currentServiceId } = arrival;
  const services = transferOptions(network, stationId).map((option) => option.serviceId);
  if (!services.includes(currentServiceId)) {
    invalidState(`Service ${currentServiceId} does not stop at ${stationId}`);
  }
  const directionsByService = new Map<ServiceId, readonly Direction[]>();
  const directionWeightsByService = new Map<ServiceId, readonly number[]>();
  for (const serviceId of services) {
    const directions =
      serviceId === config.targetServiceId
        ? [config.targetDirection]
        : movableDirections(network, serviceId, stationId);
    if (directions.length === 0) invalidState(`Service ${serviceId} cannot leave ${stationId}`);
    directionsByService.set(serviceId, directions);
    directionWeightsByService.set(serviceId, directionWeights(directions, serviceId, stationId, config, network));
  }
  return {
    stationId,
    services,
    serviceWeights: serviceWeights(services, config, network),
    serviceDrawRequired: services.length >= LOTTERY_MIN,
    directionsByService,
    directionWeightsByService,
  };
}

function directionsOf(options: LandingOptions, serviceId: ServiceId): readonly Direction[] {
  const directions = options.directionsByService.get(serviceId);
  if (!directions || !options.services.includes(serviceId)) {
    invalidState(`Service ${serviceId} cannot be boarded at ${options.stationId}`);
  }
  return directions;
}

/** The whole outcome when no choice exists (one service, one direction). */
function forcedChoice(options: LandingOptions): LandingChoice | undefined {
  const [serviceId] = options.services;
  if (serviceId === undefined || options.serviceDrawRequired) return undefined;
  const directions = directionsOf(options, serviceId);
  const [direction] = directions;
  if (direction === undefined || directions.length >= LOTTERY_MIN) return undefined;
  return { serviceId, direction };
}

/**
 * Validate a landing choice against `options` and build the landing event
 * (spec 8.1 `resolveLandingEvent`). Never appends history or bumps the turn.
 * An omitted choice is accepted only when the whole outcome is forced.
 *
 * @throws GameEngineError `INVALID_STATE` for an omitted non-forced choice,
 *   an unknown service or an ineligible direction.
 */
export function resolveLandingEvent(
  options: LandingOptions,
  ridingServiceId: ServiceId,
  choice?: LandingChoice,
): { choice: LandingChoice; event: LandingResolvedEvent } {
  const resolved = choice ?? forcedChoice(options);
  if (!resolved) invalidState(`A landing choice is required at ${options.stationId}`);
  const directionCandidates = directionsOf(options, resolved.serviceId);
  if (!directionCandidates.includes(resolved.direction)) {
    invalidState(`Direction ${resolved.direction} is not available on ${resolved.serviceId}`);
  }
  const settled = { serviceId: resolved.serviceId, direction: resolved.direction };
  return {
    choice: settled,
    event: {
      type: "landing-resolved",
      stationId: options.stationId,
      serviceCandidates: [...options.services],
      serviceId: settled.serviceId,
      serviceDrawRequired: options.serviceDrawRequired,
      directionCandidates: [...directionCandidates],
      direction: settled.direction,
      directionDrawRequired: directionCandidates.length >= LOTTERY_MIN,
      changedService: settled.serviceId !== ridingServiceId,
    },
  };
}

/**
 * Draw the landing outcome from the seeded RNG: a service draw iff k >= 2,
 * then a direction draw iff the chosen service has two candidate directions.
 * Forced choices consume no draws.
 *
 * @throws GameEngineError `INVALID_RNG_STATE`, `INVALID_STATE`
 */
export function drawLanding(options: LandingOptions, rngState: string): LandingDraw {
  let state = rngState;
  let serviceId = options.services[0];
  if (options.serviceDrawRequired) {
    if (options.serviceWeights.length !== options.services.length) invalidState("Service weights do not match candidates");
    const draw = drawWeightedIndex(state, options.serviceWeights);
    serviceId = options.services[draw.index];
    state = draw.nextRngState;
  }
  if (serviceId === undefined) invalidState(`No service stops at ${options.stationId}`);
  const directions = directionsOf(options, serviceId);
  let direction = directions[0];
  if (directions.length >= LOTTERY_MIN) {
    const weights = options.directionWeightsByService.get(serviceId);
    if (!weights || weights.length !== directions.length) invalidState("Direction weights do not match candidates");
    const draw = drawWeightedIndex(state, weights);
    direction = directions[draw.index];
    state = draw.nextRngState;
  }
  if (direction === undefined) invalidState(`Service ${serviceId} cannot leave ${options.stationId}`);
  return { choice: { serviceId, direction }, nextRngState: state };
}
