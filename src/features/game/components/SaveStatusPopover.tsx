import { useId, useLayoutEffect, useRef, useState } from "react";
import { PhraseText } from "./PhraseText";
import { modalDialogOpen } from "./GameMenu";
import { isFocusRestorable } from "./RulesDialog";
import { saveStatusPresentation } from "../saveStatusPresentation";
import type { SaveWriteResult } from "../store/persistence";

export const SAVE_STATUS_GAP: number = 8;
export const SAVE_STATUS_VIEWPORT_MARGIN: number = 8;
const SAVE_STATUS_CLOSE_LABEL: string = "閉じる";
const SAVE_STATUS_DIALOG_LABEL: string = "セーブの状態";

export interface SaveStatusRect { top: number; left: number; width: number; height: number }
export interface SaveStatusSize { width: number; height: number }

/** Centres the explanation under the trigger (above when there is no room) and keeps it inside the viewport. */
export function placeSaveStatus(
  anchor: SaveStatusRect,
  size: SaveStatusSize,
  viewport: SaveStatusSize,
): { top: number; left: number } {
  const maxLeft: number = viewport.width - size.width - SAVE_STATUS_VIEWPORT_MARGIN;
  const left: number = Math.min(
    Math.max(anchor.left + anchor.width / 2 - size.width / 2, SAVE_STATUS_VIEWPORT_MARGIN),
    Math.max(SAVE_STATUS_VIEWPORT_MARGIN, maxLeft),
  );
  const belowTop: number = anchor.top + anchor.height + SAVE_STATUS_GAP;
  const fitsBelow: boolean = belowTop + size.height <= viewport.height - SAVE_STATUS_VIEWPORT_MARGIN;
  const aboveTop: number = anchor.top - SAVE_STATUS_GAP - size.height;
  const top: number = fitsBelow ? belowTop : Math.max(SAVE_STATUS_VIEWPORT_MARGIN, aboveTop);
  return { top: Math.round(top), left: Math.round(left) };
}

export interface SaveStatusPopoverProps {
  status: SaveWriteResult | null;
  /** Trigger content (icon or status text). */
  children: React.ReactNode;
  /** Places the trigger inside a caller-owned wrapper; the explanation is always rendered after it, outside. */
  wrapper?: (trigger: React.JSX.Element) => React.JSX.Element;
}

export function SaveStatusPopover({
  status, children, wrapper,
}: SaveStatusPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const nativeSupported: boolean = useRef(typeof HTMLElement.prototype.showPopover === "function").current;
  const nativeOpenRef = useRef<boolean>(false);
  const openRef = useRef<boolean>(open);
  const restoreFocusRef = useRef<boolean>(false);
  const openedByPointerRef = useRef<boolean>(false);
  const popoverId: string = useId();
  const textId: string = `${popoverId}-text`;
  openRef.current = open;

  const close = (restoreFocus: boolean): void => {
    if (!openRef.current) return;
    restoreFocusRef.current = restoreFocus;
    openRef.current = false;
    setOpen(false);
  };

  useLayoutEffect(() => {
    const popover: HTMLDivElement | null = popoverRef.current;
    const trigger: HTMLButtonElement | null = triggerRef.current;
    if (!popover || !trigger) return;
    if (open) {
      if (nativeSupported && !nativeOpenRef.current) {
        popover.showPopover();
        nativeOpenRef.current = true;
      }
      // The close button is interactive, so Space / Enter act on it instead of reaching the game shortcuts.
      closeRef.current?.focus();
      return;
    }
    if (nativeSupported && nativeOpenRef.current) {
      // Hide before restoring focus so the browser's own focus return cannot override ours.
      popover.hidePopover();
      nativeOpenRef.current = false;
    }
    const restore: boolean = restoreFocusRef.current;
    restoreFocusRef.current = false;
    if (restore && isFocusRestorable(trigger)) trigger.focus();
  }, [open, nativeSupported]);

  useLayoutEffect(() => {
    if (!nativeSupported || !open) return;
    const measure = (): void => {
      const popover: HTMLDivElement | null = popoverRef.current;
      const trigger: HTMLButtonElement | null = triggerRef.current;
      if (!popover?.isConnected || !trigger?.isConnected) return;
      const viewport: SaveStatusSize = { width: window.innerWidth, height: window.innerHeight };
      const next = placeSaveStatus(trigger.getBoundingClientRect(), popover.getBoundingClientRect(), viewport);
      // Keep the previous object when nothing moved, so scroll events do not re-render.
      setPosition((previous) => previous?.top === next.top && previous.left === next.left ? previous : next);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, nativeSupported]);

  useLayoutEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || modalDialogOpen()) return;
      event.preventDefault();
      close(true);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [open]);

  useLayoutEffect(() => {
    const popover: HTMLDivElement | null = popoverRef.current;
    // Focus moving out (a modal dialog taking over, Tab in the inline fallback) closes without pulling focus back.
    const handleFocusOut = (event: FocusEvent): void => {
      const target: Node | null = event.relatedTarget as Node | null;
      if (!target || popover?.contains(target)) return;
      close(false);
    };
    popover?.addEventListener("focusout", handleFocusOut);
    return () => popover?.removeEventListener("focusout", handleFocusOut);
  }, []);

  useLayoutEffect(() => {
    const popover: HTMLDivElement | null = popoverRef.current;
    if (!nativeSupported || !popover) return;
    // Light dismiss closes the native popover without our involvement; mirror it into state, focus untouched.
    const handleBeforeToggle = (event: Event): void => {
      if ((event as ToggleEvent).newState !== "closed") return;
      nativeOpenRef.current = false;
      close(false);
    };
    popover.addEventListener("beforetoggle", handleBeforeToggle);
    return () => popover.removeEventListener("beforetoggle", handleBeforeToggle);
  }, [nativeSupported]);

  const onTriggerPointerDown = (): void => {
    // Light dismiss runs before click, so remember that the pointer press found the popover open.
    openedByPointerRef.current = openRef.current;
  };
  const onTriggerClick = (): void => {
    const dismissedByPointer: boolean = openedByPointerRef.current;
    openedByPointerRef.current = false;
    if (openRef.current) return close(true);
    if (dismissedByPointer) return;
    openRef.current = true;
    setOpen(true);
  };

  const { tone, explanation } = saveStatusPresentation(status);
  const trigger: React.JSX.Element = <button
    ref={triggerRef}
    type="button"
    className="save-status__trigger"
    aria-expanded={open}
    aria-controls={popoverId}
    onPointerDown={onTriggerPointerDown}
    onKeyDown={() => { openedByPointerRef.current = false; }}
    onClick={onTriggerClick}
  >{children}</button>;
  const popoverStyle: React.CSSProperties | undefined = nativeSupported && position
    ? { top: `${position.top}px`, left: `${position.left}px` }
    : undefined;

  return <>
    {wrapper ? wrapper(trigger) : trigger}
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label={SAVE_STATUS_DIALOG_LABEL}
      aria-describedby={textId}
      tabIndex={-1}
      className={`save-status__popover save-status__popover--${tone} ${nativeSupported ? "save-status__popover--native" : "save-status__popover--inline"}`}
      style={popoverStyle}
      {...(nativeSupported ? { popover: "auto" as const } : { hidden: !open })}
    >
      <p className="save-status__text" id={textId}><PhraseText text={explanation} /></p>
      <button ref={closeRef} type="button" className="save-status__close" onClick={() => close(true)}>{SAVE_STATUS_CLOSE_LABEL}</button>
    </div>
  </>;
}
