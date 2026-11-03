import type { Direction } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import { platformPosition, targetSegmentIds } from "./engine";
import type { DisplayedProgress } from "./animation/displayedProgress";
import type { TurnRevealStageKey, RollAttempt } from "./animation/turnMoments";
import type { GameSession, LastMove } from "./gameSession";
import { compactRollFor, compactRollText } from "./hudPresentation";
import { arrivalLogText, displayedRide, landingText, lastRollText } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";

export type TurnPublicationPhase = "pre-move" | "moving" | "arrival" | "lottery-flip" | "lottery-settle" | "published";
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
}

/** The S3-owned portion of the shared display model. Later steps extend this interface. */
export interface TurnMomentDisplay {
  phase: TurnPublicationPhase;
  turn: number;
  progress: DisplayedProgress;
  ride: Readonly<{ serviceId: string; direction: Direction }>;
  compactRoll: string;
  rollText: string;
  arrivalText: string | null;
  lotteryText: string;
  candidateRows: readonly PresentationCandidateRow[];
  showClear: boolean;
}

const PRE_MOVE_STAGES = new Set<RollAttempt["stage"]>(["waiting-roll", "tumble", "awaiting-adjust", "waiting-record", "stamps"]);

function publicationPhase(input: TurnMomentDisplayInput): TurnPublicationPhase {
  if (input.restoredOrOmitted) return "published";
  if (input.attempt && PRE_MOVE_STAGES.has(input.attempt.stage)) return "pre-move";
  if (input.session.phase === "animating") return "moving";
  if (input.revealStage === "lottery-flip") return "lottery-flip";
  if (input.revealStage === "lottery-settle") return "lottery-settle";
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
  return phase === "pre-move" || phase === "moving" ? previousLastMove(input) : input.session.lastMove;
}

function visibleProgress(input: TurnMomentDisplayInput, phase: TurnPublicationPhase): DisplayedProgress {
  if (phase === "pre-move") return originProgress(input);
  if (phase === "moving") return input.progress;
  if (phase === "arrival" || phase === "lottery-flip" || phase === "lottery-settle") return arrivalProgress(input);
  return input.progress;
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
  const progress = visibleProgress(input, phase);
  const ride = isPublished ? displayedRide(input.session)
    : isBeforeArrival ? input.attempt?.origin.ride ?? (current
      ? { serviceId: current.serviceId, direction: current.direction }
      : displayedRide(input.session))
      : current ? { serviceId: current.serviceId, direction: current.direction }
        : input.attempt?.origin.ride ?? displayedRide(input.session);
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
  const lotteryPublished = isPublished;
  const lotteryText = lotteryPublished && current
    ? landingText(current, input.network, input.presentation)
    : landingText(previousLastMove(input), input.network, input.presentation);
  const candidateRows = lotteryPublished
    ? visibleCandidates(current, input.presentation)
    : visibleCandidates(previousLastMove(input), input.presentation);
  const goal = input.session.game.status === "completed";
  const showClear = goal && isPublished;

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
    candidateRows,
    showClear,
  };
}
