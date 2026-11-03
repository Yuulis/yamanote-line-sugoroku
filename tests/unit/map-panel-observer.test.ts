// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cameraLayoutTargets, useCameraLayoutObserver } from "../../src/features/map/RailwayMap";
import { mountReact, type MountedReact } from "./helpers/reactDom";

describe("cameraLayoutTargets", () => {
  it("observes the map container and panel root, without the route summary", () => {
    const container = document.createElement("div");
    const panel = document.createElement("main");
    panel.className = "game-panel";
    const routeSummary = document.createElement("details");
    routeSummary.className = "game-panel__route-summary";
    panel.append(routeSummary);

    expect(cameraLayoutTargets(container, panel)).toEqual([container, panel]);
  });

  it("observes the map container while the panel is absent", () => {
    const container = document.createElement("div");

    expect(cameraLayoutTargets(container, null)).toEqual([container]);
  });
});

/** Records every observer the hook creates so a test can resize what each one watches. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** A size change of `target` is reported only by a live observer that watches it. */
  resize(target: Element): void {
    if (!this.disconnected && this.observed.includes(target)) this.callback();
  }
}

interface HarnessProps {
  map: { getContainer(): HTMLElement } | null;
  panelKey: number | undefined;
  onBind: () => void;
  onLayoutChange: () => void;
}

function Harness({ map, panelKey, onBind, onLayoutChange }: HarnessProps): null {
  useCameraLayoutObserver(map, panelKey, onBind, onLayoutChange);
  return null;
}

function addPanel(): HTMLElement {
  const panel = document.createElement("main");
  panel.className = "game-panel";
  document.body.append(panel);
  return panel;
}

function resizeEverywhere(target: Element): void {
  act(() => {
    for (const observer of FakeResizeObserver.instances) observer.resize(target);
  });
}

describe("useCameraLayoutObserver", () => {
  let mount: MountedReact | null = null;
  const container = document.createElement("div");
  const map = { getContainer: (): HTMLElement => container };

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    // Run the per-frame update synchronously so each resize reports exactly once.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    mount?.cleanup();
    mount = null;
    document.querySelectorAll(".game-panel").forEach((panel) => panel.remove());
    vi.unstubAllGlobals();
  });

  function render(props: HarnessProps): void {
    if (!mount) {
      mount = mountReact(createElement(Harness, props));
      return;
    }
    const root = mount.root;
    act(() => root.render(createElement(Harness, props)));
  }

  it("rebinds to the replacement panel when the panel key changes", () => {
    const onBind = vi.fn();
    const onLayoutChange = vi.fn();
    const firstPanel = addPanel();
    render({ map, panelKey: 1, onBind, onLayoutChange });
    expect(FakeResizeObserver.instances.at(-1)?.observed).toEqual([container, firstPanel]);

    // A new session mounts a new panel element in place of the old one.
    firstPanel.remove();
    const replacement = addPanel();
    render({ map, panelKey: 2, onBind, onLayoutChange });

    expect(onBind).toHaveBeenCalledTimes(2);
    expect(FakeResizeObserver.instances).toHaveLength(2);
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
    expect(FakeResizeObserver.instances[1]!.observed).toEqual([container, replacement]);
    resizeEverywhere(replacement);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it("keeps one binding while the panel key and map stay the same", () => {
    const onBind = vi.fn();
    const onLayoutChange = vi.fn();
    const panel = addPanel();
    render({ map, panelKey: 3, onBind, onLayoutChange });
    // New callback identities on a re-render must not rebind (they are read through a ref).
    const latest = vi.fn();
    render({ map, panelKey: 3, onBind: vi.fn(), onLayoutChange: latest });

    expect(onBind).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances).toHaveLength(1);
    resizeEverywhere(panel);
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("observes nothing without a map and binds once a map is supplied", () => {
    const onBind = vi.fn();
    const onLayoutChange = vi.fn();
    addPanel();
    render({ map: null, panelKey: 4, onBind, onLayoutChange });
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(onBind).not.toHaveBeenCalled();

    render({ map, panelKey: 4, onBind, onLayoutChange });
    expect(onBind).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances).toHaveLength(1);
  });

  it("watches only the container when no panel is mounted and still reacts to window resizes", () => {
    const onLayoutChange = vi.fn();
    render({ map, panelKey: undefined, onBind: vi.fn(), onLayoutChange });

    expect(FakeResizeObserver.instances.at(-1)?.observed).toEqual([container]);
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });
});
