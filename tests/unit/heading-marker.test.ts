// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  CURRENT_POSITION_COLOR,
  CURRENT_POSITION_RADIUS,
  CURRENT_POSITION_STROKE_COLOR,
  CURRENT_POSITION_STROKE_WIDTH,
} from "../../src/features/map/mapConfig";
import { createHeadingMarker } from "../../src/features/map/headingMarker";

const { markerInstances } = vi.hoisted(() => ({ markerInstances: [] as unknown[] }));

vi.mock("maplibre-gl", () => {
  class FakeMarker {
    readonly options: { element: HTMLElement; anchor: string; rotationAlignment: string; pitchAlignment: string };
    position: unknown;
    rotation: number | undefined;
    map: unknown;
    readonly setLngLat = vi.fn((position: unknown) => {
      this.position = position;
      return this;
    });
    readonly setRotation = vi.fn((rotation?: number) => {
      this.rotation = rotation;
      return this;
    });
    readonly addTo = vi.fn((map: unknown) => {
      this.map = map;
      return this;
    });
    readonly remove = vi.fn(() => this);

    constructor(options: { element: HTMLElement; anchor: string; rotationAlignment: string; pitchAlignment: string }) {
      this.options = options;
      markerInstances.push(this);
    }
  }

  return { Marker: FakeMarker };
});

interface FakeMarkerInstance {
  options: { element: HTMLElement; anchor: string; rotationAlignment: string; pitchAlignment: string };
  position: unknown;
  rotation: number | undefined;
  map: unknown;
  setLngLat: ReturnType<typeof vi.fn>;
  setRotation: ReturnType<typeof vi.fn>;
  addTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

describe("createHeadingMarker", () => {
  beforeEach(() => {
    markerInstances.length = 0;
  });

  it("creates one map-aligned DOM marker, updates it, hides it for nulls, and removes it", () => {
    const map = { getCenter: () => [139.7, 35.6] } as unknown as MapLibreMap;
    const headingMarker = createHeadingMarker(map);
    const marker = markerInstances[0] as FakeMarkerInstance;
    const element = marker.options.element;
    const expectedSize = (CURRENT_POSITION_RADIUS + CURRENT_POSITION_STROKE_WIDTH) * 2;

    expect(markerInstances).toHaveLength(1);
    expect(marker.options).toMatchObject({ anchor: "center", rotationAlignment: "map", pitchAlignment: "map" });
    expect(marker.map).toBe(map);
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("data-map-heading-marker")).toBe("");
    expect(element.style.pointerEvents).toBe("none");
    expect(element.style.width).toBe(`${expectedSize}px`);
    expect(element.style.height).toBe(`${expectedSize}px`);
    expect(element.style.visibility).toBe("hidden");
    const svg = element.querySelector("svg");
    expect(svg?.getAttribute("height")).toBe(`${expectedSize + CURRENT_POSITION_RADIUS}`);
    expect(svg?.style.top).toBe(`-${CURRENT_POSITION_RADIUS}px`);
    const triangle = element.querySelector("svg path");
    expect(triangle?.getAttribute("fill")).toBe(CURRENT_POSITION_COLOR);
    expect(triangle?.getAttribute("stroke")).toBe(CURRENT_POSITION_STROKE_COLOR);

    headingMarker.update([139.75, 35.7], 205.15);
    expect(marker.setLngLat).toHaveBeenLastCalledWith([139.75, 35.7]);
    expect(marker.setRotation).toHaveBeenLastCalledWith(205.15);
    expect(element.style.visibility).toBe("visible");

    headingMarker.update([139.8, 35.8], null);
    expect(marker.setLngLat).toHaveBeenLastCalledWith([139.8, 35.8]);
    expect(element.style.visibility).toBe("hidden");
    headingMarker.update(null, 205.15);
    expect(element.style.visibility).toBe("hidden");

    headingMarker.remove();
    expect(marker.remove).toHaveBeenCalledOnce();
  });
});
