import { useCallback, type ReactNode, type RefObject } from "react";
import type { SaveWriteResult } from "../store/persistence";
import type { LineBadgeModel } from "../lineBadge";
import type { EffectChipModel } from "../hudPresentation";
import { setTargetRef, type TurnMomentTargetRef } from "./TurnMomentHost";
import { EffectChips } from "./EffectChips";
import { LineBadge } from "./LineBadge";
import { PhraseText } from "./PhraseText";
import { TargetProgressBar } from "./TargetProgressBar";

export interface GameHudProps {
  /** 「前のターン」 slot, rendered after actions and before inventory. */
  turnResult?: ReactNode;
  inventory?: ReactNode;
  title: string;
  subtitle: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  station: string;
  ride: string;
  lineBadge: LineBadgeModel;
  direction: string;
  turn: number;
  completed: number;
  required: number;
  /** Reveal-gated goal guidance; replaces the progress bar cells in the same slot once public. */
  goalGuidanceText?: string | null;
  /** Shorter wording for the short-landscape HUD; visual only, the full text stays the accessible name. */
  goalGuidanceShortText?: string | null;
  compactRoll: string;
  saveStatus: SaveWriteResult | null;
  saveStatusMessage: string;
  canRoll: boolean;
  canSkip: boolean;
  autoRollEnabled: boolean;
  animating: boolean;
  draftSelected: boolean;
  rollButtonRef: RefObject<HTMLButtonElement | null>;
  onRoll: () => void;
  onSkip: () => void;
  onToggleAutoRoll: () => void;
  effects: readonly EffectChipModel[];
  /** Optional animation targets; measured only, they add no elements and change no markup. */
  rideTargetRef?: TurnMomentTargetRef;
  directionTargetRef?: TurnMomentTargetRef;
}

function SaveIcon({ warning = false }: { warning?: boolean }): React.JSX.Element {
  return warning ? (
    <svg className="game-panel__save-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3 1.8 21h20.4L12 3Zm0 5.3v6.2m0 3.1v.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="game-panel__save-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m4.5 12.5 5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GameHud({
  turnResult,
  inventory,
  title, subtitle, headingRef,
  station, ride, lineBadge, direction, turn, completed, required, goalGuidanceText = null, goalGuidanceShortText = null, compactRoll, saveStatus, saveStatusMessage,
  canRoll, canSkip, autoRollEnabled, animating, draftSelected, rollButtonRef, onRoll, onSkip, onToggleAutoRoll, effects,
  rideTargetRef, directionTargetRef,
}: GameHudProps): React.JSX.Element {
  const rideRef = useCallback((element: HTMLSpanElement | null): void => setTargetRef(rideTargetRef, element), [rideTargetRef]);
  const directionRef = useCallback((element: HTMLSpanElement | null): void => setTargetRef(directionTargetRef, element), [directionTargetRef]);
  const failed: boolean = saveStatus === "failed" || saveStatus === "unavailable";
  const saveMark: boolean = saveStatus === "saved";
  return (
    <>
      <div className="game-panel__header">
        <h1 ref={headingRef} className="game-panel__title" tabIndex={-1}>{title}</h1>
        {saveMark && <p className="game-panel__save game-panel__save--inline" title={`セーブ: ${saveStatusMessage}`}>
          <SaveIcon /><span className="visually-hidden">セーブ: {saveStatusMessage}</span>
        </p>}
      </div>
      <p className="game-panel__subtitle">{subtitle}</p>
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd><span className="hud-stat__value" data-stat="station" title={station}>{station}</span></dd>
        <dt>乗車中</dt>
        <dd><LineBadge model={lineBadge} showName={false} size="sm" /><span className="hud-stat__value" data-stat="ride" title={ride} ref={rideRef}><PhraseText text={ride} /></span></dd>
        <dt>進行方向</dt>
        <dd><span className="hud-stat__value" data-stat="direction" title={direction} ref={directionRef}><PhraseText text={direction} /></span></dd>
        <dt>ターン数</dt>
        <dd><span className="hud-stat__value" data-stat="turn" title={String(turn)}>{turn}</span></dd>
        <dt>踏破区間</dt>
        <dd><span className="hud-stat__value" data-stat="progress" title={`${completed}/${required}`}>{completed}/{required}</span>{goalGuidanceText
          ? <span className="target-progress target-progress--guidance" title={goalGuidanceText}><span className="goal-guidance__full"><PhraseText text={goalGuidanceText} /></span>
            {goalGuidanceShortText && <span className="goal-guidance__short" aria-hidden="true"><PhraseText text={goalGuidanceShortText} /></span>}
          </span>
          : <TargetProgressBar completed={completed} required={required} />}</dd>
        <dt>出目</dt>
        <dd><span className="hud-stat__value" data-stat="roll-compact" title={compactRoll}>{compactRoll}</span></dd>
      </dl>
      <div className="game-panel__actions">
        <button
          ref={rollButtonRef}
          type="button"
          className={`game-panel__roll button-cta${draftSelected ? " game-panel__roll--draft" : ""}`}
          onClick={() => { if (canRoll) onRoll(); }}
          aria-disabled={!canRoll}
        >
          {animating ? "移動中…" : draftSelected ? "この内容でサイコロを振る" : "サイコロを振る"}
        </button>
        <button type="button" className="game-panel__skip" onClick={onSkip} disabled={!canSkip}>スキップ</button>
        <button
          type="button"
          className="game-panel__auto-roll"
          aria-label="おまかせで進む"
          aria-pressed={autoRollEnabled}
          onClick={onToggleAutoRoll}
        >
          おまかせ: {autoRollEnabled ? "ON" : "OFF"}
        </button>
      </div>
      {turnResult}
      {inventory}
      <EffectChips models={effects} />
      {!saveMark && <p
        className={`game-panel__save${failed ? " game-panel__save--warning" : ""}`}
      >
        {failed ? <><SaveIcon warning /><span>セーブ: {saveStatusMessage}</span></> :
            <span>セーブ: {saveStatusMessage}</span>}
      </p>}
    </>
  );
}
