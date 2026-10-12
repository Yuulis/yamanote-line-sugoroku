// Pure text and presentation rules. The already-committed lottery is revealed
// only after the accepted animation finish; these helpers never draw randomness.
import type { Direction } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import type { GameSession, LastMove } from "./gameSession";

export function stationName(network: RailwayNetwork, stationId: string): string {
  return network.stationsById.get(stationId)?.name ?? stationId;
}

export function serviceName(network: RailwayNetwork, serviceId: string): string {
  return network.servicesById.get(serviceId)?.name ?? serviceId;
}

export function directionLabel(network: RailwayNetwork, serviceId: string, direction: Direction): string {
  const labels = network.servicesById.get(serviceId)?.directionLabels;
  return (direction === 1 ? labels?.forward : labels?.backward) ?? String(direction);
}

export function displayedRide(session: GameSession): { serviceId: string; direction: Direction } {
  const { game, phase, lastMove } = session;
  return phase === "animating" && lastMove
    ? { serviceId: lastMove.serviceId, direction: lastMove.direction }
    : { serviceId: game.currentServiceId, direction: game.direction };
}

export function lastRollText(lastMove: LastMove | null, network: RailwayNetwork): string {
  if (!lastMove) return "—";
  if (lastMove.stopReason === "roll" || lastMove.unusedPips === 0) return String(lastMove.roll);
  const kind = lastMove.stopReason === "endpoint"
    ? `〔${lastMove.endpointKind === "terminus" ? "終点" : "エリア端"}〕`
    : "";
  return `${lastMove.roll}（${stationName(network, lastMove.stopStationId)}で停止${kind}、残り${lastMove.unusedPips}は使わず）`;
}

export function landingText(lastMove: LastMove | null, network: RailwayNetwork): string {
  const event = lastMove?.landing;
  if (!event || !lastMove) return "—";
  const service = serviceName(network, event.serviceId);
  const heading = event.serviceDrawRequired
    ? `${stationName(network, event.stationId)}：${event.serviceCandidates.map((id) => serviceName(network, id)).join("・")}から抽選 → ${service}`
    : `${service}のみ`;
  const direction = directionLabel(network, event.serviceId, event.direction);
  if (event.directionDrawRequired) return `${heading} ／ 方向抽選 → ${direction}`;
  const chosen = network.servicesById.get(event.serviceId);
  if (chosen?.circular && event.directionCandidates.length === 1) return `${heading} ／ ${direction}に固定`;
  if (!event.changedService && lastMove.endpointKind && event.direction !== lastMove.direction) {
    const kind = lastMove.endpointKind === "terminus" ? "終点" : "エリア端";
    return `${heading} ／ ${kind}のため折り返し（${direction}）`;
  }
  return `${heading} ／ 乗車方向は${direction}のみ`;
}
