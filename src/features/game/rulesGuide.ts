import type { GameConfig, ItemKind, ItemPolicy, ServiceKind } from "../../types/network";
import { ANIMATION_SPEEDS } from "./gameConfig";
import { PRESENTATION_LEVELS } from "./gameSettings";
import { ITEM_DESCRIPTIONS, itemTiming } from "./itemPresentation";

export type RulesSectionId = "goal" | "lottery" | "items" | "controls" | "save";
/** Child-facing opener: the opener comes from the activating event (`event.currentTarget`), never `document.activeElement`. */
export type OpenRules = (sectionId: RulesSectionId | undefined, opener: HTMLElement) => void;

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
  /** Display name of the start and goal station; falls back to a generic label. */
  readonly startStationName?: string;
  /** Label of the direction the target service runs (e.g. its loop direction); omitted when absent. */
  readonly targetDirectionLabel?: string;
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
const DEFAULT_START_LABEL = "出発駅";
const NO_ITEMS_TEXT = "このルールではアイテムはありません";
const AUTOMATIC_ITEM_TIMING = "拾うと自動で発動";
const LABEL_SEPARATOR = "→";
const TURN_COUNT_PATTERN = /\d+(?=ターン)/;

const SHORTCUTS: readonly string[] = [
  "Space / Enter：サイコロを振る",
  "S / Escape：演出をスキップ",
  "Escape：選んだアイテムの選択を解除",
  "Escape：出目調整の画面で「そのまま」を選ぶ",
];

interface GoalNames {
  readonly target: string;
  readonly start: string;
  readonly directionLabel: string | undefined;
}

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
  // The engine re-draws the direction at every non-clearing landing (landing.ts R1-a), whatever the weights.
  const redraw = `${name}以外の路線では、乗換駅でなくても、移動を終えた駅で進む向きを抽選し直します。`;
  if (toward === away) return [redraw, `${name}以外の路線では、進む向きはどちらも同じ確率です。`];
  return [
    redraw,
    `${name}以外の路線では、${name}に近づく向きと遠ざかる向きが${toward}:${away}の重みで選ばれます。`,
    `${name}までの距離が同じ場合は、どちらの向きも同じ確率です。向きが1つしかない駅では、その向きに進みます。`,
  ];
}

function lotteryParagraphs(config: GameConfig, names: GoalNames): readonly string[] {
  const { target: name, directionLabel } = names;
  return [
    "乗換駅で移動を終えると、次に乗る路線を抽選します。途中で通るだけの駅では、抽選しません。",
    "いま乗っている路線も候補に入ります。同じ路線がもう一度選ばれることもあります。",
    serviceShareText(config.serviceLottery.target, name),
    otherRoutesText(config.serviceLottery.kindWeights, name),
    ...(directionLabel ? [`${name}では、いつも${directionLabel}に進みます。`] : []),
    ...directionText(config.directionLottery, name),
  ];
}

function goalPolicyText(policy: GameConfig["goalArrivalPolicy"], names: GoalNames): string {
  const { target, start } = names;
  switch (policy) {
    case "truncate-on-target-service":
      return `踏破を終えていれば、${target}では${start}に着いた時点で止まってクリアです。ほかの路線では、移動の最後にちょうど${start}に止まる必要があります。`;
    case "exact-stop":
      return `踏破を終えていれば、どの路線でも、移動の最後にちょうど${start}に止まる必要があります。`;
    case "pass-through":
      return `踏破を終えていれば、どの路線でも、${start}に着いた時点で止まってクリアです。`;
  }
}

function goalParagraphs(config: GameConfig, names: GoalNames, targetSegmentCount?: number): readonly string[] {
  const { target, start, directionLabel } = names;
  const directed = directionLabel ? `${target}（${directionLabel}）` : target;
  const segments = targetSegmentCount === undefined ? "すべての区間" : `全${targetSegmentCount}区間`;
  return [
    `${start}からスタートします。サイコロの出目の数だけ、駅を進みます。`,
    `${directed}の${segments}を踏破したあと、${start}に着くとクリアです。`,
    goalPolicyText(config.goalArrivalPolicy, names),
    "終点や収録範囲の端に着いたときは、出目が余っていてもそこで止まります。",
  ];
}

function controlsParagraphs(): readonly string[] {
  const speeds = ANIMATION_SPEEDS.map(({ label }) => label).join(LABEL_SEPARATOR);
  const levels = PRESENTATION_LEVELS.map(({ label }) => label).join(LABEL_SEPARATOR);
  return [
    `メニューの「速度」を押すと、移動の速さが切り替わります（${speeds}）。`,
    `「演出」を押すと、演出の量が切り替わります（${levels}）。「演出をスキップ」で、移動の演出を飛ばせます。`,
    "「追尾」をONにすると、地図が現在地を追いかけます。地図を手で動かすと、追尾はOFFになります。",
    "端末の設定で動きを減らしているときは、アニメーションは省略され、「速度」と「演出」は切り替えられません。",
  ];
}

const SAVE_PARAGRAPHS: readonly string[] = [
  "ターンが進むたびに、このブラウザへ自動で保存されます。",
  "ページを閉じても、タイトル画面の「つづきから」で再開できます。",
  "新しいゲームを始めると、保存中のゲームは上書きされます。",
];

function durationText(policy: ItemPolicy): readonly string[] {
  const parts = [
    policy.harmfulKinds.includes("delay") ? `遅延は拾ってから${policy.delayTurns}ターン後に効き` : null,
    policy.harmfulKinds.includes("suspension") ? `運休は${policy.suspensionTurns}ターンの間続き` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? [] : [`${parts.join("、")}ます。`];
}

function hasHarmfulItems(policy: ItemPolicy): boolean {
  return policy.harmfulChancePercent > 0 && policy.harmfulKinds.length > 0;
}

/** Descriptions carry the production turn counts; swap in the configured ones. */
function itemEffect(kind: ItemKind, policy: ItemPolicy): string {
  const { effect } = ITEM_DESCRIPTIONS[kind];
  if (kind === "delay") return effect.replace(TURN_COUNT_PATTERN, String(policy.delayTurns));
  if (kind === "suspension") return effect.replace(TURN_COUNT_PATTERN, String(policy.suspensionTurns));
  return effect;
}

function itemRows(policy: ItemPolicy | undefined): readonly RulesGuideItem[] {
  if (!policy) return [];
  const beneficial = policy.beneficialKinds.map((kind) => ({ kind, timing: itemTiming(kind) }));
  const harmful = hasHarmfulItems(policy)
    ? policy.harmfulKinds.map((kind) => ({ kind, timing: AUTOMATIC_ITEM_TIMING }))
    : [];
  return [...beneficial, ...harmful].map(({ kind, timing }) => ({
    kind,
    name: ITEM_DESCRIPTIONS[kind].name,
    effect: itemEffect(kind, policy),
    timing,
  }));
}

function itemParagraphs(policy: ItemPolicy | undefined): readonly string[] {
  if (!policy) return [NO_ITEMS_TEXT];
  const pickupPercent = policy.dropChancePerMille / PER_MILLE_PER_PERCENT;
  return [
    `移動を終えるたびに、${pickupPercent}%の確率でアイテムを拾えます。`,
    ...(hasHarmfulItems(policy)
      ? [`拾ったアイテムのうち${policy.harmfulChancePercent}%は不利なアイテムです。不利なアイテムは持ち物には入らず、それぞれ決まったタイミングで自動で効きます。`]
      : []),
    `有利なアイテムは${policy.inventoryCapacity}個まで持てます。使えるのは1ターンに${policy.maxActiveItemsPerTurn}個までです。`,
    "持ち物がいっぱいのときに拾うと、持っているものと新しいものから、捨てるものを1つ選びます。",
    ...(hasHarmfulItems(policy) ? durationText(policy) : []),
  ];
}

export function buildRulesGuide(config: GameConfig, options: RulesGuideOptions = {}): RulesGuideModel {
  const names: GoalNames = {
    target: options.targetServiceName ?? DEFAULT_TARGET_LABEL,
    start: options.startStationName ?? DEFAULT_START_LABEL,
    directionLabel: options.targetDirectionLabel,
  };
  const paragraphsById: Readonly<Record<RulesSectionId, readonly string[]>> = {
    goal: goalParagraphs(config, names, options.targetSegmentCount),
    lottery: lotteryParagraphs(config, names),
    items: itemParagraphs(config.itemPolicy),
    controls: controlsParagraphs(),
    save: SAVE_PARAGRAPHS,
  };
  return {
    sections: SECTION_ORDER.map((id) => ({
      id,
      heading: SECTION_HEADINGS[id],
      paragraphs: paragraphsById[id],
    })),
    items: itemRows(config.itemPolicy),
    shortcuts: SHORTCUTS,
  };
}
