// @vitest-environment jsdom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeneficialItemKind, GameConfig, ItemGameState } from "../../src/types/network";
import {
  beginItemTurn, buildRailwayNetwork, createGame, createItemGame, playItemTurn, playTurn as playClassicTurn, serializeGame,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { GameSession } from "../../src/features/game/gameSession";
import { adjustmentOptions } from "../../src/features/game/itemSession";
import type { SaveAttempt } from "../../src/features/game/saveNotice";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { useGameApp, type GameAppControls } from "../../src/features/game/useGameApp";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { mountReact, type MountedReact } from "./helpers/reactDom";

// New games are deterministic, so a small-network game cannot finish within the scripted turns.
vi.mock("../../src/features/game/seed", () => ({ generateSeed: () => "save-attempt-seed" }));

const network = buildRailwayNetwork(multiServiceInput());
const classic = { ...multiConfig(), rulesetVersion: "save-attempt-classic-1" };
const items: GameConfig = { ...multiConfig(), rulesetVersion: "save-attempt-items-1",
  itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille: 0 } };
const SAVE_KEY = "test-save";
const MAX_SETTLE_STEPS = 20;
const mounted: MountedReact[] = [];
afterEach(() => { mounted.splice(0).forEach((mount) => mount.cleanup()); });

interface Recorder { app: () => GameAppControls; attempts: SaveAttempt[]; writes: string[] }

function storage(fail = false): StorageLike & { writes: string[] } {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => {
      writes.push(value);
      if (fail) throw new Error("quota");
      data.set(key, value);
    },
  };
}
function mountApp(config: GameConfig, store = storage(), strict = true): Recorder {
  const attempts: SaveAttempt[] = [];
  let controls: GameAppControls;
  function Harness(): null {
    const app = useGameApp(network, store, config, SAVE_KEY);
    useLayoutEffect(() => {
      controls = app;
      if (app.saveAttempt && app.saveAttempt !== attempts.at(-1)) attempts.push(app.saveAttempt);
    });
    return null;
  }
  const node = createElement(Harness);
  mounted.push(mountReact(strict ? createElement(StrictMode, null, node) : node));
  return { app: () => controls!, attempts, writes: store.writes };
}
function session(app: GameAppControls): GameSession {
  if (app.state.screen !== "game") throw new Error("Expected game screen");
  return app.state.session;
}
/** Resolve every decision and animation until the session is idle. */
function settle({ app }: Recorder): void {
  for (let step = 0, current = session(app()); current.phase !== "idle"; step++, current = session(app())) {
    if (step === MAX_SETTLE_STEPS) throw new Error(`Session stuck in ${current.phase}`);
    const game = current.game as ItemGameState;
    if (current.phase === "awaiting-adjust") {
      act(() => app().adjustItemRoll(null));
      continue;
    }
    if (current.phase === "awaiting-discard" && game.pending?.kind === "discard") {
      const choice = game.pending.candidates[0];
      if (!choice) throw new Error("Expected a discard candidate");
      act(() => app().discardItem(choice.id));
      continue;
    }
    const animation = current.animation;
    if (!animation) throw new Error(`Unexpected phase ${current.phase}`);
    act(() => app().finishAnimation(animation));
  }
}
function playTurn(recorder: Recorder): void {
  act(() => recorder.app().roll());
  settle(recorder);
}
function trace(attempts: readonly SaveAttempt[]): unknown[] {
  return attempts.map(({ id, sessionId, game, result, entryTurn }) => [id, sessionId, game.turn, result, entryTurn]);
}
/** A persisted item game at turn >= 1 holding `kind` (no pending) or waiting for a discard. */
function itemFixture(kind: "roll" | "discard"): ItemGameState {
  const policy = { ...items.itemPolicy!, dropChancePerMille: 1000, harmfulChancePercent: 0,
    beneficialKinds: [kind === "roll" ? "roll-adjust" : "double"] as BeneficialItemKind[] };
  for (let seed = 0; seed < 100; seed++) {
    let game = createItemGame({ ...items, itemPolicy: policy }, `attempt-${seed}`, network);
    for (let turn = 0; turn < 30 && game.status === "playing"; turn++) {
      game = playItemTurn(game, {}, network).state;
      if (kind === "discard" && game.pending?.kind === "discard") return game;
      if (kind === "roll" && game.inventory.length > 0 && !game.pending) return game;
    }
  }
  throw new Error(`No ${kind} fixture found`);
}
function pendingRoll(): ItemGameState {
  const pending = beginItemTurn(itemFixture("roll"), { items: [] }, network).state;
  if (pending.pending?.kind !== "roll" || adjustmentOptions(pending).length === 0) throw new Error("Expected a pending roll");
  return pending;
}

describe("save attempt identity", () => {
  it("publishes one attempt per distinct write", () => {
    // An item turn first saves its revealed pending roll, then the resolved turn.
    for (const [config, turns] of [[classic, [0, 1, 2]], [items, [0, 0, 1, 1, 2]]] as const) {
      const recorder = mountApp(config);
      act(() => recorder.app().newGame());
      playTurn(recorder);
      playTurn(recorder);
      expect(trace(recorder.attempts)).toEqual(turns.map((turn, index) => [index + 1, 1, turn, "saved", 0]));
      expect(recorder.writes).toHaveLength(turns.length);
      expect(recorder.app().saveAttempt).toBe(recorder.attempts.at(-1));
      expect(recorder.app().saveStatus).toBe("saved");
    }
  });

  it("deduplicates classic and item writes without losing acknowledgements", () => {
    const classicGame = playClassicTurn(createGame(classic, "save-attempt-classic", network), network).state;
    const resumed = mountApp(classic);
    act(() => resumed.app().resume(classicGame));
    expect(resumed.writes).toEqual([serializeGame(classicGame)]);
    expect(trace(resumed.attempts)).toEqual([[1, 1, classicGame.turn, "saved", classicGame.turn]]);
    for (const fail of [false, true]) {
      const result = fail ? "failed" : "saved";
      for (const game of [pendingRoll(), itemFixture("discard")]) {
        const recorder = mountApp(items, storage(fail));
        act(() => recorder.app().resume(game));
        expect(session(recorder.app()).phase).toMatch(/^awaiting-(adjust|discard)$/);
        settle(recorder);
        expect(session(recorder.app()).game.turn).toBe(game.turn + 1);
        expect(recorder.writes).toEqual([serializeGame(game), serializeGame(session(recorder.app()).game)]);
        expect(recorder.attempts.map((attempt) => [attempt.id, attempt.result])).toEqual([[1, result], [2, result]]);
        expect(recorder.attempts[1]?.game).toBe(session(recorder.app()).game);
      }
    }
  });

  it("retains attempt identity across phase changes and StrictMode", () => {
    const runs = [true, false].map((strict) => {
      const recorder = mountApp(items, storage(), strict);
      act(() => recorder.app().resume(pendingRoll()));
      act(() => recorder.app().adjustItemRoll(null));
      const resolved = recorder.app().saveAttempt;
      settle(recorder);
      expect(recorder.app().saveAttempt).toBe(resolved);
      playTurn(recorder);
      expect(recorder.writes).toHaveLength(recorder.attempts.length);
      return trace(recorder.attempts);
    });
    expect(runs[0]).toEqual(runs[1]);
  });

  it("records entry turn for new, resumed, pending roll and pending discard sessions", () => {
    const roll = pendingRoll();
    const discard = itemFixture("discard");
    expect(roll.pending?.turn).toBe(roll.turn + 1);
    expect(discard.pending?.turn).toBe(discard.turn + 1);
    // A revealed roll without adjustment options resolves while the session is created.
    const automatic = beginItemTurn(createItemGame(items, "save-attempt-seed", network), { items: [] }, network).state;
    expect(automatic.pending?.kind === "roll" && adjustmentOptions(automatic)).toEqual([]);
    const recorder = mountApp(items);
    const resumed = itemFixture("roll");
    const entries: [() => void, number][] = [
      [() => recorder.app().newGame(), 0],
      [() => recorder.app().resume(resumed), resumed.turn],
      [() => recorder.app().resume(roll), roll.turn],
      [() => recorder.app().resume(discard), discard.turn],
      [() => recorder.app().resume(automatic), automatic.turn + 1],
    ];
    for (const [enter] of entries) {
      if (recorder.app().state.screen === "game") act(() => recorder.app().showTitle());
      act(enter);
      settle(recorder);
      // Two more turns at most; a short fixture may finish the game first.
      for (let rolls = 0; rolls < 2 && session(recorder.app()).game.status === "playing"; rolls++) playTurn(recorder);
    }
    entries.forEach(([, turn], index) => {
      const attempts = recorder.attempts.filter((attempt) => attempt.sessionId === index + 1);
      expect(attempts.map((attempt) => attempt.entryTurn)).toEqual(attempts.map(() => turn));
      expect(attempts[0]?.game.turn).toBe(turn);
      expect(attempts.map((attempt) => attempt.game.turn)).toContain(turn + 1);
    });
  });

  it("isolates sessions", () => {
    const game = itemFixture("roll");
    const recorder = mountApp(items);
    act(() => recorder.app().resume(game));
    act(() => recorder.app().showTitle());
    expect(recorder.app().saveAttempt?.sessionId).toBe(1);
    act(() => recorder.app().resume(game));
    expect(session(recorder.app()).game).toBe(game);
    expect(trace(recorder.attempts)).toEqual([[1, 1, game.turn, "saved", game.turn], [2, 2, game.turn, "saved", game.turn]]);
    expect(recorder.writes).toHaveLength(2);
    act(() => recorder.app().showTitle());
    act(() => recorder.app().newGame());
    expect(trace(recorder.attempts).at(-1)).toEqual([3, 3, 0, "saved", 0]);
  });
});
