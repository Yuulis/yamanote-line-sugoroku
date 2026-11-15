import type { Direction } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import { isItemSave, platformPosition, targetSegmentIds } from "./engine";
import type { SegmentFlashRequest } from "../map/railwayLayers";
import type { DisplayedProgress } from "./animation/displayedProgress";
import { segmentFlashFeatureIds, type TurnRevealStageKey, type RollAttempt } from "./animation/turnMoments";
import { lastMoveOf, type GameSession, type LastMove } from "./gameSession";
import { compactRollFor, compactRollText, effectChipModels, type EffectChipModel } from "./hudPresentation";
import { arrivalLogText, arrivalSummary, displayedRide, itemTurnAnnouncement, landingText, lastRollText, stationName, turnMomentAnnouncement } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";
import type { ItemSessionView } from "./itemSession";
import { targetSegmentsMilestoneToast, turnToasts, type ToastInput } from "./toastQueue";
import { maskTurnMomentItemView } from "./turnMomentItems";
import { adjustmentLandings, displayedHeading, firstTargetCompletionTurn, type AdjustmentLanding, type GoalGuidance } from "./mapGuidance";
import { deriveTurnResult, type TurnResultModel } from "./turnResultCard";

export type TurnPublicationPhase = "pre-move" | "moving" | TurnRevealStageKey | "published";
export type PresentationCandidateRow = ReturnType<PresentationResolver["candidateRows"]>[number];
export type TurnRevealState = TurnRevealStageKey | "waiting" | "done";

export interface TurnMomentDisplayInput {
  session: GameSession;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  /** The single progress input is the already-derived displayedProgress result. */
  progress: DisplayedProgress;
  attempt: RollAttempt | null;
  revealStage: TurnRevealState;
  restoredOrOmitted: boolean;
  itemView?: ItemSessionView | null;
  /** Session-entry history is distinct from a fresh result with motion omitted. */
  restoredHistory?: boolean;
  /** P1 retains the last completed classic summary while the next move runs. */
  previousClassicAnnouncement?: string;
  /** Key of the reveal being presented; it keys the arrival's segment flash. */
  revealKey?: string | null;
  /** Latest turn the session was entered with; a completion at or before it is never announced as new. */
  entryTurn?: number;
}

/** Shared gameplay values and permissions; visual moment models are added in later steps. */
export interface TurnMomentDisplay {
  phase: TurnPublicationPhase;
  turn: number;
  progress: DisplayedProgress;
  ride: Readonly<{ serviceId: string; direction: Direction }>;
  markerBearing: number | null;
  goalGuidance: GoalGuidance | null;
  /** Exact landing per legal choice; non-empty only while the adjustment decision is visible. */
  adjustmentLandings: readonly AdjustmentLanding[];
  compactRoll: string;
  rollText: string;
  arrivalText: string | null;
  lotteryText: string;
  lotteryDisplayText: string;
  candidateRows: readonly PresentationCandidateRow[];
  candidateDrawSlotCount: number;
  showClear: boolean;
  itemView: ItemSessionView | null;
  decision: ItemSessionView["decision"];
  effectModels: readonly EffectChipModel[];
  showItemNotice: boolean;
  /** Publication permits fallback/completion copy even when there are no item events. */
  itemNoticePublished: boolean;
  itemNoticeMove: LastMove | null;
  announcement: string;
  /** Turn number only when announcement currently contains this published turn's result summary. */
  summaryTurn: number | null;
  clearAnnouncement: string;
  toastInputs: readonly ToastInput[];
  canRoll: boolean;
  canSkip: boolean;
  itemUseLocked: boolean;
  /** Map flash of the segments this arrival newly completed; non-null during `arrival` or `segment-flash`. */
  segmentFlash: SegmentFlashRequest | null;
  /** Publication-gated 「前のターン」 card model; components read only this. */
  turnResult: TurnResultModel | null;
}

const PRE_MOVE_STAGES = new Set<RollAttempt["stage"]>(["waiting-roll", "tumble", "awaiting-adjust", "waiting-record", "stamps"]);

function publicationPhase(input: TurnMomentDisplayInput): TurnPublicationPhase {
  if (input.restoredOrOmitted) return "published";
  if (input.attempt && PRE_MOVE_STAGES.has(input.attempt.stage)) return "pre-move";
  if (input.session.phase === "animating") return "moving";
  if (input.revealStage === "segment-flash") return "segment-flash";
  if (input.revealStage === "lottery-flip") return "lottery-flip";
  if (input.revealStage === "lottery-settle") return "lottery-settle";
  if (input.revealStage === "pickup" && hasPickup(input.session.lastMove)) return "pickup";
  if (input.revealStage === "done") return "published";
  if (input.revealStage === "arrival" || input.revealStage === "waiting") return "arrival";
  return "published";
}

function previousLastMove(input: TurnMomentDisplayInput): LastMove | null {
  return input.attempt?.origin.previousLastMove ?? null;
}

function originProgress(input: TurnMomentDisplayInput): DisplayedProgress {
  const origin = input.attempt?.origin;
  if (!origin) return input.progress;
  return {
    stationId: origin.stationId,
    position: platformPosition(input.network, origin.ride.serviceId, origin.stationId),
    completedSegmentIds: origin.completedSegmentIds,
    stepsCompleted: 0,
  };
}

function arrivalProgress(input: TurnMomentDisplayInput): DisplayedProgress {
  const { session, network, progress } = input;
  const move = session.lastMove;
  if (!move) return progress;
  return {
    ...progress,
    stationId: move.stopStationId,
    position: platformPosition(network, move.serviceId, move.stopStationId),
  };
}

function visibleLastMove(input: TurnMomentDisplayInput, phase: TurnPublicationPhase): LastMove | null {
  return phase === "pre-move" ? previousLastMove(input)
    : phase === "moving" && input.attempt ? previousLastMove(input) : input.session.lastMove;
}

function visibleProgress(input: TurnMomentDisplayInput, phase: TurnPublicationPhase, lotteryPublished: boolean): DisplayedProgress {
  if (phase === "pre-move") return originProgress(input);
  if (phase === "moving") return input.progress;
  return lotteryPublished ? input.progress : arrivalProgress(input);
}

function visibleRide(input: TurnMomentDisplayInput, phase: TurnPublicationPhase, lotteryPublished: boolean): TurnMomentDisplay["ride"] {
  if (lotteryPublished) return displayedRide(input.session);
  if (phase === "pre-move" || phase === "moving") {
    const originRide = input.attempt?.origin.ride;
    if (originRide) return originRide;
  }
  const move = input.session.lastMove;
  if (move) return { serviceId: move.serviceId, direction: move.direction };
  return input.attempt?.origin.ride ?? displayedRide(input.session);
}

function visibleDecision(
  view: ItemSessionView | null, attempt: RollAttempt | null, active: boolean, resultPublished: boolean,
): ItemSessionView["decision"] {
  const decision = view?.decision ?? null;
  if (!active) return decision;
  if (attempt?.stage === "awaiting-adjust" && decision?.kind === "adjust") return decision;
  if (resultPublished && decision?.kind === "discard") return decision;
  return null;
}

/** Previews read the dialog's own pending roll, so they appear and disappear with the decision. */
function visibleAdjustmentLandings(input: TurnMomentDisplayInput, decision: ItemSessionView["decision"]): readonly AdjustmentLanding[] {
  if (decision?.kind !== "adjust") return [];
  const position = { ...input.session.game, currentServiceId: decision.resolvedRide.serviceId, direction: decision.resolvedRide.direction };
  return adjustmentLandings(position, decision.rawRoll, decision.allowedDeltas, input.network, input.presentation);
}

function visibleCandidates(move: LastMove | null, presentation: PresentationResolver): PresentationCandidateRow[] {
  if (!move?.landing || (!move.landing.serviceDrawRequired && !move.landing.directionDrawRequired)) return [];
  return presentation.candidateRows(move.landing.serviceCandidates);
}

function visibleTurnResult(
  input: TurnMomentDisplayInput,
  lotteryPublished: boolean,
  resultPublished: boolean,
  targetIds: readonly string[],
): TurnResultModel | null {
  const { session, network, presentation, attempt } = input;
  let move: LastMove | null;
  let turn: number;
  let itemsPublished = true;

  if (attempt !== null || isItemSave(session.game)) {
    const cardIsCurrent = lotteryPublished;
    move = cardIsCurrent ? session.lastMove : previousLastMove(input);
    turn = move?.itemRecord?.turn ?? (cardIsCurrent ? session.game.turn : attempt?.origin.turn ?? session.game.turn);
    itemsPublished = cardIsCurrent ? resultPublished : true;
  } else {
    const history = session.game.movementHistory;
    const classicUnpublished = session.phase === "animating" || !lotteryPublished;
    if (classicUnpublished) {
      const previousRecord = history.at(-2);
      if (!previousRecord) return null;
      move = lastMoveOf({ ...session.game, movementHistory: history.slice(0, -1) }, network);
      turn = previousRecord.turn;
    } else {
      move = session.lastMove;
      turn = history.at(-1)?.turn ?? session.game.turn;
    }
  }

  return deriveTurnResult({
    sessionId: session.sessionId,
    turn,
    move,
    records: session.game.movementHistory,
    pending: isItemSave(session.game) ? session.game.pending ?? null : null,
    targetSegmentIds: targetIds,
    initialServiceId: session.game.config.targetServiceId,
    itemsPublished,
    network,
    presentation,
  });
}

export function deriveTurnMomentDisplay(input: TurnMomentDisplayInput): TurnMomentDisplay {
  const current = input.session.lastMove;
  const phase = publicationPhase(input);
  const isBeforeArrival = phase === "pre-move" || phase === "moving";
  const isPublished = phase === "published";
  const lotteryPublished = isPublished || phase === "pickup";
  const progress = visibleProgress(input, phase, lotteryPublished);
  const ride = visibleRide(input, phase, lotteryPublished);
  const lastMove = visibleLastMove(input, phase);
  const attempt = input.attempt;
  let compactRoll = compactRollText(compactRollFor(lastMove));
  if (attempt && phase === "pre-move") {
    if (attempt.stage === "waiting-roll" || attempt.stage === "tumble") compactRoll = "—";
    else if (attempt.rawRoll !== null) compactRoll = `${attempt.rawRoll}マス`;
    if (attempt.stage === "stamps" && current) compactRoll = compactRollText(compactRollFor(current));
  }
  if (phase === "moving" && current) compactRoll = compactRollText(compactRollFor(current));
  const rollText = isBeforeArrival ? lastRollText(lastMove, input.network, input.presentation)
    : current ? lastRollText(current, input.network, input.presentation) : "—";
  const targetIds = targetSegmentIds(input.session.game.config, input.network);
  const completedIds = new Set(progress.completedSegmentIds);
  const completedCount = targetIds.filter((id) => completedIds.has(id)).length;
  const requiredCount = targetIds.length;
  const goal = input.session.game.status === "completed";
  const historicalRecords = input.session.game.movementHistory.map(({ turn: recordTurn, traversedSegmentIds }) => ({
    turn: recordTurn,
    traversedSegmentIds,
  }));
  const pendingDiscardRecord = isItemSave(input.session.game) && input.session.game.pending?.kind === "discard"
    ? input.session.game.pending.record : null;
  const completionRecords = pendingDiscardRecord
    ? [...historicalRecords, pendingDiscardRecord]
    : historicalRecords;
  const firstCompletionTurn = firstTargetCompletionTurn(completionRecords, targetIds);
  const publicationTurn = attempt?.recordTurn ?? current?.itemRecord?.turn ?? input.session.game.turn;
  const completionArrivalPublished = !isBeforeArrival;
  const goalGuidancePublished = firstCompletionTurn !== null && (
    firstCompletionTurn < publicationTurn || (firstCompletionTurn === publicationTurn && completionArrivalPublished)
  );
  const goalStationId = input.session.game.config.startStationId;
  const goalStationName = input.presentation.stationName(goalStationId);
  const goalGuidance: GoalGuidance | null = goalGuidancePublished && !(goal && completionArrivalPublished)
    ? { stationId: goalStationId, stationName: goalStationName, text: `${goalStationName}に着けばクリア` }
    : null;
  const markerBearing = displayedHeading(progress, ride, input.network);
  const arrivalText = isBeforeArrival || !current ? null : arrivalLogText(
    current.itemRecord?.turn ?? input.session.game.turn,
    current,
    completedCount,
    requiredCount,
    input.network,
    input.presentation,
  );
  const lotteryText = lotteryPublished && current
    ? landingText(current, input.network, input.presentation)
    : landingText(previousLastMove(input), input.network, input.presentation);
  const lotteryDisplayText = phase === "moving" ? "移動中…" : lotteryText;
  const candidateMove = lotteryPublished ? current : previousLastMove(input);
  const candidateRows = visibleCandidates(candidateMove, input.presentation);
  const candidateDrawSlotCount = candidateMove?.landing?.serviceCandidates.length ?? 0;
  const showClear = goal && isPublished;
  const liveView = input.itemView ?? null;
  const preMoveActive = Boolean(attempt && PRE_MOVE_STAGES.has(attempt.stage));
  const revealActive = input.revealStage !== "done" && input.revealStage !== "waiting";
  const active = !input.restoredOrOmitted && (preMoveActive || input.session.phase === "animating" || revealActive);
  // Ride results publish after lottery settle; item results have their own later pickup boundary when present.
  const resultPublished = isPublished;
  const turnResult = visibleTurnResult(input, lotteryPublished, resultPublished, targetIds);
  const originView = attempt?.origin.itemView ?? liveView;
  const observedRecord = input.session.lastMove?.itemRecord;
  const record = observedRecord && (!attempt || observedRecord.turn === attempt.recordTurn) ? observedRecord : null;
  const consumedIds = attempt?.stage === "released" && record?.kind === "item-ride"
    ? record.itemEvents.filter((event) => event.type === "consumed").map((event) => event.item.id) : [];
  const maskedView = resultPublished ? liveView : maskTurnMomentItemView(originView, liveView, consumedIds);
  // Once this attempt's record exists its staged draft is spent: the origin draft must not reappear (as
  // 「この内容でサイコロを振る」 or a staged summary) while the arrival is presented.
  const itemView = maskedView && liveView && record && maskedView !== liveView ? { ...maskedView, draft: liveView.draft } : maskedView;
  const decision = visibleDecision(liveView, attempt, active, resultPublished);
  const landings = visibleAdjustmentLandings(input, decision);
  const turn = record?.turn ?? input.session.game.turn;
  const effectTurn = resultPublished ? turn : attempt?.origin.turn ?? turn;
  const effectModels = itemView && phase !== "moving"
    ? effectChipModels(itemView.effects, effectTurn, input.network, input.presentation) : [];
  const showItemNotice = resultPublished && Boolean(record?.itemEvents.length);
  // Toasts wait for the movement to finish, exactly like the reveal's `ready` that GameApp used to check.
  const movementComplete = input.session.phase !== "animating";
  const itemToasts = resultPublished && movementComplete && input.session.lastMove && (!attempt || record)
    ? turnToasts(input.session.sessionId, input.session.lastMove, input.network, input.presentation) : [];
  // The milestone is public with the guidance (arrival); it precedes this turn's item events.
  const milestoneToasts = goalGuidance && firstCompletionTurn !== null && movementComplete
    ? [targetSegmentsMilestoneToast(input.session.sessionId, firstCompletionTurn, goalGuidance.stationName)] : [];
  const toastInputs = [...milestoneToasts, ...itemToasts];
  const canRoll = !active && input.session.phase === "idle" && input.session.game.status === "playing";
  const announcementStage = getAnnouncementStage(input, phase, showClear, decision);
  const baseAnnouncement = !liveView && input.restoredHistory ? ""
    : !liveView && !attempt && input.session.phase !== "idle" ? input.previousClassicAnnouncement ?? ""
    : !liveView && phase === "published" && current
      ? arrivalSummary(current.itemRecord?.turn ?? input.session.game.turn, current, completedCount, requiredCount, input.network, input.presentation)
      // A presented movement announces only what is public: the raw face and the stamped modifiers, never the
      // physical hops, unused pips or landing of the committed record.
      : liveView && phase === "moving" && attempt && current ? movementAnnouncement(current)
      // The goal banner announces the arrival only: ClearScreen owns the goal announcement once it replaces the panel.
      : liveView && (phase === "arrival" || phase === "segment-flash") && goal && current
        ? goalArrivalAnnouncement(current.itemRecord?.turn ?? input.session.game.turn, current, completedCount, requiredCount, input.network, input.presentation)
      // Attempt-less item mode, or an attempt whose moments are omitted (reduced motion, Skip, restored roll,
      // deadhead), is exactly P1 when no reveal runs: the real session phase decides the copy.
      : liveView && (phase === "moving" || ((!attempt || attempt.motionOmitted) && !revealActive && !showClear))
        ? itemTurnAnnouncement(input.session, liveView, completedCount, requiredCount, input.network, input.presentation)
        : turnMomentAnnouncement({ session: input.session, view: resultPublished ? liveView : itemView, decision,
          stage: announcementStage, canRoll, completedCount, requiredCount, network: input.network, presentation: input.presentation });
  // Announced once: while the arrival is presented, or at the publication of a turn that never presented it
  // (classic, reduced motion, Skip, or 演出 なし, which plans no arrival stage).
  const milestoneAnnounced = goalGuidance !== null && firstCompletionTurn === publicationTurn
    && firstCompletionTurn > (input.entryTurn ?? 0)
    && (phase === "arrival" || phase === "segment-flash"
      || (isPublished && (!liveView || input.restoredOrOmitted || attempt?.skipRequested === true
        || attempt?.policy.showImportantMoments === false)));
  const announcement = milestoneAnnounced && goalGuidance && baseAnnouncement
    ? `${baseAnnouncement.replace(/。$/, "")}。${goalGuidance.text}` : baseAnnouncement;
  const hasPublishedSummary = phase === "published" && current !== null && !showClear && (liveView
    ? input.session.phase !== "animating" && input.session.phase !== "committing" && input.session.phase !== "resolving" &&
      !liveView.draft.items.length && decision?.kind !== "adjust"
    : !input.restoredHistory && (attempt !== null || input.session.phase === "idle"));
  const summaryTurn = hasPublishedSummary ? current.itemRecord?.turn ?? input.session.game.turn : null;
  const clearAnnouncement = showClear && liveView
    ? itemTurnAnnouncement(input.session, liveView, completedCount, requiredCount, input.network, input.presentation, false) : "";
  const canSkip = input.session.phase === "animating" || (active && (preMoveActive || revealActive));
  const segmentFlash = turnSegmentFlash(input, phase, record, targetIds);

  return {
    phase,
    turn: isBeforeArrival ? attempt?.origin.turn ?? input.session.game.turn
      : current?.itemRecord?.turn ?? input.session.game.turn,
    progress,
    ride,
    markerBearing,
    goalGuidance,
    adjustmentLandings: landings,
    compactRoll,
    rollText,
    arrivalText,
    lotteryText,
    lotteryDisplayText,
    candidateRows,
    candidateDrawSlotCount,
    showClear,
    itemView,
    decision,
    effectModels,
    showItemNotice,
    itemNoticePublished: resultPublished,
    itemNoticeMove: resultPublished ? input.session.lastMove : null,
    announcement,
    summaryTurn,
    clearAnnouncement,
    toastInputs,
    canRoll,
    canSkip,
    itemUseLocked: active,
    segmentFlash,
    turnResult,
  };
}

/** The accepted new target features stay requested for the entire arrival or standalone flash stage. */
function turnSegmentFlash(
  input: TurnMomentDisplayInput,
  phase: TurnPublicationPhase,
  record: LastMove["itemRecord"] | null,
  targetIds: readonly string[],
): SegmentFlashRequest | null {
  const { attempt, revealKey } = input;
  if ((phase !== "arrival" && phase !== "segment-flash") || input.revealStage !== phase || !revealKey) return null;
  if (!attempt || attempt.sessionId !== input.session.sessionId || attempt.motionOmitted || attempt.skipRequested ||
    !attempt.policy.showImportantMoments || !record || record.turn !== attempt.recordTurn) return null;
  const featureIds = segmentFlashFeatureIds(input.network, targetIds, attempt.newlyCompletedTargetSegmentIds);
  if (featureIds.length === 0) return null;
  return { key: revealKey, featureIds, durationMs: attempt.policy.timing.flashMs };
}

const MOVING_ANNOUNCEMENT = "移動中です。スキップできます。";

/** Movement copy of a presented turn: raw face plus published modifier wording, then the movement wording. */
function movementAnnouncement(move: LastMove): string {
  const record = move.itemRecord;
  if (move.stopReason === "relocation" || record?.kind === "deadhead") return `回送列車で移動します。${MOVING_ANNOUNCEMENT}`;
  if (record?.kind !== "item-ride") return move.roll === null ? MOVING_ANNOUNCEMENT : `出目は${move.roll}です。${MOVING_ANNOUNCEMENT}`;
  const compact = compactRollText(compactRollFor(move));
  const roll = compact === `${record.rawRoll}マス` ? String(record.rawRoll) : `${record.rawRoll}、${compact}`;
  return `出目は${roll}です。${MOVING_ANNOUNCEMENT}`;
}

/** Arrival wording of the goal banner, without the goal sentence that ClearScreen announces next. */
function goalArrivalAnnouncement(
  turn: number, move: LastMove, completedCount: number, requiredCount: number,
  network: RailwayNetwork, presentation: PresentationResolver,
): string {
  return `${turn}ターン目：${stationName(network, move.stopStationId, presentation)}に到着。踏破 ${completedCount}/${requiredCount}`;
}

type AnnouncementStage = Parameters<typeof turnMomentAnnouncement>[0]["stage"];

function getAnnouncementStage(
  input: TurnMomentDisplayInput,
  phase: TurnPublicationPhase,
  showClear: boolean,
  decision: ItemSessionView["decision"],
): AnnouncementStage {
  if (showClear) return "goal";
  if (input.session.phase === "awaiting-adjust" && decision?.kind === "adjust") return "awaiting-adjust";
  if (input.restoredOrOmitted) return "restored";
  if (input.attempt?.stage === "waiting-roll") return "waiting-roll";
  if (input.attempt?.stage === "tumble") return "tumble";
  if (input.attempt?.stage === "awaiting-adjust") return "awaiting-adjust";
  if (input.attempt?.stage === "waiting-record" || input.session.phase === "committing" || input.session.phase === "resolving") return "waiting-record";
  if (input.attempt?.stage === "stamps") return "stamps";
  if (phase === "moving") return "movement";
  if (input.revealStage === "arrival" || input.revealStage === "segment-flash" || input.revealStage === "waiting") return "arrival";
  if (input.revealStage === "lottery-flip") return "lottery-flip";
  if (input.revealStage === "lottery-settle") return "lottery-settle";
  if (input.revealStage === "pickup") return "pickup";
  if (input.revealStage === "done" && hasPickup(input.session.lastMove)) return "pickup-done";
  return "ready";
}

function hasPickup(move: LastMove | null): boolean {
  return move?.itemRecord?.kind === "item-ride" && move.itemRecord.itemEvents.some((event) =>
    event.type === "pickup-retained" || event.type === "pickup-pending-discard");
}
