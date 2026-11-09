import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  AUTO_ROLL_ANNOUNCEMENTS, autoRollBaseline, autoRollDisposition,
  autoRollReadyKey, scheduleAutoRollTimer, selectAutoRollAnnouncement,
  type AutoRollAnnouncementState, type AutoRollDisposition, type AutoRollSnapshot,
} from "./autoRoll";
import type { PreRollItemCommand } from "../../types/network";
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

const OFF_ANNOUNCEMENT_STATE: AutoRollAnnouncementState = {
  kind: "off", text: "", publicationKey: null, stopReason: null,
};

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
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

function publicationIdentity(input: UseAutoRollInput): string | null {
  const move = input.turnDisplay.itemNoticeMove;
  if (input.turnDisplay.phase !== "published" || !move) return null;
  const record = move.itemRecord;
  const turn = record?.turn ?? input.turnDisplay.turn;
  const pendingDiscard = record?.discardedInstanceId === null && record.itemEvents.some((event) => event.type === "pickup-pending-discard");
  return `${input.session.sessionId}:${turn}:${pendingDiscard ? "pending" : "resolved"}`;
}

function pickupStopAnnouncement(summary: string): string {
  return `${AUTO_ROLL_ANNOUNCEMENTS.pickup} ${summary}`;
}

function stopAnnouncementState(
  reason: "manual" | "hidden", text: string,
): AutoRollAnnouncementState {
  return { kind: "stop", text, publicationKey: null, stopReason: reason };
}

function releaseStopState(state: AutoRollAnnouncementState): AutoRollAnnouncementState {
  return state.kind === "stop" || state.kind === "pickup-stop-pending"
    ? { kind: "released", text: "", publicationKey: null, stopReason: null } : state;
}

function sameDraftSelection(
  previous: readonly PreRollItemCommand[] | undefined,
  current: readonly PreRollItemCommand[] | undefined,
): boolean {
  const previousItems = previous ?? [];
  const currentItems = current ?? [];
  return previousItems.length === currentItems.length && previousItems.every((item, index) => {
    const currentItem = currentItems[index];
    if (!currentItem || item.kind !== currentItem.kind || item.instanceId !== currentItem.instanceId) return false;
    if (item.kind === "route-ticket" && currentItem.kind === "route-ticket") return item.serviceId === currentItem.serviceId;
    if (item.kind === "direction-ticket" && currentItem.kind === "direction-ticket") return item.direction === currentItem.direction;
    return true;
  });
}

export function useAutoRoll(input: UseAutoRollInput): AutoRollControls {
  const [enabled, setEnabled] = useState(false);
  const [announcementState, setAnnouncementState] = useState<AutoRollAnnouncementState>(OFF_ANNOUNCEMENT_STATE);
  const enabledRef = useRef(false);
  const baselinePublishedTurnRef = useRef(0);
  const consumedReadyKeyRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<AutoRollSnapshot | null>(null);
  const latestOnRollRef = useRef(input.onRoll);
  const latestInputRef = useRef(input);
  const requestRollRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(false);
  const [timerGeneration, bumpTimerGeneration] = useReducer((generation: number) => generation + 1, 0);

  const snapshot = snapshotFor(input);
  const currentPublicationKey = publicationIdentity(input);
  const currentDraftItems = input.turnDisplay.itemView?.draft.items;
  const previousDraftItemsRef = useRef(currentDraftItems);
  latestSnapshotRef.current = snapshot;
  latestOnRollRef.current = input.onRoll;
  latestInputRef.current = input;

  const disposition = autoRollDisposition(snapshot, enabled, baselinePublishedTurnRef.current);
  const dispositionKind = disposition.kind;
  const dispositionReasonValue = dispositionReason(disposition);
  const announcement = selectAutoRollAnnouncement({
    state: announcementState,
    enabled,
    disposition,
    displayAnnouncement: input.turnDisplay.announcement,
    summaryTurn: input.turnDisplay.summaryTurn,
    publicationKey: currentPublicationKey,
  });

  const invalidateTimers = useCallback(() => {
    bumpTimerGeneration();
  }, []);

  const requestRoll = useCallback(() => {
    const latestSnapshot = latestSnapshotRef.current;
    if (!latestSnapshot?.canRoll || consumedReadyKeyRef.current === latestSnapshot.readyKey) return;
    consumedReadyKeyRef.current = latestSnapshot.readyKey;
    invalidateTimers();
    setAnnouncementState(releaseStopState);
    latestOnRollRef.current();
  }, [invalidateTimers]);
  requestRollRef.current = requestRoll;

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      setAnnouncementState(stopAnnouncementState("manual", AUTO_ROLL_ANNOUNCEMENTS.stopped));
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
    setAnnouncementState({
      kind: "start", text: AUTO_ROLL_ANNOUNCEMENTS.started,
      publicationKey: publicationIdentity(latestInputRef.current), stopReason: null,
    });
    invalidateTimers();
  }, [invalidateTimers]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const changed = !sameDraftSelection(previousDraftItemsRef.current, currentDraftItems);
    previousDraftItemsRef.current = currentDraftItems;
    if (!changed) return;
    setAnnouncementState(releaseStopState);
  }, [currentDraftItems]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const latestSnapshot = latestSnapshotRef.current;
      if (latestSnapshot) latestSnapshotRef.current = { ...latestSnapshot, visible: false };
      if (!enabledRef.current) return;
      enabledRef.current = false;
      setEnabled(false);
      setAnnouncementState(stopAnnouncementState("hidden", AUTO_ROLL_ANNOUNCEMENTS.hidden));
      invalidateTimers();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [invalidateTimers]);

  useEffect(() => {
    const summaryReady = input.turnDisplay.summaryTurn !== null && currentPublicationKey !== null;
    if (announcementState.kind === "pickup-stop-pending" && summaryReady &&
        announcementState.publicationKey === currentPublicationKey) {
      setAnnouncementState({
        kind: "stop", text: pickupStopAnnouncement(input.turnDisplay.announcement),
        publicationKey: currentPublicationKey, stopReason: "pickup",
      });
      return;
    }
    if (enabledRef.current && disposition.kind === "stop" && disposition.reason === "pickup") {
      enabledRef.current = false;
      setEnabled(false);
      setAnnouncementState({
        kind: summaryReady ? "stop" : "pickup-stop-pending",
        text: summaryReady ? pickupStopAnnouncement(input.turnDisplay.announcement) : announcementState.text,
        publicationKey: currentPublicationKey,
        stopReason: "pickup",
      });
      invalidateTimers();
      return;
    }
    if (!enabledRef.current) return;
    if (summaryReady && currentPublicationKey !== announcementState.publicationKey) {
      setAnnouncementState({
        kind: "summary", text: input.turnDisplay.announcement,
        publicationKey: currentPublicationKey, stopReason: null,
      });
      return;
    }
    if (disposition.kind === "pause" && disposition.reason === "draft") {
      if (announcementState.kind !== "draft") {
        setAnnouncementState({
          kind: "draft", text: AUTO_ROLL_ANNOUNCEMENTS.draft,
          publicationKey: announcementState.publicationKey, stopReason: null,
        });
      }
      return;
    }
    if (announcementState.kind === "draft") {
      setAnnouncementState({
        kind: "released", text: "", publicationKey: announcementState.publicationKey, stopReason: null,
      });
    }
  }, [
    enabled, announcementState, dispositionKind, dispositionReasonValue, currentPublicationKey,
    input.turnDisplay.announcement, input.turnDisplay.summaryTurn, invalidateTimers,
  ]);

  useEffect(() => {
    if (!enabled || dispositionKind !== "ready" || consumedReadyKeyRef.current === snapshot.readyKey) return undefined;
    return scheduleAutoRollTimer({ readyKey: snapshot.readyKey, isMounted: () => mountedRef.current,
      isEnabled: () => enabledRef.current, latestSnapshot: () => latestSnapshotRef.current,
      baselinePublishedTurn: () => baselinePublishedTurnRef.current,
      requestRoll: () => requestRollRef.current(), invalidateTimers });
  }, [enabled, snapshot.readyKey, dispositionKind, dispositionReasonValue, timerGeneration, invalidateTimers]);

  return { enabled, announcement, toggle, requestRoll };
}
