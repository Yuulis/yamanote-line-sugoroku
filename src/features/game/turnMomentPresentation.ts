import type { Direction } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import { platformPosition, targetSegmentIds } from "./engine";
import type { DisplayedProgress } from "./animation/displayedProgress";
import type { TurnRevealStageKey, RollAttempt } from "./animation/turnMoments";
import type { GameSession, LastMove } from "./gameSession";
import { compactRollFor, compactRollText, effectChipModels, type EffectChipModel } from "./hudPresentation";
import { arrivalLogText, arrivalSummary, displayedRide, itemTurnAnnouncement, landingText, lastRollText, turnMomentAnnouncement } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";
import type { ItemSessionView } from "./itemSession";
import { turnToasts, type ToastInput } from "./toastQueue";
import { maskTurnMomentItemView } from "./turnMomentItems";

export type TurnPublicationPhase = "pre-move" | "moving" | "arrival" | "lottery-flip" | "lottery-settle" | "pickup" | "published";
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
}

/** Shared gameplay values and permissions; visual moment models are added in later steps. */
export interface TurnMomentDisplay {
  phase: TurnPublicationPhase;
  turn: number;
  progress: DisplayedProgress;
  ride: Readonly<{ serviceId: string; direction: Direction }>;
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
  clearAnnouncement: string;
  toastInputs: readonly ToastInput[];
  canRoll: boolean;
  canSkip: boolean;
  itemUseLocked: boolean;
}

const PRE_MOVE_STAGES = new Set<RollAttempt["stage"]>(["waiting-roll", "tumble", "awaiting-adjust", "waiting-record", "stamps"]);

function publicationPhase(input: TurnMomentDisplayInput): TurnPublicationPhase {
  if (input.restoredOrOmitted) return "published";
  if (input.attempt && PRE_MOVE_STAGES.has(input.attempt.stage)) return "pre-move";
  if (input.session.phase === "animating") return "moving";
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

function visibleCandidates(move: LastMove | null, presentation: PresentationResolver): PresentationCandidateRow[] {
  if (!move?.landing || (!move.landing.serviceDrawRequired && !move.landing.directionDrawRequired)) return [];
  return presentation.candidateRows(move.landing.serviceCandidates);
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
  const goal = input.session.game.status === "completed";
  const showClear = goal && isPublished;
  const liveView = input.itemView ?? null;
  const preMoveActive = Boolean(attempt && PRE_MOVE_STAGES.has(attempt.stage));
  const revealActive = input.revealStage !== "done" && input.revealStage !== "waiting";
  const active = !input.restoredOrOmitted && (preMoveActive || input.session.phase === "animating" || revealActive);
  const resultPublished = isPublished;
  const originView = attempt?.origin.itemView ?? liveView;
  const observedRecord = input.session.lastMove?.itemRecord;
  const record = observedRecord && (!attempt || observedRecord.turn === attempt.recordTurn) ? observedRecord : null;
  const consumedIds = attempt?.stage === "released" && record?.kind === "item-ride"
    ? record.itemEvents.filter((event) => event.type === "consumed").map((event) => event.item.id) : [];
  const itemView = resultPublished ? liveView : maskTurnMomentItemView(originView, liveView, consumedIds);
  const decision = visibleDecision(liveView, attempt, active, resultPublished);
  const turn = record?.turn ?? input.session.game.turn;
  const effectTurn = resultPublished ? turn : attempt?.origin.turn ?? turn;
  const effectModels = itemView && phase !== "moving"
    ? effectChipModels(itemView.effects, effectTurn, input.network, input.presentation) : [];
  const showItemNotice = resultPublished && Boolean(record?.itemEvents.length);
  const toastInputs = resultPublished && input.session.lastMove && (!attempt || record)
    ? turnToasts(input.session.sessionId, input.session.lastMove, input.network, input.presentation) : [];
  const canRoll = !active && input.session.phase === "idle" && input.session.game.status === "playing";
  const announcementStage = getAnnouncementStage(input, phase, showClear, decision);
  const announcement = !liveView && input.restoredHistory ? ""
    : !liveView && !attempt && input.session.phase !== "idle" ? input.previousClassicAnnouncement ?? ""
    : !liveView && phase === "published" && current
      ? arrivalSummary(current.itemRecord?.turn ?? input.session.game.turn, current, completedCount, requiredCount, input.network, input.presentation)
      // Attempt-less item mode (no P2 sequence running) is exactly P1: the real session phase decides the copy.
      : liveView && (phase === "moving" || (!attempt && !revealActive && !showClear))
        ? itemTurnAnnouncement(input.session, liveView, completedCount, requiredCount, input.network, input.presentation)
        : turnMomentAnnouncement({ session: input.session, view: resultPublished ? liveView : itemView, decision,
          stage: announcementStage, canRoll, completedCount, requiredCount, network: input.network, presentation: input.presentation });
  const clearAnnouncement = showClear && liveView
    ? itemTurnAnnouncement(input.session, liveView, completedCount, requiredCount, input.network, input.presentation, false) : "";
  const canSkip = input.session.phase === "animating" || (active && (preMoveActive || revealActive));

  return {
    phase,
    turn: isBeforeArrival ? attempt?.origin.turn ?? input.session.game.turn
      : current?.itemRecord?.turn ?? input.session.game.turn,
    progress,
    ride,
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
    clearAnnouncement,
    toastInputs,
    canRoll,
    canSkip,
    itemUseLocked: active,
  };
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
  if (input.revealStage === "arrival" || input.revealStage === "waiting") return "arrival";
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
