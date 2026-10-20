import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { GameConfig, GameState } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import {
  type AppAction,
  type AppState,
  INITIAL_APP_STATE,
  type MoveAnimation,
  reduceAppState,
} from "./gameSession";
import { generateSeed } from "./seed";
import {
  deleteSave,
  readSave,
  type SaveLookup,
  type SaveWriteResult,
  type StorageLike,
  writeSave,
} from "./store/persistence";

export interface GameAppControls {
  state: AppState;
  /** Read when the title screen is shown; null while a game is on screen. */
  saveLookup: SaveLookup | null;
  /** Result of saving the current committed state; null before the first save. */
  saveStatus: SaveWriteResult | null;
  newGame: () => void;
  resume: (game: GameState) => void;
  roll: () => void;
  finishAnimation: (animation: MoveAnimation) => void;
  showTitle: () => void;
  /** Delete the stored save; false when storage refused. */
  removeSave: () => boolean;
}

/**
 * App state (title or game) plus persistence. Nothing is created or saved
 * until the player chooses on the title screen, so opening the page can
 * never overwrite an existing save.
 */
export function useGameApp(
  network: RailwayNetwork,
  storage: StorageLike | null,
  config: GameConfig,
  saveKey: string,
): GameAppControls {
  const reducer = useCallback(
    (state: AppState, action: AppAction) =>
      reduceAppState(state, action, config, network),
    [config, network],
  );
  const [state, dispatch] = useReducer(reducer, INITIAL_APP_STATE);
  const [saveStatus, setSaveStatus] = useState<SaveWriteResult | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);

  // Save right after every committed change: a new game, each turn (before
  // its animation plays) and the clearing turn (spec 11).
  const committedGame = state.screen === "game" ? state.session.game : null;
  useEffect(() => {
    if (committedGame) setSaveStatus(writeSave(storage, committedGame, saveKey));
  }, [committedGame, saveKey, storage]);

  const onTitle = state.screen === "title";
  // saveRevision is a dependency only: it forces a re-read after deleting.
  const saveLookup = useMemo(
    () => (onTitle ? readSave(storage, network, config, saveKey) : null),
    [onTitle, storage, network, config, saveKey, saveRevision],
  );

  const session = state.screen === "game" ? state.session : null;
  const sessionId = session?.sessionId;
  const rngSeed = session?.game.rngSeed;
  const turn = session?.game.turn;
  const roll = useCallback(() => {
    if (sessionId === undefined || rngSeed === undefined || turn === undefined) return;
    dispatch({ type: "roll", sessionId, rngSeed, turn });
  }, [sessionId, rngSeed, turn]);
  const newGame = useCallback(() => dispatch({ type: "new-game", seed: generateSeed() }), []);
  const resume = useCallback((game: GameState) => dispatch({ type: "resume", game }), []);
  const finishAnimation = useCallback(
    ({ sessionId, turn }: MoveAnimation) =>
      dispatch({ type: "animation-finished", sessionId, turn }),
    [],
  );
  const showTitle = useCallback(() => dispatch({ type: "show-title" }), []);
  const removeSave = useCallback(() => {
    const removed = deleteSave(storage, saveKey);
    setSaveRevision((revision) => revision + 1);
    return removed;
  }, [saveKey, storage]);

  return {
    state,
    saveLookup,
    saveStatus,
    newGame,
    resume,
    roll,
    finishAnimation,
    showTitle,
    removeSave,
  };
}
