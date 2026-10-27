import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { GameConfig, ItemRollAdjustment, ItemTurnCommand } from "../../types/network";
import type { RailwayNetwork, SavedGameState } from "./engine";
import {
  type AppAction,
  type AppState,
  INITIAL_APP_STATE,
  type MoveAnimation,
  reduceAppState,
} from "./gameSession";
import { itemActionIdentity, itemSessionView, type ItemSessionView } from "./itemSession";
import { generateSeed } from "./seed";
import { trackEvent } from "../analytics/analytics";
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
  saveLookup: SaveLookup<SavedGameState> | null;
  /** Result of saving the current committed state; null before the first save. */
  saveStatus: SaveWriteResult | null;
  newGame: () => void;
  resume: (game: SavedGameState) => void;
  roll: () => void;
  itemView: ItemSessionView | null;
  editItemDraft: (command: ItemTurnCommand) => void;
  adjustItemRoll: (adjustment: ItemRollAdjustment | null) => void;
  discardItem: (instanceId: string) => void;
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

  const session = state.screen === "game" ? state.session : null;
  const committedGame = session?.game ?? null;
  const phase = session?.phase;
  const decisionRevision = session?.item?.decisionRevision;
  const sessionId = session?.sessionId;
  const saved = useRef<{ game: SavedGameState; storage: StorageLike | null; key: string; sessionId: number | undefined; result: SaveWriteResult } | null>(null);
  useEffect(() => {
    if (committedGame && !("pending" in committedGame)) setSaveStatus(writeSave(storage, committedGame, saveKey));
  }, [committedGame, saveKey, storage]);
  useEffect(() => {
    if (!committedGame || decisionRevision === undefined) return;
    // StrictMode can repeat this effect; acknowledge the same identity and reuse
    // its write result. Reducers never save, and repeated acknowledgements lose.
    let result: SaveWriteResult;
    if (saved.current?.game === committedGame &&
        saved.current.storage === storage && saved.current.key === saveKey && saved.current.sessionId === sessionId) {
      result = saved.current.result;
    } else {
      result = writeSave(storage, committedGame, saveKey);
      saved.current = { game: committedGame, storage, key: saveKey, sessionId, result };
    }
    setSaveStatus(result);
    if (sessionId !== undefined && (phase === "committing" || phase === "resolving")) {
      dispatch({ type: "item-save-attempted", sessionId, turn: committedGame.turn, decisionRevision });
    }
  }, [committedGame, phase, decisionRevision, sessionId, saveKey, storage]);

  const onTitle = state.screen === "title";
  // saveRevision is a dependency only: it forces a re-read after deleting.
  const pendingGame = state.screen === "title" ? state.pendingGame : undefined;
  const saveLookup = useMemo<SaveLookup<SavedGameState> | null>(
    () => onTitle ? pendingGame ? { kind: "valid", game: pendingGame }
      : readSave(storage, network, config, saveKey) : null,
    [onTitle, pendingGame, storage, network, config, saveKey, saveRevision],
  );

  const rngSeed = session?.game.rngSeed;
  const turn = session?.game.turn;
  const roll = useCallback(() => {
    if (sessionId === undefined || rngSeed === undefined || turn === undefined) return;
    if (decisionRevision !== undefined) dispatch({ type: "item-commit", sessionId, turn, decisionRevision });
    else dispatch({ type: "roll", sessionId, rngSeed, turn });
  }, [sessionId, rngSeed, turn, decisionRevision]);
  const editItemDraft = useCallback((command: ItemTurnCommand) => {
    if (session) dispatch({ type: "item-draft", ...itemActionIdentity(session), command });
  }, [session]);
  const adjustItemRoll = useCallback((adjustment: ItemRollAdjustment | null) => {
    if (session) dispatch({ type: "item-adjust", ...itemActionIdentity(session), adjustment });
  }, [session]);
  const discardItem = useCallback((instanceId: string) => {
    if (session) dispatch({ type: "item-discard", ...itemActionIdentity(session), instanceId });
  }, [session]);
  const itemView = useMemo(() => session ? itemSessionView(session, network) : null, [session, network]);
  const newGame = useCallback(() => {
    trackEvent("game_start", { mode: "new" });
    dispatch({ type: "new-game", seed: generateSeed() });
  }, []);
  const resume = useCallback((game: SavedGameState) => {
    trackEvent("game_start", { mode: "resume" });
    dispatch({ type: "resume", game });
  }, []);
  const finishAnimation = useCallback(
    ({ sessionId, turn, decisionRevision }: MoveAnimation) =>
      dispatch({ type: "animation-finished", sessionId, turn, decisionRevision }),
    [],
  );
  const showTitle = useCallback(() => dispatch({ type: "show-title" }), []);
  const removeSave = useCallback(() => {
    const removed = deleteSave(storage, saveKey);
    if (removed) dispatch({ type: "forget-title-pending" });
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
    itemView,
    editItemDraft,
    adjustItemRoll,
    discardItem,
    finishAnimation,
    showTitle,
    removeSave,
  };
}
