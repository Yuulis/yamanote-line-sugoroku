import type { GameConfig, ServiceId } from "../../types/network";

/** The Yamanote line has exactly 30 stations and 30 outer-loop segments. */
export const EXPECTED_STATION_COUNTS: Readonly<Partial<Record<ServiceId, number>>> = {
  "jr-yamanote": 30,
};

/**
 * Frozen Tokyo suburban rules: complete all 30 outer Yamanote segments, then
 * arrive at 新橋; truncate when the target service reaches the goal. The
 * ruleset version names the seeded semantics, so saves made under other
 * rules are rejected (`CONFIG_MISMATCH`).
 */
export const CLASSIC_GAME_CONFIG: GameConfig = {
  rulesetVersion: "tokyo-suburban-1",
  targetServiceId: "jr-yamanote",
  startStationId: "shimbashi",
  targetDirection: 1,
  goalArrivalPolicy: "truncate-on-target-service",
  serviceLottery: {
    kindWeights: { local: 1, rapid: 1 },
    target: { kind: "share", numerator: 2, denominator: 3 },
  },
  directionLottery: { towardTargetWeight: 2 },
};

/** S11 switches this alias to the shipped item configuration. */
export const MVP_GAME_CONFIG = CLASSIC_GAME_CONFIG;

/** Animation speeds per station hop (spec 11: 0.3-0.6 s, configurable). */
export const ANIMATION_SPEEDS = [
  { id: "slow", label: "ゆっくり", stepMs: 600 },
  { id: "normal", label: "ふつう", stepMs: 450 },
  { id: "fast", label: "はやい", stepMs: 300 },
] as const;

export type AnimationSpeedId = (typeof ANIMATION_SPEEDS)[number]["id"];

export const DEFAULT_ANIMATION_SPEED: AnimationSpeedId = "normal";
