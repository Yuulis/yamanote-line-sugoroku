import { useEffect, useRef } from "react";
import type { GuideAcknowledgement, GuideCandidate } from "../firstPlayGuide";
import { PhraseText } from "./PhraseText";

export interface FirstPlayHintProps {
  readonly candidate: GuideCandidate;
  readonly acknowledgement: GuideAcknowledgement;
  readonly onShown: (acknowledgement: GuideAcknowledgement) => void;
  readonly onClose: () => void;
  readonly onDisable: () => void;
  readonly onDetails: (sectionId: GuideCandidate["copy"]["sectionId"], opener: HTMLElement) => void;
  readonly onRestoreFocus: () => void;
}

function acknowledgementIdentity(acknowledgement: GuideAcknowledgement): string {
  return `${acknowledgement.sessionId}:${acknowledgement.candidateKey}:${acknowledgement.displayGeneration}`;
}

/** Persistent, non-modal hint card; its status announcement is owned by the game's single status region. */
export function FirstPlayHint({
  candidate,
  acknowledgement,
  onShown,
  onClose,
  onDisable,
  onDetails,
  onRestoreFocus,
}: FirstPlayHintProps): React.JSX.Element {
  const cardRef = useRef<HTMLElement>(null);
  const shownAcknowledgementRef = useRef<string | null>(null);

  useEffect(() => {
    const identity = acknowledgementIdentity(acknowledgement);
    if (shownAcknowledgementRef.current === identity) return;
    shownAcknowledgementRef.current = identity;
    onShown(acknowledgement);
  }, [acknowledgement, onShown]);

  const stopSkipShortcut = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === "s" || event.key === "S" || event.key === "Escape") event.stopPropagation();
  };

  const close = (action: () => void): void => {
    const restoreFocus = cardRef.current?.contains(document.activeElement) ?? false;
    action();
    if (restoreFocus) onRestoreFocus();
  };

  return (
    <section ref={cardRef} className="first-play-hint" aria-label="ヒント" onKeyDown={stopSkipShortcut}>
      <p className="first-play-hint__copy"><PhraseText text={candidate.copy.text} /></p>
      <div className="first-play-hint__actions">
        <button type="button" onClick={() => close(onClose)}>閉じる</button>
        <button type="button" onClick={() => close(onDisable)}>もう表示しない</button>
        <button
          type="button"
          onClick={(event) => onDetails(candidate.copy.sectionId, event.currentTarget)}
        >詳しく</button>
      </div>
    </section>
  );
}
