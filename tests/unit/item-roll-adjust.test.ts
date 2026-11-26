import { describe, expect, it } from "vitest";
import type { ItemInstance } from "../../src/types/network";
import {
  isAdjustedFaceInRange,
  isRollAdjustKind,
  legalAdjustments,
  MAX_ADJUSTED_FACE,
  ROLL_ADJUST_MAGNITUDE,
} from "../../src/features/game/itemRollAdjust";

describe("roll-adjust item metadata", () => {
  it("maps each current adjustment kind to its ticket magnitude", () => {
    expect(ROLL_ADJUST_MAGNITUDE).toEqual({ "roll-adjust": 1 });
    expect(isRollAdjustKind("roll-adjust")).toBe(true);
    expect(isRollAdjustKind("double")).toBe(false);
  });
});

describe("legalAdjustments", () => {
  const inventory: readonly ItemInstance[] = [
    { id: "first-adjust", kind: "roll-adjust" },
    { id: "second-adjust", kind: "roll-adjust" },
  ];

  it("returns distinct legal deltas in ascending order, using the first owned instance", () => {
    expect(legalAdjustments(4, inventory)).toEqual([
      { delta: -1, instanceId: "first-adjust" },
      { delta: 1, instanceId: "first-adjust" },
    ]);
  });

  it("keeps the adjusted face in the inclusive 1..6 range", () => {
    expect(MAX_ADJUSTED_FACE).toBe(6);
    expect(legalAdjustments(1, inventory)).toEqual([{ delta: 1, instanceId: "first-adjust" }]);
    expect(legalAdjustments(6, inventory)).toEqual([{ delta: -1, instanceId: "first-adjust" }]);
    expect(isAdjustedFaceInRange(1)).toBe(true);
    expect(isAdjustedFaceInRange(6)).toBe(true);
    expect(isAdjustedFaceInRange(0)).toBe(false);
    expect(isAdjustedFaceInRange(7)).toBe(false);
    expect(isAdjustedFaceInRange(1.5)).toBe(false);
  });
});
