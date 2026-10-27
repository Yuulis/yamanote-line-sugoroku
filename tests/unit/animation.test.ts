import { describe, expect, it } from "vitest";
import { displayedProgress } from "../../src/features/game/animation/displayedProgress";
import {
  buildGeometryIndex,
  buildMovePlan,
  orientPath,
  planarDistance,
  positionAlong,
  type StepPath,
  stepPath,
} from "../../src/features/game/animation/movePath";
import { createLivePosition } from "../../src/features/game/animation/livePosition";
import { type FrameScheduler, runMoveAnimation } from "../../src/features/game/animation/runner";
import { isSameStep } from "../../src/features/game/animation/useMoveAnimation";
import type { MoveAnimation } from "../../src/features/game/gameSession";
import {
  type AnimationFrame,
  easeInOut,
  frameAt,
  visibleCompletedSegmentIds,
} from "../../src/features/game/animation/timeline";
import {
  buildRailwayNetwork,
  createGame,
  moveByRoll,
  type SegmentTraversedEvent,
} from "../../src/features/game/engine";
import type { Position, SegmentFeatureCollection } from "../../src/types/data";
import { DEFAULT_CONFIG, SEGMENT_IDS, segmentId, STATION_IDS, yamanoteInput } from "./fixtures/yamanote";

import { bothWays, M_LINE, multiServiceInput } from "./fixtures/multiService";

const network = buildRailwayNetwork(yamanoteInput());

/** Fixture station i sits at [139.7 + i/1000, 35.6 + i/1000]. */
function stationAt(index: number): Position {
  return [139.7 + index / 1000, 35.6 + index / 1000];
}

/** A bent line for segment 0 (station 0 -> 1) via a detour point. */
const DETOUR: Position = [139.7, 35.601];

function geometryFor(features: SegmentFeatureCollection["features"]): SegmentFeatureCollection {
  return { type: "FeatureCollection", features };
}

function lineFeature(index: number, coordinates: Position[]) {
  const id = segmentId(index);
  const from = STATION_IDS[index] as string;
  const to = STATION_IDS[(index + 1) % STATION_IDS.length] as string;
  return {
    type: "Feature" as const,
    id,
    properties: { featureId: id, serviceId: "jr-yamanote", lineId: "jr-yamanote", from, to },
    geometry: { type: "LineString" as const, coordinates },
  };
}

function traversed(index: number, newlyCompleted = true): SegmentTraversedEvent {
  return {
    type: "segment-traversed",
    step: index + 1,
    serviceId: "jr-yamanote",
    direction: 1,
    segmentId: segmentId(index),
    fromStationId: STATION_IDS[index] as string,
    toStationId: STATION_IDS[(index + 1) % STATION_IDS.length] as string,
    newlyCompleted,
  };
}

/** A straight two-point path with an exact length of 1 along the latitude. */
function unitPath(segment: string, newlyCompleted = true): StepPath {
  return {
    segmentId: segment,
    fromStationId: "a",
    toStationId: "b",
    newlyCompleted,
    points: [
      [0, 0],
      [0, 1],
    ],
    cumulative: [0, 1],
    total: 1,
  };
}

describe("geometry index", () => {
  it("indexes LineStrings with their canonical station orientation", () => {
    const index = buildGeometryIndex(geometryFor([lineFeature(0, [stationAt(0), stationAt(1)])]));
    expect(index.get(segmentId(0))).toEqual({
      fromStationId: STATION_IDS[0], toStationId: STATION_IDS[1],
      points: [stationAt(0), stationAt(1)],
    });
  });

  it("returns an empty index when geometry failed to load", () => {
    expect(buildGeometryIndex(undefined).size).toBe(0);
  });
});

describe("path orientation and distance", () => {
  it("keeps a path that starts at the departure station", () => {
    const points: Position[] = [stationAt(0), DETOUR, stationAt(1)];
    expect(orientPath({ points, fromStationId: "a", toStationId: "b" }, "a", "b")).toEqual(points);
  });

  it("reverses a path stored in the opposite direction", () => {
    const points: Position[] = [stationAt(1), DETOUR, stationAt(0)];
    expect(orientPath({ points, fromStationId: "b", toStationId: "a" }, "a", "b")).toEqual([stationAt(0), DETOUR, stationAt(1)]);
  });

  it("returns no points for an empty line", () => {
    expect(orientPath({ points: [], fromStationId: "a", toStationId: "b" }, "a", "b")).toEqual([]);
  });

  it("scales longitude by cos(latitude)", () => {
    const east = planarDistance([139, 60], [140, 60]);
    const north = planarDistance([139, 60], [139, 61]);
    expect(east).toBeCloseTo(0.5, 2);
    expect(north).toBeCloseTo(1, 5);
  });
});

describe("stepPath / buildMovePlan", () => {
  it("follows the segment geometry, oriented from the departure station", () => {
    const geometry = buildGeometryIndex(
      geometryFor([{ ...lineFeature(0, [stationAt(1), DETOUR, stationAt(0)]), properties: { featureId: segmentId(0), serviceId: "jr-yamanote", lineId: "jr-yamanote", from: STATION_IDS[1], to: STATION_IDS[0] } }]),
    );
    const path = stepPath(traversed(0), network, geometry);
    expect(path.points).toEqual([stationAt(0), DETOUR, stationAt(1)]);
    expect(path.cumulative).toHaveLength(3);
    expect(path.total).toBeCloseTo(path.cumulative[2] ?? Number.NaN, 12);
    expect(path).toMatchObject({
      segmentId: segmentId(0),
      fromStationId: STATION_IDS[0],
      toStationId: STATION_IDS[1],
    });
  });

  it("falls back to the station-to-station line only without geometry", () => {
    const path = stepPath(traversed(3), network, buildGeometryIndex(undefined));
    expect(path.points).toEqual([stationAt(3), stationAt(4)]);
  });

  it.each([
    { direction: 1, mixedOrientations: false },
    { direction: -1, mixedOrientations: false },
    { direction: 1, mixedOrientations: true },
    { direction: -1, mixedOrientations: true },
  ] as const)("follows a multi-owner chain in direction $direction with mixed orientations $mixedOrientations without repeating the joint", ({ direction, mixedOrientations }) => {
    const input = multiServiceInput();
    const line = input.services.find((service) => service.id === M_LINE)!;
    input.services = [...input.services, { ...line, id: "rapid-chain", kind: "rapid", stationIds: ["x", "y"], platformCoordinates: { x: [0, 0], y: [0, 4] } }];
    input.segments = [...input.segments, ...bothWays("rapid-chain", ["x", "y"]).map((segment) => ({
      ...segment, geometryFeatureIds: segment.from === "x"
        ? ["owner-a:x~b", "owner-b:b~y"] as [string, ...string[]]
        : ["owner-b:b~y", "owner-a:x~b"] as [string, ...string[]],
    }))];
    const net = buildRailwayNetwork(input);
    const geometry = buildGeometryIndex(geometryFor([
      { type: "Feature", id: "owner-a:x~b", properties: { featureId: "owner-a:x~b", serviceId: "owner-a", lineId: "a", from: "x", to: "b" }, geometry: { type: "LineString", coordinates: [[0, 0], [0, 1], [0, 3]] } },
      { type: "Feature", id: "owner-b:b~y", properties: { featureId: "owner-b:b~y", serviceId: "owner-b", lineId: "b", from: mixedOrientations ? "y" : "b", to: mixedOrientations ? "b" : "y" }, geometry: { type: "LineString", coordinates: mixedOrientations ? [[0, 4], [0, 3]] : [[0, 3], [0, 4]] } },
    ]));
    const from = direction === 1 ? "x" : "y", to = direction === 1 ? "y" : "x";
    const path = stepPath({ type: "segment-traversed", step: 1, segmentId: `rapid-chain:${from}:${to}`, serviceId: "rapid-chain", direction, fromStationId: from, toStationId: to, newlyCompleted: true }, net, geometry);
    const forward: Position[] = [[0, 0], [0, 1], [0, 3], [0, 4]];
    expect(path.points).toEqual(direction === 1 ? forward : [...forward].reverse());
    expect(path.total).toBe(4);
    expect(positionAlong(path, 0.5)).toEqual([0, 2]);
    expect(positionAlong(path, 0)).toEqual(direction === 1 ? [0, 0] : [0, 4]);
    expect(positionAlong(path, 1)).toEqual(direction === 1 ? [0, 4] : [0, 0]);
  });

  it("rejects a missing feature when a geometry bundle was loaded", () => {
    const geometry = buildGeometryIndex(geometryFor([lineFeature(0, [stationAt(0), stationAt(1)])]));
    expect(() => stepPath(traversed(1), network, geometry)).toThrowError(expect.objectContaining({ code: "INVALID_NETWORK" }));
  });

  it("builds one step per traversed segment and ignores the goal event", () => {
    let state = createGame(DEFAULT_CONFIG, "plan", network);
    // 27 hops, then a 6 that stops at 新橋 after 3 hops (3 pips unused).
    for (const roll of [6, 6, 6, 6, 3]) state = moveByRoll(state, roll, network).state;
    const { events } = moveByRoll(state, 6, network);
    expect(events.at(-1)?.type).toBe("goal-reached");
    const plan = buildMovePlan(events, network, buildGeometryIndex(undefined));
    expect(plan.map((step) => step.segmentId)).toEqual(SEGMENT_IDS.slice(27));
  });
});

describe("positionAlong", () => {
  it("returns the endpoints at 0 and 1 and clamps outside", () => {
    const path = unitPath("s");
    expect(positionAlong(path, 0)).toEqual([0, 0]);
    expect(positionAlong(path, 1)).toEqual([0, 1]);
    expect(positionAlong(path, -1)).toEqual([0, 0]);
    expect(positionAlong(path, 2)).toEqual([0, 1]);
    expect(positionAlong(path, 0.25)).toEqual([0, 0.25]);
  });

  it("moves by distance, not by vertex count", () => {
    const path: StepPath = {
      ...unitPath("s"),
      points: [
        [0, 0],
        [0, 3],
        [0, 4],
      ],
      cumulative: [0, 3, 4],
      total: 4,
    };
    expect(positionAlong(path, 0.5)).toEqual([0, 2]);
    expect(positionAlong(path, 0.875)).toEqual([0, 3.5]);
  });

  it("handles zero-length and empty paths", () => {
    const point: StepPath = { ...unitPath("s"), points: [[1, 2]], cumulative: [0], total: 0 };
    expect(positionAlong(point, 0.5)).toEqual([1, 2]);
    const empty: StepPath = { ...unitPath("s"), points: [], cumulative: [], total: 0 };
    expect(positionAlong(empty, 0.5)).toBeNull();
  });
});

describe("frameAt", () => {
  const steps = [unitPath("s0"), unitPath("s1")];

  it("starts at the first path's start", () => {
    expect(frameAt(steps, 0, 100)).toEqual({ stepsCompleted: 0, position: [0, 0], done: false });
  });

  it("is half way along a hop at half its time (ease is symmetric)", () => {
    expect(frameAt(steps, 50, 100).position?.[1]).toBeCloseTo(0.5, 12);
  });

  it("counts a hop as completed exactly at its boundary", () => {
    expect(frameAt(steps, 100, 100)).toMatchObject({ stepsCompleted: 1, done: false });
  });

  it("is done at the end, past the end, without steps, or with no duration", () => {
    const end = { stepsCompleted: 2, position: [0, 1], done: true };
    expect(frameAt(steps, 200, 100)).toEqual(end);
    expect(frameAt(steps, 10_000, 100)).toEqual(end);
    expect(frameAt(steps, 0, 0)).toEqual(end);
    expect(frameAt([], 0, 100)).toEqual({ stepsCompleted: 0, position: null, done: true });
  });

  it("treats negative elapsed time as the start", () => {
    expect(frameAt(steps, -50, 100)).toMatchObject({ stepsCompleted: 0, position: [0, 0] });
  });

  it("eases in and out", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("visibleCompletedSegmentIds", () => {
  const committed = ["old", "s0", "s1"];
  const steps = [unitPath("old", false), unitPath("s0"), unitPath("s1")];

  it("hides segments this move completes until the marker has passed them", () => {
    expect(visibleCompletedSegmentIds(committed, steps, 0)).toEqual(["old"]);
    expect(visibleCompletedSegmentIds(committed, steps, 2)).toEqual(["old", "s0"]);
  });

  it("returns the committed list itself once every hop is shown", () => {
    expect(visibleCompletedSegmentIds(committed, steps, 3)).toBe(committed);
  });
});

describe("displayedProgress", () => {
  const start = createGame(DEFAULT_CONFIG, "view", network);
  const { state: moved, events } = moveByRoll(start, 3, network);
  const steps = buildMovePlan(events, network, buildGeometryIndex(undefined));

  it("shows the committed state when idle", () => {
    expect(displayedProgress(moved, network, null)).toEqual({
      stationId: STATION_IDS[3],
      position: stationAt(3),
      completedSegmentIds: moved.completedSegmentIds,
      stepsCompleted: 0,
    });
  });

  it("shows the departure station before the first frame", () => {
    const view = { fromStationId: start.currentStationId, steps, frame: null };
    expect(displayedProgress(moved, network, view)).toMatchObject({
      stationId: STATION_IDS[0],
      position: stationAt(0),
      completedSegmentIds: [],
    });
  });

  it("tracks the marker mid-move", () => {
    const frame: AnimationFrame = { stepsCompleted: 2, position: [1, 1], done: false };
    const view = { fromStationId: start.currentStationId, steps, frame };
    expect(displayedProgress(moved, network, view)).toEqual({
      stationId: STATION_IDS[2],
      position: [1, 1],
      completedSegmentIds: SEGMENT_IDS.slice(0, 2),
      stepsCompleted: 2,
    });
  });
});

describe("runMoveAnimation", () => {
  /** Manual scheduler: frames run only when the test calls `tick`. */
  function manualScheduler() {
    let next = 1;
    const pending = new Map<number, (now: number) => void>();
    const scheduler: FrameScheduler = {
      request: (callback) => {
        const handle = next;
        next += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancel: (handle) => {
        pending.delete(handle);
      },
    };
    const tick = (now: number) => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    };
    return { scheduler, tick, pendingCount: () => pending.size };
  }

  const steps = [unitPath("s0"), unitPath("s1")];

  it("reports frames from the first tick and finishes exactly once", () => {
    const { scheduler, tick, pendingCount } = manualScheduler();
    const frames: AnimationFrame[] = [];
    let done = 0;
    runMoveAnimation(steps, 100, scheduler, (frame) => frames.push(frame), () => {
      done += 1;
    });
    tick(1000);
    tick(1150);
    expect(frames.map((frame) => frame.stepsCompleted)).toEqual([0, 1]);
    expect(done).toBe(0);
    tick(1200);
    tick(1300);
    expect(done).toBe(1);
    expect(frames.at(-1)?.done).toBe(true);
    expect(pendingCount()).toBe(0);
  });

  it("moves the live marker on every frame but changes the panel state only when a hop finishes", () => {
    const { scheduler, tick } = manualScheduler();
    const animation: MoveAnimation = { sessionId: 1, turn: 1, fromStationId: "s0", events: [] };
    const live = createLivePosition();
    const markerMoves: (Position | null)[] = [];
    live.subscribe(() => markerMoves.push(live.get()));
    let panelState: { animation: MoveAnimation; frame: AnimationFrame } | null = null;
    let panelUpdates = 0;
    runMoveAnimation(steps, 100, scheduler, (frame) => {
      live.set(frame.position);
      if (isSameStep(panelState, animation, frame)) return;
      panelState = { animation, frame };
      panelUpdates += 1;
    }, () => {});
    for (let now = 0; now <= 200; now += 10) tick(now);

    expect(markerMoves.length).toBeGreaterThan(15);
    expect(live.get()).toEqual(positionAlong(steps[1]!, 1));
    // Hop 0 in progress, hop 1 in progress, then done.
    expect(panelUpdates).toBe(3);
  });

  it("treats a frame of another move as a new panel state", () => {
    const frame: AnimationFrame = { stepsCompleted: 1, position: [0, 0], done: false };
    const first: MoveAnimation = { sessionId: 1, turn: 1, fromStationId: "s0", events: [] };
    const second: MoveAnimation = { ...first, turn: 2 };
    expect(isSameStep({ animation: first, frame }, first, { ...frame, position: [1, 1] })).toBe(true);
    expect(isSameStep({ animation: first, frame }, second, frame)).toBe(false);
    expect(isSameStep({ animation: first, frame }, first, { ...frame, done: true })).toBe(false);
    expect(isSameStep(null, first, frame)).toBe(false);
  });

  it("catches up after a long pause (hidden tab)", () => {
    const { scheduler, tick } = manualScheduler();
    let done = 0;
    runMoveAnimation(steps, 100, scheduler, () => {}, () => {
      done += 1;
    });
    tick(0);
    tick(60_000);
    expect(done).toBe(1);
  });

  it("stops without callbacks after cancel", () => {
    const { scheduler, tick, pendingCount } = manualScheduler();
    let calls = 0;
    const cancel = runMoveAnimation(steps, 100, scheduler, () => {
      calls += 1;
    }, () => {
      calls += 1;
    });
    tick(0);
    cancel();
    expect(pendingCount()).toBe(0);
    tick(500);
    expect(calls).toBe(1);
  });

  it("ignores a frame callback that was already queued when cancelled", () => {
    // A scheduler that cannot cancel: the stale callback still runs.
    const queued: ((now: number) => void)[] = [];
    const scheduler: FrameScheduler = {
      request: (callback) => queued.push(callback),
      cancel: () => {},
    };
    let calls = 0;
    const cancel = runMoveAnimation(steps, 100, scheduler, () => {
      calls += 1;
    }, () => {
      calls += 1;
    });
    cancel();
    for (const callback of queued) callback(10_000);
    expect(calls).toBe(0);
  });

  it("finishes synchronously for reduced motion or an empty move", () => {
    const { scheduler, pendingCount } = manualScheduler();
    let done = 0;
    runMoveAnimation(steps, 0, scheduler, () => {}, () => {
      done += 1;
    });
    runMoveAnimation([], 100, scheduler, () => {}, () => {
      done += 1;
    });
    expect(done).toBe(2);
    expect(pendingCount()).toBe(0);
  });
});

describe("createLivePosition", () => {
  it("notifies subscribers only when the position changes and stops after unsubscribe", () => {
    const live = createLivePosition();
    let calls = 0;
    const unsubscribe = live.subscribe(() => {
      calls += 1;
    });
    const position: Position = [139.7, 35.6];

    expect(live.get()).toBeNull();
    live.set(position);
    live.set(position);
    expect(calls).toBe(1);
    expect(live.get()).toBe(position);
    unsubscribe();
    live.set(null);
    expect(calls).toBe(1);
    expect(live.get()).toBeNull();
  });
});

describe("item movement presentation", () => {
  it("uses every physical rapid hop rather than pips, and bounds long moves at six seconds", async () => {
    const { loadBundle } = await import("../e2e/fixtures/bundle");
    const { itemScenario } = await import("../e2e/fixtures/itemScenarios");
    const { playItemTurn } = await import("../../src/features/game/engine");
    const { MAX_MOVE_DURATION_MS } = await import("../../src/features/game/animation/timeline");
    const bundle = await loadBundle("fixture");
    const game = itemScenario("rapid", bundle.network);
    const ticket = game.inventory.find((item) => item.kind === "rapid")!;
    const result = playItemTurn(game, { command: { items: [{ kind: "rapid", instanceId: ticket.id }] } }, bundle.network);
    const record = result.record!;
    if (record.kind !== "item-ride") throw new Error("Expected ride");
    const steps = buildMovePlan(result.events, bundle.network, new Map());
    expect(record.physicalHops).toBeGreaterThan(record.pips);
    expect(steps).toHaveLength(record.physicalHops);
    const long = Array.from({ length: 300 }, () => ({ ...steps[0]!, distanceKm: 100 }));
    expect(frameAt(long, MAX_MOVE_DURATION_MS - 1, 600, MAX_MOVE_DURATION_MS).done).toBe(false);
    expect(frameAt(long, MAX_MOVE_DURATION_MS + 1, 600, MAX_MOVE_DURATION_MS)).toMatchObject({ done: true, stepsCompleted: 300 });
    expect(frameAt(long, MAX_MOVE_DURATION_MS + 1, 600).done).toBe(false); // Classic pacing is unchanged.
    expect(frameAt(long, 0, 0)).toMatchObject({ done: true, stepsCompleted: 300 });
  });

  it("does not invent a path for deadhead and immediately shows the relocated platform", async () => {
    const { loadBundle } = await import("../e2e/fixtures/bundle");
    const { itemScenario } = await import("../e2e/fixtures/itemScenarios");
    const { playItemTurn, platformPosition } = await import("../../src/features/game/engine");
    const bundle = await loadBundle("fixture");
    const game = itemScenario("deadhead", bundle.network);
    const ticket = game.inventory.find((item) => item.kind === "deadhead")!;
    const result = playItemTurn(game, { command: { items: [{ kind: "deadhead", instanceId: ticket.id }] } }, bundle.network);
    expect(buildMovePlan(result.events, bundle.network, new Map())).toEqual([]);
    const shown = displayedProgress({ ...result.state, movementHistory: [] }, bundle.network, null);
    expect(shown.position).toEqual(platformPosition(bundle.network, result.state.currentServiceId, result.state.currentStationId));
    expect(shown.completedSegmentIds).toEqual(game.completedSegmentIds);
  });
});
