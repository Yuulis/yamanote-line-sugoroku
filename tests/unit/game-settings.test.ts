import { describe, expect, it } from "vitest";
import { ANIMATION_SPEEDS } from "../../src/features/game/gameConfig";
import {
  DEFAULT_GAME_SETTINGS,
  nextPresentationLevel,
  PRESENTATION_LEVELS,
  type GameSettings,
} from "../../src/features/game/gameSettings";
import {
  parseSettings,
  readSettings,
  SETTINGS_STORAGE_KEY,
  writeSettings,
} from "../../src/features/game/store/settings";
import {
  SAVE_STORAGE_KEY,
  type StorageLike,
} from "../../src/features/game/store/persistence";

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

const CUSTOM_SETTINGS: GameSettings = {
  speedId: "fast",
  follow: false,
  presentationLevel: "important",
};

describe("game settings defaults and presentation levels", () => {
  it("defaults to normal speed, follow on, and all presentation", () => {
    expect(DEFAULT_GAME_SETTINGS).toEqual({
      speedId: "normal",
      follow: true,
      presentationLevel: "all",
    });
  });

  it("provides the three presentation labels in cycle order", () => {
    expect(PRESENTATION_LEVELS).toEqual([
      { id: "all", label: "すべて" },
      { id: "important", label: "重要なときだけ" },
      { id: "none", label: "なし" },
    ]);
  });

  it("cycles presentation from all to important to none and back to all", () => {
    expect(nextPresentationLevel("all")).toBe("important");
    expect(nextPresentationLevel("important")).toBe("none");
    expect(nextPresentationLevel("none")).toBe("all");
  });
});

describe("parseSettings / readSettings", () => {
  it.each(ANIMATION_SPEEDS)("round-trips supported v1 speed $id", ({ id }) => {
    const storage = memoryStorage();
    const settings: GameSettings = { ...CUSTOM_SETTINGS, speedId: id };

    expect(writeSettings(storage, settings)).toBe("saved");
    expect(readSettings(storage)).toEqual({ status: "loaded", settings });
    expect(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      ...settings,
    });
  });

  it.each(PRESENTATION_LEVELS)("accepts presentation level $id", ({ id }) => {
    const settings: GameSettings = { ...CUSTOM_SETTINGS, presentationLevel: id };
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, ...settings }),
    });

    expect(readSettings(storage)).toEqual({ status: "loaded", settings });
  });

  it.each<[string, Record<string, unknown>, GameSettings]>([
    ["unknown speed", { speedId: "unknown" }, { ...CUSTOM_SETTINGS, speedId: "normal" }],
    ["future speed", { speedId: "very-fast" }, { ...CUSTOM_SETTINGS, speedId: "normal" }],
    ["numeric speed", { speedId: 1 }, { ...CUSTOM_SETTINGS, speedId: "normal" }],
    ["string follow", { follow: "true" }, { ...CUSTOM_SETTINGS, follow: true }],
    ["numeric follow", { follow: 1 }, { ...CUSTOM_SETTINGS, follow: true }],
    ["null follow", { follow: null }, { ...CUSTOM_SETTINGS, follow: true }],
    ["unknown presentation", { presentationLevel: "unknown" }, { ...CUSTOM_SETTINGS, presentationLevel: "all" }],
    ["numeric presentation", { presentationLevel: 1 }, { ...CUSTOM_SETTINGS, presentationLevel: "all" }],
  ])("defaults only the invalid field for %s without coercion", (_label, fields, settings) => {
    const json = JSON.stringify({ version: 1, ...CUSTOM_SETTINGS, ...fields });
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: json });

    expect(readSettings(storage)).toEqual({ status: "loaded", settings });
    expect(storage.data.get(SETTINGS_STORAGE_KEY)).toBe(json);
  });

  it("defaults missing fields independently in a supported payload", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, follow: false }),
    });

    expect(readSettings(storage)).toEqual({
      status: "loaded",
      settings: { ...DEFAULT_GAME_SETTINGS, follow: false },
    });
  });

  it("loads defaults when all supported payload fields are missing or invalid", () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: '{"version":1}' });
    expect(readSettings(storage)).toEqual({ status: "loaded", settings: DEFAULT_GAME_SETTINGS });
    expect(parseSettings('{"version":1,"speedId":null,"follow":[],"presentationLevel":{}}'))
      .toEqual({ status: "loaded", settings: DEFAULT_GAME_SETTINGS });
  });

  it.each<[string, string]>([
    ["invalid JSON", "{oops"],
    ["empty JSON", ""],
    ["array", "[]"],
    ["null", "null"],
    ["number", "1"],
    ["string", '"settings"'],
    ["boolean", "true"],
    ["unknown version", '{"version":2,"speedId":"fast","follow":false,"presentationLevel":"none"}'],
    ["string version", '{"version":"1"}'],
    ["missing version", '{"speedId":"fast"}'],
  ])("returns invalid and defaults for %s", (_label, json) => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: json });

    expect(parseSettings(json)).toEqual({ status: "invalid", settings: DEFAULT_GAME_SETTINGS });
    expect(readSettings(storage)).toEqual({ status: "invalid", settings: DEFAULT_GAME_SETTINGS });
    expect(storage.data.get(SETTINGS_STORAGE_KEY)).toBe(json);
  });

  it("ignores unknown fields in a supported payload", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        ...CUSTOM_SETTINGS,
        autoRoll: true,
        extra: { speedId: "slow" },
      }),
    });

    expect(readSettings(storage)).toEqual({ status: "loaded", settings: CUSTOM_SETTINGS });
  });

  it("reports missing with defaults when the settings key is absent", () => {
    const storage = memoryStorage();

    expect(readSettings(storage)).toEqual({ status: "missing", settings: DEFAULT_GAME_SETTINGS });
    expect(storage.data.size).toBe(0);
  });

  it("reports unavailable with defaults for null storage", () => {
    expect(readSettings(null)).toEqual({ status: "unavailable", settings: DEFAULT_GAME_SETTINGS });
  });

  it("reports unavailable with defaults when getItem throws", () => {
    const storage: StorageLike = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("SecurityError");
      },
    };

    expect(readSettings(storage)).toEqual({ status: "unavailable", settings: DEFAULT_GAME_SETTINGS });
  });
});

describe("writeSettings", () => {
  it("reports unavailable for null storage", () => {
    expect(writeSettings(null, CUSTOM_SETTINGS)).toBe("unavailable");
  });

  it("reports failed without throwing when setItem exceeds quota and still permits reads", () => {
    const json = JSON.stringify({ version: 1, ...DEFAULT_GAME_SETTINGS });
    const storage: StorageLike = {
      ...memoryStorage({ [SETTINGS_STORAGE_KEY]: json }),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(writeSettings(storage, CUSTOM_SETTINGS)).toBe("failed");
    expect(readSettings(storage)).toEqual({ status: "loaded", settings: DEFAULT_GAME_SETTINGS });
    expect(CUSTOM_SETTINGS).toEqual({ speedId: "fast", follow: false, presentationLevel: "important" });
  });

  it("writes only the versioned settings key and the specified payload fields", () => {
    const storage = memoryStorage();
    const settingsWithExtraField = { ...CUSTOM_SETTINGS, extra: "ignored" };

    expect(SETTINGS_STORAGE_KEY).toBe("yamanote-line-sugoroku:settings:v1");
    expect(writeSettings(storage, settingsWithExtraField)).toBe("saved");
    expect([...storage.data.keys()]).toEqual([SETTINGS_STORAGE_KEY]);
    expect(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      ...CUSTOM_SETTINGS,
    });
  });

  it("keeps the independent save slot unchanged when settings are written", () => {
    const saveBytes = "existing-save-bytes";
    const storage = memoryStorage({ [SAVE_STORAGE_KEY]: saveBytes });

    expect(writeSettings(storage, CUSTOM_SETTINGS)).toBe("saved");
    expect(storage.data.get(SAVE_STORAGE_KEY)).toBe(saveBytes);
    expect([...storage.data.keys()]).toEqual([SAVE_STORAGE_KEY, SETTINGS_STORAGE_KEY]);
  });
});
