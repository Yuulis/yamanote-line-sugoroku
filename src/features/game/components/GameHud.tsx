import type { RefObject } from "react";
import type { SaveWriteResult } from "../store/persistence";
import type { LineBadgeModel } from "../lineBadge";
import type { EffectChipModel } from "../hudPresentation";
import { EffectChips } from "./EffectChips";
import { LineBadge } from "./LineBadge";
import { TargetProgressBar } from "./TargetProgressBar";

export interface GameHudProps {
  station: string;
  ride: string;
  lineBadge: LineBadgeModel;
  direction: string;
  turn: number;
  completed: number;
  required: number;
  roll: string;
  saveStatus: SaveWriteResult | null;
  saveStatusMessage: string;
  canRoll: boolean;
  animating: boolean;
  draftSelected: boolean;
  rollButtonRef: RefObject<HTMLButtonElement | null>;
  onRoll: () => void;
  onSkip: () => void;
  effects: readonly EffectChipModel[];
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
  station, ride, lineBadge, direction, turn, completed, required, roll, saveStatus, saveStatusMessage,
  canRoll, animating, draftSelected, rollButtonRef, onRoll, onSkip, effects,
}: GameHudProps): React.JSX.Element {
  const failed: boolean = saveStatus === "failed" || saveStatus === "unavailable";
  return (
    <>
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd><span className="hud-stat__value" data-stat="station">{station}</span></dd>
        <dt>乗車中</dt>
        <dd><LineBadge model={lineBadge} showName={false} size="sm" /><span className="hud-stat__value" data-stat="ride">{ride}</span></dd>
        <dt>進行方向</dt>
        <dd><span className="hud-stat__value" data-stat="direction">{direction}</span></dd>
        <dt>ターン数</dt>
        <dd><span className="hud-stat__value" data-stat="turn">{turn}</span></dd>
        <dt>踏破区間</dt>
        <dd><span className="hud-stat__value" data-stat="progress">{completed}/{required}</span><TargetProgressBar completed={completed} required={required} /></dd>
        <dt>出目</dt>
        <dd><span className="hud-stat__value" data-stat="roll">{roll}</span></dd>
      </dl>
      <div className="game-panel__actions">
        <button
          ref={rollButtonRef}
          type="button"
          className="game-panel__roll button-cta"
          onClick={() => { if (canRoll) onRoll(); }}
          aria-disabled={!canRoll}
        >
          {animating ? "移動中…" : draftSelected ? "この内容でサイコロを振る" : "サイコロを振る"}
        </button>
        <button type="button" onClick={onSkip} disabled={!animating}>スキップ</button>
      </div>
      <EffectChips models={effects} />
      <p
        className={`game-panel__save${failed ? " game-panel__save--warning" : ""}`}
        title={saveStatus === "saved" ? `セーブ: ${saveStatusMessage}` : undefined}
      >
        {saveStatus === "saved" ? <><SaveIcon /><span className="visually-hidden">セーブ: {saveStatusMessage}</span></> :
          failed ? <><SaveIcon warning /><span>セーブ: {saveStatusMessage}</span></> :
            <span>セーブ: {saveStatusMessage}</span>}
      </p>
    </>
  );
}
