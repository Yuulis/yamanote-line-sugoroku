import type { CSSProperties } from "react";
import type { DeepReadonly, ItemRideRecord, ItemTurnRecord } from "../../../types/network";
import type { LastMove } from "../gameSession";
import { compactRollFor } from "../hudPresentation";

export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6;
export type DiceStage = "tumble" | "stamps";

/** Rotation of the whole cube, in degrees, applied as `rotateX(xDeg) rotateY(yDeg)`. */
export interface DiceOrientation {
  readonly xDeg: number;
  readonly yDeg: number;
}

export const DICE_FACES: readonly DiceFace[] = [1, 2, 3, 4, 5, 6];

/**
 * The tumble keyframes reach the final pose at this percentage of the stage duration and hold it for the rest
 * (the last quarter). The hold lives inside the existing tumble duration; it adds no time. Keep in sync with the
 * `75%, 100%` keyframe selector of `dice-tumble-spin` in `styles.css`.
 */
export const DICE_TUMBLE_SETTLE_PERCENT: number = 75;
export const DICE_TUMBLE_HOLD_FRACTION: number = 0.25;

/**
 * Delay stamp. The wording helper derives it from `effectiveFace !== rawRoll`, which cannot see a delay that was
 * activated on a raw 1 (both faces are 1), so that case is recognised from the accepted `effect-activated` event.
 */
export const DICE_DELAY_STAMP_LABEL: string = "遅延";

/**
 * Cube rotation that brings each face to the front. Faces sit on a standard die (opposite faces sum to 7):
 * 1 front, 6 back, 2 right, 5 left, 3 top, 4 bottom. Each value is the inverse of that face's placement in
 * `styles.css` (`.dice-tumble__face[data-face]`).
 */
const FINAL_ORIENTATIONS: Readonly<Record<DiceFace, DiceOrientation>> = {
  1: { xDeg: 0, yDeg: 0 },
  2: { xDeg: 0, yDeg: -90 },
  3: { xDeg: -90, yDeg: 0 },
  4: { xDeg: 90, yDeg: 0 },
  5: { xDeg: 0, yDeg: 90 },
  6: { xDeg: 0, yDeg: 180 },
};

/** Pip cells of a 3x3 face grid, numbered 1..9 in reading order. */
const PIP_CELLS: Readonly<Record<DiceFace, readonly number[]>> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

export function isDiceFace(value: number | null | undefined): value is DiceFace {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

/** Deterministic final orientation of the cube for a saved raw roll. No randomness of any kind. */
export function diceFinalOrientation(rawRoll: DiceFace): DiceOrientation {
  return FINAL_ORIENTATIONS[rawRoll];
}

export function dicePipCells(face: DiceFace): readonly number[] {
  return PIP_CELLS[face];
}

/** The cube always lands on the saved raw roll, never the effective face. Deadhead has no die. */
export function diceRawRollFor(record: DeepReadonly<ItemTurnRecord> | null | undefined): DiceFace | null {
  if (!record || record.kind !== "item-ride") return null;
  return isDiceFace(record.rawRoll) ? record.rawRoll : null;
}

function lastMoveFor(record: DeepReadonly<ItemRideRecord>): LastMove {
  return {
    roll: record.rawRoll,
    itemRecord: record,
    unusedPips: record.unusedPips,
    stopReason: record.stopReason,
    stopStationId: record.toStationId,
    serviceId: record.resolvedRide.serviceId,
    direction: record.resolvedRide.direction,
    endpointKind: null,
    landing: null,
  };
}

function delayActivated(record: DeepReadonly<ItemRideRecord>): boolean {
  return record.itemEvents.some((event) => event.type === "effect-activated" && event.effect === "delay");
}

/**
 * Stamp labels from an accepted record. The wording comes from `compactRollFor()` (modifier, or the 寝過ごし
 * label for oversleep); a delay activated on a raw 1 is added from the accepted effect event. No duplicates.
 */
export function diceStampLabels(record: DeepReadonly<ItemTurnRecord> | null | undefined): readonly string[] {
  if (!record || record.kind !== "item-ride") return [];
  const compact = compactRollFor(lastMoveFor(record));
  const labels: string[] = [];
  if (record.movementMode === "oversleep") labels.push(compact.label);
  else if (compact.modifier !== null) labels.push(compact.modifier);
  if (delayActivated(record) && !labels.includes(DICE_DELAY_STAMP_LABEL)) labels.push(DICE_DELAY_STAMP_LABEL);
  return labels;
}

export interface DiceTumbleModel {
  readonly stage: DiceStage;
  /** Saved raw roll; null (deadhead, not yet known) renders no die. */
  readonly rawRoll: number | null;
  /** Stamp labels, shown only in the `stamps` stage. */
  readonly stampLabels: readonly string[];
  /** Duration of the current stage in ms; every CSS animation duration derives from it. */
  readonly stageMs: number;
  readonly reducedMotion: boolean;
}

/** Builds the model for an accepted record: the face is the raw roll, the labels come from the record. */
export function diceTumbleModelFor(
  record: DeepReadonly<ItemTurnRecord> | null | undefined,
  stage: DiceStage,
  stageMs: number,
  reducedMotion: boolean,
): DiceTumbleModel {
  return { stage, rawRoll: diceRawRollFor(record), stampLabels: diceStampLabels(record), stageMs, reducedMotion };
}

export interface DiceTumbleProps {
  readonly model: DiceTumbleModel;
}

function stageDuration(stageMs: number): string {
  return `${Number.isFinite(stageMs) ? Math.max(0, Math.round(stageMs)) : 0}ms`;
}

/**
 * Decorative CSS cube plus modifier stamps. It owns no timer and no sequence progression and listens to no
 * animation event: the caller decides when a stage ends. Nothing here is focusable or announced.
 */
export function DiceTumble({ model }: DiceTumbleProps): React.JSX.Element | null {
  const { stage, rawRoll, stampLabels, stageMs, reducedMotion } = model;
  if (!isDiceFace(rawRoll)) return null;
  const orientation: DiceOrientation = diceFinalOrientation(rawRoll);
  const className: string = `dice-tumble dice-tumble--${stage}${reducedMotion ? " dice-tumble--reduced" : ""}`;
  const style = {
    "--dice-stage-ms": stageDuration(stageMs),
    "--dice-final-x": `${orientation.xDeg}deg`,
    "--dice-final-y": `${orientation.yDeg}deg`,
  } as CSSProperties;
  return (
    <div className={className} aria-hidden="true" data-stage={stage} data-raw-roll={rawRoll} style={style}>
      <div className="dice-tumble__scene">
        <div className="dice-tumble__cube">
          {DICE_FACES.map((face: DiceFace) => (
            <div
              key={face}
              className={face === rawRoll ? "dice-tumble__face dice-tumble__face--final" : "dice-tumble__face"}
              data-face={face}
            >
              {PIP_CELLS[face].map((cell: number) => (
                <span key={cell} className="dice-tumble__pip" data-cell={cell} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {stage === "stamps" && stampLabels.length > 0 && (
        <div className="dice-tumble__stamps">
          {stampLabels.map((label: string) => (
            <span key={label} className="dice-tumble__stamp">{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
