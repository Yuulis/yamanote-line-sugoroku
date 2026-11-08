import type { AnimationSpeedId } from "../gameConfig";
import type { GameSettings, PresentationLevel } from "../gameSettings";

export interface TurnMomentTiming {
  readonly stepMs: number;
  readonly tumbleMs: number;
  readonly stampsMs: number;
  readonly arrivalMs: number | null;
  readonly lotteryFlipMs: number;
  readonly lotterySettleMs: number;
  readonly pickupMs: number;
  readonly flashMs: number;
}

export interface TurnPresentationPolicy {
  readonly speedId: AnimationSpeedId;
  readonly level: PresentationLevel;
  readonly timing: TurnMomentTiming;
  readonly showTumble: boolean;
  readonly showStamps: boolean;
  readonly showArrival: boolean;
  readonly showImportantMoments: boolean;
}

/** Explicit timings captured with the movement step; the three legacy rows retain their rounded durations. */
const TURN_MOMENT_TIMINGS: Readonly<Record<AnimationSpeedId, TurnMomentTiming>> = {
  slow: Object.freeze({
    stepMs: 600, tumbleMs: 800, stampsMs: 320, arrivalMs: 1_067,
    lotteryFlipMs: 2_133, lotterySettleMs: 533, pickupMs: 667, flashMs: 1_067,
  }),
  normal: Object.freeze({
    stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800,
    lotteryFlipMs: 1_600, lotterySettleMs: 400, pickupMs: 500, flashMs: 800,
  }),
  fast: Object.freeze({
    stepMs: 300, tumbleMs: 400, stampsMs: 160, arrivalMs: 533,
    lotteryFlipMs: 1_067, lotterySettleMs: 267, pickupMs: 333, flashMs: 533,
  }),
  "very-fast": Object.freeze({
    stepMs: 120, tumbleMs: 160, stampsMs: 64, arrivalMs: null,
    lotteryFlipMs: 280, lotterySettleMs: 100, pickupMs: 140, flashMs: 180,
  }),
};

export function turnMomentTiming(speedId: AnimationSpeedId): TurnMomentTiming {
  return TURN_MOMENT_TIMINGS[speedId];
}

export function captureTurnPresentationPolicy(
  settings: Pick<GameSettings, "speedId" | "presentationLevel">,
): TurnPresentationPolicy {
  return Object.freeze({
    speedId: settings.speedId,
    level: settings.presentationLevel,
    timing: turnMomentTiming(settings.speedId),
    showTumble: true,
    showStamps: true,
    showArrival: turnMomentTiming(settings.speedId).arrivalMs !== null,
    showImportantMoments: true,
  });
}
