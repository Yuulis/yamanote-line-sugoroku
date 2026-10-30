import { useEffect, useId, useRef, useState } from "react";
import { GameLegend, type LegendLine } from "./GameLegend";

const MENU_ICON_SIZE = 16;

export interface GameMenuProps {
  follow: boolean;
  reducedMotion: boolean;
  speedLabel: string;
  lines: readonly LegendLine[];
  targetColor: string | undefined;
  selectedGroupIds: ReadonlySet<string> | null;
  onToggleFollow: () => void;
  onCycleSpeed: () => void;
  onNewGame: () => void;
  onShowTitle: () => void;
  onToggleGroup: (groupId: string, checked: boolean) => void;
  onSetOperator: (operatorId: string, checked: boolean) => void;
  onShowAll: () => void;
}

/** True while a native `<dialog>` is open: it owns Escape before any disclosure or draft handler. */
export function modalDialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/** Persistent game controls and the grouped line legend, hidden as one disclosure. */
export function GameMenu({
  follow,
  reducedMotion,
  speedLabel,
  lines,
  targetColor,
  selectedGroupIds,
  onToggleFollow,
  onCycleSpeed,
  onNewGame,
  onShowTitle,
  onToggleGroup,
  onSetOperator,
  onShowAll,
}: GameMenuProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const regionId = useId();

  useEffect(() => {
    if (!expanded) return;
    // Capture phase so the menu closes before the bubbling draft-clear handler.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A native modal owns Escape: preventing it here would keep the dialog open.
      if (modalDialogOpen()) return;
      event.preventDefault();
      setExpanded(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded]);

  const close = (): void => {
    setExpanded(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const startNewGame = (): void => {
    triggerRef.current?.focus({ preventScroll: true });
    setExpanded(false);
    onNewGame();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="game-panel__menu-trigger"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => expanded ? close() : setExpanded(true)}
      >
        <svg className="game-panel__menu-icon" aria-hidden="true" focusable="false" width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} viewBox="0 0 16 16">
          <path d="M2 3.5h12M2 8h12M2 12.5h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>メニュー</span>
        <svg className="game-panel__menu-chevron" aria-hidden="true" focusable="false" width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} viewBox="0 0 16 16">
          <path d={expanded ? "M3 10.5 8 5.5l5 5" : "M3 5.5 8 10.5l5-5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <section id={regionId} className="game-panel__menu" aria-label="メニュー" hidden={!expanded}>
        <div className="game-panel__options">
          <button type="button" aria-pressed={follow} onClick={onToggleFollow}>
            追尾: {follow ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={onCycleSpeed}
            disabled={reducedMotion}
            aria-label={`アニメーション速度: ${speedLabel}（押すと切り替え）`}
            title={reducedMotion ? "視差効果を減らす設定のためアニメーションは省略されます" : undefined}
          >
            速度: {reducedMotion ? "省略" : speedLabel}
          </button>
          <button type="button" onClick={startNewGame}>新規</button>
          <button type="button" onClick={onShowTitle}>タイトル</button>
        </div>
        <GameLegend
          lines={lines}
          targetColor={targetColor}
          selectedGroupIds={selectedGroupIds}
          onToggleGroup={onToggleGroup}
          onSetOperator={onSetOperator}
          onShowAll={onShowAll}
        />
      </section>
    </>
  );
}
