/** Keep an 8px visual gap between the measured panel edge and the pill. */
export const TURN_RESULT_PILL_GAP_PX = 8;
export const TURN_RESULT_PILL_LAYOUT_EVENT = "turn-result-pill-layout";

export type TurnResultPillPosition =
  | { readonly visible: false }
  | { readonly visible: true; readonly bottomPx: number; readonly leftPx: number };

export interface TurnResultPillPositionInput {
  readonly panelRect: Pick<DOMRectReadOnly, "top" | "left" | "width" | "height"> | null | undefined;
  readonly viewportHeight: number;
  readonly gapPx: number;
}

export function computeTurnResultPillPosition(input: TurnResultPillPositionInput): TurnResultPillPosition {
  const { panelRect, viewportHeight, gapPx } = input;
  if (!panelRect || !Number.isFinite(viewportHeight) || !Number.isFinite(gapPx)) return { visible: false };

  const { top, left, width, height } = panelRect;
  if (![top, left, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return { visible: false };

  const bottomPx = viewportHeight - top + gapPx;
  if (!Number.isFinite(bottomPx)) return { visible: false };
  return { visible: true, bottomPx, leftPx: left };
}

export function sameTurnResultPillPosition(a: TurnResultPillPosition, b: TurnResultPillPosition): boolean {
  if (!a.visible || !b.visible) return a.visible === b.visible;
  return a.bottomPx === b.bottomPx && a.leftPx === b.leftPx;
}
