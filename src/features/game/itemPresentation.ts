import { HARMFUL_ITEM_KINDS, type ItemKind, type ItemPolicy, type RollAdjustDelta } from "../../types/network";
import type { ItemSessionView, ItemUnavailableReason } from "./itemSession";
import { isRollAdjustKind } from "./itemRollAdjust";

export const ITEM_SHORT_NAMES: Readonly<Record<ItemKind, string>> = {
  "route-ticket": "路線指定",
  "direction-ticket": "方向指定",
  "roll-adjust": "調整±1",
  "roll-adjust-2": "調整±2",
  "roll-adjust-3": "調整±3",
  double: "倍速",
  rapid: "快速",
  deadhead: "回送",
  "delay-certificate": "証明書",
  delay: "遅延",
  suspension: "運休",
  detour: "寄り道",
  oversleep: "寝過ごし",
};

export type ItemTone = "good" | "bad";

export function itemTone(kind: ItemKind): ItemTone {
  return HARMFUL_ITEM_KINDS.includes(kind as (typeof HARMFUL_ITEM_KINDS)[number]) ? "bad" : "good";
}

export interface ItemHint {
  readonly text: string;
  readonly caution: boolean;
}

export function itemHint(
  kind: ItemKind,
  hints: Pick<ItemSessionView["hints"], "rapidHeadsTowardYamanote" | "deadheadRecommended">,
): ItemHint | null {
  if (kind === "rapid") {
    return hints.rapidHeadsTowardYamanote
      ? { text: "おすすめ：現在の向きは山手線に近づきます", caution: false }
      : { text: "注意：現在の向きは山手線から遠ざかります", caution: true };
  }
  if (kind === "deadhead" && !hints.deadheadRecommended) {
    return { text: "おすすめしない：山手線の駅にいるため、同じ駅にとどまり1ターン使います", caution: true };
  }
  return null;
}

export const ITEM_REPLACEMENT_NOTE = "ほかのアイテムを選択中です。使うと置き換わります。";

export interface ItemDescription {
  readonly name: string;
  readonly effect: string;
}

export const ITEM_DESCRIPTIONS: Readonly<Record<ItemKind, ItemDescription>> = {
  "route-ticket": { name: "路線指定券", effect: "今いる駅で乗る路線を選べる（向きは抽選）" },
  "direction-ticket": { name: "方向指定券", effect: "山手線以外の路線で進む向きを選べる" },
  "roll-adjust": { name: "出目調整券±1", effect: "出目を見てから、出目に1を足すか引くかできる（1より小さくはできない）" },
  "roll-adjust-2": { name: "出目調整券±2", effect: "出目を見てから、出目に2を足すか引くかできる（1より小さくはできない）" },
  "roll-adjust-3": { name: "出目調整券±3", effect: "出目を見てから、出目に3を足すか引くかできる（1より小さくはできない）" },
  double: { name: "倍速券", effect: "この回の出目が2倍になる" },
  rapid: { name: "快速券", effect: "2路線以上が止まる駅だけを1駅と数えて進む" },
  deadhead: { name: "回送列車", effect: "いちばん近い山手線の駅へ移る（サイコロは振らない）" },
  "delay-certificate": {
    name: "遅延証明書",
    effect: "持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）",
  },
  delay: { name: "遅延", effect: "3ターン後の出目が1" },
  suspension: { name: "運休", effect: "その路線が5ターン乗れない" },
  detour: { name: "寄り道", effect: "次の乗換駅で別の路線へ" },
  oversleep: { name: "寝過ごし", effect: "次のターンは終点まで、環状線は6駅" },
};

/** Harmful items never enter the inventory: they take effect the moment they are picked up. */
export const AUTOMATIC_ITEM_TIMING = "拾うと自動で発動";

const TURN_COUNT_PATTERN = /\d+(?=ターン)/;

/** Descriptions carry the production turn counts; swap in the configured ones. */
export function itemEffectText(kind: ItemKind, policy: ItemPolicy): string {
  const { effect } = ITEM_DESCRIPTIONS[kind];
  if (kind === "delay") return effect.replace(TURN_COUNT_PATTERN, String(policy.delayTurns));
  if (kind === "suspension") return effect.replace(TURN_COUNT_PATTERN, String(policy.suspensionTurns));
  return effect;
}

export function itemTiming(kind: ItemKind): string {
  if (itemTone(kind) === "bad") return AUTOMATIC_ITEM_TIMING;
  if (kind === "delay-certificate") return "持っているだけで効く";
  if (isRollAdjustKind(kind)) return "出目を見てから使う";
  return "サイコロを振る前に使う";
}

const UNAVAILABLE_LABELS: Readonly<Record<ItemUnavailableReason, string>> = {
  completed: "ゲーム終了後は使えません",
  "decision-pending": "決定中は使えません",
  "forced-turn": "遅延・寝過ごしのターンは使えない",
  passive: "持っているだけで効くアイテムです",
  "after-roll": "出目が出た後に使えるアイテムです",
  "item-already-selected": "ほかのアイテムを選択中",
  "no-route-choice": "選べる路線がありません",
  "fixed-direction": "山手線は向きが固定",
  "single-direction": "この駅では進める向きが1つです",
  "no-rapid-stop": "快速で進める乗換駅がありません",
  "suspended-route": "運休中で選べない",
};

export function itemUnavailableLabel(reason: ItemUnavailableReason): string {
  return UNAVAILABLE_LABELS[reason];
}

export function itemUnavailableText(
  kind: ItemKind,
  reason: ItemUnavailableReason | null | undefined,
): string | null {
  if (!reason) return null;
  const label: string = itemUnavailableLabel(reason);
  return label.includes(itemTiming(kind)) ? null : label;
}

export function directionGuidance(
  targetHops: number,
  directionIsCloser: boolean,
  hasShorterDirection: boolean,
): string {
  const distance = Number.isFinite(targetHops) ? `次の駅から山手線まで${targetHops}駅` : "次の駅から山手線へ到達できません";
  if (!hasShorterDirection) return `${distance}。短い方向はありません`;
  return `${distance}。${directionIsCloser ? "山手線に近づく方向" : "山手線から遠ざかる方向"}`;
}

export function adjustedPips(rawRoll: number, delta: RollAdjustDelta | 0): number {
  return rawRoll + delta;
}
