import { useLayoutEffect, useRef, useState } from "react";
import type { GameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import { earlyStopNote, endpointKindAt, summarizeGame } from "../gameSummary";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";
import { directionLabel, serviceName, stationName } from "../presentation";

interface ClearScreenProps {
  game: GameState;
  network: RailwayNetwork;
  /** Result of saving the clearing turn; a failure must stay visible here. */
  saveStatus: SaveWriteResult | null;
  onPlayAgain: () => void;
  onShowTitle: () => void;
}

export const HISTORY_PAGE_SIZE = 20;

/** Shown once the clearing move has finished animating (spec 6.1). */
export function ClearScreen({ game, network, saveStatus, onPlayAgain, onShowTitle }: ClearScreenProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(game.movementHistory.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const historyRef = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = 0;
  }, [currentPage]);
  const { turns, moves, transfers } = summarizeGame(game);
  const goalName = stationName(network, game.config.startStationId);
  return (
    <section className="clear-screen" aria-labelledby="clear-title">
      <h1 id="clear-title" className="clear-screen__title">
        クリア！
      </h1>
      <p>山手線の外回り全30区間を踏破し、{goalName}に戻りました。</p>
      {saveStatus !== "saved" && (
        <p className="clear-screen__save-warning" role="alert">
          セーブ: {saveStatusMessage(saveStatus)}。再読み込みするとこのクリアは残りません。
        </p>
      )}
      <dl className="clear-screen__stats">
        <dt>所要ターン数</dt>
        <dd>{turns}ターン</dd>
        <dt>移動回数（駅間）</dt>
        <dd>{moves}回</dd>
        <dt>乗換回数</dt>
        <dd>{transfers}回</dd>
      </dl>
      <h2 className="clear-screen__subtitle">移動履歴</h2>
      <ol ref={historyRef} className="clear-screen__history">
        {game.movementHistory.slice(currentPage * HISTORY_PAGE_SIZE, (currentPage + 1) * HISTORY_PAGE_SIZE).map((record) => {
          const note = earlyStopNote(record, (id) => stationName(network, id), endpointKindAt(network, record.serviceId, record.toStationId));
          return (
            <li key={record.turn}>
              <span className="clear-screen__turn">{record.turn}ターン目</span> 出目{record.roll}：
              {stationName(network, record.fromStationId)} → {stationName(network, record.toStationId)}
              （{serviceName(network, record.serviceId)}・{directionLabel(network, record.serviceId, record.direction)}）
              {record.landing && record.landing.serviceId !== record.serviceId && ` → 乗換: ${serviceName(network, record.landing.serviceId)}（${directionLabel(network, record.landing.serviceId, record.landing.direction)}）`}
              {note !== null && `（${note}）`}
            </li>
          );
        })}
      </ol>
      {pageCount > 1 && (
        <nav className="clear-screen__paging" aria-label="移動履歴のページ">
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前のページ</button>
          <span role="status">{currentPage + 1} / {pageCount}ページ</span>
          <button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>次のページ</button>
        </nav>
      )}
      <div className="clear-screen__actions">
        <button type="button" className="button-primary" onClick={onPlayAgain} autoFocus>
          もう一度遊ぶ
        </button>
        <button type="button" onClick={onShowTitle}>
          タイトルへ
        </button>
      </div>
    </section>
  );
}
