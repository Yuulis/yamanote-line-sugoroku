import { ANIMATION_SPEEDS } from "../gameConfig";
import {
  DEFAULT_GAME_SETTINGS,
  PRESENTATION_LEVELS,
  type GameSettings,
} from "../gameSettings";
import type { SaveWriteResult, StorageLike } from "./persistence";

export const SETTINGS_STORAGE_KEY = "yamanote-line-sugoroku:settings:v1";
const SETTINGS_VERSION = 1;

export type SettingsReadStatus = "loaded" | "missing" | "invalid" | "unavailable";

export interface SettingsReadResult {
  readonly settings: GameSettings;
  readonly status: SettingsReadStatus;
}

export function parseSettings(json: string): SettingsReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { settings: DEFAULT_GAME_SETTINGS, status: "invalid" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { settings: DEFAULT_GAME_SETTINGS, status: "invalid" };
  }
  const payload = parsed as Record<string, unknown>;
  if (payload.version !== SETTINGS_VERSION) {
    return { settings: DEFAULT_GAME_SETTINGS, status: "invalid" };
  }

  const speed = ANIMATION_SPEEDS.find(({ id }) => id === payload.speedId);
  const presentation = PRESENTATION_LEVELS.find(({ id }) => id === payload.presentationLevel);
  return {
    settings: {
      speedId: speed?.id ?? DEFAULT_GAME_SETTINGS.speedId,
      follow: typeof payload.follow === "boolean" ? payload.follow : DEFAULT_GAME_SETTINGS.follow,
      presentationLevel: presentation?.id ?? DEFAULT_GAME_SETTINGS.presentationLevel,
    },
    status: "loaded",
  };
}

export function readSettings(storage: StorageLike | null): SettingsReadResult {
  if (!storage) return { settings: DEFAULT_GAME_SETTINGS, status: "unavailable" };
  let json: string | null;
  try {
    json = storage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return { settings: DEFAULT_GAME_SETTINGS, status: "unavailable" };
  }
  if (json === null) return { settings: DEFAULT_GAME_SETTINGS, status: "missing" };
  return parseSettings(json);
}

/** Persist explicitly supplied preferences; callers own transient follow state. */
export function writeSettings(storage: StorageLike | null, settings: GameSettings): SaveWriteResult {
  if (!storage) return "unavailable";
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      version: SETTINGS_VERSION,
      speedId: settings.speedId,
      follow: settings.follow,
      presentationLevel: settings.presentationLevel,
    }));
    return "saved";
  } catch {
    return "failed";
  }
}
