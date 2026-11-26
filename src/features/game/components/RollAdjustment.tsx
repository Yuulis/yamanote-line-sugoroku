import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ItemRollAdjustment, RollAdjustDelta } from "../../../types/network";
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
   * The shared presentation skip. The panel's 「演出をスキップ」 is inert while this decision is open,
   * so the dialog offers the same action. It ends the presentation only: the chosen radio stays and Continue is still required.
   */
  onSkip?: () => void;
  /** Whether a presentation is still running; otherwise the Skip button stays focusable but `aria-disabled`. */
  canSkip?: boolean;
}

type AdjustmentChoice = RollAdjustDelta | 0;

function deltaLabel(delta: AdjustmentChoice): string {
  if (delta === 0) return "そのまま";
  return `${delta < 0 ? "−" : "+"}${Math.abs(delta)}`;
}

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
    dialog.show();
    headingRef.current?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || !dialog.open) return;
      if (document.querySelector("dialog:modal")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onContinue(null);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onContinue]);

  const continueTurn = (nextChoice: AdjustmentChoice): void => {
    if (nextChoice === 0) {
      onContinue(null);
      return;
    }
    const selected = decision.choices.find((candidate) => candidate.delta === nextChoice);
    if (!selected) return;
    onContinue({ instanceId: selected.instanceId, delta: selected.delta });
  };
  const choices: AdjustmentChoice[] = [
    ...decision.choices.filter(({ delta }) => delta < 0).map(({ delta }) => delta),
    0,
    ...decision.choices.filter(({ delta }) => delta > 0).map(({ delta }) => delta),
  ];
  const magnitudes = [...new Set(decision.choices.map(({ delta }) => Math.abs(delta)))].sort((left, right) => left - right);
  const adjustmentHint = `${magnitudes.map((magnitude) => `±${magnitude}`).join("・")}を選ぶと出目調整券を1枚使います。`;

  return (
    <dialog ref={dialogRef} className="dialog item-dialog item-adjustment" aria-labelledby={titleId}>
      <div className="dialog__body">
        {announcement !== undefined && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>}
        <h2 id={titleId} aria-describedby={rollId} ref={headingRef} className="dialog__title" tabIndex={-1}>出目を調整しますか？</h2>
        <p id={rollId} className="item-dialog__hint">出目：<strong>{decision.rawRoll}</strong></p>
        <p className="item-dialog__hint"><PhraseText text={adjustmentHint} /></p>
        <fieldset className="item-dialog__group">
          <legend>進むマス数を選ぶ</legend>
          {choices.map((delta) => {
            const pips = adjustedPips(decision.rawRoll, delta);
            const landing = landings.find((candidate) => candidate.delta === delta);
            const steps = landing?.travelledSteps ?? pips;
            const label = deltaLabel(delta);
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
        <p className="item-dialog__hint item-adjustment__escape-hint"><PhraseText text="Escapeキーでも「そのまま」で続けます。" /></p>
        <p className="item-dialog__hint item-adjustment__caution"><PhraseText text="出目を見た後はターンを取り消せません。" /></p>
        <div className="dialog__actions item-adjustment__actions">
          <div className="item-adjustment__primary-actions">
            <button type="button" className="button-primary" onClick={() => continueTurn(choice)}>
              {choice === 0 ? "そのまま続ける" : `出目${adjustedPips(decision.rawRoll, choice)}で続ける`}
            </button>
          </div>
          {onSkip && <div className="item-adjustment__secondary-actions">
            <button type="button" aria-disabled={!canSkip} onClick={() => { if (canSkip) onSkip(); }}><PhraseText text="演出をスキップ" /></button>
          </div>}
        </div>
      </div>
    </dialog>
  );
}
