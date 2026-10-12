// Save format v2: landing records, whole-record replay, seeded verification
// and long histories on multi-service fixtures.

import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  createGame,
  moveByRoll,
  playTurn,
  type RailwayNetwork,
  restoreGame,
  SAVE_VERSION,
  serializeGame,
  verifySeededHistory,
} from "../../src/features/game/engine";
import type { GameState, LandingChoice, MoveRecord } from "../../src/types/network";
import {
  longLineInput,
  M_LINE,
  M_LOOP,
  M_SPUR,
  multiConfig,
  multiServiceInput,
} from "./fixtures/multiService";

const network = buildRailwayNetwork(multiServiceInput());
const PRODUCTION = { expectedConfig: multiConfig(), requireSeededRolls: true } as const;
const INVALID_SAVE = expect.objectContaining({ code: "INVALID_SAVE" });
const RNG_MISMATCH = expect.objectContaining({ code: "RNG_MISMATCH" });

/** Seed whose first 8 turns cover 0/1/2 lotteries, endpoints and a clear. */
const MIXED_SEED = "mixed-30";
/** Seed that wanders the long line for well over 1,200 turns. */
const LONG_SEED = "long-118";

function seededStates(seed: string, net: RailwayNetwork, maxTurns: number): GameState[] {
  let state = createGame(multiConfig(), seed, net);
  const states = [state];
  while (state.status === "playing" && state.turn < maxTurns) {
    state = playTurn(state, net).state;
    states.push(state);
  }
  return states;
}

function choice(serviceId: string, direction: 1 | -1): LandingChoice {
  return { serviceId, direction };
}

/** Injected path: transfer at b, direction-only lottery at y, terminus truncation at x. */
function injectedStates(): GameState[] {
  const fresh = createGame(multiConfig(), "inject", network);
  const transferred = moveByRoll(fresh, 2, network, choice(M_LINE, 1)).state;
  const directionOnly = moveByRoll(transferred, 1, network, choice(M_LINE, -1)).state;
  const truncated = moveByRoll(directionOnly, 5, network).state;
  return [fresh, transferred, directionOnly, truncated];
}

function tampered(state: GameState, edit: (raw: Record<string, unknown>) => void): string {
  const raw = JSON.parse(serializeGame(state)) as Record<string, unknown>;
  edit(raw);
  return JSON.stringify(raw);
}

function historyOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  return raw.movementHistory as Record<string, unknown>[];
}

describe("save v2 round trips", () => {
  it("writes saveVersion 2 with stopReason and landing on every record", () => {
    expect(SAVE_VERSION).toBe(2);
    const truncated = injectedStates()[3]!;
    const raw = JSON.parse(serializeGame(truncated)) as Record<string, unknown>;
    expect(raw.saveVersion).toBe(2);
    expect(historyOf(raw).map((record) => [record.stopReason, record.landing])).toEqual([
      ["roll", choice(M_LINE, 1)],
      ["roll", choice(M_LINE, -1)],
      ["endpoint", choice(M_LINE, 1)],
    ]);
  });

  it.each([
    ["fresh", 0],
    ["transferred", 1],
    ["direction-only lottery", 2],
    ["endpoint-truncated", 3],
  ])("restores a %s game exactly", (_label, index) => {
    const state = injectedStates()[index]!;
    expect(restoreGame(serializeGame(state), network)).toEqual(state);
  });

  it("restores seeded games at every turn, completed included, under production checks", () => {
    const states = seededStates(MIXED_SEED, network, 100);
    expect(states.at(-1)?.status).toBe("completed");
    for (const state of states) {
      expect(restoreGame(serializeGame(state), network, PRODUCTION)).toEqual(state);
    }
  });

  it("a restored seeded save reproduces the next MoveResult", () => {
    const states = seededStates(MIXED_SEED, network, 100);
    for (const state of states.filter((item) => item.status === "playing")) {
      const restored = restoreGame(serializeGame(state), network, PRODUCTION);
      expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });
});

describe("save v2 rejects malformed landing records", () => {
  const mid = injectedStates()[3]!;

  it.each<[string, (record: Record<string, unknown>) => void]>([
    ["missing stopReason", (record) => delete record.stopReason],
    ["unknown stopReason", (record) => (record.stopReason = "stopped")],
    ["missing landing", (record) => delete record.landing],
    ["string landing", (record) => (record.landing = "m-line")],
    ["landing without service", (record) => (record.landing = { direction: 1 })],
    ["landing with a bad direction", (record) => (record.landing = { serviceId: M_LINE, direction: 0 })],
  ])("%s", (_label, edit) => {
    const json = tampered(mid, (raw) => edit(historyOf(raw)[0]!));
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });
});

describe("save v2 rejects records that contradict the rules", () => {
  const [, transferred, , truncated] = injectedStates() as [GameState, GameState, GameState, GameState];

  /** Edit one record and keep the saved position consistent with it. */
  function editLastLanding(state: GameState, landing: LandingChoice | null): string {
    return tampered(state, (raw) => {
      historyOf(raw).at(-1)!.landing = landing;
      if (landing) {
        raw.currentServiceId = landing.serviceId;
        raw.direction = landing.direction;
      }
    });
  }

  it("an illegal direction for the chosen service", () => {
    // b: the spur can only be boarded towards s1.
    expect(() => restoreGame(editLastLanding(transferred, choice(M_SPUR, -1)), network)).toThrowError(
      INVALID_SAVE,
    );
    // b: the target service is only ridden in the target direction.
    expect(() => restoreGame(editLastLanding(transferred, choice(M_LOOP, -1)), network)).toThrowError(
      INVALID_SAVE,
    );
  });

  it("a forced landing recorded differently", () => {
    // x is the line's terminus: only +1 is possible.
    expect(() => restoreGame(editLastLanding(truncated, choice(M_LINE, -1)), network)).toThrowError(
      INVALID_SAVE,
    );
  });

  it("a null landing on a move that did not clear", () => {
    expect(() => restoreGame(editLastLanding(truncated, null), network)).toThrowError(INVALID_SAVE);
  });

  it("a landing on the move that cleared", () => {
    const done = seededStates(MIXED_SEED, network, 100).at(-1)!;
    expect(() => restoreGame(editLastLanding(done, choice(M_LOOP, 1)), network)).toThrowError(
      INVALID_SAVE,
    );
  });

  it.each([
    ["roll", "endpoint"],
    ["endpoint", "roll"],
  ])("a stop reason changed from %s", (from, to) => {
    const json = tampered(truncated, (raw) => {
      const record = historyOf(raw).find((item) => item.stopReason === from);
      if (!record) throw new Error(`fixture has no ${from} stop`);
      record.stopReason = to;
    });
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });

  it("a saved service or direction that differs from the last landing", () => {
    const json = tampered(transferred, (raw) => {
      raw.direction = -1;
    });
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });
});

describe("save v2 seeded verification", () => {
  const states = seededStates(MIXED_SEED, network, 100);
  // Turn 1 of the mixed seed lands at d and draws the line towards z.
  const seededFirst = states[1]!;

  it.each([
    ["another service", choice(M_LOOP, 1)],
    ["the same service, other direction", choice(M_LINE, -1)],
  ])("a legal but non-seeded landing (%s) is an RNG mismatch", (_label, alternative) => {
    const record = seededFirst.movementHistory[0] as MoveRecord;
    expect(record.landing).toEqual(choice(M_LINE, 1));
    const forged = moveByRoll(states[0]!, record.roll, network, alternative).state;
    const json = serializeGame({ ...forged, rngState: seededFirst.rngState });
    // Legal under the rules, so the structural pass accepts it ...
    expect(() => restoreGame(json, network)).not.toThrow();
    // ... but the seed did not draw it.
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(RNG_MISMATCH);
  });

  it("an rngState that skipped the landing draws is an RNG mismatch", () => {
    // Same records, but the RNG advanced by the die only.
    const json = tampered(seededFirst, (raw) => {
      raw.rngState = states[0]!.rngState;
    });
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(RNG_MISMATCH);
  });
});

describe("long histories (> 300 turns)", () => {
  const long = buildRailwayNetwork(longLineInput());
  const states = seededStates(LONG_SEED, long, 1200);
  const config = { expectedConfig: multiConfig(), requireSeededRolls: true } as const;

  it("the pinned seed plays 1,200 turns without clearing", () => {
    expect(states.at(-1)).toMatchObject({ status: "playing", turn: 1200 });
  });

  it.each([300, 1200])("restores a %d-turn seeded save and resumes identically", (turns) => {
    const state = states[turns]!;
    const restored = restoreGame(serializeGame(state), long, config);
    expect(restored).toEqual(state);
    expect(playTurn(restored, long)).toEqual(playTurn(state, long));
  });

  it("replay reads each saved record exactly once (no per-turn history rebuild)", () => {
    const state = states[1200]!;
    let reads = 0;
    const history = new Proxy(state.movementHistory, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    verifySeededHistory({ ...state, movementHistory: history }, long);
    expect(reads).toBe(1200);
  });

  it("restores within a generous time budget (measured, not a complexity proof)", () => {
    const json = serializeGame(states[1200]!);
    const started = performance.now();
    restoreGame(json, long, config);
    const elapsedMs = performance.now() - started;
    // Measured locally at a few tens of ms; the budget only catches pathologies.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
