import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  createGame,
  moveByRoll,
  playTurn,
  restoreGame,
  rollDie,
  seedRng,
  serializeGame,
  verifySeededHistory,
} from "../../src/features/game/engine";
import {
  deleteSave,
  parseSave,
  readSave,
  SAVE_STORAGE_KEY,
  type SaveProblem,
  type StorageLike,
  saveProblemMessage,
  saveStatusMessage,
  writeSave,
} from "../../src/features/game/store/persistence";
import type { GameState } from "../../src/types/network";
import { configWith, DEFAULT_CONFIG, yamanoteInput } from "./fixtures/yamanote";

const network = buildRailwayNetwork(yamanoteInput());
const PRODUCTION = { expectedConfig: DEFAULT_CONFIG, requireSeededRolls: true } as const;

/** In-memory Web Storage stand-in. */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** Storage whose every call throws, like a blocked or full localStorage. */
function throwingStorage(error = new Error("SecurityError")): StorageLike {
  return {
    getItem: () => {
      throw error;
    },
    setItem: () => {
      throw error;
    },
    removeItem: () => {
      throw error;
    },
  };
}

function seededGame(turns: number, seed = "persist-seed"): GameState {
  let state = createGame(DEFAULT_CONFIG, seed, network);
  for (let index = 0; index < turns; index += 1) state = playTurn(state, network).state;
  return state;
}

function seededCompletedGame(seed = "persist-seed"): GameState {
  let state = createGame(DEFAULT_CONFIG, seed, network);
  while (state.status === "playing") state = playTurn(state, network).state;
  return state;
}

function tampered(state: GameState, edit: (raw: Record<string, unknown>) => void): string {
  const raw = JSON.parse(serializeGame(state)) as Record<string, unknown>;
  edit(raw);
  return JSON.stringify(raw);
}

describe("production restore (restoreGame with requireSeededRolls)", () => {
  it("restores a seeded mid-game save whose next roll is unchanged", () => {
    const state = seededGame(5);
    const restored = restoreGame(serializeGame(state), network, PRODUCTION);
    expect(restored).toEqual(state);
    expect(playTurn(restored, network)).toEqual(playTurn(state, network));
  });

  it("accepts a fresh game and a naturally completed game", () => {
    const fresh = createGame(DEFAULT_CONFIG, "fresh", network);
    expect(restoreGame(serializeGame(fresh), network, PRODUCTION)).toEqual(fresh);
    const done = seededCompletedGame();
    expect(done.status).toBe("completed");
    expect(restoreGame(serializeGame(done), network, PRODUCTION)).toEqual(done);
  });

  it("rejects a game whose rolls did not come from the seed", () => {
    // Valid under the rules (so restoreGame alone accepts it) but hand-rolled.
    let state = createGame(DEFAULT_CONFIG, "persist-seed", network);
    for (const roll of [6, 6, 6]) state = moveByRoll(state, roll, network).state;
    const json = serializeGame(state);
    expect(restoreGame(json, network)).toEqual(state);
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(
      expect.objectContaining({ code: "RNG_MISMATCH" }),
    );
  });

  it("rejects a mid-game rngState that does not follow from the seed", () => {
    const state = seededGame(3);
    const json = tampered(state, (raw) => {
      raw.rngState = rollDie(state.rngState).nextRngState;
    });
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(
      expect.objectContaining({ code: "RNG_MISMATCH" }),
    );
  });

  it("rejects a save whose seed was swapped", () => {
    const json = tampered(seededGame(3), (raw) => {
      raw.rngSeed = "another-seed";
    });
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(
      expect.objectContaining({ code: "RNG_MISMATCH" }),
    );
  });

  it("reports different rules before replaying the history", () => {
    // The history is also broken; only a check that runs first can name the rules.
    const json = tampered(seededGame(2), (raw) => {
      raw.config = configWith("exact-stop");
      raw.currentStationId = "tokyo";
    });
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(
      expect.objectContaining({ code: "CONFIG_MISMATCH" }),
    );
  });

  it("checks the save version before the rules", () => {
    const json = tampered(seededGame(1), (raw) => {
      raw.saveVersion = 99;
      raw.config = configWith("exact-stop");
    });
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SAVE_VERSION" }),
    );
  });

  it("classifies a fresh game's foreign rngState as an RNG mismatch", () => {
    const json = tampered(createGame(DEFAULT_CONFIG, "fresh", network), (raw) => {
      raw.rngState = seedRng("other");
    });
    expect(() => restoreGame(json, network)).toThrowError(
      expect.objectContaining({ code: "INVALID_SAVE" }),
    );
    expect(() => restoreGame(json, network, PRODUCTION)).toThrowError(
      expect.objectContaining({ code: "RNG_MISMATCH" }),
    );
  });

  it("verifySeededHistory checks the turn-0 state against the seed", () => {
    const fresh = createGame(DEFAULT_CONFIG, "x", network);
    expect(() => verifySeededHistory(fresh, network)).not.toThrow();
    expect(() =>
      verifySeededHistory({ ...fresh, rngState: seedRng("y") }, network),
    ).toThrowError(expect.objectContaining({ code: "RNG_MISMATCH" }));
  });
});

describe("readSave / writeSave / deleteSave", () => {
  it("round-trips through storage and resumes with the same next roll", () => {
    const storage = memoryStorage();
    const state = seededGame(4);
    expect(writeSave(storage, state)).toBe("saved");
    const lookup = readSave(storage, network, DEFAULT_CONFIG);
    expect(lookup).toEqual({ kind: "valid", game: state });
    if (lookup.kind !== "valid") throw new Error("expected a valid save");
    expect(playTurn(lookup.game, network).roll).toBe(playTurn(state, network).roll);
  });

  it("stores under the schema-versioned key", () => {
    const storage = memoryStorage();
    writeSave(storage, seededGame(1));
    expect([...storage.data.keys()]).toEqual([SAVE_STORAGE_KEY]);
    expect(SAVE_STORAGE_KEY).toMatch(/:v\d+$/);
  });

  it("reports no save when the key is empty", () => {
    expect(readSave(memoryStorage(), network, DEFAULT_CONFIG)).toEqual({ kind: "none" });
  });

  it.each<[string, (state: GameState) => string, SaveProblem]>([
    ["not JSON", () => "{oops", "corrupt"],
    ["a non-object", () => "[1,2]", "corrupt"],
    [
      "an unknown save version",
      (state) =>
        tampered(state, (raw) => {
          raw.saveVersion = 2;
        }),
      "unsupported-version",
    ],
    [
      "other railway data",
      (state) =>
        tampered(state, (raw) => {
          raw.dataVersion = "older-data";
        }),
      "data-version",
    ],
    [
      "different rules",
      (state) =>
        tampered(state, (raw) => {
          raw.config = configWith("pass-through");
        }),
      "rules",
    ],
    [
      "an inconsistent RNG",
      (state) =>
        tampered(state, (raw) => {
          raw.rngSeed = "forged";
        }),
      "rng-mismatch",
    ],
    [
      "a contradicting position",
      (state) =>
        tampered(state, (raw) => {
          raw.currentStationId = "tokyo";
        }),
      "corrupt",
    ],
  ])("classifies a save with %s without throwing", (_label, makeJson, problem) => {
    const storage = memoryStorage({ [SAVE_STORAGE_KEY]: makeJson(seededGame(3)) });
    expect(readSave(storage, network, DEFAULT_CONFIG)).toEqual({ kind: "invalid", problem });
  });

  it("keeps an invalid save in storage until it is deleted", () => {
    const storage = memoryStorage({ [SAVE_STORAGE_KEY]: "{oops" });
    readSave(storage, network, DEFAULT_CONFIG);
    expect(storage.data.has(SAVE_STORAGE_KEY)).toBe(true);
    expect(deleteSave(storage)).toBe(true);
    expect(readSave(storage, network, DEFAULT_CONFIG)).toEqual({ kind: "none" });
  });

  it("reports unavailable storage instead of throwing", () => {
    const state = seededGame(1);
    expect(readSave(null, network, DEFAULT_CONFIG)).toEqual({ kind: "unavailable" });
    expect(readSave(throwingStorage(), network, DEFAULT_CONFIG)).toEqual({
      kind: "unavailable",
    });
    expect(writeSave(null, state)).toBe("unavailable");
    expect(writeSave(throwingStorage(new Error("QuotaExceededError")), state)).toBe("failed");
    expect(deleteSave(null)).toBe(false);
    expect(deleteSave(throwingStorage())).toBe(false);
  });

  it("still reads a save when only writing fails (full quota)", () => {
    const state = seededGame(2);
    const storage: StorageLike = {
      ...memoryStorage({ [SAVE_STORAGE_KEY]: serializeGame(state) }),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readSave(storage, network, DEFAULT_CONFIG)).toEqual({ kind: "valid", game: state });
    expect(writeSave(storage, state)).toBe("failed");
  });

  it("parseSave maps unexpected errors to a corrupt save", () => {
    const brokenNetwork = { ...network, servicesById: undefined } as unknown as typeof network;
    const json = serializeGame(seededGame(1));
    expect(parseSave(json, brokenNetwork, DEFAULT_CONFIG)).toEqual({
      kind: "invalid",
      problem: "corrupt",
    });
  });
});

describe("save messages", () => {
  it.each<SaveProblem>(["corrupt", "unsupported-version", "data-version", "rules", "rng-mismatch"])(
    "has a Japanese message for %s",
    (problem) => {
      expect(saveProblemMessage(problem)).toMatch(/セーブデータ/);
    },
  );

  it("describes each save status", () => {
    expect(saveStatusMessage(null)).toBe("未保存");
    expect(saveStatusMessage("saved")).toBe("自動保存済み");
    expect(saveStatusMessage("unavailable")).toMatch(/保存できません/);
    expect(saveStatusMessage("failed")).toMatch(/失敗/);
  });
});
