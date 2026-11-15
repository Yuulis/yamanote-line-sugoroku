import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Direction } from "../../../types/network";
import type { LastMove } from "../gameSession";
import type { RailwayNetwork } from "../engine";
import { lineBadgeFor } from "../lineBadge";
import { directionLabel } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";
import { LineBadge } from "./LineBadge";
import { chooseSettleMotion, type SettleMotion } from "./TurnMomentHost";

export interface LotteryRevealProps {
  landing: NonNullable<LastMove["landing"]>;
  stage: "lottery-flip" | "lottery-settle";
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

interface LotteryRowProps {
  drawn: boolean;
  stage: LotteryRevealProps["stage"];
  frames: readonly ReactNode[];
  target: RefObject<HTMLElement | null>;
  boardScale: number;
}

/** Layout measurement affects decoration only; the sequence owns the deadline, including fallback fades. */
function LotteryRow({ drawn, stage, frames, target, boardScale }: LotteryRowProps): React.JSX.Element {
  const source = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState<SettleMotion>({ kind: "fade", opacityFrom: 1, opacityTo: 0 });
  useLayoutEffect(() => {
    if (stage !== "lottery-settle") return;
    setMotion(chooseSettleMotion(source.current?.getBoundingClientRect(), target.current?.getBoundingClientRect(),
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }));
  }, [stage, target, boardScale]);
  // The measured source already includes the card scale, so scaleX/scaleY land on the target unchanged.
  const style = motion.kind === "flight" ? {
    "--lottery-x": `${motion.translateX / boardScale}px`, "--lottery-y": `${motion.translateY / boardScale}px`,
    "--lottery-sx": motion.scaleX, "--lottery-sy": motion.scaleY,
  } : {};
  const flipping = drawn && stage === "lottery-flip";
  return <div ref={source} className={`lottery-reveal__row${flipping ? " lottery-reveal__row--flipping" : ""}`}
    data-drawn={drawn} data-motion={stage === "lottery-settle" ? motion.kind : undefined} style={style as CSSProperties}>
    <span className="lottery-reveal__result">{frames.at(-1)}</span>
    {flipping && frames.slice(0, -1).map((frame, index) => <span key={index} className="lottery-reveal__frame"
      style={{ "--frame-index": index, "--frame-count": frames.length - 1 } as CSSProperties}>{frame}</span>)}
  </div>;
}

/** Saved candidates in deterministic order, ending on the saved result; no presentation RNG or probabilities. */
export function LotteryReveal({ landing, stage, durationMs, network, presentation, rideTarget, directionTarget, boardScale = 1 }: LotteryRevealProps): React.JSX.Element {
  const scale: number = Number.isFinite(boardScale) && boardScale > 0 ? boardScale : 1;
  const serviceFrame = (id: string): ReactNode => <LineBadge model={lineBadgeFor(id, presentation, network.servicesById.get(id)?.color)} size="lg" />;
  const directionFrame = (direction: Direction): ReactNode => directionLabel(network, landing.serviceId, direction);
  const serviceFrames = [...Array.from({ length: FLIP_FRAME_COUNT }, (_unused, index) => serviceFrame(landing.serviceCandidates[index % landing.serviceCandidates.length] ?? landing.serviceId)), serviceFrame(landing.serviceId)];
  const directionFrames = [...Array.from({ length: FLIP_FRAME_COUNT }, (_unused, index) => directionFrame(landing.directionCandidates[index % landing.directionCandidates.length] ?? landing.direction)), directionFrame(landing.direction)];
  return <div className="lottery-reveal" data-stage={stage} aria-hidden="true" style={{ "--lottery-ms": `${durationMs}ms` } as CSSProperties}>
    <p className="lottery-reveal__heading">次の乗車</p>
    <LotteryRow drawn={landing.serviceDrawRequired} stage={stage} frames={serviceFrames} target={rideTarget} boardScale={scale} />
    <LotteryRow drawn={landing.directionDrawRequired} stage={stage} frames={directionFrames} target={directionTarget} boardScale={scale} />
  </div>;
}
