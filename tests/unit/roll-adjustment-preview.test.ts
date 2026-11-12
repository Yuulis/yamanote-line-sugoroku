// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  assignLanes,
  mountAdjustmentCallouts,
  type AdjustmentCandidate,
} from "../../src/features/map/rollAdjustmentPreview";

const { markers } = vi.hoisted(() => ({ markers: [] as { element: HTMLElement; removed: boolean }[] }));

vi.mock("maplibre-gl", () => {
  class FakeMarker {
    readonly element: HTMLElement;
    removed = false;
    constructor(options: { element: HTMLElement }) {
      this.element = options.element;
      markers.push(this);
    }
    setLngLat(): this {
      return this;
    }
    addTo(): this {
      document.body.append(this.element);
      return this;
    }
    remove(): this {
      this.removed = true;
      this.element.remove();
      return this;
    }
  }
  return { Marker: FakeMarker };
});

function fakeMap(): MapLibreMap {
  return {
    project: ([longitude]: [number, number]) => ({ x: longitude * 1000, y: 0 }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as MapLibreMap;
}

const origin: AdjustmentCandidate[] = [
  { delta: -1, stationId: "a", position: [0, 0], travelledSteps: 2 },
  { delta: 0, stationId: "b", position: [1, 0], travelledSteps: 3 },
  { delta: 1, stationId: "b", position: [1, 0], travelledSteps: 3 },
];

beforeEach(() => {
  markers.length = 0;
  document.body.replaceChildren();
});

describe("mountAdjustmentCallouts", () => {
  it("groups choices landing on one station into one bubble with a row each", () => {
    mountAdjustmentCallouts(fakeMap(), origin);

    expect(markers).toHaveLength(2);
    const rows = markers[1]?.element.querySelectorAll(".map-adjustment-callout__row");
    expect([...(rows ?? [])].map((row) => row.textContent)).toEqual(["そのまま 3マス", "+1 3マス"]);
    expect(markers[0]?.element.textContent).toBe("−1 2マス");
  });

  it("renders non-interactive hidden markers and skips landings without a position", () => {
    mountAdjustmentCallouts(fakeMap(), [...origin, { delta: 1, stationId: "c", position: null, travelledSteps: 1 }]);

    expect(markers).toHaveLength(2);
    for (const { element } of markers) {
      expect(element.getAttribute("aria-hidden")).toBe("true");
      expect(element.style.pointerEvents).toBe("none");
    }
  });

  it("sets text through textContent so markup stays literal", () => {
    mountAdjustmentCallouts(fakeMap(), [{ delta: 1, stationId: "<b>x</b>", position: [0, 0], travelledSteps: 1 }]);

    expect(markers[0]?.element.querySelector("b")).toBeNull();
    expect(markers[0]?.element.textContent).toBe("+1 1マス");
  });

  it("removes every marker and the moveend listener on teardown", () => {
    const map = fakeMap();
    const teardown = mountAdjustmentCallouts(map, origin);
    teardown();

    expect(markers.every((marker) => marker.removed)).toBe(true);
    expect(document.querySelectorAll("[data-map-adjustment-callout]")).toHaveLength(0);
    expect(map.off).toHaveBeenCalledWith("moveend", (map.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]);
  });

  it("raises a bubble to the next lane only when it overlaps an earlier bubble", () => {
    expect(assignLanes([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 300, y: 0 }])).toEqual([0, 1, 0]);
    expect(assignLanes([])).toEqual([]);
  });

  it("keeps vertically separated bubbles in lane 0 even when they share x", () => {
    expect(assignLanes([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toEqual([0, 0]);
  });

  it("stacks bubbles of the same point into consecutive lanes", () => {
    expect(assignLanes([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toEqual([0, 1]);
  });
});
