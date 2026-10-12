import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  createGame,
  moveByRoll,
  playTurn,
  restoreGame,
  seedRng,
  serializeGame,
} from "../../src/features/game/engine";
import type { GameState } from "../../src/types/network";
import { DEFAULT_CONFIG, segmentId, yamanoteInput } from "./fixtures/yamanote";

const network = buildRailwayNetwork(yamanoteInput());

function playTurns(count: number, seed = "save-seed"): GameState {
  let state = createGame(DEFAULT_CONFIG, seed, network);
  for (let index = 0; index < count; index += 1) state = playTurn(state, network).state;
  return state;
}

function completedGame(): GameState {
  let state = createGame(DEFAULT_CONFIG, "save-seed", network);
  for (const roll of [6, 6, 6, 6, 5, 6]) state = moveByRoll(state, roll, network).state;
  return state;
}

/** Serialise, apply `edit` to the parsed JSON, and serialise again. */
function tampered(state: GameState, edit: (raw: Record<string, unknown>) => void): string {
  const raw = JSON.parse(serializeGame(state)) as Record<string, unknown>;
  edit(raw);
  return JSON.stringify(raw);
}

const INVALID_SAVE = expect.objectContaining({ code: "INVALID_SAVE" });

describe("serializeGame / restoreGame round trip", () => {
  it("restores a fresh game exactly", () => {
    const state = createGame(DEFAULT_CONFIG, "fresh", network);
    expect(restoreGame(serializeGame(state), network)).toEqual(state);
  });

  it("restores a mid-game state exactly and yields the same next roll", () => {
    const state = playTurns(4);
    const restored = restoreGame(serializeGame(state), network);
    expect(restored).toEqual(state);
    const original = playTurn(state, network);
    const resumed = playTurn(restored, network);
    expect(resumed.roll).toBe(original.roll);
    expect(resumed.state).toEqual(original.state);
  });

  it("restores a completed game that still refuses further rolls", () => {
    const state = completedGame();
    const restored = restoreGame(serializeGame(state), network);
    expect(restored).toEqual(state);
    expect(() => playTurn(restored, network)).toThrowError(
      expect.objectContaining({ code: "GAME_NOT_PLAYING" }),
    );
  });

  it("ignores unknown extra keys instead of carrying them over", () => {
    const state = playTurns(2);
    const json = tampered(state, (raw) => {
      raw.extra = "ignored";
    });
    expect(restoreGame(json, network)).toEqual(state);
  });
});

describe("restoreGame rejects invalid saves", () => {
  it.each(["", "not json", "null", "[]", "42"])("rejects %j", (json) => {
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });

  it("rejects an unknown save version", () => {
    // Version 2 is now current; 3 stands for any future, unknown format.
    const json = tampered(playTurns(1), (raw) => {
      raw.saveVersion = 3;
    });
    expect(() => restoreGame(json, network)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SAVE_VERSION" }),
    );
  });

  it("rejects a v1 save (no migration) before looking at its shape", () => {
    const json = tampered(playTurns(2), (raw) => {
      raw.saveVersion = 1;
      for (const record of raw.movementHistory as Record<string, unknown>[]) {
        delete record.stopReason;
        delete record.landing;
      }
    });
    expect(() => restoreGame(json, network)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SAVE_VERSION" }),
    );
  });

  it.each([
    ["missing saveVersion", (raw: Record<string, unknown>) => delete raw.saveVersion],
    ["string saveVersion", (raw: Record<string, unknown>) => (raw.saveVersion = "1")],
    ["moving status", (raw: Record<string, unknown>) => (raw.status = "moving")],
    ["ready status", (raw: Record<string, unknown>) => (raw.status = "ready")],
    ["missing config", (raw: Record<string, unknown>) => delete raw.config],
    ["negative turn", (raw: Record<string, unknown>) => (raw.turn = -1)],
    ["fractional turn", (raw: Record<string, unknown>) => (raw.turn = 1.5)],
    ["bad direction", (raw: Record<string, unknown>) => (raw.direction = 0)],
    ["malformed rngState", (raw: Record<string, unknown>) => (raw.rngState = "abc")],
    ["empty rngSeed", (raw: Record<string, unknown>) => (raw.rngSeed = "")],
    ["non-array history", (raw: Record<string, unknown>) => (raw.movementHistory = {})],
    [
      "unknown goal policy",
      (raw: Record<string, unknown>) =>
        ((raw.config as Record<string, unknown>).goalArrivalPolicy = "anything"),
    ],
  ])("rejects a save with %s", (_label, edit) => {
    expect(() => restoreGame(tampered(playTurns(3), edit), network)).toThrowError(INVALID_SAVE);
  });

  it("rejects a save made with different railway data", () => {
    const json = tampered(playTurns(1), (raw) => {
      raw.dataVersion = "other-data";
    });
    expect(() => restoreGame(json, network)).toThrowError(
      expect.objectContaining({ code: "DATA_VERSION_MISMATCH" }),
    );
  });

  it.each([
    ["a moved current station", (raw: Record<string, unknown>) => (raw.currentStationId = "tokyo")],
    ["a skipped turn number", (raw: Record<string, unknown>) => (raw.turn = 7)],
    [
      "an extra completed segment",
      (raw: Record<string, unknown>) =>
        (raw.completedSegmentIds = [...(raw.completedSegmentIds as string[]), segmentId(29)]),
    ],
    ["a forced completed status", (raw: Record<string, unknown>) => (raw.status = "completed")],
    [
      "an edited roll",
      (raw: Record<string, unknown>) => {
        const [first] = raw.movementHistory as Record<string, unknown>[];
        if (first) first.roll = first.roll === 6 ? 5 : 6;
      },
    ],
  ])("rejects a save whose state contradicts its history: %s", (_label, edit) => {
    expect(() => restoreGame(tampered(playTurns(3), edit), network)).toThrowError(INVALID_SAVE);
  });

  it("rejects a history roll outside 1-6", () => {
    const json = tampered(playTurns(2), (raw) => {
      const [first] = raw.movementHistory as Record<string, unknown>[];
      if (first) first.roll = 9;
    });
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });

  it("rejects a move recorded after the game was completed", () => {
    const done = completedGame();
    const json = tampered(done, (raw) => {
      const history = raw.movementHistory as Record<string, unknown>[];
      const last = history.at(-1);
      raw.movementHistory = [...history, { ...last, turn: history.length + 1 }];
      raw.turn = history.length + 1;
    });
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });

  it("rejects a new game whose rngState does not come from its seed", () => {
    const json = tampered(createGame(DEFAULT_CONFIG, "save-seed", network), (raw) => {
      raw.rngState = seedRng("other-seed");
    });
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });

  it("rejects a truncated finish that the saved policy would not allow", () => {
    const json = tampered(completedGame(), (raw) => {
      (raw.config as Record<string, unknown>).goalArrivalPolicy = "exact-stop";
    });
    expect(() => restoreGame(json, network)).toThrowError(INVALID_SAVE);
  });
});
