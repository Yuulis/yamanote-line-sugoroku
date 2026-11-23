import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject, type SyntheticEvent } from "react";
import type { GameState, ItemGameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import { buildHistoryRows, type HistoryRow } from "../historyRows";
import type { PresentationResolver } from "../presentationResolver";
import { PhraseText } from "./PhraseText";

export const HISTORY_PAGE_SIZE = 20;

interface ClearHistoryProps {
  game: GameState | ItemGameState;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  rows?: readonly HistoryRow[];
  onBeforeOpen?: () => void;
}

interface HistoryDialogProps extends ClearHistoryProps {
  page: number;
  pageCount: number;
  /** The launcher that regains focus when the dialog closes. */
  opener: RefObject<HTMLButtonElement | null>;
  onPageChange: (page: number) => void;
  rows?: readonly HistoryRow[];
  onClose: () => void;
}

function HistoryRowItem({ row }: { row: HistoryRow }) {
  return (
    <li className="clear-history__row" data-record-index={row.recordIndex} data-record-kind={row.kind}>
      <span className="clear-history__turn">{row.turnText}</span>
      <span className="clear-history__roll"><PhraseText text={row.rollText} /></span>
      <span className="clear-history__move"><PhraseText text={row.moveText} /></span>
      {row.lineText !== null && <span className="clear-history__line"><PhraseText text={row.lineText} /></span>}
      {row.notes.length > 0 && (
        <div className="clear-history__notes">
          {row.notes.map((note, index) => (
            <p key={index} className="clear-history__note" data-note={note.kind}>
              {note.label !== null && <span className="clear-history__note-label">{note.label}</span>}
              <PhraseText text={note.text} />
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The move history on a native modal <dialog>: the browser keeps focus inside, makes the card behind inert and
 * closes on Escape. React owns closing: Escape, the backdrop and 閉じる only request it, and unmounting closes
 * the dialog and returns focus to the launcher.
 */
function HistoryDialog({ game, network, presentation, page, pageCount, opener, onPageChange, onClose, rows: savedRows }: HistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const rows = (savedRows ?? buildHistoryRows(game.movementHistory, network, presentation))
    .slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      const launcher = opener.current;
      if (launcher?.isConnected) launcher.focus();
    };
  }, [opener]);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [page]);

  const onDialogCancel = (event: SyntheticEvent): void => {
    event.preventDefault();
    onClose();
  };
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog ref={dialogRef} className="clear-history" aria-labelledby={titleId} onCancel={onDialogCancel} onClick={onBackdropClick}>
      <div className="clear-history__header">
        <h2 id={titleId} ref={headingRef} className="clear-history__title" tabIndex={-1}>移動履歴</h2>
        <button type="button" onClick={onClose}>閉じる</button>
      </div>
      <ol ref={listRef} className="clear-screen__history">
        {rows.map((row) => <HistoryRowItem key={row.turn} row={row} />)}
      </ol>
      {pageCount > 1 && (
        <nav className="clear-screen__paging" aria-label="移動履歴のページ">
          <button type="button" disabled={page === 0} onClick={() => onPageChange(page - 1)}>前のページ</button>
          <span className="clear-screen__page-status" role="status" aria-live="polite" aria-atomic="true">{page + 1} / {pageCount}ページ</span>
          <button type="button" disabled={page === pageCount - 1} onClick={() => onPageChange(page + 1)}>次のページ</button>
        </nav>
      )}
    </dialog>
  );
}

/**
 * Launcher and dialog of the move history. The page lives here, so it survives closing and reopening within one
 * published result; the clear screen is keyed by the publication generation, which resets it for a new result.
 */
export function ClearHistory({ game, network, presentation, rows, onBeforeOpen }: ClearHistoryProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const pageCount = Math.max(1, Math.ceil(game.movementHistory.length / HISTORY_PAGE_SIZE));
  return (
    <>
      <button ref={launcherRef} type="button" className="clear-screen__history-button" onClick={() => { onBeforeOpen?.(); setOpen(true); }}>
        移動履歴を見る
      </button>
      {open && (
        <HistoryDialog
          game={game}
          network={network}
          presentation={presentation}
          page={Math.min(page, pageCount - 1)}
          pageCount={pageCount}
          rows={rows}
          opener={launcherRef}
          onPageChange={setPage}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
