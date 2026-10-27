// Item candidates and graph-hop guidance. Queries never draw dice or lotteries.

import type { Direction, GameState, ServiceId, StationId } from "../../../types/network";
import { GameEngineError } from "./errors";
import {
  filterLandingOptions, landingOptions, type FilteredLandingOptions,
  type LandingFilters, type LandingOptions,
} from "./landing";
import { movableDirections, nextStationId, type RailwayNetwork } from "./network";
import { nearestTargetStation, targetHopDistances } from "./proximity";

export type ItemOptionPosition = Pick<GameState, "config" | "currentStationId" | "currentServiceId" | "direction">;

export interface RouteTicketOptions {
  options: LandingOptions;
  candidates: readonly { serviceId: ServiceId; isTarget: boolean }[];
  suspensionIgnored: boolean;
}

export interface DirectionHint {
  directions: readonly { direction: Direction; nextStationId: StationId; targetHops: number }[];
  /** Null on a tie (including two unreachable directions). */
  closerDirection: Direction | null;
}

export interface RelocationOutcome {
  fromStationId: StationId;
  toStationId: StationId;
  serviceId: ServiceId;
  direction: Direction;
  /** Directed distance used to select the destination; no segments are ridden. */
  distance: number;
}

/** The landing lottery's eligible candidates, weights and effect consumption. */
export function itemLandingOptions(
  position: ItemOptionPosition,
  filters: LandingFilters,
  network: RailwayNetwork,
): FilteredLandingOptions {
  return filterLandingOptions(landingOptions(position, network), position.config, filters, network);
}

/** Route tickets obey suspension, but a pending detour only affects landing. */
export function routeTicketOptions(
  position: ItemOptionPosition,
  filters: Pick<LandingFilters, "turn" | "suspensions">,
  network: RailwayNetwork,
): RouteTicketOptions {
  const { options, suspensionIgnored } = itemLandingOptions(position, {
    turn: filters.turn, suspensions: filters.suspensions,
  }, network);
  return {
    options,
    candidates: options.services.map((serviceId) => ({ serviceId, isTarget: serviceId === position.config.targetServiceId })),
    suspensionIgnored,
  };
}

/** Compare legal next stops using the same directed distances as the lottery. */
export function directionHint(position: ItemOptionPosition, network: RailwayNetwork): DirectionHint {
  const { config, currentServiceId: serviceId, currentStationId: stationId } = position;
  if (!network.servicesById.get(serviceId)?.stationIds.includes(stationId)) {
    throw new GameEngineError("INVALID_STATE", `Service ${serviceId} does not stop at ${stationId}`);
  }
  const distances = targetHopDistances(network, config.targetServiceId);
  const legal = serviceId === config.targetServiceId ? [config.targetDirection] : movableDirections(network, serviceId, stationId);
  const directions = legal.map((direction) => {
    const next = nextStationId(network, serviceId, stationId, direction);
    if (next === undefined) throw new GameEngineError("INVALID_STATE", `Service ${serviceId} cannot leave ${stationId}`);
    return { direction, nextStationId: next, targetHops: distances.get(next) ?? Infinity };
  });
  const minimum = Math.min(...directions.map((option) => option.targetHops));
  const best = directions.filter((option) => option.targetHops === minimum);
  return { directions, closerDirection: Number.isFinite(minimum) && best.length === 1 ? best[0]!.direction : null };
}

/** Graph guidance only: on target, or the current next stop is nearer to it. */
export function rapidHeadsTowardTarget(position: ItemOptionPosition, network: RailwayNetwork): boolean {
  const hint = directionHint(position, network);
  if (position.currentServiceId === position.config.targetServiceId) return true;
  const next = hint.directions.find((option) => option.direction === position.direction);
  const here = targetHopDistances(network, position.config.targetServiceId).get(position.currentStationId) ?? Infinity;
  return next !== undefined && next.targetHops < here;
}

/** Preview the nearest target stop and fixed boarding direction, without moving. */
export function deadheadDestination(position: ItemOptionPosition, network: RailwayNetwork): RelocationOutcome {
  const nearest = nearestTargetStation(network, position.config.targetServiceId, position.currentStationId);
  return {
    fromStationId: position.currentStationId,
    toStationId: nearest.stationId,
    serviceId: position.config.targetServiceId,
    direction: position.config.targetDirection,
    distance: nearest.distance,
  };
}
