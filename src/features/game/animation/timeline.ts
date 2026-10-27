import type { Position } from "../../../types/data";
import { positionAlong, type StepPath } from "./movePath";

export interface AnimationFrame {
  /** Hops fully finished so far (0..steps.length). */
  stepsCompleted: number;
  position: Position | null;
  done: boolean;
}

/** Ease-in-out (sine): 0 -> 0, 1 -> 1, symmetric, zero speed at both ends. */
export function easeInOut(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return (1 - Math.cos(Math.PI * clamped)) / 2;
}

/** Normal speed: 450 ms at 1 km, bounded at 300–1,200 ms; other speeds scale proportionally. */
export interface HopTiming { referenceKm: number; minScale: number; maxScale: number }

export const HOP_TIMING: HopTiming = { referenceKm: 1, minScale: 2 / 3, maxScale: 8 / 3 };

export function hopDurationMs(step: StepPath, stepMs: number, timing: HopTiming = HOP_TIMING): number {
  if (stepMs <= 0) return 0;
  if (step.distanceKm === undefined) return stepMs;
  const scale = Math.sqrt(Math.max(step.distanceKm, 0) / timing.referenceKm);
  return stepMs * Math.min(timing.maxScale, Math.max(timing.minScale, scale));
}

export const MAX_MOVE_DURATION_MS = 6_000;

/** Sample elapsed time across distance-paced hops; passed stations never add steps. */
export function frameAt(
  steps: readonly StepPath[], elapsedMs: number, stepMs: number, maxDurationMs = Infinity,
): AnimationFrame {
  const last = steps.at(-1);
  const finalPosition = last ? positionAlong(last, 1) : null;
  if (!last || stepMs <= 0) return { stepsCompleted: steps.length, position: finalPosition, done: true };
  const naturalDuration = steps.reduce((sum, step) => sum + hopDurationMs(step, stepMs), 0);
  const durationScale = Math.min(1, maxDurationMs / naturalDuration);
  let elapsed = Math.max(elapsedMs, 0);
  for (const [index, step] of steps.entries()) {
    const duration = hopDurationMs(step, stepMs) * durationScale;
    if (elapsed < duration) {
      return { stepsCompleted: index, position: positionAlong(step, easeInOut(elapsed / duration)), done: false };
    }
    elapsed -= duration;
  }
  return { stepsCompleted: steps.length, position: finalPosition, done: true };
}

/**
 * Completed segments to draw while `stepsCompleted` hops of the current move
 * have been shown: the committed list minus segments this move completes
 * later. Keeps the committed order.
 */
export function visibleCompletedSegmentIds(
  committed: readonly string[],
  steps: readonly StepPath[],
  stepsCompleted: number,
): readonly string[] {
  const notYetShown = new Set(
    steps
      .slice(stepsCompleted)
      .filter((step) => step.newlyCompleted)
      .map((step) => step.segmentId),
  );
  if (notYetShown.size === 0) return committed;
  return committed.filter((id) => !notYetShown.has(id));
}
