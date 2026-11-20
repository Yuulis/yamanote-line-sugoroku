import { isItemSave, type SavedGameState } from "./engine";
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

export const FIRST_TURN_NOTICE_TEXT = "自動で保存しています。いつでも閉じて、続きから遊べます";

/**
 * Whether the latest save attempt earns the one-time auto-save notice: a successful write of a resolved
 * (no pending decision), still-playing game that progressed beyond the session's entry turn. Compare with the
 * current session id (null on the title), never a remembered one.
 */
export function isFirstTurnNoticeEligible(
  attempt: SaveAttempt | null,
  currentSessionId: number | null,
  alreadyDelivered: boolean,
): boolean {
  if (alreadyDelivered || attempt === null) return false;
  if (attempt.sessionId !== currentSessionId) return false;
  if (attempt.result !== "saved") return false;
  const { game } = attempt;
  if (game.status !== "playing") return false;
  if (isItemSave(game) && game.pending !== null) return false;
  return game.turn > attempt.entryTurn;
}

/**
 * `pendingKey` is the delivered notice awaiting speech (null when none); `announcedKey` is the last notice already
 * spoken. `coveredOrdinary` is the ordinary text that was in the region when the notice took it (null before).
 * The caller records `announcedKey = pendingKey` and `coveredOrdinary = ordinaryAnnouncement` when it commits a
 * result with `announcesNotice: true`.
 */
export interface NoticeAnnouncementState {
  readonly pendingKey: string | null;
  readonly announcedKey: string | null;
  readonly coveredOrdinary: string | null;
}

export interface NoticeAnnouncementInput {
  readonly state: NoticeAnnouncementState;
  /** The turn announcement the status region would speak without the notice. */
  readonly ordinaryAnnouncement: string;
  /** The ordinary text of the last committed render, owned by the caller; null before the first render. */
  readonly previousOrdinary: string | null;
  /**
   * A decision owns the panel. The caller passes `(decision present) || rulesOpen || (confirm dialog open)`, so the
   * notice is never spoken behind a native modal.
   */
  readonly decisionOwned: boolean;
}

export interface NoticeAnnouncementSelection {
  readonly text: string;
  /** True when `text` is a fresh notice announcement, so the owner should acknowledge it. */
  readonly announcesNotice: boolean;
}

/**
 * Edge-aware arbitration for the single status region. The ordinary text can stand (an idle turn summary persists
 * until the next roll), so only a change counts as a fresh ordinary announcement:
 * 1. A decision owns the panel: ordinary text, the notice waits.
 * 2. The notice was already announced and the ordinary text is unchanged since: keep showing the notice text
 *    without announcing it again.
 * 3. The notice waits and the ordinary text is standing (unchanged, including empty): announce the notice.
 * 4. Otherwise a fresh ordinary text wins and the notice waits.
 */
export function selectAnnouncement(input: NoticeAnnouncementInput): NoticeAnnouncementSelection {
  const { state, ordinaryAnnouncement, previousOrdinary, decisionOwned } = input;
  const ordinary = { text: ordinaryAnnouncement, announcesNotice: false };
  if (decisionOwned) return ordinary;
  const announced = state.announcedKey !== null && state.announcedKey === state.pendingKey;
  if (announced && ordinaryAnnouncement === state.coveredOrdinary) {
    return { text: FIRST_TURN_NOTICE_TEXT, announcesNotice: false };
  }
  const waiting = state.pendingKey !== null && state.pendingKey !== state.announcedKey;
  if (waiting && ordinaryAnnouncement === previousOrdinary) {
    return { text: FIRST_TURN_NOTICE_TEXT, announcesNotice: true };
  }
  return ordinary;
}
