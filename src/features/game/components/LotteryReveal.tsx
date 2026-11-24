import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Direction } from "../../../types/network";
import type { LastMove } from "../gameSession";
import type { RailwayNetwork } from "../engine";
import { lineBadgeFor } from "../lineBadge";
import { directionLabel } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";
import { lotteryDirectionFlipMs } from "../animation/turnMomentPolicy";
import { LineBadge } from "./LineBadge";
import { chooseSettleMotion, type SettleMotion } from "./TurnMomentHost";

export interface LotteryRevealProps {
  landing: NonNullable<LastMove["landing"]>;
  stage: "lottery-flip" | "lottery-settle";
  /**
   * Stage window in ms. During lottery-flip this is the route window F; the stage itself may last F + D when the
   * direction is drawn after the route (D = lotteryDirectionFlipMs(F)). During lottery-settle it is the settle window.
   */
  durationMs: number;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  rideTarget: RefObject<HTMLElement | null>;
  directionTarget: RefObject<HTMLElement | null>;
  /**
   * Uniform scale the host applies to the board's card when fitting it (default 1). Rows are measured in viewport
   * pixels but translate inside the scaled card, so the settle flight divides its translation by this scale.
   */
  boardScale?: number;
}

const FLIP_FRAME_COUNT: number = 8;
/** The direction window is shorter than the route window, so four frames keep a similar rhythm. */
const DIRECTION_FLIP_FRAME_COUNT: number = 4;
/** Shown on the direction row until the route row stops; decorative, the board is aria-hidden. */
const DIRECTION_PLACEHOLDER: string = "方向 ？";

/** How one row presents during lottery-flip; windows are measured from the start of the flip stage. */
type RowFlip =
  | { readonly kind: "flip"; readonly delayMs: number; readonly windowMs: number }
  | { readonly kind: "snap"; readonly windowMs: number }
  | { readonly kind: "static" };

interface LotteryRowProps {
  drawn: boolean;
  /** Extra semantic class for this row, e.g. the direction row's one-line label rule. */
  variant?: string;
  flip: RowFlip;
  placeholder?: string;
  stage: LotteryRevealProps["stage"];
  frames: readonly ReactNode[];
  target: RefObject<HTMLElement | null>;
  boardScale: number;
}

interface MeasuredSettleMotion {
  readonly target: RefObject<HTMLElement | null>;
  readonly boardScale: number;
  readonly motion: SettleMotion;
}

/** Layout measurement affects decoration only; the sequence owns the deadline, including fallback fades. */
function LotteryRow({ drawn, variant, flip, placeholder, stage, frames, target, boardScale }: LotteryRowProps): React.JSX.Element {
  const source = useRef<HTMLDivElement>(null);
  const [measuredSettle, setMeasuredSettle] = useState<MeasuredSettleMotion | null>(null);
  const motion: SettleMotion | null = stage === "lottery-settle" && measuredSettle?.target === target
    && measuredSettle.boardScale === boardScale ? measuredSettle.motion : null;
  useLayoutEffect(() => {
    if (stage !== "lottery-settle") {
      setMeasuredSettle(null);
      return;
    }
    // The settle keyframes are gated by data-motion below. Measure the unanimated source first, then let the
    // state update start the animation; otherwise WebKit can sample a compositor-advanced row under CPU load.
    const nextMotion: SettleMotion = chooseSettleMotion(source.current?.getBoundingClientRect(), target.current?.getBoundingClientRect(),
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    setMeasuredSettle({ target, boardScale, motion: nextMotion });
  }, [stage, target, boardScale]);
  // The measured source already includes the card scale, so scaleX/scaleY land on the target unchanged.
  const style = motion?.kind === "flight" ? {
    "--lottery-x": `${motion.translateX / boardScale}px`, "--lottery-y": `${motion.translateY / boardScale}px`,
    "--lottery-sx": motion.scaleX, "--lottery-sy": motion.scaleY,
  } : {};
  const inFlip = stage === "lottery-flip";
  const flipping = inFlip && flip.kind === "flip";
  const snapping = inFlip && flip.kind === "snap";
  const windowStyle = inFlip && flip.kind !== "static"
    ? { "--row-delay": `${flip.kind === "flip" ? flip.delayMs : 0}ms`, "--row-ms": `${flip.windowMs}ms` } : {};
  const modifier = flipping ? " lottery-reveal__row--flipping" : snapping ? " lottery-reveal__row--snap" : "";
  const variantClass = variant === undefined ? "" : ` ${variant}`;
  return <div ref={source} className={`lottery-reveal__row${variantClass}${modifier}`}
    data-drawn={drawn} data-motion={motion?.kind} style={{ ...windowStyle, ...style } as CSSProperties}>
    <span className="lottery-reveal__result">{frames.at(-1)}</span>
    {inFlip && placeholder !== undefined && <span className="lottery-reveal__placeholder">{placeholder}</span>}
    {flipping && frames.slice(0, -1).map((frame, index) => <span key={index} className="lottery-reveal__frame"
      style={{ "--frame-index": index, "--frame-count": frames.length - 1 } as CSSProperties}>{frame}</span>)}
  </div>;
}

function rowFlips(landing: LotteryRevealProps["landing"], routeMs: number): { readonly route: RowFlip; readonly direction: RowFlip } {
  const directionMs = lotteryDirectionFlipMs(routeMs);
  const route: RowFlip = landing.serviceDrawRequired ? { kind: "flip", delayMs: 0, windowMs: routeMs } : { kind: "static" };
  if (!landing.directionDrawRequired) {
    // A single direction (e.g. 山手線 → 外回り) snaps in with the route stop; without a route draw there is nothing to show.
    return { route, direction: landing.serviceDrawRequired ? { kind: "snap", windowMs: routeMs } : { kind: "static" } };
  }
  return { route, direction: { kind: "flip", delayMs: landing.serviceDrawRequired ? routeMs : 0, windowMs: directionMs } };
}

/** Saved candidates in deterministic order, ending on the saved result; no presentation RNG or probabilities. */
export function LotteryReveal({ landing, stage, durationMs, network, presentation, rideTarget, directionTarget, boardScale = 1 }: LotteryRevealProps): React.JSX.Element {
  const scale: number = Number.isFinite(boardScale) && boardScale > 0 ? boardScale : 1;
  const flips = rowFlips(landing, durationMs);
  const serviceFrame = (id: string): ReactNode => <LineBadge model={lineBadgeFor(id, presentation, network.servicesById.get(id)?.color)} size="lg" />;
  const directionFrame = (direction: Direction): ReactNode => directionLabel(network, landing.serviceId, direction);
  const serviceFrames = [...Array.from({ length: FLIP_FRAME_COUNT }, (_unused, index) => serviceFrame(landing.serviceCandidates[index % landing.serviceCandidates.length] ?? landing.serviceId)), serviceFrame(landing.serviceId)];
  const directionFrames = [...Array.from({ length: DIRECTION_FLIP_FRAME_COUNT }, (_unused, index) => directionFrame(landing.directionCandidates[index % landing.directionCandidates.length] ?? landing.direction)), directionFrame(landing.direction)];
  return <div className="lottery-reveal" data-stage={stage} aria-hidden="true" style={{ "--lottery-ms": `${durationMs}ms` } as CSSProperties}>
    <p className="lottery-reveal__heading">次の乗車</p>
    <LotteryRow drawn={landing.serviceDrawRequired} flip={flips.route} stage={stage} frames={serviceFrames} target={rideTarget} boardScale={scale} />
    <LotteryRow drawn={landing.directionDrawRequired} variant="lottery-reveal__row--direction" flip={flips.direction} placeholder={landing.serviceDrawRequired ? DIRECTION_PLACEHOLDER : undefined}
      stage={stage} frames={directionFrames} target={directionTarget} boardScale={scale} />
  </div>;
}
