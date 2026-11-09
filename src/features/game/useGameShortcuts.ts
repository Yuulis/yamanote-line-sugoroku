import { useEffect, useRef } from "react";
import { modalDialogOpen } from "./components/GameMenu";

export interface GameShortcutContext {
  readonly canRoll: boolean;
  readonly canSkip: boolean;
  readonly surfaceOpen: boolean;
  readonly itemDialogOpen: boolean;
}

interface GameShortcutHandlers {
  readonly onRoll: () => void;
  readonly onSkip: () => void;
}

const INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "grid", "gridcell", "link", "listbox", "menu", "menubar",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "radiogroup", "scrollbar",
  "searchbox", "slider", "spinbutton", "switch", "tab", "tablist", "textbox", "tree", "treegrid", "treeitem",
]);
const EDITABLE_ROLES = new Set(["combobox", "searchbox", "spinbutton", "textbox"]);
const IME_COMPOSITION_KEY_CODE = 229;

function eventElement(event: KeyboardEvent): Element | null {
  if (event.target instanceof Element) return event.target;
  if (event.target instanceof Node) return event.target.parentElement;
  return document.activeElement;
}

function hasRole(element: Element, roles: ReadonlySet<string>): boolean {
  return (element.getAttribute("role") ?? "").split(/\s+/).some((role) => roles.has(role));
}

function editableTarget(target: Element | null): boolean {
  const editable = target?.closest("[contenteditable]");
  if (editable && editable.getAttribute("contenteditable")?.toLowerCase() !== "false") return true;
  for (let element = target; element; element = element.parentElement) {
    if (element.matches("input, select, textarea") || hasRole(element, EDITABLE_ROLES)) return true;
  }
  return false;
}

function interactiveTarget(target: Element | null): boolean {
  if (editableTarget(target)) return true;
  for (let element = target; element; element = element.parentElement) {
    if (element.matches("button, a[href], summary") || hasRole(element, INTERACTIVE_ROLES)) return true;
    const tabIndex = element.getAttribute("tabindex");
    if (tabIndex !== null && Number.parseInt(tabIndex, 10) >= 0) return true;
  }
  return false;
}

/** Select an action without handling the event; disclosures and native controls own their keys first. */
export function gameShortcutAction(event: KeyboardEvent, context: GameShortcutContext): "roll" | "skip" | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === IME_COMPOSITION_KEY_CODE || event.repeat
    || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
    || context.surfaceOpen || context.itemDialogOpen || modalDialogOpen()) return null;

  const target = eventElement(event);
  if (event.key === " " || event.key === "Enter") {
    return context.canRoll && !interactiveTarget(target) ? "roll" : null;
  }
  if (event.key === "s" || event.key === "S" || event.key === "Escape") {
    return context.canSkip && !editableTarget(target) ? "skip" : null;
  }
  return null;
}

/** Bubble phase preserves capture-phase menu/log Escape and native dialog handling. */
export function useGameShortcuts(context: GameShortcutContext, handlers: GameShortcutHandlers): void {
  const latest = useRef({ context, handlers });
  latest.current = { context, handlers };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = gameShortcutAction(event, latest.current.context);
      if (!action) return;
      if (event.key === " ") event.preventDefault();
      if (action === "roll") latest.current.handlers.onRoll();
      else latest.current.handlers.onSkip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
