import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { GameState, ItemGameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import type { ClearResult } from "../clearResult";
import { browserResultShareActions, type ResultShareActions } from "../resultShareActions";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";
import { stationName } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";
import type { CollectionProgress } from "../collectionProgress";
import { trackEvent } from "../../analytics/analytics";
import { PhraseText } from "./PhraseText";
import { ClearAnnouncements, type ClearAnnouncement } from "./ClearAnnouncements";
import { ClearHighlights } from "./ClearHighlights";
import { ClearHistory, HISTORY_PAGE_SIZE } from "./ClearHistory";

export { HISTORY_PAGE_SIZE };

interface ClearScreenProps {
  game: GameState | ItemGameState;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  /** Result derived once per published clear (see usePublishedClearResult). */
  result: ClearResult;
  /** Published collection counters; omitted by callers that render the screen outside the game (e.g. share tests). */
  collection?: CollectionProgress;
  shareActions?: ResultShareActions;
  itemNotice?: ReactNode;
  /** The goal sentence announced once by the screen's single live region; empty when the turn has none. */
  completionAnnouncement?: string;
  /** Result of saving the clearing turn; a failure must stay visible here. */
  saveStatus: SaveWriteResult | null;
  onPlayAgain: () => void;
  onShowTitle: () => void;
}

/** Shown once the clearing move has finished animating (spec 6.1). */
export function ClearScreen({ game, network, presentation, result, collection, saveStatus, itemNotice, completionAnnouncement = "", shareActions = browserResultShareActions(), onPlayAgain, onShowTitle }: ClearScreenProps) {
  const [page, setPage] = useState(0);
  const [phoneHistoryOpen, setPhoneHistoryOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [showShareText, setShowShareText] = useState(false);
  const [announcement, setAnnouncement] = useState<ClearAnnouncement | null>(null);
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
  const { turns, moves, transfers } = result.summary;
  const { shareText } = result;
  const canShare = shareActions.canShare(shareText);
  const announce = (text: string): void => setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  const showMessage = (text: string | null, textFallback: boolean): void => {
    setShowShareText(textFallback);
    setShareMessage(text);
    if (text !== null) announce(text);
  };
  const copyResult = async () => {
    const copied = await shareActions.copy(shareText);
    trackEvent("result_share", { method: "copy", outcome: copied ? "success" : "failed" });
    showMessage(copied
      ? "結果をコピーしました"
      : "コピーできませんでした。下の文面を選択してコピーしてください。", !copied);
  };
  const shareResult = async () => {
    const outcome = await shareActions.share(shareText);
    trackEvent("result_share", { method: "share", outcome });
    if (outcome === "cancelled") return;
    showMessage(outcome === "failed"
      ? "共有できませんでした。下の文面を選択してコピーしてください。"
      : null, outcome === "failed");
  };
  const changePage = (next: number): void => {
    setPage(next);
    announce(`${next + 1} / ${pageCount}ページ`);
  };
  const goalName = stationName(network, game.config.startStationId, presentation);
  return (
    <section className="clear-screen" aria-labelledby="clear-title">
      <h1 ref={headingRef} id="clear-title" className="clear-screen__title" tabIndex={-1}>
        クリア！
      </h1>
      <ClearAnnouncements completion={completionAnnouncement} message={announcement} />
      <p className="clear-screen__summary"><PhraseText text={`山手線の外回り全30区間を踏破し、${goalName}に戻りました。`} /></p>
      {saveStatus !== "saved" && (
        <p className="clear-screen__save-warning" role="alert">
          セーブ: {saveStatusMessage(saveStatus)}。再読み込みするとこのクリアは残りません。
        </p>
      )}
      {itemNotice}
      <dl className="clear-screen__stats">
        <dt>所要ターン数</dt>
        <dd>{turns}ターン</dd>
        <dt>移動回数（駅間）</dt>
        <dd>{moves}回</dd>
        <dt>乗換回数</dt>
        <dd>{transfers}回</dd>
        {collection && (
          <>
            <dt><PhraseText text="訪れた駅" /></dt>
            <dd>{collection.visitedStations.toLocaleString("ja-JP")}/{collection.totalStations.toLocaleString("ja-JP")}</dd>
            <dt><PhraseText text="乗った路線" /></dt>
            <dd>{collection.riddenLines.toLocaleString("ja-JP")}/{collection.totalLines.toLocaleString("ja-JP")}</dd>
          </>
        )}
      </dl>
      <div className="clear-screen__share">
        <button type="button" onClick={copyResult}>結果をコピー</button>
        {canShare && <button type="button" onClick={shareResult}>共有</button>}
      </div>
      <p className="clear-screen__share-status">{shareMessage}</p>
      {showShareText && (
        <div className="clear-screen__share-fallback">
          <label htmlFor="clear-share-text">共有する結果</label>
          <textarea id="clear-share-text" readOnly value={shareText} rows={4} />
        </div>
      )}
      <div className="clear-screen__actions">
        <button type="button" className="button-primary" onClick={onPlayAgain}>
          もう一度遊ぶ
        </button>
        <button type="button" onClick={onShowTitle}>
          タイトルへ
        </button>
      </div>
      <ClearHighlights
        highlights={result.highlights}
        network={network}
        presentation={presentation}
        startStationId={game.config.startStationId}
        targetServiceId={game.config.targetServiceId}
      />
      <ClearHistory
        game={game}
        network={network}
        presentation={presentation}
        page={currentPage}
        pageCount={pageCount}
        listRef={historyRef}
        phoneOpen={phoneHistoryOpen}
        onPhoneOpenChange={setPhoneHistoryOpen}
        onPageChange={changePage}
      />
    </section>
  );
}
