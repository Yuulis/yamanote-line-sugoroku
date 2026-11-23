import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { GameState, ItemGameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import { earlyStopNote, endpointKindAt } from "../gameSummary";
import { directionLabel, itemHistoryText, landingTransitionText, serviceName } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";
import { PHONE_MEDIA_QUERY } from "../../map/mapConfig";
import { PhraseText } from "./PhraseText";

export const HISTORY_PAGE_SIZE = 20;

interface ClearHistoryProps {
  game: GameState | ItemGameState;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  page: number;
  pageCount: number;
  listRef: RefObject<HTMLOListElement | null>;
  /** Phone only: whether the disclosure is open. Desktop always shows the history. */
  phoneOpen: boolean;
  onPhoneOpenChange: (open: boolean) => void;
  onPageChange: (page: number) => void;
}

function subscribePhone(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function phoneSnapshot(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

/** Live phone-width flag from the same breakpoint the stylesheet uses. */
function useIsPhoneWidth(): boolean {
  return useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
}

/**
 * The move history with its pager. There is one history DOM: desktop shows it under a heading, phones put the
 * same content in a disclosure that starts closed so the result numbers and actions stay on the first screen.
 */
export function ClearHistory({ game, network, presentation, page, pageCount, listRef, phoneOpen, onPhoneOpenChange, onPageChange }: ClearHistoryProps) {
  const isPhone = useIsPhoneWidth();
  const entries = game.movementHistory.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE);
  const body: ReactNode = (
    <>
      <ol ref={listRef} className="clear-screen__history">
        {entries.map((record) => {
          if ("kind" in record) return <li key={record.turn}><PhraseText text={itemHistoryText(record, network, presentation)} /></li>;
          const note = earlyStopNote(record, (id) => presentation.serviceStationName(record.serviceId, id), endpointKindAt(network, record.serviceId, record.toStationId));
          const transition = landingTransitionText(record, network, presentation);
          return (
            <li key={record.turn}>
              <span className="clear-screen__turn">{record.turn}ターン目</span>{" "}
              <PhraseText text={`出目${record.roll}：${presentation.serviceStationName(record.serviceId, record.fromStationId)} → ${presentation.serviceStationName(record.serviceId, record.toStationId)}（${serviceName(network, record.serviceId, presentation)}・${directionLabel(network, record.serviceId, record.direction)}）`} />
              {transition && <PhraseText text={` → ${transition}`} />}
              {note !== null && <PhraseText text={`（${note}）`} />}
            </li>
          );
        })}
      </ol>
      {pageCount > 1 && (
        <nav className="clear-screen__paging" aria-label="移動履歴のページ">
          <button type="button" disabled={page === 0} onClick={() => onPageChange(page - 1)}>前のページ</button>
          <span className="clear-screen__page-status">{page + 1} / {pageCount}ページ</span>
          <button type="button" disabled={page === pageCount - 1} onClick={() => onPageChange(page + 1)}>次のページ</button>
        </nav>
      )}
    </>
  );
  if (!isPhone) {
    return (
      <>
        <h2 className="clear-screen__subtitle">移動履歴</h2>
        {body}
      </>
    );
  }
  return (
    <details
      className="clear-screen__history-details"
      open={phoneOpen}
      onToggle={(event) => onPhoneOpenChange(event.currentTarget.open)}
    >
      <summary>移動履歴</summary>
      {body}
    </details>
  );
}
