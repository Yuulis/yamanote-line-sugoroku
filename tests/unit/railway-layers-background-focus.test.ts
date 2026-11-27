import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { setBackgroundFocus } from "../../src/features/map/railwayLayers";

describe("setBackgroundFocus", () => {
  it("sets focused width and opacity when enabled", () => {
    const map = {
      getLayer: vi.fn(() => ({ id: LAYER_IDS.services })),
      setPaintProperty: vi.fn(),
    } as unknown as MapLibreMap;

    setBackgroundFocus(map, true);

    expect(map.setPaintProperty).toHaveBeenNthCalledWith(1, LAYER_IDS.services, "line-width", 2);
    expect(map.setPaintProperty).toHaveBeenNthCalledWith(2, LAYER_IDS.services, "line-opacity", 0.3);
  });

  it("restores title width and opacity when disabled", () => {
    const map = {
      getLayer: vi.fn(() => ({ id: LAYER_IDS.services })),
      setPaintProperty: vi.fn(),
    } as unknown as MapLibreMap;

    setBackgroundFocus(map, false);

    expect(map.setPaintProperty).toHaveBeenNthCalledWith(1, LAYER_IDS.services, "line-width", 3);
    expect(map.setPaintProperty).toHaveBeenNthCalledWith(2, LAYER_IDS.services, "line-opacity", 0.75);
  });

  it("does nothing when the service layer is absent", () => {
    const map = {
      getLayer: vi.fn(() => undefined),
      setPaintProperty: vi.fn(),
    } as unknown as MapLibreMap;

    expect(() => setBackgroundFocus(map, true)).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });
});
