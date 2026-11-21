// @vitest-environment jsdom
import { StrictMode, createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RulesDialog, type RulesDialogProps } from "../../src/features/game/components/RulesDialog";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { buildRulesGuide } from "../../src/features/game/rulesGuide";
import { useGameShortcuts } from "../../src/features/game/useGameShortcuts";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

const SUBTITLE = "ゲームの進行はそのままです。閉じると続きから遊べます。";
const model = buildRulesGuide(ITEM_GAME_CONFIG);
const mounts: MountedReact[] = [];
const extraNodes: HTMLElement[] = [];

beforeAll(() => {
  // Native modal stub: `open` stays until close() or unmount, like the browser's.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
});

afterEach(() => {
  mounts.splice(0).forEach((mount) => mount.cleanup());
  extraNodes.splice(0).forEach((node) => node.remove());
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.restoreAllMocks();
});

function addButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  document.body.append(button);
  extraNodes.push(button);
  return button;
}

function wrapOpener(opener: HTMLElement): HTMLElement {
  const box = document.createElement("div");
  opener.before(box);
  box.append(opener);
  extraNodes.push(box);
  return box;
}

function mountDialog(overrides: Partial<RulesDialogProps> = {}, strict = false): MountedReact {
  const props: RulesDialogProps = {
    model, returnFocus: null, getFallbackFocus: () => null, onClose: vi.fn(), ...overrides,
  };
  const dialog = createElement(RulesDialog, props);
  const mount = mountReact(strict ? createElement(StrictMode, null, dialog) : dialog);
  mounts.push(mount);
  return mount;
}

/** Unmounts and waits for the microtask that restores focus. */
async function unmount(mount: MountedReact): Promise<void> {
  mounts.splice(mounts.indexOf(mount), 1);
  mount.cleanup();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function dialogOf(mount: MountedReact): HTMLDialogElement {
  return mount.container.querySelector("dialog")!;
}

describe("RulesDialog", () => {
  it("opens natively and focuses the guide title", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const mount = mountDialog();

    const dialog = dialogOf(mount);
    const title = dialog.querySelector("h1")!;
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(document.activeElement).toBe(title);
    expect(dialog.querySelector(".rules-dialog__subtitle")?.textContent).toBe(SUBTITLE);
    expect(dialog.querySelectorAll("h1")).toHaveLength(1);
    expect(dialog.querySelectorAll("section.rules-guide__section")).toHaveLength(5);
  });

  it("focuses and scrolls to a requested section", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const mount = mountDialog({ sectionId: "items" });

    const section = dialogOf(mount).querySelector("section.rules-guide__section[id$='-items']");
    expect(document.activeElement).toBe(section?.querySelector("h2"));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(section);
  });

  it("forwards the in-game coach replay action and render-time guard", () => {
    const onReplayCoach = vi.fn();
    const mount = mountDialog({ onReplayCoach, canReplayCoach: true });
    const replay = [...dialogOf(mount).querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "最初のガイドをもう一度見る");

    expect(replay).toBeDefined();
    expect(replay?.disabled).toBe(false);
    dispatchReactEvent(replay!, new MouseEvent("click", { bubbles: true }));
    expect(onReplayCoach).toHaveBeenCalledTimes(1);

    const disabledMount = mountDialog({ onReplayCoach, canReplayCoach: false });
    const disabledReplay = [...dialogOf(disabledMount).querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "最初のガイドをもう一度見る");
    expect(disabledReplay?.disabled).toBe(true);
  });

  it("cancel requests React closure without closing early", () => {
    const onClose = vi.fn();
    const close = vi.spyOn(HTMLDialogElement.prototype, "close");
    const dialog = dialogOf(mountDialog({ onClose }));

    const cancel = new Event("cancel", { cancelable: true });
    dispatchReactEvent(dialog, cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("restores a connected visible enabled opener", async () => {
    const opener = addButton("opener");
    const fallback = addButton("fallback");
    const mount = mountDialog({ returnFocus: opener, getFallbackFocus: () => fallback });

    await unmount(mount);

    expect(document.activeElement).toBe(opener);
  });

  describe("rejects an unusable opener and uses the fallback", () => {
    const cases: readonly [string, (opener: HTMLButtonElement) => void][] = [
      ["hidden ancestor", (opener) => wrapOpener(opener).setAttribute("hidden", "")],
      ["inert ancestor", (opener) => wrapOpener(opener).setAttribute("inert", "")],
      ["display none", (opener) => { opener.style.display = "none"; }],
      ["visibility hidden", (opener) => { opener.style.visibility = "hidden"; }],
      ["disabled", (opener) => { opener.disabled = true; }],
      ["aria-disabled", (opener) => { opener.setAttribute("aria-disabled", "true"); }],
      ["disconnected", (opener) => { opener.remove(); }],
    ];
    it.each(cases)("%s", async (_name, breakOpener) => {
      const opener = addButton("opener");
      const fallback = addButton("fallback");
      const mount = mountDialog({ returnFocus: opener, getFallbackFocus: () => fallback });
      breakOpener(opener);

      await unmount(mount);

      expect(document.activeElement).toBe(fallback);
    });
  });

  it("uses the fallback when the opener disappears", async () => {
    const fallback = addButton("fallback");
    const getFallbackFocus = vi.fn(() => fallback);
    const mount = mountDialog({ returnFocus: null, getFallbackFocus });

    await unmount(mount);

    expect(getFallbackFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(fallback);
  });

  it("accepts an aria-disabled fallback", async () => {
    const fallback = addButton("fallback");
    fallback.setAttribute("aria-disabled", "true");
    const mount = mountDialog({ getFallbackFocus: () => fallback });

    await unmount(mount);

    expect(document.activeElement).toBe(fallback);
  });

  it("uses the fallback when the opener is hidden in the same commit as the unmount", async () => {
    const fallback = addButton("fallback");
    function Host(): React.JSX.Element {
      const [open, setOpen] = useState(true);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return createElement("div", null,
        createElement("div", { hidden: !open }, createElement("button", { ref: setOpener }, "opener")),
        open ? createElement(RulesDialog, { model, returnFocus: opener, getFallbackFocus: () => fallback, onClose: () => setOpen(false) }) : null);
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);

    dispatchReactEvent(dialogOf(mount), new Event("cancel", { cancelable: true }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(mount.container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(fallback);
  });

  it("leaves focus alone when another modal is open at restore time", async () => {
    const opener = addButton("opener");
    const fallback = addButton("fallback");
    const mount = mountDialog({ returnFocus: opener, getFallbackFocus: () => fallback });
    const other = document.createElement("dialog");
    other.setAttribute("open", "");
    document.body.append(other);
    extraNodes.push(other);

    await unmount(mount);

    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement).not.toBe(fallback);
  });

  it("closing Escape does not reach the game shortcut handler", () => {
    const onSkip = vi.fn();
    function Host(): React.JSX.Element | null {
      const [open, setOpen] = useState(true);
      useGameShortcuts(
        { canRoll: false, canSkip: true, surfaceOpen: false, itemDialogOpen: false },
        { onRoll: vi.fn(), onSkip },
      );
      return open ? createElement(RulesDialog, { model, returnFocus: null, getFallbackFocus: () => null, onClose: () => setOpen(false) }) : null;
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);
    const dialog = dialogOf(mount);

    const keydown = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    dispatchReactEvent(document.activeElement!, keydown);
    expect(onSkip).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);

    dispatchReactEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onSkip).not.toHaveBeenCalled();
    expect(mount.container.querySelector("dialog")).toBeNull();
  });

  it("closes only when the press and the click both hit the backdrop", () => {
    const onClose = vi.fn();
    const dialog = dialogOf(mountDialog({ onClose }));
    const body = dialog.querySelector(".rules-dialog__body")!;
    const press = (target: Element): void => dispatchReactEvent(target, new Event("pointerdown", { bubbles: true }));
    const click = (target: Element): void => dispatchReactEvent(target, new MouseEvent("click", { bubbles: true }));

    press(body);
    click(dialog);
    click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    press(dialog);
    click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the close button and ignores clicks inside the dialog", () => {
    const onClose = vi.fn();
    const dialog = dialogOf(mountDialog({ onClose }));

    dispatchReactEvent(dialog.querySelector("h1")!, new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    dispatchReactEvent(dialog.querySelector(".rules-dialog__close")!, new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("makes the body keyboard scrollable without taking initial focus", () => {
    const dialog = dialogOf(mountDialog());

    expect(dialog.querySelector(".rules-dialog__body")?.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(dialog.querySelector("h1"));
  });

  it("StrictMode replay keeps the dialog open and focused", async () => {
    const opener = addButton("opener");
    const onClose = vi.fn();
    const mount = mountDialog({ returnFocus: opener, onClose }, true);

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const dialog = dialogOf(mount);
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("h1"));
    expect(document.activeElement).not.toBe(opener);
    expect(onClose).not.toHaveBeenCalled();
  });
});
