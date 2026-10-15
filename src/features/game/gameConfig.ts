import type { GameConfig, ServiceId } from "../../types/network";

/** The Yamanote line has exactly 30 stations and 30 outer-loop segments. */
export const EXPECTED_STATION_COUNTS: Readonly<Partial<Record<ServiceId, number>>> = {
  "jr-yamanote": 30,
};

/**
 * Game rules (spec 3.3, 4.1): outer loop from 新橋, truncate on arrival when
 * complete; landing lotteries per the JR East capital-region ruleset. The
 * ruleset version names the seeded semantics, so saves made under other
 * rules are rejected (`CONFIG_MISMATCH`).
 */
export const MVP_GAME_CONFIG: GameConfig = {
  rulesetVersion: "jr-east-capital-1",
  targetServiceId: "jr-yamanote",
  startStationId: "shimbashi",
  targetDirection: 1,
  goalArrivalPolicy: "truncate-on-target-service",
  serviceLottery: {
    kindWeights: { local: 1, rapid: 1 },
    target: { kind: "share", numerator: 1, denominator: 2 },
  },
  directionLottery: { towardTargetWeight: 2 },
};

/** Animation speeds per station hop (spec 11: 0.3-0.6 s, configurable). */
export const ANIMATION_SPEEDS = [
  { id: "slow", label: "ゆっくり", stepMs: 600 },
  { id: "normal", label: "ふつう", stepMs: 450 },
  { id: "fast", label: "はやい", stepMs: 300 },
] as const;

export type AnimationSpeedId = (typeof ANIMATION_SPEEDS)[number]["id"];

export const DEFAULT_ANIMATION_SPEED: AnimationSpeedId = "normal";
