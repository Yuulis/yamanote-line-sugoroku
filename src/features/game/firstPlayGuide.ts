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

export interface CoachStepCopy {
  readonly step: CoachStep;
  readonly copy: GuideCopy;
}

export type CoachStepSequence = readonly [CoachStepCopy, CoachStepCopy, CoachStepCopy];

export interface CoachRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CoachSize {
  readonly width: number;
  readonly height: number;
}

export type CoachPlacementSide = "top" | "right" | "bottom" | "left" | "center";

export interface CoachBubblePlacement {
  readonly left: number;
  readonly top: number;
  readonly side: CoachPlacementSide;
}

export const COACH_VIEWPORT_MARGIN_PX = 16;
export const COACH_TARGET_GAP_PX = 16;

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

export type GuideHintCopy = GuideCopy & { readonly hintId: GuideHintId };

/** A published, immutable hint candidate. Its copy stays paired with its candidate key. */
export interface GuideCandidate {
  readonly key: string;
  readonly sessionId: number;
  readonly turn: number;
  readonly copy: GuideHintCopy;
}

export interface GuideAcknowledgement {
  readonly sessionId: number;
  readonly candidateKey: string;
  readonly displayGeneration: number;
}

export interface GuideAnnouncement {
  readonly key: string;
  readonly text: string;
  readonly acknowledgement: GuideAcknowledgement;
}

export interface GuideDisplay {
  readonly acknowledgement: GuideAcknowledgement;
  readonly visibleAcknowledged: boolean;
  readonly statusAcknowledged: boolean;
  /** The selected key and its copy are captured together for this display generation. */
  readonly announcement: GuideAnnouncement | null;
}

export interface GuideQueueState {
  readonly sessionId: number | null;
  readonly current: GuideCandidate | null;
  readonly queued: readonly GuideCandidate[];
  readonly seenIds: readonly GuideHintId[];
  readonly closedIds: readonly GuideHintId[];
  readonly hintsDisabled: boolean;
  readonly ended: boolean;
  readonly displayGeneration: number;
  readonly display: GuideDisplay | null;
}

export type GuideQueueAction =
  | {
    readonly type: "resetSession";
    readonly sessionId: number | null;
    readonly seenIds: readonly GuideHintId[];
    readonly hintsDisabled: boolean;
  }
  | { readonly type: "enqueue"; readonly sessionId: number | null; readonly candidates: readonly GuideCandidate[] }
  | { readonly type: "beginDisplay" }
  | { readonly type: "withdrawDisplay" }
  | { readonly type: "acknowledgeVisible"; readonly acknowledgement: GuideAcknowledgement }
  | { readonly type: "acknowledgeStatus"; readonly acknowledgement: GuideAcknowledgement }
  | { readonly type: "closeCurrent" }
  | { readonly type: "disableHints" }
  | { readonly type: "discard" };

const HINT_PRIORITY = new Map(FIRST_PLAY_HINT_IDS.map((hintId, index) => [hintId, index]));

export function createGuideQueueState(
  sessionId: number | null,
  seenIds: readonly GuideHintId[] = [],
  hintsDisabled = false,
): GuideQueueState {
  return {
    sessionId,
    current: null,
    queued: [],
    seenIds: [...new Set(seenIds)],
    closedIds: [],
    hintsDisabled,
    ended: false,
    displayGeneration: 0,
    display: null,
  };
}

export function guideCandidateHintId(candidate: GuideCandidate): GuideHintId {
  return candidate.copy.hintId;
}

function orderCandidates(candidates: readonly GuideCandidate[]): GuideCandidate[] {
  return [...candidates].sort((left, right) => left.turn - right.turn
    || (HINT_PRIORITY.get(guideCandidateHintId(left)) ?? Number.MAX_SAFE_INTEGER)
      - (HINT_PRIORITY.get(guideCandidateHintId(right)) ?? Number.MAX_SAFE_INTEGER)
    || left.key.localeCompare(right.key));
}

function nextCurrent(state: GuideQueueState, queued: readonly GuideCandidate[]): GuideQueueState {
  const [current = null, ...remaining] = queued;
  return { ...state, current, queued: remaining, display: null };
}

function enqueueGuideCandidates(state: GuideQueueState, sessionId: number | null, candidates: readonly GuideCandidate[]): GuideQueueState {
  if (sessionId === null || sessionId !== state.sessionId || state.hintsDisabled || state.ended) return state;
  const existing = [state.current, ...state.queued].filter((candidate): candidate is GuideCandidate => candidate !== null);
  const usedIds = new Set<GuideHintId>([...state.seenIds, ...state.closedIds, ...existing.map(guideCandidateHintId)]);
  const usedKeys = new Set(existing.map((candidate) => candidate.key));
  const additions = orderCandidates(candidates).filter((candidate) => {
    if (candidate.sessionId !== sessionId || usedKeys.has(candidate.key) || usedIds.has(guideCandidateHintId(candidate))) return false;
    usedKeys.add(candidate.key);
    usedIds.add(guideCandidateHintId(candidate));
    return true;
  });
  if (additions.length === 0) return state;
  const queue = orderCandidates([...state.queued, ...additions]);
  if (state.current !== null) return { ...state, queued: queue };
  return nextCurrent(state, queue);
}

function beginGuideDisplay(state: GuideQueueState): GuideQueueState {
  if (state.current === null || state.hintsDisabled || state.ended || state.display !== null || state.sessionId === null) return state;
  const displayGeneration = state.displayGeneration + 1;
  const acknowledgement: GuideAcknowledgement = {
    sessionId: state.sessionId,
    candidateKey: state.current.key,
    displayGeneration,
  };
  const alreadySeen = state.seenIds.includes(guideCandidateHintId(state.current));
  const announcement: GuideAnnouncement | null = alreadySeen ? null : {
    key: `guide-hint:${state.sessionId}:${state.current.key}:${displayGeneration}`,
    text: state.current.copy.text,
    acknowledgement,
  };
  return {
    ...state,
    displayGeneration,
    display: { acknowledgement, visibleAcknowledged: false, statusAcknowledged: false, announcement },
  };
}

export function isGuideDisplayCurrent(state: GuideQueueState, acknowledgement: GuideAcknowledgement): boolean {
  const display = state.display;
  return state.sessionId === acknowledgement.sessionId
    && state.current?.key === acknowledgement.candidateKey
    && display?.acknowledgement.sessionId === acknowledgement.sessionId
    && display.acknowledgement.candidateKey === acknowledgement.candidateKey
    && display.acknowledgement.displayGeneration === acknowledgement.displayGeneration;
}

function acknowledgeGuide(state: GuideQueueState, acknowledgement: GuideAcknowledgement, kind: "visible" | "status"): GuideQueueState {
  if (!isGuideDisplayCurrent(state, acknowledgement) || state.current === null || state.hintsDisabled || state.ended) return state;
  const display = state.display;
  if (display === null) return state;
  const nextDisplay: GuideDisplay = kind === "visible"
    ? { ...display, visibleAcknowledged: true }
    : { ...display, statusAcknowledged: true };
  if (nextDisplay.visibleAcknowledged === display.visibleAcknowledged
    && nextDisplay.statusAcknowledged === display.statusAcknowledged) return state;
  if (nextDisplay.visibleAcknowledged && nextDisplay.statusAcknowledged) {
    const hintId = guideCandidateHintId(state.current);
    return {
      ...state,
      seenIds: state.seenIds.includes(hintId) ? state.seenIds : [...state.seenIds, hintId],
      display: nextDisplay,
    };
  }
  return { ...state, display: nextDisplay };
}

/** Pure queue transitions for hints; IDs are deduplicated across active, waiting, seen and closed state. */
export function guideQueueReducer(state: GuideQueueState, action: GuideQueueAction): GuideQueueState {
  switch (action.type) {
    case "resetSession":
      return action.sessionId === state.sessionId
        ? state
        : createGuideQueueState(action.sessionId, action.seenIds, action.hintsDisabled);
    case "enqueue":
      return enqueueGuideCandidates(state, action.sessionId, action.candidates);
    case "beginDisplay":
      return beginGuideDisplay(state);
    case "withdrawDisplay":
      return state.display === null ? state : { ...state, display: null };
    case "acknowledgeVisible":
      return acknowledgeGuide(state, action.acknowledgement, "visible");
    case "acknowledgeStatus":
      return acknowledgeGuide(state, action.acknowledgement, "status");
    case "closeCurrent": {
      if (state.current === null) return state;
      const hintId = guideCandidateHintId(state.current);
      return nextCurrent({
        ...state,
        closedIds: state.closedIds.includes(hintId) ? state.closedIds : [...state.closedIds, hintId],
      }, state.queued);
    }
    case "disableHints":
      return state.hintsDisabled && state.current === null && state.queued.length === 0 && state.display === null
        ? state
        : { ...state, current: null, queued: [], display: null, hintsDisabled: true };
    case "discard":
      return state.ended && state.current === null && state.queued.length === 0 && state.display === null
        ? state
        : { ...state, current: null, queued: [], display: null, ended: true };
  }
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
      return copy("terminus", "terminus", "goal", "終点に着くと、出目が余っていてもそこで止まります。");
    case "control":
      return copy(request.copyId, null, "controls", CONTROL_COPY[request.copyId]);
  }
}

/** Build the fixed dice → progress → map sequence from the verified, edition-aware coach copy. */
export function buildCoachSteps(
  request: Omit<Extract<GuideCopyRequest, { kind: "coach" }>, "kind" | "step">,
): CoachStepSequence {
  return [
    { step: "dice", copy: coachCopy({ ...request, kind: "coach", step: "dice" }) },
    { step: "progress", copy: coachCopy({ ...request, kind: "coach", step: "progress" }) },
    { step: "map", copy: coachCopy({ ...request, kind: "coach", step: "map" }) },
  ];
}

function isUsableCoachRect(rect: CoachRect | null | undefined): rect is CoachRect {
  return rect !== null && rect !== undefined
    && Number.isFinite(rect.left) && Number.isFinite(rect.top)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width > 0 && rect.height > 0;
}

function safeSize(size: CoachSize): CoachSize {
  return {
    width: Number.isFinite(size.width) ? Math.max(0, size.width) : 0,
    height: Number.isFinite(size.height) ? Math.max(0, size.height) : 0,
  };
}

function clampBubblePosition(value: number, bubbleLength: number, viewportLength: number, margin: number): number {
  const max = viewportLength - bubbleLength - margin;
  if (max >= margin) return Math.min(max, Math.max(margin, value));
  if (viewportLength >= bubbleLength) return (viewportLength - bubbleLength) / 2;
  return 0;
}

function centeredCoachPlacement(bubble: CoachSize, viewport: CoachSize, margin: number): CoachBubblePlacement {
  return {
    left: clampBubblePosition((viewport.width - bubble.width) / 2, bubble.width, viewport.width, margin),
    top: clampBubblePosition((viewport.height - bubble.height) / 2, bubble.height, viewport.height, margin),
    side: "center",
  };
}

/** Position a measured coach bubble beside its target, keeping it inside the visible viewport. */
export function placeCoachBubble(
  targetRect: CoachRect | null | undefined,
  bubbleSize: CoachSize,
  viewportSize: CoachSize,
): CoachBubblePlacement {
  const bubble = safeSize(bubbleSize);
  const viewport = safeSize(viewportSize);
  if (!isUsableCoachRect(targetRect)) {
    return centeredCoachPlacement(bubble, viewport, COACH_VIEWPORT_MARGIN_PX);
  }

  const margin = COACH_VIEWPORT_MARGIN_PX;
  const gap = COACH_TARGET_GAP_PX;
  const target = targetRect;
  const candidates: readonly {
    readonly side: Exclude<CoachPlacementSide, "center">;
    readonly space: number;
    readonly required: number;
    readonly left: number;
    readonly top: number;
  }[] = [
    {
      side: "top", space: target.top - margin, required: bubble.height + gap,
      left: target.left + target.width / 2 - bubble.width / 2, top: target.top - gap - bubble.height,
    },
    {
      side: "right", space: viewport.width - margin - (target.left + target.width), required: bubble.width + gap,
      left: target.left + target.width + gap, top: target.top + target.height / 2 - bubble.height / 2,
    },
    {
      side: "bottom", space: viewport.height - margin - (target.top + target.height), required: bubble.height + gap,
      left: target.left + target.width / 2 - bubble.width / 2, top: target.top + target.height + gap,
    },
    {
      side: "left", space: target.left - margin, required: bubble.width + gap,
      left: target.left - gap - bubble.width, top: target.top + target.height / 2 - bubble.height / 2,
    },
  ];
  const fitting = candidates.filter((candidate) => candidate.space >= candidate.required);
  const available = fitting.length > 0 ? fitting : candidates;
  const selected = available.reduce((best, candidate) => candidate.space > best.space ? candidate : best);

  return {
    left: clampBubblePosition(selected.left, bubble.width, viewport.width, margin),
    top: clampBubblePosition(selected.top, bubble.height, viewport.height, margin),
    side: selected.side,
  };
}
