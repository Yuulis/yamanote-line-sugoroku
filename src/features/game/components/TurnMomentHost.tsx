import { Children, useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode, RefCallback, RefObject } from "react";

/** A plain rectangle in viewport (CSS pixel) coordinates. */
export interface RectBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type PlacementRegion = "above" | "below" | "left" | "right" | "map" | "viewport";

export interface TurnMomentPlacement {
  /** The free rectangle the moment may use, clipped to the viewport. Never negative, never NaN. */
  readonly rect: RectBox;
  /** Centre of `rect`; for the board this is the visible map centre. */
  readonly centerX: number;
  readonly centerY: number;
  /** Which free area was chosen; `map` / `viewport` are the documented fallbacks. */
  readonly region: PlacementRegion;
}

export type SettleMotion =
  | {
    readonly kind: "flight";
    readonly translateX: number;
    readonly translateY: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly opacityFrom: number;
    readonly opacityTo: number;
  }
  | { readonly kind: "fade"; readonly opacityFrom: number; readonly opacityTo: number };

/** An optional element the moment animates toward. Callback refs and ref objects are both accepted. */
export type TurnMomentTargetRef = RefObject<HTMLElement | null> | RefCallback<HTMLElement>;

/** Optional animation targets threaded `GamePanel` -> `GameHud` / `InventoryPanel`. All are measured, never styled. */
export interface TurnMomentTargets {
  /** The ride (service name) value in the HUD. */
  readonly ride?: TurnMomentTargetRef;
  /** The direction value in the HUD. */
  readonly direction?: TurnMomentTargetRef;
  /** Inventory slot boxes by index (empty slots included). */
  readonly slots?: readonly (TurnMomentTargetRef | null | undefined)[];
  /** The inventory header box. */
  readonly inventoryHeader?: TurnMomentTargetRef;
}

export const TURN_MOMENT_MAP_SELECTOR: string = ".map-container";
export const TURN_MOMENT_PANEL_SELECTOR: string = ".game-panel";

const EMPTY_RECT: RectBox = { left: 0, top: 0, width: 0, height: 0 };
const FADE_OPACITY_FROM: number = 1;
const FADE_OPACITY_TO: number = 0;

/** Assigns an element to an optional callback ref or ref object. */
export function setTargetRef(ref: TurnMomentTargetRef | null | undefined, element: HTMLElement | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(element);
    return;
  }
  ref.current = element;
}

function isUsableRect(rect: RectBox | null | undefined): rect is RectBox {
  if (!rect) return false;
  const { left, top, width, height } = rect;
  return Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0;
}

/** The overlap of two rectangles, or null when they do not overlap with positive area. */
function intersect(a: RectBox, b: RectBox): RectBox | null {
  const left: number = Math.max(a.left, b.left);
  const top: number = Math.max(a.top, b.top);
  const right: number = Math.min(a.left + a.width, b.left + b.width);
  const bottom: number = Math.min(a.top + a.height, b.top + b.height);
  if (!(right > left) || !(bottom > top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function placementOf(rect: RectBox, region: PlacementRegion): TurnMomentPlacement {
  return { rect, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2, region };
}

/**
 * Chooses the largest free rectangle that does not overlap the panel, inside the visible map.
 *
 * Both the map and the panel are clipped to the viewport first. The candidates are the strips above, below, left of
 * and right of the (clipped) panel, each spanning the full map extent on the other axis. The largest area wins; equal
 * areas resolve in the fixed order above, below, left, right. Fallbacks, all documented and never NaN or negative:
 * - no usable panel, or one that does not overlap the map -> the whole clipped map (`map`);
 * - no usable map -> the whole viewport (`viewport`);
 * - the panel leaves no free strip -> the whole clipped map (or viewport);
 * - no usable viewport -> an empty rectangle at the origin (`viewport`).
 */
export function chooseTurnMomentPlacement(
  viewport: RectBox | null | undefined,
  map: RectBox | null | undefined,
  panel: RectBox | null | undefined,
): TurnMomentPlacement {
  if (!isUsableRect(viewport)) return placementOf(EMPTY_RECT, "viewport");
  const clippedMap: RectBox | null = isUsableRect(map) ? intersect(viewport, map) : null;
  const area: RectBox = clippedMap ?? viewport;
  const fallbackRegion: PlacementRegion = clippedMap ? "map" : "viewport";
  const clippedPanel: RectBox | null = isUsableRect(panel) ? intersect(viewport, panel) : null;
  const blocked: RectBox | null = clippedPanel ? intersect(area, clippedPanel) : null;
  if (!blocked) return placementOf(area, fallbackRegion);

  const areaRight: number = area.left + area.width;
  const areaBottom: number = area.top + area.height;
  const blockedRight: number = blocked.left + blocked.width;
  const blockedBottom: number = blocked.top + blocked.height;
  // Order is the tie-break: the first candidate with the strictly largest area wins.
  const candidates: readonly { readonly region: PlacementRegion; readonly rect: RectBox }[] = [
    { region: "above", rect: { left: area.left, top: area.top, width: area.width, height: blocked.top - area.top } },
    { region: "below", rect: { left: area.left, top: blockedBottom, width: area.width, height: areaBottom - blockedBottom } },
    { region: "left", rect: { left: area.left, top: area.top, width: blocked.left - area.left, height: area.height } },
    { region: "right", rect: { left: blockedRight, top: area.top, width: areaRight - blockedRight, height: area.height } },
  ];
  let best: { readonly region: PlacementRegion; readonly rect: RectBox } | null = null;
  for (const candidate of candidates) {
    if (!isUsableRect(candidate.rect)) continue;
    if (!best || candidate.rect.width * candidate.rect.height > best.rect.width * best.rect.height) best = candidate;
  }
  return best ? placementOf(best.rect, best.region) : placementOf(area, fallbackRegion);
}

/**
 * Motion for a settling element. A usable target (finite, non-zero, overlapping the viewport) gives a
 * transform flight from the source box onto the target box; anything else gives a local fade, which needs no target.
 */
export function chooseSettleMotion(
  source: RectBox | null | undefined,
  target: RectBox | null | undefined,
  viewport: RectBox | null | undefined,
): SettleMotion {
  const fade: SettleMotion = { kind: "fade", opacityFrom: FADE_OPACITY_FROM, opacityTo: FADE_OPACITY_TO };
  if (!isUsableRect(source) || !isUsableRect(target) || !isUsableRect(viewport)) return fade;
  if (!intersect(viewport, target)) return fade;
  return {
    kind: "flight",
    translateX: target.left + target.width / 2 - (source.left + source.width / 2),
    translateY: target.top + target.height / 2 - (source.top + source.height / 2),
    scaleX: target.width / source.width,
    scaleY: target.height / source.height,
    opacityFrom: FADE_OPACITY_FROM,
    opacityTo: FADE_OPACITY_TO,
  };
}

export interface TurnMomentRects {
  readonly viewport: RectBox;
  readonly map: RectBox | null;
  readonly panel: RectBox | null;
}

export interface TurnMomentRectSources {
  readonly resolveMap?: () => Element | null;
  readonly resolvePanel?: () => Element | null;
}

function boxOf(element: Element | null): RectBox | null {
  if (!element) return null;
  const rect: DOMRect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function viewportBox(): RectBox {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function sameBox(a: RectBox | null, b: RectBox | null): boolean {
  if (a === null || b === null) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function sameRects(a: TurnMomentRects | null, b: TurnMomentRects): boolean {
  return a !== null && sameBox(a.viewport, b.viewport) && sameBox(a.map, b.map) && sameBox(a.panel, b.panel);
}

/**
 * Measures the viewport, map and panel rectangles while `active`. Re-measures on window resize, any scroll (capture)
 * and size changes of the map and panel. It only reads layout; it never writes styles. Every listener and observer
 * is removed when `active` turns off or the component unmounts.
 */
export function useTurnMomentRects(active: boolean, sources: TurnMomentRectSources = {}): TurnMomentRects | null {
  const [rects, setRects] = useState<TurnMomentRects | null>(null);
  const { resolveMap, resolvePanel } = sources;
  useLayoutEffect(() => {
    if (!active) {
      setRects(null);
      return;
    }
    const mapElement: Element | null = resolveMap ? resolveMap() : document.querySelector(TURN_MOMENT_MAP_SELECTOR);
    const panelElement: Element | null = resolvePanel ? resolvePanel() : document.querySelector(TURN_MOMENT_PANEL_SELECTOR);
    const measure = (): void => {
      const next: TurnMomentRects = { viewport: viewportBox(), map: boxOf(mapElement), panel: boxOf(panelElement) };
      setRects((current: TurnMomentRects | null) => sameRects(current, next) ? current : next);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    const observer: ResizeObserver | null = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (mapElement) observer?.observe(mapElement);
    if (panelElement) observer?.observe(panelElement);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      observer?.disconnect();
    };
  }, [active, resolveMap, resolvePanel]);
  return rects;
}

export interface TurnMomentHostProps extends TurnMomentRectSources {
  /** The card content. Nothing renderable (null, undefined, false) renders no card. */
  children?: ReactNode;
  /** Called when the visible card is tapped (Skip). Absent: the card only displays. */
  onTap?: () => void;
}

function preventFocusMove(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * Fixed, visual-only overlay host, rendered as a sibling of `.game-panel`. The whole subtree is `aria-hidden`, has
 * no focusable descendants and never takes focus. The host ignores pointer events; only the visible card receives
 * them, and pressing it does not move keyboard focus.
 */
export function TurnMomentHost({ children, onTap, resolveMap, resolvePanel }: TurnMomentHostProps): React.JSX.Element {
  const hasCard: boolean = Children.toArray(children).length > 0;
  const rects: TurnMomentRects | null = useTurnMomentRects(hasCard, { resolveMap, resolvePanel });
  const placement: TurnMomentPlacement | null = useMemo(
    () => !hasCard ? null : chooseTurnMomentPlacement(rects?.viewport ?? viewportBox(), rects?.map, rects?.panel),
    [hasCard, rects],
  );
  return (
    <div className="turn-moment-host" aria-hidden="true">
      {placement && <div
        className="turn-moment-host__region"
        data-region={placement.region}
        style={{
          left: placement.rect.left,
          top: placement.rect.top,
          width: placement.rect.width,
          height: placement.rect.height,
        } satisfies CSSProperties}
      >
        <div
          className="turn-moment-host__card"
          onPointerDown={preventFocusMove}
          onMouseDown={preventFocusMove}
          onClick={onTap}
        >{children}</div>
      </div>}
    </div>
  );
}
