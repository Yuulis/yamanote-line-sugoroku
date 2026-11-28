import type {
  Direction,
  GameState,
  HarmfulItemKind,
  ItemGameState,
  ItemKind,
  ItemTurnRecord,
  LandingChoice,
  MoveRecord,
  StationId,
} from "../../types/network";
import type { Position } from "../../types/data";
import type { EditionDisplay } from "../editions/types";
import type { GeometryIndex, StepPath } from "./animation/movePath";
import { buildClearRoute } from "./clearRoute";
import { buildShareText } from "./shareText";
import { summarizeGame, type GameSummary } from "./gameSummary";
import { findSegment, nextStationId, type RailwayNetwork } from "./engine";
import type { SegmentTraversedEvent } from "./engine/types";
import type { PresentationResolver } from "./presentationResolver";

export interface ClearResultInput {
  readonly game: GameState | ItemGameState;
  readonly network: RailwayNetwork;
  readonly geometry: GeometryIndex;
  readonly presentation: PresentationResolver;
  readonly display: EditionDisplay;
}

export type SavedMove = MoveRecord | ItemTurnRecord;

export interface ClearHop {
  readonly recordIndex: number;
  readonly hopIndex: number;
  readonly event: SegmentTraversedEvent;
  readonly lineGroupId: string;
  readonly color: string;
}

export type ClearRecordTraversal =
  | {
      readonly kind: "ride";
      readonly recordIndex: number;
      readonly toStationId: string;
      readonly ride: LandingChoice;
      readonly landing: LandingChoice | null;
      readonly hops: readonly ClearHop[];
    }
  | { readonly kind: "deadhead"; readonly recordIndex: number; readonly toStationId: string }
  | { readonly kind: "invalid" };

export interface ClearRouteLeg {
  readonly firstStepIndex: number;
  readonly endStepIndexExclusive: number;
  readonly serviceId: string;
  readonly lineGroupId: string;
  readonly color: string;
}

export interface ClearTurnSpan {
  readonly recordIndex: number;
  /** Half-open range of route steps drawn during this saved turn; empty for deadheads and zero-hop rides. */
  readonly firstStepIndex: number;
  readonly endStepIndexExclusive: number;
  /** Coordinate of the saved turn's destination station when it resolves in the network. */
  readonly destination?: Position;
}

export interface ClearRoute {
  readonly steps: readonly StepPath[];
  readonly legs: readonly ClearRouteLeg[];
  readonly turnSpans: readonly ClearTurnSpan[];
  readonly bounds: readonly [southWest: Position, northEast: Position];
}

export interface ClearHighlights {
  readonly longestRide: {
    readonly groupId: string;
    readonly count: number;
    readonly fromStationId: string;
    readonly toStationId: string;
  } | null;
  readonly mostUsedLine: { readonly groupId: string; readonly count: number } | null;
  readonly farthestStation: { readonly stationId: string; readonly distanceKm: number } | null;
  readonly usedItems: ReadonlyMap<ItemKind, number>;
  readonly avoidedItems: ReadonlyMap<HarmfulItemKind, number>;
}

export interface ClearResult {
  readonly summary: GameSummary;
  readonly shareText: string;
  readonly highlights: ClearHighlights;
  readonly route: ClearRoute | null;
}

function isDirection(value: unknown): value is Direction {
  return value === 1 || value === -1;
}

function isLandingChoice(value: LandingChoice | null, stationId: StationId, input: ClearResultInput): boolean {
  if (value === null) return true;
  return input.network.servicesById.has(value.serviceId) && isDirection(value.direction) &&
    nextStationId(input.network, value.serviceId, stationId, value.direction) !== undefined;
}

function isSavedRide(record: SavedMove): record is MoveRecord | Extract<ItemTurnRecord, { kind: "item-ride" }> {
  if ("kind" in record) return record.kind === "item-ride";
  return true;
}

function invalidTraversal(): ClearRecordTraversal {
  return { kind: "invalid" };
}

function mapDeadheadRecord(
  record: Extract<ItemTurnRecord, { kind: "deadhead" }>,
  recordIndex: number,
  expectedFromStationId: string,
  input: ClearResultInput,
): ClearRecordTraversal {
  const relocation = record.relocation;
  if (record.fromStationId !== expectedFromStationId || !input.network.stationsById.has(record.fromStationId) ||
    !input.network.stationsById.has(record.toStationId) || record.traversedSegmentIds.length !== 0 ||
    record.physicalHops !== 0 || !relocation || relocation.fromStationId !== record.fromStationId ||
    relocation.toStationId !== record.toStationId || !input.network.servicesById.has(relocation.serviceId) ||
    !isDirection(relocation.direction)) return invalidTraversal();
  return { kind: "deadhead", recordIndex, toStationId: record.toStationId };
}

/** Map one saved record only after verifying its complete station and directed-segment chain. */
export function mapSavedRecord(
  record: SavedMove,
  recordIndex: number,
  expectedFromStationId: string,
  input: ClearResultInput,
): ClearRecordTraversal {
  if ("kind" in record && record.kind === "deadhead") {
    return mapDeadheadRecord(record, recordIndex, expectedFromStationId, input);
  }
  if (!isSavedRide(record)) return invalidTraversal();

  const ride: LandingChoice = "kind" in record
    ? record.resolvedRide
    : { serviceId: record.serviceId, direction: record.direction };
  if (record.fromStationId !== expectedFromStationId || !input.network.stationsById.has(record.fromStationId) ||
    !input.network.stationsById.has(record.toStationId) || !input.network.servicesById.has(ride.serviceId) ||
    !isDirection(ride.direction) || nextStationId(input.network, ride.serviceId, record.fromStationId, ride.direction) === undefined ||
    !isLandingChoice(record.landing, record.toStationId, input)) return invalidTraversal();

  const hops: ClearHop[] = [];
  let currentStationId = record.fromStationId;
  for (const [hopIndex, savedSegmentId] of record.traversedSegmentIds.entries()) {
    const next = nextStationId(input.network, ride.serviceId, currentStationId, ride.direction);
    if (!next) return invalidTraversal();
    const segment = findSegment(input.network, ride.serviceId, currentStationId, next);
    if (!segment || segment.id !== savedSegmentId) return invalidTraversal();
    const event: SegmentTraversedEvent = {
      type: "segment-traversed",
      step: hopIndex + 1,
      serviceId: ride.serviceId,
      direction: ride.direction,
      segmentId: savedSegmentId,
      fromStationId: currentStationId,
      toStationId: next,
      newlyCompleted: false,
    };
    hops.push({
      recordIndex,
      hopIndex,
      event,
      lineGroupId: input.presentation.lineGroupId(ride.serviceId),
      color: input.presentation.lineGroupColor(ride.serviceId) ?? input.network.servicesById.get(ride.serviceId)!.color,
    });
    currentStationId = next;
  }
  if (currentStationId !== record.toStationId ||
    (record.traversedSegmentIds.length === 0 && record.fromStationId !== record.toStationId)) return invalidTraversal();

  return { kind: "ride", recordIndex, toStationId: record.toStationId, ride, landing: record.landing, hops };
}

interface RideStreak {
  readonly groupId: string;
  readonly count: number;
  readonly fromStationId: string;
  readonly toStationId: string;
}

function deriveRideHighlights(
  traversals: readonly ClearRecordTraversal[],
  input: ClearResultInput,
): { longestRide: ClearHighlights["longestRide"]; mostUsedLine: ClearHighlights["mostUsedLine"] } {
  const counts = new Map<string, number>();
  const candidateOrder: string[] = [];
  const targetGroupId = input.presentation.lineGroupId(input.game.config.targetServiceId);
  let currentStreak: RideStreak | null = null;
  let longestRide: ClearHighlights["longestRide"] = null;

  for (const traversal of traversals) {
    if (traversal.kind !== "ride") {
      currentStreak = null;
      continue;
    }
    const rideGroupId = input.presentation.lineGroupId(traversal.ride.serviceId);
    if (currentStreak && currentStreak.groupId !== rideGroupId) currentStreak = null;
    for (const hop of traversal.hops) {
      const previous = currentStreak;
      const next: RideStreak = {
        groupId: hop.lineGroupId,
        count: (previous?.groupId === hop.lineGroupId ? previous.count : 0) + 1,
        fromStationId: previous?.groupId === hop.lineGroupId ? previous.fromStationId : hop.event.fromStationId,
        toStationId: hop.event.toStationId,
      };
      currentStreak = next;
      if (!longestRide || next.count > longestRide.count) longestRide = next;
      if (hop.lineGroupId !== targetGroupId) {
        if (!counts.has(hop.lineGroupId)) candidateOrder.push(hop.lineGroupId);
        counts.set(hop.lineGroupId, (counts.get(hop.lineGroupId) ?? 0) + 1);
      }
    }
    if (traversal.landing && input.presentation.lineGroupId(traversal.landing.serviceId) !== rideGroupId) {
      currentStreak = null;
    }
  }

  let mostUsedLine: ClearHighlights["mostUsedLine"] = null;
  for (const groupId of candidateOrder) {
    const count = counts.get(groupId) ?? 0;
    if (!mostUsedLine || count > mostUsedLine.count) mostUsedLine = { groupId, count };
  }
  return { longestRide, mostUsedLine };
}

function validCoordinates(position: Position): boolean {
  return Number.isFinite(position[0]) && Number.isFinite(position[1]) &&
    position[0] >= -180 && position[0] <= 180 && position[1] >= -90 && position[1] <= 90;
}

function greatCircleDistanceKm(first: Position, second: Position): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (second[1] - first[1]) * radians;
  const longitudeDelta = (second[0] - first[0]) * radians;
  const firstLatitude = first[1] * radians;
  const secondLatitude = second[1] * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(firstLatitude) * Math.cos(secondLatitude) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function addStationCandidate(
  stationId: string,
  input: ClearResultInput,
  visited: Set<string>,
  candidates: { stationId: string; coordinates: Position }[],
): void {
  if (visited.has(stationId)) return;
  visited.add(stationId);
  const station = input.network.stationsById.get(stationId);
  if (station && validCoordinates(station.coordinates)) candidates.push({ stationId, coordinates: station.coordinates });
}

function farthestStation(
  traversals: readonly ClearRecordTraversal[],
  input: ClearResultInput,
): ClearHighlights["farthestStation"] {
  const start = input.network.stationsById.get(input.game.config.startStationId);
  if (!start || !validCoordinates(start.coordinates)) return null;
  const visited = new Set<string>();
  const candidates: { stationId: string; coordinates: Position }[] = [];
  addStationCandidate(input.game.config.startStationId, input, visited, candidates);
  for (const traversal of traversals) {
    if (traversal.kind === "deadhead") {
      addStationCandidate(traversal.toStationId, input, visited, candidates);
      continue;
    }
    if (traversal.kind === "invalid") continue;
    for (const hop of traversal.hops) {
      addStationCandidate(hop.event.fromStationId, input, visited, candidates);
      addStationCandidate(hop.event.toStationId, input, visited, candidates);
    }
  }

  let farthest: { stationId: string; distanceKm: number } | null = null;
  for (const candidate of candidates) {
    const distanceKm = greatCircleDistanceKm(start.coordinates, candidate.coordinates);
    if (!farthest || distanceKm > farthest.distanceKm) farthest = { stationId: candidate.stationId, distanceKm };
  }
  return farthest ? { stationId: farthest.stationId, distanceKm: Math.round(farthest.distanceKm * 10) / 10 } : null;
}

function itemHighlights(game: GameState | ItemGameState): Pick<ClearHighlights, "usedItems" | "avoidedItems"> {
  const usedItems = new Map<ItemKind, number>();
  const avoidedItems = new Map<HarmfulItemKind, number>();
  const consumedInstanceIds = new Set<string>();
  for (const record of game.movementHistory) {
    if (!("kind" in record)) continue;
    for (const event of record.itemEvents) {
      if (event.type === "consumed") {
        if (consumedInstanceIds.has(event.item.id)) continue;
        consumedInstanceIds.add(event.item.id);
        usedItems.set(event.item.kind, (usedItems.get(event.item.kind) ?? 0) + 1);
      } else if (event.type === "cancelled-by-certificate") {
        if (!consumedInstanceIds.has(event.certificate.id)) {
          consumedInstanceIds.add(event.certificate.id);
          usedItems.set(event.certificate.kind, (usedItems.get(event.certificate.kind) ?? 0) + 1);
        }
        avoidedItems.set(event.item, (avoidedItems.get(event.item) ?? 0) + 1);
      }
    }
  }
  return { usedItems, avoidedItems };
}

function recordArrivalStation(record: SavedMove): string | null {
  return typeof record.toStationId === "string" ? record.toStationId : null;
}

/** Derive all S1 result data from persisted records without consulting live game state. */
export function deriveClearResult(input: ClearResultInput): ClearResult {
  const traversals: ClearRecordTraversal[] = [];
  let expectedFromStationId = input.game.config.startStationId;
  for (const [recordIndex, record] of input.game.movementHistory.entries()) {
    const traversal = mapSavedRecord(record, recordIndex, expectedFromStationId, input);
    traversals.push(traversal);
    expectedFromStationId = recordArrivalStation(record) ?? expectedFromStationId;
  }

  const rideHighlights = deriveRideHighlights(traversals, input);
  const items = itemHighlights(input.game);
  const summary = summarizeGame(input.game, input.presentation);
  return {
    summary,
    shareText: buildShareText(input.display, summary),
    highlights: {
      ...rideHighlights,
      farthestStation: farthestStation(traversals, input),
      ...items,
    },
    route: buildClearRoute(traversals, input.network, input.geometry,
      (serviceId) => input.presentation.lineGroupId(serviceId)),
  };
}
