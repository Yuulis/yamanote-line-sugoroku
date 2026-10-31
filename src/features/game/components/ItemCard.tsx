import { useId } from "react";
import { ItemIcon } from "./ItemIcon";
import {
  ITEM_DESCRIPTIONS, ITEM_REPLACEMENT_NOTE, itemTiming, itemTone, itemUnavailableLabel,
  type ItemHint,
} from "../itemPresentation";
import type { ItemKind } from "../../../types/network";
import type { ItemUnavailableReason } from "../itemSession";

export interface ItemCardAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly onActivate: () => void;
}

export interface ItemCardProps {
  kind: ItemKind;
  headingId?: string;
  selected?: boolean;
  isNew?: boolean;
  unavailableReason?: ItemUnavailableReason | null;
  hint?: ItemHint | null;
  replacesSelection?: boolean;
  action?: ItemCardAction;
}

export function ItemCard({
  kind, headingId, selected = false, isNew = false, unavailableReason = null,
  hint = null, replacesSelection = false, action,
}: ItemCardProps): React.JSX.Element {
  const generatedId: string = useId();
  const actualHeadingId: string = headingId ?? `item-card-heading-${generatedId}`;
  const reasonId: string = `item-card-reason-${generatedId}`;
  const description = ITEM_DESCRIPTIONS[kind];
  const unavailableText: string | null = unavailableReason ? itemUnavailableLabel(unavailableReason) : null;

  return (
    <div className={`item-card item-card--${itemTone(kind)}${selected ? " item-card--selected" : ""}`}>
      <div className="item-card__header">
        <span className="item-card__icon"><ItemIcon kind={kind} size={32} /></span>
        <h3 className="item-card__name" id={actualHeadingId} tabIndex={-1}>{description.name}</h3>
      </div>
      {(selected || isNew) && <p className="item-card__markers">
        {selected && <span className="item-card__marker item-card__marker--selected">選択中</span>}
        {isNew && <span className="item-card__marker item-card__marker--new">新しく拾った</span>}
      </p>}
      <p className="item-card__effect">{description.effect}</p>
      <p className="item-card__timing">{itemTiming(kind)}</p>
      {hint && <p className={`item-card__hint${hint.caution ? " item-card__hint--caution" : ""}`}>{hint.text}</p>}
      {replacesSelection && !selected && <p className="item-card__note">{ITEM_REPLACEMENT_NOTE}</p>}
      {unavailableText && <p className="item-card__reason" id={reasonId}>{unavailableText}</p>}
      {action && <button
        type="button"
        className="button-primary item-card__action"
        disabled={action.disabled}
        aria-describedby={unavailableText ? reasonId : undefined}
        onClick={() => action.onActivate()}
      >{action.label}</button>}
    </div>
  );
}
