// Timing for the move animation: each station hop takes the same time
// (spec 11: 0.3-0.6 s per station), eased so the marker slows into each
// station like a train. Pure: elapsed time is passed in.

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

/** Where the marker is `elapsedMs` into a move of `steps` at `stepMs` per hop. */
export function frameAt(
  steps: readonly StepPath[],
  elapsedMs: number,
  stepMs: number,
): AnimationFrame {
  const last = steps.at(-1);
  const finalPosition = last ? positionAlong(last, 1) : null;
  if (!last || stepMs <= 0 || elapsedMs >= steps.length * stepMs) {
    return { stepsCompleted: steps.length, position: finalPosition, done: true };
  }
  const elapsed = Math.max(elapsedMs, 0);
  const stepIndex = Math.floor(elapsed / stepMs);
  const step = steps[stepIndex] ?? last;
  const fraction = easeInOut((elapsed - stepIndex * stepMs) / stepMs);
  return { stepsCompleted: stepIndex, position: positionAlong(step, fraction), done: false };
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
