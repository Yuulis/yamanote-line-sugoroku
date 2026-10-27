// Frame loop for the move animation, with the frame scheduler injected so the
// loop (start, finish, cancel) is testable without a browser.

import type { StepPath } from "./movePath";
import { type AnimationFrame, frameAt } from "./timeline";

export interface FrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export const browserFrameScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

/**
 * Play `steps` at `stepMs` per hop, reporting each frame and then `onDone`
 * exactly once. An empty plan or `stepMs <= 0` (reduced motion) finishes
 * synchronously without frames. Progress comes from elapsed time, so a tab
 * that was hidden (frames paused) catches up on its first visible frame.
 *
 * @returns cancel: stops the loop; no callback fires after it.
 */
export function runMoveAnimation(
  steps: readonly StepPath[],
  stepMs: number,
  scheduler: FrameScheduler,
  onFrame: (frame: AnimationFrame) => void,
  onDone: () => void,
  maxDurationMs = Infinity,
): () => void {
  if (steps.length === 0 || stepMs <= 0) {
    onDone();
    return () => {};
  }
  let cancelled = false;
  let startedAt: number | null = null;
  let handle = 0;
  const tick = (now: number) => {
    if (cancelled) return;
    startedAt ??= now;
    const frame = frameAt(steps, now - startedAt, stepMs, maxDurationMs);
    onFrame(frame);
    if (frame.done) {
      onDone();
      return;
    }
    handle = scheduler.request(tick);
  };
  handle = scheduler.request(tick);
  return () => {
    cancelled = true;
    scheduler.cancel(handle);
  };
}
