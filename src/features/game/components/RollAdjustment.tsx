import { useId, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import type { ItemRollAdjustment } from "../../../types/network";
import type { ItemSessionView } from "../itemSession";
import { adjustedPips } from "../itemPresentation";
import type { AdjustmentLanding } from "../mapGuidance";
import { PhraseText } from "./PhraseText";

export interface RollAdjustmentProps {
  announcement?: string;
  decision: Extract<NonNullable<ItemSessionView["decision"]>, { kind: "adjust" }>;
  /** Exact landing of each legal choice, matched to the radios by `delta`; a missing entry omits the station. */
  landings?: readonly AdjustmentLanding[];
  onContinue: (adjustment: ItemRollAdjustment | null) => void;
  /**
   * The shared presentation Skip. The native modal makes the panel's スキップ inert, so the dialog offers the same
   * action. It ends the presentation only: the chosen radio stays and Continue is still required.
   */
  onSkip?: () => void;
  /** Whether a presentation is still running; otherwise the Skip button stays focusable but `aria-disabled`. */
  canSkip?: boolean;
}

type AdjustmentChoice = -1 | 0 | 1;

export function RollAdjustment({ decision, onContinue, announcement, onSkip, canSkip = false, landings = [] }: RollAdjustmentProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const groupId = useId();
  const rollId = useId();
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
        {announcement !== undefined && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>}
        <h2 id={titleId} aria-describedby={rollId} ref={headingRef} className="dialog__title" tabIndex={-1}>出目を調整しますか？</h2>
        <p id={rollId} className="item-dialog__hint">出目：<strong>{decision.rawRoll}</strong></p>
        <p className="item-dialog__hint"><PhraseText text="±1を選ぶと出目調整券を1枚使います。" /></p>
        <fieldset className="item-dialog__group">
          <legend>進むマス数を選ぶ</legend>
          {choices.map((delta) => {
            const pips = adjustedPips(decision.rawRoll, delta);
            const landing = landings.find((candidate) => candidate.delta === delta);
            const steps = landing?.travelledSteps ?? pips;
            const label = delta === 0 ? "そのまま" : `${delta === -1 ? "−1" : "+1"}`;
            return <label className="item-adjustment__choice" key={delta}>
              <input
                type="radio"
                name={groupId}
                value={delta}
                checked={choice === delta}
                onChange={() => setChoice(delta)}
              />
              <span><strong>{label}</strong><span className="item-adjustment__separator">：</span><PhraseText text={`出目 ${pips}、${steps}マス進む`} />{landing && <span className="item-adjustment__station"> → {landing.stationName}</span>}</span>
            </label>;
          })}
        </fieldset>
        <p className="item-dialog__hint"><PhraseText text="Escapeキーでも「そのまま」で続けます。出目を見た後はターンを取り消せません。" /></p>
        <div className="dialog__actions">
          <button type="button" className="button-primary" onClick={() => continueTurn(choice)}>
            {choice === 0 ? "そのまま続ける" : `出目${adjustedPips(decision.rawRoll, choice)}で続ける`}
          </button>
          {onSkip && <button type="button" aria-disabled={!canSkip} onClick={() => { if (canSkip) onSkip(); }}>スキップ</button>}
        </div>
      </div>
    </dialog>
  );
}
