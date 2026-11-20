// @vitest-environment jsdom
import { StrictMode, act, createElement, useRef, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildCoachSteps,
  COACH_VIEWPORT_MARGIN_PX,
  placeCoachBubble,
  type CoachRect,
  type CoachStepSequence,
} from "../../src/features/game/firstPlayGuide";
import { FirstPlayCoach, type FirstPlayCoachCloseReason, type FirstPlayCoachProps } from "../../src/features/game/components/FirstPlayCoach";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { useGameShortcuts } from "../../src/features/game/useGameShortcuts";
import { dispatchReactEvent, flushReact, mountReact, type MountedReact } from "./helpers/reactDom";

const steps: CoachStepSequence = buildCoachSteps({
  config: ITEM_GAME_CONFIG,
  targetName: "山手線",
  startName: "新橋",
});
const mounts: MountedReact[] = [];
const extraNodes: HTMLElement[] = [];
const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");

beforeAll(() => {
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
  if (visibilityStateDescriptor) {
    Object.defineProperty(Document.prototype, "visibilityState", visibilityStateDescriptor);
  } else {
    Reflect.deleteProperty(Document.prototype, "visibilityState");
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function rect(left: number, top: number, width: number, height: number): CoachRect {
  return { left, top, width, height };
}

function addButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  document.body.append(button);
  extraNodes.push(button);
  return button;
}

function dialogOf(mount: MountedReact): HTMLDialogElement {
  return mount.container.querySelector("dialog.first-play-coach")!;
}

function mountCoach(overrides: Partial<FirstPlayCoachProps> = {}, strict = false): MountedReact {
  const props: FirstPlayCoachProps = {
    steps,
    targets: {},
    onClose: vi.fn(),
    onRestoreFocus: vi.fn(),
    ...overrides,
  };
  const coach = createElement(FirstPlayCoach, props);
  const mount = mountReact(strict ? createElement(StrictMode, null, coach) : coach);
  mounts.push(mount);
  return mount;
}

describe("placeCoachBubble", () => {
  const viewport = { width: 640, height: 480 };
  const bubble = { width: 180, height: 100 };

  it.each([
    ["above", rect(250, 400, 40, 40), "top"],
    ["below", rect(250, 20, 40, 40), "bottom"],
    ["left", rect(580, 220, 40, 40), "left"],
    ["right", rect(20, 220, 40, 40), "right"],
  ] as const)("places the bubble on the %s side when there is room", (_name, target, side) => {
    expect(placeCoachBubble(target, bubble, viewport)).toMatchObject({ side });
  });

  it("clamps the bubble inside a 320x568 viewport", () => {
    const placement = placeCoachBubble(rect(0, 0, 10, 10), { width: 288, height: 200 }, { width: 320, height: 568 });

    expect(placement.left).toBeGreaterThanOrEqual(COACH_VIEWPORT_MARGIN_PX);
    expect(placement.top).toBeGreaterThanOrEqual(COACH_VIEWPORT_MARGIN_PX);
    expect(placement.left + 288).toBeLessThanOrEqual(320 - COACH_VIEWPORT_MARGIN_PX);
    expect(placement.top + 200).toBeLessThanOrEqual(568 - COACH_VIEWPORT_MARGIN_PX);
  });

  it("clamps the bubble inside a short landscape viewport", () => {
    const placement = placeCoachBubble(rect(620, 330, 60, 40), { width: 360, height: 220 }, { width: 667, height: 375 });

    expect(placement.left).toBeGreaterThanOrEqual(COACH_VIEWPORT_MARGIN_PX);
    expect(placement.top).toBeGreaterThanOrEqual(COACH_VIEWPORT_MARGIN_PX);
    expect(placement.left + 360).toBeLessThanOrEqual(667 - COACH_VIEWPORT_MARGIN_PX);
    expect(placement.top + 220).toBeLessThanOrEqual(375 - COACH_VIEWPORT_MARGIN_PX);
  });

  it.each([
    ["missing", null],
    ["zero width", rect(100, 100, 0, 20)],
    ["zero height", rect(100, 100, 20, 0)],
  ] as const)("centres the bubble for a %s target", (_name, target) => {
    expect(placeCoachBubble(target, { width: 200, height: 120 }, { width: 640, height: 480 })).toEqual({
      left: 220,
      top: 180,
      side: "center",
    });
  });
});

describe("FirstPlayCoach", () => {
  it("navigates through dice, progress and map, then starts from the final step", () => {
    const onClose = vi.fn<(reason: FirstPlayCoachCloseReason) => void>();
    const mount = mountCoach({ onClose });
    const dialog = dialogOf(mount);

    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(steps[0].copy.text);
    expect(dialog.querySelector<HTMLButtonElement>("button" )?.disabled).toBe(true);
    dispatchReactEvent(dialog.querySelectorAll("button")[1]!, new MouseEvent("click", { bubbles: true }));
    expect(dialog.textContent).toContain(steps[1].copy.text);
    dispatchReactEvent(dialog.querySelectorAll("button")[0]!, new MouseEvent("click", { bubbles: true }));
    expect(dialog.textContent).toContain(steps[0].copy.text);
    dispatchReactEvent(dialog.querySelectorAll("button")[1]!, new MouseEvent("click", { bubbles: true }));
    dispatchReactEvent(dialog.querySelectorAll("button")[1]!, new MouseEvent("click", { bubbles: true }));

    expect(dialog.textContent).toContain(steps[2].copy.text);
    expect(dialog.querySelector("button[disabled]")).toBeNull();
    expect([...dialog.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["前へ", "はじめる", "とばす"]);
    dispatchReactEvent(dialog.querySelectorAll("button")[1]!, new MouseEvent("click", { bubbles: true }));

    expect(onClose).toHaveBeenCalledWith("complete");
  });

  it("allows skipping from any step", () => {
    const onClose = vi.fn<(reason: FirstPlayCoachCloseReason) => void>();
    const dialog = dialogOf(mountCoach({ onClose }));

    dispatchReactEvent(dialog.querySelectorAll("button")[2]!, new MouseEvent("click", { bubbles: true }));

    expect(onClose).toHaveBeenCalledWith("skip");
  });

  it("names the bubble from its visible step label and describes it with the body", () => {
    const dialog = dialogOf(mountCoach());
    const bubble = dialog.querySelector<HTMLElement>(".first-play-coach__bubble")!;
    const stepLabel = dialog.querySelector<HTMLElement>(".first-play-coach__step")!;
    const copy = dialog.querySelector<HTMLElement>(".first-play-coach__copy")!;

    expect(stepLabel.id).not.toBe("");
    expect(bubble.getAttribute("aria-labelledby")).toBe(stepLabel.id);
    expect(bubble.getAttribute("aria-describedby")).toBe(copy.id);
  });

  it("keeps Escape from closing, advancing or reaching the game skip shortcut", () => {
    const onClose = vi.fn<(reason: FirstPlayCoachCloseReason) => void>();
    const onSkip = vi.fn();
    function Host(): React.JSX.Element {
      useGameShortcuts(
        { canRoll: false, canSkip: true, surfaceOpen: false, itemDialogOpen: false },
        { onRoll: vi.fn(() => true), onSkip },
      );
      return createElement(FirstPlayCoach, { steps, targets: {}, onClose, onRestoreFocus: vi.fn() });
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);
    const dialog = dialogOf(mount);
    const keydown = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const windowKeydown = vi.fn();
    window.addEventListener("keydown", windowKeydown);
    dispatchReactEvent(dialog.querySelector(".first-play-coach__bubble")!, keydown);
    window.removeEventListener("keydown", windowKeydown);
    const cancel = new Event("cancel", { cancelable: true });
    dispatchReactEvent(dialog, cancel);

    expect(keydown.defaultPrevented).toBe(false);
    expect(windowKeydown).not.toHaveBeenCalled();
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(steps[0].copy.text);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("contains Tab and Shift+Tab within the coach controls", () => {
    const dialog = dialogOf(mountCoach());
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    const next = buttons[1]!;
    const skip = buttons[2]!;

    skip.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dispatchReactEvent(dialog, tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(next);

    const shiftTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    dispatchReactEvent(dialog, shiftTab);

    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(skip);
  });

  it("acknowledges the coach only while its native dialog is open and the document is visible", () => {
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, value: "hidden" });
    const onShown = vi.fn();
    const mount = mountCoach({ onShown });
    const dialog = dialogOf(mount);

    expect(dialog.open).toBe(true);
    expect(onShown).not.toHaveBeenCalled();

    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onShown).toHaveBeenCalledTimes(1);

    mount.cleanup();
    mounts.splice(mounts.indexOf(mount), 1);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it("focuses the bubble on open and lets the caller restore focus after close", async () => {
    const fallback = addButton("fallback");
    const onClose = vi.fn<(reason: FirstPlayCoachCloseReason) => void>();
    const onRestoreFocus = vi.fn(() => fallback.focus());
    function Host(): React.JSX.Element | null {
      const [open, setOpen] = useState(true);
      return open ? createElement(FirstPlayCoach, {
        steps,
        targets: {},
        onClose: (reason) => { onClose(reason); setOpen(false); },
        onRestoreFocus,
      }) : null;
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);
    const dialog = dialogOf(mount);

    expect(document.activeElement).toBe(dialog.querySelector(".first-play-coach__bubble"));
    dispatchReactEvent(dialog.querySelectorAll("button")[2]!, new MouseEvent("click", { bubbles: true }));
    await flushReact();

    expect(onClose).toHaveBeenCalledWith("skip");
    expect(onRestoreFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(fallback);
  });

  it("keeps the map copy available as a centred text fallback when its target is missing", () => {
    const mapSteps = buildCoachSteps({
      config: ITEM_GAME_CONFIG,
      targetName: "山手線",
      startName: "新橋",
    });
    const mapCoach = createElement(FirstPlayCoach, {
      steps: mapSteps,
      targets: {},
      onClose: vi.fn(),
      onRestoreFocus: vi.fn(),
    });
    const mount = mountReact(mapCoach);
    mounts.push(mount);
    const dialog = dialogOf(mount);
    const next = dialog.querySelectorAll("button")[1]!;
    dispatchReactEvent(next, new MouseEvent("click", { bubbles: true }));
    dispatchReactEvent(dialog.querySelectorAll("button")[1]!, new MouseEvent("click", { bubbles: true }));

    expect(dialog.textContent).toContain(mapSteps[2].copy.text);
    expect(dialog.querySelector("[data-coach-spotlight]")).toBeNull();
    expect(dialog.querySelector(".first-play-coach__bubble")?.getAttribute("data-target-available")).toBe("false");
    expect(dialog.querySelector(".first-play-coach__bubble")?.getAttribute("data-placement-side")).toBe("center");
  });

  it("resolves a committed JSX ref and follows target replacement and removal without resize", async () => {
    class MockResizeObserver {
      static instances: MockResizeObserver[] = [];
      readonly observed: Element[] = [];
      observe = vi.fn((target: Element) => { this.observed.push(target); });
      unobserve = vi.fn((target: Element) => {
        const index = this.observed.indexOf(target);
        if (index >= 0) this.observed.splice(index, 1);
      });
      disconnect = vi.fn(() => { this.observed.splice(0); });
      constructor(_callback: ResizeObserverCallback) { MockResizeObserver.instances.push(this); }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.coachTarget === "0") return rect(24, 120, 60, 48) as DOMRect;
      if (this.dataset.coachTarget === "1") return rect(180, 220, 72, 52) as DOMRect;
      return rect(0, 0, 0, 0) as DOMRect;
    });
    let replaceTarget: (() => void) | undefined;
    let removeTarget: (() => void) | undefined;
    let firstRenderSawNullRef = false;
    let renderCount = 0;
    const onClose = vi.fn();
    function Host(): React.JSX.Element {
      const targetRef = useRef<HTMLButtonElement>(null);
      const [targetVersion, setTargetVersion] = useState<number | null>(0);
      if (renderCount === 0) firstRenderSawNullRef = targetRef.current === null;
      renderCount += 1;
      replaceTarget = () => setTargetVersion(1);
      removeTarget = () => setTargetVersion(null);
      return createElement(
        "div",
        null,
        targetVersion === null ? null : createElement("button", {
          key: targetVersion,
          ref: targetRef,
          "data-coach-target": String(targetVersion),
        }, "target"),
        createElement(FirstPlayCoach, {
          steps,
          targets: { dice: targetRef },
          onClose,
          onRestoreFocus: vi.fn(),
        }),
      );
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);
    const dialog = dialogOf(mount);
    const firstTarget = mount.container.querySelector<HTMLButtonElement>("[data-coach-target='0']")!;
    const observer = MockResizeObserver.instances.find((instance) => instance.disconnect.mock.calls.length === 0)!;

    expect(firstRenderSawNullRef).toBe(true);
    expect(dialog.querySelector<HTMLElement>("[data-coach-spotlight]")?.style.left).toBe("24px");
    expect(observer.observe).toHaveBeenCalledWith(firstTarget);

    await act(async () => {
      replaceTarget?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const replacement = mount.container.querySelector<HTMLButtonElement>("[data-coach-target='1']")!;

    expect(dialog.querySelector<HTMLElement>("[data-coach-spotlight]")?.style.left).toBe("180px");
    expect(observer.unobserve).toHaveBeenCalledWith(firstTarget);
    expect(observer.observe).toHaveBeenCalledWith(replacement);

    await act(async () => {
      removeTarget?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });

    expect(dialog.querySelector("[data-coach-spotlight]")).toBeNull();
    expect(dialog.querySelector(".first-play-coach__bubble")?.getAttribute("data-target-available")).toBe("false");
    expect(dialog.querySelector(".first-play-coach__bubble")?.getAttribute("data-placement-side")).toBe("center");
    expect(observer.unobserve).toHaveBeenCalledWith(replacement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("finds a target added after opening and follows its removal and re-addition without resize", async () => {
    class MockResizeObserver {
      static instances: MockResizeObserver[] = [];
      readonly observed: Element[] = [];
      observe = vi.fn((target: Element) => { this.observed.push(target); });
      unobserve = vi.fn((target: Element) => {
        const index = this.observed.indexOf(target);
        if (index >= 0) this.observed.splice(index, 1);
      });
      disconnect = vi.fn(() => { this.observed.splice(0); });
      constructor(_callback: ResizeObserverCallback) { MockResizeObserver.instances.push(this); }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("first-play-coach__bubble")) return rect(0, 0, 180, 100) as DOMRect;
      if (this.dataset.coachTarget === "0") return rect(24, 120, 60, 48) as DOMRect;
      if (this.dataset.coachTarget === "1") return rect(220, 210, 72, 52) as DOMRect;
      return rect(0, 0, 0, 0) as DOMRect;
    });
    let addTarget: (() => void) | undefined;
    let removeTarget: (() => void) | undefined;
    let reAddTarget: (() => void) | undefined;
    function Host(): React.JSX.Element {
      const targetRef = useRef<HTMLButtonElement>(null);
      const [targetVersion, setTargetVersion] = useState<number | null>(null);
      addTarget = () => setTargetVersion(0);
      removeTarget = () => setTargetVersion(null);
      reAddTarget = () => setTargetVersion(1);
      return createElement(
        "div",
        null,
        targetVersion === null ? null : createElement("button", {
          key: targetVersion,
          ref: targetRef,
          "data-coach-target": String(targetVersion),
        }, "target"),
        createElement(FirstPlayCoach, {
          steps,
          targets: { dice: targetRef },
          onClose: vi.fn(),
          onRestoreFocus: vi.fn(),
        }),
      );
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);
    const dialog = dialogOf(mount);
    const bubble = dialog.querySelector<HTMLElement>(".first-play-coach__bubble")!;
    const observer = MockResizeObserver.instances.find((instance) => instance.disconnect.mock.calls.length === 0)!;

    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("[data-coach-spotlight]")).toBeNull();
    expect(bubble.dataset.targetAvailable).toBe("false");
    expect(bubble.dataset.placementSide).toBe("center");
    expect(observer.observe).toHaveBeenCalledTimes(1);

    await act(async () => {
      addTarget?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const firstTarget = mount.container.querySelector<HTMLButtonElement>("[data-coach-target='0']")!;

    expect(dialog.querySelector<HTMLElement>("[data-coach-spotlight]")?.style.left).toBe("24px");
    expect(bubble.dataset.targetAvailable).toBe("true");
    expect(bubble.dataset.placementSide).toBe("right");
    expect(bubble.style.left).toBe("100px");
    expect(observer.observe).toHaveBeenCalledWith(firstTarget);

    await act(async () => {
      removeTarget?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });

    expect(dialog.querySelector("[data-coach-spotlight]")).toBeNull();
    expect(bubble.dataset.targetAvailable).toBe("false");
    expect(bubble.dataset.placementSide).toBe("center");
    expect(observer.unobserve).toHaveBeenCalledWith(firstTarget);

    await act(async () => {
      reAddTarget?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const reAddedTarget = mount.container.querySelector<HTMLButtonElement>("[data-coach-target='1']")!;

    expect(dialog.querySelector<HTMLElement>("[data-coach-spotlight]")?.style.left).toBe("220px");
    expect(dialog.querySelector<HTMLElement>("[data-coach-spotlight]")?.style.width).toBe("72px");
    expect(bubble.dataset.targetAvailable).toBe("true");
    expect(bubble.dataset.placementSide).toBe("right");
    expect(bubble.style.left).toBe("308px");
    expect(observer.observe).toHaveBeenCalledWith(reAddedTarget);
    expect(observer.observed).toContain(reAddedTarget);
    expect(observer.observed).not.toContain(firstTarget);
  });

  it("remeasures a target after resize and scroll and drops a target that disappears", () => {
    const targetRef = { current: document.createElement("div") };
    document.body.append(targetRef.current);
    extraNodes.push(targetRef.current);
    const getTargetRect = vi.spyOn(targetRef.current, "getBoundingClientRect").mockReturnValue({
      left: 24, top: 120, width: 60, height: 48,
      right: 84, bottom: 168, x: 24, y: 120, toJSON: () => ({}),
    } as DOMRect);
    function Host(): React.JSX.Element {
      const target = useRef(targetRef.current);
      return createElement(FirstPlayCoach, {
        steps,
        targets: { dice: target },
        onClose: vi.fn(),
        onRestoreFocus: vi.fn(),
      });
    }
    const mount = mountReact(createElement(Host));
    mounts.push(mount);
    const dialog = dialogOf(mount);
    expect(dialog.querySelector("[data-coach-spotlight]")).not.toBeNull();

    getTargetRect.mockReturnValue({
      left: 40, top: 160, width: 60, height: 48,
      right: 100, bottom: 208, x: 40, y: 160, toJSON: () => ({}),
    } as DOMRect);
    actWindowEvent("resize");
    expect(dialog.querySelector<HTMLElement>("[data-coach-spotlight]")?.style.left).toBe("40px");
    actWindowEvent("scroll");
    expect(getTargetRect).toHaveBeenCalledTimes(3);

    targetRef.current.remove();
    actWindowEvent("resize");
    expect(dialog.querySelector("[data-coach-spotlight]")).toBeNull();
    expect(dialog.querySelector(".first-play-coach__bubble")?.getAttribute("data-target-available")).toBe("false");
  });

  it("disconnects ResizeObserver and keeps focus correct through StrictMode replay", async () => {
    const fallback = addButton("fallback");
    const disconnectSpy = vi.fn();
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect: () => void;
      constructor(_callback: ResizeObserverCallback) { this.disconnect = disconnectSpy; }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const onRestoreFocus = vi.fn(() => fallback.focus());
    const mount = mountCoach({ onRestoreFocus }, true);
    const dialog = dialogOf(mount);

    await flushReact();
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector(".first-play-coach__bubble"));
    mount.cleanup();
    mounts.splice(mounts.indexOf(mount), 1);
    await flushReact();

    expect(disconnectSpy).toHaveBeenCalled();
    expect(onRestoreFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(fallback);
  });
});

function actWindowEvent(type: "resize" | "scroll"): void {
  act(() => { window.dispatchEvent(new Event(type)); });
}
