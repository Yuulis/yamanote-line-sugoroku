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
import type { SaveAttempt } from "./saveNotice";
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
  /**
   * Latest distinct save write (it may belong to an earlier session); null
   * before the first save. Optional so injected test controls stay valid;
   * absent means null.
   */
  saveAttempt?: SaveAttempt | null;
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

const FIRST_SAVE_ATTEMPT_ID = 1;

interface SaveTarget {
  readonly game: SavedGameState;
  readonly storage: StorageLike | null;
  readonly key: string;
  readonly sessionId: number;
}

interface SaveLedger {
  readonly last: { readonly target: SaveTarget; readonly attempt: SaveAttempt } | null;
  readonly entry: { readonly sessionId: number; readonly turn: number } | null;
  readonly nextId: number;
}

const EMPTY_SAVE_LEDGER: SaveLedger = { last: null, entry: null, nextId: FIRST_SAVE_ATTEMPT_ID };

function sameTarget(a: SaveTarget, b: SaveTarget): boolean {
  return a.game === b.game && a.storage === b.storage && a.key === b.key && a.sessionId === b.sessionId;
}

/**
 * Write the target once: repeating the same target reuses its attempt. A
 * session's first write is its starting game, so it fixes the entry turn.
 */
function recordSave(ledger: SaveLedger, target: SaveTarget): { ledger: SaveLedger; attempt: SaveAttempt } {
  if (ledger.last && sameTarget(ledger.last.target, target)) return { ledger, attempt: ledger.last.attempt };
  const entry = ledger.entry?.sessionId === target.sessionId ? ledger.entry
    : { sessionId: target.sessionId, turn: target.game.turn };
  const attempt: SaveAttempt = { id: ledger.nextId, sessionId: target.sessionId, game: target.game,
    result: writeSave(target.storage, target.game, target.key), entryTurn: entry.turn };
  return { ledger: { last: { target, attempt }, entry, nextId: ledger.nextId + 1 }, attempt };
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
  const [saveAttempt, setSaveAttempt] = useState<SaveAttempt | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);

  const session = state.screen === "game" ? state.session : null;
  const committedGame = session?.game ?? null;
  const phase = session?.phase;
  const decisionRevision = session?.item?.decisionRevision;
  const sessionId = session?.sessionId;
  const saveLedger = useRef(EMPTY_SAVE_LEDGER);
  // The item effect re-runs for the same game when phase or decisionRevision
  // changes; that re-run reuses the attempt instead of writing again. StrictMode,
  // HMR and Activity re-runs would reuse it too, but they are defensive only:
  // the hook mounts on the title screen, where there is no game to save.
  const save = useCallback((target: SaveTarget): void => {
    const recorded = recordSave(saveLedger.current, target);
    saveLedger.current = recorded.ledger;
    setSaveAttempt(recorded.attempt);
  }, []);
  useEffect(() => {
    if (committedGame && sessionId !== undefined && !("pending" in committedGame)) {
      save({ game: committedGame, storage, key: saveKey, sessionId });
    }
  }, [committedGame, saveKey, storage, sessionId, save]);
  useEffect(() => {
    if (!committedGame || decisionRevision === undefined || sessionId === undefined) return;
    // Acknowledge on every run, reused write or not. Reducers never save, and
    // repeated acknowledgements lose.
    save({ game: committedGame, storage, key: saveKey, sessionId });
    if (phase === "committing" || phase === "resolving") {
      dispatch({ type: "item-save-attempted", sessionId, turn: committedGame.turn, decisionRevision });
    }
  }, [committedGame, phase, decisionRevision, sessionId, saveKey, storage, save]);

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
    saveStatus: saveAttempt?.result ?? null,
    saveAttempt,
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
