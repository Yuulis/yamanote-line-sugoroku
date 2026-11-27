import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
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
  readonly onShowHistory?: (opener: HTMLButtonElement) => void;
}

/** Screen controls subscribe only to saved-turn changes, never to map animation frames. */
export function ClearReplayControls({ store, reducedMotion, onAnnounce, onShowHistory }: ClearReplayControlsProps) {
  const snapshot = useReplayUi(store);
  const [speed, setSpeed] = useState(store.getSpeed());
  const seekInputId = useId();
  const seekInputRef = useRef<HTMLInputElement>(null);
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

  const stepTurn = (direction: -1 | 1, event: React.MouseEvent<HTMLButtonElement>): void => {
    const targetIndex = snapshot.phase === "done"
      ? 0
      : Math.max(0, Math.min(snapshot.turnCount - 1, snapshot.recordIndex + direction));
    const becomesDisabled = direction === -1
      ? targetIndex <= 0
      : targetIndex >= snapshot.turnCount - 1;
    const returnFocusToRange = document.activeElement === event.currentTarget && becomesDisabled;

    store.step(direction);
    if (returnFocusToRange) seekInputRef.current?.focus({ preventScroll: true });
  };

  const canReplay = snapshot.phase === "idle" || (snapshot.phase === "done" && snapshot.cardExpanded);
  const isActive = snapshot.phase === "playing" || snapshot.phase === "paused";
  const showPausedResults = snapshot.phase === "paused" && !snapshot.cardExpanded;
  const showDoneResults = snapshot.phase === "done" && !snapshot.cardExpanded;
  const isCompletedView = snapshot.phase === "done";
  const showTurnControls = !reducedMotion && !snapshot.cardExpanded && snapshot.turnCount > 0 && (isActive || showDoneResults);
  const displayedTurn = Math.min(snapshot.turnCount, snapshot.recordIndex + 1);
  const turnControls = showTurnControls && (
    <div className="clear-replay-controls__turn" role="group" aria-label="ターン移動">
      <button
        type="button"
        className="clear-replay-controls__step"
        aria-label="前のターン"
        disabled={!isCompletedView && snapshot.recordIndex <= 0}
        onClick={(event) => stepTurn(-1, event)}
      >前</button>
      <label className="clear-replay-controls__turn-label" htmlFor={seekInputId}>
        {isCompletedView ? "全経路" : "ターン"}
      </label>
      <input
        id={seekInputId}
        className="clear-replay-controls__seek"
        type="range"
        ref={seekInputRef}
        min={1}
        max={snapshot.turnCount}
        step={1}
        value={displayedTurn}
        aria-valuetext={isCompletedView
          ? `全経路（${snapshot.turnCount}ターン完了）`
          : `${snapshot.recordIndex + 1} / ${snapshot.turnCount} ターン`}
        onChange={(event) => store.seek(Number(event.currentTarget.value) - 1)}
      />
      <button
        type="button"
        className="clear-replay-controls__step"
        aria-label="次のターン"
        disabled={!isCompletedView && snapshot.recordIndex >= snapshot.turnCount - 1}
        onClick={(event) => stepTurn(+1, event)}
      >次</button>
    </div>
  );
  const historyButton = onShowHistory && (
    <button
      type="button"
      className="clear-replay-controls__history"
      onClick={(event) => onShowHistory(event.currentTarget)}
    >移動履歴を見る</button>
  );

  return (
    <div className="clear-replay-controls" aria-label="軌跡の再生">
      {canReplay && (
        <button type="button" className="clear-replay-controls__start" onClick={() => store.start()}>
          {reducedMotion ? "全経路を表示" : "軌跡を再生"}
        </button>
      )}
      {(isActive || showDoneResults) && (
        <div className={isCompletedView ? "clear-replay-controls__done" : "clear-replay-controls__active"}>
          {turnControls}
          {isActive && (
            <>
              <button className="clear-replay-controls__toggle" type="button" onClick={() => snapshot.phase === "playing" ? store.pause() : store.resume()}>
                {snapshot.phase === "playing" ? "一時停止" : "再開"}
              </button>
              <div className="clear-replay-controls__secondary">
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
                <button className="clear-replay-controls__finish" type="button" onClick={() => store.finish()}>全経路を表示</button>
                {historyButton}
                {showPausedResults && (
                  <button type="button" className="clear-replay-controls__results" onClick={() => store.showResults()}>結果を表示</button>
                )}
              </div>
            </>
          )}
          {showDoneResults && (
            <>
              <button type="button" className="clear-replay-controls__results" onClick={() => store.showResults()}>結果を表示</button>
              {historyButton}
            </>
          )}
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
