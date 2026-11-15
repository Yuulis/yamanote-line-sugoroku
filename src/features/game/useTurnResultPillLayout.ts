import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { computeTurnResultPillPosition, sameTurnResultPillPosition, TURN_RESULT_PILL_GAP_PX,
  TURN_RESULT_PILL_LAYOUT_EVENT, type TurnResultPillPosition } from "./turnResultPillLayout";

const HIDDEN_POSITION: TurnResultPillPosition = { visible: false };
const PANEL_MOTION_START_EVENTS = ["transitionrun", "animationstart"] as const;
const PANEL_MOTION_END_EVENTS = ["transitionend", "transitioncancel", "animationend", "animationcancel"] as const;

export function useTurnResultPillLayout(panelRef: RefObject<HTMLElement | null>, active: boolean): TurnResultPillPosition {
  const [position, setPosition] = useState<TurnResultPillPosition>(HIDDEN_POSITION);
  const lastCommitted = useRef<TurnResultPillPosition>(HIDDEN_POSITION);
  const lastNotified = useRef<TurnResultPillPosition>(HIDDEN_POSITION);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const displayedPosition = active ? position : HIDDEN_POSITION;

  // Refs attach during commit, so resolve the target after every commit instead of reading it during render.
  useLayoutEffect(() => {
    const current = panelRef.current;
    if (current !== panel) setPanel(current);
  });

  useLayoutEffect(() => {
    const commit = (next: TurnResultPillPosition): void => {
      if (sameTurnResultPillPosition(lastCommitted.current, next)) return;
      lastCommitted.current = next;
      setPosition(next);
    };

    if (!active || !panel) {
      commit(HIDDEN_POSITION);
      return;
    }

    let frameId: number | null = null;
    let runningMotionCount = 0;
    const measure = (): void => {
      const next = computeTurnResultPillPosition({
        panelRect: panel.getBoundingClientRect(),
        viewportHeight: document.documentElement.clientHeight,
        gapPx: TURN_RESULT_PILL_GAP_PX,
      });
      commit(next);
    };
    const scheduleMeasurement = (): void => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
        if (!panel.isConnected) runningMotionCount = 0;
        if (runningMotionCount > 0) scheduleMeasurement();
      });
    };
    // Only the panel's own motion moves its rectangle; descendant events bubble and may never end here.
    const startMotion = (event: Event): void => {
      if (event.target !== panel) return;
      runningMotionCount += 1;
      scheduleMeasurement();
    };
    const endMotion = (event: Event): void => {
      if (event.target !== panel) return;
      runningMotionCount = Math.max(0, runningMotionCount - 1);
      scheduleMeasurement();
    };

    measure();
    const windowEvents = ["resize", "orientationchange"] as const;
    for (const eventName of windowEvents) window.addEventListener(eventName, scheduleMeasurement);

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener("resize", scheduleMeasurement);
      visualViewport.addEventListener("scroll", scheduleMeasurement);
    }

    for (const eventName of PANEL_MOTION_START_EVENTS) panel.addEventListener(eventName, startMotion);
    for (const eventName of PANEL_MOTION_END_EVENTS) panel.addEventListener(eventName, endMotion);

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleMeasurement) : null;
    observer?.observe(panel);

    return () => {
      observer?.disconnect();
      for (const eventName of windowEvents) window.removeEventListener(eventName, scheduleMeasurement);
      if (visualViewport) {
        visualViewport.removeEventListener("resize", scheduleMeasurement);
        visualViewport.removeEventListener("scroll", scheduleMeasurement);
      }
      for (const eventName of PANEL_MOTION_START_EVENTS) panel.removeEventListener(eventName, startMotion);
      for (const eventName of PANEL_MOTION_END_EVENTS) panel.removeEventListener(eventName, endMotion);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [active, panel]);

  useLayoutEffect(() => {
    if (sameTurnResultPillPosition(lastNotified.current, displayedPosition)) return;
    lastNotified.current = displayedPosition;
    window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT));
  }, [displayedPosition]);

  return displayedPosition;
}
