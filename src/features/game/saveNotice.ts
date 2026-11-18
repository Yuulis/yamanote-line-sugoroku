import type { SavedGameState } from "./engine";
import type { SaveWriteResult } from "./store/persistence";

/**
 * One distinct save write of a session's committed game. Repeated effects for
 * the same write (same game object, storage, key and session) reuse it.
 */
export interface SaveAttempt {
  /** Increases with every distinct write while the app is mounted. */
  readonly id: number;
  readonly sessionId: number;
  readonly game: SavedGameState;
  readonly result: SaveWriteResult;
  /** Top-level turn of the game the session was started or resumed with; fixed per session. */
  readonly entryTurn: number;
}
