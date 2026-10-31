import { useId, useLayoutEffect, useRef, useState } from "react";
import { ItemIcon } from "./ItemIcon";
import {
  ITEM_DESCRIPTIONS, ITEM_REPLACEMENT_NOTE, itemTiming, itemTone, itemUnavailableText,
  type ItemHint,
} from "../itemPresentation";
import type { ItemKind } from "../../../types/network";
import type { ItemUnavailableReason } from "../itemSession";
import { modalDialogOpen } from "./GameMenu";

export const ITEM_CARD_GAP: number = 8;
export const ITEM_CARD_VIEWPORT_MARGIN: number = 8;
export const ITEM_CARD_SHEET_MAX_WIDTH: number = 600;
export const ITEM_CARD_SHEET_MAX_HEIGHT: number = 500;
const GAME_PANEL_SELECTOR: string = ".game-panel";
const ROLL_BUTTON_SELECTOR: string = ".game-panel__roll";

export interface ItemCardPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy: string;
  id?: string;
}

export interface ItemCardPlacementRect { top: number; left: number; width: number; height: number }
export interface ItemCardSize { width: number; height: number }
export interface ItemCardViewport { width: number; height: number }
export type ItemCardPlacement =
  | { mode: "sheet" }
  | { mode: "anchored"; side: "above" | "below"; top: number; left: number };

export function placeItemCard(
  anchorRect: ItemCardPlacementRect,
  cardSize: ItemCardSize,
  viewport: ItemCardViewport,
): ItemCardPlacement {
  if (viewport.width <= ITEM_CARD_SHEET_MAX_WIDTH || viewport.height <= ITEM_CARD_SHEET_MAX_HEIGHT) {
    return { mode: "sheet" };
  }

  const maxLeft: number = viewport.width - cardSize.width - ITEM_CARD_VIEWPORT_MARGIN;
  const left: number = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2 - cardSize.width / 2, ITEM_CARD_VIEWPORT_MARGIN),
    Math.max(ITEM_CARD_VIEWPORT_MARGIN, maxLeft),
  );
  const aboveTop: number = anchorRect.top - ITEM_CARD_GAP - cardSize.height;
  const belowTop: number = anchorRect.top + anchorRect.height + ITEM_CARD_GAP;
  const maxTop: number = Math.max(ITEM_CARD_VIEWPORT_MARGIN, viewport.height - cardSize.height - ITEM_CARD_VIEWPORT_MARGIN);
  let side: "above" | "below";
  let top: number;

  if (aboveTop >= ITEM_CARD_VIEWPORT_MARGIN) {
    side = "above";
    top = aboveTop;
  } else if (belowTop + cardSize.height <= viewport.height - ITEM_CARD_VIEWPORT_MARGIN) {
    side = "below";
    top = belowTop;
  } else {
    const aboveSpace: number = anchorRect.top - ITEM_CARD_VIEWPORT_MARGIN;
    const belowSpace: number = viewport.height - ITEM_CARD_VIEWPORT_MARGIN - (anchorRect.top + anchorRect.height);
    side = aboveSpace >= belowSpace ? "above" : "below";
    top = Math.min(Math.max(side === "above" ? aboveTop : belowTop, ITEM_CARD_VIEWPORT_MARGIN), maxTop);
  }
  return { mode: "anchored", side, top: Math.round(top), left: Math.round(left) };
}

function samePlacement(a: ItemCardPlacement, b: ItemCardPlacement): boolean {
  if (a.mode === "sheet" || b.mode === "sheet") return a.mode === b.mode;
  return a.side === b.side && a.top === b.top && a.left === b.left;
}

type FocusRestore = "anchor" | "dice" | null;

export function ItemCardPopover({ open, anchor, onClose, children, labelledBy, id }: ItemCardPopoverProps): React.JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null);
  const nativeSupported: boolean = useRef(typeof HTMLElement.prototype.showPopover === "function").current;
  const nativeOpenRef = useRef<boolean>(false);
  const openRef = useRef<boolean>(open);
  const onCloseRef = useRef<() => void>(onClose);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  // The opener seen while open: a parent may clear `anchor` together with `open`, and Escape/閉じる must still return there.
  const openAnchorRef = useRef<HTMLElement | null>(null);
  const closeRequestedRef = useRef<boolean>(false);
  const restoreRef = useRef<FocusRestore>(null);
  const previousOpenRef = useRef<boolean>(false);
  const [placement, setPlacement] = useState<ItemCardPlacement>({ mode: "anchored", side: "above", top: 0, left: 0 });
  openRef.current = open;
  onCloseRef.current = onClose;
  anchorRef.current = anchor;

  const focusFallback = (): void => {
    const element: HTMLDivElement | null = elementRef.current;
    const rollButton: HTMLElement | null = element?.closest(GAME_PANEL_SELECTOR)?.querySelector<HTMLElement>(ROLL_BUTTON_SELECTOR) ?? null;
    rollButton?.focus();
  };

  const requestClose = (restore: FocusRestore): void => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    restoreRef.current = restore;
    onCloseRef.current();
  };

  useLayoutEffect(() => {
    const element: HTMLDivElement | null = elementRef.current;
    if (!element) return;
    if (open && !previousOpenRef.current) {
      closeRequestedRef.current = false;
      restoreRef.current = null;
    }
    previousOpenRef.current = open;

    if (nativeSupported && open && !nativeOpenRef.current && element.isConnected) {
      const source: HTMLElement | null = anchor?.isConnected ? anchor : null;
      element.showPopover(source ? { source } : undefined);
      nativeOpenRef.current = true;
    }
    if (nativeSupported && !open && nativeOpenRef.current && element.isConnected) {
      // Hide before restoring focus so the browser's own focus return cannot override ours.
      element.hidePopover();
      nativeOpenRef.current = false;
    }
    if (open) {
      const heading: HTMLElement | null = document.getElementById(labelledBy);
      (heading && element.contains(heading) ? heading : element).focus();
      return;
    }
    const restore: FocusRestore = restoreRef.current;
    restoreRef.current = null;
    if (restore === null) return;
    const opener: HTMLElement | null = openAnchorRef.current;
    openAnchorRef.current = null;
    if (restore === "anchor" && opener?.isConnected) {
      opener.focus();
      return;
    }
    focusFallback();
  }, [open, nativeSupported, labelledBy]);

  // No dependency list: a removed opener may keep the same element identity, so check on every render.
  useLayoutEffect(() => {
    if (!open) return;
    if (anchor) openAnchorRef.current = anchor;
    if (!anchor || !anchor.isConnected) requestClose("dice");
  });

  useLayoutEffect(() => {
    if (!nativeSupported || !open) return;
    const measure = (): void => {
      const element: HTMLDivElement | null = elementRef.current;
      const currentAnchor: HTMLElement | null = anchorRef.current;
      const next: ItemCardPlacement = element?.isConnected && currentAnchor?.isConnected
        ? placeItemCard(currentAnchor.getBoundingClientRect(), element.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight })
        : { mode: "sheet" };
      // Keep the previous object when nothing moved, so scroll events do not re-render.
      setPlacement((previous: ItemCardPlacement) => samePlacement(previous, next) ? previous : next);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  // The mode is in the deps so a sheet <-> anchored switch re-measures with the new width.
  }, [nativeSupported, open, anchor, placement.mode]);

  useLayoutEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || modalDialogOpen()) return;
      event.preventDefault();
      requestClose("anchor");
    };
    const handleFocusOut = (event: FocusEvent): void => {
      const target: Node | null = event.relatedTarget as Node | null;
      if (!target || elementRef.current?.contains(target)) return;
      requestClose(null);
    };
    const element: HTMLDivElement | null = elementRef.current;
    element?.addEventListener("focusout", handleFocusOut);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      element?.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const element: HTMLDivElement | null = elementRef.current;
    const handleToggle = (event: Event): void => {
      const newState: string | undefined = (event as ToggleEvent).newState;
      if (newState === "open") {
        nativeOpenRef.current = true;
        if (!openRef.current && element?.isConnected) {
          element.hidePopover();
          nativeOpenRef.current = false;
        }
        return;
      }
      if (newState !== "closed") return;
      nativeOpenRef.current = false;
      if (openRef.current) requestClose(null);
    };
    // `toggle` is queued as a later task, so input handled right after a light dismiss could still see
    // the card as open. `beforetoggle` fires synchronously before the browser hides it.
    const handleBeforeToggle = (event: Event): void => {
      if ((event as ToggleEvent).newState !== "closed" || !openRef.current) return;
      nativeOpenRef.current = false;
      requestClose(null);
    };
    element?.addEventListener("beforetoggle", handleBeforeToggle);
    element?.addEventListener("toggle", handleToggle);
    return () => {
      element?.removeEventListener("beforetoggle", handleBeforeToggle);
      element?.removeEventListener("toggle", handleToggle);
    };
  }, []);

  useLayoutEffect(() => () => {
    const element: HTMLDivElement | null = elementRef.current;
    if (openRef.current && element?.contains(document.activeElement)) focusFallback();
  }, []);

  const placementClass: string = placement.mode === "sheet" ? "item-card-popover--sheet" : "item-card-popover--anchored";
  const inlineStyle: React.CSSProperties | undefined = nativeSupported && placement.mode === "anchored"
    ? { top: `${placement.top}px`, left: `${placement.left}px` }
    : undefined;

  return <div
    ref={elementRef}
    id={id}
    role="dialog"
    aria-labelledby={labelledBy}
    className={`item-card-popover ${nativeSupported ? `item-card-popover--native ${placementClass}` : "item-card-popover--inline"}`}
    tabIndex={-1}
    {...(nativeSupported ? { popover: "auto" as const } : { hidden: !open })}
    style={inlineStyle}
  >
    {children}
    <button type="button" className="item-card-popover__close" onClick={() => requestClose("anchor")}>閉じる</button>
  </div>;
}

export interface ItemCardAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly onActivate: () => void;
}

export interface ItemCardProps {
  kind: ItemKind;
  headingId?: string;
  selected?: boolean;
  isNew?: boolean;
  unavailableReason?: ItemUnavailableReason | null;
  hint?: ItemHint | null;
  replacesSelection?: boolean;
  action?: ItemCardAction;
}

export function ItemCard({
  kind, headingId, selected = false, isNew = false, unavailableReason = null,
  hint = null, replacesSelection = false, action,
}: ItemCardProps): React.JSX.Element {
  const generatedId: string = useId();
  const actualHeadingId: string = headingId ?? `item-card-heading-${generatedId}`;
  const reasonId: string = `item-card-reason-${generatedId}`;
  const description = ITEM_DESCRIPTIONS[kind];
  const unavailableText: string | null = itemUnavailableText(kind, unavailableReason);

  return (
    <div className={`item-card item-card--${itemTone(kind)}${selected ? " item-card--selected" : ""}`}>
      <div className="item-card__header">
        <span className="item-card__icon"><ItemIcon kind={kind} size={32} /></span>
        <h3 className="item-card__name" id={actualHeadingId} tabIndex={-1}>{description.name}</h3>
      </div>
      {(selected || isNew) && <p className="item-card__markers">
        {selected && <span className="item-card__marker item-card__marker--selected">選択中</span>}
        {isNew && <span className="item-card__marker item-card__marker--new">新しく拾った</span>}
      </p>}
      <p className="item-card__effect">{description.effect}</p>
      <p className="item-card__timing">{itemTiming(kind)}</p>
      {hint && <p className={`item-card__hint${hint.caution ? " item-card__hint--caution" : ""}`}>{hint.text}</p>}
      {replacesSelection && !selected && <p className="item-card__note">{ITEM_REPLACEMENT_NOTE}</p>}
      {unavailableText && <p className="item-card__reason" id={reasonId}>{unavailableText}</p>}
      {action && <button
        type="button"
        className="button-primary item-card__action"
        disabled={action.disabled}
        aria-describedby={unavailableText ? reasonId : undefined}
        onClick={() => action.onActivate()}
      >{action.label}</button>}
    </div>
  );
}
