import type { RailwayNetwork } from "./engine";
import type { PresentationResolver } from "./presentationResolver";

export interface CollectionVisit {
  readonly traversedSegmentIds: readonly string[]; readonly relocationDestinationId?: string;
}
export interface CollectionProgress {
  readonly visitedStations: number; readonly totalStations: number;
  readonly riddenLines: number; readonly totalLines: number;
  readonly stationsText: string; readonly linesText: string;
}

export function deriveCollectionProgress(
  startStationId: string,
  visits: readonly CollectionVisit[],
  network: RailwayNetwork,
  presentation: PresentationResolver,
): CollectionProgress {
  const visitedStationIds = new Set([startStationId]);
  const riddenLineGroupIds = new Set<string>();

  for (const visit of visits) {
    for (const segmentId of visit.traversedSegmentIds) {
      const segment = network.segmentsById.get(segmentId);
      if (!segment) continue;
      visitedStationIds.add(segment.from);
      visitedStationIds.add(segment.to);
      riddenLineGroupIds.add(presentation.lineGroupId(segment.serviceId));
    }
    if (visit.relocationDestinationId !== undefined) {
      visitedStationIds.add(visit.relocationDestinationId);
    }
  }

  const visitedStations = visitedStationIds.size;
  const totalStations = network.stationsById.size;
  const riddenLines = riddenLineGroupIds.size;
  const totalLines = presentation.lineGroups().length;
  const stationsText = `訪れた駅 ${visitedStations.toLocaleString("ja-JP")}/${totalStations.toLocaleString("ja-JP")}`;
  const linesText = `乗った路線 ${riddenLines.toLocaleString("ja-JP")}/${totalLines.toLocaleString("ja-JP")}`;

  return { visitedStations, totalStations, riddenLines, totalLines, stationsText, linesText };
}
