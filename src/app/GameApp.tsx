import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { RailwayData } from "../data/loaders";
import { displayedProgress, sessionProgress } from "../features/game/animation/displayedProgress";
import { buildGeometryIndex } from "../features/game/animation/movePath";
import { useMoveAnimation } from "../features/game/animation/useMoveAnimation";
import { ClearScreen } from "../features/game/components/ClearScreen";
import { ConfirmDialog } from "../features/game/components/ConfirmDialog";
import { GamePanel, type PanelOpenRules } from "../features/game/components/GamePanel";
import { isFocusRestorable, RulesDialog } from "../features/game/components/RulesDialog";
import { FirstPlayCoach, type FirstPlayCoachCloseReason } from "../features/game/components/FirstPlayCoach";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { type RailwayNetwork, isItemSave, targetSegmentIds } from "../features/game/engine";
import {
  ANIMATION_SPEEDS,
  type AnimationSpeedId,
} from "../features/game/gameConfig";
import type { Edition } from "../features/editions/types";
import type { EditionId, EditionRegistry } from "../features/editions/types";
import { getBrowserStorage } from "../features/game/store/browserStorage";
import { useGameApp } from "../features/game/useGameApp";
import { useGameSettings } from "../features/game/useGameSettings";
import { usePrefersReducedMotion } from "../features/game/usePrefersReducedMotion";
import { ItemEventNotice } from "../features/game/components/ItemEventNotice";
import { deriveTurnMomentDisplay } from "../features/game/turnMomentPresentation";
import type { TurnMomentDisplay, TurnRevealState } from "../features/game/turnMomentPresentation";
import type { RollAttempt, TurnMomentObservation, TurnOrigin } from "../features/game/animation/turnMoments";
import { attemptOwnsAnimation, useTurnMoments } from "../features/game/animation/useTurnMoments";
import { ArrivalBanner, TurnMomentHost, turnMomentArrivalModel, turnMomentDiceModel } from "../features/game/components/TurnMomentHost";
import { DiceTumble } from "../features/game/components/DiceTumble";
import type { AppState, GameSession } from "../features/game/gameSession";
import {
  buildCoachSteps,
  isFirstPlayEligible,
  type CoachStep,
  type GuideCandidate,
} from "../features/game/firstPlayGuide";
import {
  readFirstTurnNoticeForGuide,
  readGuideStarted,
  writeGuideCoachSeen,
  writeGuideStarted,
} from "../features/game/store/guide";
import { useFirstPlayGuide } from "../features/game/useFirstPlayGuide";
import { createPresentationResolver } from "../features/game/presentationResolver";
import { directionLabel, serviceName, stationName } from "../features/game/presentation";
import { buildRulesGuide, type RulesSectionId } from "../features/game/rulesGuide";
import { type MapFollow, type RailwayMapMode, RailwayMap } from "../features/map/RailwayMap";
import type { MapProgress } from "../features/map/railwayLayers";
import type { GameState, ItemRollAdjustment, ItemTurnCommand, LineMetadata } from "../types/network";
import { trackEvent } from "../features/analytics/analytics";
import { readSave, type SaveLookup } from "../features/game/store/persistence";
import { hasGameProgress } from "../features/game/gameSession";
import { overwriteProgressText } from "../features/game/resumePresentation";
import { summarizeGame } from "../features/game/gameSummary";
import { ToastHost } from "../features/game/components/ToastHost";
import type { ToastInput } from "../features/game/toastQueue";
import { useFirstTurnNotice } from "../features/game/useFirstTurnNotice";
import type { NoticeAnnouncementCopy, SelectedNoticeAnnouncement } from "../features/game/saveNotice";

interface GameAppProps {
  data: RailwayData;
  network: RailwayNetwork;
  edition: Edition;
  picker: {
    editions: EditionRegistry;
    editionId: EditionId;
    onEditionChange: (id: EditionId) => void;
    focusPicker: boolean;
    onPickerFocusRestored: () => void;
  };
  /** One-shot title focus carried from rules opened during edition loading. */
  initialTitleFocus?: "rules-trigger";
  /** Narrow input seam for mounted publication-boundary tests; production leaves it unset. */
  turnMomentBoundary?: Readonly<{ attempt: RollAttempt | null; revealStage: TurnRevealState; restoredOrOmitted: boolean }>;
}

type PendingConfirm = { kind: "new-game"; message: string } | { kind: "delete-save" } | null;

interface RulesRequest {
  readonly sectionId?: RulesSectionId;
  readonly returnFocus: HTMLElement | null;
  readonly getFallbackFocus: () => HTMLElement | null;
}

export interface FirstPlayCoachReplayAvailability {
  readonly sessionId: number | null;
  readonly panelShown: boolean;
  readonly gameStatus: GameState["status"] | null;
  readonly turnCanRoll: boolean;
  readonly pendingDecision: boolean;
  readonly itemUseDialogOpen: boolean;
  readonly confirmationOpen: boolean;
  readonly showClear: boolean;
}

export function isFirstPlayCoachReplayAllowed(state: FirstPlayCoachReplayAvailability): boolean {
  return state.sessionId !== null
    && state.panelShown
    && state.gameStatus === "playing"
    && state.turnCanRoll
    && !state.pendingDecision
    && !state.itemUseDialogOpen
    && !state.confirmationOpen
    && !state.showClear;
}

const NO_PROGRESS: MapProgress = { completedFeatureIds: [], currentPosition: null };
const NO_LINES: readonly LineMetadata[] = [];
const NO_MOVE_EVENTS: TurnMomentObservation["movementEvents"] = [];
const NO_TOAST_INPUTS: readonly ToastInput[] = [];
const NO_GUIDE_CANDIDATES: readonly GuideCandidate[] = [];
/** Phases in which `lastMove` still describes the previous turn: the current record is not yet save-attempted. */
const PRE_RECORD_PHASES: ReadonlySet<GameSession["phase"]> = new Set(["committing", "awaiting-adjust", "resolving"]);

/** Toast keys of the record a session was entered with; they are never shown (no replay on resume). */
interface ToastBaseline {
  /** `undefined` before the first session observation, so the first effect always captures one. */
  sessionId: number | null | undefined;
  keys: ReadonlySet<string>;
}

interface FirstPlayGuideSession {
  readonly sessionId: number;
  readonly entryTurn: number;
}

interface FirstPlayCoachRuntimeState {
  readonly autoGuideSessionId: number | null;
  readonly currentSessionId: number | null;
  readonly replaySessionId: number | null;
  readonly open: boolean;
  readonly completed: boolean;
}

const NO_TOAST_BASELINE: ToastBaseline = { sessionId: undefined, keys: new Set() };

function nextSessionId(state: AppState): number {
  return state.screen === "title" ? state.lastSessionId + 1 : state.session.sessionId + 1;
}

function speedById(id: AnimationSpeedId) {
  return ANIMATION_SPEEDS.find((speed) => speed.id === id) ?? ANIMATION_SPEEDS[1];
}

/** Title, play and clear screens over one persistent map. */
export function GameApp({ data, network, edition, picker, turnMomentBoundary, initialTitleFocus }: GameAppProps): React.JSX.Element {
  const [pendingInitialTitleFocus, setPendingInitialTitleFocus] = useState(initialTitleFocus);
  const consumeInitialTitleFocus = useCallback((): void => setPendingInitialTitleFocus(undefined), []);
  const storage = useMemo(getBrowserStorage, []);
  const uiPresentation = data.manifest.ok ? data.manifest.value.uiPresentation : undefined;
  const presentation = useMemo(
    () => createPresentationResolver(network, uiPresentation),
    [network, uiPresentation],
  );
  const config = edition.config;
  const app = useGameApp(network, storage, config, edition.saveKey);
  const existingSaveObserved = useRef(false);
  const guideStartedInMemory = useRef(false);
  const [firstPlayGuideSession, setFirstPlayGuideSession] = useState<FirstPlayGuideSession | null>(null);
  const [firstPlayCoachClosedSessionId, setFirstPlayCoachClosedSessionId] = useState<number | null>(null);
  const [firstPlayCoachReplaySessionId, setFirstPlayCoachReplaySessionId] = useState<number | null>(null);
  const firstPlayCoachClosedSessionInMemory = useRef<number | null>(null);
  const firstPlayCoachSeenSessionInMemory = useRef<number | null>(null);
  const firstPlayCoachRuntime = useRef<FirstPlayCoachRuntimeState>({
    autoGuideSessionId: null,
    currentSessionId: null,
    replaySessionId: null,
    open: false,
    completed: false,
  });
  if (app.saveAttempt?.result === "saved") {
    existingSaveObserved.current = true;
  }
  if (app.saveLookup && (app.saveLookup.kind === "valid" || app.saveLookup.kind === "invalid")) {
    existingSaveObserved.current = true;
  }
  const reducedMotion = usePrefersReducedMotion();
  const rideTarget = useRef<HTMLElement>(null);
  const directionTarget = useRef<HTMLElement>(null);
  const inventorySlot0Target = useRef<HTMLElement>(null);
  const inventorySlot1Target = useRef<HTMLElement>(null);
  const inventorySlot2Target = useRef<HTMLElement>(null);
  const inventoryHeaderTarget = useRef<HTMLElement>(null);
  const coachDiceTarget = useRef<HTMLElement>(null);
  const coachProgressTarget = useRef<HTMLElement>(null);
  const coachMapTarget = useRef<HTMLElement>(null);
  const coachTargets = useMemo<Partial<Record<CoachStep, RefObject<HTMLElement | null>>>>(() => ({
    dice: coachDiceTarget,
    progress: coachProgressTarget,
    map: coachMapTarget,
  }), []);
  const turnMomentTargets = useMemo(() => ({ ride: rideTarget, direction: directionTarget,
    slots: [inventorySlot0Target, inventorySlot1Target, inventorySlot2Target], inventoryHeader: inventoryHeaderTarget }), []);
  const { settings: { speedId, follow, presentationLevel }, cycleSpeed, cyclePresentation, toggleFollow, stopFollowing } = useGameSettings(storage);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstTurnNoticeAnnouncement, setFirstTurnNoticeAnnouncement] = useState<NoticeAnnouncementCopy | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [rulesRequest, setRulesRequest] = useState<RulesRequest | null>(null);
  const openRules = useCallback<PanelOpenRules>((sectionId, returnFocus, getFallbackFocus) => {
    setRulesRequest({ sectionId, returnFocus, getFallbackFocus });
  }, []);
  const closeRules = useCallback(() => setRulesRequest(null), []);

  const geometry = useMemo(
    () => buildGeometryIndex(data.geometry.ok ? data.geometry.value : undefined),
    [data],
  );
  const requiredIds = useMemo(
    () => new Set(targetSegmentIds(edition.config, network)),
    [edition.config, network],
  );
  const rulesModel = useMemo(() => buildRulesGuide(edition.config, {
    targetSegmentCount: requiredIds.size,
    targetServiceName: serviceName(network, edition.config.targetServiceId, presentation),
    startStationName: stationName(network, edition.config.startStationId, presentation),
    targetDirectionLabel: directionLabel(network, edition.config.targetServiceId, edition.config.targetDirection),
  }), [edition.config, network, presentation, requiredIds]);
  const session = app.state.screen === "game" ? app.state.session : null;
  const game = session?.game ?? null;
  const activeFirstPlayGuideSession = firstPlayGuideSession !== null
    && firstPlayGuideSession.sessionId === session?.sessionId
    && game !== null && game.turn >= firstPlayGuideSession.entryTurn
    ? firstPlayGuideSession : null;
  const automaticFirstPlayCoachOpen = activeFirstPlayGuideSession !== null
    && game?.status === "playing"
    && firstPlayCoachClosedSessionId !== activeFirstPlayGuideSession.sessionId
    && firstPlayCoachClosedSessionInMemory.current !== activeFirstPlayGuideSession.sessionId;
  const firstPlayCoachOpen = game?.status === "playing"
    && (automaticFirstPlayCoachOpen || firstPlayCoachReplaySessionId === session?.sessionId);
  firstPlayCoachRuntime.current = {
    autoGuideSessionId: activeFirstPlayGuideSession?.sessionId ?? null,
    currentSessionId: session?.sessionId ?? null,
    replaySessionId: firstPlayCoachReplaySessionId,
    open: firstPlayCoachOpen,
    completed: game?.status === "completed",
  };
  const coachSteps = useMemo(() => buildCoachSteps({
    config,
    targetName: serviceName(network, config.targetServiceId, presentation),
    startName: stationName(network, config.startStationId, presentation),
  }), [config, network, presentation]);
  const onFirstPlayCoachShown = useCallback((): void => {
    const current = firstPlayCoachRuntime.current;
    const isReplay = current.replaySessionId !== null && current.replaySessionId === current.currentSessionId;
    if (!current.open || isReplay) return;
    if (current.autoGuideSessionId === null || current.currentSessionId !== current.autoGuideSessionId
      || current.completed || typeof document === "undefined" || document.visibilityState !== "visible"
      || firstPlayCoachSeenSessionInMemory.current === current.autoGuideSessionId) return;
    firstPlayCoachSeenSessionInMemory.current = current.autoGuideSessionId;
    writeGuideCoachSeen(storage);
  }, [storage]);
  const closeFirstPlayCoach = useCallback((_reason: FirstPlayCoachCloseReason): void => {
    const current = firstPlayCoachRuntime.current;
    const sessionId = current.currentSessionId;
    if (!current.open || sessionId === null || current.completed) return;
    firstPlayCoachClosedSessionInMemory.current = sessionId;
    if (current.autoGuideSessionId === sessionId) setFirstPlayCoachClosedSessionId(sessionId);
    if (current.replaySessionId === sessionId) setFirstPlayCoachReplaySessionId(null);
  }, []);
  const restoreFirstPlayCoachFocus = useCallback((): void => {
    const current = firstPlayCoachRuntime.current;
    const sessionId = current.currentSessionId;
    if (sessionId === null || current.completed || firstPlayCoachClosedSessionInMemory.current !== sessionId) return;
    const dice = document.querySelector<HTMLElement>(".game-panel__roll");
    const heading = document.querySelector<HTMLElement>(".game-panel__title");
    const target = [dice, heading].find((candidate) =>
      isFocusRestorable(candidate, { allowAriaDisabled: true }));
    target?.focus({ preventScroll: true });
  }, []);
  useFirstPlayGuide({
    sessionId: activeFirstPlayGuideSession?.sessionId ?? null,
    candidates: NO_GUIDE_CANDIDATES,
    storage,
    obscured: firstPlayCoachOpen,
    showClear: game?.status === "completed",
  });
  const speed = speedById(speedId);
  const itemView = app.itemView;
  // Item mode only: the attempt snapshot of what is on screen when the roll is accepted.
  const turnOrigin = useMemo<TurnOrigin | null>(() => session && itemView ? {
    stationId: session.game.currentStationId,
    ride: { serviceId: session.game.currentServiceId, direction: session.game.direction },
    completedSegmentIds: session.game.completedSegmentIds,
    turn: session.game.turn,
    itemView,
    previousLastMove: session.lastMove,
  } : null, [session, itemView]);
  const animation = session?.animation ?? null;
  // The current turn's record exists for presentation only once its save was attempted.
  const acceptedRecord = session && !PRE_RECORD_PHASES.has(session.phase) ? session.lastMove?.itemRecord ?? null : null;
  // Entry baseline: the turn and record the session was entered with. Records up to it are restored, never revealed.
  const resumeBaseline = useRef<{ sessionId: number | null; turn: number; recordTurn: number } | null>(null);
  if (resumeBaseline.current?.sessionId !== (session?.sessionId ?? null)) {
    resumeBaseline.current = { sessionId: session?.sessionId ?? null, turn: game?.turn ?? 0,
      recordTurn: session?.lastMove?.itemRecord?.turn ?? 0 };
  }
  const latestRecord = session?.lastMove?.itemRecord ?? null;
  const entryTurn = Math.max(resumeBaseline.current.turn, resumeBaseline.current.recordTurn);
  const moments = useTurnMoments({
    sessionId: session?.sessionId ?? 0,
    gameTurn: game?.turn ?? 0,
    decisionRevision: session?.item?.decisionRevision ?? 0,
    origin: turnOrigin,
    speedId,
    presentationLevel,
    reducedMotion,
    observation: {
      decision: itemView?.decision ?? null,
      // Read-only use: the reducer never mutates the observed record.
      record: acceptedRecord as TurnMomentObservation["record"],
      movementEvents: animation?.events ?? NO_MOVE_EVENTS,
      // While animating, the animation and lastMove come from the same save attempt (a pending discard animates
      // under the prior engine turn), so the movement belongs to the accepted record's turn.
      movementSessionId: animation?.sessionId,
      movementTurn: animation && acceptedRecord ? acceptedRecord.turn : undefined,
      targetServiceId: game?.config.targetServiceId ?? "",
    },
    revealObservation: {
      sessionId: session?.sessionId ?? 0,
      recordTurn: session?.lastMove?.itemRecord?.turn ?? null,
      gameTurn: game?.turn ?? 0,
      pendingDecisionTurn: itemView?.decision ? game?.turn ?? null : null,
      movementComplete: session?.phase !== "animating",
    },
    latestRecord,
    restoredRecord: latestRecord !== null && latestRecord.turn <= entryTurn,
    suppressRevealStages: turnMomentBoundary !== undefined,
    segmentFlashGeometry: { segmentsById: network.segmentsById, targetSegmentIds: [...requiredIds] },
    animation,
    finishAnimation: app.finishAnimation,
  });
  const reveal = moments.reveal;
  const liveAttempt = moments.attempt;
  const presentedAttempt = turnMomentBoundary ? turnMomentBoundary.attempt : liveAttempt;
  const toastSessionId = session?.sessionId ?? null;
  const toastBaseline = useRef<ToastBaseline>(NO_TOAST_BASELINE);
  const processedToastInputs = useRef<readonly ToastInput[] | null>(null);
  const [acceptedToastInputs, setAcceptedToastInputs] = useState<readonly ToastInput[]>([]);
  const presentationGame = useMemo(() => session ? sessionProgress(session) : null, [session]);
  const titleSave: SaveLookup | null = app.saveLookup?.kind === "valid"
    ? { kind: "valid", game: isItemSave(app.saveLookup.game)
      ? { ...app.saveLookup.game, movementHistory: [] } : app.saveLookup.game }
    : app.saveLookup;
  const resumeSaved = useCallback((saved: GameState) => {
    setFirstPlayGuideSession(null);
    setFirstPlayCoachReplaySessionId(null);
    app.resume(app.saveLookup?.kind === "valid" ? app.saveLookup.game : saved);
  }, [app.resume, app.saveLookup]);
  // The attempt's movement runs at the speed captured with its roll and only once its pre-move moment released it.
  const ownsAnimation = attemptOwnsAnimation(liveAttempt, animation);
  // Reduced motion seen at any point of the attempt finishes its movement instantly, even if turned off again since.
  const stepMs = reducedMotion || (ownsAnimation && moments.attemptMotionReduced) ? 0
    : ownsAnimation && liveAttempt ? liveAttempt.policy.timing.stepMs : speed?.stepMs ?? 0;
  const { view, livePosition } = useMoveAnimation(
    animation,
    network,
    geometry,
    stepMs,
    app.finishAnimation,
    { startAllowed: !ownsAnimation || moments.movementStartAllowed },
  );
  const shown = useMemo(
    () => (presentationGame ? displayedProgress(presentationGame, network, view) : null),
    [presentationGame, network, view],
  );
  const classicAnnouncement = useRef({ sessionId: session?.sessionId, text: "" });
  if (classicAnnouncement.current.sessionId !== session?.sessionId) {
    classicAnnouncement.current = { sessionId: session?.sessionId, text: "" };
  }
  const restoredHistory = (game?.turn ?? 0) <= (resumeBaseline.current?.turn ?? 0);
  // The record the session was entered with stays published, until an attempt for a newer turn takes over.
  const baselineTurn = resumeBaseline.current?.turn ?? 0;
  const restoredRecordShown = reveal.key !== null && Number(reveal.key.split(":").at(-1)) <= baselineTurn
    && !(liveAttempt !== null && liveAttempt.recordTurn > baselineTurn);
  const presentedRevealStage: TurnRevealState = turnMomentBoundary?.revealStage ?? moments.revealStage;
  const turnDisplay = useMemo(() => session && shown ? deriveTurnMomentDisplay({
    session,
    network,
    presentation,
    progress: shown,
    attempt: presentedAttempt,
    revealStage: presentedRevealStage,
    restoredOrOmitted: turnMomentBoundary?.restoredOrOmitted ?? (moments.restoredOrOmitted || restoredRecordShown),
    itemView,
    restoredHistory,
    previousClassicAnnouncement: classicAnnouncement.current.text,
    revealKey: reveal.key,
    entryTurn,
  }) : null, [session, shown, network, presentation, turnMomentBoundary, presentedAttempt, presentedRevealStage, moments.restoredOrOmitted, restoredRecordShown, itemView, restoredHistory, reveal.key, entryTurn]);
  if (!itemView && turnDisplay && session?.phase === "idle" && !restoredHistory) {
    classicAnnouncement.current.text = turnDisplay.announcement;
  }
  // Presented permissions, read at call time so a direct or stale invocation cannot bypass them.
  const turnDisplayRef = useRef<TurnMomentDisplay | null>(null);
  turnDisplayRef.current = turnDisplay;
  const toastInputs = turnDisplay?.toastInputs ?? NO_TOAST_INPUTS;
  useEffect(() => {
    if (toastBaseline.current.sessionId !== toastSessionId) {
      toastBaseline.current = {
        sessionId: toastSessionId,
        keys: new Set(toastInputs.map((input) => input.key)),
      };
      processedToastInputs.current = toastInputs;
      setAcceptedToastInputs([]);
      setItemDialogOpen(false);
      return;
    }
    if (toastInputs !== processedToastInputs.current) {
      processedToastInputs.current = toastInputs;
      setAcceptedToastInputs(toastInputs.filter((input) => !toastBaseline.current.keys.has(input.key)));
    }
  }, [toastSessionId, toastInputs]);
  const progress = useMemo<MapProgress>(
    () =>
      turnDisplay
        ? {
            completedFeatureIds: turnDisplay.progress.completedSegmentIds.filter((id) => requiredIds.has(id)).flatMap(
              (id) => network.segmentsById.get(id)!.geometryFeatureIds,
            ),
            currentPosition: turnDisplay.progress.position,
            highlightedServiceId: turnDisplay?.ride.serviceId,
          }
        : NO_PROGRESS,
    [requiredIds, network, turnDisplay],
  );

  const animating = session?.phase === "animating";
  const mapFollow = useMemo<MapFollow>(
    () => ({
      // Keep the fitted network overview until the first move. The turn-0
      // marker is already visible; recentering it would hide the network
      // behind the phone panel immediately after starting a game.
      enabled: follow && game !== null && game.turn > 0,
      immediate: reducedMotion || animating,
      onUserCameraMove: stopFollowing,
    }),
    [follow, game, reducedMotion, animating, stopFollowing],
  );

  // Callbacks passed to the memoised panel keep their identity between turns.
  const { newGame, saveLookup, finishAnimation, showTitle: showTitleScreen, roll, editItemDraft, adjustItemRoll, discardItem } = app;
  const { begin: beginTurnMoment, skip: skipTurnMoment } = moments;
  // One accepted handler begins the presentation attempt (capturing timing and movement speed) and commits the roll.
  const guardedRoll = useCallback(() => {
    if (firstPlayCoachOpen || !turnDisplayRef.current?.canRoll) return;
    beginTurnMoment("click");
    roll();
  }, [roll, beginTurnMoment, firstPlayCoachOpen]);
  const guardedEditItemDraft = useCallback((command: ItemTurnCommand) => {
    const presented = turnDisplayRef.current;
    if (presented && !presented.itemUseLocked) editItemDraft(command);
  }, [editItemDraft]);
  const guardedAdjustItemRoll = useCallback((adjustment: ItemRollAdjustment | null) => {
    if (turnDisplayRef.current?.decision?.kind === "adjust") adjustItemRoll(adjustment);
  }, [adjustItemRoll]);
  const guardedDiscardItem = useCallback((instanceId: string) => {
    if (turnDisplayRef.current?.decision?.kind === "discard") discardItem(instanceId);
  }, [discardItem]);
  const startNewGame = useCallback(() => {
    setConfirm(null);
    setNotice(null);
    setFirstPlayCoachReplaySessionId(null);
    const saveLookups = picker.editions.map((knownEdition) =>
      readSave(storage, network, config, knownEdition.saveKey).kind,
    );
    if (saveLookups.some((kind) => kind === "valid" || kind === "invalid")) {
      existingSaveObserved.current = true;
    }
    const eligible = isFirstPlayEligible({
      resumed: false,
      existingSaveObserved: existingSaveObserved.current,
      saveLookups,
      firstTurnNotice: readFirstTurnNoticeForGuide(storage),
      guideStarted: readGuideStarted(storage),
      startedInMemory: guideStartedInMemory.current,
    });
    const nextId = nextSessionId(app.state);
    const binding: FirstPlayGuideSession | null = eligible ? { sessionId: nextId, entryTurn: 0 } : null;
    if (eligible) {
      guideStartedInMemory.current = true;
      writeGuideStarted(storage);
    }
    newGame();
    setFirstPlayGuideSession(binding);
  }, [app.state, config, newGame, network, picker.editions, storage]);

  const requestNewGame = useCallback(() => {
    const saved = saveLookup?.kind === "valid" ? saveLookup.game : null;
    const current = game ?? saved;
    if (current?.status === "playing" && hasGameProgress(current)) {
      const message = game
        ? "現在のゲームを終了して新しく始めますか？今の進行は上書きされます。"
        : `保存中のゲーム（${overwriteProgressText(current)}）は上書きされます。はじめから始めますか？`;
      setConfirm({ kind: "new-game", message });
      return;
    }
    startNewGame();
  }, [saveLookup, game, startNewGame]);

  const deleteSaveConfirmed = () => {
    setConfirm(null);
    setNotice(app.removeSave() ? "セーブデータを削除しました。" : "セーブデータを削除できませんでした。");
  };

  const currentAnimationRef = useRef(animation);
  currentAnimationRef.current = animation;
  // The one shared Skip (panel, card tap, adjustment dialog): ends tumble, stamps, movement and reveal together.
  const skip = useCallback(() => {
    if (firstPlayCoachOpen || !turnDisplayRef.current?.canSkip) return;
    skipTurnMoment();
    const current = currentAnimationRef.current;
    if (current) finishAnimation(current);
  }, [finishAnimation, skipTurnMoment, firstPlayCoachOpen]);

  // A game resumed at its pending adjustment never tumbles: the restored attempt keeps the saved die as published.
  const restoredRollSession = useRef<number | null>(null);
  const sessionId = session?.sessionId ?? null;
  const enteredAwaitingAdjust = session?.phase === "awaiting-adjust";
  useEffect(() => {
    if (sessionId === null || restoredRollSession.current === sessionId) return;
    restoredRollSession.current = sessionId;
    if (enteredAwaitingAdjust) beginTurnMoment("restored-roll");
  }, [sessionId, enteredAwaitingAdjust, beginTurnMoment]);
  const lotteryStage = turnDisplay?.phase === "lottery-flip" || turnDisplay?.phase === "lottery-settle" ? turnDisplay.phase : null;
  const lottery = lotteryStage && session?.lastMove?.landing ? {
    landing: session.lastMove.landing, stage: lotteryStage,
    durationMs: lotteryStage === "lottery-flip" ? moments.revealTiming.lotteryFlipMs
      : moments.revealTiming.lotterySettleMs,
    network, presentation, rideTarget, directionTarget,
  } : null;
  const record = session?.lastMove?.itemRecord;
  const pickupEvent = record?.kind === "item-ride" ? record.itemEvents.find((event) =>
    event.type === "pickup-retained" || event.type === "pickup-pending-discard") : undefined;
  const pickup = turnDisplay?.phase === "pickup" && pickupEvent
    && (pickupEvent.type === "pickup-retained" || pickupEvent.type === "pickup-pending-discard") ? {
      kind: pickupEvent.item.kind,
      durationMs: moments.revealTiming.pickupMs,
      targetRef: pickupEvent.type === "pickup-pending-discard"
        ? turnMomentTargets.inventoryHeader ?? null
        : turnMomentTargets.slots?.[turnDisplay.itemView?.inventory.length ?? 0] ?? null,
    } : null;
  const diceModel = session ? turnMomentDiceModel(presentedAttempt, acceptedRecord, reducedMotion) : null;
  const arrivalModel = turnDisplay ? turnMomentArrivalModel(turnDisplay.phase, presentedRevealStage,
    stationName(network, turnDisplay.progress.stationId, presentation)) : null;

  const showTitle = useCallback(() => {
    setNotice(null);
    setFirstTurnNoticeAnnouncement(null);
    setFirstPlayCoachReplaySessionId(null);
    showTitleScreen();
  }, [showTitleScreen]);

  const showClear = turnDisplay?.showClear ?? false;
  const mapMode: RailwayMapMode = app.state.screen === "title" ? "title" : showClear ? "clear" : "game";
  const panelShown = Boolean(session && shown && turnDisplay && !showClear);
  // The one source for every rules suspension; the rules live only beside a mounted panel.
  const rulesOpen = panelShown && rulesRequest !== null;
  const replayAvailability: FirstPlayCoachReplayAvailability = {
    sessionId: session?.sessionId ?? null,
    panelShown,
    gameStatus: game?.status ?? null,
    turnCanRoll: turnDisplay?.canRoll === true,
    pendingDecision: itemView?.decision != null || turnDisplay?.decision != null,
    itemUseDialogOpen: itemDialogOpen,
    confirmationOpen: confirm !== null,
    showClear,
  };
  const replayAvailabilityRef = useRef(replayAvailability);
  replayAvailabilityRef.current = replayAvailability;
  const canReplayCoach = isFirstPlayCoachReplayAllowed(replayAvailability);
  const replayFirstPlayCoach = useCallback((): void => {
    const latest = replayAvailabilityRef.current;
    const itemUseDialogIsOpen = typeof document !== "undefined"
      && document.querySelector("dialog.item-dialog[open]:not(.item-adjustment):not(.item-discard)") !== null;
    if (itemUseDialogIsOpen) return;
    if (!isFirstPlayCoachReplayAllowed(latest)) return;
    setFirstPlayCoachReplaySessionId(latest.sessionId);
    setRulesRequest(null);
  }, []);
  const firstTurnNotice = useFirstTurnNotice({
    saveAttempt: app.saveAttempt,
    currentSessionId: session?.sessionId ?? null,
    storage,
    publicationReady: turnDisplay?.phase === "published",
    decisionOpen: turnDisplay?.decision !== null && turnDisplay?.decision !== undefined,
    confirmOpen: confirm !== null,
    rulesOpen,
    coachOpen: firstPlayCoachOpen,
  });
  const handleNoticeShown = useCallback((key: string): void => {
    const displayed = firstTurnNotice.notice;
    firstTurnNotice.onNoticeShown(key);
    if (displayed?.key === key) {
      setFirstTurnNoticeAnnouncement({ key: displayed.key, text: displayed.text });
    }
  }, [firstTurnNotice.notice, firstTurnNotice.onNoticeShown]);
  const handleNoticeAnnounced = useCallback((announcement: SelectedNoticeAnnouncement): void => {
    if (announcement.source !== "first-turn") return;
    const current = firstTurnNoticeAnnouncement;
    if (current === null || current.key !== announcement.key || current.text !== announcement.text) return;
    firstTurnNotice.onNoticeAnnounced(announcement.key);
    setFirstTurnNoticeAnnouncement((latest) => latest?.key === announcement.key && latest.text === announcement.text
      ? null : latest);
  }, [firstTurnNotice.onNoticeAnnounced, firstTurnNoticeAnnouncement]);
  useEffect(() => {
    if (!panelShown) setRulesRequest(null);
  }, [panelShown]);
  const reportedClear = useRef(-1);
  useEffect(() => {
    if (!showClear || !session || !presentationGame || reportedClear.current === session.sessionId) return;
    reportedClear.current = session.sessionId;
    const summary = summarizeGame(session.game, presentation);
    trackEvent("game_clear", { turns: summary.turns, moves: summary.moves, transfers: summary.transfers });
  }, [showClear, session, presentationGame, presentation]);

  return (
    <>
      {app.state.screen === "title" && (
        <TitleScreen
          manifest={data.manifest.ok ? data.manifest.value : null}
          network={network}
          requiredIds={requiredIds}
          presentation={presentation}
          display={edition.display}
          rulesModel={rulesModel}
          {...picker}
          saveLookup={titleSave}
          unavailableReason={null}
          notice={notice}
          focusOnMount={app.state.lastSessionId > 0}
          initialTitleFocus={pendingInitialTitleFocus}
          onInitialTitleFocusApplied={consumeInitialTitleFocus}
          onNewGame={requestNewGame}
          onResume={resumeSaved}
          onDeleteSave={() => setConfirm({ kind: "delete-save" })}
        />
      )}
      {session && shown && turnDisplay && !showClear && (
        <GamePanel
          key={session.sessionId}
          session={session}
          turnDisplay={turnDisplay}
          turnMomentTargets={turnMomentTargets}
          network={network}
          presentation={presentation}
          display={edition.display}
          lines={data.services.ok ? data.services.value.lines : NO_LINES}
          requiredCount={requiredIds.size}
          saveStatus={app.saveStatus}
          follow={follow}
          speedLabel={speed?.label ?? ""}
          presentationLevel={presentationLevel}
          reducedMotion={reducedMotion}
          confirmationOpen={confirm !== null}
          rulesOpen={rulesOpen}
          coachOpen={firstPlayCoachOpen}
          coachTargets={coachTargets}
          firstTurnNoticeAnnouncement={firstTurnNoticeAnnouncement}
          onNoticeAnnounced={handleNoticeAnnounced}
          onOpenRules={openRules}
          onRoll={guardedRoll}
          onEditItemDraft={guardedEditItemDraft}
          onAdjustItemRoll={guardedAdjustItemRoll}
          onDiscardItem={guardedDiscardItem}
          onSkip={skip}
          onToggleFollow={toggleFollow}
          onCycleSpeed={cycleSpeed}
          onCyclePresentation={cyclePresentation}
          onNewGame={requestNewGame}
          onShowTitle={showTitle}
          onItemDialogOpenChange={setItemDialogOpen}
        />
      )}
      {session && shown && turnDisplay && !showClear && (diceModel || arrivalModel || lottery || pickup) && (
        <TurnMomentHost onTap={skip} lottery={lottery} pickup={pickup}>
          {diceModel ? <DiceTumble model={diceModel} /> : arrivalModel && <ArrivalBanner model={arrivalModel} />}
        </TurnMomentHost>
      )}
      {firstPlayCoachOpen && (
        <FirstPlayCoach
          steps={coachSteps}
          targets={coachTargets}
          onClose={closeFirstPlayCoach}
          onRestoreFocus={restoreFirstPlayCoachFocus}
          onShown={onFirstPlayCoachShown}
        />
      )}
      <ToastHost
        sessionId={toastSessionId}
        inputs={acceptedToastInputs}
        saveFailed={app.saveStatus === "failed"}
        obscured={confirm !== null || turnDisplay?.decision != null || itemDialogOpen || rulesOpen || firstPlayCoachOpen}
        reducedMotion={reducedMotion}
        notice={firstTurnNotice.notice}
        announceable={panelShown && turnDisplay?.decision == null && confirm === null && !rulesOpen && !itemDialogOpen && !firstPlayCoachOpen}
        onNoticeShown={handleNoticeShown}
      />
      {session && turnDisplay?.showClear && presentationGame && (
        <ClearScreen
          game={session.game}
          itemNotice={turnDisplay.itemView && turnDisplay.itemNoticePublished ? <ItemEventNotice
            view={turnDisplay.itemView} lastMove={turnDisplay.itemNoticeMove} turn={turnDisplay.turn} network={network} presentation={presentation}
            completionAnnouncement={turnDisplay.clearAnnouncement}
          /> : undefined}
          network={network}
          presentation={presentation}
          collection={turnDisplay.collection}
          display={edition.display}
          saveStatus={app.saveStatus}
          onPlayAgain={startNewGame}
          onShowTitle={showTitle}
        />
      )}
      {rulesOpen && rulesRequest && (
        <RulesDialog
          model={rulesModel}
          sectionId={rulesRequest.sectionId}
          returnFocus={rulesRequest.returnFocus}
          getFallbackFocus={rulesRequest.getFallbackFocus}
          onClose={closeRules}
          onReplayCoach={replayFirstPlayCoach}
          canReplayCoach={canReplayCoach}
        />
      )}
      {confirm?.kind === "new-game" && (
        <ConfirmDialog
          title="新しく始めますか？"
          message={confirm.message}
          confirmLabel="新しく始める"
          onConfirm={startNewGame}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete-save" && (
        <ConfirmDialog
          title="セーブデータの削除"
          message="セーブデータを削除しますか？この操作は取り消せません。"
          confirmLabel="削除する"
          onConfirm={deleteSaveConfirmed}
          onCancel={() => setConfirm(null)}
        />
      )}
      <RailwayMap
        data={data}
        mode={mapMode}
        targetServiceId={edition.config.targetServiceId}
        presentation={presentation}
        progress={progress}
        markerBearing={turnDisplay?.markerBearing ?? null}
        goalStationId={turnDisplay?.goalGuidance?.stationId ?? null}
        segmentFlash={turnDisplay?.segmentFlash ?? null}
        adjustmentCandidates={turnDisplay?.adjustmentLandings}
        livePosition={livePosition}
        follow={mapFollow}
        panelKey={session && shown && !showClear ? session.sessionId : undefined}
        overviewKey={session?.game.turn === 0 ? session.sessionId : undefined}
        coachTargetRef={coachMapTarget}
        inert={app.state.screen === "title" || showClear}
      />
    </>
  );
}
