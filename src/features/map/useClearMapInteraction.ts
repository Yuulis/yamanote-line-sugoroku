import type { Map as MapLibreMap, Popup } from "maplibre-gl";
import { type MutableRefObject, useLayoutEffect } from "react";

/**
 * While the clear screen is shown the map stays pannable by pointer, but it is kept out of the keyboard
 * Tab order (the clear card owns focus) and any station popup left open from gameplay is closed. The map
 * instance is persistent across modes, so the canvas tabindex is restored on leaving clear.
 */
export function useClearMapInteraction(
  map: MapLibreMap | null,
  active: boolean,
  stationPopupRef: MutableRefObject<Popup | null>,
): void {
  useLayoutEffect(() => {
    if (!map || !active) return;
    // A popup opened during gameplay would otherwise stay open with a focusable close button.
    stationPopupRef.current?.remove();
    stationPopupRef.current = null;

    const canvas = map.getCanvas();
    const originalTabIndex = canvas.getAttribute("tabindex");
    let pointerDown = false;
    let blurTimer: number | null = null;
    const blurAfterPointer = (): void => {
      pointerDown = false;
      blurTimer = null;
      if (document.activeElement === canvas) canvas.blur();
    };
    const onPointerDown = (): void => {
      pointerDown = true;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(blurAfterPointer, 0);
    };
    const onCanvasFocus = (): void => {
      if (pointerDown) canvas.blur();
    };

    canvas.tabIndex = -1;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("focus", onCanvasFocus);
    return () => {
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("focus", onCanvasFocus);
      if (originalTabIndex === null) canvas.removeAttribute("tabindex");
      else canvas.setAttribute("tabindex", originalTabIndex);
    };
  }, [map, active, stationPopupRef]);
}
