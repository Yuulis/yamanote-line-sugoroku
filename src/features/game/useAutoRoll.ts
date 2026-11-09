import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  AUTO_ROLL_GAP_MS, autoRollBaseline, autoRollDisposition, autoRollReadyKey,
  type AutoRollDisposition, type AutoRollSnapshot,
} from "./autoRoll";
import type { GameSession } from "./gameSession";
import type { TurnMomentDisplay } from "./turnMomentPresentation";

export interface UseAutoRollInput {
  readonly session: GameSession;
  readonly turnDisplay: TurnMomentDisplay;
  readonly surfaceOpen: boolean;
  readonly itemDialogOpen: boolean;
  readonly confirmationOpen: boolean;
  readonly onRoll: () => void;
}

export interface AutoRollControls {
  readonly enabled: boolean;
  readonly announcement: string;
  readonly toggle: () => void;
  readonly requestRoll: () => void;
}

const AUTO_ROLL_DIALOG_RECHECK_MS = 100;
const AUTO_ROLL_MAX_DIALOG_RECHECKS = 12;

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function modalDialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("dialog[open]") !== null;
}

function dispositionReason(disposition: AutoRollDisposition): string {
  return "reason" in disposition ? disposition.reason : "";
}

function snapshotFor(input: UseAutoRollInput): AutoRollSnapshot {
  return {
    readyKey: autoRollReadyKey(input.session),
    visible: documentVisible(),
    canRoll: input.turnDisplay.canRoll,
    phase: input.turnDisplay.phase,
    decision: input.turnDisplay.decision,
    publishedMove: input.turnDisplay.itemNoticeMove,
    surfaceOpen: input.surfaceOpen,
    itemDialogOpen: input.itemDialogOpen,
    confirmationOpen: input.confirmationOpen,
    draftSelected: Boolean(input.turnDisplay.itemView?.draft.items.length),
  };
}

export function useAutoRoll(input: UseAutoRollInput): AutoRollControls {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const baselinePublishedTurnRef = useRef(0);
  const consumedReadyKeyRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<AutoRollSnapshot | null>(null);
  const latestOnRollRef = useRef(input.onRoll);
  const requestRollRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(false);
  const timerTokenRef = useRef(0);
  const timerGenerationRef = useRef(0);
  const [timerGeneration, bumpTimerGeneration] = useReducer((generation: number) => generation + 1, 0);

  const snapshot = snapshotFor(input);
  latestSnapshotRef.current = snapshot;
  latestOnRollRef.current = input.onRoll;
  const disposition = autoRollDisposition(snapshot, enabled, baselinePublishedTurnRef.current);
  const dispositionKind = disposition.kind;
  const dispositionReasonValue = dispositionReason(disposition);

  const invalidateTimers = useCallback(() => {
    timerGenerationRef.current += 1;
    bumpTimerGeneration();
  }, []);

  const requestRoll = useCallback(() => {
    const latestSnapshot = latestSnapshotRef.current;
    if (!latestSnapshot?.canRoll || consumedReadyKeyRef.current === latestSnapshot.readyKey) return;
    consumedReadyKeyRef.current = latestSnapshot.readyKey;
    invalidateTimers();
    latestOnRollRef.current();
  }, [invalidateTimers]);
  requestRollRef.current = requestRoll;

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      invalidateTimers();
      return;
    }
    if (!documentVisible()) {
      const latestSnapshot = latestSnapshotRef.current;
      if (latestSnapshot) latestSnapshotRef.current = { ...latestSnapshot, visible: false };
      return;
    }
    const latestSnapshot = latestSnapshotRef.current;
    if (!latestSnapshot) return;
    baselinePublishedTurnRef.current = autoRollBaseline(latestSnapshot.publishedMove);
    consumedReadyKeyRef.current = null;
    enabledRef.current = true;
    setEnabled(true);
    invalidateTimers();
  }, [invalidateTimers]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const latestSnapshot = latestSnapshotRef.current;
      if (latestSnapshot) latestSnapshotRef.current = { ...latestSnapshot, visible: false };
      if (!enabledRef.current) return;
      enabledRef.current = false;
      setEnabled(false);
      invalidateTimers();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [invalidateTimers]);

  useEffect(() => {
    if (dispositionKind !== "stop" || !enabledRef.current) return;
    enabledRef.current = false;
    setEnabled(false);
    invalidateTimers();
  }, [dispositionKind, dispositionReasonValue, enabled, invalidateTimers]);

  useEffect(() => {
    if (!enabled || dispositionKind !== "ready" || consumedReadyKeyRef.current === snapshot.readyKey) return undefined;

    const readyKey = snapshot.readyKey;
    const generation = timerGenerationRef.current;
    const token = ++timerTokenRef.current;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let dialogObserver: MutationObserver | undefined;
    let rechecksRemaining = AUTO_ROLL_MAX_DIALOG_RECHECKS;

    const stillReady = (): boolean => {
      if (!mountedRef.current || !enabledRef.current || token !== timerTokenRef.current ||
          generation !== timerGenerationRef.current) return false;
      const latestSnapshot = latestSnapshotRef.current;
      if (!latestSnapshot || latestSnapshot.readyKey !== readyKey || !latestSnapshot.visible) return false;
      return autoRollDisposition(latestSnapshot, enabledRef.current, baselinePublishedTurnRef.current).kind === "ready";
    };

    const checkDialog = (): void => {
      if (!stillReady()) return;
      if (!modalDialogOpen()) {
        invalidateTimers();
        return;
      }
      rechecksRemaining -= 1;
      if (rechecksRemaining <= 0) {
        const root = document.documentElement;
        if (!root || typeof MutationObserver === "undefined") return;
        dialogObserver = new MutationObserver(() => {
          if (!stillReady()) {
            dialogObserver?.disconnect();
            return;
          }
          if (!modalDialogOpen()) {
            dialogObserver?.disconnect();
            invalidateTimers();
          }
        });
        dialogObserver.observe(root, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
        return;
      }
      timeoutId = setTimeout(checkDialog, AUTO_ROLL_DIALOG_RECHECK_MS);
    };

    const onTimer = (): void => {
      if (!stillReady()) return;
      if (modalDialogOpen()) {
        timeoutId = setTimeout(checkDialog, AUTO_ROLL_DIALOG_RECHECK_MS);
        return;
      }
      requestRollRef.current();
    };

    timeoutId = setTimeout(onTimer, AUTO_ROLL_GAP_MS);
    return () => {
      timerTokenRef.current += 1;
      dialogObserver?.disconnect();
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [enabled, snapshot.readyKey, dispositionKind, dispositionReasonValue, timerGeneration, invalidateTimers]);

  return { enabled, announcement: input.turnDisplay.announcement, toggle, requestRoll };
}
