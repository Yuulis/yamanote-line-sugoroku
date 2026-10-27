import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame, isItemSave, moveByRoll, playTurn } from "../../src/features/game/engine";
import {
  type AppAction,
  type AppState,
  type GameSession,
  INITIAL_APP_STATE,
  lastMoveOf,
  reduceAppState,
  reduceGameSession,
  resumeSession,
  startSession,
} from "../../src/features/game/gameSession";
import { earlyStopNote, summarizeGame, unusedPipsOf } from "../../src/features/game/gameSummary";
import { M_LINE, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { DEFAULT_CONFIG, START, yamanoteInput } from "./fixtures/yamanote";

const network = buildRailwayNetwork(yamanoteInput());

function reduce(session: GameSession, action: Parameters<typeof reduceGameSession>[1]) {
  return reduceGameSession(session, action, DEFAULT_CONFIG, network);
}

function reduceApp(state: AppState, action: AppAction): AppState {
  return reduceAppState(state, action, DEFAULT_CONFIG, network);
}

function rollAction(session: GameSession) {
  return {
    type: "roll",
    sessionId: session.sessionId,
    rngSeed: session.game.rngSeed,
    turn: session.game.turn,
  } as const;
}

function finishAction(session: GameSession) {
  return {
    type: "animation-finished",
    sessionId: session.sessionId,
    turn: session.game.turn,
  } as const;
}

function inGame(state: AppState): GameSession {
  if (state.screen !== "game") throw new Error("expected the game screen");
  return state.session;
}

describe("move animation lifecycle", () => {
  it("commits the turn before animating and records what to animate", () => {
    const start = startSession(DEFAULT_CONFIG, "anim", network, 4);
    if (isItemSave(start.game)) throw new Error("Expected classic session");
    const expected = playTurn(start.game, network);
    const rolled = reduce(start, rollAction(start));
    expect(rolled.game).toEqual(expected.state);
    expect(rolled.animation).toEqual({
      sessionId: 4,
      turn: 1,
      fromStationId: START,
      events: expected.events,
    });
  });

  it("never applies a second turn while animating, even with a fresh click", () => {
    const start = startSession(DEFAULT_CONFIG, "anim", network);
    const rolled = reduce(start, rollAction(start));
    expect(reduce(rolled, rollAction(rolled))).toBe(rolled);
    expect(reduce(rolled, rollAction(start))).toBe(rolled);
  });

  it("finishes once; a second finish (skip racing the last frame) is ignored", () => {
    const start = startSession(DEFAULT_CONFIG, "anim", network);
    const rolled = reduce(start, rollAction(start));
    const finished = reduce(rolled, finishAction(rolled));
    expect(finished).toMatchObject({ phase: "idle", animation: null });
    expect(reduce(finished, finishAction(rolled))).toBe(finished);
  });

  it("ignores a finish for another session or turn", () => {
    const start = startSession(DEFAULT_CONFIG, "anim", network, 2);
    const rolled = reduce(start, rollAction(start));
    expect(reduce(rolled, { type: "animation-finished", sessionId: 1, turn: 1 })).toBe(rolled);
    expect(reduce(rolled, { type: "animation-finished", sessionId: 2, turn: 0 })).toBe(rolled);
  });

  it("ignores a click from before resuming the very same save", () => {
    const saved = moveByRoll(createGame(DEFAULT_CONFIG, "same", network), 2, network).state;
    const first = resumeSession(saved, network, 1);
    const staleClick = rollAction(first);
    const resumedAgain = reduce(first, { type: "resume", game: saved });
    expect(resumedAgain.game).toBe(saved);
    expect(reduce(resumedAgain, staleClick)).toBe(resumedAgain);
    expect(reduce(resumedAgain, rollAction(resumedAgain)).game.turn).toBe(2);
  });

  it("does not let an old game's finish end the new game's animation", () => {
    const first = startSession(DEFAULT_CONFIG, "same-seed", network);
    const oldMove = reduce(first, rollAction(first));
    // Restart with the same seed: same (seed, turn) pair, different session.
    const restarted = reduce(oldMove, { type: "new-game", seed: "same-seed" });
    const newMove = reduce(restarted, rollAction(restarted));
    expect(newMove.game.turn).toBe(oldMove.game.turn);
    expect(reduce(newMove, finishAction(oldMove))).toBe(newMove);
  });

  it("locks the dice during each move and for good after the clearing move", () => {
    let state = createGame(DEFAULT_CONFIG, "clear", network);
    for (const roll of [6, 6, 6, 6, 5]) state = moveByRoll(state, roll, network).state;
    let session = resumeSession(state, network, 1);
    while (session.game.status === "playing") {
      const rolled = reduce(session, rollAction(session));
      expect(reduce(rolled, rollAction(rolled))).toBe(rolled);
      session = reduce(rolled, finishAction(rolled));
    }
    expect(session).toMatchObject({ phase: "idle", game: { status: "completed" } });
    expect(reduce(session, rollAction(session))).toBe(session);
  });
});

describe("resume", () => {
  it("resumes idle with the last roll restored and no animation", () => {
    let game = createGame(DEFAULT_CONFIG, "resume", network);
    game = moveByRoll(game, 4, network).state;
    const session = resumeSession(game, network, 3);
    expect(session).toEqual({
      sessionId: 3,
      game,
      phase: "idle",
      lastMove: {
        roll: 4, unusedPips: 0, stopReason: "roll", stopStationId: "shinagawa",
        serviceId: "jr-yamanote", direction: 1, endpointKind: null,
        landing: { type: "landing-resolved", stationId: "shinagawa", serviceCandidates: ["jr-yamanote"], serviceId: "jr-yamanote", serviceDrawRequired: false, directionCandidates: [1], direction: 1, directionDrawRequired: false, changedService: false },
      },
      animation: null,
    });
  });

  it("restores unused pips of a truncated final move", () => {
    let game = createGame(DEFAULT_CONFIG, "resume", network);
    for (const roll of [6, 6, 6, 6, 3, 6]) game = moveByRoll(game, roll, network).state;
    expect(lastMoveOf(game, network)).toEqual({
      roll: 6,
      unusedPips: 3,
      stopReason: "goal",
      stopStationId: START,
      serviceId: "jr-yamanote", direction: 1, endpointKind: null, landing: null,
    });
    expect(lastMoveOf(createGame(DEFAULT_CONFIG, "x", network), network)).toBeNull();
  });
});

describe("reduceAppState", () => {
  it("starts on the title screen and ignores game actions there", () => {
    expect(INITIAL_APP_STATE.screen).toBe("title");
    const roll = { type: "roll", sessionId: 0, rngSeed: "x", turn: 0 } as const;
    expect(reduceApp(INITIAL_APP_STATE, roll)).toBe(INITIAL_APP_STATE);
    const finish = { type: "animation-finished", sessionId: 0, turn: 0 } as const;
    expect(reduceApp(INITIAL_APP_STATE, finish)).toBe(INITIAL_APP_STATE);
  });

  it("starts a new game or resumes a saved one from the title", () => {
    const fresh = inGame(reduceApp(INITIAL_APP_STATE, { type: "new-game", seed: "a" }));
    expect(fresh.game).toMatchObject({ rngSeed: "a", turn: 0, currentStationId: START });
    const saved = moveByRoll(createGame(DEFAULT_CONFIG, "b", network), 2, network).state;
    const resumed = inGame(reduceApp(INITIAL_APP_STATE, { type: "resume", game: saved }));
    expect(resumed.game).toBe(saved);
    expect(resumed.phase).toBe("idle");
  });

  it("gives every game a new session id, also across the title screen", () => {
    const first = reduceApp(INITIAL_APP_STATE, { type: "new-game", seed: "a" });
    const firstId = inGame(first).sessionId;
    const title = reduceApp(first, { type: "show-title" });
    expect(title).toEqual({ screen: "title", lastSessionId: firstId });
    const second = inGame(reduceApp(title, { type: "resume", game: inGame(first).game }));
    expect(second.sessionId).toBeGreaterThan(firstId);
    const third = inGame(reduceApp({ screen: "game", session: second }, { type: "new-game", seed: "c" }));
    expect(third.sessionId).toBeGreaterThan(second.sessionId);
  });

  it("returning to the title mid-animation drops the animation", () => {
    const game = reduceApp(INITIAL_APP_STATE, { type: "new-game", seed: "a" });
    const rolled = reduceApp(game, rollAction(inGame(game)));
    expect(inGame(rolled).phase).toBe("animating");
    const title = reduceApp(rolled, { type: "show-title" });
    expect(title.screen).toBe("title");
    expect(reduceApp(title, finishAction(inGame(rolled)))).toBe(title);
  });

  it("returns the same state object for ignored actions", () => {
    const game = reduceApp(INITIAL_APP_STATE, { type: "new-game", seed: "a" });
    const { sessionId } = inGame(game);
    expect(reduceApp(game, { type: "roll", sessionId, rngSeed: "other", turn: 0 })).toBe(game);
  });
});

describe("summarizeGame", () => {
  it("counts turns and the hops actually travelled", () => {
    let game = createGame(DEFAULT_CONFIG, "sum", network);
    for (const roll of [6, 6, 6, 6, 3, 6]) game = moveByRoll(game, roll, network).state;
    expect(game.status).toBe("completed");
    expect(summarizeGame(game)).toEqual({ turns: 6, moves: 30, transfers: 0 });
    expect(game.movementHistory.map(unusedPipsOf)).toEqual([0, 0, 0, 0, 0, 3]);
  });
});

describe("stop-reason texts", () => {
  const name = (id: string) => `<${id}>`;

  it("names the goal station for a goal truncation (unchanged text) and nothing for a full roll", () => {
    let game = createGame(DEFAULT_CONFIG, "sum", network);
    for (const roll of [6, 6, 6, 6, 3, 6]) game = moveByRoll(game, roll, network).state;
    expect(game.movementHistory.map((record) => earlyStopNote(record, name))).toEqual([
      null,
      null,
      null,
      null,
      null,
      `<${START}>で停止、残り3`,
    ]);
  });

  it("names the terminus for an endpoint truncation, and the live roll reports it too", () => {
    const multi = buildRailwayNetwork(multiServiceInput());
    const onLine = {
      ...createGame(multiConfig(), "end", multi),
      currentStationId: "y",
      currentServiceId: M_LINE,
      direction: -1 as const,
    };
    const truncated = moveByRoll(onLine, 5, multi).state;
    const record = truncated.movementHistory.at(-1)!;
    expect(record.stopReason).toBe("endpoint");
    expect(earlyStopNote(record, name)).toBe("<x>で停止、残り3");
    expect(lastMoveOf(truncated, multi)).toEqual({
      roll: 5,
      unusedPips: 3,
      stopReason: "endpoint",
      stopStationId: "x",
      serviceId: M_LINE, direction: -1, endpointKind: "terminus",
      landing: { type: "landing-resolved", stationId: "x", serviceCandidates: [M_LINE], serviceId: M_LINE, serviceDrawRequired: false, directionCandidates: [1], direction: 1, directionDrawRequired: false, changedService: false },
    });
  });

  it("a live roll records stop reason and stop station like a resumed one", () => {
    const start = startSession(DEFAULT_CONFIG, "live", network, 1);
    const rolled = reduce(start, rollAction(start));
    if (isItemSave(rolled.game)) throw new Error("Expected classic session");
    expect(rolled.lastMove).toEqual(lastMoveOf(rolled.game, network));
  });
});
