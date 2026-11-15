// @vitest-environment jsdom
import { act, createElement, createRef, StrictMode, useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeTurnResultPillPosition, sameTurnResultPillPosition, TURN_RESULT_PILL_GAP_PX,
  TURN_RESULT_PILL_LAYOUT_EVENT, type TurnResultPillPosition } from "../../src/features/game/turnResultPillLayout";
import { useTurnResultPillLayout } from "../../src/features/game/useTurnResultPillLayout";
import { mountReact, type MountedReact } from "./helpers/reactDom";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn((_target: Element): void => undefined);
  readonly disconnect = vi.fn((): void => undefined);

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

interface HarnessProps {
  readonly panelRef: React.RefObject<HTMLElement | null>;
  readonly active: boolean;
  readonly onRender: (position: TurnResultPillPosition) => void;
}

function Harness({ panelRef, active, onRender }: HarnessProps): null {
  const position = useTurnResultPillLayout(panelRef, active);
  useLayoutEffect(() => onRender(position));
  return null;
}

let mounted: MountedReact | null = null;
let viewport: EventTarget;
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;
let requestFrame: ReturnType<typeof vi.fn>;
let cancelFrame: ReturnType<typeof vi.fn>;
let viewportHeightDescriptor: PropertyDescriptor | undefined;
let visualViewportDescriptor: PropertyDescriptor | undefined;

function panelWithRect(top: number, left: number, width: number, height: number): HTMLElement {
  const panel = document.createElement("main");
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(left, top, width, height));
  document.body.append(panel);
  return panel;
}

function setRect(panel: HTMLElement, top: number, left: number, width: number, height: number): void {
  vi.mocked(panel.getBoundingClientRect).mockReturnValue(new DOMRect(left, top, width, height));
}

function render(panelRef: React.RefObject<HTMLElement | null>, active: boolean,
  positions: TurnResultPillPosition[] = []): TurnResultPillPosition[] {
  const onRender = (position: TurnResultPillPosition): void => { positions.push(position); };
  const props: HarnessProps = { panelRef, active, onRender };
  // Update the same Harness instance (mounted.render would wrap it in a new component type and remount the hook).
  if (mounted) act(() => mounted?.root.render(createElement(Harness, props)));
  else mounted = mountReact(createElement(Harness, props));
  return positions;
}

function flushFrame(): void {
  const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!next) throw new Error("Expected a queued animation frame");
  frames.delete(next[0]);
  act(() => next[1](16));
}

function dispatch(target: EventTarget, type: string): void {
  act(() => target.dispatchEvent(new Event(type)));
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  frameId = 0;
  frames = new Map();
  viewport = new EventTarget();
  viewportHeightDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, "clientHeight");
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 600 });
  visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  requestFrame = vi.fn((callback: FrameRequestCallback): number => {
    frameId += 1;
    frames.set(frameId, callback);
    return frameId;
  });
  cancelFrame = vi.fn((id: number): void => { frames.delete(id); });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
});

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  document.querySelectorAll("main").forEach((panel) => panel.remove());
  if (viewportHeightDescriptor) Object.defineProperty(document.documentElement, "clientHeight", viewportHeightDescriptor);
  else Reflect.deleteProperty(document.documentElement, "clientHeight");
  if (visualViewportDescriptor) Object.defineProperty(window, "visualViewport", visualViewportDescriptor);
  else Reflect.deleteProperty(window, "visualViewport");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("computeTurnResultPillPosition", () => {
  it("positions the pill above the panel using the named gap", () => {
    expect(TURN_RESULT_PILL_GAP_PX).toBe(8);
    expect(computeTurnResultPillPosition({ panelRect: new DOMRect(0, 500, 320, 100), viewportHeight: 600,
      gapPx: TURN_RESULT_PILL_GAP_PX })).toEqual({ visible: true, bottomPx: 108, leftPx: 0 });
  });

  it("keeps a nonzero panel left inset", () => {
    expect(computeTurnResultPillPosition({ panelRect: new DOMRect(8, 12, 304, 100), viewportHeight: 600,
      gapPx: 8 })).toEqual({ visible: true, bottomPx: 596, leftPx: 8 });
  });

  it("responds to panel height changes and position-only moves", () => {
    const input = { viewportHeight: 600, gapPx: 8 };
    expect(computeTurnResultPillPosition({ ...input, panelRect: new DOMRect(8, 500, 304, 100) }))
      .toEqual({ visible: true, bottomPx: 108, leftPx: 8 });
    expect(computeTurnResultPillPosition({ ...input, panelRect: new DOMRect(8, 480, 304, 120) }))
      .toEqual({ visible: true, bottomPx: 128, leftPx: 8 });
    expect(computeTurnResultPillPosition({ ...input, panelRect: new DOMRect(24, 480, 304, 120) }))
      .toEqual({ visible: true, bottomPx: 128, leftPx: 24 });
  });

  it("returns repeatable positions and compares them exactly", () => {
    const input = { panelRect: new DOMRect(8, 480, 304, 120), viewportHeight: 600, gapPx: 8 };
    const first = computeTurnResultPillPosition(input);
    const second = computeTurnResultPillPosition(input);
    expect(first).toEqual({ visible: true, bottomPx: 128, leftPx: 8 });
    expect(second).toEqual(first);
    expect(sameTurnResultPillPosition(first, second)).toBe(true);
    expect(sameTurnResultPillPosition(first, { visible: false })).toBe(false);
  });

  it.each([
    ["missing rect", null, 600, 8], ["undefined rect", undefined, 600, 8],
    ["NaN top", { top: Number.NaN, left: 0, width: 10, height: 10 }, 600, 8],
    ["infinite left", { top: 1, left: Number.POSITIVE_INFINITY, width: 10, height: 10 }, 600, 8],
    ["NaN width", { top: 1, left: 0, width: Number.NaN, height: 10 }, 600, 8],
    ["infinite height", { top: 1, left: 0, width: 10, height: Number.POSITIVE_INFINITY }, 600, 8],
    ["zero width", { top: 1, left: 0, width: 0, height: 10 }, 600, 8],
    ["zero height", { top: 1, left: 0, width: 10, height: 0 }, 600, 8],
    ["NaN viewport", { top: 1, left: 0, width: 10, height: 10 }, Number.NaN, 8],
    ["infinite viewport", { top: 1, left: 0, width: 10, height: 10 }, Number.POSITIVE_INFINITY, 8],
    ["non-finite gap", { top: 1, left: 0, width: 10, height: 10 }, 600, Number.POSITIVE_INFINITY],
  ] as const)("hides the pill for %s", (_label, panelRect, viewportHeight, gapPx) => {
    expect(computeTurnResultPillPosition({ panelRect, viewportHeight, gapPx })).toEqual({ visible: false });
  });
});

describe("useTurnResultPillLayout", () => {
  it("returns the first measured position and emits one layout event", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const onLayout = vi.fn();
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
    const positions = render(ref, true);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 128, leftPx: 8 });
    expect(FakeResizeObserver.instances[0]?.observe).toHaveBeenCalledWith(panel);
    expect(onLayout).toHaveBeenCalledTimes(1);
    window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
  });

  it("coalesces multiple triggers into one frame and one committed update", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions = render(ref, true);
    const onLayout = vi.fn();
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
    const rendersBefore = positions.length;
    setRect(panel, 460, 12, 304, 140);
    act(() => {
      FakeResizeObserver.instances[0]?.trigger();
      window.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(frames.size).toBe(1);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    flushFrame();
    expect(positions).toHaveLength(rendersBefore + 1);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 148, leftPx: 12 });
    expect(onLayout).toHaveBeenCalledTimes(1);
    setRect(panel, 450, 12, 304, 140);
    dispatch(window, "resize");
    flushFrame();
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 158, leftPx: 12 });
    expect(onLayout).toHaveBeenCalledTimes(2);
    window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
  });

  it("skips state updates and events when geometry is unchanged", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions = render(ref, true);
    const onLayout = vi.fn();
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
    const rendersBefore = positions.length;
    act(() => {
      FakeResizeObserver.instances[0]?.trigger();
      window.dispatchEvent(new Event("resize"));
    });
    flushFrame();
    expect(positions).toHaveLength(rendersBefore);
    expect(onLayout).not.toHaveBeenCalled();
    window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
  });

  it("remeasures for visual viewport and window resize and orientation events", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions = render(ref, true);
    const cases: ReadonlyArray<readonly [EventTarget, string, number, number]> = [
      [viewport, "resize", 470, 9], [viewport, "scroll", 460, 10], [window, "resize", 450, 11],
      [window, "orientationchange", 440, 12],
    ];
    for (const [target, type, top, left] of cases) {
      setRect(panel, top, left, 304, 120);
      dispatch(target, type);
      flushFrame();
      expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 608 - top, leftPx: left });
    }
  });

  it("remeasures every frame during transitions and stops at transitionend", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions = render(ref, true);
    dispatch(panel, "transitionrun");
    setRect(panel, 470, 8, 304, 120);
    flushFrame();
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 138, leftPx: 8 });
    expect(frames.size).toBe(1);
    setRect(panel, 460, 8, 304, 120);
    flushFrame();
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 148, leftPx: 8 });
    expect(frames.size).toBe(1);
    dispatch(panel, "transitionend");
    flushFrame();
    expect(frames.size).toBe(0);
  });

  it("stops an animation frame loop when animationcancel fires", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    render(ref, true);
    dispatch(panel, "animationstart");
    flushFrame();
    expect(frames.size).toBe(1);
    dispatch(panel, "animationcancel");
    flushFrame();
    expect(frames.size).toBe(0);
  });

  it("keeps the initial measurement and listeners when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions = render(ref, true);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 128, leftPx: 8 });
    expect(FakeResizeObserver.instances).toHaveLength(0);
    setRect(panel, 460, 8, 304, 120);
    dispatch(window, "resize");
    flushFrame();
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 148, leftPx: 8 });
  });

  it("disconnects, removes listeners and cancels pending work on unmount", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const viewportAdd = vi.spyOn(viewport, "addEventListener");
    const viewportRemove = vi.spyOn(viewport, "removeEventListener");
    const panelAdd = vi.spyOn(panel, "addEventListener");
    const panelRemove = vi.spyOn(panel, "removeEventListener");
    const positions = render(ref, true);
    const onLayout = vi.fn();
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
    const observer = FakeResizeObserver.instances[0]!;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(frames.size).toBe(1);
    const positionsBeforeUnmount = positions.length;
    mounted?.cleanup();
    mounted = null;
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    for (const eventName of ["resize", "orientationchange"]) {
      expect(windowRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(
        windowAdd.mock.calls.filter(([type]) => type === eventName).length);
    }
    for (const eventName of ["resize", "scroll"]) {
      expect(viewportRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(
        viewportAdd.mock.calls.filter(([type]) => type === eventName).length);
    }
    for (const eventName of ["transitionrun", "animationstart", "transitionend", "transitioncancel", "animationend", "animationcancel"]) {
      expect(panelRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(
        panelAdd.mock.calls.filter(([type]) => type === eventName).length);
    }
    dispatch(window, "resize");
    expect(frames.size).toBe(0);
    expect(positions).toHaveLength(positionsBeforeUnmount);
    expect(onLayout).not.toHaveBeenCalled();
    window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
  });

  it("cleans up and resets to hidden when active becomes false", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const viewportAdd = vi.spyOn(viewport, "addEventListener");
    const viewportRemove = vi.spyOn(viewport, "removeEventListener");
    const panelAdd = vi.spyOn(panel, "addEventListener");
    const panelRemove = vi.spyOn(panel, "removeEventListener");
    const positions = render(ref, true);
    const observer = FakeResizeObserver.instances[0]!;
    const onLayout = vi.fn();
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
    act(() => window.dispatchEvent(new Event("resize")));
    render(ref, false, positions);
    expect(positions.at(-1)).toEqual({ visible: false });
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledOnce();
    for (const eventName of ["resize", "orientationchange"]) {
      expect(windowRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(
        windowAdd.mock.calls.filter(([type]) => type === eventName).length);
    }
    for (const eventName of ["resize", "scroll"]) {
      expect(viewportRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(
        viewportAdd.mock.calls.filter(([type]) => type === eventName).length);
    }
    for (const eventName of ["transitionrun", "animationstart", "transitionend", "transitioncancel", "animationend", "animationcancel"]) {
      expect(panelRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(
        panelAdd.mock.calls.filter(([type]) => type === eventName).length);
    }
    const eventsBefore = onLayout.mock.calls.length;
    dispatch(window, "resize");
    expect(frames.size).toBe(0);
    expect(onLayout).toHaveBeenCalledTimes(eventsBefore);
    window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
  });

  it("rebinds listeners and the observer when the ref target changes", () => {
    const first = panelWithRect(480, 8, 304, 120);
    const second = panelWithRect(440, 16, 304, 120);
    const firstRef = createRef<HTMLElement>();
    const secondRef = createRef<HTMLElement>();
    firstRef.current = first;
    secondRef.current = second;
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const viewportAdd = vi.spyOn(viewport, "addEventListener");
    const viewportRemove = vi.spyOn(viewport, "removeEventListener");
    const firstPanelAdd = vi.spyOn(first, "addEventListener");
    const firstPanelRemove = vi.spyOn(first, "removeEventListener");
    const positions = render(firstRef, true);
    const oldObserver = FakeResizeObserver.instances[0]!;
    render(secondRef, true, positions);
    expect(oldObserver.disconnect).toHaveBeenCalledOnce();
    expect(FakeResizeObserver.instances[1]?.observe).toHaveBeenCalledWith(second);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 168, leftPx: 16 });
    for (const eventName of ["resize", "orientationchange"]) {
      expect(windowRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(1);
      expect(windowAdd.mock.calls.filter(([type]) => type === eventName)).toHaveLength(2);
    }
    for (const eventName of ["resize", "scroll"]) {
      expect(viewportRemove.mock.calls.filter(([type]) => type === eventName)).toHaveLength(1);
      expect(viewportAdd.mock.calls.filter(([type]) => type === eventName)).toHaveLength(2);
    }
    expect(firstPanelRemove.mock.calls).toHaveLength(firstPanelAdd.mock.calls.length);
  });

  it("does no measurement, observation, event setup or frame work when inactive", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const getRect = vi.mocked(panel.getBoundingClientRect);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const addWindow = vi.spyOn(window, "addEventListener");
    const addViewport = vi.spyOn(viewport, "addEventListener");
    const addPanel = vi.spyOn(panel, "addEventListener");
    render(ref, false);
    expect(getRect).not.toHaveBeenCalled();
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(addWindow.mock.calls.filter(([type]) => ["resize", "orientationchange"].includes(String(type)))).toHaveLength(0);
    expect(addViewport).not.toHaveBeenCalled();
    expect(addPanel).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
  });
  it("binds to a panel whose ref is attached in the same commit as the first render", () => {
    const rect = new DOMRect(8, 480, 304, 120);
    const getRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const positions: TurnResultPillPosition[] = [];
    function OwnPanel(): ReturnType<typeof createElement> {
      const panelRef = useRef<HTMLElement | null>(null);
      const position = useTurnResultPillLayout(panelRef, true);
      useLayoutEffect(() => { positions.push(position); });
      return createElement("section", { ref: panelRef });
    }
    mounted = mountReact(createElement(OwnPanel));
    expect(getRect).toHaveBeenCalled();
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 128, leftPx: 8 });
    expect(FakeResizeObserver.instances[0]?.observe).toHaveBeenCalledWith(mounted.container.querySelector("section"));
  });

  it("ignores transitions that bubble from descendants of the panel", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const child = document.createElement("button");
    panel.append(child);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    render(ref, true);
    act(() => child.dispatchEvent(new Event("transitionrun", { bubbles: true })));
    child.remove();
    expect(frames.size).toBe(0);
  });
  it("stops the per-frame loop when the panel is detached mid-transition", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    render(ref, true);
    dispatch(panel, "transitionrun");
    flushFrame();
    expect(frames.size).toBe(1);
    panel.remove();
    flushFrame();
    expect(frames.size).toBe(0);
  });

  it("notifies once when deactivated and rebinds on reactivation", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions = render(ref, true);
    const onLayout = vi.fn();
    window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
    render(ref, false, positions);
    expect(positions.at(-1)).toEqual({ visible: false });
    expect(onLayout).toHaveBeenCalledTimes(1);
    setRect(panel, 460, 8, 304, 120);
    render(ref, true, positions);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 148, leftPx: 8 });
    expect(onLayout).toHaveBeenCalledTimes(2);
    expect(FakeResizeObserver.instances).toHaveLength(2);
    expect(FakeResizeObserver.instances[1]?.observe).toHaveBeenCalledWith(panel);
    window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, onLayout);
  });

  it("follows a new element behind the same ref object", () => {
    const first = panelWithRect(480, 8, 304, 120);
    const second = panelWithRect(440, 16, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = first;
    const positions = render(ref, true);
    ref.current = second;
    render(ref, true, positions);
    expect(FakeResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(FakeResizeObserver.instances[1]?.observe).toHaveBeenCalledWith(second);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 168, leftPx: 16 });
  });

  it("leaves exactly one live observer and no pending frame under StrictMode", () => {
    const panel = panelWithRect(480, 8, 304, 120);
    const ref = createRef<HTMLElement>();
    ref.current = panel;
    const positions: TurnResultPillPosition[] = [];
    const onRender = (position: TurnResultPillPosition): void => { positions.push(position); };
    mounted = mountReact(createElement(StrictMode, null, createElement(Harness, { panelRef: ref, active: true, onRender })));
    const live = FakeResizeObserver.instances.filter((observer) => observer.disconnect.mock.calls.length === 0);
    expect(live).toHaveLength(1);
    expect(positions.at(-1)).toEqual({ visible: true, bottomPx: 128, leftPx: 8 });
    expect(frames.size).toBe(0);
  });
});
