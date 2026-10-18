// Pure text and presentation rules. The already-committed lottery is revealed
// only after the accepted animation finish; these helpers never draw randomness.
import type { Direction, MoveRecord } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import { endpointKindLabel } from "./gameSummary";
import type { GameSession, LastMove } from "./gameSession";
import type { PresentationResolver } from "./presentationResolver";

export function stationName(
  network: RailwayNetwork,
  stationId: string,
  presentation?: PresentationResolver,
): string {
  return presentation?.stationName(stationId) ?? network.stationsById.get(stationId)?.name ?? stationId;
}

export function serviceName(
  network: RailwayNetwork,
  serviceId: string,
  presentation?: PresentationResolver,
): string {
  return presentation?.serviceName(serviceId) ?? network.servicesById.get(serviceId)?.name ?? serviceId;
}

export function directionLabel(network: RailwayNetwork, serviceId: string, direction: Direction): string {
  const labels = network.servicesById.get(serviceId)?.directionLabels;
  return (direction === 1 ? labels?.forward : labels?.backward) ?? String(direction);
}

/** Describe an actual service change, while keeping same-group Oedo hops as direction changes. */
export function landingTransitionText(
  record: Pick<MoveRecord, "serviceId" | "direction" | "landing">,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string | null {
  const landing = record.landing;
  if (!landing || landing.serviceId === record.serviceId) return null;
  const nextService = serviceName(network, landing.serviceId, presentation);
  const nextDirection = directionLabel(network, landing.serviceId, landing.direction);
  if (presentation?.sameLineGroup(record.serviceId, landing.serviceId)) {
    return landing.direction === record.direction ? null : `${nextService}（方向変更: ${nextDirection}）`;
  }
  return `乗換: ${nextService}（${nextDirection}）`;
}

export function displayedRide(session: GameSession): { serviceId: string; direction: Direction } {
  const { game, phase, lastMove } = session;
  return phase === "animating" && lastMove
    ? { serviceId: lastMove.serviceId, direction: lastMove.direction }
    : { serviceId: game.currentServiceId, direction: game.direction };
}

export function lastRollText(
  lastMove: LastMove | null,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string {
  if (!lastMove) return "—";
  if (lastMove.stopReason === "roll" || lastMove.unusedPips === 0) return String(lastMove.roll);
  const kind = lastMove.stopReason === "endpoint"
    ? `〔${endpointKindLabel(lastMove.endpointKind)}〕`
    : "";
  const stopName = presentation?.serviceStationName(lastMove.serviceId, lastMove.stopStationId)
    ?? stationName(network, lastMove.stopStationId);
  return `${lastMove.roll}（${stopName}で停止${kind}、残り${lastMove.unusedPips}は使わず）`;
}

export const LOTTERY_INLINE_LIMIT = 4;

export function landingText(
  lastMove: LastMove | null,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string {
  const event = lastMove?.landing;
  if (!event || !lastMove) return "—";
  const service = serviceName(network, event.serviceId, presentation);
  const station = presentation?.serviceStationName(lastMove.serviceId, event.stationId)
    ?? stationName(network, event.stationId);
  const candidateRows = presentation?.candidateRows(event.serviceCandidates);
  const hasGroupedSlots = candidateRows?.some((row) => row.serviceIds.length > 1) ?? false;
  const candidates = event.serviceCandidates.length > LOTTERY_INLINE_LIMIT && !hasGroupedSlots
    ? `${event.serviceCandidates.length}系統`
    : (candidateRows?.map((row) => row.label)
      ?? event.serviceCandidates.map((id) => serviceName(network, id))).join("・");
  const heading = event.serviceDrawRequired
    ? `${station}：${candidates}から抽選 → ${service}`
    : `${service}のみ`;
  const direction = directionLabel(network, event.serviceId, event.direction);
  if (event.directionDrawRequired) return `${heading} ／ 方向抽選 → ${direction}`;
  const chosen = network.servicesById.get(event.serviceId);
  if (chosen?.circular && event.directionCandidates.length === 1) return `${heading} ／ ${direction}に固定`;
  if (!event.changedService && lastMove.endpointKind && event.direction !== lastMove.direction) {
    const kind = endpointKindLabel(lastMove.endpointKind);
    return `${heading} ／ ${kind}のため折り返し（${direction}）`;
  }
  return `${heading} ／ 乗車方向は${direction}のみ`;
}
