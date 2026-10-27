// UI session state around the pure engine, driven by React's useReducer.
// The reducers are pure (StrictMode may call them twice): seeds and restored
// games come in through actions, and the engine is deterministic.
//
// Classic rolls commit atomically. Item turns add save acknowledgements around
// pending decisions; animations remain presentation only in both modes.

import type {
  Direction, EndpointKind, GameConfig, GameState, ItemGameState, StationId, StopReason,
} from "../../types/network";
import {
  createGame,
  landingOptions,
  type LandingResolvedEvent,
  type MoveEvent,
  playTurn,
  type RailwayNetwork,
  type SavedGameState,
  isItemSave,
  resolveLandingEvent,
} from "./engine";
import { createItemSession, reduceItemSession, type ItemSessionAction, type ItemSessionState } from "./itemSession";
import { endpointKindAt, unusedPipsOf } from "./gameSummary";

export type SessionPhase = "idle" | "committing" | "awaiting-adjust" | "resolving" | "animating" | "awaiting-discard";

/** The move being shown; item mode also identifies the decision revision. */
export interface MoveAnimation {
  sessionId: number;
  /** Completed engine turn (a pending discard still belongs to the prior turn). */
  turn: number;
  decisionRevision?: number;
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
  serviceId: string;
  direction: Direction;
  endpointKind: EndpointKind | null;
  landing: LandingResolvedEvent | null;
}

export interface GameSession {
  /** Changes on every new game or resume, so stale callbacks are recognisable. */
  sessionId: number;
  game: SavedGameState;
  /** Present only for item mode; classic sessions retain their exact shape. */
  item?: ItemSessionState;
  /** Rolls are ignored unless the phase is idle. */
  phase: SessionPhase;
  lastMove: LastMove | null;
  animation: MoveAnimation | null;
}

export type GameAction = ItemSessionAction
  /** `sessionId`, `rngSeed` and `turn` identify the exact turn the click was made on. */
  | { type: "roll"; sessionId: number; rngSeed: string; turn: number }
  /** Sent by the animation (or the skip button) for the move it showed. */
  | { type: "animation-finished"; sessionId: number; turn: number; decisionRevision?: number }
  | { type: "new-game"; seed: string }
  | { type: "resume"; game: SavedGameState };

export function startSession(
  config: GameConfig,
  seed: string,
  network: RailwayNetwork,
  sessionId = 0,
): GameSession {
  if (config.itemPolicy) return createItemSession(config, seed, network, sessionId);
  return {
    sessionId,
    game: createGame(config, seed, network),
    phase: "idle",
    lastMove: null,
    animation: null,
  };
}

/** The last recorded roll, so a resumed game shows what was rolled before. */
export function lastMoveOf(game: GameState, network: RailwayNetwork): LastMove | null {
  const record = game.movementHistory.at(-1);
  if (!record) return null;
  const landing = record.landing === null ? null : resolveLandingEvent(
    landingOptions({
      config: game.config,
      currentStationId: record.toStationId,
      currentServiceId: record.serviceId,
      direction: record.direction,
    }, network),
    record.serviceId,
    record.landing,
  ).event;
  return {
    roll: record.roll,
    unusedPips: unusedPipsOf(record),
    stopReason: record.stopReason,
    stopStationId: record.toStationId,
    serviceId: record.serviceId,
    direction: record.direction,
    endpointKind: endpointKindAt(network, record.serviceId, record.toStationId),
    landing,
  };
}

/** A validated save resumes at its pending decision, or idle without replay. */
export function resumeSession(game: SavedGameState, network: RailwayNetwork, sessionId = 0): GameSession {
  if (isItemSave(game)) return createItemSession(game.config, game.rngSeed, network, sessionId, game);
  return { sessionId, game, phase: "idle", lastMove: lastMoveOf(game, network), animation: null };
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
  if (action.type === "new-game") return startSession(config, action.seed, network, session.sessionId + 1);
  if (action.type === "resume") return resumeSession(action.game, network, session.sessionId + 1);
  if (isItemSave(session.game)) return reduceItemSession(session, action, network);
  switch (action.type) {
    case "roll": {
      // A stale or repeated click must never apply a second move.
      if (!canRoll(session, action)) return session;
      const { state, events } = playTurn(session.game, network);
      return {
        ...session,
        game: state,
        phase: "animating",
        lastMove: lastMoveOf(state, network),
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
    default:
      return session;
  }
}

/** Title screen (no game yet) or a running / finished game. */
export type AppState =
  | { screen: "title"; lastSessionId: number; pendingGame?: ItemGameState }
  | { screen: "game"; session: GameSession };

export type AppAction = GameAction | { type: "show-title" } | { type: "forget-title-pending" };

export const INITIAL_APP_STATE: AppState = { screen: "title", lastSessionId: 0 };

export function reduceAppState(
  state: AppState,
  action: AppAction,
  config: GameConfig,
  network: RailwayNetwork,
): AppState {
  if (state.screen === "title") {
    if (action.type === "forget-title-pending" && state.pendingGame) {
      return { screen: "title", lastSessionId: state.lastSessionId };
    }
    const sessionId = state.lastSessionId + 1;
    if (action.type === "new-game") {
      return { screen: "game", session: startSession(config, action.seed, network, sessionId) };
    }
    if (action.type === "resume") {
      return { screen: "game", session: resumeSession(action.game, network, sessionId) };
    }
    return state;
  }
  if (action.type === "show-title") {
    const { session } = state;
    if (session.item && (session.phase === "committing" || session.phase === "resolving")) {
      return { screen: "game", session: { ...session, item: { ...session.item, leaveAfterSave: true } } };
    }
    return titleAfterSession(session);
  }
  if (action.type === "forget-title-pending") return state;
  const session = reduceGameSession(state.session, action, config, network);
  if (session.item?.leaveAfterSave && session.phase !== "committing" && session.phase !== "resolving") {
    return titleAfterSession(session);
  }
  return session === state.session ? state : { screen: "game", session };
}

/** A pending decision is progress even before the first completed turn. */
export function hasGameProgress(game: SavedGameState): boolean {
  return game.turn > 0 || (isItemSave(game) && game.pending !== null);
}

function titleAfterSession(session: GameSession): Extract<AppState, { screen: "title" }> {
  // Keep an in-memory resume point when storage failed. Reload still depends
  // on the reported save result, but visiting title must not cancel a decision.
  return { screen: "title", lastSessionId: session.sessionId,
    ...(isItemSave(session.game) && session.game.pending ? { pendingGame: session.game } : {}) };
}
