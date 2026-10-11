// UI session state around the pure engine, driven by React's useReducer.
// The reducer itself is pure (StrictMode may call it twice): seeds come in
// through actions, and the engine is deterministic.

import type { GameConfig, GameState } from "../../types/network";
import { createGame, type MoveResult, playTurn, type RailwayNetwork } from "./engine";

export type SessionPhase = "idle" | "applying";

export interface GameSession {
  game: GameState;
  /** UI lock while a move is shown; rolls are ignored until it settles. */
  phase: SessionPhase;
  lastMove: Pick<MoveResult, "roll" | "unusedPips" | "events"> | null;
}

export type GameAction =
  /** `rngSeed` and `turn` identify the exact turn the click was made on. */
  | { type: "roll"; rngSeed: string; turn: number }
  | { type: "move-settled" }
  | { type: "new-game"; seed: string };

export function startSession(
  config: GameConfig,
  seed: string,
  network: RailwayNetwork,
): GameSession {
  return { game: createGame(config, seed, network), phase: "idle", lastMove: null };
}

function canRoll(session: GameSession, rngSeed: string, turn: number): boolean {
  const { game } = session;
  return (
    session.phase === "idle" &&
    game.status === "playing" &&
    game.rngSeed === rngSeed &&
    game.turn === turn
  );
}

export function reduceGameSession(
  session: GameSession,
  action: GameAction,
  config: GameConfig,
  network: RailwayNetwork,
): GameSession {
  switch (action.type) {
    case "roll": {
      // A stale or repeated click must never apply a second move.
      if (!canRoll(session, action.rngSeed, action.turn)) return session;
      const { state, roll, unusedPips, events } = playTurn(session.game, network);
      return { game: state, phase: "applying", lastMove: { roll, unusedPips, events } };
    }
    case "move-settled":
      return session.phase === "applying" ? { ...session, phase: "idle" } : session;
    case "new-game":
      return startSession(config, action.seed, network);
  }
}
