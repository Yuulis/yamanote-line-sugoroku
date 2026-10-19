import type { UiLineGroup, UiPresentation, UiServiceStopName } from "../../types/data";
import type { RailwayNetwork } from "./engine";

export interface UiCandidateRow {
  groupId: string;
  name: string;
  label: string;
  serviceIds: string[];
}

/** Presentation lookup kept separate from the immutable gameplay network. */
export interface PresentationResolver {
  stationName(stationId: string): string;
  serviceStationName(serviceId: string, stationId: string): string;
  serviceName(serviceId: string): string;
  lineGroupId(serviceId: string): string;
  lineGroupColor(serviceId: string): string | undefined;
  lineGroups(): readonly UiLineGroup[];
  sameLineGroup(firstServiceId: string, secondServiceId: string): boolean;
  candidateRows(serviceIds: readonly string[]): UiCandidateRow[];
}

const JR_OPERATOR_ID = "東日本旅客鉄道";

function isAuditedSmallKeVariant(canonical: string, original: string): boolean {
  if (canonical.length !== original.length) return false;
  let changed = false;
  for (let index = 0; index < canonical.length; index += 1) {
    const current = canonical[index];
    const source = original[index];
    if (current === "ケ" && source === "ヶ") {
      changed = true;
      continue;
    }
    if (current !== source) return false;
  }
  return changed;
}

/** Build display lookups without changing service, station, or save identities. */
export function createPresentationResolver(
  network: RailwayNetwork,
  metadata?: UiPresentation,
): PresentationResolver {
  const stationAliases = new Map(
    (metadata?.stations ?? []).map(({ id, aliases }) => [id, aliases]),
  );
  const groupByService = new Map(
    (metadata?.lineGroups ?? []).flatMap((group) =>
      group.serviceIds.map((serviceId) => [serviceId, group] as const),
    ),
  );
  const stopNameByPair = new Map(
    (metadata?.serviceStopNames ?? []).map(({ serviceId, stationId, name }) => [
      JSON.stringify([serviceId, stationId]),
      name,
    ]),
  );
  const stopNamesByStation = new Map<string, UiServiceStopName[]>();
  for (const stop of metadata?.serviceStopNames ?? []) {
    const stationStops = stopNamesByStation.get(stop.stationId) ?? [];
    stationStops.push(stop);
    stopNamesByStation.set(stop.stationId, stationStops);
  }

  function stationNameParts(stationId: string): string[] {
    const station = network.stationsById.get(stationId);
    if (!station) return [stationId];

    const aliases = stationAliases.get(stationId) ?? [];
    const stationServices = network.servicesByStation.get(stationId) ?? [];
    const hasJrService = stationServices.some(
      (serviceId) => network.servicesById.get(serviceId)?.operator === JR_OPERATOR_ID,
    );
    const smallKeStopName = hasJrService
      ? undefined
      : (stopNamesByStation.get(stationId) ?? []).find((stop) =>
          stop.stationId === stationId &&
          isAuditedSmallKeVariant(station.name, stop.name) &&
          network.servicesById.get(stop.serviceId)?.operator !== JR_OPERATOR_ID,
        )?.name;

    const primary = smallKeStopName ?? station.name;
    const aliasNames = [
      ...aliases,
      ...(primary === station.name ? [] : [station.name]),
    ];
    return [...new Set([primary, ...aliasNames])];
  }

  function lineGroupId(serviceId: string): string {
    return groupByService.get(serviceId)?.id ?? serviceId;
  }

  function serviceName(serviceId: string): string {
    return groupByService.get(serviceId)?.name ?? network.servicesById.get(serviceId)?.name ?? serviceId;
  }

  function candidateRows(serviceIds: readonly string[]): UiCandidateRow[] {
    const rows = new Map<string, UiCandidateRow>();
    for (const serviceId of serviceIds) {
      const groupId = lineGroupId(serviceId);
      const row = rows.get(groupId);
      if (row) {
        if (!row.serviceIds.includes(serviceId)) row.serviceIds.push(serviceId);
        continue;
      }
      rows.set(groupId, {
        groupId,
        name: serviceName(serviceId),
        label: serviceName(serviceId),
        serviceIds: [serviceId],
      });
    }

    return [...rows.values()].map((row) => ({
      ...row,
      label: row.serviceIds.length > 1
        ? `${row.name}（抽選枠${row.serviceIds.length}）`
        : row.name,
    }));
  }

  return {
    stationName: (stationId) => stationNameParts(stationId).join("・"),
    serviceStationName: (serviceId, stationId) => {
      const stopName = stopNameByPair.get(JSON.stringify([serviceId, stationId]));
      return [...new Set([...stationNameParts(stationId), ...(stopName ? [stopName] : [])])].join("・");
    },
    serviceName,
    lineGroupId,
    lineGroupColor: (serviceId) => groupByService.get(serviceId)?.color,
    lineGroups: () => metadata?.lineGroups ?? [],
    sameLineGroup: (firstServiceId, secondServiceId) =>
      lineGroupId(firstServiceId) === lineGroupId(secondServiceId),
    candidateRows,
  };
}
