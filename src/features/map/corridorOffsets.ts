import type { Position, SegmentFeature, SegmentFeatureProperties } from "../../types/data";

export type CorridorRenderFeature = Omit<SegmentFeature, "properties"> & {
  properties: SegmentFeatureProperties & { readonly corridorSlot: number };
};

export interface CorridorRenderCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly CorridorRenderFeature[];
}

type NodeId = number;

interface EdgeTraversal {
  readonly featureIndex: number;
  readonly edgeIndex: number;
  readonly fromNode: NodeId;
  readonly toNode: NodeId;
}

interface IndexedEdge {
  readonly id: number;
  readonly startNode: NodeId;
  readonly endNode: NodeId;
  readonly firstOwner: string;
  additionalOwners?: Set<string>;
  ownerIds?: readonly string[];
  traversals: EdgeTraversal | EdgeTraversal[];
  slots?: ReadonlyMap<string, number>;
  orientedFrom?: NodeId;
  orientedTo?: NodeId;
}

interface VertexIndex {
  readonly positions: Position[];
  idFor(position: Position): NodeId;
}

interface FragmentState {
  readonly shared: boolean;
  readonly slot: number;
  readonly direction: 1 | -1;
  readonly firstEdgeIndex: number;
  lastEdgeIndex: number;
}

interface DfsFrame {
  readonly node: NodeId;
  readonly parentEdgeId: number;
  nextIncidentIndex: number;
}

function compareText(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function comparePosition(first: Position, second: Position): number {
  return first[0] - second[0] || first[1] - second[1];
}

function compareFeatures(first: SegmentFeature, second: SegmentFeature): number {
  const firstProperties = first.properties;
  const secondProperties = second.properties;
  return compareText(firstProperties.serviceId, secondProperties.serviceId)
    || compareText(firstProperties.featureId, secondProperties.featureId)
    || compareText(String(first.id), String(second.id))
    || compareText(firstProperties.lineId, secondProperties.lineId)
    || compareText(firstProperties.from, secondProperties.from)
    || compareText(firstProperties.to, secondProperties.to)
    || compareText(
      JSON.stringify(first.geometry.coordinates),
      JSON.stringify(second.geometry.coordinates),
    );
}

function sortFeatures(features: readonly SegmentFeature[]): SegmentFeature[] {
  return [...features].sort(compareFeatures);
}

function createVertexIndex(): VertexIndex {
  const positions: Position[] = [];
  const longitudeIds = new Map<number, Map<number, NodeId>>();
  return {
    positions,
    idFor(position) {
      const [longitude, latitude] = position;
      let latitudeIds = longitudeIds.get(longitude);
      if (!latitudeIds) {
        latitudeIds = new Map<number, NodeId>();
        longitudeIds.set(longitude, latitudeIds);
      }
      const existing = latitudeIds.get(latitude);
      if (existing !== undefined) return existing;
      const id = positions.length;
      positions.push(position);
      latitudeIds.set(latitude, id);
      return id;
    },
  };
}

function appendTraversal(edge: IndexedEdge, traversal: EdgeTraversal, owner: string): void {
  if (Array.isArray(edge.traversals)) edge.traversals.push(traversal);
  else edge.traversals = [edge.traversals, traversal];

  if (owner === edge.firstOwner) return;
  const additionalOwners = edge.additionalOwners ?? new Set<string>();
  additionalOwners.add(owner);
  edge.additionalOwners = additionalOwners;
}

function getTraversals(edge: IndexedEdge): readonly EdgeTraversal[] {
  return Array.isArray(edge.traversals) ? edge.traversals : [edge.traversals];
}

function indexEdges(
  features: readonly SegmentFeature[],
  vertexIndex: VertexIndex,
): IndexedEdge[] {
  const edges: IndexedEdge[] = [];
  const edgesByStart = new Map<NodeId, Map<NodeId, IndexedEdge>>();
  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const feature = features[featureIndex];
    if (!feature) continue;
    const coordinates = feature.geometry.coordinates;
    if (coordinates.length < 2) continue;

    let fromNode = vertexIndex.idFor(coordinates[0]!);
    for (let edgeIndex = 0; edgeIndex < coordinates.length - 1; edgeIndex += 1) {
      const toNode = vertexIndex.idFor(coordinates[edgeIndex + 1]!);
      if (fromNode !== toNode) {
        const startId = Math.min(fromNode, toNode);
        const endId = Math.max(fromNode, toNode);
        let edgesByEnd = edgesByStart.get(startId);
        if (!edgesByEnd) {
          edgesByEnd = new Map<NodeId, IndexedEdge>();
          edgesByStart.set(startId, edgesByEnd);
        }

        let edge = edgesByEnd.get(endId);
        const traversal = { featureIndex, edgeIndex, fromNode, toNode };
        if (!edge) {
          edge = {
            id: edges.length,
            startNode: comparePosition(vertexIndex.positions[fromNode]!, vertexIndex.positions[toNode]!) <= 0
              ? fromNode
              : toNode,
            endNode: comparePosition(vertexIndex.positions[fromNode]!, vertexIndex.positions[toNode]!) <= 0
              ? toNode
              : fromNode,
            firstOwner: feature.properties.serviceId,
            traversals: traversal,
          };
          edges.push(edge);
          edgesByEnd.set(endId, edge);
        } else {
          appendTraversal(edge, traversal, feature.properties.serviceId);
        }
      }
      fromNode = toNode;
    }
  }
  return edges;
}

function compareNodeIds(first: NodeId, second: NodeId, positions: readonly Position[]): number {
  return comparePosition(positions[first]!, positions[second]!);
}

function compareEdgeIds(
  firstId: number,
  secondId: number,
  edges: readonly IndexedEdge[],
  positions: readonly Position[],
): number {
  const first = edges[firstId]!;
  const second = edges[secondId]!;
  return compareNodeIds(first.startNode, second.startNode, positions)
    || compareNodeIds(first.endNode, second.endNode, positions)
    || first.id - second.id;
}

function centredSlots(serviceIds: readonly string[]): Map<string, number> {
  if (serviceIds.length > 1 && serviceIds.length % 2 === 1) {
    const slots = new Map<string, number>([[serviceIds[0]!, 0]]);
    let magnitude = 1;
    for (let index = 1; index < serviceIds.length; index += 1) {
      const direction = index % 2 === 1 ? -1 : 1;
      slots.set(serviceIds[index]!, direction * magnitude);
      if (index % 2 === 0) magnitude += 1;
    }
    return slots;
  }
  const firstSlot = -(serviceIds.length - 1) / 2;
  const slots = new Map<string, number>();
  for (let index = 0; index < serviceIds.length; index += 1) {
    slots.set(serviceIds[index]!, firstSlot + index);
  }
  return slots;
}

function sameOwners(first: readonly string[], second: readonly string[]): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function assignEdgeSlots(
  edge: IndexedEdge,
  parentEdge: IndexedEdge | undefined,
  targetServiceId: string,
): ReadonlyMap<string, number> {
  const serviceIds = edge.ownerIds!;
  const parentSlots = parentEdge?.slots;
  if (parentSlots && sameOwners(serviceIds, parentEdge?.ownerIds ?? [])) return parentSlots;

  const targetIsPresent = edge.additionalOwners?.has(targetServiceId) === true
    || edge.firstOwner === targetServiceId;
  const assigned = new Map<string, number>();
  const usedSlots = new Set<number>();
  if (targetIsPresent) {
    assigned.set(targetServiceId, 0);
    usedSlots.add(0);
  }

  for (const serviceId of serviceIds) {
    if (serviceId === targetServiceId) continue;
    const previousSlot = parentSlots?.get(serviceId);
    if (previousSlot === undefined || usedSlots.has(previousSlot) || (targetIsPresent && previousSlot === 0)) continue;
    assigned.set(serviceId, previousSlot);
    usedSlots.add(previousSlot);
  }

  if (!targetIsPresent && assigned.size === 0) return centredSlots(serviceIds);

  const parentValues = parentSlots
    ? [...new Set(parentSlots.values())].sort((first, second) => Math.abs(first) - Math.abs(second) || first - second)
    : [];
  let previousValueIndex = 0;
  let generatedIndex = 0;
  let zeroAvailable = !targetIsPresent;
  const generatedLimit = (serviceIds.length - assigned.size) * 2 + 2;
  const nextFreeSlot = (): number | undefined => {
    while (previousValueIndex < parentValues.length) {
      const candidate = parentValues[previousValueIndex]!;
      previousValueIndex += 1;
      if (!usedSlots.has(candidate) && (!targetIsPresent || candidate !== 0)) return candidate;
    }
    while (generatedIndex < generatedLimit) {
      const index = generatedIndex;
      generatedIndex += 1;
      const magnitude = targetIsPresent ? Math.ceil((index + 1) / 2) : (index + 1) / 2;
      const candidate = index % 2 === 0 ? -magnitude : magnitude;
      if (!usedSlots.has(candidate)) return candidate;
    }
    if (zeroAvailable) {
      zeroAvailable = false;
      if (!usedSlots.has(0)) return 0;
    }
    // Continuing services can hold every bounded candidate; keep widening until a free slot appears
    // so an entering service never falls back to the target's 0. usedSlots is finite, so this ends.
    for (;;) {
      const index = generatedIndex;
      generatedIndex += 1;
      const magnitude = targetIsPresent ? Math.ceil((index + 1) / 2) : (index + 1) / 2;
      const candidate = index % 2 === 0 ? -magnitude : magnitude;
      if (!usedSlots.has(candidate) && (!targetIsPresent || candidate !== 0)) return candidate;
    }
  };

  for (const serviceId of serviceIds) {
    if (assigned.has(serviceId)) continue;
    const slot = nextFreeSlot();
    if (slot === undefined) continue;
    assigned.set(serviceId, slot);
    usedSlots.add(slot);
  }
  return assigned;
}

function sharedEdgeOwners(edge: IndexedEdge): readonly string[] {
  const ownerIds = [edge.firstOwner, ...(edge.additionalOwners ?? [])];
  ownerIds.sort(compareText);
  return ownerIds;
}

function assignSharedEdges(
  edges: readonly IndexedEdge[],
  featureEdgeIds: readonly Int32Array[],
  featureDirections: readonly Int8Array[],
  targetServiceId: string,
  positions: readonly Position[],
): void {
  // Only shared-edge endpoints get an incident list; most vertices are never visited.
  const adjacency = new Map<NodeId, number[]>();
  const addIncident = (node: NodeId, edgeId: number): void => {
    const incident = adjacency.get(node);
    if (incident) incident.push(edgeId);
    else adjacency.set(node, [edgeId]);
  };
  for (const edge of edges) {
    if (!edge.additionalOwners?.size) continue;
    edge.ownerIds = sharedEdgeOwners(edge);
    addIncident(edge.startNode, edge.id);
    addIncident(edge.endNode, edge.id);
  }
  for (const incident of adjacency.values()) {
    incident.sort((first, second) => compareEdgeIds(first, second, edges, positions));
  }

  const nodeOrder: NodeId[] = [...adjacency.keys()];
  nodeOrder.sort((first, second) => compareNodeIds(first, second, positions));
  const visitedNodes = new Uint8Array(positions.length);
  const visitedEdges = new Uint8Array(edges.length);

  const walkFrom = (root: NodeId): void => {
    visitedNodes[root] = 1;
    const stack: DfsFrame[] = [{ node: root, parentEdgeId: -1, nextIncidentIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const incident = adjacency.get(frame.node)!;
      if (frame.nextIncidentIndex >= incident.length) {
        stack.pop();
        continue;
      }

      const edgeId = incident[frame.nextIncidentIndex]!;
      frame.nextIncidentIndex += 1;
      if (visitedEdges[edgeId]) continue;
      visitedEdges[edgeId] = 1;

      const edge = edges[edgeId]!;
      const nextNode = edge.startNode === frame.node ? edge.endNode : edge.startNode;
      edge.orientedFrom = frame.node;
      edge.orientedTo = nextNode;
      const parentEdge = frame.parentEdgeId >= 0 ? edges[frame.parentEdgeId] : undefined;
      edge.slots = assignEdgeSlots(edge, parentEdge, targetServiceId);

      for (const traversal of getTraversals(edge)) {
        featureEdgeIds[traversal.featureIndex]![traversal.edgeIndex] = edge.id;
        featureDirections[traversal.featureIndex]![traversal.edgeIndex] =
          traversal.fromNode === frame.node && traversal.toNode === nextNode ? 1 : -1;
      }

      if (!visitedNodes[nextNode]) {
        visitedNodes[nextNode] = 1;
        stack.push({ node: nextNode, parentEdgeId: edge.id, nextIncidentIndex: 0 });
      }
    }
  };

  for (const node of nodeOrder) {
    if (adjacency.get(node)!.length === 1 && !visitedNodes[node]) walkFrom(node);
  }
  for (const node of nodeOrder) {
    if (adjacency.get(node)!.length > 2 && !visitedNodes[node]) walkFrom(node);
  }
  for (const node of nodeOrder) {
    if (adjacency.get(node)!.some((edgeId) => !visitedEdges[edgeId])) walkFrom(node);
  }
}

function copyFragmentCoordinates(
  coordinates: readonly Position[],
  firstEdgeIndex: number,
  lastEdgeIndex: number,
  direction: 1 | -1,
): Position[] {
  const fragment: Position[] = [];
  if (direction === 1) {
    for (let index = firstEdgeIndex; index <= lastEdgeIndex + 1; index += 1) {
      const [longitude, latitude] = coordinates[index]!;
      fragment.push([longitude, latitude]);
    }
  } else {
    for (let index = lastEdgeIndex + 1; index >= firstEdgeIndex; index -= 1) {
      const [longitude, latitude] = coordinates[index]!;
      fragment.push([longitude, latitude]);
    }
  }
  return fragment;
}

function appendFragment(
  output: CorridorRenderFeature[],
  source: SegmentFeature,
  coordinates: Position[],
  corridorSlot: number,
): void {
  output.push({
    ...source,
    id: "corridor-offset-" + output.length,
    properties: { ...source.properties, corridorSlot },
    geometry: { type: "LineString", coordinates },
  });
}

function emitFeatureFragments(
  source: SegmentFeature,
  featureIndex: number,
  featureEdgeIds: readonly Int32Array[],
  featureDirections: readonly Int8Array[],
  edges: readonly IndexedEdge[],
  output: CorridorRenderFeature[],
): void {
  const coordinates = source.geometry.coordinates;
  if (coordinates.length < 2) {
    const copied: Position[] = [];
    for (const [longitude, latitude] of coordinates) copied.push([longitude, latitude]);
    appendFragment(output, source, copied, 0);
    return;
  }

  const edgeIds = featureEdgeIds[featureIndex]!;
  const directions = featureDirections[featureIndex]!;
  const serviceId = source.properties.serviceId;
  let fragment: FragmentState | null = null;
  const flushFragment = (): void => {
    if (!fragment) return;
    appendFragment(
      output,
      source,
      copyFragmentCoordinates(coordinates, fragment.firstEdgeIndex, fragment.lastEdgeIndex, fragment.direction),
      fragment.shared ? fragment.slot : 0,
    );
    fragment = null;
  };

  for (let edgeIndex = 0; edgeIndex < edgeIds.length; edgeIndex += 1) {
    const edgeId = edgeIds[edgeIndex]!;
    const shared = edgeId >= 0;
    const edge = shared ? edges[edgeId] : undefined;
    const slot = edge?.slots?.get(serviceId) ?? 0;
    const direction: 1 | -1 = shared && directions[edgeIndex] === -1 ? -1 : 1;
    if (!fragment) {
      fragment = { shared, slot, direction, firstEdgeIndex: edgeIndex, lastEdgeIndex: edgeIndex };
      continue;
    }
    if (fragment.shared === shared && fragment.slot === slot && fragment.direction === direction) {
      fragment.lastEdgeIndex = edgeIndex;
      continue;
    }
    flushFragment();
    fragment = { shared, slot, direction, firstEdgeIndex: edgeIndex, lastEdgeIndex: edgeIndex };
  }
  flushFragment();
}

/** Build immutable, render-only fragments with stable slots for exactly shared edges. */
export function buildCorridorOffsets(
  geometry: Readonly<{ type: "FeatureCollection"; features: readonly SegmentFeature[] }>,
  targetServiceId: string,
): CorridorRenderCollection {
  const sourceFeatures = sortFeatures(geometry.features);
  const vertexIndex = createVertexIndex();
  const edges = indexEdges(sourceFeatures, vertexIndex);
  const featureEdgeIds = sourceFeatures.map((source) =>
    new Int32Array(Math.max(0, source.geometry.coordinates.length - 1)).fill(-1));
  const featureDirections = sourceFeatures.map((source) =>
    new Int8Array(Math.max(0, source.geometry.coordinates.length - 1)));
  assignSharedEdges(edges, featureEdgeIds, featureDirections, targetServiceId, vertexIndex.positions);

  const output: CorridorRenderFeature[] = [];
  for (let featureIndex = 0; featureIndex < sourceFeatures.length; featureIndex += 1) {
    const source = sourceFeatures[featureIndex];
    if (source) {
      emitFeatureFragments(source, featureIndex, featureEdgeIds, featureDirections, edges, output);
    }
  }
  return { type: "FeatureCollection", features: output };
}
