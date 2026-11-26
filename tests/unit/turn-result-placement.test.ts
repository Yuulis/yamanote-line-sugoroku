// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_RESULT_PILL_LAYOUT_EVENT } from "../../src/features/game/turnResultPillLayout";
import {
  chooseTurnMomentPlacement,
  occupiedPanelRect,
  TURN_RESULT_PILL_SELECTOR,
  TurnMomentHost,
  useTurnMomentRects,
  type RectBox,
  type TurnMomentRectSources,
  type TurnMomentRects,
} from "../../src/features/game/components/TurnMomentHost";
import { previewObstructions, useCameraLayoutObserver } from "../../src/features/map/railwayMapCamera";
import { mountReact, type MountedReact } from "./helpers/reactDom";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn((_element: Element): void => undefined);
  readonly disconnect = vi.fn((): void => undefined);

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const VIEWPORT: RectBox = { left: 0, top: 0, width: 320, height: 600 };
const PANEL: RectBox = { left: 8, top: 400, width: 304, height: 200 };
const CAMERA_PANEL_KEY = 1;
let mounted: MountedReact | null = null;

function setRect(element: Element, value: RectBox | (() => RectBox)): void {
  const read = typeof value === "function" ? value : () => value;
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const rect = read();
    return new DOMRect(rect.left, rect.top, rect.width, rect.height);
  });
}

interface MomentElements {
  readonly map: HTMLDivElement;
  readonly panel: HTMLElement;
  readonly pill: HTMLButtonElement;
  readonly sources: TurnMomentRectSources;
}

/** Map, panel and pill attached to the document, with the map and panel at fixed rectangles. */
function momentElements(): MomentElements {
  const map = document.createElement("div");
  const panel = document.createElement("main");
  const pill = document.createElement("button");
  pill.className = TURN_RESULT_PILL_SELECTOR.slice(1);
  document.body.append(map, panel, pill);
  setRect(map, VIEWPORT);
  setRect(panel, PANEL);
  return { map, panel, pill, sources: { resolveMap: () => map, resolvePanel: () => panel, resolvePill: () => pill } };
}

interface HarnessProps {
  readonly active: boolean;
  readonly sources: TurnMomentRectSources;
  readonly report: (rects: TurnMomentRects | null) => void;
}

function Harness({ active, sources, report }: HarnessProps): null {
  const rects = useTurnMomentRects(active, sources);
  useLayoutEffect(() => report(rects), [rects, report]);
  return null;
}

function renderHarness(active: boolean, sources: TurnMomentRectSources, report: HarnessProps["report"]): void {
  const node = createElement(Harness, { active, sources, report });
  if (mounted) act(() => mounted?.root.render(node));
  else mounted = mountReact(node);
}

interface CameraHarnessProps {
  readonly map: { getContainer(): HTMLElement } | null;
  readonly previewOpen: boolean;
  readonly onLayoutChange: () => void;
}

function CameraHarness({ map, previewOpen, onLayoutChange }: CameraHarnessProps): null {
  useCameraLayoutObserver(map, CAMERA_PANEL_KEY, vi.fn(), onLayoutChange, previewOpen);
  return null;
}

function renderCameraHarness(props: CameraHarnessProps): void {
  const node = createElement(CameraHarness, props);
  if (mounted) act(() => mounted?.root.render(node));
  else mounted = mountReact(node);
}

function makeVisible(element: HTMLElement, rect: DOMRect | (() => DOMRect)): void {
  const readRect = typeof rect === "function" ? rect : (): DOMRect => rect;
  vi.spyOn(element, "getClientRects").mockImplementation(() => {
    const rects = element.style.display === "none" ? [] : [readRect()];
    return rects as unknown as DOMRectList;
  });
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(readRect);
}

function lastRects(report: ReturnType<typeof vi.fn>): TurnMomentRects | null | undefined {
  return report.mock.lastCall?.[0] as TurnMomentRects | null | undefined;
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("occupiedPanelRect", () => {
  it("keeps the panel for a null or zero pill", () => {
    expect(occupiedPanelRect(PANEL, null)).toBe(PANEL);
    expect(occupiedPanelRect(PANEL, { left: 8, top: 350, width: 0, height: 44 })).toBe(PANEL);
  });

  it.each([
    ["short", PANEL, { left: 8, top: 348, width: 96, height: 44 }, { left: 8, top: 348, width: 304, height: 252 }],
    ["long capped", { ...PANEL, width: 200 }, { left: 8, top: 348, width: 220, height: 44 }, { left: 8, top: 348, width: 220, height: 252 }],
    ["gap above", PANEL, { left: 8, top: 330, width: 96, height: 44 }, { left: 8, top: 330, width: 304, height: 270 }],
  ] as const)("unions the %s pill without losing the gap", (_label, panel, pill, expected) => {
    expect(occupiedPanelRect(panel, pill)).toEqual(expected);
  });

  it("uses a usable pill when the panel is unusable and never returns invalid geometry", () => {
    const pill: RectBox = { left: 8, top: 330, width: 220, height: 44 };
    expect(occupiedPanelRect({ left: 8, top: 0, width: 0, height: 200 }, pill)).toBe(pill);
    expect(occupiedPanelRect({ left: Number.NaN, top: 0, width: 1, height: 1 }, null)).toBeNull();
  });

  it("ends the above placement at the pill top", () => {
    const pill: RectBox = { left: 8, top: 330, width: 220, height: 44 };

    const placement = chooseTurnMomentPlacement(VIEWPORT, VIEWPORT, occupiedPanelRect(PANEL, pill));

    expect(placement.region).toBe("above");
    expect(placement.rect.top + placement.rect.height).toBe(pill.top);
  });
});

describe("useTurnMomentRects pill lifecycle", () => {
  it("ignores hidden shells and measures visible short and capped pills", () => {
    const { pill, sources } = momentElements();
    let pillRect: RectBox = { left: 8, top: 340, width: 0, height: 0 };
    setRect(pill, () => pillRect);
    pill.style.display = "none";
    const report = vi.fn();

    renderHarness(true, sources, report);
    expect(lastRects(report)?.pill).toBeNull();

    pill.style.display = "block";
    pill.style.visibility = "hidden";
    pillRect = { left: 8, top: 340, width: 96, height: 44 };
    act(() => window.dispatchEvent(new Event("resize")));
    expect(lastRects(report)?.pill).toBeNull();

    pill.style.visibility = "visible";
    act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
    expect(lastRects(report)?.pill?.width).toBe(96);

    pillRect = { left: 8, top: 340, width: 220, height: 44 };
    act(() => FakeResizeObserver.instances[0]?.trigger());
    expect(lastRects(report)?.pill?.width).toBe(220);
    expect(FakeResizeObserver.instances[0]?.observe).toHaveBeenCalledWith(pill);
  });

  it("picks up position-only changes only on the committed layout event and preserves identical measurements", () => {
    const { pill, sources } = momentElements();
    let pillRect: RectBox = { left: 8, top: 340, width: 120, height: 44 };
    setRect(pill, () => pillRect);
    const report = vi.fn();
    renderHarness(true, sources, report);
    const initial = lastRects(report);

    pillRect = { ...pillRect, top: 320 };
    expect(lastRects(report)).toBe(initial);

    act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
    expect(lastRects(report)?.pill?.top).toBe(320);

    const moved = lastRects(report);
    act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
    expect(lastRects(report)).toBe(moved);
  });

  it.each(["deactivate", "unmount"] as const)("removes listeners and disconnects the observer on %s", (end) => {
    const { pill, sources } = momentElements();
    setRect(pill, { left: 8, top: 340, width: 120, height: 44 });
    const remove = vi.spyOn(window, "removeEventListener");
    renderHarness(true, sources, vi.fn());
    const observer = FakeResizeObserver.instances[0]!;

    if (end === "deactivate") {
      renderHarness(false, sources, vi.fn());
    } else {
      mounted?.cleanup();
      mounted = null;
    }

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(["resize", "scroll", TURN_RESULT_PILL_LAYOUT_EVENT]),
    );
  });
});

describe("preview pill map layout", () => {
  it("registers a visible pill as an obstruction and a layout target, excluding hidden shells", () => {
    const container = document.createElement("div");
    const panel = document.createElement("main");
    const visiblePill = document.createElement("button");
    const displayHiddenPill = document.createElement("button");
    const visibilityHiddenPill = document.createElement("button");
    panel.className = "game-panel";
    visiblePill.className = displayHiddenPill.className = visibilityHiddenPill.className = "turn-result__pill";
    displayHiddenPill.style.display = "none";
    visibilityHiddenPill.style.visibility = "hidden";
    document.body.append(panel, visiblePill, displayHiddenPill, visibilityHiddenPill);
    const panelRect = new DOMRect(0, 400, 320, 168);
    const pillRect = new DOMRect(8, 348, 120, 44);
    const hiddenRect = new DOMRect(8, 348, 120, 44);
    makeVisible(panel, panelRect);
    makeVisible(visiblePill, pillRect);
    makeVisible(displayHiddenPill, hiddenRect);
    makeVisible(visibilityHiddenPill, hiddenRect);
    const mapRect = new DOMRect(0, 0, 320, 568);
    makeVisible(container, mapRect);
    const map = { getContainer: (): HTMLElement => container };

    expect(previewObstructions(container)).toEqual([
      { left: 0, top: 400, right: 320, bottom: 568 },
      { left: 8, top: 348, right: 128, bottom: 392 },
    ]);

    renderCameraHarness({ map, previewOpen: true, onLayoutChange: vi.fn() });
    const observer = FakeResizeObserver.instances.at(-1);
    expect(observer?.observe).toHaveBeenCalledWith(visiblePill);
    expect(observer?.observe).not.toHaveBeenCalledWith(displayHiddenPill);
    expect(observer?.observe).not.toHaveBeenCalledWith(visibilityHiddenPill);
  });

  it("coalesces position-only pill notifications only while the preview is open", () => {
    const container = document.createElement("div");
    const pill = document.createElement("button");
    pill.className = "turn-result__pill";
    document.body.append(pill);
    let pillRect = new DOMRect(8, 100, 120, 44);
    makeVisible(pill, () => pillRect);
    const map = { getContainer: (): HTMLElement => container };
    const onLayoutChange = vi.fn();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    renderCameraHarness({ map, previewOpen: true, onLayoutChange });

    const initialPillRect = pill.getBoundingClientRect();
    pillRect = new DOMRect(8, 80, 120, 44);
    expect(pill.getBoundingClientRect().width).toBe(initialPillRect.width);
    expect(pill.getBoundingClientRect().height).toBe(initialPillRect.height);
    expect(pill.getBoundingClientRect().top).not.toBe(initialPillRect.top);
    act(() => {
      window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT));
      window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT));
    });
    expect(frames).toHaveLength(1);
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(FakeResizeObserver.instances.at(-1)?.observe).toHaveBeenCalledWith(pill);
    act(() => frames[0]?.(0));
    expect(onLayoutChange).toHaveBeenCalledTimes(1);

    renderCameraHarness({ map, previewOpen: false, onLayoutChange });
    act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it.each(["unmount", "preview closes"] as const)("removes the pill listener on %s", (end) => {
    const container = document.createElement("div");
    const map = { getContainer: (): HTMLElement => container };
    const onLayoutChange = vi.fn();
    const remove = vi.spyOn(window, "removeEventListener");
    renderCameraHarness({ map, previewOpen: true, onLayoutChange });

    if (end === "preview closes") renderCameraHarness({ map, previewOpen: false, onLayoutChange });
    else {
      mounted?.cleanup();
      mounted = null;
    }

    expect(remove).toHaveBeenCalledWith(TURN_RESULT_PILL_LAYOUT_EVENT, expect.any(Function));
    act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});

it("uses the measured pill union in TurnMomentHost placement", () => {
  const { pill, sources } = momentElements();
  setRect(pill, { left: 8, top: 330, width: 120, height: 44 });

  act(() => {
    mounted = mountReact(createElement(TurnMomentHost, { ...sources, children: "moment" }));
  });

  if (!mounted) throw new Error("TurnMomentHost did not mount");
  const region = mounted.container.querySelector<HTMLElement>(".turn-moment-host__region");
  expect(region?.dataset.region).toBe("above");
  expect(region?.style.height).toBe("330px");
});
