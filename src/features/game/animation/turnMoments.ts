import type { DeepReadonly, Direction, ItemTurnRecord, SegmentId } from "../../../types/network";
import type { MoveEvent, RailwayNetwork } from "../engine";
import { itemRideHasModifierWording } from "../hudPresentation";
import type { TurnPresentationPolicy } from "./turnMomentPolicy";
import type { ItemSessionView } from "../itemSession";
import type { LastMove } from "../gameSession";
import type { RevealStage } from "./useRevealSequence";

export type PreMoveStage = "waiting-roll" | "tumble" | "awaiting-adjust" | "waiting-record" | "stamps" | "released";
export type TurnRevealStageKey = "arrival" | "segment-flash" | "lottery-flip" | "lottery-settle" | "pickup";

export interface TurnOrigin {
  stationId: string;
  ride: Readonly<{ serviceId: string; direction: Direction }>;
  completedSegmentIds: readonly string[];
  turn: number;
  itemView: ItemSessionView;
  previousLastMove: LastMove | null;
}

export interface RollAttempt {
  key: string;
  sessionId: number;
  recordTurn: number;
  source: "click" | "restored-roll";
  origin: TurnOrigin;
  policy: TurnPresentationPolicy;
  stage: PreMoveStage;
  rawRoll: number | null;
  tumbleCompleted: boolean;
  skipRequested: boolean;
  motionOmitted: boolean;
  adjustObserved: boolean;
  recordAccepted: boolean;
  stampsRequired: boolean;
  newlyCompletedTargetSegmentIds: readonly SegmentId[];
}

export interface TurnMomentsState {
  sessionId: number | null;
  attempt: RollAttempt | null;
}

export interface TurnMomentObservation {
  decision: ItemSessionView["decision"];
  record: ItemTurnRecord | null;
  movementEvents: readonly MoveEvent[];
  /** Movement identity accompanies events so stale events cannot attach to this attempt. */
  movementSessionId?: number;
  movementTurn?: number;
  targetServiceId: string;
  reducedMotion?: boolean;
}

export interface AcceptedTurnFacts {
  rawRoll: number | null;
  deadhead: boolean;
  recordTurn: number | null;
  source: "click" | "restored-roll" | null;
  delayActivated: boolean;
  stampsRequired: boolean;
  newlyCompletedTargetSegmentIds: readonly SegmentId[];
}

export type TurnMomentsAction =
  | { type: "begin"; sessionId: number; turn: number; decisionRevision: number; source?: "click" | "restored-roll";
      origin: TurnOrigin; policy: TurnPresentationPolicy; reducedMotion?: boolean }
  | { type: "observe"; sessionId: number; facts: TurnMomentObservation }
  | { type: "advance"; key: string; expectedStage: PreMoveStage }
  | { type: "skip"; key: string }
  | { type: "reset"; sessionId: number | null };

/** Normalizes externally observed facts; turn/session ownership is checked by the reducer. */
export function observeTurnFacts(observation: TurnMomentObservation): AcceptedTurnFacts {
  const { decision, record, movementEvents, movementSessionId, movementTurn, targetServiceId } = observation;
  const acceptedMovement = record !== null && movementSessionId !== undefined && movementTurn === record.turn
    ? movementEvents : [];
  const completed = new Set<SegmentId>();
  for (const event of acceptedMovement) {
    if (event.type === "segment-traversed" && event.newlyCompleted && event.serviceId === targetServiceId) {
      completed.add(event.segmentId);
    }
  }
  const ride = record?.kind === "item-ride" ? record : null;
  const delayActivated = ride?.itemEvents.some((event) => event.type === "effect-activated" && event.effect === "delay") ?? false;
  const modifierWording = ride !== null && itemRideHasModifierWording(ride);
  return {
    rawRoll: decision?.kind === "adjust" ? decision.rawRoll : ride?.rawRoll ?? null,
    deadhead: record?.kind === "deadhead",
    recordTurn: record?.turn ?? null,
    source: record !== null ? "click" : decision?.kind === "adjust" ? "click" : null,
    delayActivated,
    // 寝過ごし is a stamp (user decision 2026-11-03) even though the compact roll shows it as the label.
    stampsRequired: modifierWording || delayActivated || ride?.movementMode === "oversleep",
    newlyCompletedTargetSegmentIds: [...completed],
  };
}

/** What decides the post-move stages of the latest committed record. */
export interface TurnRevealFacts {
  /** The latest committed item record; null in classic mode or before the first turn. */
  record: DeepReadonly<ItemTurnRecord> | null;
  /** The record was already committed when the session was entered (resume): it is never revealed again. */
  restored: boolean;
  /** New target segments captured from this record's accepted movement. */
  newlyCompletedTargetSegmentIds: readonly SegmentId[];
  /** Accepted new target segments have at least one renderable geometry feature. */
  hasRenderableNewTargetSegments: boolean;
  /** Reduced motion: the result publishes at once, with no timed stage. */
  omitted: boolean;
}

/** Geometry shared by stage eligibility and the map request, without depending on displayed progress. */
export interface SegmentFlashGeometry {
  readonly segmentsById: RailwayNetwork["segmentsById"];
  readonly targetSegmentIds: readonly SegmentId[];
}

export function segmentFlashFeatureIds(
  geometry: Pick<RailwayNetwork, "segmentsById">,
  targetIds: readonly SegmentId[],
  newlyCompletedTargetSegmentIds: readonly SegmentId[],
): readonly string[] {
  const required = new Set(targetIds);
  return [...new Set(newlyCompletedTargetSegmentIds.filter((id) => required.has(id))
    .flatMap((id) => geometry.segmentsById.get(id)?.geometryFeatureIds ?? []))];
}

const NO_REVEAL_STAGES: readonly RevealStage<TurnRevealStageKey>[] = [];

/** Post-move stages from the accepted snapshot. */
export function buildTurnRevealStages(facts: TurnRevealFacts, policy: TurnPresentationPolicy): readonly RevealStage<TurnRevealStageKey>[] {
  if (facts.record === null || facts.restored || facts.omitted) return NO_REVEAL_STAGES;
  const record = facts.record;
  const timing = policy.timing;
  const stages: RevealStage<TurnRevealStageKey>[] = [];
  if (policy.showArrival && timing.arrivalMs !== null) stages.push({ key: "arrival", durationMs: timing.arrivalMs });
  else if (policy.showImportantMoments && facts.newlyCompletedTargetSegmentIds.length > 0 && facts.hasRenderableNewTargetSegments) {
    stages.push({ key: "segment-flash", durationMs: timing.flashMs });
  }
  if (record.kind !== "item-ride" || record.stopReason === "goal") return stages;
  if (record.landing) {
    const services = record.landingSnapshot?.services ?? [];
    const selected = services.find((service) => service.serviceId === record.landing?.serviceId);
    const drawsLottery = selected !== undefined && (services.length > 1 || selected.directions.length > 1);
    if (drawsLottery) {
      stages.push({ key: "lottery-flip", durationMs: timing.lotteryFlipMs },
        { key: "lottery-settle", durationMs: timing.lotterySettleMs });
    }
  }
  const pickedUp = record.itemEvents.some((event) =>
    event.type === "pickup-retained" || event.type === "pickup-pending-discard");
  if (pickedUp) stages.push({ key: "pickup", durationMs: timing.pickupMs });
  return stages;
}

export const INITIAL_TURN_MOMENTS_STATE: TurnMomentsState = { sessionId: null, attempt: null };

export function turnMomentsReducer(state: TurnMomentsState, action: TurnMomentsAction): TurnMomentsState {
  if (action.type === "reset") {
    if (state.sessionId === action.sessionId && state.attempt === null) return state;
    return { sessionId: action.sessionId, attempt: null };
  }
  if (action.type === "begin") return beginAttempt(state, action);

  const attempt = state.attempt;
  if (attempt === null) return state;
  if (action.type === "skip") {
    if (action.key !== attempt.key || attempt.skipRequested) return state;
    return { ...state, attempt: { ...attempt, skipRequested: true, stage: "released", motionOmitted: true, tumbleCompleted: true } };
  }
  if (action.type === "advance") return advanceAttempt(state, attempt, action);
  if (action.sessionId !== attempt.sessionId || state.sessionId !== attempt.sessionId) return state;
  return observeAttempt(state, attempt, action.facts);
}

function beginAttempt(state: TurnMomentsState, action: Extract<TurnMomentsAction, { type: "begin" }>): TurnMomentsState {
  const key = `${action.sessionId}:roll:${action.turn + 1}:${action.decisionRevision}`;
  if (state.sessionId === action.sessionId && state.attempt?.key === key) return state;
  const source = action.source ?? "click";
  const omitted = Boolean(action.reducedMotion) || source === "restored-roll";
  return {
    sessionId: action.sessionId,
    attempt: {
      key, sessionId: action.sessionId, recordTurn: action.turn + 1, source, origin: action.origin,
      policy: action.policy, stage: omitted ? "waiting-record" : "waiting-roll", rawRoll: null,
      tumbleCompleted: omitted, skipRequested: false, motionOmitted: omitted, adjustObserved: false,
      recordAccepted: false, stampsRequired: false, newlyCompletedTargetSegmentIds: [],
    },
  };
}

function advanceAttempt(state: TurnMomentsState, attempt: RollAttempt,
  action: Extract<TurnMomentsAction, { type: "advance" }>): TurnMomentsState {
  if (action.key !== attempt.key || action.expectedStage !== attempt.stage) return state;
  let nextStage: PreMoveStage = attempt.stage;
  if (attempt.stage === "tumble") {
    nextStage = attempt.adjustObserved && !attempt.recordAccepted ? "awaiting-adjust"
      : attempt.recordAccepted ? nextRecordedStage(attempt.stampsRequired) : "waiting-record";
  } else if (attempt.stage === "stamps") nextStage = "released";
  if (nextStage === attempt.stage) return state;
  return { ...state, attempt: { ...attempt, stage: nextStage,
    tumbleCompleted: attempt.stage === "tumble" || attempt.tumbleCompleted } };
}

function observeAttempt(state: TurnMomentsState, attempt: RollAttempt, observation: TurnMomentObservation): TurnMomentsState {
  const facts = observeTurnFacts(observation);
  const recordMatches = observation.record !== null && observation.record.turn === attempt.recordTurn;
  const recordIsForeign = observation.record !== null && !recordMatches;
  const decisionMatches = observation.decision?.kind === "adjust"
    && observation.decision.turn === attempt.recordTurn && !recordIsForeign;
  const movementMatches = recordMatches && observation.movementSessionId === attempt.sessionId
    && observation.movementTurn === attempt.recordTurn;
  const segments = movementMatches ? facts.newlyCompletedTargetSegmentIds : [];
  const segmentIds = [...new Set([...attempt.newlyCompletedTargetSegmentIds, ...segments])];
  const recordAccepted = attempt.recordAccepted || recordMatches;
  const deadhead = recordMatches && observation.record?.kind === "deadhead";
  const rawRoll = recordMatches ? (observation.record?.kind === "item-ride" ? observation.record.rawRoll : null)
    : decisionMatches ? observation.decision?.kind === "adjust" ? observation.decision.rawRoll : attempt.rawRoll
      : attempt.rawRoll;
  const stampsRequired = recordMatches ? facts.stampsRequired : attempt.stampsRequired;
  const omitted = attempt.motionOmitted || Boolean(observation.reducedMotion) || deadhead;
  const adjustObserved = attempt.adjustObserved || decisionMatches;
  let stage = attempt.stage;
  if (deadhead && attempt.stage !== "released") stage = "released";
  else if (omitted || attempt.skipRequested) {
    if (recordAccepted && attempt.stage !== "released") stage = "released";
  } else if (attempt.stage === "waiting-roll" && (decisionMatches || (recordMatches && rawRoll !== null))) stage = "tumble";
  else if (attempt.stage === "awaiting-adjust" && recordAccepted) stage = nextRecordedStage(stampsRequired);
  else if (attempt.stage === "waiting-record" && recordAccepted) stage = nextRecordedStage(stampsRequired);
  const nextAttempt: RollAttempt = {
    ...attempt, stage, rawRoll, adjustObserved, recordAccepted, stampsRequired,
    tumbleCompleted: attempt.tumbleCompleted || stage === "stamps" || stage === "released",
    motionOmitted: omitted, newlyCompletedTargetSegmentIds: segmentIds,
  };
  if (sameAttempt(attempt, nextAttempt)) return state;
  return { ...state, attempt: nextAttempt };
}

function nextRecordedStage(stampsRequired: boolean): PreMoveStage {
  return stampsRequired ? "stamps" : "released";
}

function sameAttempt(left: RollAttempt, right: RollAttempt): boolean {
  return left.stage === right.stage && left.rawRoll === right.rawRoll && left.tumbleCompleted === right.tumbleCompleted
    && left.skipRequested === right.skipRequested && left.motionOmitted === right.motionOmitted
    && left.adjustObserved === right.adjustObserved && left.recordAccepted === right.recordAccepted
    && left.stampsRequired === right.stampsRequired
    && left.newlyCompletedTargetSegmentIds.length === right.newlyCompletedTargetSegmentIds.length
    && left.newlyCompletedTargetSegmentIds.every((id, index) => id === right.newlyCompletedTargetSegmentIds[index]);
}
