import type { GameConfig, ItemKind, ItemPolicy, ServiceKind } from "../../types/network";

export type RulesSectionId = "goal" | "lottery" | "items" | "controls" | "save";
export type OpenRules = (sectionId?: RulesSectionId) => void;

export interface RulesGuideItem {
  readonly kind: ItemKind;
  readonly name: string;
  readonly effect: string;
  readonly timing: string;
}

export interface RulesGuideSection {
  readonly id: RulesSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface RulesGuideModel {
  readonly sections: readonly RulesGuideSection[];
  readonly items: readonly RulesGuideItem[];
  readonly shortcuts: readonly string[];
}

export interface RulesGuideOptions {
  readonly targetSegmentCount?: number;
  /** Display name of the target service; falls back to a generic label. */
  readonly targetServiceName?: string;
}

const SECTION_HEADINGS: Readonly<Record<RulesSectionId, string>> = {
  goal: "ゴール",
  lottery: "抽選のルール",
  items: "アイテム",
  controls: "操作と設定",
  save: "セーブ",
};

const SECTION_ORDER: readonly RulesSectionId[] = ["goal", "lottery", "items", "controls", "save"];

const SERVICE_KIND_LABELS: Readonly<Record<ServiceKind, string>> = {
  local: "各駅停車",
  rapid: "快速",
};

/** A weight of 1 leaves a lottery candidate unchanged (the engine's default weight). */
const NEUTRAL_WEIGHT = 1;
const PER_MILLE_PER_PERCENT = 10;

const DEFAULT_TARGET_LABEL = "目標路線";
const NO_ITEMS_TEXT = "このルールではアイテムはありません";

function serviceShareText(target: GameConfig["serviceLottery"]["target"], name: string): string {
  if (target.kind === "share") {
    return `乗換駅に${name}があるときは、${target.denominator}分の${target.numerator}の確率で${name}が選ばれます。`;
  }
  if (target.weight === NEUTRAL_WEIGHT) return `${name}は、ほかの路線と同じ重みで選ばれます。`;
  return `${name}は、ほかの路線の${target.weight}倍の重みで選ばれます。`;
}

function otherRoutesText(weights: GameConfig["serviceLottery"]["kindWeights"], name: string): string {
  if (weights.local === weights.rapid) return `${name}以外の路線どうしは、同じ確率で選ばれます。`;
  const { local, rapid } = SERVICE_KIND_LABELS;
  return `${name}以外の路線は、${local}と${rapid}が${weights.local}:${weights.rapid}の重みで選ばれます。`;
}

function directionText(policy: GameConfig["directionLottery"], name: string): readonly string[] {
  const toward = policy.towardTargetWeight;
  const away = policy.awayFromTargetWeight ?? NEUTRAL_WEIGHT;
  if (toward === away) return [`${name}以外の路線では、進む向きはどちらも同じ確率です。`];
  return [
    `${name}以外の路線では、${name}に近づく向きと遠ざかる向きが${toward}:${away}の重みで選ばれます。`,
    `${name}までの距離が同じ場合は、どちらの向きも同じ確率です。向きが1つしかない駅では、その向きに進みます。`,
  ];
}

function lotteryParagraphs(config: GameConfig, name: string): readonly string[] {
  return [
    serviceShareText(config.serviceLottery.target, name),
    otherRoutesText(config.serviceLottery.kindWeights, name),
    ...directionText(config.directionLottery, name),
  ];
}

function durationText(policy: ItemPolicy): readonly string[] {
  const parts = [
    policy.harmfulKinds.includes("delay") ? `遅延は拾ってから${policy.delayTurns}ターン後に効き` : null,
    policy.harmfulKinds.includes("suspension") ? `運休は${policy.suspensionTurns}ターンの間続き` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? [] : [`${parts.join("、")}ます。`];
}

function itemParagraphs(policy: ItemPolicy | undefined): readonly string[] {
  if (!policy) return [NO_ITEMS_TEXT];
  const hasHarmfulItems = policy.harmfulChancePercent > 0 && policy.harmfulKinds.length > 0;
  const pickupPercent = policy.dropChancePerMille / PER_MILLE_PER_PERCENT;
  return [
    `移動を終えるたびに、${pickupPercent}%の確率でアイテムを拾えます。`,
    ...(hasHarmfulItems
      ? [`拾ったアイテムのうち${policy.harmfulChancePercent}%は不利なアイテムで、持ち物には入らず自動で発動します。`]
      : []),
    `有利なアイテムは${policy.inventoryCapacity}個まで持てます。使えるのは1ターンに${policy.maxActiveItemsPerTurn}個までです。`,
    ...durationText(policy),
  ];
}

export function buildRulesGuide(config: GameConfig, options: RulesGuideOptions = {}): RulesGuideModel {
  const targetName = options.targetServiceName ?? DEFAULT_TARGET_LABEL;
  const paragraphsById: Readonly<Record<RulesSectionId, readonly string[]>> = {
    goal: [],
    lottery: lotteryParagraphs(config, targetName),
    items: itemParagraphs(config.itemPolicy),
    controls: [],
    save: [],
  };
  return {
    sections: SECTION_ORDER.map((id) => ({
      id,
      heading: SECTION_HEADINGS[id],
      paragraphs: paragraphsById[id],
    })),
    items: [],
    shortcuts: [],
  };
}
