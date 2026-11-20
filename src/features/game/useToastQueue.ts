import { useEffect, useMemo, useRef, useState } from "react";
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
} from "./toastQueue";

export interface UseToastQueueOptions {
  sessionId: number | null;
  inputs: readonly ToastInput[];
  saveFailed: boolean;
  obscured: boolean;
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

/** Owns the toasts used by both hint selection and the visual host. */
export function useToastQueue({
  sessionId, inputs, saveFailed, obscured, notice = null, announceable = true, onNoticeShown,
}: UseToastQueueOptions): readonly ToastInput[] {
  const [queue, setQueue] = useState(() => createToastQueue(sessionId));
  const [previousSaveFailed, setPreviousSaveFailed] = useState(false);
  const scopedQueue = queue.scope === sessionId ? queue : createToastQueue(sessionId);
  // Turn publication and save status can change in the same render as hint eligibility.
  let nextQueue = toastQueueReducer(scopedQueue, { type: "enqueue", scope: sessionId, inputs });
  // A scope reset clears the sticky toast when the failure flag still refers to the previous session.
  if (previousSaveFailed !== saveFailed) {
    setPreviousSaveFailed(saveFailed);
    nextQueue = toastQueueReducer(nextQueue, { type: saveFailed ? "saveFailed" : "saveSucceeded" });
  }
  if (nextQueue !== queue) setQueue(nextQueue);

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
  }, [sessionId]);

  useEffect(() => {
    const previous = previousNotice.current;
    const withdraw = previous && previous.sessionId === sessionId && previous.key !== notice?.key
      && !acknowledgedNotices.current.has(previous.key) ? previous.key : null;
    previousNotice.current = notice ? { key: notice.key, sessionId } : null;
    if (withdraw === null && notice === null) return;
    setQueue((current) => {
      if (current.scope !== sessionId) return current;
      const updated = withdraw === null ? current : toastQueueReducer(current, { type: "withdrawNotice", key: withdraw });
      return notice ? toastQueueReducer(updated, { type: "enqueueNotice", scope: sessionId, notice }) : updated;
    });
  }, [notice, sessionId]);

  useEffect(() => {
    noticeShown.current = onNoticeShown;
  }, [onNoticeShown]);

  useEffect(() => {
    currentNotice.current = notice;
  }, [notice, sessionId]);

  const visible = useMemo(() => visibleToasts(nextQueue), [nextQueue]);
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
        setQueue((current) => current.scope === sessionId
          ? toastQueueReducer(current, { type: "expire", key: toast.key }) : current);
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

  return visible;
}
