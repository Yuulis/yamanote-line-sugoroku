import { useEffect, useMemo, useRef, useState } from "react";
import type { RailwayNetwork } from "../engine";
import type { MoveAnimation } from "../gameSession";
import type { AnimationView } from "./displayedProgress";
import { buildMovePlan, type GeometryIndex } from "./movePath";
import { browserFrameScheduler, runMoveAnimation } from "./runner";
import type { AnimationFrame } from "./timeline";

interface FrameState {
  animation: MoveAnimation;
  frame: AnimationFrame;
}

/**
 * Drive the marker along the current move. `stepMs` is read when a move
 * starts, so a speed change applies from the next move; turning on reduced
 * motion (`stepMs` 0) finishes the current move immediately. `onFinished` is
 * called once per move (the reducer also ignores repeats and stale ids).
 */
export function useMoveAnimation(
  animation: MoveAnimation | null,
  network: RailwayNetwork,
  geometry: GeometryIndex,
  stepMs: number,
  onFinished: (animation: MoveAnimation) => void,
): AnimationView | null {
  const [frameState, setFrameState] = useState<FrameState | null>(null);
  const stepMsRef = useRef(stepMs);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    stepMsRef.current = stepMs;
    onFinishedRef.current = onFinished;
  });

  const steps = useMemo(
    () => (animation ? buildMovePlan(animation.events, network, geometry) : []),
    [animation, network, geometry],
  );

  // Switching to instant (reduced motion turned on mid-move) restarts the
  // effect, which then finishes the move at once; plain speed changes do not.
  const instant = stepMs <= 0;
  useEffect(() => {
    if (!animation) return;
    return runMoveAnimation(
      steps,
      stepMsRef.current,
      browserFrameScheduler,
      (frame) => setFrameState({ animation, frame }),
      () => onFinishedRef.current(animation),
    );
  }, [animation, steps, instant]);

  // A frame left over from an earlier move must never move the marker back.
  const frame = animation && frameState?.animation === animation ? frameState.frame : null;
  return useMemo(
    () => (animation ? { fromStationId: animation.fromStationId, steps, frame } : null),
    [animation, steps, frame],
  );
}
