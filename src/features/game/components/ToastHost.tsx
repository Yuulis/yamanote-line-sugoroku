import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  createReadingClock,
  createToastQueue,
  pauseReadingClock,
  readingRemainingMs,
  resumeReadingClock,
  toastQueueReducer,
  visibleToasts,
  type ToastInput,
  type ToastReadingClock,
} from "../toastQueue";
import { ItemIcon } from "./ItemIcon";

export interface ToastHostProps {
  sessionId: number | null;
  inputs: readonly ToastInput[];
  saveFailed: boolean;
  obscured: boolean;
  reducedMotion: boolean;
}

interface ToastTimer {
  clock: ToastReadingClock;
  timer: ReturnType<typeof setTimeout> | null;
}

export function ToastHost({ sessionId, inputs, saveFailed, obscured, reducedMotion }: ToastHostProps): React.JSX.Element {
  const [queue, dispatch] = useReducer(toastQueueReducer, sessionId, createToastQueue);
  const clocks = useRef<Map<string, ToastTimer>>(new Map());
  const currentSession = useRef(sessionId);

  useEffect(() => {
    if (currentSession.current === sessionId) return;
    currentSession.current = sessionId;
    for (const entry of clocks.current.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
    }
    clocks.current.clear();
    dispatch({ type: "resetScope", sessionId });
  }, [sessionId]);

  useEffect(() => {
    dispatch({ type: "enqueue", scope: sessionId, inputs });
  }, [inputs, sessionId]);

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
      if (obscured) {
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = null;
        entry.clock = pauseReadingClock(entry.clock, now);
        continue;
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
  }, [visibleKey, obscured, sessionId]);

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
          className={`toast-host__toast toast-host__toast--${toast.tone}${toast.sticky ? " toast-host__toast--sticky" : ""}${reducedMotion ? "" : " toast-host__toast--motion"}`}
          key={toast.key}
        >
          {toast.itemKind ? <span className="toast-host__icon"><ItemIcon kind={toast.itemKind} size={26} /></span> : null}
          <span className="toast-host__text">{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
