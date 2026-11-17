import { type MouseEvent, type PointerEvent, type SyntheticEvent, useId, useLayoutEffect, useRef } from "react";
import type { RulesGuideModel, RulesSectionId } from "../rulesGuide";
import { PhraseText } from "./PhraseText";
import { RulesGuide, focusRulesSection } from "./RulesGuide";

export interface RulesDialogProps {
  model: RulesGuideModel;
  sectionId?: RulesSectionId;
  returnFocus: HTMLElement | null;
  getFallbackFocus: () => HTMLElement | null;
  onClose: () => void;
}

const DIALOG_TITLE = "遊び方";
const DIALOG_SUBTITLE = "ゲームの進行はそのままです。閉じると続きから遊べます。";
const CLOSE_LABEL = "閉じる";
const HIDDEN_VISIBILITY_VALUES: ReadonlySet<string> = new Set(["hidden", "collapse"]);

export interface FocusRestorableOptions {
  /** The fallback may be aria-disabled (GamePanel parks focus on an aria-disabled dice); native :disabled cannot take focus. */
  allowAriaDisabled?: boolean;
}

/** True when the element can take focus now: connected, visible, enabled and outside hidden or inert subtrees. */
export function isFocusRestorable(
  element: HTMLElement | null,
  { allowAriaDisabled = false }: FocusRestorableOptions = {},
): element is HTMLElement {
  if (!element || !element.isConnected || element.matches(":disabled")) return false;
  if (!allowAriaDisabled && element.getAttribute("aria-disabled") === "true") return false;
  if (HIDDEN_VISIBILITY_VALUES.has(getComputedStyle(element).visibility)) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert")) return false;
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

/**
 * Rules guide on a native modal <dialog>, mounted next to the game panel. Escape and the backdrop only
 * request closure; React unmounts the dialog, and that cleanup closes it and restores focus. The page
 * behind stays mounted, so no game action is dispatched on open or close.
 */
export function RulesDialog({
  model, sectionId, returnFocus, getFallbackFocus, onClose,
}: RulesDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressOnBackdropRef = useRef(false);
  const idPrefix = useId();
  const subtitleId = useId();
  // The effect runs once per mount; it reads the latest props through this ref when it closes.
  const latest = useRef({ sectionId, returnFocus, getFallbackFocus });
  latest.current = { sectionId, returnFocus, getFallbackFocus };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    const requested = latest.current.sectionId;
    if (!requested || !focusRulesSection(dialog, idPrefix, requested)) {
      titleRef.current?.focus({ preventScroll: true });
    }
    return () => {
      if (dialog.open) dialog.close();
      // Deferred: this cleanup runs before the commit's other DOM changes. Another open modal (a decision
      // dialog, or this one re-opened by a StrictMode replay) owns focus.
      queueMicrotask(() => {
        if (document.querySelector("dialog[open]")) return;
        const { returnFocus: opener, getFallbackFocus: fallback } = latest.current;
        if (isFocusRestorable(opener)) {
          opener.focus({ preventScroll: true });
          return;
        }
        const target = fallback();
        if (isFocusRestorable(target, { allowAriaDisabled: true })) target.focus({ preventScroll: true });
      });
    };
  }, [idPrefix]);

  const onDialogCancel = (event: SyntheticEvent): void => {
    event.preventDefault();
    onClose();
  };
  // Chromium fires click on the common ancestor, so a text selection dragged onto the backdrop must not close.
  const onBackdropPointerDown = (event: PointerEvent<HTMLDialogElement>): void => {
    pressOnBackdropRef.current = event.target === event.currentTarget;
  };
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>): void => {
    const pressedOnBackdrop = pressOnBackdropRef.current;
    pressOnBackdropRef.current = false;
    if (pressedOnBackdrop && event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="rules-dialog"
      aria-labelledby={`${idPrefix}-title`}
      aria-describedby={subtitleId}
      onCancel={onDialogCancel}
      onPointerDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <header className="rules-dialog__header">
        <div>
          <h1 id={`${idPrefix}-title`} ref={titleRef} className="rules-dialog__title" tabIndex={-1}>{DIALOG_TITLE}</h1>
          <p id={subtitleId} className="rules-dialog__subtitle"><PhraseText text={DIALOG_SUBTITLE} /></p>
        </div>
        <button type="button" className="rules-dialog__close" onClick={onClose}>{CLOSE_LABEL}</button>
      </header>
      <div className="rules-dialog__body" tabIndex={0}>
        <RulesGuide model={model} idPrefix={idPrefix} />
      </div>
    </dialog>
  );
}
