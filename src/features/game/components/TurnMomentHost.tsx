import { Children, useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode, RefCallback, RefObject } from "react";
import type { DeepReadonly, ItemTurnRecord } from "../../../types/network";
import type { RollAttempt } from "../animation/turnMoments";
import type { TurnPublicationPhase, TurnRevealState } from "../turnMomentPresentation";
import { LotteryReveal, type LotteryRevealProps } from "./LotteryReveal";
import { diceTumbleModelFor, isDiceFace, type DiceTumbleModel } from "./DiceTumble";

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

/**
 * Space kept free next to a viewport edge for the MapLibre controls while the card takes pointer events: the
 * zoom group and the 全体 / 目標路線 column on the right (10px margin + ~70px + 4px, the toast column uses the same
 * 84px), the compact attribution toggle top-left and the attribution text bottom-right (10px margin + 44px).
 */
export const MAP_CONTROL_CLEARANCE_PX: Readonly<{ top: number; right: number; bottom: number; left: number }> = {
  top: 56, right: 84, bottom: 56, left: 56,
};
/** Smallest card region worth keeping; below it the clearance shrinks proportionally instead of vanishing. */
export const MIN_CARD_REGION_PX: number = 112;
/** A region edge closer than this to the viewport edge counts as touching it. */
const EDGE_TOLERANCE_PX: number = 1;

function edgeInsets(size: number, wantStart: number, wantEnd: number): readonly [number, number] {
  const wanted: number = wantStart + wantEnd;
  if (wanted <= 0 || size - wanted >= MIN_CARD_REGION_PX) return [wantStart, wantEnd];
  const scale: number = Math.max(0, size - MIN_CARD_REGION_PX) / wanted;
  return [wantStart * scale, wantEnd * scale];
}

export interface EdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Padding that keeps a content-sized card, centred in the placement rectangle, away from every viewport edge the
 * rectangle touches, so the card (which takes pointer events) stays clear of the map controls along those edges.
 * Edges next to the panel get no padding. When the rectangle is too small to keep `MIN_CARD_REGION_PX`, the
 * padding shrinks proportionally; it is never negative. The rectangle itself is unchanged.
 */
export function mapControlInsets(rect: RectBox, viewport: RectBox): EdgeInsets {
  const touchesLeft: boolean = rect.left <= viewport.left + EDGE_TOLERANCE_PX;
  const touchesTop: boolean = rect.top <= viewport.top + EDGE_TOLERANCE_PX;
  const touchesRight: boolean = rect.left + rect.width >= viewport.left + viewport.width - EDGE_TOLERANCE_PX;
  const touchesBottom: boolean = rect.top + rect.height >= viewport.top + viewport.height - EDGE_TOLERANCE_PX;
  const [left, right] = edgeInsets(rect.width, touchesLeft ? MAP_CONTROL_CLEARANCE_PX.left : 0,
    touchesRight ? MAP_CONTROL_CLEARANCE_PX.right : 0);
  const [top, bottom] = edgeInsets(rect.height, touchesTop ? MAP_CONTROL_CLEARANCE_PX.top : 0,
    touchesBottom ? MAP_CONTROL_CLEARANCE_PX.bottom : 0);
  return { top, right, bottom, left };
}

/**
 * The dice card for the current pre-move stage, or null when nothing is shown. The face is the attempt's saved raw
 * roll (from the saved adjustment decision or the accepted record); stamp labels come only from the accepted record
 * of this attempt. Omitted or skipped attempts and every other stage show no die.
 */
export function turnMomentDiceModel(
  attempt: RollAttempt | null,
  record: DeepReadonly<ItemTurnRecord> | null | undefined,
  reducedMotion: boolean,
): DiceTumbleModel | null {
  if (!attempt || attempt.motionOmitted || attempt.skipRequested) return null;
  if (attempt.stage !== "tumble" && attempt.stage !== "stamps") return null;
  if (!isDiceFace(attempt.rawRoll)) return null;
  const accepted = record && record.turn === attempt.recordTurn ? record : null;
  const stageMs: number = attempt.stage === "tumble" ? attempt.timing.tumbleMs : attempt.timing.stampsMs;
  return { ...diceTumbleModelFor(accepted, attempt.stage, stageMs, reducedMotion), rawRoll: attempt.rawRoll };
}

/** The arrival banner's content: the arrival station only (the next ride stays unpublished). */
export interface ArrivalBannerModel {
  readonly stationName: string;
}

/**
 * The arrival banner while the presented turn is in its `arrival` stage, or null. Reduced motion, Skip and restored
 * results never reach that stage (their display is already published), so they never show a banner.
 */
export function turnMomentArrivalModel(
  phase: TurnPublicationPhase,
  revealStage: TurnRevealState,
  stationName: string,
): ArrivalBannerModel | null {
  if (phase !== "arrival" || revealStage !== "arrival") return null;
  return { stationName };
}

export interface ArrivalBannerProps {
  model: ArrivalBannerModel;
}

/** Decorative arrival card; the panel live region carries the announcement. No focusable content. */
export function ArrivalBanner({ model }: ArrivalBannerProps): React.JSX.Element {
  return (
    <div className="arrival-banner">
      <span className="arrival-banner__kicker">到着</span>
      <span className="arrival-banner__station">{model.stationName}</span>
    </div>
  );
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
  lottery?: LotteryRevealProps | null;
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
export function TurnMomentHost({ children, lottery, onTap, resolveMap, resolvePanel }: TurnMomentHostProps): React.JSX.Element {
  const hasCard: boolean = Boolean(lottery) || Children.toArray(children).length > 0;
  const rects: TurnMomentRects | null = useTurnMomentRects(hasCard, { resolveMap, resolvePanel });
  const layout: { placement: TurnMomentPlacement; insets: EdgeInsets } | null = useMemo(
    () => {
      if (!hasCard) return null;
      const viewport: RectBox = rects?.viewport ?? viewportBox();
      const chosen: TurnMomentPlacement = chooseTurnMomentPlacement(viewport, rects?.map, rects?.panel);
      return { placement: chosen, insets: mapControlInsets(chosen.rect, viewport) };
    },
    [hasCard, rects],
  );
  return (
    <div className="turn-moment-host" aria-hidden="true">
      {layout && <div
        className={`turn-moment-host__region${lottery?.stage === "lottery-settle" ? " turn-moment-host__region--settling" : ""}`}
        data-region={layout.placement.region}
        style={{
          left: layout.placement.rect.left,
          top: layout.placement.rect.top,
          width: layout.placement.rect.width,
          height: layout.placement.rect.height,
          boxSizing: "border-box",
          padding: `${layout.insets.top}px ${layout.insets.right}px ${layout.insets.bottom}px ${layout.insets.left}px`,
        } satisfies CSSProperties}
      >
        <div
          className={`turn-moment-host__card${lottery ? " turn-moment-host__card--lottery" : ""}`}
          onPointerDown={preventFocusMove}
          onMouseDown={preventFocusMove}
          onClick={onTap}
        >{lottery ? <LotteryReveal {...lottery} /> : children}</div>
      </div>}
    </div>
  );
}
