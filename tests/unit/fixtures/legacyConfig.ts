import type { GameConfig } from "../../../src/types/network";

/** Rules that produced the archived JR East capital-region saves and golden runs. */
export const LEGACY_CAPITAL_REGION_CONFIG: GameConfig = {
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
