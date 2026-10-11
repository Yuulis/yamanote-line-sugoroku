import { describe, expect, it } from "vitest";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import {
  type GameSession,
  reduceGameSession,
  startSession,
} from "../../src/features/game/gameSession";
import { generateSeed } from "../../src/features/game/seed";
import {
  completedSegmentFilter,
  currentPositionCollection,
  pendingSegmentFilter,
} from "../../src/features/map/progressStyle";
import { DEFAULT_CONFIG, segmentId, START, yamanoteInput } from "./fixtures/yamanote";

const network = buildRailwayNetwork(yamanoteInput());

function reduce(session: GameSession, action: Parameters<typeof reduceGameSession>[1]) {
  return reduceGameSession(session, action, DEFAULT_CONFIG, network);
}

function rollAction(session: GameSession) {
  return {
    type: "roll",
    sessionId: session.sessionId,
    rngSeed: session.game.rngSeed,
    turn: session.game.turn,
  } as const;
}

/** M2: the animation end replaces M1's settle timer and names the move it showed. */
function finishAction(session: GameSession) {
  return {
    type: "animation-finished",
    sessionId: session.sessionId,
    turn: session.game.turn,
  } as const;
}

describe("reduceGameSession", () => {
  it("applies one roll and locks further rolls until the move settles", () => {
    const start = startSession(DEFAULT_CONFIG, "ui-seed", network);
    const rolled = reduce(start, rollAction(start));
    expect(rolled.game.turn).toBe(1);
    expect(rolled.phase).toBe("animating");
    expect(rolled.lastMove?.roll).toBeGreaterThanOrEqual(1);

    expect(reduce(rolled, rollAction(rolled))).toBe(rolled);
    const settled = reduce(rolled, finishAction(rolled));
    expect(settled.phase).toBe("idle");
    expect(reduce(settled, rollAction(settled)).game.turn).toBe(2);
  });

  it("ignores a repeated click carrying an already-played turn", () => {
    const start = startSession(DEFAULT_CONFIG, "ui-seed", network);
    const staleClick = rollAction(start);
    const rolled = reduce(start, staleClick);
    const settled = reduce(rolled, finishAction(rolled));
    expect(reduce(settled, staleClick)).toBe(settled);
  });

  it("ignores a click from a previous game after restarting", () => {
    const first = startSession(DEFAULT_CONFIG, "first", network);
    const restarted = reduce(first, { type: "new-game", seed: "second" });
    expect(reduce(restarted, rollAction(first))).toBe(restarted);
  });

  it("restarting mid-move unlocks the dice for the new game", () => {
    const start = startSession(DEFAULT_CONFIG, "x", network);
    const applying = reduce(start, rollAction(start));
    const restarted = reduce(applying, { type: "new-game", seed: "y" });
    expect(restarted.phase).toBe("idle");
    expect(reduce(restarted, rollAction(restarted)).game.turn).toBe(1);
  });

  it("ignores rolls once the game is completed", () => {
    const start = startSession(DEFAULT_CONFIG, "x", network);
    const done: GameSession = { ...start, game: { ...start.game, status: "completed" } };
    expect(reduce(done, rollAction(done))).toBe(done);
  });

  it("starts a fresh game at 新橋 on restart", () => {
    const start = startSession(DEFAULT_CONFIG, "x", network);
    const rolled = reduce(start, rollAction(start));
    const played = reduce(rolled, finishAction(rolled));
    const restarted = reduce(played, { type: "new-game", seed: "y" });
    expect(restarted.game).toMatchObject({ currentStationId: START, turn: 0, rngSeed: "y" });
    expect(restarted.lastMove).toBeNull();
  });
});

describe("generateSeed", () => {
  it("returns 32 hex characters and differs between calls", () => {
    const seed = generateSeed();
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSeed()).not.toBe(seed);
  });
});

describe("map progress styling", () => {
  it("builds complementary completed / pending filters", () => {
    const ids = [segmentId(0)];
    expect(completedSegmentFilter(ids)).toEqual(["in", ["get", "segmentId"], ["literal", ids]]);
    expect(pendingSegmentFilter(ids)).toEqual(["!", completedSegmentFilter(ids)]);
  });

  it("builds an empty or single-point marker collection", () => {
    expect(currentPositionCollection(null).features).toEqual([]);
    expect(currentPositionCollection([139.7, 35.6]).features[0]?.geometry.coordinates).toEqual([
      139.7, 35.6,
    ]);
  });
});
