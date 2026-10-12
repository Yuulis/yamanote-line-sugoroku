import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  checkGoal,
  createGame,
  drawIndex,
  drawLanding,
  type LandingResolvedEvent,
  landingOptions,
  type MoveResult,
  moveByRoll,
  playTurn,
  rollDie,
  seedRng,
  targetSegmentIds,
  validateConfig,
} from "../../src/features/game/engine";
import type { Direction, GameConfig, GameState, LandingChoice } from "../../src/types/network";
import {
  bothWays,
  LOOP_SEGMENT_IDS,
  M_LINE,
  M_LOOP,
  M_SPUR,
  M_START,
  multiConfig,
  multiServiceInput,
} from "./fixtures/multiService";
import {
  configWith,
  deepFreeze,
  SEGMENT_IDS,
  SERVICE_ID,
  START,
  yamanoteInput,
} from "./fixtures/yamanote";

const network = buildRailwayNetwork(deepFreeze(multiServiceInput()));
const INVALID_STATE = expect.objectContaining({ code: "INVALID_STATE" });

function newGame(config: GameConfig = multiConfig()): GameState {
  return createGame(config, "landing-seed", network);
}

/** A settled position on any service (the engine accepts any settled state). */
function at(stationId: string, serviceId: string, direction: Direction): GameState {
  return { ...newGame(), currentStationId: stationId, currentServiceId: serviceId, direction };
}

function landingEvents(result: MoveResult): LandingResolvedEvent[] {
  return result.events.filter(
    (event): event is LandingResolvedEvent => event.type === "landing-resolved",
  );
}

function choice(serviceId: string, direction: Direction): LandingChoice {
  return { serviceId, direction };
}

/**
 * The RNG contract, re-derived from first principles: one rollDie, then a
 * service draw iff required, then a direction draw iff required; nothing
 * else. Returns the number of lotteries the turn ran.
 */
function expectRngContract(before: GameState, result: MoveResult): number {
  const roll = rollDie(before.rngState);
  expect(result.roll).toBe(roll.value);
  let state = roll.nextRngState;
  const [landing, ...extra] = landingEvents(result);
  expect(extra).toEqual([]);
  let lotteries = 0;
  if (landing?.serviceDrawRequired) {
    const draw = drawIndex(state, landing.serviceCandidates.length);
    expect(landing.serviceCandidates[draw.index]).toBe(landing.serviceId);
    state = draw.nextRngState;
    lotteries += 1;
  }
  if (landing?.directionDrawRequired) {
    const draw = drawIndex(state, landing.directionCandidates.length);
    expect(landing.directionCandidates[draw.index]).toBe(landing.direction);
    state = draw.nextRngState;
    lotteries += 1;
  }
  expect(result.state.rngState).toBe(state);
  return lotteries;
}

describe("landing happens at the arrival station only", () => {
  it("passes the transfer station b and resolves only at c (forced, no draw)", () => {
    const result = moveByRoll(newGame(), 3, network);
    expect(result.state.currentStationId).toBe("c");
    expect(landingEvents(result)).toEqual([
      {
        type: "landing-resolved",
        stationId: "c",
        serviceCandidates: [M_LOOP],
        serviceId: M_LOOP,
        serviceDrawRequired: false,
        directionCandidates: [1],
        direction: 1,
        directionDrawRequired: false,
        changedService: false,
      },
    ]);
    expect(result.state.movementHistory[0]?.landing).toEqual(choice(M_LOOP, 1));
  });

  it("puts the landing event last, after every hop", () => {
    const { events } = moveByRoll(newGame(), 2, network, choice(M_LINE, 1));
    expect(events.map((event) => event.type)).toEqual([
      "segment-traversed",
      "segment-traversed",
      "landing-resolved",
    ]);
  });
});

describe("service lottery (k >= 2)", () => {
  const atB = { ...newGame(), currentStationId: "b" };

  it("offers every service at b in data order, the ridden one included", () => {
    const options = landingOptions(atB, network);
    expect(options.services).toEqual([M_LOOP, M_LINE, M_SPUR]);
    expect(options.serviceDrawRequired).toBe(true);
    expect(Object.fromEntries(options.directionsByService)).toEqual({
      [M_LOOP]: [1],
      [M_LINE]: [1, -1],
      [M_SPUR]: [1],
    });
  });

  it("requires a choice: omitted or null is rejected", () => {
    expect(() => moveByRoll(newGame(), 2, network)).toThrowError(INVALID_STATE);
    expect(() => moveByRoll(newGame(), 2, network, null)).toThrowError(INVALID_STATE);
  });

  it("applies an injected transfer without touching the RNG", () => {
    const start = newGame();
    const result = moveByRoll(start, 2, network, choice(M_LINE, -1));
    expect(result.state).toMatchObject({
      currentStationId: "b",
      currentServiceId: M_LINE,
      direction: -1,
      rngState: start.rngState,
    });
    expect(landingEvents(result)[0]).toMatchObject({
      serviceDrawRequired: true,
      directionCandidates: [1, -1],
      directionDrawRequired: true,
      changedService: true,
    });
    // The record keeps the ridden service; the landing holds the result.
    expect(result.state.movementHistory[0]).toMatchObject({
      serviceId: M_LOOP,
      direction: 1,
      landing: choice(M_LINE, -1),
    });
  });

  it("may keep the target service, always in the target direction", () => {
    const kept = moveByRoll(newGame(), 2, network, choice(M_LOOP, 1));
    expect(landingEvents(kept)[0]).toMatchObject({
      changedService: false,
      directionCandidates: [1],
      directionDrawRequired: false,
    });
    expect(() => moveByRoll(newGame(), 2, network, choice(M_LOOP, -1))).toThrowError(
      INVALID_STATE,
    );
  });

  it("forces the only movable direction of a service boarded at its end", () => {
    const spur = moveByRoll(newGame(), 2, network, choice(M_SPUR, 1));
    expect(landingEvents(spur)[0]).toMatchObject({
      serviceDrawRequired: true,
      directionCandidates: [1],
      directionDrawRequired: false,
    });
    expect(() => moveByRoll(newGame(), 2, network, choice(M_SPUR, -1))).toThrowError(
      INVALID_STATE,
    );
  });

  it("rejects a service that does not stop at the arrival station", () => {
    expect(() => moveByRoll(newGame(), 2, network, choice("nope", 1))).toThrowError(
      INVALID_STATE,
    );
    // d has the loop and the line, not the spur.
    expect(() => moveByRoll(newGame(), 4, network, choice(M_SPUR, 1))).toThrowError(
      INVALID_STATE,
    );
  });

  it("draws the service uniformly, then the direction only for the line", () => {
    const options = landingOptions(atB, network);
    const samples = 30_000;
    const counts = new Map<string, number>();
    let state = seedRng("service-lottery");
    for (let index = 0; index < samples; index += 1) {
      const drawn = drawLanding(options, state);
      const key = `${drawn.choice.serviceId}:${drawn.choice.direction}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      // Exactly one draw for the loop and the spur, two for the line.
      const afterService = drawIndex(state, 3).nextRngState;
      const expected =
        drawn.choice.serviceId === M_LINE ? drawIndex(afterService, 2).nextRngState : afterService;
      expect(drawn.nextRngState).toBe(expected);
      state = drawn.nextRngState;
    }
    expect([...counts.keys()].sort()).toEqual(
      [`${M_LINE}:-1`, `${M_LINE}:1`, `${M_LOOP}:1`, `${M_SPUR}:1`].sort(),
    );
    // Uniform over services (a two-direction service is not favoured).
    const perService = [M_LOOP, M_LINE, M_SPUR].map((serviceId) =>
      [...counts].reduce((sum, [key, count]) => (key.startsWith(`${serviceId}:`) ? sum + count : sum), 0),
    );
    const expected = samples / 3;
    const chiSquare = perService.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(13.82); // df = 2, p = 0.001
    const lineUp = counts.get(`${M_LINE}:1`) ?? 0;
    const lineDown = counts.get(`${M_LINE}:-1`) ?? 0;
    const lineMean = (lineUp + lineDown) / 2;
    expect(((lineUp - lineMean) ** 2 + (lineDown - lineMean) ** 2) / lineMean).toBeLessThan(10.83);
  });
});

describe("single-service stations (k = 1)", () => {
  it("target-only station: forced outer direction, no draw", () => {
    const options = landingOptions({ ...newGame(), currentStationId: "c" }, network);
    const rng = seedRng("no-draw");
    expect(drawLanding(options, rng)).toEqual({ choice: choice(M_LOOP, 1), nextRngState: rng });
  });

  it("R1-a: re-draws the direction on an unchanged non-target service", () => {
    const onLine = at("b", M_LINE, 1);
    expect(() => moveByRoll(onLine, 1, network)).toThrowError(INVALID_STATE);
    const result = moveByRoll(onLine, 1, network, choice(M_LINE, -1));
    expect(result.state).toMatchObject({ currentStationId: "y", currentServiceId: M_LINE, direction: -1 });
    expect(landingEvents(result)[0]).toMatchObject({
      serviceCandidates: [M_LINE],
      serviceDrawRequired: false,
      directionCandidates: [1, -1],
      directionDrawRequired: true,
      changedService: false,
    });
    const options = landingOptions({ ...onLine, currentStationId: "y" }, network);
    const rng = seedRng("direction-only");
    const drawn = drawLanding(options, rng);
    expect(drawn.nextRngState).toBe(drawIndex(rng, 2).nextRngState);
    expect(drawn.choice.direction).toBe(([1, -1] as const)[drawIndex(rng, 2).index]);
  });

  it("lands exactly on a terminus: a roll stop with a forced reversal and no draw", () => {
    const result = moveByRoll(at("y", M_LINE, -1), 2, network);
    expect(result.stopReason).toBe("roll");
    expect(result.unusedPips).toBe(0);
    expect(result.events.some((event) => event.type === "endpoint-reached")).toBe(false);
    expect(result.state).toMatchObject({ currentStationId: "x", direction: 1 });
    expect(landingEvents(result)[0]).toMatchObject({
      directionCandidates: [1],
      directionDrawRequired: false,
    });
    const options = landingOptions({ ...result.state }, network);
    const rng = seedRng("terminus");
    expect(drawLanding(options, rng).nextRngState).toBe(rng);
  });
});

describe("endpoint truncation (terminus / area boundary)", () => {
  it("stops at the terminus x and discards the remaining pips", () => {
    const result = moveByRoll(at("y", M_LINE, -1), 5, network);
    expect(result.stopReason).toBe("endpoint");
    expect(result.unusedPips).toBe(3);
    expect(result.events).toEqual([
      expect.objectContaining({ type: "segment-traversed", step: 1, toStationId: "b" }),
      expect.objectContaining({ type: "segment-traversed", step: 2, toStationId: "x" }),
      { type: "endpoint-reached", step: 2, stationId: "x", discardedPips: 3 },
      expect.objectContaining({ type: "landing-resolved", stationId: "x", direction: 1 }),
    ]);
    expect(result.state.movementHistory[0]).toMatchObject({
      roll: 5,
      toStationId: "x",
      traversedSegmentIds: [`${M_LINE}:y:b`, `${M_LINE}:b:x`],
      stopReason: "endpoint",
      landing: choice(M_LINE, 1),
    });
    expect(result.state.status).toBe("playing");
  });

  it("stops at the area boundary z, passing the transfer station d without a landing", () => {
    const result = moveByRoll(at("y", M_LINE, 1), 6, network);
    expect(result).toMatchObject({ stopReason: "endpoint", unusedPips: 4 });
    expect(result.state).toMatchObject({ currentStationId: "z", direction: -1 });
    expect(landingEvents(result).map((event) => event.stationId)).toEqual(["z"]);
  });

  it("stops at the end of the spur", () => {
    const result = moveByRoll(at("b", M_SPUR, 1), 4, network);
    expect(result).toMatchObject({ stopReason: "endpoint", unusedPips: 2 });
    expect(result.state).toMatchObject({ currentStationId: "s2", currentServiceId: M_SPUR, direction: -1 });
  });

  it("never mistakes a missing segment for an endpoint", () => {
    const input = multiServiceInput();
    const gap = buildRailwayNetwork({
      ...input,
      segments: input.segments.filter((segment) => segment.id !== `${M_LINE}:y:b`),
    });
    expect(() => moveByRoll(at("y", M_LINE, -1), 1, gap)).toThrowError(INVALID_STATE);
  });
});

describe("unsettled positions are rejected", () => {
  it.each<[string, GameState]>([
    ["facing off the terminus", at("x", M_LINE, -1)],
    ["riding the target the wrong way", at("a", M_LOOP, -1)],
    ["an invalid direction", at("y", M_LINE, 2 as Direction)],
    ["a station off its service", at("a", M_LINE, 1)],
  ])("%s", (_label, state) => {
    expect(() => moveByRoll(state, 1, network)).toThrowError(INVALID_STATE);
  });
});

describe("goal precedence with endpoints", () => {
  // Yamanote plus a 2-stop line ending at 新橋. validateConfig forbids this
  // (the start may not be a linear endpoint), so the state is built by hand
  // to pin the movement predicate itself.
  const STUB = "test-stub";
  const yamanote = buildRailwayNetwork(yamanoteInput());
  const base = yamanoteInput();
  const stubNetwork = buildRailwayNetwork({
    ...base,
    stations: [...base.stations, { id: "stub-x", name: "stub-x", coordinates: [139, 35] }],
    services: [
      ...base.services,
      { id: STUB, name: "stub", operator: "test", stationIds: ["stub-x", START], circular: false, color: "#000", directionLabels: { forward: "正方向", backward: "逆方向" }, platformCoordinates: { "stub-x": [139, 35], [START]: [139.7, 35.6] }, endpoints: { first: "terminus", last: "terminus" } },
    ],
    segments: [...base.segments, ...bothWays(STUB, ["stub-x", START])],
  });

  function onStub(policy: GameConfig["goalArrivalPolicy"]): GameState {
    return {
      ...createGame(configWith(policy), "stub", yamanote),
      currentServiceId: STUB,
      currentStationId: "stub-x",
      direction: 1,
      completedSegmentIds: [...SEGMENT_IDS],
    };
  }

  it("the data rules forbid the start station as a linear endpoint", () => {
    expect(() => validateConfig(configWith("truncate-on-target-service"), stubNetwork)).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIG" }),
    );
  });

  it("endpoint truncation at 新橋 is not an exact stop", () => {
    const result = moveByRoll(onStub("truncate-on-target-service"), 3, stubNetwork, choice(SERVICE_ID, 1));
    expect(result.state.status).toBe("playing");
    expect(result).toMatchObject({ stopReason: "endpoint", unusedPips: 2 });
    expect(result.events.some((event) => event.type === "goal-reached")).toBe(false);
    const exactOnly = moveByRoll(onStub("exact-stop"), 3, stubNetwork, choice(SERVICE_ID, 1));
    expect(exactOnly.state.status).toBe("playing");
  });

  it("an exact stop at 新橋 still clears off the target service", () => {
    const result = moveByRoll(onStub("truncate-on-target-service"), 1, stubNetwork);
    expect(result.state.status).toBe("completed");
    expect(result).toMatchObject({ stopReason: "goal", unusedPips: 0 });
  });

  it("goal wins over endpoint when the policy truncates there", () => {
    const result = moveByRoll(onStub("pass-through"), 3, stubNetwork);
    expect(result.state.status).toBe("completed");
    expect(result).toMatchObject({ stopReason: "goal", unusedPips: 2 });
    expect(result.events.map((event) => event.type)).toEqual(["segment-traversed", "goal-reached"]);
  });
});

describe("clearing turns", () => {
  const yamanote = buildRailwayNetwork(yamanoteInput());
  const config = configWith("truncate-on-target-service");

  function nearlyDone(): GameState {
    let state = createGame(config, "clear", yamanote);
    for (const roll of [6, 6, 6, 6, 5]) state = moveByRoll(state, roll, yamanote).state;
    return state;
  }

  it("takes no landing: a supplied choice is rejected, null is accepted", () => {
    expect(() => moveByRoll(nearlyDone(), 4, yamanote, choice(SERVICE_ID, 1))).toThrowError(
      INVALID_STATE,
    );
    const result = moveByRoll(nearlyDone(), 4, yamanote, null);
    expect(result.state.status).toBe("completed");
    expect(result.state.movementHistory.at(-1)?.landing).toBeNull();
    expect(landingEvents(result)).toEqual([]);
  });

  it("a Yamanote-only seeded game consumes exactly the plain dice sequence", () => {
    // Same seed as the rollDie snapshot in engine-rng.test.ts: 2 6 1 3 1 4 2 6 1 4 = 30.
    let state = createGame(config, "yamanote", yamanote);
    let dice = state.rngState;
    const rolls: number[] = [];
    while (state.status === "playing") {
      const result = playTurn(state, yamanote);
      const die = rollDie(dice);
      expect(result.roll).toBe(die.value);
      expect(result.state.rngState).toBe(die.nextRngState);
      expect(expectRngContract(state, result)).toBe(0);
      rolls.push(result.roll);
      dice = die.nextRngState;
      state = result.state;
    }
    expect(rolls).toEqual([2, 6, 1, 3, 1, 4, 2, 6, 1, 4]);
    expect(state.movementHistory.at(-1)).toMatchObject({ stopReason: "goal", landing: null });
  });
});

describe("progress counts the target service only", () => {
  it("line segments are completed for the map but never count towards the goal", () => {
    const onLine = moveByRoll(newGame(), 2, network, choice(M_LINE, 1)).state;
    const { state } = moveByRoll(onLine, 2, network, choice(M_LOOP, 1));
    expect(state.completedSegmentIds).toEqual([
      LOOP_SEGMENT_IDS[0],
      LOOP_SEGMENT_IDS[1],
      `${M_LINE}:b:y`,
      `${M_LINE}:y:d`,
    ]);
    const target = new Set(targetSegmentIds(state.config, network));
    expect(state.completedSegmentIds.filter((id) => target.has(id))).toHaveLength(2);
    expect(checkGoal(state, network)).toBe(false);
  });
});

describe("seeded play on the multi-service fixture", () => {
  function playSeeded(seed: string): { results: MoveResult[]; states: GameState[] } {
    let state = createGame(multiConfig(), seed, network);
    const results: MoveResult[] = [];
    const states: GameState[] = [state];
    while (state.status === "playing") {
      const result = playTurn(state, network);
      results.push(result);
      state = result.state;
      states.push(state);
    }
    return { results, states };
  }

  it("follows the draw contract on every turn and locks the mixed-turn sequence", () => {
    const { results, states } = playSeeded("mixed-30");
    const lotteries = results.map((result, index) => expectRngContract(states[index]!, result));
    // 0, 1 and 2 lotteries, an endpoint stop and a clear all occur in this game.
    expect(new Set(lotteries)).toEqual(new Set([0, 1, 2]));
    expect(results.some((result) => result.stopReason === "endpoint")).toBe(true);
    expect(results.at(-1)?.stopReason).toBe("goal");
    // Changing this sequence changes every seeded game: bump rulesetVersion instead.
    expect(
      results.map(({ state }) => {
        const record = state.movementHistory.at(-1)!;
        const landing = record.landing ? `${record.landing.serviceId}/${record.landing.direction}` : "-";
        return `${record.roll} ${record.serviceId}/${record.direction} ${record.fromStationId}->${record.toStationId} ${record.stopReason} ${landing}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "4 m-loop/1 start->d roll m-line/1",
        "6 m-line/1 d->z endpoint m-line/-1",
        "3 m-line/-1 z->b roll m-line/-1",
        "1 m-line/-1 b->x roll m-line/1",
        "6 m-line/1 x->z endpoint m-line/-1",
        "6 m-line/-1 z->x endpoint m-line/1",
        "3 m-line/1 x->d roll m-loop/1",
        "4 m-loop/1 d->start goal -",
      ]
    `);
  });

  it("is deterministic per seed", () => {
    expect(playSeeded("mixed-7").states.at(-1)).toEqual(playSeeded("mixed-7").states.at(-1));
  });
});

describe("immutability", () => {
  it("never mutates its inputs and copies the supplied choice into the record", () => {
    const start = deepFreeze(newGame());
    const snapshot = structuredClone(start);
    const supplied = choice(M_LINE, 1);
    const { state } = moveByRoll(start, 2, network, supplied);
    expect(start).toEqual(snapshot);
    supplied.direction = -1;
    supplied.serviceId = M_SPUR;
    expect(state.movementHistory[0]?.landing).toEqual(choice(M_LINE, 1));
    expect(state.direction).toBe(1);
    expect(state.currentServiceId).toBe(M_LINE);
    expect(M_START).toBe(start.currentStationId);
  });
});
