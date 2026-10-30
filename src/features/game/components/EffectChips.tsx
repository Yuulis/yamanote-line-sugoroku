import type { EffectChipModel } from "../hudPresentation";
import { ItemIcon } from "./ItemIcon";

export interface EffectChipsProps {
  models: readonly EffectChipModel[];
}

export function EffectChips({ models }: EffectChipsProps): React.JSX.Element | null {
  if (models.length === 0) return null;
  return (
    <div className="effect-chips" aria-label="続いている効果">
      {models.map((model) => (
        <span className="effect-chip" key={model.key} title={model.text}>
          <ItemIcon kind={model.kind} size={20} />
          <span className="effect-chip__label" aria-hidden="true">{model.label}</span>
          <span className="visually-hidden">{model.text}</span>
        </span>
      ))}
    </div>
  );
}
