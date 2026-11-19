// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditionApp } from "../../src/app/EditionApp";
import type { EditionRegistry } from "../../src/features/editions/types";
import { FIXTURE_EDITION_A, fixtureFileResponses } from "./fixtures/editions";
import { dispatchReactEvent, flushReact, mountReact, type MountedReact } from "./helpers/reactDom";

vi.mock("../../src/features/map/RailwayMap", () => ({
  RailwayMap: (props: { mode?: string }) => createElement("div", {
    "data-testid": "railway-map",
    "data-mode": props.mode ?? "game",
  }, createElement("div", { className: "title-map-placeholder" }),
  createElement("div", { className: "maplibregl-ctrl-attrib" }, "Map attribution")),
}));

const RESPONSES = fixtureFileResponses("edition-title-states");
const EDITIONS: EditionRegistry = [FIXTURE_EDITION_A];

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function installFetch(stations?: Promise<Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const file = String(input).split("/").at(-1) ?? "";
    if (file === "stations.json" && stations) return stations;
    if (file === "stations.json" && stations === undefined && failedStations) return response({}, 500);
    const body = RESPONSES[file];
    if (body === undefined) throw new Error(`Unexpected data request: ${file}`);
    return response(body);
  });
}

let mounted: MountedReact | null = null;
let failedStations = false;

function renderEditionApp(): void {
  mounted = mountReact(createElement(EditionApp, {
    edition: EDITIONS[0],
    editions: EDITIONS,
    onEditionChange: vi.fn(),
    focusPicker: false,
    onPickerFocusRestored: vi.fn(),
  }));
}

function button(label: string): HTMLButtonElement | null {
  return [...(mounted?.container.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((candidate) => candidate.textContent?.trim() === label) ?? null;
}

function openRules(): void {
  const trigger = button("遊び方");
  if (!trigger) throw new Error("Missing 遊び方 button");
  dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
}

function closeRulesWithEscape(): void {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}

beforeEach(() => {
  failedStations = false;
  localStorage.clear();
});

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("EditionApp title states", () => {
  it("single-edition loading shows title without play actions and with rules", async () => {
    const stationResponse = deferred<Response>();
    installFetch(stationResponse.promise);
    renderEditionApp();
    await flushReact();

    expect(mounted!.container.querySelector(".title-screen")).not.toBeNull();
    expect(mounted!.container.textContent).toContain("読み込み中…");
    expect(button("はじめから")).toBeNull();
    expect(button("つづきから")).toBeNull();
    expect(button("遊び方")).not.toBeNull();
    expect(mounted!.container.querySelectorAll(".title-map-placeholder")).toHaveLength(1);
  });

  it("network failure preserves rules, attribution, and the error presentation", async () => {
    failedStations = true;
    installFetch();
    renderEditionApp();
    await flushReact();

    expect(mounted!.container.querySelector("[data-testid='railway-map']")?.getAttribute("data-mode")).toBe("title");
    expect(mounted!.container.querySelectorAll(".title-map-placeholder")).toHaveLength(1);
    expect(mounted!.container.querySelector(".maplibregl-ctrl-attrib")?.textContent).toBe("Map attribution");
    expect(mounted!.container.textContent).toContain("ゲームを開始できません");
    expect(mounted!.container.textContent).toContain("データの読み込みに失敗しました");
    expect(button("遊び方")).not.toBeNull();
    expect(button("はじめから")?.disabled).toBe(true);
  });

  it("unknown target count is omitted until network availability", async () => {
    const stationResponse = deferred<Response>();
    installFetch(stationResponse.promise);
    renderEditionApp();
    await flushReact();
    openRules();
    const goal = mounted!.container.querySelector("#title-rules-goal");
    expect(goal?.textContent).toContain("出発駅");
    expect(goal?.textContent).toContain("目標路線");
    expect(goal?.textContent).not.toMatch(/全\d+区間/);

    stationResponse.resolve(response(RESPONSES["stations.json"]));
    await flushReact();
    expect(mounted!.container.querySelector("#title-rules-goal")?.textContent).not.toMatch(/全\d+区間/);
    closeRulesWithEscape();
    await flushReact();
    openRules();
    expect(mounted!.container.querySelector("#title-rules-goal")?.textContent).toMatch(/全\d+区間/);
  });

  it("loading completion while rules are open defers the switch and restores focus", async () => {
    const stationResponse = deferred<Response>();
    installFetch(stationResponse.promise);
    renderEditionApp();
    await flushReact();
    openRules();
    stationResponse.resolve(response(RESPONSES["stations.json"]));
    await flushReact();

    expect(mounted!.container.querySelector(".title-screen__rules-screen")).not.toBeNull();
    expect(mounted!.container.querySelector("#title-rules-goal")?.textContent).not.toMatch(/全\d+区間/);
    expect(mounted!.container.querySelectorAll(".title-map-placeholder")).toHaveLength(1);
    closeRulesWithEscape();
    await flushReact();

    expect(mounted!.container.querySelector(".title-screen")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("遊び方");
  });
});
