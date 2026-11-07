import { useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ItemKind } from "../../../types/network";
import { ItemIcon } from "./ItemIcon";
import type { RectBox } from "./TurnMomentHost";

const ICON_SIZE: number = 48;
const ICON_RADIUS: number = ICON_SIZE / 2;
const ICON_TARGET_SIZE: number = 24;
const FADE_MOTION: PickupMotion = { kind: "fade", translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };

interface PickupMotion {
  readonly kind: "flight" | "fade";
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface ItemPickupMomentProps {
  kind: ItemKind;
  durationMs: number;
  centerX: number;
  centerY: number;
  targetRef: RefObject<HTMLElement | null> | null;
}

function isUsableRect(rect: RectBox | null): rect is RectBox {
  return rect !== null && Number.isFinite(rect.left) && Number.isFinite(rect.top)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0;
}

function rectForTarget(targetRef: ItemPickupMomentProps["targetRef"]): RectBox | null {
  const element = targetRef?.current;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function choosePickupMotion(centerX: number, centerY: number, target: RectBox | null): PickupMotion {
  if (!isUsableRect(target)) return FADE_MOTION;
  const source: RectBox = { left: centerX - ICON_RADIUS, top: centerY - ICON_RADIUS, width: ICON_SIZE, height: ICON_SIZE };
  const translateX: number = target.left + target.width / 2 - (source.left + source.width / 2);
  const translateY: number = target.top + target.height / 2 - (source.top + source.height / 2);
  const targetSize: number = Math.min(ICON_TARGET_SIZE, target.width, target.height);
  const targetScale: number = targetSize / ICON_SIZE;
  return { kind: "flight", translateX, translateY, scaleX: targetScale, scaleY: targetScale };
}

/** Decorative pickup icon flight. The host owns tapping/Skip and the sequence owns its deadline. */
export function ItemPickupMoment({ kind, durationMs, centerX, centerY, targetRef }: ItemPickupMomentProps): React.JSX.Element {
  const [motion, setMotion] = useState<PickupMotion>(FADE_MOTION);
  useLayoutEffect(() => {
    setMotion(choosePickupMotion(centerX, centerY, rectForTarget(targetRef)));
  }, [centerX, centerY, targetRef]);

  const style: CSSProperties = {
    left: centerX - ICON_RADIUS,
    top: centerY - ICON_RADIUS,
    "--pickup-ms": `${durationMs}ms`,
    "--pickup-x": `${motion.translateX}px`,
    "--pickup-y": `${motion.translateY}px`,
    "--pickup-sx": motion.scaleX,
    "--pickup-sy": motion.scaleY,
  } as CSSProperties;
  return (
    <div className={`item-pickup-moment item-pickup-moment--${motion.kind}`} data-stage="pickup" data-motion={motion.kind} style={style}>
      <ItemIcon kind={kind} size={ICON_SIZE} />
    </div>
  );
}
