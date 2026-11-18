import { useCallback, useEffect, useRef, useState } from "react";
import { isFirstTurnNoticeEligible, FIRST_TURN_NOTICE_TEXT, type SaveAttempt } from "./saveNotice";
import type { NoticeToastInput } from "./toastQueue";
import { readFirstTurnNotice, writeFirstTurnNotice } from "./store/notices";
import type { StorageLike } from "./store/persistence";

export interface UseFirstTurnNoticeOptions {
  readonly saveAttempt: SaveAttempt | null;
  readonly currentSessionId: number | null;
  readonly storage: StorageLike | null;
  readonly publicationReady: boolean;
  readonly decisionOpen: boolean;
  readonly confirmOpen: boolean;
  readonly rulesOpen: boolean;
}

export interface UseFirstTurnNoticeResult {
  readonly notice: NoticeToastInput | null;
  readonly onNoticeShown: (key: string) => void;
  readonly onNoticeAnnounced: (key: string) => void;
}

interface PendingNotice {
  readonly attemptId: number;
  readonly sessionId: number;
  readonly toast: NoticeToastInput;
}

function noticeFor(attempt: SaveAttempt): NoticeToastInput {
  return {
    kind: "notice",
    key: `${attempt.sessionId}:auto-resume:${attempt.id}`,
    sessionId: attempt.sessionId,
    turn: null,
    eventIndex: null,
    text: FIRST_TURN_NOTICE_TEXT,
    tone: "neutral",
    sticky: false,
  };
}

export function useFirstTurnNotice({
  saveAttempt,
  currentSessionId,
  storage,
  publicationReady,
  decisionOpen,
  confirmOpen,
  rulesOpen,
}: UseFirstTurnNoticeOptions): UseFirstTurnNoticeResult {
  const [initiallyDelivered] = useState(() => readFirstTurnNotice(storage));
  const delivered = useRef(initiallyDelivered);
  const shownKey = useRef<string | null>(null);
  const persistedKey = useRef<string | null>(null);
  const [pending, setPending] = useState<PendingNotice | null>(null);

  useEffect(() => {
    if (!isFirstTurnNoticeEligible(saveAttempt, currentSessionId, delivered.current) || saveAttempt === null) {
      setPending(null);
      return;
    }
    const next = noticeFor(saveAttempt);
    setPending((current) => current?.toast.key === next.key
      ? current
      : { attemptId: saveAttempt.id, sessionId: saveAttempt.sessionId, toast: next });
  }, [saveAttempt, currentSessionId]);

  const currentAttemptEligible = isFirstTurnNoticeEligible(saveAttempt, currentSessionId, delivered.current);
  const ready = publicationReady && !decisionOpen && !confirmOpen && !rulesOpen;
  const notice = currentAttemptEligible && ready && pending !== null
    && pending.attemptId === saveAttempt?.id && pending.sessionId === currentSessionId
    ? pending.toast
    : null;

  const onNoticeShown = useCallback((key: string): void => {
    if (delivered.current || pending?.toast.key !== key) return;
    delivered.current = true;
    shownKey.current = key;
    setPending(null);
  }, [pending]);

  const onNoticeAnnounced = useCallback((key: string): void => {
    if (shownKey.current !== key || persistedKey.current === key) return;
    persistedKey.current = key;
    writeFirstTurnNotice(storage);
  }, [storage]);

  return { notice, onNoticeShown, onNoticeAnnounced };
}
