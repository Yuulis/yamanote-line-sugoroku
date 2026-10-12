// UI session state around the pure engine, driven by React's useReducer.
// The reducers are pure (StrictMode may call them twice): seeds and restored
// games come in through actions, and the engine is deterministic.
//
// A roll commits the engine state immediately; the move animation that
// follows is presentation only, so a reload mid-animation resumes from the
// committed (and already saved) state.

import type { GameConfig, GameState, StationId, StopReason } from "../../types/network";
import { createGame, type MoveEvent, playTurn, type RailwayNetwork } from "./engine";
import { unusedPipsOf } from "./gameSummary";

export type SessionPhase = "idle" | "animating";

/** The move being shown; identified by session and committed turn. */
export interface MoveAnimation {
  sessionId: number;
  turn: number;
  fromStationId: StationId;
  events: MoveEvent[];
}

export interface LastMove {
  roll: number;
  /** Pips discarded because the move stopped early (goal or endpoint). */
  unusedPips: number;
  stopReason: StopReason;
  /** Station where the move ended. */
  stopStationId: StationId;
}

export interface GameSession {
  /** Changes on every new game or resume, so stale callbacks are recognisable. */
  sessionId: number;
  game: GameState;
  /** Rolls are ignored unless the phase is idle. */
  phase: SessionPhase;
  lastMove: LastMove | null;
  animation: MoveAnimation | null;
}

export type GameAction =
  /** `sessionId`, `rngSeed` and `turn` identify the exact turn the click was made on. */
  | { type: "roll"; sessionId: number; rngSeed: string; turn: number }
  /** Sent by the animation (or the skip button) for the move it showed. */
  | { type: "animation-finished"; sessionId: number; turn: number }
  | { type: "new-game"; seed: string }
  | { type: "resume"; game: GameState };

export function startSession(
  config: GameConfig,
  seed: string,
  network: RailwayNetwork,
  sessionId = 0,
): GameSession {
  return {
    sessionId,
    game: createGame(config, seed, network),
    phase: "idle",
    lastMove: null,
    animation: null,
  };
}

/** The last recorded roll, so a resumed game shows what was rolled before. */
export function lastMoveOf(game: GameState): LastMove | null {
  const record = game.movementHistory.at(-1);
  if (!record) return null;
  return {
    roll: record.roll,
    unusedPips: unusedPipsOf(record),
    stopReason: record.stopReason,
    stopStationId: record.toStationId,
  };
}

/** A restored, already-validated game; resumes idle with no animation. */
export function resumeSession(game: GameState, sessionId = 0): GameSession {
  return { sessionId, game, phase: "idle", lastMove: lastMoveOf(game), animation: null };
}

function canRoll(
  session: GameSession,
  { sessionId, rngSeed, turn }: Extract<GameAction, { type: "roll" }>,
): boolean {
  const { game } = session;
  return (
    session.sessionId === sessionId &&
    session.phase === "idle" &&
    game.status === "playing" &&
    game.rngSeed === rngSeed &&
    game.turn === turn
  );
}

function isCurrentAnimation(session: GameSession, sessionId: number, turn: number): boolean {
  const { animation } = session;
  return (
    session.phase === "animating" &&
    animation !== null &&
    animation.sessionId === sessionId &&
    animation.turn === turn
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
      if (!canRoll(session, action)) return session;
      const { state, roll, unusedPips, stopReason, events } = playTurn(session.game, network);
      return {
        ...session,
        game: state,
        phase: "animating",
        lastMove: { roll, unusedPips, stopReason, stopStationId: state.currentStationId },
        animation: {
          sessionId: session.sessionId,
          turn: state.turn,
          fromStationId: session.game.currentStationId,
          events,
        },
      };
    }
    case "animation-finished":
      // Skip and the last animation frame may both report; only the first counts.
      if (!isCurrentAnimation(session, action.sessionId, action.turn)) return session;
      return { ...session, phase: "idle", animation: null };
    case "new-game":
      return startSession(config, action.seed, network, session.sessionId + 1);
    case "resume":
      return resumeSession(action.game, session.sessionId + 1);
  }
}

/** Title screen (no game yet) or a running / finished game. */
export type AppState =
  | { screen: "title"; lastSessionId: number }
  | { screen: "game"; session: GameSession };

export type AppAction = GameAction | { type: "show-title" };

export const INITIAL_APP_STATE: AppState = { screen: "title", lastSessionId: 0 };

export function reduceAppState(
  state: AppState,
  action: AppAction,
  config: GameConfig,
  network: RailwayNetwork,
): AppState {
  if (state.screen === "title") {
    const sessionId = state.lastSessionId + 1;
    if (action.type === "new-game") {
      return { screen: "game", session: startSession(config, action.seed, network, sessionId) };
    }
    if (action.type === "resume") {
      return { screen: "game", session: resumeSession(action.game, sessionId) };
    }
    return state;
  }
  if (action.type === "show-title") {
    return { screen: "title", lastSessionId: state.session.sessionId };
  }
  const session = reduceGameSession(state.session, action, config, network);
  return session === state.session ? state : { screen: "game", session };
}
