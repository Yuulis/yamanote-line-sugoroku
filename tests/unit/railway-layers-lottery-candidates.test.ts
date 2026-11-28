// @vitest-environment jsdom
import { act, createElement } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { updateLotteryCandidates } from "../../src/features/map/railwayLayers";
import { resolveLotteryCandidateFeatureIds, useLotteryCandidateOverlay } from "../../src/features/map/useLotteryCandidateOverlay";
import { mountReact, type MountedReact } from "./helpers/reactDom";

describe("lottery candidate layer", () => {
  it("sets the filter and clears it with an empty feature list", () => {
    const map = {
      getLayer: (id: string) => id === LAYER_IDS.lotteryCandidates ? { id } : undefined,
      setFilter: vi.fn(),
    } as unknown as MapLibreMap;

    updateLotteryCandidates(map, ["feature-a", "feature-b"]);
    updateLotteryCandidates(map, []);

    expect(map.setFilter).toHaveBeenNthCalledWith(1, LAYER_IDS.lotteryCandidates,
      ["in", ["get", "featureId"], ["literal", ["feature-a", "feature-b"]]]);
    expect(map.setFilter).toHaveBeenNthCalledWith(2, LAYER_IDS.lotteryCandidates,
      ["in", ["get", "featureId"], ["literal", []]]);
  });

  it("does nothing while the candidate layer is missing", () => {
    const map = { getLayer: vi.fn(() => undefined), setFilter: vi.fn() } as unknown as MapLibreMap;

    updateLotteryCandidates(map, ["feature-a"]);

    expect(map.setFilter).not.toHaveBeenCalled();
  });

  it("resolves services to deduplicated primitive feature ids", () => {
    const geometry = new Map([
      ["north", ["feature-a", "shared-feature"]],
      ["south", ["shared-feature", "feature-b"]],
    ]);

    expect(resolveLotteryCandidateFeatureIds(["north", "south", "unknown"], geometry))
      .toEqual(["feature-a", "shared-feature", "feature-b"]);
  });
});

interface OverlayHarnessProps {
  map: MapLibreMap | null;
  revision: number;
  serviceIds: readonly string[];
  serviceGeometry: ReadonlyMap<string, readonly string[]>;
}

function OverlayHarness({ map, revision, serviceIds, serviceGeometry }: OverlayHarnessProps): null {
  useLotteryCandidateOverlay(map, revision, serviceIds, serviceGeometry);
  return null;
}

describe("useLotteryCandidateOverlay", () => {
  let mounted: MountedReact | null = null;

  afterEach(() => {
    mounted?.cleanup();
    mounted = null;
  });

  it("writes only when the resolved feature set changes by content or layersRevision changes", () => {
    const map = {
      getLayer: (id: string) => id === LAYER_IDS.lotteryCandidates ? { id } : undefined,
      setFilter: vi.fn(),
    } as unknown as MapLibreMap;
    const serviceGeometry = new Map([
      ["north", ["feature-a", "shared-feature"]],
      ["south", ["shared-feature", "feature-b"]],
    ]);
    const render = (revision: number, serviceIds: readonly string[]): void => {
      const props = { map, revision, serviceIds, serviceGeometry };
      if (!mounted) mounted = mountReact(createElement(OverlayHarness, props));
      else act(() => mounted!.root.render(createElement(OverlayHarness, props)));
    };

    render(0, []);
    expect(map.setFilter).not.toHaveBeenCalled();
    render(0, ["north", "south"]);
    expect(map.setFilter).toHaveBeenCalledTimes(1);
    render(0, ["south", "north"]);
    expect(map.setFilter).toHaveBeenCalledTimes(1);

    render(0, ["north"]);
    expect(map.setFilter).toHaveBeenCalledTimes(2);
    render(1, ["north"]);
    expect(map.setFilter).toHaveBeenCalledTimes(3);
    expect(map.setFilter).toHaveBeenLastCalledWith(LAYER_IDS.lotteryCandidates,
      ["in", ["get", "featureId"], ["literal", ["feature-a", "shared-feature"]]]);
  });
});
