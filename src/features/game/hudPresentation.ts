import type { DeepReadonly, HarmfulItemKind, ItemEffectsState, ItemRideRecord } from "../../types/network";
import type { LastMove } from "./gameSession";
import type { PresentationResolver } from "./presentationResolver";
import { activeItemEffectTexts } from "./presentation";
import type { RailwayNetwork } from "./engine";
import { createPresentationResolver } from "./presentationResolver";
import { lineBadgeFor, type LineBadgeModel } from "./lineBadge";

export interface CompactRollModel {
  face: number | null;
  label: string;
  modifier: string | null;
}

export interface ProgressSegment {
  index: number;
  completed: boolean;
}

export interface EffectChipModel {
  key: string;
  kind: HarmfulItemKind;
  text: string;
  label: string;
  remainingTurns: number | null;
  serviceId: string | null;
  lineBadge: LineBadgeModel | null;
  countdown: string | null;
}

export function compactRollText(model: CompactRollModel): string {
  if (model.modifier === null) return model.label;
  return `${model.label} ${model.modifier}`;
}

export function compactRollFor(lastMove: LastMove | null): CompactRollModel {
  if (!lastMove) return { face: null, label: "—", modifier: null };
  if (lastMove.stopReason === "relocation" || lastMove.itemRecord?.kind === "deadhead") {
    return { face: null, label: "回送（サイコロなし）", modifier: null };
  }

  const record = lastMove.itemRecord;
  if (record?.kind === "item-ride") return compactItemRoll(record);

  const face: number | null = lastMove.roll;
  return { face, label: face === null ? "—" : `${face}マス`, modifier: null };
}

/** Item rides read only typed record fields; `pips` counts squares, `hopBudget` counts stations. */
function compactItemRoll(record: DeepReadonly<ItemRideRecord>): CompactRollModel {
  const face: number = record.effectiveFace;
  if (record.movementMode === "oversleep") return { face, label: "寝過ごし", modifier: null };
  // Rapid spends pips on transfer stops only; its budget is a physical station count.
  if (record.movementMode === "rapid") return { face, label: `${record.hopBudget}駅`, modifier: "快速" };
  const label = `${record.pips}マス`;
  if (record.adjustment) return { face, label, modifier: record.adjustment.delta > 0 ? "調整+1" : "調整-1" };
  if (record.command.items.some((item) => item.kind === "double")) return { face, label, modifier: "×2" };
  // A due delay forces the effective face to 1 without an adjustment ticket.
  if (record.effectiveFace !== record.rawRoll) return { face, label, modifier: "遅延" };
  return { face, label, modifier: null };
}

export function progressSegments(completedCount: number, requiredCount: number): readonly ProgressSegment[] {
  const count: number = Number.isFinite(requiredCount) ? Math.max(0, Math.floor(requiredCount)) : 0;
  const completed: number = Number.isFinite(completedCount) ? Math.min(count, Math.max(0, Math.floor(completedCount))) : 0;
  return Array.from({ length: count }, (_unused: unknown, index: number): ProgressSegment => ({
    index,
    completed: index < completed,
  }));
}

export function effectChipModels(
  effects: DeepReadonly<ItemEffectsState>,
  turn: number,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): readonly EffectChipModel[] {
  const resolver: PresentationResolver = presentation ?? createPresentationResolver(network);
  const texts: string[] = activeItemEffectTexts(effects, turn, network, presentation);
  const occurrences = new Map<string, number>();
  // Keys come from each effect's own identity (plus its rank among identical entries), never from the
  // array position, so an earlier effect expiring does not re-key the chips that remain.
  const keyFor = (identity: string): string => {
    const rank: number = occurrences.get(identity) ?? 0;
    occurrences.set(identity, rank + 1);
    return `${identity}#${rank}`;
  };
  const models: EffectChipModel[] = [];
  effects.delayDueTurns.forEach((dueTurn: number): void => {
    const remainingTurns: number = Math.max(0, dueTurn - turn);
    models.push({ key: keyFor(`delay:${dueTurn}`), kind: "delay", text: texts[models.length]!,
      label: `遅延 あと${remainingTurns}`,
      remainingTurns, serviceId: null, lineBadge: null, countdown: null });
  });
  effects.suspensions.filter((entry) => entry.expiresTurn > turn).forEach((entry): void => {
    const remainingTurns: number = entry.expiresTurn - turn;
    const service = network.servicesById.get(entry.serviceId);
    models.push({ key: keyFor(`suspension:${entry.serviceId}:${entry.expiresTurn}`), kind: "suspension",
      text: texts[models.length]!,
      label: "運休", remainingTurns, serviceId: entry.serviceId,
      lineBadge: lineBadgeFor(entry.serviceId, resolver, service?.color ?? undefined), countdown: `あと${remainingTurns}` });
  });
  if (effects.detourPending) {
    models.push({ key: keyFor("detour:pending"), kind: "detour", text: texts[models.length]!, label: "寄り道", remainingTurns: null, serviceId: null, lineBadge: null, countdown: null });
  }
  if (effects.oversleepPending) {
    models.push({ key: keyFor("oversleep:pending"), kind: "oversleep", text: texts[models.length]!, label: "寝過ごし", remainingTurns: null, serviceId: null, lineBadge: null, countdown: null });
  }
  return models;
}
