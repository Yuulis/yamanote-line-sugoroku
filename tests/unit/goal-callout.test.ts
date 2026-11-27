// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { GOAL_STATION_RING_COLOR } from "../../src/features/map/mapConfig";
import { mountGoalCallout } from "../../src/features/map/goalCallout";
import type { AdjustmentCandidate } from "../../src/features/map/rollAdjustmentPreview";

const { markers } = vi.hoisted(() => ({
  markers: [] as { element: HTMLElement; removed: boolean; position: [number, number] | null }[],
}));

vi.mock("maplibre-gl", () => ({
  Marker: class FakeMarker {
    readonly element: HTMLElement;
    removed = false;
    position: [number, number] | null = null;

    constructor(options: { element: HTMLElement }) {
      this.element = options.element;
      markers.push(this);
    }

    setLngLat(position: [number, number]): this {
      this.position = position;
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
  },
}));

const fakeMap = (): MapLibreMap => ({} as MapLibreMap);
const adjustmentCandidate: AdjustmentCandidate = {
  delta: 1,
  stationId: "shinbashi",
  position: [139.76, 35.66],
  travelledSteps: 1,
};

beforeEach(() => {
  markers.length = 0;
  document.body.replaceChildren();
});

describe("mountGoalCallout", () => {
  it("mounts the pulse with the ring colour and shows the exact bubble when no adjustment candidates exist", () => {
    const callout = mountGoalCallout(fakeMap(), [139.76, 35.66]);

    expect(markers).toHaveLength(1);
    expect(markers[0]?.position).toEqual([139.76, 35.66]);
    const pulse = document.querySelector<HTMLElement>("[data-map-goal-pulse]");
    expect(pulse?.getAttribute("aria-hidden")).toBe("true");
    expect(pulse?.style.pointerEvents).toBe("none");
    expect(pulse?.style.getPropertyValue("--map-goal-ring-color")).toBe(GOAL_STATION_RING_COLOR);
    expect(pulse?.querySelector(".map-goal-pulse__inner")).not.toBeNull();
    expect(document.querySelector("[data-map-goal-callout]")).toBeNull();

    callout.setAdjustmentCandidates([]);

    expect(markers).toHaveLength(2);
    expect(markers[1]?.position).toEqual([139.76, 35.66]);
    const bubble = document.querySelector<HTMLElement>("[data-map-goal-callout]");
    expect(bubble?.textContent).toBe("ここに着けばゴール");
    expect(bubble?.getAttribute("aria-hidden")).toBe("true");
    expect(bubble?.style.pointerEvents).toBe("none");
    expect(document.querySelector("[data-map-adjustment-callout]")).toBeNull();
  });

  it("keeps the pulse while adjustment candidates hide the bubble, then remounts the bubble", () => {
    const callout = mountGoalCallout(fakeMap(), [139.76, 35.66]);
    callout.setAdjustmentCandidates([]);
    const pulseMarker = markers[0];
    const originalBubbleMarker = markers[1];
    const pulse = document.querySelector("[data-map-goal-pulse]");

    callout.setAdjustmentCandidates([adjustmentCandidate]);

    expect(document.querySelector("[data-map-goal-callout]")).toBeNull();
    expect(document.querySelector("[data-map-goal-pulse]")).toBe(pulse);
    expect(pulseMarker?.removed).toBe(false);
    expect(originalBubbleMarker?.removed).toBe(true);

    callout.setAdjustmentCandidates([]);

    expect(document.querySelector("[data-map-goal-callout]")?.textContent).toBe("ここに着けばゴール");
    expect(markers).toHaveLength(3);
    expect(markers[2]).not.toBe(originalBubbleMarker);
    expect(pulseMarker?.removed).toBe(false);

    callout.remove();
    expect(markers.every((marker) => marker.removed)).toBe(true);
    expect(document.querySelector("[data-map-goal-callout]")).toBeNull();
    expect(document.querySelector("[data-map-goal-pulse]")).toBeNull();
  });

  it("does not mount markers without a coordinate", () => {
    const callout = mountGoalCallout(fakeMap(), null);
    callout.setAdjustmentCandidates([]);
    callout.remove();

    expect(markers).toHaveLength(0);
    expect(document.querySelector("[data-map-goal-callout]")).toBeNull();
    expect(document.querySelector("[data-map-goal-pulse]")).toBeNull();
  });
});
