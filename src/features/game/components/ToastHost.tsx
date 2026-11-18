import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createReadingClock,
  createToastQueue,
  pauseReadingClock,
  readingRemainingMs,
  resumeReadingClock,
  toastQueueReducer,
  visibleToasts,
  type NoticeToastInput,
  type ToastInput,
  type ToastReadingClock,
} from "../toastQueue";
import { ItemIcon } from "./ItemIcon";
import { PhraseText } from "./PhraseText";

export interface ToastHostProps {
  sessionId: number | null;
  inputs: readonly ToastInput[];
  saveFailed: boolean;
  obscured: boolean;
  reducedMotion: boolean;
  /** Queued once per scope and key; a changed object with the same key is ignored. */
  notice?: NoticeToastInput | null;
  /** Whether the game's status region can announce the notice now. Defaults to true. */
  announceable?: boolean;
  /** Fired once per notice, on its first display while unobscured, document-visible and announceable. */
  onNoticeShown?: (key: string) => void;
}

interface ToastTimer {
  clock: ToastReadingClock;
  timer: ReturnType<typeof setTimeout> | null;
}

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(isDocumentVisible);
  useEffect(() => {
    const update = (): void => setVisible(isDocumentVisible());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function ToastHost({
  sessionId, inputs, saveFailed, obscured, reducedMotion, notice = null, announceable = true, onNoticeShown,
}: ToastHostProps): React.JSX.Element {
  const [queue, dispatch] = useReducer(toastQueueReducer, sessionId, createToastQueue);
  const clocks = useRef<Map<string, ToastTimer>>(new Map());
  const currentSession = useRef(sessionId);
  const acknowledgedNotices = useRef<Set<string>>(new Set());
  const previousNotice = useRef<{ readonly key: string; readonly sessionId: number | null } | null>(null);
  const currentNotice = useRef(notice);
  const noticeShown = useRef(onNoticeShown);
  const documentVisible = useDocumentVisible();
  const noticeReady = documentVisible && !obscured && announceable;

  useEffect(() => {
    if (currentSession.current === sessionId) return;
    currentSession.current = sessionId;
    for (const entry of clocks.current.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
    }
    clocks.current.clear();
    acknowledgedNotices.current.clear();
    dispatch({ type: "resetScope", sessionId });
  }, [sessionId]);

  useEffect(() => {
    dispatch({ type: "enqueue", scope: sessionId, inputs });
  }, [inputs, sessionId]);

  useEffect(() => {
    const previous = previousNotice.current;
    if (previous && previous.sessionId === sessionId && previous.key !== notice?.key
      && !acknowledgedNotices.current.has(previous.key)) {
      dispatch({ type: "withdrawNotice", key: previous.key });
    }
    previousNotice.current = notice ? { key: notice.key, sessionId } : null;
    if (notice) dispatch({ type: "enqueueNotice", scope: sessionId, notice });
  }, [notice, sessionId]);

  useEffect(() => {
    noticeShown.current = onNoticeShown;
  }, [onNoticeShown]);

  useEffect(() => {
    currentNotice.current = notice;
  }, [notice, sessionId]);

  // Raised on a false → true transition only: a session change clears the sticky failure even while the
  // parent still reports the previous session's failed save.
  useEffect(() => {
    dispatch({ type: saveFailed ? "saveFailed" : "saveSucceeded" });
  }, [saveFailed]);

  const visible = useMemo(
    () => queue.scope === sessionId ? visibleToasts(queue) : [],
    [queue, sessionId],
  );
  const ordinary = visible.filter((toast) => !toast.sticky);
  const visibleKey = ordinary.map((toast) => toast.key).join("\u0000");

  useEffect(() => {
    const activeKeys = new Set(ordinary.map((toast) => toast.key));
    for (const [key, entry] of clocks.current) {
      if (activeKeys.has(key)) continue;
      if (entry.timer !== null) clearTimeout(entry.timer);
      clocks.current.delete(key);
    }

    const now = Date.now();
    for (const toast of ordinary) {
      let entry = clocks.current.get(toast.key);
      if (!entry) {
        entry = { clock: createReadingClock(), timer: null };
        clocks.current.set(toast.key, entry);
      }
      const isNotice = toast.kind === "notice";
      if (isNotice ? !noticeReady : obscured) {
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = null;
        // A hidden document means the notice may have gone unread: it gets its full reading time back.
        entry.clock = isNotice && !documentVisible ? createReadingClock() : pauseReadingClock(entry.clock, now);
        continue;
      }
      if (isNotice && !acknowledgedNotices.current.has(toast.key)
        && currentNotice.current?.key === toast.key
        && currentNotice.current.sessionId === sessionId
        && toast.sessionId === sessionId
        && currentSession.current === sessionId) {
        acknowledgedNotices.current.add(toast.key);
        noticeShown.current?.(toast.key);
      }
      entry.clock = resumeReadingClock(entry.clock, now);
      if (entry.timer !== null) clearTimeout(entry.timer);
      const remaining = readingRemainingMs(entry.clock, now);
      // A callback is current only while its own handle is the entry's live timer: once paused, rescheduled,
      // cleared or replaced by a session change it is a no-op even if it still runs.
      const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
        const current = clocks.current.get(toast.key);
        if (current !== entry || current.timer !== handle || currentSession.current !== sessionId) return;
        current.timer = null;
        current.clock = pauseReadingClock(current.clock, Date.now());
        dispatch({ type: "expire", key: toast.key });
      }, remaining);
      entry.timer = handle;
    }
  }, [visibleKey, obscured, noticeReady, documentVisible, sessionId]);

  useEffect(() => () => {
    for (const entry of clocks.current.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
    }
    clocks.current.clear();
  }, []);

  return (
    <div className="toast-host" aria-hidden="true">
      {visible.map((toast) => (
        <div
          className={`toast-host__toast toast-host__toast--${toast.tone}${toast.kind === "notice" ? " toast-host__toast--notice" : ""}${toast.sticky ? " toast-host__toast--sticky" : ""}${reducedMotion ? "" : " toast-host__toast--motion"}`}
          key={toast.key}
        >
          {toast.itemKind ? <span className="toast-host__icon"><ItemIcon kind={toast.itemKind} size={26} /></span> : null}
          <span className="toast-host__text">{toast.kind === "notice" ? <PhraseText text={toast.text} /> : toast.text}</span>
        </div>
      ))}
    </div>
  );
}
