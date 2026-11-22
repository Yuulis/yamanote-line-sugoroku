import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame, createItemGame, type RailwayNetwork } from "../../src/features/game/engine";
import { createPresentationResolver, type PresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveClearResult, mapSavedRecord } from "../../src/features/game/clearResult";
import type { GeometryIndex } from "../../src/features/game/animation/movePath";
import type { EditionDisplay } from "../../src/features/editions/types";
import type { GameState, ItemEvent, ItemGameState, ItemTurnRecord, LandingChoice, MoveRecord } from "../../src/types/network";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { M_LINE, M_LOOP, M_SPUR, M_START, multiConfig, multiServiceInput } from "./fixtures/multiService";

const baseInput = multiServiceInput();
const network = buildRailwayNetwork(baseInput);
const display: EditionDisplay = {
  title: "山手線すごろく", subtitle: "東京近郊版", documentTitle: "結果", ruleParagraphs: [],
};

function resolver(groups: readonly { id: string; serviceIds: string[]; color: string }[] = [
  { id: "target-group", serviceIds: [M_LOOP], color: "#008000" },
  { id: "line-group", serviceIds: [M_LINE], color: "#0000ff" },
  { id: "spur-group", serviceIds: [M_SPUR], color: "#ff0000" },
]): PresentationResolver {
  return createPresentationResolver(network, {
    version: 1, operators: [], stations: [], serviceStopNames: [],
    lineGroups: groups.map((group) => ({ ...group, name: group.id, operatorId: "test" })),
  });
}

const presentation = resolver();
const geometry: GeometryIndex = new Map(baseInput.segments.map((segment) => {
  const service = network.servicesById.get(segment.serviceId)!;
  return [segment.id, {
    fromStationId: segment.from,
    toStationId: segment.to,
    points: [service.platformCoordinates[segment.from]!, service.platformCoordinates[segment.to]!],
  }];
}));

function classicRecord(
  serviceId: string,
  direction: 1 | -1,
  fromStationId: string,
  toStationId: string,
  traversedSegmentIds: string[],
  landing: LandingChoice | null = null,
): MoveRecord {
  return { turn: 1, roll: traversedSegmentIds.length, serviceId, direction, fromStationId, toStationId,
    traversedSegmentIds, stopReason: "roll", landing };
}

function classic(history: MoveRecord[], startStationId = M_START): GameState {
  const base = createGame(multiConfig(), "clear-result-classic", network);
  return { ...base, config: { ...base.config, startStationId }, status: "completed", turn: history.length, currentStationId: history.at(-1)?.toStationId ?? startStationId,
    movementHistory: history };
}

function itemBase(): ItemGameState {
  const base = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "clear-result-item", network);
  return { ...base, status: "completed" };
}

function rideRecord(
  serviceId: string,
  direction: 1 | -1,
  fromStationId: string,
  toStationId: string,
  traversedSegmentIds: string[],
  options: Partial<Extract<ItemTurnRecord, { kind: "item-ride" }>> = {},
): Extract<ItemTurnRecord, { kind: "item-ride" }> {
  return {
    kind: "item-ride", turn: 1, fromStationId, toStationId, command: { items: [] }, traversedSegmentIds,
    landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: { serviceId, direction }, rawRoll: 1, effectiveFace: 1, adjustment: null,
    movementMode: "normal", pips: traversedSegmentIds.length, hopBudget: traversedSegmentIds.length,
    physicalHops: traversedSegmentIds.length, unusedPips: 0, stopReason: "roll", ...options,
  };
}

function deadheadRecord(fromStationId: string, toStationId: string, itemEvents: ItemEvent[] = []): Extract<ItemTurnRecord, { kind: "deadhead" }> {
  return {
    kind: "deadhead", turn: 1, fromStationId, toStationId, command: { items: [] }, traversedSegmentIds: [],
    landing: null, landingSnapshot: null, itemEvents, discardedInstanceId: null, resolvedRide: null,
    rawRoll: null, effectiveFace: null, adjustment: null, movementMode: "deadhead", pips: null,
    hopBudget: null, physicalHops: 0, unusedPips: null, stopReason: "relocation",
    relocation: { fromStationId, toStationId, serviceId: M_LOOP, direction: 1, distance: 0 },
  };
}

function itemGame(history: ItemTurnRecord[], startStationId = M_START): ItemGameState {
  const base = itemBase();
  return { ...base, config: { ...base.config, startStationId }, status: "completed", turn: history.length, currentStationId: history.at(-1)?.toStationId ?? startStationId,
    movementHistory: history };
}

function input(game: GameState | ItemGameState, options: { network?: RailwayNetwork; geometry?: GeometryIndex; presentation?: PresentationResolver } = {}) {
  return { game, network: options.network ?? network, geometry: options.geometry ?? geometry,
    presentation: options.presentation ?? presentation, display };
}

describe("deriveClearResult", () => {
  it("preserves classic summary and share text byte-for-byte", () => {
    const game = classic([
      classicRecord(M_LOOP, 1, M_START, "b", [`${M_LOOP}:start:a`, `${M_LOOP}:a:b`], { serviceId: M_LINE, direction: 1 }),
      classicRecord(M_LINE, 1, "b", "d", [`${M_LINE}:b:y`, `${M_LINE}:y:d`], { serviceId: M_LOOP, direction: 1 }),
      classicRecord(M_LOOP, 1, "d", "e", [`${M_LOOP}:d:e`]),
    ]);
    const result = deriveClearResult(input(game));
    expect(result.summary).toEqual({ turns: 3, moves: 5, transfers: 2 });
    expect(result.shareText).toBe("山手線すごろく 東京近郊版をクリア！\n所要ターン数 3・移動回数 5・乗換回数 2\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app");
    expect(result.route?.steps).toHaveLength(5);
  });

  it("uses item-save hops and event records for exact summary, sharing, and item counts", () => {
    const history: ItemTurnRecord[] = [
      rideRecord(M_LOOP, 1, M_START, "b", [`${M_LOOP}:start:a`, `${M_LOOP}:a:b`], {
        movementMode: "rapid", pips: 1, hopBudget: 4, physicalHops: 2, landing: { serviceId: M_LINE, direction: 1 },
        itemEvents: [
          { type: "consumed", item: { id: "rapid-1", kind: "rapid" } },
          { type: "consumed", item: { id: "adjust-1", kind: "roll-adjust" } },
        ], adjustment: { instanceId: "adjust-1", delta: 1 },
      }),
      deadheadRecord("b", "b", [
        { type: "consumed", item: { id: "deadhead-1", kind: "deadhead" } },
        { type: "cancelled-by-certificate", item: "delay", certificate: { id: "certificate-1", kind: "delay-certificate" } },
        { type: "cancelled-by-certificate", item: "delay", certificate: { id: "certificate-1", kind: "delay-certificate" } },
      ]),
      rideRecord(M_LINE, 1, "b", "d", [`${M_LINE}:b:y`, `${M_LINE}:y:d`], {
        landing: null,
        itemEvents: [{ type: "consumed", item: { id: "rapid-1", kind: "rapid" } }],
      }),
    ];
    history[1] = { ...history[1]!, landing: { serviceId: M_LINE, direction: 1 } };
    const result = deriveClearResult(input(itemGame(history)));
    expect(result.summary).toEqual({ turns: 3, moves: 4, transfers: 3 });
    expect(result.shareText).toBe("山手線すごろく 東京近郊版をクリア！\n所要ターン数 3・移動回数 4・乗換回数 3\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app");
    expect(Object.fromEntries(result.highlights.usedItems)).toEqual({ rapid: 1, "roll-adjust": 1, deadhead: 1, "delay-certificate": 1 });
    expect(Object.fromEntries(result.highlights.avoidedItems)).toEqual({ delay: 2 });
  });

  it("counts actual rapid hops beyond pips and continues a ride across turns", () => {
    const history = [rideRecord(M_LINE, 1, "b", "d", [`${M_LINE}:b:y`, `${M_LINE}:y:d`], {
      movementMode: "rapid", pips: 1, hopBudget: 5, physicalHops: 2, landing: { serviceId: M_LINE, direction: 1 },
    }), rideRecord(M_LINE, -1, "d", "b", [`${M_LINE}:d:y`, `${M_LINE}:y:b`], {
      movementMode: "normal", pips: 2, hopBudget: 2, physicalHops: 2, landing: null,
    })];
    const result = deriveClearResult(input(itemGame(history, "b")));
    expect(result.summary.moves).toBe(4);
    const secondTraversal = mapSavedRecord(history[1]!, 1, "d", input(itemGame(history, "b")));
    expect(secondTraversal).toMatchObject({ kind: "ride" });
    if (secondTraversal.kind === "ride") expect(secondTraversal.hops).toHaveLength(2);
    expect(result.highlights.longestRide).toEqual({ groupId: "line-group", count: 4, fromStationId: "b", toStationId: "b" });
  });

  it("counts only travelled stations when oversleep is truncated at the goal", () => {
    const history = [rideRecord(M_LINE, 1, "b", "d", [`${M_LINE}:b:y`, `${M_LINE}:y:d`], {
      movementMode: "oversleep", pips: 5, hopBudget: 5, physicalHops: 2, stopReason: "goal", landing: null,
    })];
    const result = deriveClearResult(input(itemGame(history, "b")));
    expect(result.summary.moves).toBe(2);
    expect(result.highlights.longestRide).toEqual({ groupId: "line-group", count: 2, fromStationId: "b", toStationId: "d" });
  });

  it("breaks longest rides on a zero-hop group transfer and does not join a later return", () => {
    const result = deriveClearResult(input(classic([
      classicRecord(M_LINE, 1, "x", "b", [`${M_LINE}:x:b`], { serviceId: M_SPUR, direction: 1 }),
      classicRecord(M_SPUR, 1, "b", "b", [], { serviceId: M_LINE, direction: 1 }),
      classicRecord(M_LINE, 1, "b", "y", [`${M_LINE}:b:y`]),
    ], "x")));
    expect(result.highlights.longestRide).toEqual({ groupId: "line-group", count: 1, fromStationId: "x", toStationId: "b" });
    expect(result.route?.steps[0]?.points.at(-1)).toEqual(result.route?.steps[1]?.points[0]);
    expect(result.route?.legs.map(({ firstStepIndex, endStepIndexExclusive }) => [firstStepIndex, endStepIndexExclusive]))
      .toEqual([[0, 1], [1, 2]]);
  });

  it("continues across turns, and keeps the first run when another run ties its length", () => {
    const result = deriveClearResult(input(classic([
      classicRecord(M_LINE, 1, "b", "d", [`${M_LINE}:b:y`, `${M_LINE}:y:d`], { serviceId: M_LOOP, direction: 1 }),
      classicRecord(M_LOOP, 1, "d", "d", [], { serviceId: M_LINE, direction: -1 }),
      classicRecord(M_LINE, -1, "d", "b", [`${M_LINE}:d:y`, `${M_LINE}:y:b`]),
    ], "b")));
    expect(result.highlights.longestRide).toEqual({ groupId: "line-group", count: 2, fromStationId: "b", toStationId: "d" });
  });

  it("excludes every service in the target line group and keeps first candidate on a most-used tie", () => {
    const groupedPresentation = resolver([
      { id: "target-group", serviceIds: [M_LOOP, M_LINE], color: "#008000" },
      { id: "spur-group", serviceIds: [M_SPUR], color: "#ff0000" },
    ]);
    const onlyTarget = deriveClearResult(input(classic([
      classicRecord(M_LINE, 1, "x", "b", [`${M_LINE}:x:b`]),
    ], "x"), { presentation: groupedPresentation }));
    expect(onlyTarget.highlights.mostUsedLine).toBeNull();

    const tie = deriveClearResult(input(classic([
      classicRecord(M_LINE, 1, "x", "b", [`${M_LINE}:x:b`], { serviceId: M_SPUR, direction: 1 }),
      classicRecord(M_SPUR, 1, "b", "s1", [`${M_SPUR}:b:s1`]),
    ], "x")));
    expect(tie.highlights.mostUsedLine).toEqual({ groupId: "line-group", count: 1 });
  });

  it("compares farthest candidates before rounding and keeps first visits on exact ties", () => {
    const coordinatesFor = (stationId: string): [number, number] => stationId === "x" ? [0, 0]
      : stationId === "b" ? [0.0002, 0]
        : stationId === "y" ? [0.0002005, 0]
          : baseInput.stations.find((station) => station.id === stationId)!.coordinates;
    const inputNetwork = buildRailwayNetwork({
      ...baseInput,
      stations: baseInput.stations.map((station) => ({
        ...station, coordinates: coordinatesFor(station.id),
      })),
      services: baseInput.services.map((service) => ({
        ...service,
        platformCoordinates: Object.fromEntries(Object.keys(service.platformCoordinates).map((stationId) => [stationId, coordinatesFor(stationId)])) as typeof service.platformCoordinates,
      })),
    });
    const result = deriveClearResult(input(classic([
      classicRecord(M_LINE, 1, "x", "y", [`${M_LINE}:x:b`, `${M_LINE}:b:y`]),
    ], "x"), { network: inputNetwork }));
    expect(result.highlights.farthestStation?.stationId).toBe("y");
    expect(result.highlights.farthestStation?.distanceKm).toBe(0);
  });

  it("uses first visit for stations at the same great-circle distance", () => {
    const coordinatesFor = (stationId: string): [number, number] => stationId === "x" ? [0, 0]
      : stationId === "b" ? [0.0002, 0]
        : stationId === "y" ? [-0.0002, 0]
          : baseInput.stations.find((station) => station.id === stationId)!.coordinates;
    const inputNetwork = buildRailwayNetwork({
      ...baseInput,
      stations: baseInput.stations.map((station) => ({ ...station, coordinates: coordinatesFor(station.id) })),
      services: baseInput.services.map((service) => ({ ...service,
        platformCoordinates: Object.fromEntries(Object.keys(service.platformCoordinates).map((stationId) => [stationId, coordinatesFor(stationId)])) as typeof service.platformCoordinates })),
    });
    const result = deriveClearResult(input(classic([
      classicRecord(M_LINE, 1, "x", "y", [`${M_LINE}:x:b`, `${M_LINE}:b:y`]),
    ], "x"), { network: inputNetwork }));
    expect(result.highlights.farthestStation?.stationId).toBe("b");
  });

  it("includes a different deadhead destination when selecting the farthest station", () => {
    const destinationCoordinates: [number, number] = [150, 45];
    const candidateNetwork = buildRailwayNetwork({
      ...baseInput,
      stations: baseInput.stations.map((station) => station.id === "s2"
        ? { ...station, coordinates: destinationCoordinates }
        : station),
    });
    const result = deriveClearResult(input(itemGame([
      rideRecord(M_LINE, 1, "x", "b", [`${M_LINE}:x:b`]),
      deadheadRecord("b", "s2"),
    ], "x"), { network: candidateNetwork }));

    expect(result.highlights.farthestStation?.stationId).toBe("s2");
  });

  it("returns null route and skips invalid topology while retaining later valid results", () => {
    const invalidRecord = classicRecord(M_LINE, 1, "x", "b", ["wrong-segment"]);
    const result = deriveClearResult(input(classic([
      invalidRecord,
      classicRecord(M_SPUR, 1, "b", "s1", [`${M_SPUR}:b:s1`]),
    ], "x")));
    expect(result.route).toBeNull();
    expect(result.highlights.mostUsedLine).toEqual({ groupId: "spur-group", count: 1 });
    expect(mapSavedRecord(invalidRecord, 0, "x", input(classic([invalidRecord], "x")))).toEqual({ kind: "invalid" });
  });

  it("narrows deadhead before reading ride fields and validates same-station relocation", () => {
    const deadhead = deadheadRecord("b", "b");
    const traversal = mapSavedRecord(deadhead, 0, "b", input(itemGame([deadhead])));
    expect(traversal).toEqual({ kind: "deadhead", toStationId: "b" });
  });

  it("keeps topology highlights identical when only geometry is invalid", () => {
    const game = classic([
      classicRecord(M_LINE, 1, "x", "b", [`${M_LINE}:x:b`]),
    ], "x");
    const valid = deriveClearResult(input(game));
    const missingFeature = deriveClearResult(input(game, { geometry: new Map() }));
    expect(missingFeature.route).toBeNull();
    expect(missingFeature.highlights).toEqual(valid.highlights);
  });
});
