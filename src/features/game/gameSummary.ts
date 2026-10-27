import type { EndpointKind, GameState, ItemGameState, MoveRecord } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import type { PresentationResolver } from "./presentationResolver";

/** Labels preserve the distinction between physical and catalogue endpoints. */
export function endpointKindLabel(kind: EndpointKind | null): string {
  if (kind === "terminus") return "終点";
  if (kind === "service-boundary") return "系統の端";
  return "エリア端";
}

export interface GameSummary {
  turns: number;
  /** Station-to-station hops actually travelled (unused pips excluded). */
  moves: number;
  transfers: number;
}

export function summarizeGame(game: GameState | ItemGameState, presentation?: PresentationResolver): GameSummary {
  const changedGroup = (from: string, to: string): number =>
    from !== to && !presentation?.sameLineGroup(from, to) ? 1 : 0;
  let moves = 0;
  let transfers = 0;
  let serviceId = game.config.targetServiceId;
  for (const record of game.movementHistory) {
    moves += record.traversedSegmentIds.length;
    if ("kind" in record) {
      const rideService = record.kind === "deadhead" ? record.relocation.serviceId : record.resolvedRide.serviceId;
      // A route ticket changes the ride before movement; deadhead changes it
      // during relocation. Both count even without an arrival lottery.
      transfers += changedGroup(serviceId, rideService);
      if (record.landing) transfers += changedGroup(rideService, record.landing.serviceId);
      serviceId = record.landing?.serviceId ?? rideService;
    } else {
      if (record.landing) transfers += changedGroup(record.serviceId, record.landing.serviceId);
      serviceId = record.landing?.serviceId ?? record.serviceId;
    }
  }
  return { turns: game.turn, moves, transfers };
}

/** Endpoint kind belongs to the ridden service, even if the landing transfers away. */
export function endpointKindAt(
  network: RailwayNetwork,
  serviceId: string,
  stationId: string,
): EndpointKind | null {
  const service = network.servicesById.get(serviceId);
  if (!service || service.circular) return null;
  if (stationId === service.stationIds[0]) return service.endpoints.first;
  if (stationId === service.stationIds.at(-1)) return service.endpoints.last;
  return null;
}

/** Pips the move did not use because it stopped early (goal or endpoint). */
export function unusedPipsOf(record: Pick<MoveRecord, "roll" | "traversedSegmentIds">): number {
  return record.roll - record.traversedSegmentIds.length;
}

/**
 * Note for a move that stopped early, e.g. `新橋で停止、残り3`; null when
 * every pip was used. `stationName` resolves the station the move stopped at.
 */
export function earlyStopNote(
  record: Pick<MoveRecord, "roll" | "traversedSegmentIds" | "stopReason" | "toStationId">,
  stationName: (stationId: string) => string,
  endpointKind: EndpointKind | null = null,
): string | null {
  const unused = unusedPipsOf(record);
  if (unused === 0 || record.stopReason === "roll") return null;
  const kind = record.stopReason === "endpoint" && endpointKind
    ? `〔${endpointKindLabel(endpointKind)}〕`
    : "";
  return `${stationName(record.toStationId)}で停止${kind}、残り${unused}`;
}
