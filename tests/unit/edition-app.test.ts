// @vitest-environment jsdom
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { getVisibleLineGroupIds, setVisibleLineGroupIds } from "../../src/features/map/lineVisibilityStore";
import { FIXTURE_EDITIONS, fixtureFileResponses } from "./fixtures/editions";
import { dispatchReactEvent, flushReact, mountReact } from "./helpers/reactDom";

vi.mock("../../src/features/map/RailwayMap", () => ({
  RailwayMap: () => createElement("div", { "data-testid": "map" }),
}));

describe("edition app switching", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const version = url.startsWith("/fixture-b/") ? "fixture-data-b" : "fixture-data-a";
      const file = url.split("/").at(-1)!;
      const value = fixtureFileResponses(version)[file];
      return { ok: true, json: async () => value };
    }));
  });

  it("switches editions, uses their own save keys, and defaults after remount", async () => {
    const mounted = mountReact(createElement(App, { editions: FIXTURE_EDITIONS }));
    await flushReact();
    expect(mounted.container.textContent).toContain("Fixture A");
    const picker = mounted.container.querySelector("select")!;
    picker.value = "fixture-b";
    dispatchReactEvent(picker, new Event("change", { bubbles: true }));
    await flushReact();
    expect(mounted.container.textContent).toContain("Fixture B");
    expect(document.activeElement).toBe(mounted.container.querySelector("select"));
    expect(document.title).toBe("Fixture B");
    expect(localStorage.getItem(FIXTURE_EDITIONS[0].saveKey)).toBeNull();
    mounted.cleanup();

    const reloaded = mountReact(createElement(App, { editions: FIXTURE_EDITIONS }));
    await flushReact();
    expect(reloaded.container.textContent).toContain("Fixture A");
    reloaded.cleanup();
    vi.unstubAllGlobals();
  });

  it("does not access storage when switching without starting", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const mounted = mountReact(createElement(App, { editions: FIXTURE_EDITIONS }));
    await flushReact();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    mounted.container.querySelector("select")!.value = "fixture-b";
    dispatchReactEvent(mounted.container.querySelector("select")!, new Event("change", { bubbles: true }));
    await flushReact();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    mounted.cleanup();
    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
    vi.unstubAllGlobals();
  });

  it("writes a new game only into the selected edition slot and resets line visibility", async () => {
    setVisibleLineGroupIds(["old-selection"]);
    const mounted = mountReact(createElement(App, { editions: FIXTURE_EDITIONS }));
    await flushReact();
    const picker = mounted.container.querySelector("select")!;
    picker.value = "fixture-b";
    dispatchReactEvent(picker, new Event("change", { bubbles: true }));
    await flushReact();
    expect(getVisibleLineGroupIds()).toBeNull();
    const start = [...mounted.container.querySelectorAll("button")]
      .find((button) => button.textContent === "はじめから")!;
    expect(start.disabled).toBe(false);
    dispatchReactEvent(start, new MouseEvent("click", { bubbles: true }));
    await flushReact();
    expect(localStorage.getItem(FIXTURE_EDITIONS[0]!.saveKey)).toBeNull();
    expect(localStorage.getItem(FIXTURE_EDITIONS[1]!.saveKey)).not.toBeNull();
    mounted.cleanup();
    vi.unstubAllGlobals();
  });
});
