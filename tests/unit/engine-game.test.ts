import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  checkGoal,
  createGame,
  moveByRoll,
  playTurn,
} from "../../src/features/game/engine";
import type { GameConfig, GameState } from "../../src/types/network";
import {
  configWith,
  DEFAULT_CONFIG,
  deepFreeze,
  inputWithShuttle,
  LAST_STATION,
  OTHER_SERVICE_ID,
  SEGMENT_IDS,
  SERVICE_ID,
  segmentId,
  START,
  STATION_IDS,
  yamanoteInput,
} from "./fixtures/yamanote";

const network = buildRailwayNetwork(yamanoteInput(), {
  expectedStationCounts: { [SERVICE_ID]: 30 },
});
const SEED = "test-seed";

function newGame(config: GameConfig = DEFAULT_CONFIG): GameState {
  return createGame(config, SEED, network);
}

function applyRolls(state: GameState, rolls: readonly number[]): GameState {
  return rolls.reduce((current, roll) => moveByRoll(current, roll, network).state, state);
}

/** Rolls summing to 29: from 新橋 to 有楽町 with 29 of 30 segments done. */
const TO_LAST_STATION = [6, 6, 6, 6, 5];

describe("createGame", () => {
  it("starts at 新橋 on turn 0 with 0 of 30 segments completed", () => {
    const state = newGame();
    expect(state).toMatchObject({
      status: "playing",
      currentStationId: START,
      currentServiceId: SERVICE_ID,
      direction: 1,
      turn: 0,
      completedSegmentIds: [],
      movementHistory: [],
      rngSeed: SEED,
      dataVersion: network.dataVersion,
      saveVersion: 3,
    });
  });

  it("is not a goal just because the player stands on 新橋", () => {
    expect(checkGoal(newGame(), network)).toBe(false);
  });

  it.each([
    ["unknown target service", { targetServiceId: "nope" }],
    ["start station off the service", { startStationId: "nowhere" }],
    ["direction with no segments in the data", { targetDirection: -1 as const }],
    ["unknown policy", { goalArrivalPolicy: "whatever" as GameConfig["goalArrivalPolicy"] }],
    ["empty ruleset version", { rulesetVersion: "" }],
  ])("rejects a config with %s", (_label, override) => {
    expect(() => createGame({ ...DEFAULT_CONFIG, ...override }, SEED, network)).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIG" }),
    );
  });

  it("rejects an empty seed", () => {
    expect(() => createGame(DEFAULT_CONFIG, "", network)).toThrowError(
      expect.objectContaining({ code: "INVALID_SEED" }),
    );
  });
});

describe("moveByRoll: movement", () => {
  it("a roll of 1 moves to the next station and completes one segment", () => {
    const { state, events, unusedPips, stopReason } = moveByRoll(newGame(), 1, network);
    expect(state.currentStationId).toBe("hamamatsucho");
    expect(state.turn).toBe(1);
    expect(state.completedSegmentIds).toEqual([segmentId(0)]);
    expect(unusedPips).toBe(0);
    expect(stopReason).toBe("roll");
    expect(events).toEqual([
      {
        type: "segment-traversed",
        step: 1,
        serviceId: SERVICE_ID,
        direction: 1,
        segmentId: segmentId(0),
        fromStationId: START,
        toStationId: "hamamatsucho",
        newlyCompleted: true,
      },
      // Single-service station on the target service: forced, outer loop, no draw.
      {
        type: "landing-resolved",
        stationId: "hamamatsucho",
        serviceCandidates: [SERVICE_ID],
        serviceId: SERVICE_ID,
        serviceDrawRequired: false,
        directionCandidates: [1],
        direction: 1,
        directionDrawRequired: false,
        changedService: false,
      },
    ]);
  });

  it("a roll of 6 traverses six segments and completes all of them", () => {
    const { state, events } = moveByRoll(newGame(), 6, network);
    expect(state.currentStationId).toBe(STATION_IDS[6]);
    expect(state.completedSegmentIds).toEqual(SEGMENT_IDS.slice(0, 6));
    expect(
      events.flatMap((event) => (event.type === "segment-traversed" ? [event.step] : [])),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.movementHistory).toEqual([
      {
        turn: 1,
        roll: 6,
        serviceId: SERVICE_ID,
        direction: 1,
        fromStationId: START,
        toStationId: STATION_IDS[6],
        traversedSegmentIds: SEGMENT_IDS.slice(0, 6),
        stopReason: "roll",
        landing: { serviceId: SERVICE_ID, direction: 1 },
      },
    ]);
  });

  it("wraps around from 有楽町 to 新橋 and beyond", () => {
    const atLast: GameState = { ...newGame(), currentStationId: LAST_STATION };
    const { state } = moveByRoll(atLast, 2, network);
    expect(state.currentStationId).toBe("hamamatsucho");
    expect(state.completedSegmentIds).toEqual([segmentId(29), segmentId(0)]);
    expect(state.status).toBe("playing");
  });

  it("does not count a re-traversed segment twice", () => {
    const partlyDone: GameState = {
      ...newGame(),
      completedSegmentIds: [segmentId(0), segmentId(1)],
    };
    const { state, events } = moveByRoll(partlyDone, 3, network);
    expect(state.completedSegmentIds).toEqual(SEGMENT_IDS.slice(0, 3));
    expect(
      events.flatMap((event) => (event.type === "segment-traversed" ? [event.newlyCompleted] : [])),
    ).toEqual([false, false, true]);
  });

  it("never mutates its input and leaves the RNG state alone", () => {
    const before = deepFreeze(applyRolls(newGame(), [3]));
    const snapshot = structuredClone(before);
    const { state } = moveByRoll(before, 4, network);
    expect(before).toEqual(snapshot);
    expect(state).not.toBe(before);
    expect(state.rngState).toBe(before.rngState);
  });
});

describe("moveByRoll: rejected input", () => {
  it.each([0, 7, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the roll %s",
    (roll) => {
      expect(() => moveByRoll(newGame(), roll, network)).toThrowError(
        expect.objectContaining({ code: "INVALID_ROLL" }),
      );
    },
  );

  it.each(["ready", "moving", "completed"] as const)("rejects a %s game", (status) => {
    expect(() => moveByRoll({ ...newGame(), status }, 1, network)).toThrowError(
      expect.objectContaining({ code: "GAME_NOT_PLAYING" }),
    );
  });

  it("rejects a state whose station is not on its service", () => {
    expect(() =>
      moveByRoll({ ...newGame(), currentStationId: "nowhere" }, 1, network),
    ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
  });
});

describe("goal: truncate-on-target-service (MVP default)", () => {
  it("does not clear after completing 29 segments away from 新橋", () => {
    const state = applyRolls(newGame(), TO_LAST_STATION);
    expect(state.currentStationId).toBe(LAST_STATION);
    expect(state.completedSegmentIds).toHaveLength(29);
    expect(state.status).toBe("playing");
    expect(checkGoal(state, network)).toBe(false);
  });

  it("stops at 新橋 when all 30 are done mid-move and discards the remaining pips", () => {
    const atLast = applyRolls(newGame(), TO_LAST_STATION);
    const { state, events, unusedPips, stopReason } = moveByRoll(atLast, 4, network);
    expect(state.status).toBe("completed");
    expect(state.currentStationId).toBe(START);
    expect(state.completedSegmentIds).toHaveLength(30);
    expect(unusedPips).toBe(3);
    expect(stopReason).toBe("goal");
    expect(events).toEqual([
      expect.objectContaining({ type: "segment-traversed", step: 1, toStationId: START }),
      { type: "goal-reached", step: 1, stationId: START },
    ]);
    expect(state.movementHistory.at(-1)).toMatchObject({
      roll: 4,
      toStationId: START,
      traversedSegmentIds: [segmentId(29)],
      stopReason: "goal",
      landing: null,
    });
    expect(checkGoal(state, network)).toBe(true);
  });

  it("clears with no unused pips when the roll lands exactly on 新橋", () => {
    const atLast = applyRolls(newGame(), TO_LAST_STATION);
    const { state, unusedPips, stopReason, events } = moveByRoll(atLast, 1, network);
    expect(state.status).toBe("completed");
    expect(unusedPips).toBe(0);
    // A clearing move is a goal stop even without unused pips, and has no landing.
    expect(stopReason).toBe("goal");
    expect(state.movementHistory.at(-1)?.landing).toBeNull();
    expect(events.some((event) => event.type === "landing-resolved")).toBe(false);
  });

  it("keeps moving past 新橋 when not every segment is completed", () => {
    const incomplete: GameState = {
      ...newGame(),
      currentStationId: LAST_STATION,
      completedSegmentIds: SEGMENT_IDS.slice(5, 20),
    };
    const { state, events, unusedPips } = moveByRoll(incomplete, 3, network);
    expect(state.status).toBe("playing");
    expect(state.currentStationId).toBe("tamachi");
    expect(unusedPips).toBe(0);
    expect(events.some((event) => event.type === "goal-reached")).toBe(false);
  });

  it("does not allow rolling after completion", () => {
    const done = moveByRoll(applyRolls(newGame(), TO_LAST_STATION), 6, network).state;
    expect(() => moveByRoll(done, 1, network)).toThrowError(
      expect.objectContaining({ code: "GAME_NOT_PLAYING" }),
    );
    expect(() => playTurn(done, network)).toThrowError(
      expect.objectContaining({ code: "GAME_NOT_PLAYING" }),
    );
  });
});

describe("goal: exact-stop", () => {
  const config = configWith("exact-stop");

  it("does not clear when passing 新橋 and stopping elsewhere", () => {
    const atLast = applyRolls(newGame(config), TO_LAST_STATION);
    const { state, unusedPips } = moveByRoll(atLast, 3, network);
    expect(state.status).toBe("playing");
    expect(state.currentStationId).toBe("tamachi");
    expect(state.completedSegmentIds).toHaveLength(30);
    expect(unusedPips).toBe(0);
  });

  it("clears only when a later move ends exactly on 新橋", () => {
    const passed = applyRolls(newGame(config), [...TO_LAST_STATION, 3]);
    const nearly = applyRolls(passed, [6, 6, 6, 6]);
    expect(nearly.status).toBe("playing");
    expect(nearly.completedSegmentIds).toHaveLength(30);
    const { state } = moveByRoll(nearly, 4, network);
    expect(state.currentStationId).toBe(START);
    expect(state.status).toBe("completed");
  });
});

describe("goal: pass-through", () => {
  it("stops at 新橋 mid-move once every segment is done", () => {
    const atLast = applyRolls(newGame(configWith("pass-through")), TO_LAST_STATION);
    const { state, unusedPips } = moveByRoll(atLast, 6, network);
    expect(state.status).toBe("completed");
    expect(state.currentStationId).toBe(START);
    expect(unusedPips).toBe(5);
  });
});

describe("goal: boundaries", () => {
  it("is not a goal with all 30 segments done while away from 新橋", () => {
    const allDoneElsewhere: GameState = {
      ...newGame(),
      currentStationId: "tamachi",
      completedSegmentIds: [...SEGMENT_IDS],
    };
    expect(checkGoal(allDoneElsewhere, network)).toBe(false);
  });

  it("does not clear on landing exactly at 新橋 with segments still missing", () => {
    const incomplete: GameState = {
      ...newGame(),
      currentStationId: LAST_STATION,
      completedSegmentIds: SEGMENT_IDS.slice(0, 10),
    };
    const { state } = moveByRoll(incomplete, 1, network);
    expect(state.currentStationId).toBe(START);
    expect(state.status).toBe("playing");
    expect(checkGoal(state, network)).toBe(false);
  });
});

describe("goal: riding a non-target service (future multi-line rules)", () => {
  const shuttleNetwork = buildRailwayNetwork(inputWithShuttle());

  /** On the shuttle at test-b with every Yamanote segment already completed. */
  function onShuttle(policy: GameConfig["goalArrivalPolicy"]): GameState {
    return {
      ...createGame(configWith(policy), SEED, shuttleNetwork),
      currentServiceId: OTHER_SERVICE_ID,
      currentStationId: "test-b",
      completedSegmentIds: [...SEGMENT_IDS],
    };
  }

  it("truncate policy does not truncate when passing 新橋 off the target service", () => {
    // test-b is served by the shuttle only: a direction lottery (R1-a), injected here.
    const { state, events } = moveByRoll(
      onShuttle("truncate-on-target-service"),
      3,
      shuttleNetwork,
      { serviceId: OTHER_SERVICE_ID, direction: 1 },
    );
    expect(state.status).toBe("playing");
    expect(state.currentStationId).toBe("test-b");
    expect(events.some((event) => event.type === "goal-reached")).toBe(false);
  });

  it("truncate policy still clears on an exact stop at 新橋 off the target service", () => {
    const { state } = moveByRoll(onShuttle("truncate-on-target-service"), 1, shuttleNetwork);
    expect(state.status).toBe("completed");
    expect(state.currentStationId).toBe(START);
  });

  it("pass-through stops at 新橋 even off the target service", () => {
    const { state, unusedPips } = moveByRoll(onShuttle("pass-through"), 3, shuttleNetwork);
    expect(state.status).toBe("completed");
    expect(state.currentStationId).toBe(START);
    expect(unusedPips).toBe(2);
  });

  it("does not count shuttle segments towards the target", () => {
    const fresh: GameState = {
      ...createGame(DEFAULT_CONFIG, SEED, shuttleNetwork),
      currentServiceId: OTHER_SERVICE_ID,
    };
    // Back on 新橋 (Yamanote + shuttle): a service lottery, injected here.
    const { state } = moveByRoll(fresh, 3, shuttleNetwork, {
      serviceId: OTHER_SERVICE_ID,
      direction: 1,
    });
    expect(state.completedSegmentIds).toHaveLength(3);
    expect(state.status).toBe("playing");
    expect(checkGoal(state, shuttleNetwork)).toBe(false);
  });
});

describe("playTurn and determinism", () => {
  function playUntilDone(seed: string, maxTurns = 200): { rolls: number[]; state: GameState } {
    let state = createGame(DEFAULT_CONFIG, seed, network);
    const rolls: number[] = [];
    while (state.status === "playing" && rolls.length < maxTurns) {
      const result = playTurn(state, network);
      rolls.push(result.roll);
      state = result.state;
    }
    return { rolls, state };
  }

  it("advances the RNG state on every played turn", () => {
    const start = newGame();
    const { state } = playTurn(start, network);
    expect(state.rngState).not.toBe(start.rngState);
    expect(state.rngSeed).toBe(start.rngSeed);
  });

  it("reproduces identical rolls and state from the same seed", () => {
    expect(playUntilDone("same-seed")).toEqual(playUntilDone("same-seed"));
  });

  it("produces a different dice sequence for a different seed", () => {
    expect(playUntilDone("seed-one").rolls).not.toEqual(playUntilDone("seed-two").rolls);
  });

  it("a full game ends at 新橋 with exactly 30 segments traversed once", () => {
    const { state } = playUntilDone("full-game");
    expect(state.status).toBe("completed");
    expect(state.currentStationId).toBe(START);
    expect([...state.completedSegmentIds].sort()).toEqual([...SEGMENT_IDS].sort());
    const traversed = state.movementHistory.flatMap((move) => move.traversedSegmentIds);
    expect(traversed).toEqual(SEGMENT_IDS);
    expect(state.turn).toBe(state.movementHistory.length);
  });
});
