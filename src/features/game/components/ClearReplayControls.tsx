import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HistoryRow } from "../historyRows";
import {
  CLEAR_REPLAY_SPEED_LABELS,
  type ClearReplayStore,
  type ClearReplayUiSnapshot,
  type ClearReplaySpeed,
} from "../clearReplayStore";

const SPEEDS: readonly ClearReplaySpeed[] = ["slow", "normal", "fast"];

function useReplayUi(store: ClearReplayStore): ClearReplayUiSnapshot {
  return useSyncExternalStore(store.subscribeUi, store.getUiSnapshot, store.getUiSnapshot);
}

interface ClearReplayControlsProps {
  readonly store: ClearReplayStore;
  readonly reducedMotion: boolean;
  readonly onAnnounce: (text: string) => void;
}

/** Screen controls subscribe only to saved-turn changes, never to map animation frames. */
export function ClearReplayControls({ store, reducedMotion, onAnnounce }: ClearReplayControlsProps) {
  const snapshot = useReplayUi(store);
  const [speed, setSpeed] = useState(store.getSpeed());
  const previousPhase = useRef(snapshot.phase);

  useEffect(() => { store.setReducedMotion(reducedMotion); }, [store, reducedMotion]);
  useEffect(() => {
    const previous = previousPhase.current;
    if (previous !== snapshot.phase) {
      if (snapshot.phase === "playing") {
        onAnnounce(previous === "paused" ? "経路の再生を再開しました" : "経路の再生を開始しました");
      } else if (snapshot.phase === "paused") {
        onAnnounce("経路の再生を一時停止しました");
      } else if (snapshot.phase === "done") {
        onAnnounce("全経路を表示しました");
      }
      previousPhase.current = snapshot.phase;
    }
  }, [snapshot.phase, onAnnounce]);

  const chooseSpeed = (nextSpeed: ClearReplaySpeed): void => {
    store.setSpeed(nextSpeed);
    setSpeed(nextSpeed);
  };

  return (
    <div className="clear-replay-controls" aria-label="軌跡の再生">
      {(snapshot.phase === "idle" || snapshot.phase === "done") && (
        <button type="button" className="clear-replay-controls__start" onClick={() => store.start()}>
          {reducedMotion ? "全経路を表示" : "軌跡を再生"}
        </button>
      )}
      {(snapshot.phase === "playing" || snapshot.phase === "paused") && (
        <div className="clear-replay-controls__active">
          <button type="button" onClick={() => snapshot.phase === "playing" ? store.pause() : store.resume()}>
            {snapshot.phase === "playing" ? "一時停止" : "再開"}
          </button>
          <div className="clear-replay-controls__speeds" role="group" aria-label="再生速度">
            {SPEEDS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="clear-replay-controls__speed"
                aria-pressed={speed === candidate}
                aria-label={`速度: ${CLEAR_REPLAY_SPEED_LABELS[candidate]}`}
                onClick={() => chooseSpeed(candidate)}
              >
                {CLEAR_REPLAY_SPEED_LABELS[candidate]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => store.finish()}>全経路を表示</button>
        </div>
      )}
    </div>
  );
}

interface ClearReplayMapCaptionProps {
  readonly store: ClearReplayStore;
  readonly rows: readonly HistoryRow[];
}

/** One complete caption stays in the DOM; CSS clips only the station-name span on narrow maps. */
export function ClearReplayMapCaption({ store, rows }: ClearReplayMapCaptionProps) {
  const snapshot = useReplayUi(store);
  if (snapshot.phase !== "playing" && snapshot.phase !== "paused") return null;
  const row = rows[snapshot.recordIndex];
  if (!row) return null;
  const caption = `${row.turnText}：${row.rollText} → ${row.toStationName}`;
  return (
    <p className="clear-replay-caption" aria-label={caption} data-record-index={row.recordIndex}>
      <span className="clear-replay-caption__turn">{row.turnText}：</span>
      <span className="clear-replay-caption__roll">{row.rollText}</span>
      <span className="clear-replay-caption__arrow" aria-hidden="true">→</span>
      <span className="clear-replay-caption__station" title={row.toStationName}>{row.toStationName}</span>
    </p>
  );
}
