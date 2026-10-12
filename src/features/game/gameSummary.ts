import type { EndpointKind, GameState, MoveRecord } from "../../types/network";
import type { RailwayNetwork } from "./engine";

export interface GameSummary {
  turns: number;
  /** Station-to-station hops actually travelled (unused pips excluded). */
  moves: number;
  transfers: number;
}

export function summarizeGame(game: GameState): GameSummary {
  const moves = game.movementHistory.reduce(
    (total, record) => total + record.traversedSegmentIds.length,
    0,
  );
  const transfers = game.movementHistory.filter((record) => record.landing && record.landing.serviceId !== record.serviceId).length;
  return { turns: game.turn, moves, transfers };
}

/** Endpoint kind belongs to the ridden service, even if the landing transfers away. */
export function endpointKindAt(network: RailwayNetwork, serviceId: string, stationId: string): EndpointKind | null {
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
  const kind = record.stopReason === "endpoint" && endpointKind ? `〔${endpointKind === "terminus" ? "終点" : "エリア端"}〕` : "";
  return `${stationName(record.toStationId)}で停止${kind}、残り${unused}`;
}
