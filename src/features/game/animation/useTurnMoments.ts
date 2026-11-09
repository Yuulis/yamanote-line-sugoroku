import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AnimationSpeedId } from "../gameConfig";
import type { PresentationLevel } from "../gameSettings";
import type { DeepReadonly, ItemTurnRecord } from "../../../types/network";
import { captureTurnPresentationPolicy, type TurnMomentTiming, type TurnPresentationPolicy } from "./turnMomentPolicy";
import type { MoveAnimation } from "../gameSession";
import {
  buildTurnRevealStages,
  segmentFlashFeatureIds,
  type SegmentFlashGeometry,
  type TurnRevealStageKey,
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
  /** Captured at begin; callers keep the existing all-level behaviour until the menu is wired. */
  presentationLevel?: PresentationLevel;
  reducedMotion: boolean;
  observation: TurnMomentObservation;
  revealObservation: RevealObservation;
  latestRecord: DeepReadonly<ItemTurnRecord> | null;
  restoredRecord: boolean;
  /** The publication-boundary seam supplies its own stage instead of scheduling real reveals. */
  suppressRevealStages: boolean;
  /** Geometry for standalone flashes; absent until the caller enables card-less presentation. */
  segmentFlashGeometry?: SegmentFlashGeometry;
  animation: MoveAnimation | null;
  finishAnimation: (animation: MoveAnimation) => void;
}

export interface TurnMoments {
  attempt: RollAttempt | null;
  revealStage: TurnRevealState;
  reveal: RevealSequence<TurnRevealStageKey>;
  revealTiming: TurnMomentTiming;
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

interface FrozenRevealPlan {
  readonly key: string;
  readonly policy: TurnPresentationPolicy;
  readonly stages: readonly RevealStage<TurnRevealStageKey>[];
}

const EMPTY_STAGES: readonly RevealStage<TurnRevealStageKey>[] = [];

/**
 * Whether `animation` is the movement of `attempt`. A turn ending in a pending discard animates under the prior
 * engine turn (`recordTurn - 1`); the previous turn's own movement has always finished before a roll is accepted.
 */
export function attemptOwnsAnimation(attempt: RollAttempt | null, animation: MoveAnimation | null): boolean {
  if (!attempt || !animation || animation.sessionId !== attempt.sessionId) return false;
  return animation.turn === attempt.recordTurn || animation.turn === attempt.recordTurn - 1;
}

/** Coordinates the roll attempt and the post-move reveal without owning game state. */
export function useTurnMoments(options: UseTurnMomentsOptions): TurnMoments {
  const [state, dispatch] = useReducer(turnMomentsReducer, INITIAL_TURN_MOMENTS_STATE);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resetState = state.sessionId === options.sessionId
    ? state : turnMomentsReducer(state, { type: "reset", sessionId: options.sessionId });
  if (resetState !== state) dispatch({ type: "reset", sessionId: options.sessionId });
  let currentState = resetState;
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
    currentState = observedState;
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
    (attempt === null || attempt.recordTurn <= (options.revealObservation.recordTurn ?? 0));
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
      policy: captureTurnPresentationPolicy({ speedId: current.speedId, presentationLevel: current.presentationLevel ?? "all" }),
      reducedMotion: current.reducedMotion, source });
  }, []);

  const matchingAttempt = attempt?.sessionId === options.revealObservation.sessionId &&
    attempt.recordTurn === options.revealObservation.recordTurn ? attempt : null;
  const frozenPlanRef = useRef<FrozenRevealPlan | null>(null);
  if (frozenPlanRef.current?.key !== revealKey) frozenPlanRef.current = null;
  const record = options.latestRecord;
  if (frozenPlanRef.current === null && record !== null && record.turn === options.revealObservation.recordTurn &&
    options.sessionId === options.revealObservation.sessionId && (!matchingAttempt || matchingAttempt.recordAccepted)) {
    const policy = matchingAttempt?.policy ?? captureTurnPresentationPolicy({
      speedId: options.speedId, presentationLevel: options.presentationLevel ?? "all",
    });
    const segmentIds = matchingAttempt?.newlyCompletedTargetSegmentIds ?? [];
    const geometry = options.segmentFlashGeometry;
    const hasRenderableNewTargetSegments = geometry !== undefined && matchingAttempt?.motionOmitted === false &&
      segmentFlashFeatureIds(geometry, geometry.targetSegmentIds, segmentIds).length > 0;
    frozenPlanRef.current = Object.freeze({
      key: revealKey,
      policy,
      stages: Object.freeze(buildTurnRevealStages({
        record: options.suppressRevealStages ? null : record,
        restored: options.restoredRecord,
        omitted: options.reducedMotion || revealMotionOmitted,
        newlyCompletedTargetSegmentIds: segmentIds,
        hasRenderableNewTargetSegments,
      }, policy).map((stage) => Object.freeze(stage))),
    });
  }
  const plan = frozenPlanRef.current;
  const sequence = useRevealSequence({
    observation: {
      ...options.revealObservation,
      // An early empty plan would mark this key done forever; observe it only once its facts can be frozen.
      recordTurn: plan === null ? null : options.revealObservation.recordTurn,
      movementComplete: plan !== null && options.revealObservation.movementComplete,
      pendingDecisionKind: options.observation.decision?.kind ?? null,
    },
    stages: plan?.stages ?? EMPTY_STAGES,
    reducedMotion: options.reducedMotion || Boolean(matchingAttempt && reducedMotionOmitted),
    skipRequested: matchingAttempt?.skipRequested ?? false,
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

  const attemptIsCurrent = attempt !== null &&
    attempt.recordTurn >= (options.revealObservation.recordTurn ?? 0);
  const restoredOrOmitted = options.reducedMotion || revealMotionOmitted ||
    (attemptIsCurrent && (reducedMotionOmitted || (attempt.source === "restored-roll" && !attempt.recordAccepted)));
  const movementStartAllowed = attempt === null ||
    ((attempt.stage === "released" || (attempt.motionOmitted && attempt.recordAccepted)) && !attempt.skipRequested);

  return {
    attempt,
    revealStage: sequence.stage,
    reveal: sequence,
    revealTiming: plan?.policy.timing ?? attempt?.policy.timing ??
      captureTurnPresentationPolicy({ speedId: options.speedId, presentationLevel: "all" }).timing,
    restoredOrOmitted,
    movementStartAllowed,
    attemptMotionReduced: reducedMotionOmitted,
    begin,
    skip,
    advance,
  };
}
