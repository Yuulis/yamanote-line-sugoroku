import { useCallback, type ReactNode, type RefObject } from "react";
import type { ItemPolicy } from "../../../types/network";
import type { SaveWriteResult } from "../store/persistence";
import type { LineBadgeModel } from "../lineBadge";
import type { EffectChipModel } from "../hudPresentation";
import type { MilestoneFlash } from "../progressMilestones";
import type { CollectionProgress } from "../collectionProgress";
import { TARGET_PROXIMITY_COPY, type TargetProximity } from "../targetProximity";
import { setTargetRef, type TurnMomentTargetRef } from "./TurnMomentHost";
import { EffectChips } from "./EffectChips";
import { LineBadge } from "./LineBadge";
import { PhraseText } from "./PhraseText";
import { SaveStatusPopover } from "./SaveStatusPopover";
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
  proximity?: TargetProximity | null;
  collection?: CollectionProgress;
  milestoneFlash?: MilestoneFlash | null;
  /** Reveal-gated goal guidance; replaces the progress bar cells in the same slot once public. */
  goalGuidanceText?: string | null;
  /** Shorter wording for the short-landscape HUD; visual only, the full text stays the accessible name. */
  goalGuidanceShortText?: string | null;
  compactRoll: string;
  saveStatus: SaveWriteResult | null;
  saveStatusMessage: string;
  canRoll: boolean;
  canSkip: boolean;
  animating: boolean;
  draftSelected: boolean;
  rollButtonRef: RefObject<HTMLButtonElement | null>;
  onRoll: () => void;
  onSkip: () => void;
  effects: readonly EffectChipModel[];
  /** A revealed adjustment decision closes any open effect-chip card. */
  decisionOpen?: boolean;
  /** The game's item policy: effect chip cards show its turn counts, like the rules guide. */
  policy?: ItemPolicy;
  /** Optional animation targets; measured only, they add no elements and change no markup. */
  rideTargetRef?: TurnMomentTargetRef;
  directionTargetRef?: TurnMomentTargetRef;
  /** Coach targets are measured only and never receive pointer or focus ownership. */
  coachDiceTargetRef?: TurnMomentTargetRef;
  coachProgressTargetRef?: TurnMomentTargetRef;
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
  station, ride, lineBadge, direction, turn, completed, required, proximity = null, collection, milestoneFlash = null, goalGuidanceText = null, goalGuidanceShortText = null, compactRoll, saveStatus, saveStatusMessage,
  canRoll, canSkip, animating, draftSelected, rollButtonRef, onRoll, onSkip, effects, decisionOpen = false, policy,
  rideTargetRef, directionTargetRef, coachDiceTargetRef, coachProgressTargetRef,
}: GameHudProps): React.JSX.Element {
  const rideRef = useCallback((element: HTMLSpanElement | null): void => setTargetRef(rideTargetRef, element), [rideTargetRef]);
  const directionRef = useCallback((element: HTMLSpanElement | null): void => setTargetRef(directionTargetRef, element), [directionTargetRef]);
  const diceRef = useCallback((element: HTMLButtonElement | null): void => {
    rollButtonRef.current = element;
    setTargetRef(coachDiceTargetRef, element);
  }, [rollButtonRef, coachDiceTargetRef]);
  const progressRef = useCallback((element: HTMLElement | null): void => setTargetRef(coachProgressTargetRef, element), [coachProgressTargetRef]);
  const failed: boolean = saveStatus === "failed" || saveStatus === "unavailable";
  const saveMark: boolean = saveStatus === "saved";
  return (
    <>
      <div className="game-panel__header">
        <h1 ref={headingRef} className="game-panel__title visually-hidden" tabIndex={-1}>{title}</h1>
        {saveMark && <SaveStatusPopover
          status={saveStatus}
          wrapper={(trigger) => <p className="game-panel__save game-panel__save--inline" title={`セーブ: ${saveStatusMessage}`}>{trigger}</p>}
        >
          <SaveIcon /><span className="visually-hidden">セーブ: {saveStatusMessage}</span>
        </SaveStatusPopover>}
      </div>
      <p className="game-panel__subtitle visually-hidden">{subtitle}</p>
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
          ? <span ref={progressRef} className="target-progress target-progress--guidance" title={goalGuidanceText}><span className="goal-guidance__full"><PhraseText text={goalGuidanceText} /></span>
            {goalGuidanceShortText && <span className="goal-guidance__short" aria-hidden="true"><PhraseText text={goalGuidanceShortText} /></span>}
          </span>
          : <TargetProgressBar completed={completed} required={required} milestoneFlash={milestoneFlash} targetRef={progressRef} />}</dd>
        <dt>出目</dt>
        <dd><span className="hud-stat__value" data-stat="roll-compact" title={compactRoll}>{compactRoll}</span></dd>
        {proximity && <>
          <dt className="visually-hidden">山手線まで</dt>
          <dd data-stat="proximity">
            <span><PhraseText text={`${TARGET_PROXIMITY_COPY.prefix}${proximity.hops}${TARGET_PROXIMITY_COPY.stationSuffix}`} /></span>
            <span>{proximity.trend && <PhraseText text={TARGET_PROXIMITY_COPY[proximity.trend]} />}</span>
          </dd>
        </>}
      </dl>
      {collection && <div className="hud-progress">
        <div className="hud-progress__proximity">
          <span>{proximity && <PhraseText text={`${TARGET_PROXIMITY_COPY.prefix}${proximity.hops}${TARGET_PROXIMITY_COPY.stationSuffix}`} />}</span>
          <span>{proximity?.trend && <PhraseText text={TARGET_PROXIMITY_COPY[proximity.trend]} />}</span>
        </div>
        <div className="hud-progress__collection">
          <span className="hud-progress__stations"><PhraseText text={collection.stationsText} /></span>
          <span className="hud-progress__lines"><PhraseText text={collection.linesText} /></span>
        </div>
      </div>}
      <div className="game-panel__actions">
        <button
          ref={diceRef}
          type="button"
          className={`game-panel__roll button-cta${draftSelected ? " game-panel__roll--draft" : ""}`}
          onClick={() => { if (canRoll) onRoll(); }}
          aria-disabled={!canRoll}
        >
          {animating ? "移動中…" : draftSelected ? "この内容でサイコロを振る" : "サイコロを振る"}
        </button>
        <button type="button" className="game-panel__skip" onClick={onSkip} disabled={!canSkip}><PhraseText text="演出をスキップ" /></button>
      </div>
      {turnResult}
      {inventory}
      <EffectChips models={effects} policy={policy} decisionOpen={decisionOpen} />
      {!saveMark && <p
        className={`game-panel__save${failed ? " game-panel__save--warning" : ""}`}
      >
        {failed ? <><SaveIcon warning /><span>セーブ: {saveStatusMessage}</span></> :
            <span>セーブ: {saveStatusMessage}</span>}
      </p>}
    </>
  );
}
