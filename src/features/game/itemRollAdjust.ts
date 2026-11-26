import type { BeneficialItemKind, ItemInstance, ItemKind, RollAdjustDelta } from "../../types/network";

export type RollAdjustKind = Extract<BeneficialItemKind, "roll-adjust" | "roll-adjust-2" | "roll-adjust-3">;

export interface RollAdjustmentChoice {
  readonly delta: RollAdjustDelta;
  readonly instanceId: string;
}

export const ROLL_ADJUST_MAGNITUDE: Readonly<Record<RollAdjustKind, 1 | 2 | 3>> = {
  "roll-adjust": 1,
  "roll-adjust-2": 2,
  "roll-adjust-3": 3,
};

export function isRollAdjustKind(kind: ItemKind): kind is RollAdjustKind {
  return Object.prototype.hasOwnProperty.call(ROLL_ADJUST_MAGNITUDE, kind);
}

export function isRollAdjustDeltaForKind(kind: ItemKind, delta: unknown): delta is RollAdjustDelta {
  if (!isRollAdjustKind(kind)) return false;
  const magnitude = ROLL_ADJUST_MAGNITUDE[kind];
  return delta === magnitude || delta === -magnitude;
}

export function isAdjustedFaceInRange(face: number): boolean {
  return Number.isSafeInteger(face) && face >= 1;
}

export function legalAdjustments(
  rawRoll: number,
  inventory: readonly ItemInstance[],
): readonly RollAdjustmentChoice[] {
  const choices = new Map<RollAdjustDelta, RollAdjustmentChoice>();
  for (const [kind, magnitude] of Object.entries(ROLL_ADJUST_MAGNITUDE) as [RollAdjustKind, 1 | 2 | 3][]) {
    const instance = inventory.find((item) => item.kind === kind);
    if (!instance) continue;
    for (const delta of [-magnitude, magnitude] as RollAdjustDelta[]) {
      if (isAdjustedFaceInRange(rawRoll + delta)) choices.set(delta, { delta, instanceId: instance.id });
    }
  }
  return [...choices.values()].sort((left, right) => left.delta - right.delta);
}
