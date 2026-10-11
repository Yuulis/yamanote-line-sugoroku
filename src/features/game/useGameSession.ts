import { useCallback, useEffect, useReducer } from "react";
import type { RailwayNetwork } from "./engine";
import { MOVE_SETTLE_MS, MVP_GAME_CONFIG } from "./gameConfig";
import { type GameAction, type GameSession, reduceGameSession, startSession } from "./gameSession";
import { generateSeed } from "./seed";

export interface GameSessionControls {
  session: GameSession;
  roll: () => void;
  restart: () => void;
}

export function useGameSession(network: RailwayNetwork): GameSessionControls {
  const reducer = useCallback(
    (session: GameSession, action: GameAction) =>
      reduceGameSession(session, action, MVP_GAME_CONFIG, network),
    [network],
  );
  const [session, dispatch] = useReducer(reducer, undefined, () =>
    startSession(MVP_GAME_CONFIG, generateSeed(), network),
  );

  useEffect(() => {
    if (session.phase !== "applying") return;
    const timer = window.setTimeout(() => dispatch({ type: "move-settled" }), MOVE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [session.phase, session.game.turn]);

  const { rngSeed, turn } = session.game;
  const roll = useCallback(() => dispatch({ type: "roll", rngSeed, turn }), [rngSeed, turn]);
  const restart = useCallback(() => dispatch({ type: "new-game", seed: generateSeed() }), []);

  return { session, roll, restart };
}
