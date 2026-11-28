// @vitest-environment jsdom
import {
  fitOptions, mapState, navigationControlCount, ready, render, TARGET_SERVICE_ID,
} from "./helpers/railwayMapHarness";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { hideAllLineGroups, updateLineGroupVisibility } from "../../src/features/map/lineVisibility";
import { bindStationInteractions, type StationSelection } from "../../src/features/map/stationInteraction";

describe("clear route on the map", () => {
  const ROUTE_STEP = {
    segmentId: "s", fromStationId: "a", toStationId: "b", newlyCompleted: false,
    points: [[139.7, 35.6], [139.8, 35.7]] as [number, number][], cumulative: [0, 1], total: 1,
  };
  const ROUTE = {
    steps: [ROUTE_STEP],
    legs: [{ firstStepIndex: 0, endStepIndexExclusive: 1, serviceId: "svc", lineGroupId: "grp", color: "#123456" }],
    bounds: [[139.7, 35.6], [139.8, 35.7]] as [[number, number], [number, number]],
  };
  const CARD_RECT = new DOMRect(420, 40, 440, 720);

  function clearProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const card = document.createElement("section");
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(CARD_RECT);
    return { clearRoute: ROUTE, clearRouteKey: 1, clearCardRef: { current: card }, ...overrides };
  }

  it("draws the route below the station layers and fits it beside the clear card", () => {
    const map = ready("clear", clearProps());

    expect(map.order).toContain("addSource:clear-traveled-route");
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "clear-traveled-route-outline", "clear-traveled-route-line", "railway-stations-circle",
    ]);
    expect(map.sources.get("clear-traveled-route")?.data.features).toHaveLength(1);
    expect(map.calls.fit).toHaveLength(1);
    expect(fitOptions(map)).toMatchObject({ animate: false, maxZoom: 13, padding: { left: 24, right: 1280 - 420 + 24 } });
  });

  it("draws and frames nothing for a clear without a verified route", () => {
    const map = ready("clear", clearProps({ clearRoute: null }));

    expect(map.sources.size).toBe(0);
    expect(map.calls.fit).toHaveLength(0);
    expect(map.calls.padding).toHaveLength(0);
  });

  it("draws the route again when a replaced style dropped it, and never outside the clear screen", () => {
    const props = clearProps();
    const map = ready("clear", props);
    map.sources.clear();
    map.layers = [{ id: "railway-stations-circle", type: "circle" }];
    map.order.length = 0;
    act(() => map.emit("style.load"));
    expect(map.order, "the style.load of the replaced style bumps the revision").toContain("addSource:clear-traveled-route");
    expect(map.sources.get("clear-traveled-route")?.data.features).toHaveLength(1);

    render("game", props);
    expect(map.sources.size).toBe(0);
    expect(map.layers.map((layer) => layer.id)).toEqual(["railway-stations-circle"]);
  });

  it("removes the route and restores the entry padding before the game camera acts when the clear screen is left", () => {
    const props = clearProps();
    const map = ready("clear", props);
    map.order.length = 0;

    render("game", { ...props, overviewKey: 3 });

    const restore = map.order.indexOf("setPadding");
    expect(map.order.slice(0, 4)).toEqual([
      "removeLayer:clear-traveled-route-line", "removeLayer:clear-traveled-route-outline",
      "removeSource:clear-traveled-route", "setPadding",
    ]);
    expect(map.calls.padding.find((padding) => (padding as { bottom: number }).bottom === 200), "entry padding is restored").toBeDefined();
    const gameFit = map.order.indexOf("fitBounds");
    expect(gameFit, "the overview fit of the game screen comes after the restore").toBeGreaterThan(restore);
  });

  it("empties the coloured network on the clear screen and applies the legend selection again outside it", () => {
    vi.mocked(hideAllLineGroups).mockClear();
    vi.mocked(updateLineGroupVisibility).mockClear();
    const props = clearProps();
    const map = ready("game", props);
    expect(hideAllLineGroups).not.toHaveBeenCalled();
    expect(updateLineGroupVisibility).toHaveBeenCalled();

    vi.mocked(updateLineGroupVisibility).mockClear();
    render("clear", props);
    expect(hideAllLineGroups).toHaveBeenCalledWith(map, TARGET_SERVICE_ID);
    expect(updateLineGroupVisibility, "the legend selection is not applied while the clear screen owns the map").not.toHaveBeenCalled();

    render("game", props);
    expect(updateLineGroupVisibility).toHaveBeenCalledWith(map, expect.anything(), null, TARGET_SERVICE_ID);
  });

  it("keeps the map controls out of the clear screen while the route is shown", () => {
    const map = ready("clear", clearProps());
    expect(navigationControlCount(map)).toBe(0);
    expect(map.container.parentElement?.querySelector(".map-overview")).toBeNull();
  });

  it("removes the canvas from Tab in clear mode, blurs pointer focus, restores its tab index and keeps attribution reachable", () => {
    const map = ready("game", { inert: true });
    map.canvas.setAttribute("tabindex", "3");

    render("clear", { inert: true, ...clearProps() });
    expect(map.canvas.getAttribute("tabindex")).toBe("-1");
    expect(map.container.parentElement?.hasAttribute("inert")).toBe(false);

    act(() => {
      map.canvas.dispatchEvent(new Event("pointerdown"));
      map.canvas.focus();
    });
    expect(document.activeElement, "pointer interaction does not leave focus on the canvas").not.toBe(map.canvas);

    const attributionSummary = map.container.querySelector<HTMLElement>(".maplibregl-ctrl-attrib summary");
    expect(attributionSummary).not.toBeNull();
    act(() => attributionSummary?.focus());
    expect(document.activeElement, "the attribution remains keyboard reachable").toBe(attributionSummary);

    render("game");
    expect(map.canvas.getAttribute("tabindex"), "the persistent map restores its entry value").toBe("3");
  });

  it("closes a station popup left open from gameplay when the clear screen opens", () => {
    const selection = { current: null as ((station: StationSelection) => void) | null };
    vi.mocked(bindStationInteractions).mockImplementation((_map, onSelect) => {
      selection.current = onSelect;
    });
    ready("game");
    selection.current?.({ name: "東京", lineNames: "山手線", lngLat: [139.767, 35.681] });
    expect(mapState.openedPopups).toBe(1);
    expect(mapState.removedPopups).toBe(0);

    render("clear", clearProps());
    expect(mapState.removedPopups, "the gameplay popup is closed on entering clear").toBe(1);

    render("title");
    expect(mapState.removedPopups, "leaving clear does not remove it twice").toBe(1);
  });

  it("does not open station popups in clear mode", () => {
    const selection = { current: null as ((station: StationSelection) => void) | null };
    vi.mocked(bindStationInteractions).mockImplementation((_map, onSelect) => {
      selection.current = onSelect;
    });
    ready("game");
    render("clear", clearProps());

    selection.current?.({ name: "東京", lineNames: "山手線", lngLat: [139.767, 35.681] });
    expect(mapState.openedPopups).toBe(0);

    render("game");
    selection.current?.({ name: "東京", lineNames: "山手線", lngLat: [139.767, 35.681] });
    expect(mapState.openedPopups).toBe(1);
  });
});
