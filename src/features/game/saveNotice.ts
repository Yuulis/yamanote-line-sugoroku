import { isItemSave, type SavedGameState } from "./engine";
import type { SaveWriteResult } from "./store/persistence";
import type { GuideAcknowledgement, GuideAnnouncement } from "./firstPlayGuide";

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
 * `current` keeps the last selected key and copy together while it covers one unchanged ordinary status.
 * `deliveredIds` prevents a previously spoken notice from being reinserted after another notice takes over.
 */
export interface NoticeAnnouncementState {
  /** The last selected notice is retained with its original copy until ordinary text changes. */
  readonly current: SelectedNoticeAnnouncement | null;
  readonly coveredOrdinary: string | null;
  /** Keeps already spoken notices from being reinserted after a higher-priority notice takes over. */
  readonly deliveredIds: readonly string[];
}

export interface NoticeOwnershipInput {
  readonly engineDecisionOpen: boolean;
  readonly rulesOpen: boolean;
  readonly confirmationOpen: boolean;
  readonly itemDialogOpen: boolean;
  readonly coachOpen: boolean;
}

export function isNoticeAnnouncementOwned(input: NoticeOwnershipInput): boolean {
  return input.engineDecisionOpen || input.rulesOpen || input.confirmationOpen
    || input.itemDialogOpen || input.coachOpen;
}

export interface NoticeAnnouncementCopy {
  readonly key: string;
  readonly text: string;
}

export type SelectedNoticeAnnouncement =
  | (NoticeAnnouncementCopy & { readonly source: "first-turn" })
  | (NoticeAnnouncementCopy & {
    readonly source: "hint";
    readonly acknowledgement: GuideAcknowledgement;
  });

export interface NoticeAnnouncementInput {
  readonly state: NoticeAnnouncementState;
  /** The turn announcement the status region would speak without the notice. */
  readonly ordinaryAnnouncement: string;
  /** The ordinary text of the last committed render, owned by the caller; null before the first render. */
  readonly previousOrdinary: string | null;
  readonly firstTurnNotice: NoticeAnnouncementCopy | null;
  readonly hintAnnouncement: GuideAnnouncement | null;
  /** A decision, modal, coach, or local item dialog owns the panel. */
  readonly decisionOwned: boolean;
}

export interface NoticeAnnouncementSelection {
  readonly text: string;
  /** A notice carries the exact copy selected with its key; ordinary text has no notice identity. */
  readonly announcement: SelectedNoticeAnnouncement | null;
  /** True when `text` is a fresh notice announcement, so the owner should acknowledge it. */
  readonly announcesNotice: boolean;
}

export function noticeAnnouncementIdentity(announcement: SelectedNoticeAnnouncement): string {
  if (announcement.source === "first-turn") return `first-turn:${announcement.key}`;
  const acknowledgement = announcement.acknowledgement;
  return `hint:${acknowledgement.sessionId}:${acknowledgement.candidateKey}:${acknowledgement.displayGeneration}`;
}

function firstTurnSelection(announcement: NoticeAnnouncementCopy): SelectedNoticeAnnouncement {
  return { ...announcement, source: "first-turn" };
}

function hintSelection(announcement: GuideAnnouncement): SelectedNoticeAnnouncement {
  return {
    key: announcement.key,
    text: announcement.text,
    source: "hint",
    acknowledgement: announcement.acknowledgement,
  };
}

function selection(
  text: string,
  announcement: SelectedNoticeAnnouncement | null = null,
  announcesNotice = false,
): NoticeAnnouncementSelection {
  return { text, announcement, announcesNotice };
}

/**
 * Edge-aware arbitration for the single status region. Fresh turn text wins first; once it stands, an undelivered
 * #68 notice wins before the current hint. A selected notice keeps the exact key and copy that were chosen together.
 * Already spoken #68 text stays until ordinary text changes; a hint stays only while its same display generation is
 * current. Modal, item-dialog, decision, and coach ownership leave the ordinary status in place without an ack.
 */
export function selectAnnouncement(input: NoticeAnnouncementInput): NoticeAnnouncementSelection {
  const {
    state,
    ordinaryAnnouncement,
    previousOrdinary,
    firstTurnNotice,
    hintAnnouncement,
    decisionOwned,
  } = input;
  const ordinary = selection(ordinaryAnnouncement);
  if (decisionOwned || ordinaryAnnouncement !== previousOrdinary) return ordinary;

  const firstTurn = firstTurnNotice === null ? null : firstTurnSelection(firstTurnNotice);
  const hint = hintAnnouncement === null ? null : hintSelection(hintAnnouncement);
  const delivered = new Set(state.deliveredIds);
  const firstTurnId = firstTurn === null ? null : noticeAnnouncementIdentity(firstTurn);
  const hintId = hint === null ? null : noticeAnnouncementIdentity(hint);

  if (firstTurn !== null && firstTurnId !== null && !delivered.has(firstTurnId)) {
    return selection(firstTurn.text, firstTurn, true);
  }
  if (hint !== null && hintId !== null && !delivered.has(hintId)) {
    return selection(hint.text, hint, true);
  }

  const current = state.current;
  if (current === null || state.coveredOrdinary !== ordinaryAnnouncement) return ordinary;
  if (current.source === "first-turn") return selection(current.text, current);
  if (hint !== null && noticeAnnouncementIdentity(current) === noticeAnnouncementIdentity(hint)) {
    return selection(current.text, current);
  }
  return ordinary;
}
