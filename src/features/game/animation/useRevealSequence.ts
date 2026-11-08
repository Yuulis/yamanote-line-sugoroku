import { useCallback, useEffect, useReducer } from "react";

export interface RevealObservation {
  /** GameApp can derive these from the session, lastMove, pending decision, and animation phase. */
  sessionId: number;
  recordTurn: number | null;
  gameTurn: number;
  pendingDecisionTurn: number | null;
  pendingDecisionKind?: "adjust" | "discard" | null;
  movementComplete: boolean;
}

export interface RevealStage<Key extends string = string> {
  key: Key;
  durationMs: number;
}

export interface UseRevealSequenceOptions<Key extends string = string> {
  observation: RevealObservation;
  stages: readonly RevealStage<Key>[];
  reducedMotion: boolean;
  skipRequested?: boolean;
}

export interface RevealSequence<Key extends string = string> {
  key: string | null;
  stage: Key | "waiting" | "done";
  busy: boolean;
  ready: boolean;
  skip: () => void;
}

export interface RevealState {
  sessionId: number | null;
  baselineTurn: number;
  key: string | null;
  stageIndex: number;
  movementComplete: boolean;
  done: boolean;
}

export type RevealAction =
  | { type: "observe"; observation: RevealObservation; stageCount: number; omit?: boolean }
  | { type: "reset" }
  | { type: "movementComplete"; key: string }
  | { type: "advance"; key: string; stageIndex: number; stageCount: number }
  | { type: "skip"; key: string };

const INITIAL_STATE: RevealState = {
  sessionId: null,
  baselineTurn: 0,
  key: null,
  stageIndex: 0,
  movementComplete: false,
  done: true,
};

function baselineFor(observation: RevealObservation): number {
  return Math.max(
    observation.gameTurn,
    observation.recordTurn ?? 0,
    observation.pendingDecisionKind === "adjust" ? 0 : observation.pendingDecisionTurn ?? 0,
  );
}

export function revealReducer(state: RevealState, action: RevealAction): RevealState {
  if (action.type === "reset") return INITIAL_STATE;

  if (action.type === "observe") {
    const { observation, stageCount, omit = false } = action;
    const sessionChanged = state.sessionId !== observation.sessionId;
    const baselineTurn = sessionChanged ? baselineFor(observation) : state.baselineTurn;
    const key = observation.recordTurn === null
      ? null
      : `${observation.sessionId}:${observation.recordTurn}`;
    if (sessionChanged || key !== state.key) {
      const alreadySeen = observation.recordTurn === null || observation.recordTurn <= baselineTurn;
      return {
        sessionId: observation.sessionId,
        baselineTurn,
        key,
        stageIndex: 0,
        movementComplete: observation.movementComplete,
        done: alreadySeen || stageCount === 0 || omit,
      };
    }
    const done = state.done || stageCount === 0 || omit;
    if (state.movementComplete === observation.movementComplete && state.done === done) return state;
    return { ...state, movementComplete: observation.movementComplete, done };
  }

  if (action.type === "movementComplete") {
    if (state.key !== action.key || state.movementComplete) return state;
    return { ...state, movementComplete: true };
  }

  if (action.type === "advance") {
    if (state.key !== action.key || state.done || !state.movementComplete || state.stageIndex !== action.stageIndex) {
      return state;
    }
    const nextIndex = state.stageIndex + 1;
    return nextIndex >= action.stageCount
      ? { ...state, stageIndex: nextIndex, done: true }
      : { ...state, stageIndex: nextIndex };
  }

  if (state.key !== action.key || state.done) return state;
  return { ...state, done: true, stageIndex: Number.MAX_SAFE_INTEGER };
}

/**
 * Sequence the presentation stages of the latest committed record. The
 * observation is folded into the reducer during render (a duplicate
 * observation returns the same state, so this settles in one extra render),
 * which keeps `key`, `busy`, `ready` and `skip` consistent from the first
 * commit of a new key. Only the current stage's duration is a timer
 * dependency, so a new `stages` array with the same content neither replays a
 * completed key nor restarts the active stage's timer.
 */
export function useRevealSequence<Key extends string = string>({ observation, stages, reducedMotion, skipRequested = false }: UseRevealSequenceOptions<Key>): RevealSequence<Key> {
  const [state, dispatch] = useReducer(revealReducer, INITIAL_STATE);
  const { sessionId, recordTurn, gameTurn, pendingDecisionTurn, pendingDecisionKind, movementComplete } = observation;
  const stageCount = stages.length;

  const observeAction: RevealAction = {
    type: "observe",
    observation: { sessionId, recordTurn, gameTurn, pendingDecisionTurn, pendingDecisionKind, movementComplete },
    stageCount,
    omit: reducedMotion || skipRequested,
  };
  const observed = revealReducer(state, observeAction);
  // Render-phase update of this component's own reducer: React re-renders
  // before committing, so the stale state is never shown.
  if (observed !== state) dispatch(observeAction);

  const current = observed.done ? undefined : stages[observed.stageIndex];
  const currentDurationMs = current ? Math.max(0, current.durationMs) : null;
  const { key, stageIndex, done } = observed;
  const pending = key !== null && !done && stageCount > 0;
  const armed = pending && observed.movementComplete;

  useEffect(() => {
    if (!armed || key === null) return;
    if (currentDurationMs === null) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "advance", key, stageIndex, stageCount });
    }, currentDurationMs);
    return () => window.clearTimeout(timer);
  }, [armed, key, stageIndex, stageCount, currentDurationMs]);

  const skip = useCallback(() => {
    if (key === null) return;
    dispatch({ type: "skip", key });
  }, [key]);

  const noStages = stageCount === 0;
  return {
    key,
    stage: noStages || done ? "done" : observed.movementComplete ? current?.key ?? "done" : "waiting",
    busy: !noStages && key !== null && !done,
    ready: observed.movementComplete && done,
    skip,
  };
}
