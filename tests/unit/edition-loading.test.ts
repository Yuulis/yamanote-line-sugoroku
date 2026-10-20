// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { FIXTURE_EDITIONS, fixtureFileResponses } from "./fixtures/editions";
import { dispatchReactEvent, flushReact, mountReact } from "./helpers/reactDom";

vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: () => createElement("div") }));

describe("edition loading", () => {
  it("keeps the picker on an invalid bundle and updates title on a switch", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const filename = url.split("/").at(-1)!;
      const values = fixtureFileResponses("fixture-data-b");
      if (url.startsWith("/fixture-a/") && filename === "manifest.json") {
        return { ok: true, json: async () => ({ schemaVersion: 1 }) };
      }
      return { ok: true, json: async () => values[filename] };
    }));
    const mounted = mountReact(createElement(App, { editions: FIXTURE_EDITIONS }));
    await flushReact();
    expect(mounted.container.querySelector("select")).not.toBeNull();
    expect(mounted.container.textContent).toContain("ゲームを開始できません");
    expect(document.title).toBe("Fixture A");
    const picker = mounted.container.querySelector("select")!;
    picker.value = "fixture-b";
    dispatchReactEvent(picker, new Event("change", { bubbles: true }));
    await flushReact();
    expect(document.title).toBe("Fixture B");
    mounted.cleanup();
    vi.unstubAllGlobals();
  });

  it("ignores an obsolete response after switching editions", async () => {
    localStorage.clear();
    let releaseA!: () => void;
    const waitForA = new Promise<void>((resolve) => { releaseA = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/fixture-a/")) await waitForA;
      const file = url.split("/").at(-1)!;
      const version = url.startsWith("/fixture-a/") ? "fixture-data-a" : "fixture-data-b";
      return { ok: true, json: async () => fixtureFileResponses(version)[file] };
    }));
    const mounted = mountReact(createElement(App, { editions: FIXTURE_EDITIONS }));
    await flushReact();
    const picker = mounted.container.querySelector("select")!;
    picker.value = "fixture-b";
    dispatchReactEvent(picker, new Event("change", { bubbles: true }));
    await flushReact();
    expect(mounted.container.textContent).toContain("Fixture B");
    releaseA();
    await flushReact();
    expect(mounted.container.textContent).toContain("Fixture B");
    expect(document.title).toBe("Fixture B");
    mounted.cleanup();
    vi.unstubAllGlobals();
  });
});
