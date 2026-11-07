// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRailwayNetwork, createGame, moveByRoll } from "../../src/features/game/engine";
import { useMoveAnimation, type MoveAnimationState } from "../../src/features/game/animation/useMoveAnimation";
import { buildGeometryIndex } from "../../src/features/game/animation/movePath";
import type { MoveAnimation } from "../../src/features/game/gameSession";
import { mountReact } from "./helpers/reactDom";
import { DEFAULT_CONFIG, yamanoteInput } from "./fixtures/yamanote";

const NETWORK = buildRailwayNetwork(yamanoteInput());
const GAME = createGame(DEFAULT_CONFIG, "move-gate", NETWORK);
const MOVE = moveByRoll(GAME, 1, NETWORK);
const GEOMETRY = buildGeometryIndex(undefined);
const ANIMATION: MoveAnimation = {
  sessionId: 2,
  turn: 1,
  fromStationId: GAME.currentStationId,
  events: MOVE.events,
};

interface HarnessProps {
  animation: MoveAnimation | null;
  startAllowed: boolean;
  onCommit: (state: MoveAnimationState) => void;
  onFinished: (animation: MoveAnimation) => void;
}

function Harness({ animation, startAllowed, onCommit, onFinished }: HarnessProps) {
  const state = useMoveAnimation(animation, NETWORK, GEOMETRY, 450, onFinished, { startAllowed });
  useLayoutEffect(() => onCommit(state));
  return createElement("output", null, state.view?.frame?.stepsCompleted ?? "origin");
}

interface InstantHarnessProps {
  startAllowed: boolean;
  onCommit: (state: MoveAnimationState) => void;
  onFinished: (animation: MoveAnimation) => void;
}

function InstantHarness({ startAllowed, onCommit, onFinished }: InstantHarnessProps) {
  const state = useMoveAnimation(ANIMATION, NETWORK, GEOMETRY, 0, onFinished, { startAllowed });
  useLayoutEffect(() => onCommit(state));
  return createElement("output", null, state.view?.frame === null ? "origin" : "frame");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useMoveAnimation start gate", () => {
  it("keeps an origin view and requests no frame while the gate is closed", () => {
    vi.useFakeTimers();
    const request = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", request);
    const commits: MoveAnimationState[] = [];
    const onCommit = (state: MoveAnimationState) => { commits.push(state); };
    const mount = mountReact(createElement(Harness, {
      animation: ANIMATION, startAllowed: false, onCommit, onFinished: vi.fn(),
    }));

    expect(commits.at(-1)?.view).toMatchObject({ fromStationId: GAME.currentStationId, frame: null });
    expect(commits.at(-1)?.livePosition.get()).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(commits.length).toBeGreaterThan(0);
    mount.cleanup();
  });

  it("starts exactly once when the gate opens and stays open across equivalent renders", () => {
    vi.useFakeTimers();
    let nextHandle = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancel = vi.fn((handle: number) => callbacks.delete(handle));
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const onCommit = vi.fn();
    const onFinished = vi.fn();
    const mount = mountReact(createElement(Harness, { animation: ANIMATION, startAllowed: false, onCommit, onFinished }));
    expect(request).toHaveBeenCalledTimes(0);

    act(() => mount.root.render(createElement(Harness, { animation: ANIMATION, startAllowed: true, onCommit, onFinished })));
    expect(request).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);
    act(() => mount.root.render(createElement(Harness, { animation: ANIMATION, startAllowed: true, onCommit, onFinished })));
    expect(request).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);
    mount.cleanup();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("finishes an instant move after the gate opens without requesting a frame", () => {
    vi.useFakeTimers();
    const request = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", request);
    const onFinished = vi.fn();
    const onCommit = vi.fn();
    const mount = mountReact(createElement(function InstantHarness() {
      const state = useMoveAnimation(ANIMATION, NETWORK, buildGeometryIndex(undefined), 0, onFinished, { startAllowed: true });
      useLayoutEffect(() => onCommit(state));
      return createElement("output");
    }));
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(ANIMATION);
    expect(request).not.toHaveBeenCalled();
    mount.cleanup();
  });

  it("releases a closed instant move only after the gate opens", () => {
    vi.useFakeTimers();
    const request = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", request);
    const onFinished = vi.fn();
    const onCommit = vi.fn();
    const mount = mountReact(createElement(InstantHarness, { startAllowed: false, onCommit, onFinished }));
    expect(onFinished).toHaveBeenCalledTimes(0);
    expect(request).toHaveBeenCalledTimes(0);
    expect(onCommit.mock.calls.at(-1)?.[0]).toMatchObject({ view: { frame: null }, livePosition: { get: expect.any(Function) } });
    expect((onCommit.mock.calls.at(-1)?.[0] as MoveAnimationState).livePosition.get()).toBeNull();
    act(() => mount.root.render(createElement(InstantHarness, { startAllowed: true, onCommit, onFinished })));
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(ANIMATION);
    expect(request).toHaveBeenCalledTimes(0);
    mount.cleanup();
  });

  it("cancels replaced movement and ignores a stale frame callback", () => {
    vi.useFakeTimers();
    let nextHandle = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancel = vi.fn((handle: number) => callbacks.delete(handle));
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const onFinished = vi.fn();
    const onCommit = vi.fn();
    const replacement: MoveAnimation = { ...ANIMATION, sessionId: 3, turn: 2 };
    const mount = mountReact(createElement(Harness, { animation: ANIMATION, startAllowed: true, onCommit, onFinished }));
    expect(request).toHaveBeenCalledTimes(1);
    const staleCallback = callbacks.values().next().value as FrameRequestCallback;
    act(() => mount.root.render(createElement(Harness, { animation: replacement, startAllowed: true, onCommit, onFinished })));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    act(() => staleCallback(1000));
    expect(onFinished).not.toHaveBeenCalled();
    expect(onCommit.mock.calls.at(-1)?.[0]).toMatchObject({ view: { fromStationId: replacement.fromStationId, frame: null } });
    mount.cleanup();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("keeps the default caller ungated", () => {
    vi.useFakeTimers();
    let nextHandle = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancel = vi.fn((handle: number) => callbacks.delete(handle));
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const onCommit = vi.fn();
    const onFinished = vi.fn();
    const mount = mountReact(createElement(function DefaultGateHarness() {
      const state = useMoveAnimation(ANIMATION, NETWORK, GEOMETRY, 450, onFinished);
      useLayoutEffect(() => onCommit(state));
      return createElement("output");
    }));
    expect(onCommit.mock.calls.at(-1)?.[0]).toMatchObject({ view: { fromStationId: GAME.currentStationId, frame: null } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(onFinished).not.toHaveBeenCalled();
    const first = callbacks.values().next().value as FrameRequestCallback;
    act(() => first(0));
    const second = callbacks.values().next().value as FrameRequestCallback;
    act(() => second(225));
    expect(onCommit.mock.calls.at(-1)?.[0]).toMatchObject({ view: { frame: { stepsCompleted: 0, done: false } } });
    expect((onCommit.mock.calls.at(-1)?.[0] as MoveAnimationState).livePosition.get()).not.toBeNull();
    mount.cleanup();
  });
});
