// @vitest-environment jsdom
import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "../../src/features/game/store/settings";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { playItemTurn, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import type { RollAttempt } from "../../src/features/game/animation/turnMoments";
import { resumeSession, type GameSession } from "../../src/features/game/gameSession";
import { networkFromData } from "../../src/features/game/networkFromData";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay, type TurnRevealState } from "../../src/features/game/turnMomentPresentation";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { useSegmentFlash } from "../../src/features/map/RailwayMap";
import {
  addRailwayLayers,
  clearSegmentFlash,
  type SegmentFlashRequest,
  segmentFlashOpacity,
  setSegmentFlashFeatures,
  setSegmentFlashOpacity,
} from "../../src/features/map/railwayLayers";
import type { ItemGameState } from "../../src/types/network";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

// S13: the completed-segment flash that runs concurrently with the arrival stage.

beforeEach(() => { localStorage.removeItem(SETTINGS_STORAGE_KEY); });

const { railwayMapProps } = vi.hoisted(() => ({ railwayMapProps: vi.fn() }));
vi.mock("../../src/features/analytics/analytics", async (original) => ({
  ...await original<typeof import("../../src/features/analytics/analytics")>(), trackEvent: vi.fn(),
}));
// Only the component is replaced; the real `useSegmentFlash` stays importable from the same module.
vi.mock("../../src/features/map/RailwayMap", async (original) => ({
  ...await original<typeof import("../../src/features/map/RailwayMap")>(),
  RailwayMap: (props: { segmentFlash?: SegmentFlashRequest | null }) => {
    railwayMapProps(props);
    return createElement("div");
  },
}));

const railwayData = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const networkResult = networkFromData(railwayData);
if (!networkResult.ok) throw new Error(networkResult.reason);
const network = networkResult.network;
const edition = EDITIONS[0];
const resolver = createPresentationResolver(network);
const TARGET = "jr-yamanote";
/** Peak of the single pulse, written down from the design (SEGMENT_FLASH_MAX_OPACITY). */
const PEAK = 0.85;

type Filter = ["all", unknown, ["in", unknown, ["literal", string[]]]];

function emptyFlashFilter(target = TARGET): Filter {
  return ["all", ["==", ["get", "serviceId"], target], ["in", ["get", "featureId"], ["literal", []]]];
}

function flashIds(filter: unknown): string[] {
  return (filter as Filter)[2][2][1];
}

describe("segmentFlashOpacity", () => {
  it.each([
    { elapsed: 0, duration: 800, opacity: 0 },
    { elapsed: 200, duration: 800, opacity: 0.601_04 },
    { elapsed: 400, duration: 800, opacity: 0.85 },
    { elapsed: 600, duration: 800, opacity: 0.601_04 },
    { elapsed: 800, duration: 800, opacity: 0 },
    { elapsed: 266.5, duration: 533, opacity: 0.85 },
    { elapsed: -1, duration: 800, opacity: 0 },
    { elapsed: 801, duration: 800, opacity: 0 },
    { elapsed: 5_000, duration: 800, opacity: 0 },
    { elapsed: 100, duration: 0, opacity: 0 },
    { elapsed: 100, duration: -800, opacity: 0 },
    { elapsed: Number.NaN, duration: 800, opacity: 0 },
    { elapsed: 100, duration: Number.NaN, opacity: 0 },
  ])("is $opacity at $elapsed ms of $duration ms", ({ elapsed, duration, opacity }) => {
    expect(segmentFlashOpacity(elapsed, duration)).toBeCloseTo(opacity, 4);
  });

  it("is one bounded pulse: rises once to the peak, falls once to zero, never strobes", () => {
    const samples = Array.from({ length: 801 }, (_, elapsed) => segmentFlashOpacity(elapsed, 800));
    expect(Math.max(...samples)).toBeCloseTo(PEAK, 6);
    expect(Math.min(...samples)).toBe(0);
    let directionChanges = 0;
    for (let index = 2; index < samples.length; index += 1) {
      const before = Math.sign(samples[index - 1]! - samples[index - 2]!);
      const after = Math.sign(samples[index]! - samples[index - 1]!);
      if (before !== 0 && after !== 0 && before !== after) directionChanges += 1;
    }
    expect(directionChanges).toBe(1);
  });
});

describe("flash layer", () => {
  function addedLayers(targetServiceId = TARGET): Record<string, Record<string, unknown>> {
    const layers: Record<string, Record<string, unknown>> = {};
    const map = {
      addSource: () => {},
      addLayer: (layer: { id: string }) => { layers[layer.id] = layer; },
    } as unknown as MapLibreMap;
    addRailwayLayers(map, {
      geometry: railwayData.geometry.ok ? railwayData.geometry.value : undefined,
      services: [...network.servicesById.values()],
      targetServiceId,
    });
    return layers;
  }

  it("starts empty and transparent on the segments source, target-scoped like the completed layer", () => {
    const layers = addedLayers("custom-target");
    expect(layers[LAYER_IDS.segmentsFlash]).toMatchObject({
      id: "railway-segments-flash",
      type: "line",
      source: "railway-segments",
      filter: emptyFlashFilter("custom-target"),
      paint: { "line-color": "#fff59d", "line-width": 11, "line-blur": 3, "line-opacity": 0 },
    });
    // The completed layer keeps its ID and its filter shape.
    expect(LAYER_IDS.segmentsCompleted).toBe("railway-segments-completed");
    expect(layers[LAYER_IDS.segmentsCompleted]?.filter).toEqual(emptyFlashFilter("custom-target"));
  });

  it("writes nothing while the flash layer is missing, and writes filter and opacity once it exists", () => {
    const writes: unknown[][] = [];
    let present = false;
    const map = {
      getLayer: (id: string) => (present && id === LAYER_IDS.segmentsFlash ? { id } : undefined),
      setFilter: (...args: unknown[]) => { writes.push(["filter", ...args]); },
      setPaintProperty: (...args: unknown[]) => { writes.push(["paint", ...args]); },
    } as unknown as MapLibreMap;
    setSegmentFlashFeatures(map, ["a"], TARGET);
    setSegmentFlashOpacity(map, 0.5);
    clearSegmentFlash(map, TARGET);
    expect(writes).toEqual([]);

    present = true;
    setSegmentFlashFeatures(map, ["a", "b"], TARGET);
    setSegmentFlashOpacity(map, 0.5);
    clearSegmentFlash(map, TARGET);
    expect(writes).toEqual([
      ["filter", LAYER_IDS.segmentsFlash, ["all", ["==", ["get", "serviceId"], TARGET], ["in", ["get", "featureId"], ["literal", ["a", "b"]]]]],
      ["paint", LAYER_IDS.segmentsFlash, "line-opacity", 0.5],
      ["paint", LAYER_IDS.segmentsFlash, "line-opacity", 0],
      ["filter", LAYER_IDS.segmentsFlash, emptyFlashFilter()],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Display model: which arrival flashes, and what.
// ---------------------------------------------------------------------------

describe("display.segmentFlash", () => {
  const base = itemScenario("delay", network);
  const arrived = playItemTurn(base, {}, network).state;
  const origin = resumeSession(base, network, 61);
  const session = resumeSession(arrived, network, 61);
  const required = new Set(targetSegmentIds(base.config, network));
  const fresh = arrived.completedSegmentIds.filter((id) => required.has(id) && !base.completedSegmentIds.includes(id));

  function attemptFor(overrides: Partial<RollAttempt> = {}): RollAttempt {
    const game = origin.game;
    return {
      key: `61:roll:${game.turn + 1}:0`, sessionId: 61, recordTurn: game.turn + 1, source: "click",
      origin: { stationId: game.currentStationId, ride: { serviceId: game.currentServiceId, direction: game.direction },
        completedSegmentIds: game.completedSegmentIds, turn: game.turn, itemView: null as never, previousLastMove: origin.lastMove },
      timing: { stepMs: 300, tumbleMs: 400, stampsMs: 160, arrivalMs: 533, lotteryFlipMs: 1067, lotterySettleMs: 267, pickupMs: 333 },
      stage: "released", rawRoll: 1, tumbleCompleted: true, skipRequested: false, motionOmitted: false,
      adjustObserved: false, recordAccepted: true, stampsRequired: false, newlyCompletedTargetSegmentIds: fresh,
      ...overrides,
    };
  }

  function flashOf(overrides: {
    attempt?: RollAttempt | null; revealStage?: TurnRevealState; restoredOrOmitted?: boolean;
    revealKey?: string | null; session?: GameSession;
  } = {}): SegmentFlashRequest | null {
    const current = overrides.session ?? session;
    return deriveTurnMomentDisplay({
      session: current, network, presentation: resolver,
      progress: displayedProgress(sessionProgress(current), network, null),
      attempt: overrides.attempt === undefined ? attemptFor() : overrides.attempt,
      revealStage: overrides.revealStage ?? "arrival",
      restoredOrOmitted: overrides.restoredOrOmitted ?? false,
      revealKey: overrides.revealKey === undefined ? "61:5" : overrides.revealKey,
    }).segmentFlash;
  }

  it("holds the accepted record's newly completed target features, keyed by the reveal, for the captured arrival", () => {
    expect(fresh).toEqual(["jr-yamanote:mejiro:ikebukuro", "jr-yamanote:ikebukuro:otsuka", "jr-yamanote:otsuka:sugamo"]);
    expect(flashOf()).toEqual({
      key: "61:5",
      featureIds: ["jr-yamanote:mejiro~ikebukuro", "jr-yamanote:ikebukuro~otsuka", "jr-yamanote:otsuka~sugamo"],
      durationMs: 533,
    });
  });

  it("flashes only target segments the attempt captured, never other services or a progress difference", () => {
    // Off-target and unknown IDs are dropped; one known target segment remains.
    expect(flashOf({ attempt: attemptFor({ newlyCompletedTargetSegmentIds: ["fixture-south:shinagawa:oimachi", "nope", fresh[1]!] }) }))
      .toEqual({ key: "61:5", featureIds: ["jr-yamanote:ikebukuro~otsuka"], durationMs: 533 });
    // The displayed progress gained three target segments over the origin, but the attempt captured none: no flash.
    expect(flashOf({ attempt: attemptFor({ newlyCompletedTargetSegmentIds: [] }) })).toBeNull();
  });

  it.each([
    { case: "the arrival is still waiting for the movement", input: { revealStage: "waiting" as const } },
    { case: "the reveal is done", input: { revealStage: "done" as const } },
    { case: "a later lottery stage is presented", input: { revealStage: "lottery-flip" as const } },
    { case: "the result is restored or omitted (reduced motion)", input: { restoredOrOmitted: true } },
    { case: "there is no reveal key", input: { revealKey: null } },
    { case: "there is no attempt (classic mode, resumed result)", input: { attempt: null } },
    { case: "the attempt was skipped", input: { attempt: attemptFor({ skipRequested: true, motionOmitted: true }) } },
    { case: "the attempt's motion is omitted", input: { attempt: attemptFor({ motionOmitted: true }) } },
    { case: "the record belongs to another turn", input: { attempt: attemptFor({ recordTurn: 9 }) } },
    { case: "the movement is still running", input: { session: { ...session, phase: "animating" as const } } },
  ])("is null when $case", ({ input }) => {
    expect(flashOf(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RailwayMap's local frame loop (useSegmentFlash) against a fake map.
// ---------------------------------------------------------------------------

interface FakeFlashLayer {
  map: MapLibreMap;
  /** The style currently has the flash layer. */
  present: boolean;
  filter: unknown;
  opacity: unknown;
  writes: number;
  /** Every value written, filters and opacities, in order. */
  history: unknown[];
}

function fakeFlashMap(): FakeFlashLayer {
  const layer: FakeFlashLayer = { map: null as never, present: true, filter: emptyFlashFilter(), opacity: 0, writes: 0, history: [] };
  layer.map = {
    getLayer: (id: string) => (layer.present && id === LAYER_IDS.segmentsFlash ? { id } : undefined),
    setFilter: (id: string, filter: unknown) => {
      if (!layer.present || id !== LAYER_IDS.segmentsFlash) throw new Error(`write to missing layer ${id}`);
      layer.filter = filter;
      layer.writes += 1;
      layer.history.push(filter);
    },
    setPaintProperty: (id: string, name: string, value: unknown) => {
      if (!layer.present || id !== LAYER_IDS.segmentsFlash || name !== "line-opacity") throw new Error(`bad paint write ${id}`);
      layer.opacity = value;
      layer.writes += 1;
      layer.history.push(value);
    },
  } as unknown as MapLibreMap;
  return layer;
}

/** A replaced style drops the layer; "style.load" re-adds it empty and transparent. */
function dropLayer(layer: FakeFlashLayer): void {
  layer.present = false;
  layer.filter = undefined;
  layer.opacity = undefined;
}
function readdLayer(layer: FakeFlashLayer): void {
  layer.present = true;
  layer.filter = emptyFlashFilter();
  layer.opacity = 0;
}

interface FlashHarnessProps {
  map: MapLibreMap | null;
  revision: number;
  request: SegmentFlashRequest | null;
}

function FlashHarness({ map, revision, request }: FlashHarnessProps): null {
  useSegmentFlash(map, revision, request, TARGET);
  return null;
}

const frameQueue = new Map<number, FrameRequestCallback>();
let flashLayer: FakeFlashLayer | null = null;
let clockNow = 0;
let flashMount: MountedReact | null = null;

function installFrameClock(start: number): void {
  clockNow = start;
  frameQueue.clear();
  let nextId = 1;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    frameQueue.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frameQueue.delete(id); }));
  vi.spyOn(performance, "now").mockImplementation(() => clockNow);
}

/** Run the frames queued so far at time `at` (each may queue the next one). */
function frameAt(at: number): void {
  clockNow = at;
  const due = [...frameQueue.values()];
  frameQueue.clear();
  act(() => { for (const callback of due) callback(at); });
}

function renderFlash(props: FlashHarnessProps): void {
  if (!flashMount) {
    flashMount = mountReact(createElement(FlashHarness, props));
    return;
  }
  act(() => flashMount!.root.render(createElement(FlashHarness, props)));
}

const REQUEST: SegmentFlashRequest = { key: "4:7", featureIds: ["f-1", "f-2"], durationMs: 800 };

describe("useSegmentFlash", () => {
  afterEach(() => {
    flashMount?.cleanup();
    flashMount = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the layer empty and transparent with no request, and requests no frame", () => {
    installFrameClock(1_000);
    const layer = fakeFlashMap();
    renderFlash({ map: layer.map, revision: 0, request: null });
    expect(layer.filter).toEqual(emptyFlashFilter());
    expect(layer.opacity).toBe(0);
    expect(frameQueue.size).toBe(0);
  });

  it("pulses the requested features once over the duration, then empties the layer and stops", () => {
    installFrameClock(1_000);
    const layer = fakeFlashMap();
    renderFlash({ map: layer.map, revision: 0, request: REQUEST });
    expect(flashIds(layer.filter)).toEqual(["f-1", "f-2"]);
    expect(layer.opacity).toBe(0);
    frameAt(1_200);
    expect(layer.opacity).toBeCloseTo(0.601_04, 4);
    frameAt(1_400);
    expect(layer.opacity).toBeCloseTo(PEAK, 6);
    // A re-render with an equal request (new object) neither restarts nor duplicates the loop.
    renderFlash({ map: layer.map, revision: 0, request: { ...REQUEST, featureIds: [...REQUEST.featureIds] } });
    expect(frameQueue.size).toBe(1);
    frameAt(1_600);
    expect(layer.opacity).toBeCloseTo(0.601_04, 4);
    frameAt(1_799);
    expect(flashIds(layer.filter)).toEqual(["f-1", "f-2"]);
    frameAt(1_800);
    expect(layer.filter).toEqual(emptyFlashFilter());
    expect(layer.opacity).toBe(0);
    expect(frameQueue.size).toBe(0);
  });

  it.each([
    { case: "a null request (Skip, reduced motion, arrival end, screen change)", end: () => renderFlash({ map: flashLayer!.map, revision: 0, request: null }) },
    { case: "teardown", end: () => { flashMount!.cleanup(); flashMount = null; } },
  ])("cancels the frame and clears the layer on $case", ({ end }) => {
    installFrameClock(1_000);
    flashLayer = fakeFlashMap();
    renderFlash({ map: flashLayer.map, revision: 0, request: REQUEST });
    frameAt(1_400);
    expect(flashLayer.opacity).toBeCloseTo(PEAK, 6);
    end();
    expect(flashLayer.filter).toEqual(emptyFlashFilter());
    expect(flashLayer.opacity).toBe(0);
    expect(frameQueue.size).toBe(0);
    const writes = flashLayer.writes;
    frameAt(1_500);
    expect(flashLayer.writes).toBe(writes);
  });

  it("restarts for a new key: the next arrival gets its own full pulse and only its own features", () => {
    installFrameClock(1_000);
    const layer = fakeFlashMap();
    renderFlash({ map: layer.map, revision: 0, request: REQUEST });
    frameAt(1_400);
    renderFlash({ map: layer.map, revision: 0, request: { key: "4:8", featureIds: ["f-3"], durationMs: 800 } });
    expect(flashIds(layer.filter)).toEqual(["f-3"]);
    expect(layer.opacity).toBe(0);
    expect(frameQueue.size).toBe(1);
    frameAt(1_800);
    expect(layer.opacity).toBeCloseTo(PEAK, 6);
  });

  it("reapplies the remaining flash after a style reload without resetting its deadline", () => {
    installFrameClock(1_000);
    const layer = fakeFlashMap();
    renderFlash({ map: layer.map, revision: 0, request: REQUEST });
    frameAt(1_200);
    // The style is replaced: the surviving frame callback must not write anywhere.
    dropLayer(layer);
    frameAt(1_300);
    expect(layer.filter).toBeUndefined();
    // "style.load" re-adds the empty layer and bumps the revision at 1,400 ms: the same flash resumes at its peak
    // (400 ms in), not from zero.
    clockNow = 1_400;
    readdLayer(layer);
    renderFlash({ map: layer.map, revision: 1, request: REQUEST });
    expect(flashIds(layer.filter)).toEqual(["f-1", "f-2"]);
    expect(layer.opacity).toBeCloseTo(PEAK, 6);
    expect(frameQueue.size).toBe(1);
    frameAt(1_799);
    expect(flashIds(layer.filter)).toEqual(["f-1", "f-2"]);
    frameAt(1_800);
    expect(layer.filter).toEqual(emptyFlashFilter());
    expect(layer.opacity).toBe(0);
    expect(frameQueue.size).toBe(0);
  });

  it("leaves the re-added layer empty when the deadline expired during the reload", () => {
    installFrameClock(1_000);
    const layer = fakeFlashMap();
    renderFlash({ map: layer.map, revision: 0, request: REQUEST });
    dropLayer(layer);
    frameAt(1_300);
    frameAt(1_900);
    expect(frameQueue.size).toBe(0);
    clockNow = 2_000;
    readdLayer(layer);
    const written = layer.history.length;
    renderFlash({ map: layer.map, revision: 1, request: REQUEST });
    expect(layer.filter).toEqual(emptyFlashFilter());
    expect(layer.opacity).toBe(0);
    expect(frameQueue.size).toBe(0);
    // Only clearing writes reached the new layer: no feature and no opacity above zero, then or later.
    frameAt(2_100);
    expect(layer.history.slice(written).every((value) => value === 0 || JSON.stringify(value) === JSON.stringify(emptyFlashFilter()))).toBe(true);
    expect(layer.filter).toEqual(emptyFlashFilter());
  });

  it("never throws or blocks without a map or layer, and a late map keeps the original deadline", () => {
    installFrameClock(1_000);
    renderFlash({ map: null, revision: 0, request: REQUEST });
    expect(frameQueue.size).toBe(0);
    const missing = fakeFlashMap();
    missing.present = false;
    renderFlash({ map: missing.map, revision: 0, request: REQUEST });
    frameAt(1_100);
    expect(missing.writes).toBe(0);
    // The map (with its layer) becomes available 400 ms after the request appeared: the pulse is at its peak.
    clockNow = 1_400;
    const layer = fakeFlashMap();
    renderFlash({ map: layer.map, revision: 0, request: REQUEST });
    expect(layer.opacity).toBeCloseTo(PEAK, 6);
    frameAt(1_800);
    expect(layer.filter).toEqual(emptyFlashFilter());
    expect(frameQueue.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real GameApp + useGameApp + storage: the request the map receives.
// ---------------------------------------------------------------------------

const TUMBLE_MS = 600;
const STAMPS_MS = 240;
const ARRIVAL_MS = 800;
const FAST_ARRIVAL_MS = 533;
const queuedFrames: FrameRequestCallback[] = [];
let mounted: MountedReact | undefined;

function propsFor(): React.ComponentProps<typeof GameApp> {
  return { data: railwayData, network, edition,
    picker: { editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(), focusPicker: false, onPickerFocusRestored: vi.fn() } };
}

function render(): void {
  if (!mounted) { mounted = mountReact(createElement(GameApp, propsFor())); return; }
  act(() => mounted!.root.render(createElement(GameApp, propsFor())));
}

function click(label: string): void {
  const button = [...mounted!.container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
}

function press(element: Element): void {
  dispatchReactEvent(element, new MouseEvent("click", { bubbles: true }));
}

function motionPreference(initial: boolean): (reduce: boolean) => void {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches(): boolean { return matches; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })));
  return (reduce: boolean) => act(() => { matches = reduce; listeners.forEach((listener) => listener()); });
}

/** Resume `game` through the title screen; stage timers are fake and movement frames are queued. */
function openSaved(game: ItemGameState): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  queuedFrames.length = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => queuedFrames.push(callback)));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.setItem(edition.saveKey, serializeGame(game));
  render();
  click("つづきから");
}

function advance(milliseconds: number): void {
  act(() => { vi.advanceTimersByTime(milliseconds); });
}

function finishMovement(): void {
  let now = 1_000;
  for (let guard = 0; queuedFrames.length > 0; guard += 1) {
    if (guard > 10) throw new Error("The movement did not finish");
    const callback = queuedFrames.shift()!;
    act(() => callback(now));
    now += 100_000;
  }
}

function storedGame(): ItemGameState {
  return JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
}

function adjustmentDialog(): HTMLElement | null {
  return mounted!.container.querySelector<HTMLElement>(".item-adjustment");
}

function banner(): string | null {
  return mounted!.container.querySelector(".arrival-banner__station")?.textContent ?? null;
}

function panelSkip(): HTMLButtonElement {
  return [...mounted!.container.querySelectorAll<HTMLButtonElement>(".game-panel button")]
    .find((button) => button.textContent === "スキップ" && !button.closest("dialog"))!;
}

function flash(): SegmentFlashRequest | null {
  return (railwayMapProps.mock.calls.at(-1)?.[0] as { segmentFlash?: SegmentFlashRequest | null }).segmentFlash ?? null;
}

/** Every request the map received since `from` (a call index). */
function flashesSince(from: number): (SegmentFlashRequest | null)[] {
  return railwayMapProps.mock.calls.slice(from).map(([props]) => (props as { segmentFlash?: SegmentFlashRequest | null }).segmentFlash ?? null);
}

/** Up to the end of the tumble (and stamps): the accepted movement is released but not run. */
function rollToMovement(stepScale = 1): void {
  click("サイコロを振る");
  advance(Math.round(TUMBLE_MS * stepScale));
  if (adjustmentDialog()) press(adjustmentDialog()!.querySelector<HTMLButtonElement>(".button-primary")!);
  if (mounted!.container.querySelector(".dice-tumble[data-stage='stamps']")) advance(Math.round(STAMPS_MS * stepScale));
}

function playToArrival(stepScale = 1): void {
  rollToMovement(stepScale);
  finishMovement();
}

/** Feature IDs of the target segments `after` completed that `before` had not: the engine's own oracle. */
function newlyCompletedFeatures(before: ItemGameState, after: ItemGameState): string[] {
  const required = new Set(targetSegmentIds(before.config, network));
  return [...new Set(after.completedSegmentIds
    .filter((id) => required.has(id) && !before.completedSegmentIds.includes(id))
    .flatMap((id) => network.segmentsById.get(id)!.geometryFeatureIds))];
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true,
    value(this: HTMLDialogElement): void { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true,
    value(this: HTMLDialogElement): void { this.removeAttribute("open"); } });
});

afterEach(() => {
  railwayMapProps.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  mounted?.cleanup();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("S13 flash in GameApp", () => {
  it("flashes exactly the turn's newly completed target segments during the arrival, then clears", () => {
    const base = itemScenario("delay", network);
    openSaved(base);
    expect(flash()).toBeNull();
    const before = railwayMapProps.mock.calls.length;
    rollToMovement();
    expect(storedGame().turn).toBe(base.turn + 1);
    // Tumble and movement: nothing flashes, although the movement completes segments hop by hop.
    expect(flashesSince(before).every((request) => request === null)).toBe(true);
    finishMovement();

    const expected = newlyCompletedFeatures(base, storedGame());
    expect(expected).toEqual(["jr-yamanote:mejiro~ikebukuro", "jr-yamanote:ikebukuro~otsuka", "jr-yamanote:otsuka~sugamo"]);
    expect(banner()).not.toBeNull();
    const request = flash();
    expect(request).toEqual({ key: expect.stringMatching(/^\d+:5$/), featureIds: expected, durationMs: ARRIVAL_MS });
    // Only the new segments: the completed layer carries the earlier ones too.
    const completed = (railwayMapProps.mock.calls.at(-1)?.[0] as { progress: { completedFeatureIds: string[] } }).progress.completedFeatureIds;
    expect(completed).toEqual(expect.arrayContaining(expected));
    expect(completed.length).toBeGreaterThan(expected.length);
    advance(ARRIVAL_MS - 1);
    expect(flash()).toEqual(request);
    advance(1);
    expect(banner()).toBeNull();
    expect(flash()).toBeNull();
  });

  it("uses the arrival duration captured with the roll, not a later 速度 change", () => {
    openSaved(itemScenario("delay", network));
    click("速度");
    expect(mounted!.container.textContent).toContain("速度: はやい");
    playToArrival(FAST_ARRIVAL_MS / ARRIVAL_MS);
    expect(flash()?.durationMs).toBe(FAST_ARRIVAL_MS);
    click("速度");
    expect(flash()?.durationMs).toBe(FAST_ARRIVAL_MS);
    advance(FAST_ARRIVAL_MS);
    expect(flash()).toBeNull();
  });

  it("keeps the banner but flashes nothing for a turn that completes no new target segment", () => {
    const base = itemScenario("route", network);
    openSaved(base);
    const before = railwayMapProps.mock.calls.length;
    playToArrival();
    expect(newlyCompletedFeatures(base, storedGame())).toEqual([]);
    expect(banner()).toBe("大森");
    advance(ARRIVAL_MS);
    expect(flashesSince(before).every((request) => request === null)).toBe(true);
  });

  it("flashes nothing for a resumed result, including a reload during the arrival", () => {
    openSaved(itemScenario("delay", network));
    playToArrival();
    expect(flash()).not.toBeNull();
    mounted!.cleanup();
    mounted = undefined;
    railwayMapProps.mockClear();
    render();
    click("つづきから");
    advance(ARRIVAL_MS);
    expect(banner()).toBeNull();
    expect(flashesSince(0).every((request) => request === null)).toBe(true);
  });

  it("clears the flash at once with Skip, and the next turn flashes only its own segments", () => {
    const base = itemScenario("delay", network);
    openSaved(base);
    playToArrival();
    const first = flash();
    expect(first).not.toBeNull();
    press(panelSkip());
    expect(flash()).toBeNull();
    const before = railwayMapProps.mock.calls.length;
    advance(ARRIVAL_MS);
    expect(flashesSince(before).every((request) => request === null)).toBe(true);

    const origin = storedGame();
    playToArrival();
    const next = newlyCompletedFeatures(origin, storedGame());
    expect(next).toEqual(["jr-yamanote:sugamo~komagome", "jr-yamanote:komagome~tabata", "jr-yamanote:tabata~nishi-nippori",
      "jr-yamanote:nishi-nippori~nippori", "jr-yamanote:nippori~uguisudani"]);
    expect(next.some((id) => first!.featureIds.includes(id))).toBe(false);
    expect(flash()).toEqual({ key: expect.stringMatching(/^\d+:6$/), featureIds: next, durationMs: ARRIVAL_MS });
    expect(flash()!.key).not.toBe(first!.key);
  });

  it("never flashes a turn whose movement was skipped", () => {
    openSaved(itemScenario("delay", network));
    const before = railwayMapProps.mock.calls.length;
    rollToMovement();
    press(panelSkip());
    advance(ARRIVAL_MS);
    expect(flashesSince(before).every((request) => request === null)).toBe(true);
  });

  it("never flashes under reduced motion, including reduced motion toggled on and off before the arrival", () => {
    const setReduced = motionPreference(false);
    openSaved(itemScenario("delay", network));
    const before = railwayMapProps.mock.calls.length;
    click("サイコロを振る");
    advance(TUMBLE_MS);
    setReduced(true);
    setReduced(false);
    finishMovement();
    advance(ARRIVAL_MS);
    expect(storedGame().turn).toBe(itemScenario("delay", network).turn + 1);
    expect(flashesSince(before).every((request) => request === null)).toBe(true);
  });

  it("clears the flash when reduced motion turns on during the arrival and does not replay it when turned off", () => {
    const setReduced = motionPreference(false);
    openSaved(itemScenario("delay", network));
    playToArrival();
    expect(flash()).not.toBeNull();
    setReduced(true);
    expect(flash()).toBeNull();
    const before = railwayMapProps.mock.calls.length;
    setReduced(false);
    advance(ARRIVAL_MS);
    expect(flashesSince(before).every((request) => request === null)).toBe(true);
  });

  it("clears the flash when the screen changes to the title", () => {
    openSaved(itemScenario("delay", network));
    playToArrival();
    expect(flash()).not.toBeNull();
    click("タイトル");
    expect(mounted!.container.querySelector(".game-panel")).toBeNull();
    expect(flash()).toBeNull();
  });
});
