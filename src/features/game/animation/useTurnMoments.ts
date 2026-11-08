import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AnimationSpeedId } from "../gameConfig";
import { captureTurnPresentationPolicy } from "./turnMomentPolicy";
import type { MoveAnimation } from "../gameSession";
import {
  INITIAL_TURN_MOMENTS_STATE,
  turnMomentsReducer,
  type PreMoveStage,
  type RollAttempt,
  type TurnMomentObservation,
  type TurnOrigin,
} from "./turnMoments";
import {
  useRevealSequence,
  type RevealObservation,
  type RevealStage,
  type RevealSequence,
} from "./useRevealSequence";
import type { TurnRevealState } from "../turnMomentPresentation";

export interface UseTurnMomentsOptions {
  sessionId: number;
  gameTurn: number;
  decisionRevision: number;
  /** Origin snapshot captured by `begin`; null (classic mode, no session) makes `begin` a no-op. */
  origin: TurnOrigin | null;
  /** Selected 速度; the attempt captures its policy (and movement step) at `begin`. */
  speedId: AnimationSpeedId;
  reducedMotion: boolean;
  observation: TurnMomentObservation;
  revealObservation: RevealObservation;
  revealStages: readonly RevealStage[];
  animation: MoveAnimation | null;
  finishAnimation: (animation: MoveAnimation) => void;
}

export interface TurnMoments {
  attempt: RollAttempt | null;
  revealStage: TurnRevealState;
  reveal: RevealSequence;
  restoredOrOmitted: boolean;
  movementStartAllowed: boolean;
  /**
   * Reduced motion was on at some render of the current attempt. Sticky for the attempt key: the attempt's own
   * movement must then finish instantly even if the preference is turned off again before it starts.
   */
  attemptMotionReduced: boolean;
  begin: (source?: "click" | "restored-roll") => void;
  skip: () => void;
  advance: (expectedStage: PreMoveStage) => void;
}

interface FrozenStages {
  key: string;
  stages: readonly RevealStage[];
}

const EMPTY_STAGES: readonly RevealStage[] = [];

/**
 * Whether `animation` is the movement of `attempt`. A turn ending in a pending discard animates under the prior
 * engine turn (`recordTurn - 1`); the previous turn's own movement has always finished before a roll is accepted.
 */
export function attemptOwnsAnimation(attempt: RollAttempt | null, animation: MoveAnimation | null): boolean {
  if (!attempt || !animation || animation.sessionId !== attempt.sessionId) return false;
  return animation.turn === attempt.recordTurn || animation.turn === attempt.recordTurn - 1;
}

function durationForStage(stage: RevealStage, attempt: RollAttempt | null): RevealStage {
  if (!attempt) return stage;
  const durations: Readonly<Record<string, number | null | undefined>> = {
    arrival: attempt.policy.timing.arrivalMs,
    "lottery-flip": attempt.policy.timing.lotteryFlipMs,
    "lottery-settle": attempt.policy.timing.lotterySettleMs,
    pickup: attempt.policy.timing.pickupMs,
  };
  const durationMs = durations[stage.key];
  return durationMs === undefined || durationMs === null ? stage : { ...stage, durationMs };
}

/** Coordinates the roll attempt and the post-move reveal without owning game state. */
export function useTurnMoments(options: UseTurnMomentsOptions): TurnMoments {
  const [state, dispatch] = useReducer(turnMomentsReducer, INITIAL_TURN_MOMENTS_STATE);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resetState = state.sessionId === options.sessionId
    ? state : turnMomentsReducer(state, { type: "reset", sessionId: options.sessionId });
  if (resetState !== state) dispatch({ type: "reset", sessionId: options.sessionId });
  const currentState = resetState;
  if (currentState.sessionId === options.sessionId && currentState.attempt !== null) {
    const observedState = turnMomentsReducer(currentState, {
      type: "observe",
      sessionId: options.sessionId,
      facts: { ...options.observation, reducedMotion: options.reducedMotion },
    });
    if (observedState !== currentState) {
      dispatch({ type: "observe", sessionId: options.sessionId,
        facts: { ...options.observation, reducedMotion: options.reducedMotion } });
    }
  }
  const attempt = currentState.sessionId === options.sessionId ? currentState.attempt : null;
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const revealKey = options.revealObservation.recordTurn === null
    ? `${options.revealObservation.sessionId}:none`
    : `${options.revealObservation.sessionId}:${options.revealObservation.recordTurn}`;
  const revealOmissionRef = useRef<{ key: string; omitted: boolean }>({ key: revealKey, omitted: false });
  if (revealOmissionRef.current.key !== revealKey) revealOmissionRef.current = { key: revealKey, omitted: false };
  if (options.reducedMotion && options.revealObservation.recordTurn !== null) revealOmissionRef.current.omitted = true;
  // The latch belongs to the record it was taken on: a newer attempt (whose record does not exist yet, while lastMove
  // still holds the previous one) must not inherit that record's omission.
  const revealMotionOmitted = revealOmissionRef.current.omitted &&
    (attempt === null || attempt.recordTurn === options.revealObservation.recordTurn);
  const reducedOmissionRef = useRef<{ key: string | null; omitted: boolean }>({ key: null, omitted: false });
  if (attempt === null || reducedOmissionRef.current.key !== attempt.key) {
    reducedOmissionRef.current = { key: attempt?.key ?? null, omitted: false };
  }
  if (attempt && options.reducedMotion) reducedOmissionRef.current.omitted = true;
  const reducedMotionOmitted = Boolean(attempt && reducedOmissionRef.current.key === attempt.key &&
    reducedOmissionRef.current.omitted);

  const timedStage = !attempt?.motionOmitted && (attempt?.stage === "tumble" || attempt?.stage === "stamps")
    ? attempt.stage : null;
  const timedDuration = timedStage === "tumble" ? attempt?.policy.timing.tumbleMs
    : timedStage === "stamps" ? attempt?.policy.timing.stampsMs : null;
  useEffect(() => {
    if (!attempt || timedStage === null || timedDuration === null) return;
    const key = attempt.key;
    const expectedStage = timedStage;
    const timer = window.setTimeout(() => dispatch({ type: "advance", key, expectedStage }), timedDuration);
    return () => window.clearTimeout(timer);
  }, [attempt?.key, timedStage, timedDuration]);

  const begin = useCallback((source: "click" | "restored-roll" = "click") => {
    const current = optionsRef.current;
    if (current.origin === null) return;
    const key = `${current.sessionId}:roll:${current.gameTurn + 1}:${current.decisionRevision}`;
    reducedOmissionRef.current = { key, omitted: current.reducedMotion };
    dispatch({ type: "begin", sessionId: current.sessionId, turn: current.gameTurn,
      decisionRevision: current.decisionRevision, origin: current.origin,
      policy: captureTurnPresentationPolicy({ speedId: current.speedId, presentationLevel: "all" }), reducedMotion: current.reducedMotion, source });
  }, []);

  const frozenStagesRef = useRef<FrozenStages>({ key: "", stages: EMPTY_STAGES });
  if (frozenStagesRef.current.key !== revealKey) {
    const timingAttempt = attempt?.sessionId === options.revealObservation.sessionId &&
      attempt.recordTurn === options.revealObservation.recordTurn ? attempt : null;
    frozenStagesRef.current = {
      key: revealKey,
      stages: options.revealStages.map((stage) => durationForStage(stage, timingAttempt)),
    };
  }
  const sequence = useRevealSequence({
    observation: {
      ...options.revealObservation,
      pendingDecisionKind: options.observation.decision?.kind ?? null,
    },
    stages: frozenStagesRef.current.stages,
    reducedMotion: options.reducedMotion || reducedMotionOmitted,
    skipRequested: attempt?.skipRequested ?? false,
  });
  const revealSkipRef = useRef(sequence.skip);
  revealSkipRef.current = sequence.skip;

  const skip = useCallback(() => {
    const currentAttempt = attemptRef.current;
    if (currentAttempt) dispatch({ type: "skip", key: currentAttempt.key });
    revealSkipRef.current();
  }, []);
  const advance = useCallback((expectedStage: PreMoveStage) => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) return;
    dispatch({ type: "advance", key: currentAttempt.key, expectedStage });
  }, []);

  const finishedRef = useRef(new Set<string>());
  useEffect(() => {
    if (attempt?.skipRequested !== true || options.animation === null) return;
    const animation = options.animation;
    if (!attemptOwnsAnimation(attempt, animation)) return;
    const signature = `${animation.sessionId}:${animation.turn}:${animation.decisionRevision ?? "classic"}`;
    if (finishedRef.current.has(signature)) return;
    finishedRef.current.add(signature);
    options.finishAnimation(animation);
  }, [attempt?.key, attempt?.skipRequested, options.animation, options.finishAnimation]);

  useEffect(() => {
    finishedRef.current.clear();
  }, [options.sessionId]);

  const restoredOrOmitted = options.reducedMotion || reducedMotionOmitted || revealMotionOmitted ||
    (attempt?.source === "restored-roll" && !attempt.recordAccepted);
  const movementStartAllowed = attempt === null ||
    ((attempt.stage === "released" || (attempt.motionOmitted && attempt.recordAccepted)) && !attempt.skipRequested);

  return {
    attempt,
    revealStage: sequence.stage as TurnRevealState,
    reveal: sequence,
    restoredOrOmitted,
    movementStartAllowed,
    attemptMotionReduced: reducedMotionOmitted,
    begin,
    skip,
    advance,
  };
}
