import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { HarmfulItemKind, ItemPolicy } from "../../../types/network";
import type { EffectChipModel } from "../hudPresentation";
import { ITEM_DESCRIPTIONS, itemEffectText, itemTiming } from "../itemPresentation";
import { modalDialogOpen } from "./GameMenu";
import { ItemCard, ItemCardPopover } from "./ItemCard";
import { ItemIcon } from "./ItemIcon";
import { LineBadge } from "./LineBadge";

const TOOLTIP_GAP: number = 6;
const TOOLTIP_VIEWPORT_MARGIN: number = 8;

export interface EffectChipsProps {
  models: readonly EffectChipModel[];
  /** When given, card and tooltip numbers use this policy's turn counts instead of the production defaults. */
  policy?: ItemPolicy;
}

interface TooltipPosition { top: number; left: number }

function effectDescription(kind: HarmfulItemKind, policy: ItemPolicy | undefined): string {
  return policy ? itemEffectText(kind, policy) : ITEM_DESCRIPTIONS[kind].effect;
}

function pointInside(element: Element | null | undefined, x: number, y: number): boolean {
  if (!element) return false;
  const rect: DOMRect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The strip between a chip and its tooltip, so crossing the gap does not dismiss the tooltip (WCAG 1.4.13). */
function pointInBridge(chip: Element | null | undefined, tooltip: Element | null | undefined, x: number, y: number): boolean {
  if (!chip || !tooltip) return false;
  const chipRect: DOMRect = chip.getBoundingClientRect();
  const tipRect: DOMRect = tooltip.getBoundingClientRect();
  if (x < Math.max(chipRect.left, tipRect.left) || x > Math.min(chipRect.right, tipRect.right)) return false;
  return y >= Math.min(chipRect.bottom, tipRect.bottom) && y <= Math.max(chipRect.top, tipRect.top);
}

function placeTooltip(chip: DOMRect, tooltip: DOMRect, viewport: { width: number; height: number }): TooltipPosition {
  const aboveTop: number = chip.top - TOOLTIP_GAP - tooltip.height;
  const top: number = aboveTop >= TOOLTIP_VIEWPORT_MARGIN ? aboveTop : chip.bottom + TOOLTIP_GAP;
  const maxLeft: number = viewport.width - tooltip.width - TOOLTIP_VIEWPORT_MARGIN;
  const left: number = Math.min(
    Math.max(chip.left + chip.width / 2 - tooltip.width / 2, TOOLTIP_VIEWPORT_MARGIN),
    Math.max(TOOLTIP_VIEWPORT_MARGIN, maxLeft),
  );
  return { top: Math.round(top), left: Math.round(left) };
}

export function EffectChips({ models, policy }: EffectChipsProps): React.JSX.Element | null {
  const generatedId: string = useId();
  // State follows the chip's identity key, never its position, so a chip that disappears shows nothing
  // and nothing reappears for the chip that takes its place without a new hover or focus.
  const [tooltipKey, setTooltipKey] = useState<string | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0 });
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const focusedKeyRef = useRef<string | null>(null);
  const pointerDownRef = useRef<boolean>(false);
  const openKeyRef = useRef<string | null>(openKey);
  const closedKeyRef = useRef<string | null>(null);
  const pressRef = useRef<string | null>(null);
  const suppressFocusTooltipRef = useRef<string | null>(null);
  const lastOpenModelRef = useRef<EffectChipModel | null>(null);
  openKeyRef.current = openKey;

  const modelsKey: string = models.map((model) => model.key).join(" ");
  const present = (key: string | null): boolean => key !== null && models.some((model) => model.key === key);
  const shownKey: string | null = openKey === null && present(tooltipKey) ? tooltipKey : null;
  const openModel: EffectChipModel | null = openKey === null ? null
    : models.find((model) => model.key === openKey) ?? (lastOpenModelRef.current?.key === openKey ? lastOpenModelRef.current : null);
  if (openKey !== null) {
    const live: EffectChipModel | undefined = models.find((model) => model.key === openKey);
    if (live) lastOpenModelRef.current = live;
  }
  const shownModel: EffectChipModel | undefined = shownKey === null ? undefined : models.find((model) => model.key === shownKey);

  const hideTooltip = (key: string): void => {
    setTooltipKey((current: string | null) => current === key ? null : current);
  };
  const clearDismissalWhenInactive = (key: string): void => {
    if (hoveredKeyRef.current === key || focusedKeyRef.current === key) return;
    setDismissedKey((current: string | null) => current === key ? null : current);
  };
  const showTooltip = (key: string): void => {
    if (dismissedKey === key) return;
    setTooltipKey(key);
  };
  const leaveChip = (key: string): void => {
    hoveredKeyRef.current = null;
    if (focusedKeyRef.current !== key) hideTooltip(key);
    clearDismissalWhenInactive(key);
  };
  const closeCard = (): void => {
    if (openKey !== null) {
      const closing: string = openKey;
      closedKeyRef.current = closing;
      window.setTimeout(() => { if (closedKeyRef.current === closing) closedKeyRef.current = null; }, 0);
    }
    setOpenKey(null);
  };

  useEffect(() => {
    if (!present(hoveredKeyRef.current)) hoveredKeyRef.current = null;
    if (!present(focusedKeyRef.current)) focusedKeyRef.current = null;
    setTooltipKey((current: string | null) => present(current) ? current : null);
    setDismissedKey((current: string | null) => present(current) ? current : null);
  }, [modelsKey]);

  // Escape closes the tooltip only; an open card owns Escape itself, and so does an open native dialog.
  useEffect(() => {
    if (shownKey === null) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || modalDialogOpen()) return;
      if (openKeyRef.current !== null) return;
      event.preventDefault();
      setDismissedKey(shownKey);
      setTooltipKey(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [shownKey]);

  useEffect(() => {
    if (openKey !== null) {
      suppressFocusTooltipRef.current = openKey;
      setTooltipKey((current: string | null) => current === openKey ? null : current);
      setDismissedKey(openKey);
      return;
    }
    const suppressed: string | null = suppressFocusTooltipRef.current;
    suppressFocusTooltipRef.current = null;
    if (suppressed && hoveredKeyRef.current !== suppressed && focusedKeyRef.current !== suppressed) {
      setDismissedKey((current: string | null) => current === suppressed ? null : current);
    }
  }, [openKey]);

  // The tooltip takes no pointer events (it must never block chips under it), so "hovering the tooltip" is
  // tracked by position: it stays while the pointer is over the chip, the tooltip, or the gap between them.
  useEffect(() => {
    if (shownKey === null) return;
    const handlePointerMove = (event: PointerEvent): void => {
      if (hoveredKeyRef.current !== shownKey) return;
      const chip: HTMLElement | undefined = chipRefs.current.get(shownKey);
      if (pointInside(chip, event.clientX, event.clientY)) return;
      if (pointInside(tooltipRef.current, event.clientX, event.clientY)) return;
      if (pointInBridge(chip, tooltipRef.current, event.clientX, event.clientY)) return;
      leaveChip(shownKey);
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [shownKey]);

  // The row scrolls and the tooltip lives outside it, so follow the chip on every scroll and resize.
  useLayoutEffect(() => {
    if (shownKey === null) return;
    const measure = (): void => {
      const chip: HTMLElement | undefined = chipRefs.current.get(shownKey);
      const tooltip: HTMLDivElement | null = tooltipRef.current;
      if (!chip || !tooltip) return;
      const next: TooltipPosition = placeTooltip(
        chip.getBoundingClientRect(), tooltip.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPosition((previous: TooltipPosition) => previous.top === next.top && previous.left === next.left ? previous : next);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [shownKey]);

  if (models.length === 0) return null;
  const cardHeadingId: string = `effect-chip-card-heading-${generatedId}`;
  const cardId: string = `effect-chip-card-${generatedId}`;
  const tooltipId: string = `effect-chip-tooltip-${generatedId}`;
  return (
    <>
      {/* tabIndex -1: Firefox makes an overflowing scroller a tab stop even with focusable children;
          each chip is its own stop and scrolls itself into view on keyboard focus. */}
      <div className="effect-chips" aria-label="続いている効果" tabIndex={-1}>
        {models.map((model) => <button
          type="button"
          className="effect-chip"
          key={model.key}
          aria-haspopup="dialog"
          aria-expanded={openKey === model.key}
          aria-controls={cardId}
          aria-describedby={shownKey === model.key ? tooltipId : undefined}
          ref={(element: HTMLButtonElement | null) => {
            if (element) chipRefs.current.set(model.key, element);
            else chipRefs.current.delete(model.key);
          }}
          onPointerEnter={(event: React.PointerEvent<HTMLButtonElement>) => {
            if (event.pointerType === "touch") return;
            hoveredKeyRef.current = model.key;
            showTooltip(model.key);
          }}
          onPointerLeave={(event: React.PointerEvent<HTMLButtonElement>) => {
            if (shownKey === model.key && (pointInside(tooltipRef.current, event.clientX, event.clientY)
              || pointInBridge(event.currentTarget, tooltipRef.current, event.clientX, event.clientY))) return;
            leaveChip(model.key);
          }}
          onPointerDownCapture={() => {
            pointerDownRef.current = true;
            pressRef.current = openKeyRef.current === model.key || closedKeyRef.current === model.key ? model.key : null;
          }}
          onFocus={(event: React.FocusEvent<HTMLButtonElement>) => {
            focusedKeyRef.current = model.key;
            // Keyboard focus reveals a chip the row clips (browsers leave a partly visible one where it is).
            // Never on pointer focus: scrolling under the pointer would swallow the click.
            if (!pointerDownRef.current) event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            if (suppressFocusTooltipRef.current === model.key) suppressFocusTooltipRef.current = null;
            else if (!pointerDownRef.current) showTooltip(model.key);
            pointerDownRef.current = false;
          }}
          onBlur={() => {
            focusedKeyRef.current = null;
            if (hoveredKeyRef.current !== model.key) hideTooltip(model.key);
            clearDismissalWhenInactive(model.key);
          }}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            setDismissedKey(model.key);
            hideTooltip(model.key);
            pointerDownRef.current = false;
            // The card's light dismissal already closed it on pointer down; that press must not reopen it.
            const reclick: boolean = event.detail > 0 && pressRef.current === model.key;
            pressRef.current = null;
            if (reclick || openKeyRef.current === model.key) {
              if (openKeyRef.current === model.key) setOpenKey(null);
              return;
            }
            setOpenKey(model.key);
          }}
        >
          <ItemIcon kind={model.kind} size={20} />
          <span className="effect-chip__label" aria-hidden="true">{model.label}</span>
          {model.lineBadge && <LineBadge model={model.lineBadge} size="sm" showName={false} />}
          {model.countdown && <span className="effect-chip__countdown" aria-hidden="true">{model.countdown}</span>}
          <span className="visually-hidden">{model.text}</span>
        </button>)}
      </div>
      {shownModel && <div
        ref={tooltipRef}
        id={tooltipId}
        className="effect-chip__tooltip"
        role="tooltip"
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
      >
        <p className="effect-chip__tooltip-name">{ITEM_DESCRIPTIONS[shownModel.kind].name}</p>
        <p>{effectDescription(shownModel.kind, policy)}</p>
        <p className="effect-chip__tooltip-timing">{itemTiming(shownModel.kind)}</p>
        {shownModel.statusLine && <p className="effect-chip__tooltip-status">{shownModel.statusLine}</p>}
      </div>}
      <ItemCardPopover
        id={cardId}
        open={openModel !== null}
        anchor={openKey === null ? null : chipRefs.current.get(openKey) ?? null}
        labelledBy={cardHeadingId}
        onClose={closeCard}
      >{(closeButton) => openModel && <ItemCard
        kind={openModel.kind} headingId={cardHeadingId} policy={policy} statusLine={openModel.statusLine}
        footer={closeButton} />}
      </ItemCardPopover>
    </>
  );
}
