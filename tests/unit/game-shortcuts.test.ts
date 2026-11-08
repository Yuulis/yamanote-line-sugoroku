// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gameShortcutAction, useGameShortcuts, type GameShortcutContext,
} from "../../src/features/game/useGameShortcuts";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const IDLE: GameShortcutContext = { canRoll: true, canSkip: false, surfaceOpen: false, itemDialogOpen: false };
const PRESENTING: GameShortcutContext = { ...IDLE, canRoll: false, canSkip: true };
let mounted: MountedReact | undefined;
let target: HTMLElement | undefined;

function element(markup = '<h1 tabindex="-1">Game</h1>'): HTMLElement {
  target = document.createElement("div");
  target.innerHTML = markup;
  document.body.append(target);
  return target.querySelector<HTMLElement>("[data-target]") ?? target.firstElementChild as HTMLElement;
}

function keyEvent(key: string, node: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { node.dispatchEvent(event); });
  return event;
}

function Harness({ context, onRoll, onSkip }: {
  context: GameShortcutContext; onRoll: () => void; onSkip: () => void;
}): null {
  useGameShortcuts(context, { onRoll, onSkip });
  return null;
}

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  target?.remove();
  target = undefined;
});

describe("gameShortcutAction", () => {
  it.each([" ", "Enter"])("rolls with %j from a heading or body only when permitted", (key) => {
    const heading = element();
    for (const node of [heading, document.body]) {
      const event = keyEvent(key, node);
      expect(gameShortcutAction(event, IDLE)).toBe("roll");
      expect(gameShortcutAction(event, PRESENTING)).toBeNull();
    }
  });

  it.each([
    '<button><span data-target>Dice</span></button>', '<a href="/"><span data-target>Link</span></a>',
    '<input>', '<select><option>One</option></select>', '<textarea></textarea>',
    '<summary><span data-target>Details</span></summary>',
    '<div contenteditable="true"><span data-target>Edit</span></div>',
    '<div contenteditable=""><span data-target>Edit</span></div>',
    '<div contenteditable="plaintext-only"><span data-target>Edit</span></div>',
    '<div tabindex="0"><span data-target>Tab stop</span></div>', '<div tabindex="2">Tab stop</div>',
    ...["button", "link", "checkbox", "combobox", "gridcell", "listbox", "menu", "menubar", "menuitem",
      "menuitemcheckbox", "menuitemradio", "option", "radio", "radiogroup", "scrollbar", "searchbox",
      "slider", "spinbutton", "switch", "tab", "tablist", "textbox", "tree", "treeitem", "grid", "treegrid"]
      .map((role) => `<div role="${role}"><span data-target>Control</span></div>`),
  ])("rejects roll from an interactive target or ancestor: %s", (markup) => {
    const node = element(markup);
    for (const key of [" ", "Enter"]) expect(gameShortcutAction(keyEvent(key, node), IDLE)).toBeNull();
  });

  it("allows ordinary text, a link without href and contenteditable=false", () => {
    const node = element('<a contenteditable="false"><span data-target>Text</span></a>');
    expect(gameShortcutAction(keyEvent("Enter", node), IDLE)).toBe("roll");
  });

  it.each(["s", "S", "Escape"])("skips with %s only during a presentation, including from buttons", (key) => {
    const button = element("<button>Dice</button>");
    for (const node of [button, document.body]) {
      const event = keyEvent(key, node);
      expect(gameShortcutAction(event, PRESENTING)).toBe("skip");
      expect(gameShortcutAction(event, IDLE)).toBeNull();
    }
  });

  it.each(['<input>', '<textarea></textarea>', '<select></select>',
    '<div contenteditable="true"><span data-target>Edit</span></div>',
    '<div role="textbox"><span data-target>Edit</span></div>', '<div role="searchbox">Search</div>',
    '<div role="combobox">Choose</div>', '<div role="spinbutton">Number</div>',
  ])("does not skip from editable targets: %s", (markup) => {
    const node = element(markup);
    for (const key of ["s", "S", "Escape"]) expect(gameShortcutAction(keyEvent(key, node), PRESENTING)).toBeNull();
  });

  it.each(["Space", "Spacebar", "Ｓ", "ｓ", "a"])("rejects other semantic keys: %s", (key) => {
    expect(gameShortcutAction(keyEvent(key, document.body, { code: "KeyS" }), { ...IDLE, canSkip: true })).toBeNull();
  });

  it.each<KeyboardEventInit>([
    { isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true },
    { altKey: true }, { metaKey: true }, { shiftKey: true },
  ])("rejects composing, repeating and modified events: %j", (init) => {
    for (const key of [" ", "Enter", "s", "Escape"]) {
      expect(gameShortcutAction(keyEvent(key, document.body, init), { ...IDLE, canSkip: true })).toBeNull();
    }
  });

  it("ignores already handled events without changing their default state", () => {
    const event = keyEvent("Enter");
    event.preventDefault();
    expect(gameShortcutAction(event, IDLE)).toBeNull();
    const untouched = keyEvent(" ");
    expect(gameShortcutAction(untouched, IDLE)).toBe("roll");
    expect(untouched.defaultPrevented).toBe(false);
  });

  it.each(["surfaceOpen", "itemDialogOpen"] as const)("yields all keys to %s", (flag) => {
    for (const key of [" ", "Enter", "s", "Escape"]) {
      expect(gameShortcutAction(keyEvent(key), { ...IDLE, canSkip: true, [flag]: true })).toBeNull();
    }
  });

  it("yields to native open dialogs and resumes after they close", () => {
    const dialog = element("<dialog open></dialog>");
    for (const key of [" ", "Enter", "s", "Escape"]) {
      expect(gameShortcutAction(keyEvent(key), { ...IDLE, canSkip: true })).toBeNull();
    }
    dialog.removeAttribute("open");
    expect(gameShortcutAction(keyEvent("Enter"), IDLE)).toBe("roll");
  });
});

describe.each([false, true])("useGameShortcuts (StrictMode: %s)", (strict) => {
  function render(context: GameShortcutContext, onRoll: () => void, onSkip: () => void): void {
    const node = createElement(Harness, { context, onRoll, onSkip });
    const wrapped = strict ? createElement(StrictMode, null, node) : node;
    if (mounted) act(() => mounted!.root.render(wrapped));
    else mounted = mountReact(wrapped);
  }

  it("uses the latest handlers and permissions and removes its listener on unmount", () => {
    const onRoll = vi.fn();
    const onSkip = vi.fn();
    const latestRoll = vi.fn();
    const latestSkip = vi.fn();
    render(IDLE, onRoll, onSkip);
    const heading = element();
    heading.focus();
    expect(keyEvent(" ", heading).defaultPrevented).toBe(true);
    keyEvent("Enter");
    expect(onRoll).toHaveBeenCalledTimes(2);
    render(PRESENTING, latestRoll, latestSkip);
    expect(keyEvent("Enter").defaultPrevented).toBe(false);
    expect(keyEvent("s").defaultPrevented).toBe(false);
    expect(keyEvent("Escape").defaultPrevented).toBe(false);
    expect(latestSkip).toHaveBeenCalledTimes(2);
    expect(onSkip).not.toHaveBeenCalled();
    expect(latestRoll).not.toHaveBeenCalled();
    render(IDLE, latestRoll, latestSkip);
    keyEvent("Enter");
    expect(latestRoll).toHaveBeenCalledOnce();
    expect(onRoll).toHaveBeenCalledTimes(2);
    mounted!.cleanup();
    mounted = undefined;
    expect(keyEvent(" ").defaultPrevented).toBe(false);
    keyEvent("s");
    expect(latestRoll).toHaveBeenCalledOnce();
    expect(latestSkip).toHaveBeenCalledTimes(2);
  });

  it("does not double-activate a button and leaves native activation available", () => {
    const onRoll = vi.fn();
    render(IDLE, onRoll, vi.fn());
    const button = element("<button><span data-target>Dice</span></button>").closest("button")!;
    button.addEventListener("click", onRoll);
    for (const key of [" ", "Enter"]) {
      expect(keyEvent(key, button.firstChild!).defaultPrevented).toBe(false);
      // jsdom does not synthesize the browser's native key activation.
      act(() => button.click());
    }
    expect(onRoll).toHaveBeenCalledTimes(2);
  });

  it("lets capture-phase owners handle Escape before the window bubble listener", () => {
    const onSkip = vi.fn();
    render(PRESENTING, vi.fn(), onSkip);
    const owner = (event: KeyboardEvent): void => { event.preventDefault(); };
    window.addEventListener("keydown", owner, true);
    try {
      keyEvent("Escape");
      expect(onSkip).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", owner, true); }
    keyEvent("Escape");
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("yields to newly open surfaces, dialogs and ignored events without preventing them", () => {
    const onRoll = vi.fn();
    const onSkip = vi.fn();
    for (const context of [{ ...IDLE, surfaceOpen: true }, { ...PRESENTING, itemDialogOpen: true }]) {
      render(context, onRoll, onSkip);
      for (const key of [" ", "Enter", "s", "Escape"]) expect(keyEvent(key).defaultPrevented).toBe(false);
    }
    render({ ...IDLE, canSkip: true }, onRoll, onSkip);
    keyEvent(" ", document.body, { repeat: true });
    keyEvent("s", document.body, { isComposing: true });
    const dialog = element("<dialog open></dialog>");
    expect(keyEvent(" ").defaultPrevented).toBe(false);
    dialog.removeAttribute("open");
    expect(onRoll).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });
});
