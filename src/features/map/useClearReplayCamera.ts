import { useEffect } from "react";
import type { ClearReplayUiSnapshot } from "../game/clearReplayStore";
import { applyClearRouteFit, clearFitPadding, clearFitSignature, clearReplayTurnBounds, measureClearFit } from "./clearRouteCamera";
import { isUserCameraEvent, USER_CAMERA_EVENTS } from "./camera";
import type { ClearRouteMapInput } from "./useClearRouteMap";
import { watchRemoval } from "./useClearRouteMap";
import { exposeClearCameraTargetForE2E, exposeClearFitPaddingForE2E } from "./e2eHook";

export type ClearReplayCameraInput = Pick<
  ClearRouteMapInput,
  "map" | "active" | "route" | "generation" | "cardRef" | "replayStore"
>;

const REPLAY_CAPTION_TOP_CLEARANCE_PX = 60;
type FitResult = "applied" | "unchanged" | "unavailable";
interface PendingSeekFit {
  readonly seekRevision: number;
  readonly recordIndex: number;
}
const IDLE_UI_SNAPSHOT: ClearReplayUiSnapshot = {
  phase: "idle", recordIndex: 0, turnCount: 0, cardExpanded: false, seekRevision: 0,
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Frames each published replay turn. UI snapshots keep this work off the per-frame route animation. */
export function useClearReplayCamera({ map, active, route, generation, cardRef, replayStore }: ClearReplayCameraInput): void {
  useEffect(() => {
    if (!map || !active || !route) return;

    const removal = watchRemoval(map);
    const container = map.getContainer();
    const entryPadding = map.getPadding();
    let frame: number | null = null;
    let disposed = false;
    let userLocked = false;
    let pendingInitialFit = true;
    let lastFitSignature: string | null = null;
    let lastUiSnapshot: ClearReplayUiSnapshot | null = null;
    let observedUiSnapshot = replayStore?.getUiSnapshot() ?? IDLE_UI_SNAPSHOT;
    let pendingSeekFit: PendingSeekFit | null = null;
    let pendingPlaybackUnlock = false;
    let userMovedAfterPendingPlayback = false;
    let pendingCompletionFit = false;
    let pendingExpandedFit = false;

    const fit = (bounds: readonly [[number, number], [number, number]], recordIndex: number | null, force: boolean): FitResult => {
      if (disposed || removal.isRemoved()) return "unavailable";
      const measurement = measureClearFit(container, cardRef?.current ?? null);
      if (!measurement) return "unavailable";
      const basePadding = clearFitPadding(measurement);
      if (!basePadding) {
        exposeClearFitPaddingForE2E(null);
        return "unavailable";
      }
      const padding = { ...basePadding, top: Math.max(basePadding.top, REPLAY_CAPTION_TOP_CLEARANCE_PX) };
      const signature = clearFitSignature(measurement.viewport, padding, bounds);
      if (!force && signature === lastFitSignature) {
        exposeClearFitPaddingForE2E(padding);
        return "unchanged";
      }
      applyClearRouteFit(map, bounds, padding);
      lastFitSignature = signature;
      exposeClearFitPaddingForE2E(padding);
      exposeClearCameraTargetForE2E(bounds, recordIndex);
      return "applied";
    };

    const runScheduledWork = (): void => {
      frame = null;
      if (disposed || removal.isRemoved()) return;

      // Notifications only request work. The latest snapshot decides which turn still owns the camera.
      const snapshot = replayStore?.getUiSnapshot() ?? IDLE_UI_SNAPSHOT;
      const previous = lastUiSnapshot;
      const initial = previous === null;
      if (previous && (previous.phase === "idle" || previous.phase === "done") &&
        snapshot.phase === "playing" && snapshot.recordIndex === 0) pendingPlaybackUnlock = true;
      if (previous && previous.phase !== "done" && snapshot.phase === "done") pendingCompletionFit = true;
      if (previous && !previous.cardExpanded && snapshot.cardExpanded) pendingExpandedFit = true;

      const reducedMotion = prefersReducedMotion();
      if (pendingSeekFit && (
        snapshot.seekRevision !== pendingSeekFit.seekRevision ||
        snapshot.recordIndex !== pendingSeekFit.recordIndex ||
        snapshot.phase === "done" || reducedMotion || snapshot.cardExpanded
      )) pendingSeekFit = null;
      const startedPlayback = pendingPlaybackUnlock && !userMovedAfterPendingPlayback;
      if (startedPlayback) userLocked = false;

      const fullRoute = reducedMotion || snapshot.phase === "idle" || snapshot.phase === "done" || snapshot.cardExpanded;
      if (fullRoute) {
        const completion = snapshot.phase === "done" && (pendingCompletionFit || initial || previous?.phase !== "done");
        const expanded = snapshot.cardExpanded && (pendingExpandedFit || initial || previous?.cardExpanded !== true);
        const shouldForce = pendingInitialFit || completion || expanded;
        // Completion and an explicit results expansion supersede the manual lock.
        const result = shouldForce || !userLocked ? fit(route.bounds, null, shouldForce) : "unchanged";
        if (result !== "unavailable") pendingInitialFit = false;
        if (completion && result === "unavailable") pendingCompletionFit = true;
        if (expanded && result === "unavailable") pendingExpandedFit = true;
        if (snapshot.phase !== "done" || (completion && result !== "unavailable")) pendingCompletionFit = false;
        if (!snapshot.cardExpanded || (expanded && result !== "unavailable")) pendingExpandedFit = false;
        pendingSeekFit = null;
      } else {
        const turnBounds = clearReplayTurnBounds(route, snapshot.recordIndex);
        const turnChanged = previous !== null && snapshot.recordIndex !== previous.recordIndex;
        const enteredReplay = previous !== null && previous.phase === "idle" &&
          (snapshot.phase === "playing" || snapshot.phase === "paused");
        const forceSeek = pendingSeekFit !== null;
        const forceTurn = forceSeek || startedPlayback || (enteredReplay && !userLocked) || (initial && !userLocked);
        const automaticTurnFit = turnChanged && !userLocked;
        if (turnBounds && (forceTurn || automaticTurnFit || !userLocked)) {
          const result = fit(turnBounds, snapshot.recordIndex, forceTurn || turnChanged);
          if (forceSeek && result !== "unavailable") pendingSeekFit = null;
        } else if (!turnBounds) {
          // A turn with no resolvable coordinates deliberately keeps the current view.
          pendingSeekFit = null;
        }
        pendingInitialFit = false;
        pendingCompletionFit = false;
        pendingExpandedFit = false;
      }

      lastUiSnapshot = snapshot;
      pendingPlaybackUnlock = false;
      userMovedAfterPendingPlayback = false;
    };

    const schedule = (): void => {
      if (disposed || removal.isRemoved() || frame !== null) return;
      frame = window.requestAnimationFrame(runScheduledWork);
    };
    const cancelScheduledWork = (): void => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const onMapRemoved = (): void => cancelScheduledWork();

    const onUiChange = (): void => {
      const latest = replayStore?.getUiSnapshot() ?? IDLE_UI_SNAPSHOT;
      if (latest.seekRevision !== observedUiSnapshot.seekRevision) {
        pendingSeekFit = { seekRevision: latest.seekRevision, recordIndex: latest.recordIndex };
      } else if (pendingSeekFit && (
        latest.recordIndex !== pendingSeekFit.recordIndex || latest.phase === "done"
      )) {
        pendingSeekFit = null;
      }
      if ((observedUiSnapshot.phase === "idle" || observedUiSnapshot.phase === "done") &&
        latest.phase === "playing" && latest.recordIndex === 0) {
        pendingPlaybackUnlock = true;
        userMovedAfterPendingPlayback = false;
      }
      if (observedUiSnapshot.phase !== "done" && latest.phase === "done") pendingCompletionFit = true;
      if (!observedUiSnapshot.cardExpanded && latest.cardExpanded) pendingExpandedFit = true;
      observedUiSnapshot = latest;
      schedule();
    };
    const onCameraEvent = (event: { originalEvent?: unknown }): void => {
      if (isUserCameraEvent(event)) {
        userLocked = true;
        if (pendingPlaybackUnlock) userMovedAfterPendingPlayback = true;
        pendingInitialFit = false;
      }
    };

    const unsubscribe = replayStore?.subscribeUi(onUiChange);
    map.on("remove", onMapRemoved);
    for (const type of USER_CAMERA_EVENTS) map.on(type, onCameraEvent);

    const scheduleLayout = (): void => schedule();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleLayout);
    observer?.observe(container);
    const card = cardRef?.current;
    if (card) observer?.observe(card);
    const viewport = window.visualViewport;
    window.addEventListener("resize", scheduleLayout);
    window.addEventListener("orientationchange", scheduleLayout);
    viewport?.addEventListener("resize", scheduleLayout);

    schedule();
    return () => {
      disposed = true;
      cancelScheduledWork();
      unsubscribe?.();
      observer?.disconnect();
      window.removeEventListener("resize", scheduleLayout);
      window.removeEventListener("orientationchange", scheduleLayout);
      viewport?.removeEventListener("resize", scheduleLayout);
      map.off("remove", onMapRemoved);
      for (const type of USER_CAMERA_EVENTS) map.off(type, onCameraEvent);
      if (!removal.isRemoved()) map.setPadding(entryPadding);
      exposeClearFitPaddingForE2E(null);
      exposeClearCameraTargetForE2E(null, null);
      removal.stop();
    };
  }, [map, active, route, generation, cardRef, replayStore]);
}
