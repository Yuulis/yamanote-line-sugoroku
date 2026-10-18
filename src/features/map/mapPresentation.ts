import type { UiLineGroup, UiPresentation } from "../../types/data";
import type { LineMetadata, Segment, ServicePattern } from "../../types/network";
import { indexServiceGeometry } from "./serviceGeometry";

export interface MapPresentationIndex {
  lineGroups: readonly UiLineGroup[];
  groupIdsByOperator: ReadonlyMap<string, readonly string[]>;
  serviceIdsByGroup: ReadonlyMap<string, readonly string[]>;
  primitiveFeatureIdsByGroup: ReadonlyMap<string, readonly string[]>;
  primitiveFeatureIdsByService: ReadonlyMap<string, readonly string[]>;
  serviceIdsByStation: ReadonlyMap<string, readonly string[]>;
}

/** Resolve UI groups once, using audited presentation groups when available. */
export function buildMapPresentationGroups(
  services: readonly ServicePattern[],
  lines: readonly LineMetadata[],
  presentation?: UiPresentation | readonly UiLineGroup[],
): UiLineGroup[] {
  let configuredGroups: readonly UiLineGroup[] | undefined;
  if (presentation) {
    configuredGroups = Array.isArray(presentation)
      ? presentation as readonly UiLineGroup[]
      : (presentation as UiPresentation).lineGroups;
  }
  if (configuredGroups && configuredGroups.length > 0) return [...configuredGroups];

  const groups: UiLineGroup[] = [];
  const assignedServiceIds = new Set<string>();
  for (const line of lines) {
    const matchingServices = services.filter((service) => service.lineIds.includes(line.id));
    if (matchingServices.length === 0) continue;
    for (const service of matchingServices) assignedServiceIds.add(service.id);
    groups.push({
      id: line.id,
      name: matchingServices.length === 1 ? matchingServices[0]!.name : line.name,
      operatorId: matchingServices[0]!.operator,
      color: matchingServices.length === 1 ? matchingServices[0]!.color : line.color,
      serviceIds: matchingServices.map((service) => service.id),
    });
  }
  for (const service of services) {
    if (assignedServiceIds.has(service.id)) continue;
    groups.push({
      id: service.id,
      name: service.name,
      operatorId: service.operator,
      color: service.color,
      serviceIds: [service.id],
    });
  }
  return groups;
}

/** Build station, operator, UI group and primitive geometry indexes for one bundle. */
export function buildMapPresentationIndex(
  services: readonly ServicePattern[],
  segments: readonly Segment[],
  presentation?: UiPresentation | readonly UiLineGroup[],
  lines: readonly LineMetadata[] = [],
): MapPresentationIndex {
  const lineGroups = buildMapPresentationGroups(services, lines, presentation);
  const primitiveFeatureIdsByService = indexServiceGeometry(segments);
  const groupIdsByOperator = new Map<string, string[]>();
  const serviceIdsByGroup = new Map<string, readonly string[]>();
  const primitiveFeatureIdsByGroup = new Map<string, readonly string[]>();

  for (const group of lineGroups) {
    const operatorGroups = groupIdsByOperator.get(group.operatorId) ?? [];
    operatorGroups.push(group.id);
    groupIdsByOperator.set(group.operatorId, operatorGroups);
    serviceIdsByGroup.set(group.id, group.serviceIds);

    const featureIds = new Set<string>();
    for (const serviceId of group.serviceIds) {
      for (const featureId of primitiveFeatureIdsByService.get(serviceId) ?? []) {
        featureIds.add(featureId);
      }
    }
    primitiveFeatureIdsByGroup.set(group.id, [...featureIds]);
  }

  return {
    lineGroups,
    groupIdsByOperator,
    serviceIdsByGroup,
    primitiveFeatureIdsByGroup,
    primitiveFeatureIdsByService,
    serviceIdsByStation: stationServiceIndex(services),
  };
}

/** Return referenced primitive ids for selected groups; null means all are visible. */
export function visiblePrimitiveFeatureIds(
  index: MapPresentationIndex,
  selectedGroupIds: ReadonlySet<string> | null,
): string[] | null {
  if (selectedGroupIds === null || index.lineGroups.every((group) => selectedGroupIds.has(group.id))) {
    return null;
  }

  const featureIds = new Set<string>();
  for (const group of index.lineGroups) {
    if (!selectedGroupIds.has(group.id)) continue;
    for (const featureId of index.primitiveFeatureIdsByGroup.get(group.id) ?? []) {
      featureIds.add(featureId);
    }
  }
  return [...featureIds];
}

/** Build the map-side resolver network input without adding UI fields to engine records. */
export function stationServiceIndex(
  services: readonly ServicePattern[],
): ReadonlyMap<string, readonly string[]> {
  const byStation = new Map<string, string[]>();
  for (const service of services) {
    for (const stationId of service.stationIds) {
      const serviceIds = byStation.get(stationId) ?? [];
      if (!serviceIds.includes(service.id)) serviceIds.push(service.id);
      byStation.set(stationId, serviceIds);
    }
  }
  return byStation;
}

