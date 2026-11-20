import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, RefObject, SyntheticEvent } from "react";
import {
  placeCoachBubble,
  type CoachBubblePlacement,
  type CoachRect,
  type CoachSize,
  type CoachStep,
  type CoachStepSequence,
} from "../firstPlayGuide";
import { PhraseText } from "./PhraseText";

export type FirstPlayCoachCloseReason = "skip" | "complete";

export interface FirstPlayCoachProps {
  readonly steps: CoachStepSequence;
  readonly targets: Partial<Record<CoachStep, RefObject<HTMLElement | null>>>;
  readonly onClose: (reason: FirstPlayCoachCloseReason) => void;
  /** The caller decides which still-visible control should receive focus after this dialog unmounts. */
  readonly onRestoreFocus: () => void;
}

const INITIAL_PLACEMENT: CoachBubblePlacement = { left: 16, top: 16, side: "center" };

function isUsableRect(rect: CoachRect | null): rect is CoachRect {
  return rect !== null && Number.isFinite(rect.left) && Number.isFinite(rect.top)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width > 0 && rect.height > 0;
}

function sameRect(left: CoachRect | null, right: CoachRect | null): boolean {
  return left === right || (left !== null && right !== null
    && left.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height);
}

/** A modal coach mark. Its spotlight is decorative; only the bubble receives pointer events. */
export function FirstPlayCoach({ steps, targets, onClose, onRestoreFocus }: FirstPlayCoachProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<CoachRect | null>(null);
  const [placement, setPlacement] = useState(INITIAL_PLACEMENT);
  const titleId = useId();
  const stepId = useId();
  const copyId = useId();
  const current = steps[stepIndex] ?? steps[0];
  const targetRef = targets[current.step] ?? null;
  const latest = useRef({ onClose, onRestoreFocus });
  latest.current = { onClose, onRestoreFocus };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    bubbleRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      // A Rules dialog or a StrictMode effect replay keeps ownership of focus.
      queueMicrotask(() => {
        if (document.querySelector("dialog[open]")) return;
        latest.current.onRestoreFocus();
      });
    };
  }, []);

  useLayoutEffect(() => {
    let observedTarget: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const resolveTarget = (): HTMLElement | null => {
      const candidate = targetRef?.current ?? null;
      const currentTarget = candidate?.isConnected ? candidate : null;
      if (currentTarget === observedTarget) return currentTarget;
      if (observedTarget) observer?.unobserve(observedTarget);
      observedTarget = currentTarget;
      if (observedTarget) observer?.observe(observedTarget);
      return observedTarget;
    };

    const measure = (): void => {
      const currentTarget = resolveTarget();
      const domRect = currentTarget?.getBoundingClientRect() ?? null;
      const measuredTarget: CoachRect | null = domRect && isUsableRect({
        left: domRect.left,
        top: domRect.top,
        width: domRect.width,
        height: domRect.height,
      }) ? {
        left: domRect.left,
        top: domRect.top,
        width: domRect.width,
        height: domRect.height,
      } : null;
      setTargetRect((previous) => sameRect(previous, measuredTarget) ? previous : measuredTarget);

      const bubbleRect = bubbleRef.current?.getBoundingClientRect();
      const bubbleSize: CoachSize = bubbleRect
        ? { width: bubbleRect.width, height: bubbleRect.height }
        : { width: 0, height: 0 };
      setPlacement(placeCoachBubble(measuredTarget, bubbleSize, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };

    let mutationObserver: MutationObserver | null = null;
    observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (typeof MutationObserver !== "undefined") mutationObserver = new MutationObserver(measure);
    if (observer && bubbleRef.current) observer.observe(bubbleRef.current);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    mutationObserver?.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [stepIndex, targetRef]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === "Escape") event.stopPropagation();
  };

  const nextStep = (): void => setStepIndex((currentIndex) => Math.min(steps.length - 1, currentIndex + 1));
  const previousStep = (): void => setStepIndex((currentIndex) => Math.max(0, currentIndex - 1));
  const close = (reason: FirstPlayCoachCloseReason): void => latest.current.onClose(reason);
  const bubbleStyle: CSSProperties = { left: placement.left, top: placement.top };
  const spotlightStyle: CSSProperties | undefined = targetRect ? {
    left: targetRect.left,
    top: targetRect.top,
    width: targetRect.width,
    height: targetRect.height,
  } : undefined;

  return (
    <dialog
      ref={dialogRef}
      className="first-play-coach"
      aria-labelledby={titleId}
      aria-describedby={copyId}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
    >
      <h1 id={titleId} className="visually-hidden">最初のガイド</h1>
      {targetRect && <div
        className="first-play-coach__spotlight"
        style={spotlightStyle}
        aria-hidden="true"
        data-coach-spotlight="true"
      />}
      <div
        ref={bubbleRef}
        className="first-play-coach__bubble"
        style={bubbleStyle}
        data-placement-side={placement.side}
        data-target-available={targetRect ? "true" : "false"}
        role="group"
        aria-labelledby={stepId}
        aria-describedby={copyId}
        tabIndex={-1}
      >
        <p id={stepId} className="first-play-coach__step">ステップ {stepIndex + 1} / {steps.length}</p>
        <p id={copyId} className="first-play-coach__copy"><PhraseText text={current.copy.text} /></p>
        <div className="first-play-coach__actions">
          <button type="button" onClick={previousStep} disabled={stepIndex === 0}>前へ</button>
          {stepIndex < steps.length - 1
            ? <button type="button" onClick={nextStep}>次へ</button>
            : <button type="button" onClick={() => close("complete")}>はじめる</button>}
          <button type="button" className="first-play-coach__skip" onClick={() => close("skip")}>とばす</button>
        </div>
      </div>
    </dialog>
  );
}
