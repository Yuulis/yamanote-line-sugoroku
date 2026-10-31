import { useEffect, useId, useRef, useState } from "react";
import type { ItemKind } from "../../../types/network";
import type { ItemSessionView } from "../itemSession";
import {
  ITEM_DESCRIPTIONS, ITEM_REPLACEMENT_NOTE, ITEM_SHORT_NAMES, itemHint, itemTiming, itemTone,
  itemUnavailableText,
} from "../itemPresentation";
import { ItemIcon } from "./ItemIcon";
import { modalDialogOpen } from "./GameMenu";
import { ItemCard, ItemCardPopover } from "./ItemCard";

const INVENTORY_SLOT_COUNT: number = 3;

export interface InventoryPanelProps {
  view: ItemSessionView;
  openItemId: string | null;
  onOpenItemChange: (id: string | null) => void;
  onUse: (instanceId: string, kind: ItemKind, opener: HTMLElement) => void;
}

interface DescriptionPart {
  readonly className: string;
  readonly text: string;
  readonly caution?: boolean;
}

interface InventoryItemPopoverProps {
  generatedId: string;
  openItemId: string | null;
  view: ItemSessionView;
  anchor: HTMLElement | null;
  lastKnownItem: { id: string; kind: ItemKind } | null;
  onUse: InventoryPanelProps["onUse"];
  onClose: () => void;
}

function InventoryItemPopover({
  generatedId, openItemId, view, anchor, lastKnownItem, onUse, onClose,
}: InventoryItemPopoverProps): React.JSX.Element {
  const headingId: string = `item-card-heading-${generatedId}`;
  const instance = openItemId ? view.inventory.find((item) => item.id === openItemId) : undefined;
  // The last known kind keeps the card for the one render in which its item left the inventory, so the
  // popover sees a missing opener, closes itself and moves focus to the dice.
  const kind: ItemKind | undefined = instance?.kind
    ?? (openItemId && lastKnownItem?.id === openItemId ? lastKnownItem.kind : undefined);
  if (!openItemId || !kind) return <ItemCardPopover
    id={`item-card-${generatedId}`} open={false} anchor={null} labelledBy={headingId} onClose={onClose}
  >{null}</ItemCardPopover>;

  const usable = view.usableItems.find((candidate) => candidate.instanceId === openItemId);
  const action = kind === "delay-certificate" ? undefined : {
    label: usable?.selected ? "選択中・変更する" : "使う",
    disabled: usable?.usable !== true,
    onActivate: () => { if (anchor) onUse(openItemId, kind, anchor); },
  };
  return <ItemCardPopover
    id={`item-card-${generatedId}`}
    open={!view.decision}
    anchor={anchor}
    labelledBy={headingId}
    onClose={onClose}
  ><ItemCard kind={kind} headingId={headingId} selected={usable?.selected ?? false}
    hint={itemHint(kind, view.hints)} unavailableReason={usable?.reason ?? null}
    replacesSelection={usable?.usable === true && !usable.selected && view.draft.items.length > 0} action={action} />
  </ItemCardPopover>;
}

function withSentenceEnd(text: string): string {
  return text.endsWith("。") ? text : `${text}。`;
}

function pointInside(element: Element | null, x: number, y: number): boolean {
  if (!element) return false;
  const rect: DOMRect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function InventoryPanel({ view, openItemId, onOpenItemChange, onUse }: InventoryPanelProps): React.JSX.Element {
  const generatedId: string = useId();
  const headingId: string = `item-inventory-heading-${generatedId}`;
  // Tooltip state follows the item instance (ids are never reused), not the slot position: when items shift or a
  // slot empties and refills, nothing reappears without a new hover or focus.
  const [tooltipItemId, setTooltipItemId] = useState<string | null>(null);
  const [dismissedItemId, setDismissedItemId] = useState<string | null>(null);
  const pointerDownRef = useRef<boolean>(false);
  const hoveredItemRef = useRef<string | null>(null);
  const focusedItemRef = useRef<string | null>(null);
  const hoveredSlotRef = useRef<HTMLLIElement | null>(null);
  const tooltipElementRef = useRef<HTMLDivElement | null>(null);
  const openerRefs = useRef(new Map<string, HTMLButtonElement>());
  const openItemIdRef = useRef<string | null>(openItemId);
  const closedItemIdRef = useRef<string | null>(null);
  const pressRef = useRef<string | null>(null);
  const suppressFocusTooltipRef = useRef<string | null>(null);
  const lastOpenItemRef = useRef<{ id: string; kind: ItemKind } | null>(null);
  openItemIdRef.current = openItemId;
  const inventoryKey: string = view.inventory.map((item) => item.id).join(" ");
  // An item used or discarded while its tooltip was shown shows nothing and must not keep owning Escape.
  const shownItemId: string | null = tooltipItemId !== null && view.inventory.some((item) => item.id === tooltipItemId)
    ? tooltipItemId
    : null;
  const openInstance = openItemId ? view.inventory.find((item) => item.id === openItemId) : undefined;
  if (openInstance) lastOpenItemRef.current = { id: openInstance.id, kind: openInstance.kind };

  const hideTooltip = (itemId: string): void => {
    setTooltipItemId((current: string | null) => current === itemId ? null : current);
  };

  const clearDismissalWhenInactive = (itemId: string): void => {
    if (hoveredItemRef.current === itemId || focusedItemRef.current === itemId) return;
    setDismissedItemId((current: string | null) => current === itemId ? null : current);
  };

  const showTooltip = (itemId: string): void => {
    if (dismissedItemId === itemId) return;
    setTooltipItemId(itemId);
  };

  useEffect(() => {
    const present = (itemId: string | null): boolean => itemId !== null && view.inventory.some((item) => item.id === itemId);
    if (!present(hoveredItemRef.current)) {
      hoveredItemRef.current = null;
      hoveredSlotRef.current = null;
    }
    if (!present(focusedItemRef.current)) focusedItemRef.current = null;
    setTooltipItemId((current: string | null) => present(current) ? current : null);
    setDismissedItemId((current: string | null) => present(current) ? current : null);
  }, [inventoryKey]);

  useEffect(() => {
    if (shownItemId === null) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || modalDialogOpen()) return;
      // An open item card owns Escape (native modal -> card -> tooltip), whichever listener was registered first.
      if (openItemIdRef.current !== null) return;
      event.preventDefault();
      setDismissedItemId(shownItemId);
      setTooltipItemId(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [shownItemId]);

  useEffect(() => {
    if (openItemId) {
      suppressFocusTooltipRef.current = openItemId;
      setTooltipItemId((current) => current === openItemId ? null : current);
      setDismissedItemId(openItemId);
    }
  }, [openItemId]);

  useEffect(() => {
    if (openItemId !== null) return;
    const suppressedItemId: string | null = suppressFocusTooltipRef.current;
    suppressFocusTooltipRef.current = null;
    if (suppressedItemId && hoveredItemRef.current !== suppressedItemId && focusedItemRef.current !== suppressedItemId) {
      setDismissedItemId((current) => current === suppressedItemId ? null : current);
    }
  }, [openItemId]);

  // The tooltip takes no pointer events (it must never block the disclosure triggers under it), so "hovering the
  // tooltip" is tracked by position: it stays while the pointer is over the slot or the tooltip (WCAG 1.4.13).
  // Registered for the whole time a tooltip is shown, so a hover that starts after keyboard focus is tracked too.
  useEffect(() => {
    if (shownItemId === null) return;
    const handlePointerMove = (event: PointerEvent): void => {
      if (hoveredItemRef.current !== shownItemId) return;
      if (pointInside(tooltipElementRef.current, event.clientX, event.clientY)) return;
      if (pointInside(hoveredSlotRef.current, event.clientX, event.clientY)) return;
      hoveredItemRef.current = null;
      hoveredSlotRef.current = null;
      if (focusedItemRef.current !== shownItemId) hideTooltip(shownItemId);
      clearDismissalWhenInactive(shownItemId);
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [shownItemId]);

  return (
    <section className="item-inventory" aria-labelledby={headingId}>
      <div className="item-inventory__header">
        <h2 id={headingId} className="visually-hidden">アイテム（3枠）</h2>
        <p className="item-inventory__label" aria-hidden="true">持ち物</p>
      </div>
      <ol className="item-inventory__slots">
        {Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => {
          const item = view.inventory[index];
          if (!item) {
            return <li key={`empty-${index}`} className="item-slot item-slot--empty">
              <span className="item-slot__empty">空き枠</span>
            </li>;
          }

          const action = view.usableItems.find((candidate) => candidate.instanceId === item.id);
          const kind: ItemKind = item.kind;
          const description = ITEM_DESCRIPTIONS[kind];
          const passive: boolean = kind === "delay-certificate";
          const selected: boolean = action?.selected ?? false;
          const hint = itemHint(kind, view.hints);
          const reason: string | null = itemUnavailableText(kind, action?.reason);
          const replacement: boolean = !selected && action?.usable === true && view.draft.items.length > 0;
          const parts: DescriptionPart[] = [
            { className: "effect", text: description.effect },
            { className: "timing", text: itemTiming(kind) },
            ...(hint ? [{ className: "hint", text: hint.text, caution: hint.caution }] : []),
            ...(reason ? [{ className: "reason", text: reason }] : []),
            ...(replacement ? [{ className: "note", text: ITEM_REPLACEMENT_NOTE }] : []),
          ];
          const descriptionId: string = `item-description-${generatedId}-${index}`;
          const slotClass: string = `item-slot item-slot--${itemTone(kind)}${selected ? " item-slot--selected" : ""}${passive ? " item-slot--passive" : ""}${!action?.usable && !passive ? " item-slot--unavailable" : ""}`;
          const tooltipVisible: boolean = shownItemId === item.id && openItemId !== item.id;

          return <li
            key={item.id}
            className={slotClass}
            onPointerEnter={(event: React.PointerEvent<HTMLLIElement>) => {
              if (event.pointerType === "touch") return;
              hoveredItemRef.current = item.id;
              hoveredSlotRef.current = event.currentTarget;
              showTooltip(item.id);
            }}
            onPointerLeave={(event: React.PointerEvent<HTMLLIElement>) => {
              if (shownItemId === item.id && pointInside(tooltipElementRef.current, event.clientX, event.clientY)) return;
              hoveredItemRef.current = null;
              hoveredSlotRef.current = null;
              if (focusedItemRef.current !== item.id) hideTooltip(item.id);
              clearDismissalWhenInactive(item.id);
            }}
          >
            <h3 className="visually-hidden">{description.name}</h3>
            <button
              type="button"
              className="item-slot__button"
              aria-expanded={openItemId === item.id}
              aria-controls={`item-card-${generatedId}`}
              aria-describedby={descriptionId}
              ref={(element) => {
                if (element) openerRefs.current.set(item.id, element);
                else openerRefs.current.delete(item.id);
              }}
              onPointerDownCapture={() => {
                pointerDownRef.current = true;
                pressRef.current = openItemIdRef.current === item.id || closedItemIdRef.current === item.id ? item.id : null;
              }}
              onFocus={() => {
                focusedItemRef.current = item.id;
                if (suppressFocusTooltipRef.current === item.id) suppressFocusTooltipRef.current = null;
                else if (!pointerDownRef.current) showTooltip(item.id);
                pointerDownRef.current = false;
              }}
              onBlur={() => {
                focusedItemRef.current = null;
                if (hoveredItemRef.current !== item.id) hideTooltip(item.id);
                clearDismissalWhenInactive(item.id);
              }}
              onClick={(event) => {
                setDismissedItemId(item.id);
                hideTooltip(item.id);
                pointerDownRef.current = false;
                const reclick: boolean = event.detail > 0 && pressRef.current === item.id;
                pressRef.current = null;
                if (reclick || openItemIdRef.current === item.id) {
                  if (openItemIdRef.current === item.id) onOpenItemChange(null);
                  return;
                }
                onOpenItemChange(item.id);
              }}
            >
              <span className="item-slot__icon"><ItemIcon kind={kind} size={28} /></span>
              <span className="item-slot__short" aria-hidden="true">{ITEM_SHORT_NAMES[kind]}</span>
              <span className="visually-hidden">{description.name}{selected ? "（選択中）" : ""}の詳細</span>
            </button>
            <span id={descriptionId} className="visually-hidden">
              {parts.map((part: DescriptionPart) => withSentenceEnd(part.text)).join(" ")}
            </span>
            {tooltipVisible && <div ref={tooltipElementRef} className="item-slot__tooltip" role="tooltip" aria-hidden="true">
              <p className="item-slot__tooltip-name">{description.name}</p>
              {parts.map((part: DescriptionPart) => <p
                key={part.className}
                className={`item-slot__tooltip-${part.className}${part.caution ? " item-slot__tooltip-hint--caution" : ""}`}
              >{withSentenceEnd(part.text)}</p>)}
            </div>}
          </li>;
        })}
      </ol>
      <InventoryItemPopover
        generatedId={generatedId} openItemId={openItemId} view={view}
        anchor={openItemId ? openerRefs.current.get(openItemId) ?? null : null}
        lastKnownItem={openItemId ? lastOpenItemRef.current : null}
        onUse={onUse}
        onClose={() => {
          if (openItemId) {
            closedItemIdRef.current = openItemId;
            window.setTimeout(() => { if (closedItemIdRef.current === openItemId) closedItemIdRef.current = null; }, 0);
          }
          onOpenItemChange(null);
        }}
      />
    </section>
  );
}
