import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { GuideAcknowledgement, GuideCandidate } from "../firstPlayGuide";
import { TURN_RESULT_PILL_LAYOUT_EVENT, TURN_RESULT_PILL_SELECTOR } from "../turnResultPillLayout";
import { PhraseText } from "./PhraseText";
import { isFocusRestorable } from "./RulesDialog";

export interface FirstPlayHintProps {
  readonly candidate: GuideCandidate;
  readonly acknowledgement: GuideAcknowledgement;
  readonly onShown?: (acknowledgement: GuideAcknowledgement) => void;
  readonly onClose: () => void;
  readonly onDisable: () => void;
  readonly onDetails: (sectionId: GuideCandidate["copy"]["sectionId"], opener: HTMLElement) => void;
  readonly onRestoreFocus: () => void;
  readonly onDetailsFocusRestored?: (candidateKey: string) => void;
}

function acknowledgementIdentity(acknowledgement: GuideAcknowledgement): string {
  return `${acknowledgement.sessionId}:${acknowledgement.candidateKey}:${acknowledgement.displayGeneration}`;
}

interface HintRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface HintPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

const HINT_SAFE_GUTTER_PX = 12;
const HINT_OBSTACLE_GAP_PX = 8;
const HINT_MAX_WIDTH_PX = 360;
const HINT_OBSTACLE_SELECTOR = [
  ".game-panel",
  TURN_RESULT_PILL_SELECTOR,
  ".map-overview",
  ".maplibregl-ctrl",
].join(", ");

function overlap(first: HintRect, second: HintRect): boolean {
  return first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top;
}

function visibleRect(element: Element): HintRect | null {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return null;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function expandedRect(rect: HintRect, amount: number, viewport: HintRect): HintRect {
  return {
    left: Math.max(viewport.left, rect.left - amount),
    top: Math.max(viewport.top, rect.top - amount),
    right: Math.min(viewport.right, rect.right + amount),
    bottom: Math.min(viewport.bottom, rect.bottom + amount),
  };
}

function chooseHintPlacement(viewportWidth: number, viewportHeight: number): HintPlacement | null {
  const viewport: HintRect = {
    left: HINT_SAFE_GUTTER_PX,
    top: HINT_SAFE_GUTTER_PX,
    right: Math.max(HINT_SAFE_GUTTER_PX, viewportWidth - HINT_SAFE_GUTTER_PX),
    bottom: Math.max(HINT_SAFE_GUTTER_PX, viewportHeight - HINT_SAFE_GUTTER_PX),
  };
  if (!(viewport.right > viewport.left) || !(viewport.bottom > viewport.top)) return null;

  const obstacles = Array.from(document.querySelectorAll(HINT_OBSTACLE_SELECTOR), visibleRect)
    .filter((rect): rect is HintRect => rect !== null)
    .map((rect) => expandedRect(rect, HINT_OBSTACLE_GAP_PX, viewport));
  const xEdges = [...new Set([viewport.left, viewport.right,
    ...obstacles.flatMap((rect) => [rect.left, rect.right])])].sort((a, b) => a - b);
  const yEdges = [...new Set([viewport.top, viewport.bottom,
    ...obstacles.flatMap((rect) => [rect.top, rect.bottom])])].sort((a, b) => a - b);

  let best: HintRect | null = null;
  for (let leftIndex = 0; leftIndex < xEdges.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < xEdges.length; rightIndex += 1) {
      const left = xEdges[leftIndex]!;
      const right = xEdges[rightIndex]!;
      for (let topIndex = 0; topIndex < yEdges.length - 1; topIndex += 1) {
        for (let bottomIndex = topIndex + 1; bottomIndex < yEdges.length; bottomIndex += 1) {
          const candidate: HintRect = { left, right, top: yEdges[topIndex]!, bottom: yEdges[bottomIndex]! };
          if (obstacles.some((obstacle) => overlap(candidate, obstacle))) continue;
          const area = (candidate.right - candidate.left) * (candidate.bottom - candidate.top);
          const bestArea = best ? (best.right - best.left) * (best.bottom - best.top) : 0;
          if (area > bestArea || (area === bestArea && right - left > (best?.right ?? 0) - (best?.left ?? 0))) {
            best = candidate;
          }
        }
      }
    }
  }
  if (!best) return null;
  const regionWidth = best.right - best.left;
  const width = Math.min(HINT_MAX_WIDTH_PX, regionWidth);
  return {
    left: best.left + (regionWidth - width) / 2,
    top: best.top,
    width,
    maxHeight: best.bottom - best.top,
  };
}

function samePlacement(first: HintPlacement | null, second: HintPlacement | null): boolean {
  return first === second || (first !== null && second !== null
    && first.left === second.left && first.top === second.top
    && first.width === second.width && first.maxHeight === second.maxHeight);
}

function useHintPlacement(): HintPlacement | null {
  const [placement, setPlacement] = useState<HintPlacement | null>(null);

  useLayoutEffect(() => {
    let resizeObserver: ResizeObserver | null = null;
    const measure = (): void => {
      const next = chooseHintPlacement(window.innerWidth, window.innerHeight);
      setPlacement((current) => samePlacement(current, next) ? current : next);
    };
    const observeObstacles = (): void => {
      resizeObserver?.disconnect();
      const elements = document.querySelectorAll(HINT_OBSTACLE_SELECTOR);
      elements.forEach((element) => resizeObserver?.observe(element));
      const map = document.querySelector(".map-container");
      if (map) resizeObserver?.observe(map);
      measure();
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, measure);
    resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observeObstacles();
    const map = document.querySelector(".map-container") ?? document.body;
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(observeObstacles);
    mutationObserver?.observe(map, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  return placement;
}

/** Persistent, non-modal hint card; its status announcement is owned by the game's single status region. */
export function FirstPlayHint({
  candidate,
  acknowledgement,
  onShown,
  onClose,
  onDisable,
  onDetails,
  onRestoreFocus,
  onDetailsFocusRestored,
}: FirstPlayHintProps): React.JSX.Element | null {
  const cardRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const shownAcknowledgementRef = useRef<string | null>(null);
  const placement = useHintPlacement();

  useLayoutEffect(() => {
    const details = detailsRef.current;
    if (placement === null || !onDetailsFocusRestored || !isFocusRestorable(details)) return;
    details.scrollIntoView({ block: "nearest", inline: "nearest" });
    details.focus({ preventScroll: true });
    if (document.activeElement === details) onDetailsFocusRestored(candidate.key);
  }, [candidate.key, onDetailsFocusRestored, placement]);

  useEffect(() => {
    if (placement === null) return;
    const identity = acknowledgementIdentity(acknowledgement);
    if (shownAcknowledgementRef.current === identity) return;
    shownAcknowledgementRef.current = identity;
    onShown?.(acknowledgement);
  }, [acknowledgement, onShown, placement]);

  const stopSkipShortcut = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === "s" || event.key === "S" || event.key === "Escape") event.stopPropagation();
  };

  const close = (action: () => void): void => {
    const restoreFocus = cardRef.current?.contains(document.activeElement) ?? false;
    action();
    if (restoreFocus) onRestoreFocus();
  };

  if (placement === null) return null;

  const placementStyle: CSSProperties = {
    left: `${placement.left}px`,
    right: "auto",
    top: `${placement.top}px`,
    width: `${placement.width}px`,
    maxWidth: "none",
    maxHeight: `${placement.maxHeight}px`,
    transform: "none",
  };

  return (
    <section
      ref={cardRef}
      className="first-play-hint"
      style={placementStyle}
      aria-label="ヒント"
      data-guide-candidate-key={candidate.key}
      onKeyDown={stopSkipShortcut}
    >
      <p className="first-play-hint__copy"><PhraseText text={candidate.copy.text} /></p>
      <div className="first-play-hint__actions">
        <button type="button" data-guide-action="close" onClick={() => close(onClose)}>閉じる</button>
        <button type="button" data-guide-action="disable" onClick={() => close(onDisable)}>もう表示しない</button>
        <button
          ref={detailsRef}
          type="button"
          data-guide-action="details"
          onClick={(event) => onDetails(candidate.copy.sectionId, event.currentTarget)}
        >詳しく</button>
      </div>
    </section>
  );
}
