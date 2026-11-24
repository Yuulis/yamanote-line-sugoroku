import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import type { GameState, ItemGameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import type { ClearResult } from "../clearResult";
import { PHONE_MEDIA_QUERY } from "../../map/mapConfig";
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
import { ClearReplayControls } from "./ClearReplayControls";
import type { ClearReplayStore } from "../clearReplayStore";
import type { HistoryRow } from "../historyRows";
import { buildHistoryRows } from "../historyRows";
import { createClearReplayStore } from "../clearReplayStore";

export { HISTORY_PAGE_SIZE };

function subscribePhoneWidth(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(PHONE_MEDIA_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
}

function getPhoneWidth(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

interface ClearScreenProps {
  game: GameState | ItemGameState;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  /** Result derived once per published clear (see usePublishedClearResult). */
  result: ClearResult;
  historyRows?: readonly HistoryRow[];
  replayStore?: ClearReplayStore;
  reducedMotion?: boolean;
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
  /** The card element, so the map can frame the route in the area the card leaves open. */
  cardRef?: Ref<HTMLElement>;
}

/** Shown once the clearing move has finished animating (spec 6.1). */
export function ClearScreen({ game, network, presentation, result, historyRows, replayStore, reducedMotion = false, collection, saveStatus, itemNotice, completionAnnouncement = "", shareActions = browserResultShareActions(), onPlayAgain, onShowTitle, cardRef }: ClearScreenProps) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [showShareText, setShowShareText] = useState(false);
  const [announcement, setAnnouncement] = useState<ClearAnnouncement | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearCardRef = useRef<HTMLElement | null>(null);
  const focusedRegionRef = useRef<"content" | "controls" | "other">("other");
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const ownedReplayStore = useMemo(() => createClearReplayStore({ route: result.route, reducedMotion }), [result.route]);
  const activeReplayStore = replayStore ?? ownedReplayStore;
  const replayPhase = useSyncExternalStore(activeReplayStore.subscribePhase, activeReplayStore.getPhase, activeReplayStore.getPhase);
  const phoneWidth = useSyncExternalStore(subscribePhoneWidth, getPhoneWidth, () => false);
  const replayCollapsed = phoneWidth && !historyDialogOpen && !reducedMotion
    && (replayPhase === "playing" || replayPhase === "paused");
  const previousReplayCollapsedRef = useRef(replayCollapsed);
  const setCardRef = useCallback((node: HTMLElement | null): void => {
    clearCardRef.current = node;
    if (typeof cardRef === "function") cardRef(node);
    else if (cardRef) cardRef.current = node;
  }, [cardRef]);
  const savedRows = useMemo(() => historyRows ?? buildHistoryRows(game.movementHistory, network, presentation),
    [historyRows, game, network, presentation]);
  useEffect(() => {
    ownedReplayStore.activate();
    return () => ownedReplayStore.dispose();
  }, [ownedReplayStore]);
  useLayoutEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      focusedElementRef.current = target;
      const card = clearCardRef.current;
      if (!target || !card?.contains(target)) {
        focusedRegionRef.current = "other";
        return;
      }
      if (target.closest(".clear-screen__content, .clear-screen__share-actions")) {
        focusedRegionRef.current = "content";
      } else if (target.closest(".clear-replay-controls")) {
        focusedRegionRef.current = "controls";
      } else {
        focusedRegionRef.current = "other";
      }
    };
    // A blur to nowhere (e.g. tapping empty space) leaves no focusin, so record it here; a blur caused by the
    // element being removed keeps the last region so the collapse/expand handoff can still restore focus.
    const onFocusOut = (event: FocusEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || event.relatedTarget !== null) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!target.isConnected || (active !== null && active !== document.body)) return;
        focusedRegionRef.current = "other";
        focusedElementRef.current = null;
      });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  useLayoutEffect(() => {
    const wasCollapsed = previousReplayCollapsedRef.current;
    if (wasCollapsed === replayCollapsed) return;
    previousReplayCollapsedRef.current = replayCollapsed;
    const card = clearCardRef.current;
    if (!card || !phoneWidth) return;

    const focusedElement = focusedElementRef.current;
    const focusStayedOnElement = focusedElement?.isConnected && document.activeElement === focusedElement;
    if (!wasCollapsed && replayCollapsed) {
      if (focusedRegionRef.current === "content"
        || (focusedRegionRef.current === "controls" && !focusStayedOnElement)) {
        card.querySelector<HTMLButtonElement>(".clear-replay-controls__active > button")?.focus({ preventScroll: true });
      }
      return;
    }

    card.scrollTop = 0;
    if (focusedRegionRef.current === "controls" && !focusStayedOnElement) {
      card.querySelector<HTMLButtonElement>(".clear-replay-controls__start")?.focus({ preventScroll: true });
    }
  }, [phoneWidth, replayCollapsed]);
  useLayoutEffect(() => {
    const screen = headingRef.current?.closest<HTMLElement>(".clear-screen");
    if (!headingRef.current || !screen) return;
    screen.scrollTop = 0;
    headingRef.current.focus({ preventScroll: true });
  }, []);
  const { turns, moves, transfers } = result.summary;
  const { shareText } = result;
  const canShare = shareActions.canShare(shareText);
  const announce = useCallback((text: string): void => setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text })), []);
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
  const goalName = stationName(network, game.config.startStationId, presentation);
  return (
    <section ref={setCardRef} className={`clear-screen${replayCollapsed ? " clear-screen--replay-collapsed" : ""}`} aria-labelledby="clear-title">
      <ClearAnnouncements completion={completionAnnouncement} message={announcement} />
      <div className="clear-screen__content" hidden={replayCollapsed} aria-hidden={replayCollapsed} inert={replayCollapsed}>
        <h1 ref={headingRef} id="clear-title" className="clear-screen__title" tabIndex={-1}>
          クリア！
        </h1>
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
      </div>
      <div className="clear-screen__share">
        <div className="clear-screen__share-actions" hidden={replayCollapsed} aria-hidden={replayCollapsed} inert={replayCollapsed}>
          <button type="button" onClick={copyResult}>結果をコピー</button>
          {canShare && <button type="button" onClick={shareResult}>共有</button>}
        </div>
        {result.route !== null && <ClearReplayControls store={activeReplayStore} reducedMotion={reducedMotion} onAnnounce={announce} />}
      </div>
      <div className="clear-screen__content" hidden={replayCollapsed} aria-hidden={replayCollapsed} inert={replayCollapsed}>
        {result.route === null && <p className="clear-screen__replay-unavailable">経路を描画できないため、軌跡を再生できません。</p>}
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
        <ClearHistory
          game={game}
          network={network}
          presentation={presentation}
          rows={savedRows}
          onBeforeOpen={() => activeReplayStore.pause()}
          onDialogOpenChange={setHistoryDialogOpen}
        />
        <ClearHighlights
          highlights={result.highlights}
          network={network}
          presentation={presentation}
          startStationId={game.config.startStationId}
          targetServiceId={game.config.targetServiceId}
        />
      </div>
    </section>
  );
}
