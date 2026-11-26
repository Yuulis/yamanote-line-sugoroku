import { describe, expect, it } from "vitest";
import type { ItemInstance } from "../../src/types/network";
import {
  isAdjustedFaceInRange,
  isRollAdjustKind,
  legalAdjustments,
  ROLL_ADJUST_MAGNITUDE,
} from "../../src/features/game/itemRollAdjust";

describe("roll-adjust item metadata", () => {
  it("maps each adjustment kind to its ticket magnitude", () => {
    expect(ROLL_ADJUST_MAGNITUDE).toEqual({ "roll-adjust": 1, "roll-adjust-2": 2, "roll-adjust-3": 3 });
    expect(isRollAdjustKind("roll-adjust")).toBe(true);
    expect(isRollAdjustKind("roll-adjust-2")).toBe(true);
    expect(isRollAdjustKind("roll-adjust-3")).toBe(true);
    expect(isRollAdjustKind("double")).toBe(false);
  });
});

describe("legalAdjustments", () => {
  const inventory: readonly ItemInstance[] = [
    { id: "first-adjust", kind: "roll-adjust" },
    { id: "second-adjust", kind: "roll-adjust" },
    { id: "adjust-2", kind: "roll-adjust-2" },
    { id: "adjust-3", kind: "roll-adjust-3" },
    { id: "second-adjust-3", kind: "roll-adjust-3" },
  ];

  it("returns each owned magnitude's legal deltas in ascending order using its first instance", () => {
    expect(legalAdjustments(4, inventory)).toEqual([
      { delta: -3, instanceId: "adjust-3" },
      { delta: -2, instanceId: "adjust-2" },
      { delta: -1, instanceId: "first-adjust" },
      { delta: 1, instanceId: "first-adjust" },
      { delta: 2, instanceId: "adjust-2" },
      { delta: 3, instanceId: "adjust-3" },
    ]);
  });

  it("keeps the lower bound and permits adjusted faces above six", () => {
    expect(legalAdjustments(1, inventory)).toEqual([
      { delta: 1, instanceId: "first-adjust" },
      { delta: 2, instanceId: "adjust-2" },
      { delta: 3, instanceId: "adjust-3" },
    ]);
    expect(legalAdjustments(6, inventory)).toEqual([
      { delta: -3, instanceId: "adjust-3" },
      { delta: -2, instanceId: "adjust-2" },
      { delta: -1, instanceId: "first-adjust" },
      { delta: 1, instanceId: "first-adjust" },
      { delta: 2, instanceId: "adjust-2" },
      { delta: 3, instanceId: "adjust-3" },
    ]);
    expect(isAdjustedFaceInRange(1)).toBe(true);
    expect(isAdjustedFaceInRange(6)).toBe(true);
    expect(isAdjustedFaceInRange(7)).toBe(true);
    expect(isAdjustedFaceInRange(9)).toBe(true);
    expect(isAdjustedFaceInRange(0)).toBe(false);
    expect(isAdjustedFaceInRange(1.5)).toBe(false);
  });
});
