// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ATTRIBUTION_BOTTOM_PROPERTY,
  collapseAttributionOnce,
  watchCompactAttribution,
} from "../../src/features/map/attribution";

const EXPANDED_BOTTOM_PX = 96;
const COLLAPSED_BOTTOM_PX = 54;

/**
 * Mirrors MapLibre 6's AttributionControl DOM: a <details> with a <summary>
 * toggle that flips `maplibregl-compact-show` while compact. `populate()` does
 * what `_updateAttributions` → `_updateCompact` does when content first arrives.
 */
interface FakeAttribution {
  container: HTMLElement;
  toggle: HTMLElement;
  populate: () => void;
}

function fakeAttribution(state: "empty" | "expanded" | "collapsed"): FakeAttribution {
  const container = document.createElement("details");
  container.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
  const toggle = document.createElement("summary");
  toggle.className = "maplibregl-ctrl-attrib-button";
  toggle.addEventListener("click", () => {
    if (container.classList.contains("maplibregl-compact")) container.classList.toggle("maplibregl-compact-show");
  });
  container.append(toggle, document.createElement("div"));
  container.getBoundingClientRect = () => container.classList.contains("maplibregl-compact-show")
    ? new DOMRect(10, 10, 200, EXPANDED_BOTTOM_PX - 10)
    : new DOMRect(10, 10, 44, COLLAPSED_BOTTOM_PX - 10);
  const populate = (): void => {
    container.classList.remove("maplibregl-attrib-empty");
    if (!container.classList.contains("maplibregl-compact")) {
      container.classList.add("maplibregl-compact", "maplibregl-compact-show");
    }
  };
  if (state === "empty") container.classList.add("maplibregl-attrib-empty");
  if (state === "expanded") container.classList.add("maplibregl-compact", "maplibregl-compact-show");
  if (state === "collapsed") container.classList.add("maplibregl-compact");
  document.body.append(container);
  return { container, toggle, populate };
}

function isExpanded(container: HTMLElement): boolean {
  return container.classList.contains("maplibregl-compact-show");
}

function publishedBottom(): string {
  return document.documentElement.style.getPropertyValue(ATTRIBUTION_BOTTOM_PROPERTY);
}

/** MutationObserver callbacks run as microtasks. */
async function flushObservers(): Promise<void> {
  await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(ATTRIBUTION_BOTTOM_PROPERTY);
});

describe("collapseAttributionOnce", () => {
  it("collapses an expanded compact attribution through its toggle and then becomes a no-op", () => {
    const { container } = fakeAttribution("expanded");

    expect(collapseAttributionOnce(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(collapseAttributionOnce(container)).toBe(false);
    expect(isExpanded(container)).toBe(false);
  });

  it("leaves an already collapsed attribution unchanged", () => {
    const { container } = fakeAttribution("collapsed");

    expect(collapseAttributionOnce(container)).toBe(false);
    expect(isExpanded(container)).toBe(false);
  });

  it("does nothing while the attribution is still empty", () => {
    const { container } = fakeAttribution("empty");

    expect(collapseAttributionOnce(container)).toBe(false);
    expect(container.classList.contains("maplibregl-attrib-empty")).toBe(true);
  });

  it("returns false when the control has no toggle", () => {
    const { container, toggle } = fakeAttribution("expanded");
    toggle.remove();

    expect(collapseAttributionOnce(container)).toBe(false);
    expect(isExpanded(container)).toBe(true);
  });
});

describe("watchCompactAttribution", () => {
  it("collapses an attribution that is already expanded when attached", () => {
    const { container } = fakeAttribution("expanded");

    const stop = watchCompactAttribution(container);

    expect(isExpanded(container)).toBe(false);
    expect(publishedBottom()).toBe(`${COLLAPSED_BOTTOM_PX}px`);
    stop();
  });

  it("waits while empty and collapses once the content first populates", async () => {
    const { container, populate } = fakeAttribution("empty");
    const stop = watchCompactAttribution(container);
    expect(isExpanded(container)).toBe(false);

    populate();
    await flushObservers();

    expect(container.classList.contains("maplibregl-compact")).toBe(true);
    expect(isExpanded(container)).toBe(false);
    stop();
  });

  it("never re-collapses after the user opened it", async () => {
    const { container, toggle, populate } = fakeAttribution("expanded");
    const stop = watchCompactAttribution(container);
    expect(isExpanded(container)).toBe(false);

    toggle.click();
    await flushObservers();
    populate();
    await flushObservers();

    expect(isExpanded(container)).toBe(true);
    expect(publishedBottom()).toBe(`${EXPANDED_BOTTOM_PX}px`);
    stop();
  });

  it("does not auto-collapse when the user opened it before the content populated", async () => {
    const { container, toggle, populate } = fakeAttribution("empty");
    const stop = watchCompactAttribution(container);

    toggle.click();
    populate();
    await flushObservers();

    expect(isExpanded(container)).toBe(true);
    stop();
  });

  it("publishes the bottom edge of the collapsed toggle and of the expanded credit", async () => {
    const { container, toggle } = fakeAttribution("expanded");
    const stop = watchCompactAttribution(container);
    expect(publishedBottom()).toBe(`${COLLAPSED_BOTTOM_PX}px`);

    toggle.click();
    await flushObservers();
    expect(publishedBottom()).toBe(`${EXPANDED_BOTTOM_PX}px`);

    toggle.click();
    await flushObservers();
    expect(publishedBottom()).toBe(`${COLLAPSED_BOTTOM_PX}px`);
    stop();
  });

  it("republishes the bottom edge on a window resize that only moves the control", () => {
    const { container } = fakeAttribution("collapsed");
    const stop = watchCompactAttribution(container);
    expect(publishedBottom()).toBe(`${COLLAPSED_BOTTOM_PX}px`);
    const insetTop = 47;
    container.getBoundingClientRect = () => new DOMRect(10, 10 + insetTop, 44, COLLAPSED_BOTTOM_PX - 10);

    window.dispatchEvent(new Event("resize"));

    expect(publishedBottom()).toBe(`${COLLAPSED_BOTTOM_PX + insetTop}px`);
    stop();
  });

  it("collapses the fresh control created by a reattachment after rotation", () => {
    const first = fakeAttribution("expanded");
    const stopFirst = watchCompactAttribution(first.container);
    first.toggle.click();
    stopFirst();
    first.container.remove();

    const reattached = fakeAttribution("expanded");
    const stopReattached = watchCompactAttribution(reattached.container);

    expect(isExpanded(reattached.container)).toBe(false);
    stopReattached();
  });

  it("stops observing and clears the published edge on cleanup", async () => {
    const { container, toggle, populate } = fakeAttribution("empty");
    const stop = watchCompactAttribution(container);
    populate();
    await flushObservers();
    toggle.click();
    await flushObservers();
    expect(publishedBottom()).toBe(`${EXPANDED_BOTTOM_PX}px`);

    stop();
    container.className = "maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-attrib-empty";
    populate();
    await flushObservers();

    expect(publishedBottom()).toBe("");
    expect(isExpanded(container)).toBe(true);
  });
});
