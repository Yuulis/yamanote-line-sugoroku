import { useId, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import type { ItemRollAdjustment } from "../../../types/network";
import type { ItemSessionView } from "../itemSession";
import { adjustedPips } from "../itemPresentation";

interface RollAdjustmentProps {
  decision: Extract<NonNullable<ItemSessionView["decision"]>, { kind: "adjust" }>;
  onContinue: (adjustment: ItemRollAdjustment | null) => void;
}

type AdjustmentChoice = -1 | 0 | 1;

export function RollAdjustment({ decision, onContinue }: RollAdjustmentProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const groupId = useId();
  const [choice, setChoice] = useState<AdjustmentChoice>(0);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  const continueTurn = (nextChoice: AdjustmentChoice) => {
    if (nextChoice === 0) {
      onContinue(null);
      return;
    }
    const instanceId = decision.itemInstanceIds[0];
    if (!instanceId) return;
    onContinue({ instanceId, delta: nextChoice });
  };
  const handleCancel = (event: SyntheticEvent) => {
    event.preventDefault();
    continueTurn(0);
  };
  const choices: AdjustmentChoice[] = [
    ...decision.allowedDeltas.filter((delta) => delta === -1),
    0,
    ...decision.allowedDeltas.filter((delta) => delta === 1),
  ];

  return (
    <dialog ref={dialogRef} className="dialog item-dialog item-adjustment" aria-labelledby={titleId} onCancel={handleCancel}>
      <div className="dialog__body">
        <h2 id={titleId} ref={headingRef} className="dialog__title" tabIndex={-1}>出目を調整しますか？</h2>
        <p className="item-dialog__hint">出目：<strong>{decision.rawRoll}</strong></p>
        <p className="item-dialog__hint">±1を選ぶと出目調整券を1枚使います。</p>
        <fieldset className="item-dialog__group">
          <legend>進むマス数を選ぶ</legend>
          {choices.map((delta) => {
            const pips = adjustedPips(decision.rawRoll, delta);
            const label = delta === 0 ? "そのまま" : `${delta === -1 ? "−1" : "+1"}`;
            return <label className="item-adjustment__choice" key={delta}>
              <input
                type="radio"
                name={groupId}
                value={delta}
                checked={choice === delta}
                onChange={() => setChoice(delta)}
              />
              <span><strong>{label}</strong>：出目 {pips}、{pips}マス進む</span>
            </label>;
          })}
        </fieldset>
        <p className="item-dialog__hint">Escapeキーでも「そのまま」で続けます。出目を見た後はターンを取り消せません。</p>
        <div className="dialog__actions">
          <button type="button" className="button-primary" onClick={() => continueTurn(choice)}>
            {choice === 0 ? "そのまま続ける" : `出目${adjustedPips(decision.rawRoll, choice)}で続ける`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
