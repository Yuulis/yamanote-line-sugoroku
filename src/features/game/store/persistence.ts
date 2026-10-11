// localStorage save / resume / delete (spec 3.4, 5, 7, 11). Storage is
// injected so the logic runs in tests; every storage call is guarded, and a
// failure only changes the reported status: the game itself keeps going.

import type { GameConfig, GameState } from "../../../types/network";
import {
  type GameEngineErrorCode,
  isGameEngineError,
  type RailwayNetwork,
  restoreGame,
  serializeGame,
} from "../engine";

/**
 * The `v1` names the storage layout (one key holding one serialised game).
 * The game format has its own `saveVersion` inside the payload, so a save in
 * an unknown format is still found and reported instead of silently ignored.
 */
export const SAVE_STORAGE_KEY = "yamanote-line-sugoroku:save:v1";

/** The subset of the Web Storage API the app uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveProblem =
  | "corrupt"
  | "unsupported-version"
  | "data-version"
  | "rules"
  | "rng-mismatch";

export type SaveLookup =
  | { kind: "none" }
  | { kind: "valid"; game: GameState }
  | { kind: "invalid"; problem: SaveProblem }
  /** Storage could not be read at all (disabled, blocked, or throwing). */
  | { kind: "unavailable" };

export type SaveWriteResult = "saved" | "unavailable" | "failed";

const PROBLEM_BY_CODE: Partial<Record<GameEngineErrorCode, SaveProblem>> = {
  UNSUPPORTED_SAVE_VERSION: "unsupported-version",
  DATA_VERSION_MISMATCH: "data-version",
  CONFIG_MISMATCH: "rules",
  RNG_MISMATCH: "rng-mismatch",
};

const PROBLEM_MESSAGES: Record<SaveProblem, string> = {
  corrupt: "セーブデータが壊れているため読み込めません。",
  "unsupported-version": "このバージョンでは読み込めない形式のセーブデータです。",
  "data-version": "路線データが更新されたため、このセーブデータは使えません。",
  rules: "ルールが異なるセーブデータのため読み込めません。",
  "rng-mismatch": "サイコロの記録が一致しないため、このセーブデータは使えません。",
};

export function saveProblemMessage(problem: SaveProblem): string {
  return PROBLEM_MESSAGES[problem];
}

const WRITE_RESULT_MESSAGES: Record<SaveWriteResult, string> = {
  saved: "自動保存済み",
  unavailable: "この環境では保存できません（プレイは続けられます）",
  failed: "保存に失敗しました（この進行は未保存です）",
};

/** Panel text for the latest save attempt; null before the first one. */
export function saveStatusMessage(result: SaveWriteResult | null): string {
  return result === null ? "未保存" : WRITE_RESULT_MESSAGES[result];
}

/**
 * Validate a stored payload with the production rules: same railway data,
 * same game rules, and every roll reproduced from the saved seed.
 */
export function parseSave(
  json: string,
  network: RailwayNetwork,
  config: GameConfig,
): Extract<SaveLookup, { kind: "valid" | "invalid" }> {
  try {
    const game = restoreGame(json, network, {
      expectedConfig: config,
      requireSeededRolls: true,
    });
    return { kind: "valid", game };
  } catch (error) {
    // Anything unexpected is still a bad save, never a crash of the title screen.
    const problem = isGameEngineError(error) ? PROBLEM_BY_CODE[error.code] : undefined;
    return { kind: "invalid", problem: problem ?? "corrupt" };
  }
}

export function readSave(
  storage: StorageLike | null,
  network: RailwayNetwork,
  config: GameConfig,
): SaveLookup {
  if (!storage) return { kind: "unavailable" };
  let json: string | null;
  try {
    json = storage.getItem(SAVE_STORAGE_KEY);
  } catch {
    return { kind: "unavailable" };
  }
  if (json === null) return { kind: "none" };
  return parseSave(json, network, config);
}

/** Save a committed game state; failures (quota, blocked storage) are reported. */
export function writeSave(storage: StorageLike | null, game: GameState): SaveWriteResult {
  if (!storage) return "unavailable";
  try {
    storage.setItem(SAVE_STORAGE_KEY, serializeGame(game));
    return "saved";
  } catch {
    return "failed";
  }
}

/** Remove the save; false when storage refused, so the UI never claims success. */
export function deleteSave(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
