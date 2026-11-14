import { useId } from "react";
import type { TurnResultChip, TurnResultModel } from "../turnResultCard";
import { ItemIcon } from "./ItemIcon";
import { LineBadge } from "./LineBadge";
import { PhraseText } from "./PhraseText";

function TurnResultChipView({ chip }: { chip: TurnResultChip }): React.JSX.Element {
  return (
    <span className="turn-result__chip" title={chip.text}>
      {(chip.kind === "pickup" || chip.kind === "effect") && <ItemIcon kind={chip.itemKind} size={18} />}
      <span className="turn-result__chip-label" aria-hidden="true"><PhraseText text={chip.label} /></span>
      <span className="visually-hidden">{chip.text}</span>
    </span>
  );
}

export function TurnResultCard({ model }: { model: TurnResultModel | null }): React.JSX.Element {
  const headingId: string = useId();
  return (
    <>
      {model && (
        <section className="turn-result" aria-labelledby={headingId}>
          <div className="turn-result__lead">
            <h2 className="turn-result__heading" id={headingId}><PhraseText text={model.heading} /></h2>
            <p className="turn-result__move"><PhraseText text={model.moveText} /></p>
          </div>
          <p className="turn-result__ride">
            <LineBadge model={model.ride.lineBadge} size="sm" showName={false} />
            <span className="turn-result__ride-text"><PhraseText text={model.ride.text} /></span>
          </p>
          {model.chips.length > 0 && <div className="turn-result__chips">
            {model.chips.map((chip: TurnResultChip) => <TurnResultChipView key={chip.key} chip={chip} />)}
          </div>}
        </section>
      )}
      {/* Named #65 progress-feedback slot, present at turn 0 too. It reserves no space (0px):
          #65 decides its own space later. */}
      <div className="turn-result__reserve" aria-hidden="true" />
    </>
  );
}
