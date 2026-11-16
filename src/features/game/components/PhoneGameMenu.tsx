import { useEffect, useId, type ReactNode, type RefObject } from "react";
import type { CollectionProgress } from "../collectionProgress";
import { modalDialogOpen } from "./GameMenu";
import { PhraseText } from "./PhraseText";

const MENU_ICON_SIZE = 16; const MENU_ICON_STROKE_WIDTH = 1.8;

export type PhoneMenuSection = "log" | "settings";

export interface PhoneGameMenuProps {
  expanded: boolean; section: PhoneMenuSection; collection: CollectionProgress;
  openerRef: RefObject<HTMLElement | null>; triggerRef: RefObject<HTMLButtonElement | null>;
  onExpandedChange: (expanded: boolean) => void;
  onSectionChange: (section: PhoneMenuSection) => void;
  log: ReactNode; settings: ReactNode;
}

function isVisible(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function PhoneGameMenu({ expanded, section, collection, openerRef, triggerRef, onExpandedChange,
  onSectionChange, log, settings }: PhoneGameMenuProps): React.JSX.Element {
  const regionId = useId();
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || modalDialogOpen()) return;
      event.preventDefault();
      const opener = openerRef.current;
      openerRef.current = null;
      onExpandedChange(false);
      (isVisible(opener) ? opener : triggerRef.current)?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded, onExpandedChange, openerRef, triggerRef]);
  const changeSection = (nextSection: PhoneMenuSection): void => {
    if (nextSection === "settings") openerRef.current = null;
    onSectionChange(nextSection);
  };
  return (
    <div className="phone-menu">
      <button ref={triggerRef} type="button" className="phone-menu__trigger" aria-expanded={expanded} aria-controls={regionId}
        onClick={() => { if (expanded) openerRef.current = null; onExpandedChange(!expanded); }}>
        <svg aria-hidden="true" focusable="false" width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} viewBox={`0 0 ${MENU_ICON_SIZE} ${MENU_ICON_SIZE}`}>
          <path d="M2 3.5h12M2 8h12M2 12.5h12" fill="none" stroke="currentColor" strokeWidth={MENU_ICON_STROKE_WIDTH} strokeLinecap="round" />
        </svg>
        <span>メニュー</span>
      </button>
      <div id={regionId} className="phone-menu__content" hidden={!expanded}>
        <div className="phone-menu__summary">
          <PhraseText text={collection.stationsText} />
          <PhraseText text={collection.linesText} />
        </div>
        <div className="phone-menu__sections">
          <button type="button" className="phone-menu__section-button" aria-pressed={section === "log"} onClick={() => changeSection("log")}>ログ</button>
          <button type="button" className="phone-menu__section-button" aria-pressed={section === "settings"} onClick={() => changeSection("settings")}>設定</button>
        </div>
        <div className="phone-menu__section" hidden={section !== "log"}>{log}</div>
        <div className="phone-menu__section" hidden={section !== "settings"}>{settings}</div>
      </div>
    </div>
  );
}
