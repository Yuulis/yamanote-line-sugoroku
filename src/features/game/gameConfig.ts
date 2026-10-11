import type { GameConfig } from "../../types/network";

/** The Yamanote line has exactly 30 stations and 30 outer-loop segments. */
export const EXPECTED_STATION_COUNT = 30;

/** MVP rules (spec 3.3): outer loop from 新橋, truncate on arrival when complete. */
export const MVP_GAME_CONFIG: GameConfig = {
  rulesetVersion: "mvp-1",
  targetServiceId: "jr-yamanote",
  startStationId: "shimbashi",
  targetDirection: 1,
  goalArrivalPolicy: "truncate-on-target-service",
};

/** UI-only pause after a move before the dice re-enable (M2 replaces it with animation). */
export const MOVE_SETTLE_MS = 400;
