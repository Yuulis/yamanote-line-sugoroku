import { useCallback, useEffect, useRef, useState } from "react";
import {
  FIRST_PLAY_HINT_IDS,
  createGuideQueueState,
  guideCandidateHintId,
  guideQueueReducer,
  isGuideDisplayCurrent,
  type GuideAcknowledgement,
  type GuideAnnouncement,
  type GuideCandidate,
  type GuideHintId,
  type GuideQueueAction,
  type GuideQueueState,
} from "./firstPlayGuide";
import {
  readGuideHintSeen,
  readGuideHintsDisabled,
  writeGuideHintSeen,
  writeGuideHintsDisabled,
} from "./store/guide";
import type { StorageLike } from "./store/persistence";

function loadGuideQueueState(sessionId: number | null, storage: StorageLike | null): GuideQueueState {
  const seenIds = FIRST_PLAY_HINT_IDS.filter((hintId) => {
    const read = readGuideHintSeen(storage, hintId);
    return read.readable && read.value === "1";
  });
  const disabledRead = readGuideHintsDisabled(storage);
  return createGuideQueueState(sessionId, seenIds, disabledRead.readable && disabledRead.value === "1");
}

export interface UseFirstPlayGuideOptions {
  readonly sessionId: number | null;
  readonly candidates: readonly GuideCandidate[];
  readonly storage: StorageLike | null;
  /** Caller folds modal and animation ownership into this render-time visibility gate. */
  readonly obscured: boolean;
  readonly showClear: boolean;
  /** Optional visibility seam for deterministic tests; browser visibility is used by default. */
  readonly documentVisible?: boolean;
}

export interface UseFirstPlayGuideResult {
  readonly currentCandidate: GuideCandidate | null;
  readonly queuedCandidates: readonly GuideCandidate[];
  readonly card: { readonly candidate: GuideCandidate; readonly acknowledgement: GuideAcknowledgement } | null;
  readonly announcement: GuideAnnouncement | null;
  readonly seenIds: readonly GuideHintId[];
  readonly closedIds: readonly GuideHintId[];
  readonly hintsDisabled: boolean;
  readonly onCardShown: (acknowledgement: GuideAcknowledgement) => void;
  readonly onStatusAcknowledged: (acknowledgement: GuideAcknowledgement) => void;
  readonly closeCurrent: () => void;
  readonly disableHints: () => void;
}

function browserDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function useBrowserDocumentVisible(): boolean {
  const [visible, setVisible] = useState(browserDocumentVisible);
  useEffect(() => {
    const update = (): void => setVisible(browserDocumentVisible());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** Owns per-session hint queue, visibility generations, acknowledgements, and safe persistence. */
export function useFirstPlayGuide(options: UseFirstPlayGuideOptions): UseFirstPlayGuideResult {
  const [state, setState] = useState(() => loadGuideQueueState(options.sessionId, options.storage));
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const browserVisible = useBrowserDocumentVisible();
  stateRef.current = state;
  optionsRef.current = options;

  const transition = useCallback((action: GuideQueueAction): GuideQueueState => {
    const next = guideQueueReducer(stateRef.current, action);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
    return next;
  }, []);

  const loadSession = useCallback((sessionId: number | null): void => {
    const loaded = loadGuideQueueState(sessionId, optionsRef.current.storage);
    const inMemory = stateRef.current;
    transition({
      type: "resetSession",
      sessionId,
      seenIds: [...new Set([...loaded.seenIds, ...inMemory.seenIds])],
      hintsDisabled: loaded.hintsDisabled || inMemory.hintsDisabled,
    });
  }, [transition]);

  useEffect(() => {
    if (stateRef.current.sessionId !== options.sessionId) loadSession(options.sessionId);
  }, [loadSession, options.sessionId]);

  useEffect(() => {
    transition({ type: "enqueue", sessionId: options.sessionId, candidates: options.candidates });
  }, [options.candidates, options.sessionId, transition]);

  useEffect(() => {
    if (options.showClear) transition({ type: "discard" });
  }, [options.sessionId, options.showClear, transition]);

  const documentVisible = options.documentVisible ?? browserVisible;
  const canPresent = options.sessionId !== null && stateRef.current.sessionId === options.sessionId
    && documentVisible && !options.obscured && !options.showClear
    && !stateRef.current.hintsDisabled && !stateRef.current.ended;

  useEffect(() => {
    const current = stateRef.current;
    if (current.sessionId !== options.sessionId) return;
    if (!canPresent) {
      if (current.display !== null) transition({ type: "withdrawDisplay" });
      return;
    }
    if (current.current !== null && current.display === null) transition({ type: "beginDisplay" });
  }, [canPresent, options.sessionId, state.current?.key, state.display?.acknowledgement.displayGeneration, transition]);

  const acknowledge = useCallback((kind: "visible" | "status", acknowledgement: GuideAcknowledgement): void => {
    const latest = optionsRef.current;
    const current = stateRef.current;
    const visibleNow = latest.sessionId !== null && latest.sessionId === acknowledgement.sessionId
      && current.sessionId === latest.sessionId && !latest.showClear && !latest.obscured
      && (latest.documentVisible ?? browserDocumentVisible())
      && !current.hintsDisabled && !current.ended;
    if (!visibleNow || !isGuideDisplayCurrent(current, acknowledgement) || current.current === null) return;
    const hintId = guideCandidateHintId(current.current);
    const next = transition({
      type: kind === "visible" ? "acknowledgeVisible" : "acknowledgeStatus",
      acknowledgement,
    });
    if (!current.seenIds.includes(hintId) && next.seenIds.includes(hintId)) {
      writeGuideHintSeen(latest.storage, hintId);
    }
  }, [transition]);

  const onCardShown = useCallback((acknowledgement: GuideAcknowledgement): void => {
    acknowledge("visible", acknowledgement);
  }, [acknowledge]);

  const onStatusAcknowledged = useCallback((acknowledgement: GuideAcknowledgement): void => {
    acknowledge("status", acknowledgement);
  }, [acknowledge]);

  const closeCurrent = useCallback((): void => {
    const latest = optionsRef.current;
    if (stateRef.current.sessionId !== latest.sessionId || latest.showClear) return;
    transition({ type: "closeCurrent" });
  }, [transition]);

  const disableHints = useCallback((): void => {
    const latest = optionsRef.current;
    const current = stateRef.current;
    if (current.sessionId !== latest.sessionId || latest.sessionId === null || latest.showClear) return;
    const next = transition({ type: "disableHints" });
    if (!current.hintsDisabled && next.hintsDisabled) writeGuideHintsDisabled(latest.storage);
  }, [transition]);

  const visibleDisplay = canPresent && state.sessionId === options.sessionId
    && state.current !== null && state.display !== null
    && state.display.acknowledgement.candidateKey === state.current.key
    ? state.display : null;
  return {
    currentCandidate: state.sessionId === options.sessionId ? state.current : null,
    queuedCandidates: state.sessionId === options.sessionId ? state.queued : [],
    card: visibleDisplay && state.current ? { candidate: state.current, acknowledgement: visibleDisplay.acknowledgement } : null,
    announcement: visibleDisplay?.announcement ?? null,
    seenIds: state.sessionId === options.sessionId ? state.seenIds : [],
    closedIds: state.sessionId === options.sessionId ? state.closedIds : [],
    hintsDisabled: state.sessionId === options.sessionId && state.hintsDisabled,
    onCardShown,
    onStatusAcknowledged,
    closeCurrent,
    disableHints,
  };
}

