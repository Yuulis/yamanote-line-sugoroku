import { useCallback, useEffect, useReducer, useRef } from "react";
import type { MoveAnimation } from "../gameSession";
import {
  INITIAL_TURN_MOMENTS_STATE,
  turnMomentTiming,
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
  origin: TurnOrigin;
  stepMs: number;
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
  begin: (source?: "click" | "restored-roll") => void;
  skip: () => void;
  advance: (expectedStage: PreMoveStage) => void;
}

interface FrozenStages {
  key: string;
  stages: readonly RevealStage[];
}

const EMPTY_STAGES: readonly RevealStage[] = [];

function durationForStage(stage: RevealStage, attempt: RollAttempt | null): RevealStage {
  if (!attempt) return stage;
  const durations: Readonly<Record<string, number | undefined>> = {
    arrival: attempt.timing.arrivalMs,
    "lottery-flip": attempt.timing.lotteryFlipMs,
    "lottery-settle": attempt.timing.lotterySettleMs,
    pickup: attempt.timing.pickupMs,
  };
  const durationMs = durations[stage.key];
  return durationMs === undefined ? stage : { ...stage, durationMs };
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
  const revealMotionOmitted = revealOmissionRef.current.omitted;
  const reducedOmissionRef = useRef<{ key: string | null; omitted: boolean }>({ key: null, omitted: false });
  if (attempt === null || reducedOmissionRef.current.key !== attempt.key) {
    reducedOmissionRef.current = { key: attempt?.key ?? null, omitted: false };
  }
  if (attempt && options.reducedMotion) reducedOmissionRef.current.omitted = true;
  const reducedMotionOmitted = Boolean(attempt && reducedOmissionRef.current.key === attempt.key &&
    reducedOmissionRef.current.omitted);

  const timedStage = !attempt?.motionOmitted && (attempt?.stage === "tumble" || attempt?.stage === "stamps")
    ? attempt.stage : null;
  const timedDuration = timedStage === "tumble" ? attempt?.timing.tumbleMs
    : timedStage === "stamps" ? attempt?.timing.stampsMs : null;
  useEffect(() => {
    if (!attempt || timedStage === null || timedDuration === null) return;
    const key = attempt.key;
    const expectedStage = timedStage;
    const timer = window.setTimeout(() => dispatch({ type: "advance", key, expectedStage }), timedDuration);
    return () => window.clearTimeout(timer);
  }, [attempt?.key, timedStage, timedDuration]);

  const begin = useCallback((source: "click" | "restored-roll" = "click") => {
    const current = optionsRef.current;
    const key = `${current.sessionId}:roll:${current.gameTurn + 1}:${current.decisionRevision}`;
    reducedOmissionRef.current = { key, omitted: current.reducedMotion };
    dispatch({ type: "begin", sessionId: current.sessionId, turn: current.gameTurn,
      decisionRevision: current.decisionRevision, origin: current.origin,
      timing: turnMomentTiming(current.stepMs), reducedMotion: current.reducedMotion, source });
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
    if (animation.sessionId !== attempt.sessionId || animation.turn !== attempt.recordTurn) return;
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
    begin,
    skip,
    advance,
  };
}
