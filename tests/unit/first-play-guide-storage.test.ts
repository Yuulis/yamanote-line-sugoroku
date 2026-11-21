import { describe, expect, it } from "vitest";
import {
  GUIDE_COACH_KEY,
  GUIDE_HINTS_DISABLED_KEY,
  GUIDE_STARTED_KEY,
  FIRST_PLAY_HINT_IDS,
  guideHintStorageKey,
  readFirstTurnNoticeForGuide,
  readGuideCoachSeen,
  readGuideHintSeen,
  readGuideHintsDisabled,
  readGuideStarted,
  writeGuideCoachSeen,
  writeGuideHintSeen,
  writeGuideHintsDisabled,
  writeGuideStarted,
} from "../../src/features/game/store/guide";
import type { StorageLike } from "../../src/features/game/store/persistence";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("first-play guide storage adapter", () => {
  it("uses the exact versioned keys and no key contains save", () => {
    expect(GUIDE_STARTED_KEY).toBe("yamanote-line-sugoroku:guide:started:v1");
    expect(GUIDE_COACH_KEY).toBe("yamanote-line-sugoroku:guide:coach:v1");
    expect(GUIDE_HINTS_DISABLED_KEY).toBe("yamanote-line-sugoroku:guide:hints-disabled:v1");
    expect(FIRST_PLAY_HINT_IDS.map(guideHintStorageKey)).toEqual([
      "yamanote-line-sugoroku:guide:hint:lottery:v1",
      "yamanote-line-sugoroku:guide:hint:off-target:v1",
      "yamanote-line-sugoroku:guide:hint:item:v1",
      "yamanote-line-sugoroku:guide:hint:harmful-item:v1",
      "yamanote-line-sugoroku:guide:hint:terminus:v1",
    ]);
    expect([
      GUIDE_STARTED_KEY,
      GUIDE_COACH_KEY,
      GUIDE_HINTS_DISABLED_KEY,
      ...FIRST_PLAY_HINT_IDS.map(guideHintStorageKey),
    ].every((key) => !key.includes("save"))).toBe(true);
  });

  it("reads only the exact one value as set and reports read success separately", () => {
    const storage = memoryStorage({
      [GUIDE_STARTED_KEY]: "1",
      [GUIDE_COACH_KEY]: "true",
      [GUIDE_HINTS_DISABLED_KEY]: "0",
      [guideHintStorageKey("item")]: "1",
    });

    expect(readGuideStarted(storage)).toEqual({ readable: true, value: "1" });
    expect(readGuideCoachSeen(storage)).toEqual({ readable: true, value: "true" });
    expect(readGuideHintsDisabled(storage)).toEqual({ readable: true, value: "0" });
    expect(readGuideHintSeen(storage, "item")).toEqual({ readable: true, value: "1" });
    expect(readGuideHintSeen(storage, "lottery")).toEqual({ readable: true, value: null });
    expect(readGuideStarted(null)).toEqual({ readable: false, value: null });
  });

  it("reads the existing first-turn notice without collapsing a storage error", () => {
    const seen = memoryStorage({ "yamanote-line-sugoroku:notice:auto-resume:v1": "1" });
    expect(readFirstTurnNoticeForGuide(seen)).toEqual({ readable: true, value: "1" });
    expect(readFirstTurnNoticeForGuide(null)).toEqual({ readable: false, value: null });
  });

  it("writes the exact one value to each guide key", () => {
    const storage = memoryStorage();

    expect(writeGuideStarted(storage)).toBe(true);
    expect(writeGuideCoachSeen(storage)).toBe(true);
    expect(writeGuideHintsDisabled(storage)).toBe(true);
    expect(writeGuideHintSeen(storage, "harmful-item")).toBe(true);
    expect([...storage.values.entries()]).toEqual([
      [GUIDE_STARTED_KEY, "1"],
      [GUIDE_COACH_KEY, "1"],
      [GUIDE_HINTS_DISABLED_KEY, "1"],
      [guideHintStorageKey("harmful-item"), "1"],
    ]);
    expect(writeGuideStarted(null)).toBe(false);
  });

  it("contains every storage read and write failure", () => {
    const throwingStorage: StorageLike = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };

    expect(readGuideStarted(throwingStorage)).toEqual({ readable: false, value: null });
    expect(readGuideCoachSeen(throwingStorage)).toEqual({ readable: false, value: null });
    expect(readGuideHintsDisabled(throwingStorage)).toEqual({ readable: false, value: null });
    expect(readGuideHintSeen(throwingStorage, "terminus")).toEqual({ readable: false, value: null });
    expect(readFirstTurnNoticeForGuide(throwingStorage)).toEqual({ readable: false, value: null });
    expect(writeGuideStarted(throwingStorage)).toBe(false);
    expect(writeGuideCoachSeen(throwingStorage)).toBe(false);
    expect(writeGuideHintsDisabled(throwingStorage)).toBe(false);
    expect(writeGuideHintSeen(throwingStorage, "terminus")).toBe(false);
  });
});
