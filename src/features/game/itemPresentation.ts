import type { ItemKind } from "../../types/network";
import type { ItemUnavailableReason } from "./itemSession";

export interface ItemDescription {
  readonly name: string;
  readonly effect: string;
}

export const ITEM_DESCRIPTIONS: Readonly<Record<ItemKind, ItemDescription>> = {
  "route-ticket": { name: "路線指定券", effect: "今いる駅で乗る路線を選べる（向きは抽選）" },
  "direction-ticket": { name: "方向指定券", effect: "山手線以外の路線で進む向きを選べる" },
  "roll-adjust": { name: "出目調整券", effect: "出目を見てから ±1 できる" },
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

export function itemTiming(kind: ItemKind): string {
  if (kind === "delay-certificate") return "持っているだけで効く";
  if (kind === "roll-adjust") return "出目を見てから使う";
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

export function directionGuidance(
  targetHops: number,
  directionIsCloser: boolean,
  hasShorterDirection: boolean,
): string {
  const distance = Number.isFinite(targetHops) ? `次の駅から山手線まで${targetHops}駅` : "次の駅から山手線へ到達できません";
  if (!hasShorterDirection) return `${distance}。短い方向はありません`;
  return `${distance}。${directionIsCloser ? "山手線に近づく方向" : "山手線から遠ざかる方向"}`;
}

export function adjustedPips(rawRoll: number, delta: -1 | 0 | 1): number {
  return rawRoll + delta;
}
