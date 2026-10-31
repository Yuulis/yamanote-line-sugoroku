import { useEffect, useId, useRef, useState } from "react";
import type { ItemKind } from "../../../types/network";
import type { ItemSessionView } from "../itemSession";
import {
  ITEM_DESCRIPTIONS, ITEM_REPLACEMENT_NOTE, ITEM_SHORT_NAMES, itemHint, itemTiming, itemTone,
  itemUnavailableText,
} from "../itemPresentation";
import { ItemIcon } from "./ItemIcon";
import { modalDialogOpen } from "./GameMenu";

const INVENTORY_SLOT_COUNT: number = 3;

interface InventoryPanelProps {
  view: ItemSessionView;
  onSelect: (instanceId: string, kind: ItemKind) => void;
}

interface DescriptionPart {
  readonly className: string;
  readonly text: string;
  readonly caution?: boolean;
}

function withSentenceEnd(text: string): string {
  return text.endsWith("。") ? text : `${text}。`;
}

function pointInside(element: Element | null, x: number, y: number): boolean {
  if (!element) return false;
  const rect: DOMRect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function InventoryPanel({ view, onSelect }: InventoryPanelProps): React.JSX.Element {
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
  const inventoryKey: string = view.inventory.map((item) => item.id).join(" ");
  // An item used or discarded while its tooltip was shown shows nothing and must not keep owning Escape.
  const shownItemId: string | null = tooltipItemId !== null && view.inventory.some((item) => item.id === tooltipItemId)
    ? tooltipItemId
    : null;

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
      event.preventDefault();
      setDismissedItemId(shownItemId);
      setTooltipItemId(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [shownItemId]);

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
          const isDisabled: boolean = passive || !action?.usable;
          const slotClass: string = `item-slot item-slot--${itemTone(kind)}${selected ? " item-slot--selected" : ""}${passive ? " item-slot--passive" : ""}${!action?.usable && !passive ? " item-slot--unavailable" : ""}`;
          const tooltipVisible: boolean = shownItemId === item.id;

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
              aria-describedby={descriptionId}
              {...(!passive ? { "aria-pressed": selected } : {})}
              {...(isDisabled ? { "aria-disabled": "true" } : {})}
              onPointerDown={() => { pointerDownRef.current = true; }}
              onFocus={() => {
                focusedItemRef.current = item.id;
                if (!pointerDownRef.current) showTooltip(item.id);
                pointerDownRef.current = false;
              }}
              onBlur={() => {
                focusedItemRef.current = null;
                if (hoveredItemRef.current !== item.id) hideTooltip(item.id);
                clearDismissalWhenInactive(item.id);
              }}
              onClick={() => {
                setDismissedItemId(item.id);
                hideTooltip(item.id);
                pointerDownRef.current = false;
                if (!isDisabled) onSelect(item.id, kind);
              }}
            >
              <span className="item-slot__icon"><ItemIcon kind={kind} size={28} /></span>
              <span className="item-slot__short" aria-hidden="true">{ITEM_SHORT_NAMES[kind]}</span>
              <span className="visually-hidden">{description.name}{passive ? "" : `：${selected ? "選択中・変更する" : "このアイテムを使う"}`}</span>
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
    </section>
  );
}
