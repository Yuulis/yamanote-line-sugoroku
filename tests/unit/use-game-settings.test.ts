// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_SETTINGS, type GameSettings } from "../../src/features/game/gameSettings";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { SETTINGS_STORAGE_KEY } from "../../src/features/game/store/settings";
import { useGameSettings } from "../../src/features/game/useGameSettings";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const CUSTOM_SETTINGS: GameSettings = { speedId: "fast", follow: false, presentationLevel: "important" };
let mounted: MountedReact | undefined;
let current: ReturnType<typeof useGameSettings>;

function memoryStorage(settings?: GameSettings) {
  const data = new Map<string, string>(settings
    ? [[SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, ...settings })]] : []);
  return {
    getItem: vi.fn((key: string): string | null => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string): void => { data.set(key, value); }),
    removeItem: vi.fn((key: string): void => { data.delete(key); }),
  };
}

function Harness({ storage }: { storage: StorageLike | null }): null {
  current = useGameSettings(storage);
  return null;
}

function mountSettings(storage: StorageLike | null, strict = false): void {
  const node = createElement(Harness, { storage });
  mounted = mountReact(strict ? createElement(StrictMode, null, node) : node);
}

function stored(storage: StorageLike): unknown {
  return JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!);
}

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
});

describe.each([false, true])("useGameSettings (StrictMode: %s)", (strict) => {
  it("reads preferences on mount without writing, including effect replay", () => {
    const storage = memoryStorage(CUSTOM_SETTINGS);
    mountSettings(storage, strict);
    expect(current.settings).toEqual(CUSTOM_SETTINGS);
    expect(current.writeStatus).toBe("unchanged");
    expect(storage.getItem).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
    act(() => mounted!.root.render(strict
      ? createElement(StrictMode, null, createElement(Harness, { storage }))
      : createElement(Harness, { storage })));
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("does not write when stopping follow leaves the state unchanged", () => {
    const storage = memoryStorage(CUSTOM_SETTINGS);
    mountSettings(storage, strict);
    act(() => { current.stopFollowing(); current.stopFollowing(); });
    expect(current.settings).toEqual(CUSTOM_SETTINGS);
    expect(current.writeStatus).toBe("unchanged");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("cycles the existing speeds and presentation with exactly one write per change", () => {
    const storage = memoryStorage();
    mountSettings(storage, strict);
    for (const [index, speedId] of ["fast", "slow", "normal"].entries()) {
      act(() => current.cycleSpeed());
      expect(current.settings.speedId).toBe(speedId);
      expect(storage.setItem).toHaveBeenCalledTimes(index + 1);
      expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS, speedId });
    }
    act(() => current.cyclePresentation());
    expect(current.settings.presentationLevel).toBe("important");
    expect(current.writeStatus).toBe("saved");
    expect(storage.setItem).toHaveBeenCalledTimes(4);
    expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS, presentationLevel: "important" });
  });

  it("keeps pan OFF transient even when speed changes, and persists the menu toggle after pan", () => {
    const storage = memoryStorage(DEFAULT_GAME_SETTINGS);
    mountSettings(storage, strict);
    act(() => { current.stopFollowing(); current.stopFollowing(); });
    expect(current.settings.follow).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    act(() => current.cycleSpeed());
    expect(current.settings.follow).toBe(false);
    expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS, speedId: "fast" });
    act(() => current.toggleFollow());
    expect(current.settings.follow).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS, speedId: "fast" });
    act(() => current.toggleFollow());
    expect(current.settings.follow).toBe(false);
    expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS, speedId: "fast", follow: false });
  });

  it("starts the next mount with stored follow after a manual pan", () => {
    const storage = memoryStorage(DEFAULT_GAME_SETTINGS);
    mountSettings(storage, strict);
    act(() => current.stopFollowing());
    expect(current.settings.follow).toBe(false);
    mounted!.cleanup();
    mountSettings(storage, strict);
    expect(current.settings.follow).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("keeps failed preferences in memory and retries only on the next effective change", () => {
    const storage = memoryStorage(DEFAULT_GAME_SETTINGS);
    storage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    mountSettings(storage, strict);
    act(() => current.cycleSpeed());
    expect(current.settings.speedId).toBe("fast");
    expect(current.writeStatus).toBe("failed");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS });
    act(() => { current.stopFollowing(); current.stopFollowing(); });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    act(() => current.cyclePresentation());
    expect(current.writeStatus).toBe("saved");
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(current.settings.follow).toBe(false);
    expect(stored(storage)).toEqual({ version: 1, ...DEFAULT_GAME_SETTINGS, speedId: "fast", presentationLevel: "important" });
  });

  it("reads the last successful write after a failed write and remount, without retrying on mount", () => {
    const storage = memoryStorage(CUSTOM_SETTINGS);
    storage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    mountSettings(storage, strict);
    act(() => current.cycleSpeed());
    expect(current.settings.speedId).toBe("slow");
    mounted!.cleanup();
    mountSettings(storage, strict);
    expect(current.settings).toEqual(CUSTOM_SETTINGS);
    expect(current.writeStatus).toBe("unchanged");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("retains functional updates when multiple controls change together", () => {
    const storage = memoryStorage();
    mountSettings(storage, strict);
    act(() => { current.cycleSpeed(); current.toggleFollow(); current.cyclePresentation(); });
    expect(current.settings).toEqual(CUSTOM_SETTINGS);
    expect(stored(storage)).toEqual({ version: 1, ...CUSTOM_SETTINGS });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("keeps settings usable without storage", () => {
    mountSettings(null, strict);
    expect(current.settings).toEqual(DEFAULT_GAME_SETTINGS);
    expect(current.writeStatus).toBe("unchanged");
    act(() => current.toggleFollow());
    expect(current.settings.follow).toBe(false);
    expect(current.writeStatus).toBe("unavailable");
  });
});
