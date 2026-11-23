// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EDITIONS } from "../../src/features/editions/registry";
import type { GeometryIndex } from "../../src/features/game/animation/movePath";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import {
  usePublishedClearResult, type PublishedClear, type PublishedClearInput,
} from "../../src/features/game/usePublishedClearResult";
import type { GameState } from "../../src/types/network";
import { M_START, multiServiceInput } from "./fixtures/multiService";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const network = buildRailwayNetwork(multiServiceInput());
const presentation = createPresentationResolver(network);
const geometry: GeometryIndex = new Map();
const replaySegment = network.segmentsById.get("m-loop:start:a")!;
const replayService = network.servicesById.get("m-loop")!;
const replayGeometry: GeometryIndex = new Map([[replaySegment.geometryFeatureIds[0]!, {
  fromStationId: M_START,
  toStationId: "a",
  points: [replayService.platformCoordinates[M_START]!, replayService.platformCoordinates.a!],
}]]);
const display = EDITIONS[0]!.display;

function gameWith(turn: number): GameState {
  return { turn, movementHistory: [], config: { startStationId: M_START, targetServiceId: "m-loop" } } as unknown as GameState;
}

const base: PublishedClearInput = { sessionId: 1, game: gameWith(5), network, geometry, presentation, display };

let mounted: MountedReact | undefined;
afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
});

function mountHook(initial: PublishedClearInput, strict = false): { latest: () => PublishedClear | null; update: (input: PublishedClearInput) => void } {
  let latest: PublishedClear | null = null;
  const Harness = (props: { input: PublishedClearInput }): null => {
    latest = usePublishedClearResult(props.input);
    return null;
  };
  const render = (input: PublishedClearInput) => {
    const harness = createElement(Harness, { input });
    return strict ? createElement(StrictMode, null, harness) : harness;
  };
  mounted = mountReact(render(initial));
  return {
    latest: () => latest,
    update: (input) => act(() => mounted!.root.render(render(input))),
  };
}

describe("usePublishedClearResult", () => {
  it("publishes nothing while no clear is shown", () => {
    expect(mountHook({ ...base, game: null }).latest()).toBeNull();
  });

  it("derives the result and starts at generation 1 on the first publication", () => {
    const published = mountHook(base).latest();
    expect(published?.generation).toBe(1);
    expect(published?.game).toBe(base.game);
    expect(published?.result.summary).toEqual({ turns: 5, moves: 0, transfers: 0 });
  });

  it("starts a route-bearing replay after StrictMode replays its effect lifecycle", () => {
    const routeGame = {
      ...gameWith(1),
      status: "completed",
      currentStationId: "a",
      movementHistory: [{
        turn: 1, roll: 1, serviceId: "m-loop", direction: 1, fromStationId: M_START, toStationId: "a",
        traversedSegmentIds: [replaySegment.id], stopReason: "roll", landing: null,
      }],
    } as unknown as GameState;
    const hook = mountHook({ ...base, game: routeGame, geometry: replayGeometry }, true);
    expect(hook.latest()?.result.route?.steps).toHaveLength(1);
    act(() => hook.latest()!.replayStore.start());
    expect(hook.latest()?.replayStore.getPhase()).toBe("playing");
  });

  it("keeps the generation and the result for the same game across re-renders", () => {
    const hook = mountHook(base);
    const first = hook.latest()!;
    first.replayStore.setSpeed("fast");
    hook.update({ ...base });
    expect(hook.latest()?.generation).toBe(first.generation);
    expect(hook.latest()?.result).toBe(first.result);
    expect(hook.latest()?.replayStore).toBe(first.replayStore);
    expect(hook.latest()?.replayStore.getSpeed()).toBe("fast");
  });

  it("derives again for a new game reference without starting a new generation, whatever the history length", () => {
    const hook = mountHook(base);
    const first = hook.latest()!;
    hook.update({ ...base, game: { ...base.game!, turn: 6 } as GameState });
    expect(hook.latest()?.generation).toBe(first.generation);
    expect(hook.latest()?.result).not.toBe(first.result);
    expect(hook.latest()?.result.summary.turns).toBe(6);
  });

  it.each([
    ["geometry", { geometry: new Map() as GeometryIndex }],
    ["presentation", { presentation: createPresentationResolver(network) }],
    ["display", { display: { ...display } }],
    ["network", { network: buildRailwayNetwork(multiServiceInput()) }],
  ])("derives again when the %s reference changes, within the same publication", (_name, change) => {
    const hook = mountHook(base);
    const first = hook.latest()!;
    hook.update({ ...base, ...change });
    expect(hook.latest()?.generation).toBe(first.generation);
    expect(hook.latest()?.result).not.toBe(first.result);
  });

  it("increases the generation for every new publication, after a gap or for another session", () => {
    const hook = mountHook(base);
    const first = hook.latest()!;
    first.replayStore.setSpeed("fast");
    expect(first.generation).toBe(1);
    hook.update({ ...base, game: null, sessionId: null });
    expect(hook.latest()).toBeNull();
    hook.update(base);
    expect(hook.latest()?.generation).toBe(2);
    expect(hook.latest()?.replayStore).not.toBe(first.replayStore);
    expect(hook.latest()?.replayStore.getSpeed()).toBe("normal");
    hook.update({ ...base, sessionId: 2, game: gameWith(9) });
    expect(hook.latest()?.generation).toBe(3);
    hook.update({ ...base, game: null, sessionId: null });
    hook.update({ ...base, sessionId: 2, game: gameWith(9) });
    expect(hook.latest()?.generation).toBe(4);
  });
});
