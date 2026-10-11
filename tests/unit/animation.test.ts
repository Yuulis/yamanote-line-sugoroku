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
import { type FrameScheduler, runMoveAnimation } from "../../src/features/game/animation/runner";
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
    properties: { segmentId: id, serviceId: "jr-yamanote", from, to },
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
  it("indexes LineStrings by stringified feature id and skips MultiLineStrings", () => {
    const multi = {
      ...lineFeature(1, []),
      id: 7,
      geometry: {
        type: "MultiLineString" as const,
        coordinates: [[stationAt(1)], [stationAt(2)]],
      },
    };
    const index = buildGeometryIndex(
      geometryFor([lineFeature(0, [stationAt(0), stationAt(1)]), multi]),
    );
    expect(index.get(segmentId(0))).toEqual([stationAt(0), stationAt(1)]);
    expect(index.has("7")).toBe(false);
  });

  it("returns an empty index when geometry failed to load", () => {
    expect(buildGeometryIndex(undefined).size).toBe(0);
  });
});

describe("path orientation and distance", () => {
  it("keeps a path that starts at the departure station", () => {
    const points: Position[] = [stationAt(0), DETOUR, stationAt(1)];
    expect(orientPath(points, stationAt(0))).toEqual(points);
  });

  it("reverses a path stored in the opposite direction", () => {
    const points: Position[] = [stationAt(1), DETOUR, stationAt(0)];
    expect(orientPath(points, stationAt(0))).toEqual([stationAt(0), DETOUR, stationAt(1)]);
  });

  it("returns no points for an empty line", () => {
    expect(orientPath([], stationAt(0))).toEqual([]);
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
      geometryFor([lineFeature(0, [stationAt(1), DETOUR, stationAt(0)])]),
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
