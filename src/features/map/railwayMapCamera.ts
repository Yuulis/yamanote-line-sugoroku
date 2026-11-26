import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { TURN_RESULT_PILL_LAYOUT_EVENT, TURN_RESULT_PILL_SELECTOR } from "../game/turnResultPillLayout";

const PREVIEW_LAYOUT_SELECTORS = [
  ".item-adjustment",
  ".map-overview",
  ".maplibregl-ctrl-top-left",
  ".maplibregl-ctrl-top-right",
  ".maplibregl-ctrl-bottom-left",
  ".maplibregl-ctrl-bottom-right",
  "[data-map-adjustment-callout]",
  TURN_RESULT_PILL_SELECTOR,
] as const;

/** Elements whose size can change the camera layout. */
export function cameraLayoutTargets(
  container: HTMLElement,
  panelRoot: HTMLElement | null,
  extraTargets: readonly HTMLElement[] = [],
): HTMLElement[] {
  const targets = panelRoot ? [container, panelRoot] : [container];
  return [...targets, ...extraTargets.filter((target) => !targets.includes(target))];
}

/**
 * Watch the map's container, the current `.game-panel` root and the window, and call `onLayoutChange` at
 * most once per animation frame. A new map or a new `panelKey` (a new session's panel element) rebinds the
 * observer to the replacement panel; `onBind` runs on every (re)bind before any observation. A null map
 * observes nothing.
 */
export function useCameraLayoutObserver(
  map: Pick<MapLibreMap, "getContainer"> | null,
  panelKey: number | undefined,
  onBind: () => void,
  onLayoutChange: () => void,
  previewOpen = false,
  previewKey = "",
): void {
  const callbacksRef = useRef({ onBind, onLayoutChange });
  useEffect(() => {
    callbacksRef.current = { onBind, onLayoutChange };
  });
  useEffect(() => {
    if (!map) return;
    const container: HTMLElement = map.getContainer();
    callbacksRef.current.onBind();
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const previewTargets = previewOpen
      ? PREVIEW_LAYOUT_SELECTORS.flatMap((selector) =>
          [...document.querySelectorAll<HTMLElement>(selector)].filter(isVisibleLayoutTarget))
      : [];
    let animationFrame = 0;
    const requestLayoutUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        callbacksRef.current.onLayoutChange();
      });
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(requestLayoutUpdate);
    for (const target of cameraLayoutTargets(container, panel, previewTargets)) observer?.observe(target);
    window.addEventListener("resize", requestLayoutUpdate);
    window.addEventListener("orientationchange", requestLayoutUpdate);
    if (previewOpen) window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, requestLayoutUpdate);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", requestLayoutUpdate);
      window.removeEventListener("orientationchange", requestLayoutUpdate);
      if (previewOpen) window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, requestLayoutUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [map, panelKey, previewOpen, previewKey]);
}

export function isVisibleLayoutTarget(element: HTMLElement): boolean {
  if (element instanceof HTMLDialogElement && !element.open) return false;
  if (element.matches(TURN_RESULT_PILL_SELECTOR) && getComputedStyle(element).visibility === "hidden") return false;
  return element.getClientRects().length > 0;
}
