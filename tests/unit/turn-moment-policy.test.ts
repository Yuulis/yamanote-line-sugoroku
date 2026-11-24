import { describe, expect, it } from "vitest";
import type { AnimationSpeedId } from "../../src/features/game/gameConfig";
import type { PresentationLevel } from "../../src/features/game/gameSettings";
import {
  captureTurnPresentationPolicy,
  lotteryDirectionFlipMs,
  lotteryFlipStageMs,
  lotteryResultHoldMs,
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


describe("very-fast turn moment policy", () => {
  it("captures the fourth timing row, keeping important moments without an arrival card", () => {
    const policy = captureTurnPresentationPolicy({ speedId: "very-fast", presentationLevel: "all" });
    expect(policy).toEqual({
      speedId: "very-fast", level: "all",
      timing: { stepMs: 120, tumbleMs: 160, stampsMs: 64, arrivalMs: null,
        lotteryFlipMs: 280, lotterySettleMs: 100, pickupMs: 140, flashMs: 180 },
      showTumble: true, showStamps: true, showArrival: false, showImportantMoments: true,
    });
    expect(policy.timing.lotteryFlipMs + policy.timing.lotterySettleMs).toBe(380);
    expect(Object.isFrozen(policy.timing)).toBe(true);
  });
});

describe("lottery direction window, result hold and flip stage length", () => {
  // Independent literals: D = round(0.4 * F), H = round(0.25 * F);
  // stage = F + D + H (both) / F + H (service only) / D + H (direction only).
  it.each([
    ["slow", 2133, 853, 533, 3519, 2666, 1386],
    ["normal", 1600, 640, 400, 2640, 2000, 1040],
    ["fast", 1067, 427, 267, 1761, 1334, 694],
    ["very-fast", 280, 112, 70, 462, 350, 182],
  ] as const)("derives D, H and the stage length at %s", (speedId, routeFlipMs, directionMs, holdMs, bothMs, serviceOnlyMs, directionOnlyMs) => {
    expect(turnMomentTiming(speedId).lotteryFlipMs).toBe(routeFlipMs);
    expect(lotteryDirectionFlipMs(routeFlipMs)).toBe(directionMs);
    expect(lotteryResultHoldMs(routeFlipMs)).toBe(holdMs);
    expect(lotteryFlipStageMs(routeFlipMs, { serviceDrawRequired: true, directionDrawRequired: true })).toBe(bothMs);
    expect(lotteryFlipStageMs(routeFlipMs, { serviceDrawRequired: true, directionDrawRequired: false })).toBe(serviceOnlyMs);
    expect(lotteryFlipStageMs(routeFlipMs, { serviceDrawRequired: false, directionDrawRequired: true })).toBe(directionOnlyMs);
  });
});

describe("selective presentation permissions", () => {
  it.each([
    ["all", "normal", true, true, true],
    ["all", "very-fast", true, false, true],
    ["important", "slow", false, false, true],
    ["important", "very-fast", false, false, true],
    ["none", "normal", false, false, false],
  ] as const)("captures %s at %s", (presentationLevel, speedId, showTumble, showArrival, showImportantMoments) => {
    expect(captureTurnPresentationPolicy({ speedId, presentationLevel })).toMatchObject({
      level: presentationLevel, speedId, showTumble, showStamps: showTumble, showArrival, showImportantMoments,
    });
  });
});
