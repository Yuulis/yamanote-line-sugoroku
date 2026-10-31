import { useEffect, useId, useRef } from "react";
import { modalDialogOpen } from "./GameMenu";

export interface TurnLogDrawerProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  arrival: string | null;
  roll: string;
  lottery: React.ReactNode;
  notice: React.ReactNode;
  routeSummary: React.ReactNode;
  candidates: React.ReactNode;
  effectTexts: readonly string[];
}

const LOG_ICON_SIZE = 16;

/** Persistent turn transcript and text route view, hidden as one disclosure. */
export function TurnLogDrawer({
  expanded,
  onExpandedChange,
  arrival,
  roll,
  lottery,
  notice,
  routeSummary,
  candidates,
  effectTexts,
}: TurnLogDrawerProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const regionId = useId();

  useEffect(() => {
    if (!expanded) return;
    // Capture phase so the log closes before the bubbling draft-clear handler.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A native modal owns Escape: preventing it here would keep the dialog open.
      if (modalDialogOpen()) return;
      event.preventDefault();
      onExpandedChange(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded, onExpandedChange]);

  const close = (): void => {
    onExpandedChange(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="game-panel__log-trigger"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => expanded ? close() : onExpandedChange(true)}
      >
        <svg className="game-panel__log-icon" aria-hidden="true" focusable="false" width={LOG_ICON_SIZE} height={LOG_ICON_SIZE} viewBox="0 0 16 16">
          <path d="M2.5 3.5h1M6 3.5h7.5M2.5 8h1M6 8h7.5M2.5 12.5h1M6 12.5h7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>ログ</span>
        <svg className="game-panel__log-chevron" aria-hidden="true" focusable="false" width={LOG_ICON_SIZE} height={LOG_ICON_SIZE} viewBox="0 0 16 16">
          <path d={expanded ? "M3 10.5 8 5.5l5 5" : "M3 5.5 8 10.5l5-5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <section id={regionId} className="game-panel__log" aria-label="ターンのログ" hidden={!expanded}>
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
      </section>
    </>
  );
}
