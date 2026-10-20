import { useLayoutEffect, useRef, useState } from "react";
import type { GameState } from "../../../types/network";
import type { EditionDisplay } from "../../editions/types";
import type { RailwayNetwork } from "../engine";
import { earlyStopNote, endpointKindAt, summarizeGame } from "../gameSummary";
import { buildShareText } from "../shareText";
import { browserResultShareActions, type ResultShareActions } from "../resultShareActions";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";
import { directionLabel, landingTransitionText, serviceName, stationName } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";

interface ClearScreenProps {
  game: GameState;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  display: EditionDisplay;
  shareActions?: ResultShareActions;
  /** Result of saving the clearing turn; a failure must stay visible here. */
  saveStatus: SaveWriteResult | null;
  onPlayAgain: () => void;
  onShowTitle: () => void;
}

export const HISTORY_PAGE_SIZE = 20;

/** Shown once the clearing move has finished animating (spec 6.1). */
export function ClearScreen({ game, network, presentation, display, saveStatus, shareActions = browserResultShareActions(), onPlayAgain, onShowTitle }: ClearScreenProps) {
  const [page, setPage] = useState(0);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [showShareText, setShowShareText] = useState(false);
  const pageCount = Math.max(1, Math.ceil(game.movementHistory.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const historyRef = useRef<HTMLOListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = 0;
  }, [currentPage]);
  useLayoutEffect(() => {
    const screen = headingRef.current?.closest<HTMLElement>(".clear-screen");
    if (!headingRef.current || !screen) return;
    screen.scrollTop = 0;
    headingRef.current.focus({ preventScroll: true });
  }, []);
  const { turns, moves, transfers } = summarizeGame(game, presentation);
  const shareText = buildShareText(display, { turns, moves, transfers });
  const canShare = shareActions.canShare(shareText);
  const copyResult = async () => {
    const copied = await shareActions.copy(shareText);
    setShowShareText(!copied);
    setShareMessage(copied
      ? "結果をコピーしました"
      : "コピーできませんでした。下の文面を選択してコピーしてください。");
  };
  const shareResult = async () => {
    const result = await shareActions.share(shareText);
    if (result === "cancelled") return;
    setShowShareText(result === "failed");
    setShareMessage(result === "failed"
      ? "共有できませんでした。下の文面を選択してコピーしてください。"
      : null);
  };
  const goalName = stationName(network, game.config.startStationId, presentation);
  return (
    <section className="clear-screen" aria-labelledby="clear-title">
      <h1 ref={headingRef} id="clear-title" className="clear-screen__title" tabIndex={-1}>
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
          const note = earlyStopNote(record, (id) => presentation.serviceStationName(record.serviceId, id), endpointKindAt(network, record.serviceId, record.toStationId));
          const transition = landingTransitionText(record, network, presentation);
          return (
            <li key={record.turn}>
              <span className="clear-screen__turn">{record.turn}ターン目</span> 出目{record.roll}：
              {presentation.serviceStationName(record.serviceId, record.fromStationId)} → {presentation.serviceStationName(record.serviceId, record.toStationId)}
              （{serviceName(network, record.serviceId, presentation)}・{directionLabel(network, record.serviceId, record.direction)}）
              {transition && ` → ${transition}`}
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
        <button type="button" onClick={copyResult}>結果をコピー</button>
        {canShare && <button type="button" onClick={shareResult}>共有</button>}
        <button type="button" className="button-primary" onClick={onPlayAgain}>
          もう一度遊ぶ
        </button>
        <button type="button" onClick={onShowTitle}>
          タイトルへ
        </button>
      </div>
      {shareMessage !== null && <p className="clear-screen__share-status" role="status">{shareMessage}</p>}
      {showShareText && (
        <div className="clear-screen__share-fallback">
          <label htmlFor="clear-share-text">共有する結果</label>
          <textarea id="clear-share-text" readOnly value={shareText} rows={4} />
        </div>
      )}
    </section>
  );
}
