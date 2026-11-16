import { useEffect, useRef, type ReactNode } from "react";
import { modalDialogOpen } from "./GameMenu";

export interface TurnLogDrawerProps {
  expanded: boolean;
  embedded?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  logRegionId: string;
  logOpenerRef: React.RefObject<HTMLElement | null>;
  arrival: string | null;
  roll: string;
  lottery: React.ReactNode;
  notice: React.ReactNode;
  routeSummary: React.ReactNode;
  candidates: React.ReactNode;
  effectTexts: readonly string[];
  progress?: ReactNode;
}

const LOG_ICON_SIZE = 16;
export const LOG_REVEAL_PADDING_PX = 8;

/** True when the element is connected, laid out and not CSS-hidden, so focusing it lands somewhere visible. */
function isVisible(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.getClientRects().length === 0) return false;
  const style: CSSStyleDeclaration = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function revealInPanel(element: HTMLElement): void {
  const panel = element.closest<HTMLElement>(".game-panel");
  if (!panel) return;
  const panelRect = panel.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (elementRect.top < panelRect.top || elementRect.bottom > panelRect.bottom) panel.scrollTop += elementRect.top - panelRect.top - LOG_REVEAL_PADDING_PX;
}

/** Persistent turn transcript and text route view, hidden as one disclosure. */
export function TurnLogDrawer({
  expanded,
  embedded = false,
  onExpandedChange,
  logRegionId,
  logOpenerRef,
  arrival,
  roll,
  lottery,
  notice,
  routeSummary,
  candidates,
  effectTexts,
  progress,
}: TurnLogDrawerProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded || embedded) return;
    // Capture phase so the log closes before the bubbling draft-clear handler.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A native modal owns Escape: preventing it here would keep the dialog open.
      if (modalDialogOpen()) return;
      event.preventDefault();
      const opener = logOpenerRef.current;
      onExpandedChange(false);
      logOpenerRef.current = null;
      const returnTarget = isVisible(opener) ? opener : triggerRef.current;
      if (!returnTarget) return;
      if (returnTarget === triggerRef.current) revealInPanel(returnTarget);
      returnTarget.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded, embedded, onExpandedChange, logOpenerRef]);

  const close = (): void => {
    logOpenerRef.current = null;
    onExpandedChange(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const open = (): void => {
    logOpenerRef.current = triggerRef.current;
    onExpandedChange(true);
  };

  return (
    <>
      {!embedded && <button
        ref={triggerRef}
        type="button"
        className="game-panel__log-trigger"
        aria-expanded={expanded}
        aria-controls={logRegionId}
        onClick={() => expanded ? close() : open()}
      >
        <svg className="game-panel__log-icon" aria-hidden="true" focusable="false" width={LOG_ICON_SIZE} height={LOG_ICON_SIZE} viewBox="0 0 16 16">
          <path d="M2.5 3.5h1M6 3.5h7.5M2.5 8h1M6 8h7.5M2.5 12.5h1M6 12.5h7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>ログ</span>
        <svg className="game-panel__log-chevron" aria-hidden="true" focusable="false" width={LOG_ICON_SIZE} height={LOG_ICON_SIZE} viewBox="0 0 16 16">
          <path d={expanded ? "M3 10.5 8 5.5l5 5" : "M3 5.5 8 10.5l5-5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>}
      <section id={logRegionId} className="game-panel__log" aria-label="ターンのログ" tabIndex={-1} hidden={!expanded}>
        <div className="game-panel__turn-facts">
          <h2>このターン</h2>
          <dl>
            <dt>出目</dt>
            <dd><span className="game-panel__log-value" data-stat="roll">{roll}</span></dd>
          </dl>
        </div>
        {arrival && <p className="item-arrival">{arrival}</p>}
        {lottery}
        {notice}
        {effectTexts.length > 0 && <section className="game-panel__effect-texts" aria-label="効果の説明">
          <h2>効果の説明</h2>
          <ul>{effectTexts.map((text, index) => <li key={`${index}:${text}`}>{text}</li>)}</ul>
        </section>}
        {routeSummary}
        {candidates}
        {/* Last, so opening the log still reveals the lottery line first (short landscape only shows it). */}
        {progress}
      </section>
    </>
  );
}
