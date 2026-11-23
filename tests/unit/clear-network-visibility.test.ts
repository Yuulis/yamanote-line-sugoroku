// @vitest-environment jsdom
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLEAR_HIDDEN_OVERLAY_LAYER_IDS,
  type ClearNetworkVisibilityInput,
  setNetworkOverlaysVisible,
  useClearNetworkVisibility,
} from "../../src/features/map/clearNetworkVisibility";
import { backgroundServiceFilter, hideAllLineGroups, targetTrackFilter } from "../../src/features/map/lineVisibility";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import type { MapPresentationIndex } from "../../src/features/map/mapPresentation";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const TARGET = "jr-yamanote";
const INDEX = {
  lineGroups: [{ id: "group-a" }, { id: "group-b" }],
  primitiveFeatureIdsByGroup: new Map([["group-a", ["f1", "f2"]], ["group-b", ["f3"]]]),
} as unknown as MapPresentationIndex;
const NO_GROUPS_INDEX = { lineGroups: [], primitiveFeatureIdsByGroup: new Map() } as unknown as MapPresentationIndex;
const ALL_LAYER_IDS = [LAYER_IDS.base, LAYER_IDS.services, ...CLEAR_HIDDEN_OVERLAY_LAYER_IDS, LAYER_IDS.stationCircles];

/** The slice of MapLibre the visibility code touches: filters and layout properties per layer, in call order. */
class FakeMap {
  readonly filters = new Map<string, FilterSpecification | null>();
  readonly layout = new Map<string, string>();
  readonly calls: string[] = [];
  readonly listeners = new Map<string, Set<() => void>>();
  layerIds = new Set<string>(ALL_LAYER_IDS);

  getLayer(id: string): { id: string } | undefined { return this.layerIds.has(id) ? { id } : undefined; }
  setFilter(id: string, filter: FilterSpecification | null): void {
    this.calls.push(`setFilter:${id}`);
    this.filters.set(id, filter);
  }
  setLayoutProperty(id: string, name: string, value: string): void {
    this.calls.push(`setLayoutProperty:${id}:${name}:${value}`);
    this.layout.set(id, value);
  }
  on(event: string, listener: () => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? new Set()).add(listener));
  }
  off(event: string, listener: () => void): void { this.listeners.get(event)?.delete(listener); }
  emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener(); }
  /** A replaced style: every layer is back with its default (unfiltered, visible) state. */
  replaceStyle(): void {
    this.filters.clear();
    this.layout.clear();
  }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

describe("hideAllLineGroups", () => {
  it("sets the filters a legend with no group selected would set, even for a network without groups", () => {
    const map = new FakeMap();
    hideAllLineGroups(map.asMap(), TARGET);
    expect(map.filters.get(LAYER_IDS.base)).toEqual(targetTrackFilter([], TARGET));
    expect(map.filters.get(LAYER_IDS.services)).toEqual(backgroundServiceFilter([], TARGET));
    expect(map.filters.get(LAYER_IDS.services)).toEqual([
      "all", ["!=", ["get", "serviceId"], TARGET], ["in", ["get", "featureId"], ["literal", []]],
    ]);
  });

  it("skips a background layer that is missing", () => {
    const map = new FakeMap();
    map.layerIds = new Set();
    hideAllLineGroups(map.asMap(), TARGET);
    expect(map.calls).toEqual([]);
  });
});

describe("setNetworkOverlaysVisible", () => {
  it("toggles every progress overlay and the current-service layer, and nothing else", () => {
    const map = new FakeMap();
    setNetworkOverlaysVisible(map.asMap(), false);
    expect([...map.layout.keys()].sort()).toEqual([...CLEAR_HIDDEN_OVERLAY_LAYER_IDS].sort());
    expect([...map.layout.values()].every((value) => value === "none")).toBe(true);
    expect(CLEAR_HIDDEN_OVERLAY_LAYER_IDS).toContain(LAYER_IDS.currentService);
    expect(CLEAR_HIDDEN_OVERLAY_LAYER_IDS).toContain(LAYER_IDS.segmentsCompleted);
    expect(CLEAR_HIDDEN_OVERLAY_LAYER_IDS).not.toContain(LAYER_IDS.stationCircles);
    expect(CLEAR_HIDDEN_OVERLAY_LAYER_IDS).not.toContain(LAYER_IDS.base);

    setNetworkOverlaysVisible(map.asMap(), true);
    expect([...map.layout.values()].every((value) => value === "visible")).toBe(true);
  });

  it("skips layers the map does not have", () => {
    const map = new FakeMap();
    map.layerIds = new Set([LAYER_IDS.segmentsCompleted]);
    setNetworkOverlaysVisible(map.asMap(), false);
    expect(map.calls).toEqual([`setLayoutProperty:${LAYER_IDS.segmentsCompleted}:visibility:none`]);
  });
});

describe("useClearNetworkVisibility", () => {
  let mounted: MountedReact | null = null;

  afterEach(() => {
    mounted?.cleanup();
    mounted = null;
  });

  function render(input: ClearNetworkVisibilityInput): void {
    const node = createElement(() => { useClearNetworkVisibility(input); return null; });
    if (mounted) mounted.render(node);
    else mounted = mountReact(node);
  }

  function input(map: FakeMap | null, overrides: Partial<ClearNetworkVisibilityInput> = {}): ClearNetworkVisibilityInput {
    return {
      map: map?.asMap() ?? null, layersRevision: 0, active: false, index: INDEX, selectedGroupIds: null,
      targetServiceId: TARGET, ...overrides,
    };
  }

  const LEGEND_SELECTION = new Set(["group-b"]);
  const selectionTrack = targetTrackFilter(["f3"], TARGET);
  const selectionServices = backgroundServiceFilter(["f3"], TARGET);

  it("applies the legend selection outside the clear screen and leaves the overlays alone", () => {
    const map = new FakeMap();
    render(input(map, { selectedGroupIds: LEGEND_SELECTION }));
    expect(map.filters.get(LAYER_IDS.base)).toEqual(selectionTrack);
    expect(map.filters.get(LAYER_IDS.services)).toEqual(selectionServices);
    expect(map.layout.size).toBe(0);
  });

  it("hides every coloured network overlay on entering the clear screen, whatever the legend selection was", () => {
    for (const selected of [null, LEGEND_SELECTION]) {
      const map = new FakeMap();
      mounted?.cleanup();
      mounted = null;
      render(input(map, { selectedGroupIds: selected }));
      render(input(map, { selectedGroupIds: selected, active: true }));

      expect(map.filters.get(LAYER_IDS.base)).toEqual(targetTrackFilter([], TARGET));
      expect(map.filters.get(LAYER_IDS.services)).toEqual(backgroundServiceFilter([], TARGET));
      for (const id of CLEAR_HIDDEN_OVERLAY_LAYER_IDS) expect(map.layout.get(id), id).toBe("none");
      expect(map.layout.has(LAYER_IDS.stationCircles), "stations stay as they are").toBe(false);
    }
  });

  it("empties the background lines on the clear screen even for a network without line groups", () => {
    const map = new FakeMap();
    render(input(map, { index: NO_GROUPS_INDEX, active: true }));
    expect(map.filters.get(LAYER_IDS.services)).toEqual(backgroundServiceFilter([], TARGET));
  });

  it("restores a custom legend selection and shows the overlays when the clear screen is left", () => {
    const map = new FakeMap();
    render(input(map, { selectedGroupIds: LEGEND_SELECTION }));
    render(input(map, { selectedGroupIds: LEGEND_SELECTION, active: true }));
    render(input(map, { selectedGroupIds: LEGEND_SELECTION }));

    expect(map.filters.get(LAYER_IDS.base)).toEqual(selectionTrack);
    expect(map.filters.get(LAYER_IDS.services)).toEqual(selectionServices);
    for (const id of CLEAR_HIDDEN_OVERLAY_LAYER_IDS) expect(map.layout.get(id), id).toBe("visible");
  });

  it("restores the unfiltered network when no selection was made", () => {
    const map = new FakeMap();
    render(input(map));
    render(input(map, { active: true }));
    render(input(map));
    expect(map.filters.get(LAYER_IDS.base)).toEqual(targetTrackFilter(null, TARGET));
    expect(map.filters.get(LAYER_IDS.services)).toEqual(backgroundServiceFilter(null, TARGET));
  });

  it("restores the overlays before the filters, so the network never shows with the clear state half undone", () => {
    const map = new FakeMap();
    render(input(map, { active: true }));
    map.calls.length = 0;
    render(input(map));
    const firstFilter = map.calls.findIndex((call) => call.startsWith("setFilter"));
    const lastLayout = map.calls.findLastIndex((call) => call.startsWith("setLayoutProperty"));
    expect(lastLayout).toBeGreaterThanOrEqual(0);
    expect(firstFilter).toBeGreaterThan(lastLayout);
  });

  it("applies the clear state again after a style replacement while the clear screen is open", () => {
    const map = new FakeMap();
    render(input(map, { active: true }));
    map.replaceStyle();
    expect(map.filters.size).toBe(0);

    render(input(map, { active: true, layersRevision: 1 }));
    expect(map.filters.get(LAYER_IDS.services)).toEqual(backgroundServiceFilter([], TARGET));
    for (const id of CLEAR_HIDDEN_OVERLAY_LAYER_IDS) expect(map.layout.get(id), id).toBe("none");
  });

  it("applies the legend selection again after a style replacement outside the clear screen", () => {
    const map = new FakeMap();
    render(input(map, { selectedGroupIds: LEGEND_SELECTION }));
    map.replaceStyle();
    render(input(map, { selectedGroupIds: LEGEND_SELECTION, layersRevision: 1 }));
    expect(map.filters.get(LAYER_IDS.services)).toEqual(selectionServices);
    expect(map.layout.size).toBe(0);
  });

  it("keeps the clear state when the legend selection changes during the clear screen", () => {
    const map = new FakeMap();
    render(input(map, { active: true }));
    render(input(map, { active: true, selectedGroupIds: LEGEND_SELECTION }));
    expect(map.filters.get(LAYER_IDS.services)).toEqual(backgroundServiceFilter([], TARGET));
    for (const id of CLEAR_HIDDEN_OVERLAY_LAYER_IDS) expect(map.layout.get(id), id).toBe("none");
  });

  it("does nothing before the map exists", () => {
    render(input(null, { active: true }));
    expect(mounted).not.toBeNull();
  });

  it("makes no call on a map that was already removed", () => {
    const map = new FakeMap();
    render(input(map, { active: true }));
    map.emit("remove");
    map.calls.length = 0;

    mounted?.cleanup();
    mounted = null;

    expect(map.calls).toEqual([]);
    expect(map.listeners.get("remove")?.size).toBe(0);
  });
});
