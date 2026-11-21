import { useRef } from "react";
import { itemTone } from "../itemPresentation";
import type { RulesGuideModel, RulesSectionId } from "../rulesGuide";
import { ItemIcon } from "./ItemIcon";
import { PhraseText } from "./PhraseText";

export interface RulesGuideProps {
  model: RulesGuideModel;
  idPrefix: string;
  onReplayCoach?: () => void;
  canReplayCoach?: boolean;
}

const ITEM_ICON_SIZE = 28;
const SHORTCUTS_HEADING = "キーボードショートカット";
const NAV_LABEL = "ルールの目次";
/** Marks detail that phones drop because another element already conveys it (harmful timing: the items paragraph). */
const PHONE_REDUCED_CLASS = "rules-guide__phone-reduced";

export function rulesSectionDomId(idPrefix: string, sectionId: RulesSectionId): string {
  return `${idPrefix}-${sectionId}`;
}

function headingDomId(idPrefix: string, sectionId: RulesSectionId): string {
  return `${rulesSectionDomId(idPrefix, sectionId)}-heading`;
}

/** Focuses a section heading and scrolls its section into view. Returns false when the section is not under `root`. */
export function focusRulesSection(root: ParentNode, idPrefix: string, sectionId: RulesSectionId): boolean {
  const domId = rulesSectionDomId(idPrefix, sectionId);
  const sections = root.querySelectorAll<HTMLElement>("section.rules-guide__section");
  const section = [...sections].find((candidate) => candidate.id === domId);
  const heading = section?.querySelector<HTMLElement>("h2");
  if (!section || !heading) return false;
  heading.focus({ preventScroll: true });
  section.scrollIntoView({ block: "start" });
  return true;
}

/**
 * Shared rules body for the title screen and the in-game dialog. The host owns the page title (h1);
 * section headings are h2 and focusable so a host or the section nav can move focus to them.
 */
export function RulesGuide({ model, idPrefix, onReplayCoach, canReplayCoach = false }: RulesGuideProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const shortcutsHeadingId = `${idPrefix}-shortcuts-heading`;

  return (
    <div ref={rootRef} className="rules-guide">
      <nav className={`rules-guide__nav ${PHONE_REDUCED_CLASS}`} aria-label={NAV_LABEL}>
        {model.sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className="rules-guide__nav-button"
            onClick={() => { if (rootRef.current) focusRulesSection(rootRef.current, idPrefix, section.id); }}
          >
            {section.heading}
          </button>
        ))}
      </nav>
      {model.sections.map((section) => (
        <section
          key={section.id}
          id={rulesSectionDomId(idPrefix, section.id)}
          className="rules-guide__section"
          aria-labelledby={headingDomId(idPrefix, section.id)}
        >
          <h2 id={headingDomId(idPrefix, section.id)} tabIndex={-1}>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}><PhraseText text={paragraph} /></p>)}
          {section.id === "items" && model.items.length > 0 ? (
            <ul className="rules-guide__items">
              {model.items.map((item) => (
                <li key={item.kind} className={`rules-guide__item rules-guide__item--${itemTone(item.kind)}`} data-item-kind={item.kind}>
                  <span className="rules-guide__item-icon"><ItemIcon kind={item.kind} size={ITEM_ICON_SIZE} /></span>
                  <span className="rules-guide__item-name"><PhraseText text={item.name} /></span>
                  <span className="rules-guide__item-effect"><PhraseText text={item.effect} /></span>
                  <span className={`rules-guide__item-timing${itemTone(item.kind) === "bad" ? ` ${PHONE_REDUCED_CLASS}` : ""}`}><PhraseText text={item.timing} /></span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {model.shortcuts.length > 0 ? (
        <aside className="rules-guide__shortcuts" aria-labelledby={shortcutsHeadingId}>
          <h2 id={shortcutsHeadingId}>{SHORTCUTS_HEADING}</h2>
          <ul>
            {model.shortcuts.map((shortcut) => <li key={shortcut}><PhraseText text={shortcut} /></li>)}
          </ul>
        </aside>
      ) : null}
      {onReplayCoach ? (
        <button
          type="button"
          className="rules-guide__replay"
          disabled={!canReplayCoach}
          onClick={onReplayCoach}
        >
          最初のガイドをもう一度見る
        </button>
      ) : null}
    </div>
  );
}
