import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import type { GameState, ItemGameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import type { ClearResult } from "../clearResult";
import { PHONE_MEDIA_QUERY } from "../../map/mapConfig";
import { browserResultShareActions, type ResultShareActions } from "../resultShareActions";
import { browserResultImageShareActions, buildXIntentUrl, type ResultImageShareActions } from "../resultImageShareActions";
import { useClearImageShare } from "../useClearImageShare";
import type { RouteImageState } from "../../map/routeImage";
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

function isVisibleInLayout(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
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
  /** The pre-generated route PNG; image actions exist only while it is pending or ready. */
  routeImage?: RouteImageState;
  imageShareActions?: ResultImageShareActions;
  /** Called in the click that starts a PNG download, so its object URL outlives the download. */
  onImageDownloadStarted?: () => void;
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

const UNAVAILABLE_IMAGE: RouteImageState = { kind: "unavailable" };
const IMAGE_FAILED_NOTE = "画像を作成できませんでした。文面だけで共有できます。";
const noop = (): void => {};

/** Shown once the clearing move has finished animating (spec 6.1). */
export function ClearScreen({ game, network, presentation, result, historyRows, replayStore, reducedMotion = false, collection, saveStatus, itemNotice, completionAnnouncement = "", shareActions = browserResultShareActions(), routeImage = UNAVAILABLE_IMAGE, imageShareActions: injectedImageActions, onImageDownloadStarted = noop, onPlayAgain, onShowTitle, cardRef }: ClearScreenProps) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [showShareText, setShowShareText] = useState(false);
  const [announcement, setAnnouncement] = useState<ClearAnnouncement | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearCardRef = useRef<HTMLElement | null>(null);
  const focusedRegionRef = useRef<"content" | "controls" | "other">("other");
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const historyOpenerRef = useRef<HTMLButtonElement | null>(null);
  const ownedReplayStore = useMemo(() => createClearReplayStore({ route: result.route, reducedMotion }), [result.route]);
  const activeReplayStore = replayStore ?? ownedReplayStore;
  const replayUi = useSyncExternalStore(activeReplayStore.subscribeUi, activeReplayStore.getUiSnapshot, activeReplayStore.getUiSnapshot);
  const replayPhase = replayUi.phase;
  const phoneWidth = useSyncExternalStore(subscribePhoneWidth, getPhoneWidth, () => false);
  const replayCollapsed = !replayUi.cardExpanded && replayPhase !== "idle" && !reducedMotion;
  const previousReplayCollapsedRef = useRef(replayCollapsed);
  const previousHistoryDialogOpenRef = useRef(historyDialogOpen);
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
      const isHistoryTrigger = target?.matches(".clear-replay-controls__history") ?? false;
      if (!target || (event.relatedTarget !== null && !isHistoryTrigger)) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!target.isConnected || (active !== null && active !== document.body)) return;
        // Keep the lost-control marker until the breakpoint effect can hand off focus from the
        // desktop history trigger that the phone layout just hid with display:none.
        if (getPhoneWidth() && target.matches(".clear-replay-controls__history")) {
          const card = clearCardRef.current;
          if (card?.querySelector<HTMLDialogElement>("dialog.clear-history")?.open) return;
          const fallback = [...(card?.querySelectorAll<HTMLButtonElement>(".clear-replay-controls__toggle, .clear-replay-controls__results") ?? [])]
            .find(isVisibleInLayout);
          if (fallback) {
            fallback.focus({ preventScroll: true });
            return;
          }
        }
        if (event.relatedTarget !== null) return;
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
    previousReplayCollapsedRef.current = replayCollapsed;
    const card = clearCardRef.current;
    if (!card) return;

    const focusedElement = focusedElementRef.current;
    const focusStayedOnElement = focusedElement?.isConnected && document.activeElement === focusedElement;
    const transitionChanged = wasCollapsed !== replayCollapsed;
    const focusWasLostFromControls = focusedRegionRef.current === "controls" && !focusStayedOnElement;
    if (transitionChanged && !wasCollapsed && replayCollapsed) {
      if (focusedRegionRef.current === "content" || focusWasLostFromControls) {
        const target = replayPhase === "playing"
          ? card.querySelector<HTMLButtonElement>(".clear-replay-controls__toggle")
          : card.querySelector<HTMLButtonElement>(".clear-replay-controls__results");
        target?.focus({ preventScroll: true });
      }
      return;
    }
    if (transitionChanged && wasCollapsed && !replayCollapsed) {
      card.scrollTop = 0;
      if (focusWasLostFromControls) {
        const target = card.querySelector<HTMLButtonElement>(".clear-replay-controls__start") ?? headingRef.current;
        target?.focus({ preventScroll: true });
      }
      return;
    }

    // Pause, natural completion and finish replace the focused strip control while the strip remains visible.
    if (!transitionChanged && focusWasLostFromControls && (replayPhase === "playing" || replayPhase === "paused" || replayPhase === "done")) {
      const target = replayPhase === "playing"
        ? card.querySelector<HTMLButtonElement>(".clear-replay-controls__toggle")
        : replayPhase === "paused"
          ? card.querySelector<HTMLButtonElement>(".clear-replay-controls__toggle")
          : replayUi.cardExpanded
            ? card.querySelector<HTMLButtonElement>(".clear-replay-controls__start")
            : card.querySelector<HTMLButtonElement>(".clear-replay-controls__results");
      target?.focus({ preventScroll: true });
    }
  }, [replayPhase, replayUi.cardExpanded, replayCollapsed, phoneWidth]);
  useLayoutEffect(() => {
    const wasOpen = previousHistoryDialogOpenRef.current;
    previousHistoryDialogOpenRef.current = historyDialogOpen;
    if (!wasOpen || historyDialogOpen) return;
    const card = clearCardRef.current;
    if (!card || isVisibleInLayout(historyOpenerRef.current)) return;
    const target = [...card.querySelectorAll<HTMLButtonElement>(".clear-replay-controls__toggle, .clear-replay-controls__results")]
      .find(isVisibleInLayout);
    target?.focus({ preventScroll: true });
  }, [historyDialogOpen, phoneWidth, replayCollapsed, replayPhase, replayUi.cardExpanded]);
  useLayoutEffect(() => {
    const map = document.querySelector<HTMLElement>(".map-container");
    const card = clearCardRef.current;
    if (!map || !card || !replayCollapsed || phoneWidth) {
      map?.style.removeProperty("--clear-replay-attribution-bottom");
      return;
    }

    const updateAttributionPosition = (): void => {
      const lift = Math.max(0, window.innerHeight - card.getBoundingClientRect().top + 12);
      map.style.setProperty("--clear-replay-attribution-bottom", `${lift}px`);
    };
    updateAttributionPosition();
    window.addEventListener("resize", updateAttributionPosition);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAttributionPosition);
    observer?.observe(card);
    return () => {
      window.removeEventListener("resize", updateAttributionPosition);
      observer?.disconnect();
      map.style.removeProperty("--clear-replay-attribution-bottom");
    };
  }, [replayCollapsed, phoneWidth, replayPhase, replayUi.cardExpanded]);
  useLayoutEffect(() => {
    const screen = headingRef.current?.closest<HTMLElement>(".clear-screen");
    if (!headingRef.current || !screen) return;
    screen.scrollTop = 0;
    headingRef.current.focus({ preventScroll: true });
  }, []);
  const { turns, moves, transfers } = result.summary;
  const { shareText } = result;
  const canShare = shareActions.canShare(shareText);
  const imageActions = useMemo(() => injectedImageActions ?? browserResultImageShareActions(), [injectedImageActions]);
  const imageShareProbeFile = useMemo(() => typeof File === "undefined"
    ? null
    : new File(["png"], "yamanote-sugoroku-route.png", { type: "image/png" }), []);
  const fileShareSupported = useMemo(() => {
    if (routeImage.kind === "ready") return imageActions.canShareFile(routeImage.image.file);
    if (routeImage.kind === "pending" && imageShareProbeFile) return imageActions.canShareFile(imageShareProbeFile);
    return false;
  }, [imageActions, imageShareProbeFile, routeImage]);
  // Where "Xでシェア" opens the native sheet with the PNG and the same text, a text-only 共有 button would only repeat it.
  const fileShareActive = routeImage.kind === "ready" && fileShareSupported;
  const announce = useCallback((text: string): void => setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text })), []);
  const showMessage = (text: string | null, textFallback: boolean): void => {
    setShowShareText(textFallback);
    setShareMessage(text);
    if (text !== null) announce(text);
  };
  // Every share, copy or save completes a running replay first, so the route is whole when the action starts.
  const finishReplay = useCallback((): void => {
    const phase = activeReplayStore.getPhase();
    if (phase === "playing" || phase === "paused") activeReplayStore.finish();
  }, [activeReplayStore]);
  const openHistoryFromReplay = useCallback((opener: HTMLButtonElement): void => {
    historyOpenerRef.current = opener;
    activeReplayStore.pause();
    setHistoryDialogOpen(true);
  }, [activeReplayStore]);
  // An image message keeps the selectable text fallback of an earlier failed copy on screen.
  const showImageMessage = useCallback((text: string | null): void => {
    setShareMessage(text);
    if (text !== null) announce(text);
  }, [announce]);
  // An image failure is only shown as a note, never announced: it can land in the same commit as the publication and
  // would replace the completion sentence in the single polite region before it is spoken.
  // When the image becomes ready, 共有 is replaced by Xでシェア; keep keyboard focus on the share row.
  const textShareFocusedRef = useRef(false);
  const shareToXRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!fileShareActive || !textShareFocusedRef.current) return;
    textShareFocusedRef.current = false;
    shareToXRef.current?.focus({ preventScroll: true });
  }, [fileShareActive]);
  const imageShare = useClearImageShare({
    image: routeImage, shareText, actions: imageActions, finishReplay,
    onMessage: showImageMessage, onDownloadStarted: onImageDownloadStarted,
  });
  const copyResult = async () => {
    finishReplay();
    const copied = await shareActions.copy(shareText);
    trackEvent("result_share", { method: "copy", outcome: copied ? "success" : "failed" });
    showMessage(copied
      ? "結果をコピーしました"
      : "コピーできませんでした。下の文面を選択してコピーしてください。", !copied);
  };
  const shareResult = async () => {
    finishReplay();
    const outcome = await shareActions.share(shareText);
    trackEvent("result_share", { method: "share", outcome: outcome === "shared" ? "success" : outcome });
    if (outcome === "cancelled") return;
    showMessage(outcome === "failed"
      ? "共有できませんでした。下の文面を選択してコピーしてください。"
      : null, outcome === "failed");
  };
  const goalName = stationName(network, game.config.startStationId, presentation);
  const imageActionsAvailable = routeImage.kind === "pending" || routeImage.kind === "ready";
  const imagePending = routeImage.kind === "pending";
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
          {canShare && !fileShareSupported && (
            <button
              type="button"
              onClick={shareResult}
              onFocus={() => { textShareFocusedRef.current = true; }}
              onBlur={() => { textShareFocusedRef.current = false; }}
            >共有</button>
          )}
          {imageActionsAvailable && (
            <>
              <button
                type="button"
                ref={shareToXRef}
                onClick={imageShare.shareToX}
                disabled={imagePending}
                aria-describedby={imagePending ? "clear-image-pending-note" : undefined}
              >Xでシェア</button>
              <button
                type="button"
                onClick={imageShare.saveImage}
                disabled={imagePending}
                aria-describedby={imagePending ? "clear-image-pending-note" : undefined}
              >画像を保存</button>
            </>
          )}
        </div>
        {result.route !== null && (
          <ClearReplayControls
            store={activeReplayStore}
            reducedMotion={reducedMotion}
            onAnnounce={announce}
            onShowHistory={openHistoryFromReplay}
          />
        )}
      </div>
      <div className="clear-screen__content" hidden={replayCollapsed} aria-hidden={replayCollapsed} inert={replayCollapsed}>
        {result.route === null && <p className="clear-screen__replay-unavailable">経路を描画できないため、軌跡を再生できません。</p>}
        <p className="clear-screen__share-status">{shareMessage}</p>
        {routeImage.kind === "failed" && <p className="clear-screen__image-note">{IMAGE_FAILED_NOTE}</p>}
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
          {imageActionsAvailable && (
            <p
              id="clear-image-pending-note"
              className={`clear-screen__image-pending-note${imagePending ? "" : " clear-screen__image-pending-note--reserved"}`}
              aria-hidden={!imagePending}
            >画像を準備中…</p>
          )}
        </div>
      </div>
      <ClearHistory
        game={game}
        network={network}
        presentation={presentation}
        rows={savedRows}
        onBeforeOpen={() => activeReplayStore.pause()}
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        openerRef={historyOpenerRef}
      />
      <div className="clear-screen__content" hidden={replayCollapsed} aria-hidden={replayCollapsed} inert={replayCollapsed}>
        <a
          className="clear-screen__x-text-link"
          href={buildXIntentUrl(shareText)}
          target="_blank"
          rel="noopener"
          onClick={imageShare.handOffTextToX}
        >
          文面だけXに投稿
        </a>
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
