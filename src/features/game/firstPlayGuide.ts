import type { EndpointKind, GameConfig, StopReason } from "../../types/network";
import type { RulesSectionId } from "./rulesGuide";

export const FIRST_PLAY_HINT_IDS = [
  "lottery",
  "off-target",
  "item",
  "harmful-item",
  "terminus",
] as const;

export type GuideHintId = (typeof FIRST_PLAY_HINT_IDS)[number];

export const COACH_STEPS = ["dice", "progress", "map"] as const;
export type CoachStep = (typeof COACH_STEPS)[number];

export interface GuideStorageRead {
  readonly readable: boolean;
  readonly value: string | null;
}

export type SaveLookupKind = "none" | "valid" | "invalid" | "unavailable";

export interface FirstPlayEligibilityInput {
  /** Resume is never eligible, including a saved game at turn zero. */
  readonly resumed: boolean;
  /** Sticky for the app launch: any earlier save discovery excludes this launch. */
  readonly existingSaveObserved: boolean;
  /** Results from every known edition save lookup. */
  readonly saveLookups: readonly SaveLookupKind[];
  readonly firstTurnNotice: GuideStorageRead;
  readonly guideStarted: GuideStorageRead;
  /** In-memory started state survives a failed persistent write during this launch. */
  readonly startedInMemory: boolean;
}

export function isGuideFlagSet(read: GuideStorageRead): boolean {
  return read.readable && read.value === "1";
}

/** Fail closed whenever a save or persistent flag could not be classified. */
export function isFirstPlayEligible(input: FirstPlayEligibilityInput): boolean {
  if (input.resumed || input.existingSaveObserved || input.startedInMemory) return false;
  if (input.saveLookups.length === 0 || input.saveLookups.some((kind) => kind === "unavailable")) return false;
  if (input.saveLookups.some((kind) => kind !== "none")) return false;
  if (!input.firstTurnNotice.readable || !input.guideStarted.readable) return false;
  if (isGuideFlagSet(input.firstTurnNotice) || isGuideFlagSet(input.guideStarted)) return false;
  return true;
}

export type GuideCopyId =
  | "coach-dice"
  | "coach-progress"
  | "coach-map-yamanote"
  | "coach-map-other"
  | "lottery-service"
  | "lottery-direction"
  | "lottery-service-direction"
  | "off-target"
  | "item"
  | "item-pending-discard"
  | "harmful-item"
  | "harmful-item-cancelled"
  | "terminus"
  | "skip-label"
  | "skip-help"
  | "shortcut-help"
  | "adjustment-escape"
  | "adjustment-caution";

export interface GuideCopy {
  readonly copyId: GuideCopyId;
  /** Variants share a hint ID so they never add a second seen flag. */
  readonly hintId: GuideHintId | null;
  readonly sectionId: RulesSectionId;
  readonly text: string;
}

export interface PublishedOffTargetLanding {
  readonly serviceId: string;
  /** Distances from the next stop in each movable direction to the target route. */
  readonly directionDistancesToTarget: readonly number[];
}

type ControlCopyId =
  | "skip-label"
  | "skip-help"
  | "shortcut-help"
  | "adjustment-escape"
  | "adjustment-caution";

export type GuideCopyRequest =
  | {
    readonly kind: "coach";
    readonly step: CoachStep;
    readonly config: Pick<GameConfig, "targetServiceId" | "startStationId">;
    readonly targetName: string;
    readonly startName: string;
  }
  | {
    readonly kind: "lottery";
    readonly resultPublished: boolean;
    readonly serviceDrawRequired: boolean;
    readonly directionDrawRequired: boolean;
  }
  | {
    readonly kind: "off-target";
    readonly resultPublished: boolean;
    readonly config: Pick<GameConfig, "targetServiceId" | "directionLottery">;
    readonly targetName: string;
    readonly landing: PublishedOffTargetLanding;
  }
  | { readonly kind: "item"; readonly resultPublished: boolean; readonly pendingDiscard?: boolean }
  | { readonly kind: "harmful-item"; readonly resultPublished: boolean; readonly cancelled?: boolean }
  | {
    readonly kind: "terminus";
    readonly resultPublished: boolean;
    readonly stopReason: StopReason;
    readonly endpointKind: EndpointKind | null;
    readonly unusedPips: number;
  }
  | { readonly kind: "control"; readonly copyId: ControlCopyId };

const CONTROL_COPY: Readonly<Record<ControlCopyId, string>> = {
  "skip-label": "演出をスキップ",
  "skip-help": "「演出をスキップ」で、移動の演出を飛ばせます。",
  "shortcut-help": "Space / Enter：サイコロを振る　S / Escape：演出をスキップ",
  "adjustment-escape": "Escapeキーでも「そのまま」で続けます。",
  "adjustment-caution": "出目を見た後はターンを取り消せません。",
};

function copy(
  copyId: GuideCopyId,
  hintId: GuideHintId | null,
  sectionId: RulesSectionId,
  text: string,
): GuideCopy {
  return { copyId, hintId, sectionId, text };
}

function coachCopy(request: Extract<GuideCopyRequest, { kind: "coach" }>): GuideCopy {
  if (request.step === "dice") {
    return copy("coach-dice", null, "goal", "サイコロを振ると、出た目の数だけ駅を進みます。");
  }
  if (request.step === "progress") {
    return copy("coach-progress", null, "goal", `踏破区間のバーを埋めて、${request.targetName}の全区間をめぐりましょう。`);
  }
  if (request.config.targetServiceId === "jr-yamanote" && request.config.startStationId === "shimbashi") {
    return copy("coach-map-yamanote", null, "goal", "サイコロと抽選まかせで、山手線を一周して新橋へ。");
  }
  return copy("coach-map-other", null, "goal", `${request.targetName}の全区間をめぐって、${request.startName}を目指しましょう。`);
}

function lotteryCopy(request: Extract<GuideCopyRequest, { kind: "lottery" }>): GuideCopy | null {
  if (!request.resultPublished || (!request.serviceDrawRequired && !request.directionDrawRequired)) return null;
  if (request.serviceDrawRequired && request.directionDrawRequired) {
    return copy(
      "lottery-service-direction",
      "lottery",
      "lottery",
      "乗換駅で移動を終えると、候補の中から次に乗る路線と進む向きを抽選します。",
    );
  }
  if (request.serviceDrawRequired) {
    return copy("lottery-service", "lottery", "lottery", "乗換駅で移動を終えると、候補の中から次に乗る路線を抽選します。");
  }
  return copy("lottery-direction", "lottery", "lottery", "移動を終えた駅で、次に進む向きを抽選します。");
}

function hasTwoDistinctDistances(distances: readonly number[]): boolean {
  if (distances.length !== 2) return false;
  return distances.every((distance) => !Number.isNaN(distance) && distance >= 0) && distances[0] !== distances[1];
}

function offTargetCopy(request: Extract<GuideCopyRequest, { kind: "off-target" }>): GuideCopy | null {
  if (!request.resultPublished || request.landing.serviceId === request.config.targetServiceId) return null;
  if (!hasTwoDistinctDistances(request.landing.directionDistancesToTarget)) return null;
  const toward = request.config.directionLottery.towardTargetWeight;
  const away = request.config.directionLottery.awayFromTargetWeight ?? 1;
  if (toward <= away) return null;
  return copy(
    "off-target",
    "off-target",
    "lottery",
    `${request.targetName}以外の路線では、${request.targetName}に近づく向きが抽選で出やすくなっています。`,
  );
}

/** Resolve a verified Japanese copy line from config and already-published event data. */
export function buildGuideCopy(request: GuideCopyRequest): GuideCopy | null {
  switch (request.kind) {
    case "coach":
      return coachCopy(request);
    case "lottery":
      return lotteryCopy(request);
    case "off-target":
      return offTargetCopy(request);
    case "item":
      if (!request.resultPublished) return null;
      return request.pendingDiscard
        ? copy("item-pending-discard", "item", "items", "持ち物がいっぱいのときは、持っているものと新しいものから、捨てるものを1つ選びます。")
        : copy("item", "item", "items", "アイテムを手に入れました。使うタイミングは、持ち物の説明で確認できます。");
    case "harmful-item":
      if (!request.resultPublished) return null;
      return request.cancelled
        ? copy("harmful-item-cancelled", "harmful-item", "items", "遅延証明書が、不利なアイテムを打ち消しました。")
        : copy("harmful-item", "harmful-item", "items", "不利なアイテムは持ち物には入らず、それぞれ決まったタイミングで自動で効きます。");
    case "terminus":
      if (!request.resultPublished || request.stopReason !== "endpoint" || request.endpointKind !== "terminus" || request.unusedPips <= 0) return null;
      return copy("terminus", "terminus", "goal", "終点ではそこで止まり、残りの出目は使いません。");
    case "control":
      return copy(request.copyId, null, "controls", CONTROL_COPY[request.copyId]);
  }
}
