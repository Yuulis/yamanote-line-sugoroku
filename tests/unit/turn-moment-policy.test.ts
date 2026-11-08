import { describe, expect, it } from "vitest";
import type { AnimationSpeedId } from "../../src/features/game/gameConfig";
import type { PresentationLevel } from "../../src/features/game/gameSettings";
import {
  captureTurnPresentationPolicy,
  turnMomentTiming,
} from "../../src/features/game/animation/turnMomentPolicy";

describe("turn moment policy legacy timings", () => {
  // Independent literals pin the rounded legacy formula before adding any new speed.
  it.each([
    ["slow", { stepMs: 600, tumbleMs: 800, stampsMs: 320, arrivalMs: 1067,
      lotteryFlipMs: 2133, lotterySettleMs: 533, pickupMs: 667, flashMs: 1067 }],
    ["normal", { stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800,
      lotteryFlipMs: 1600, lotterySettleMs: 400, pickupMs: 500, flashMs: 800 }],
    ["fast", { stepMs: 300, tumbleMs: 400, stampsMs: 160, arrivalMs: 533,
      lotteryFlipMs: 1067, lotterySettleMs: 267, pickupMs: 333, flashMs: 533 }],
  ] as const)("preserves every duration at %s", (speedId, expected) => {
    expect(turnMomentTiming(speedId)).toEqual(expected);
    expect(captureTurnPresentationPolicy({ speedId, presentationLevel: "all" })).toEqual({
      speedId, level: "all", timing: expected,
      showTumble: true, showStamps: true, showArrival: true, showImportantMoments: true,
    });
  });

  it("captures an immutable policy independent of later settings changes", () => {
    const settings: { speedId: AnimationSpeedId; presentationLevel: PresentationLevel } = {
      speedId: "normal", presentationLevel: "all",
    };
    const policy = captureTurnPresentationPolicy(settings);
    settings.speedId = "fast";
    settings.presentationLevel = "none";
    expect(policy.speedId).toBe("normal");
    expect(policy.level).toBe("all");
    expect(policy.timing).toEqual({ stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800,
      lotteryFlipMs: 1600, lotterySettleMs: 400, pickupMs: 500, flashMs: 800 });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.timing)).toBe(true);
    expect(() => Object.assign(policy, { speedId: "slow" })).toThrow(TypeError);
    expect(() => Object.assign(policy.timing, { tumbleMs: 1 })).toThrow(TypeError);
    expect(turnMomentTiming("normal").tumbleMs).toBe(600);
  });
});
