import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RailwayData } from "../data/loaders";
import { displayedProgress, sessionProgress } from "../features/game/animation/displayedProgress";
import { buildGeometryIndex } from "../features/game/animation/movePath";
import { useMoveAnimation } from "../features/game/animation/useMoveAnimation";
import { ClearScreen } from "../features/game/components/ClearScreen";
import { ConfirmDialog } from "../features/game/components/ConfirmDialog";
import { GamePanel } from "../features/game/components/GamePanel";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { type RailwayNetwork, isItemSave, targetSegmentIds } from "../features/game/engine";
import {
  ANIMATION_SPEEDS,
  type AnimationSpeedId,
  DEFAULT_ANIMATION_SPEED,
} from "../features/game/gameConfig";
import type { Edition } from "../features/editions/types";
import type { EditionId, EditionRegistry } from "../features/editions/types";
import { getBrowserStorage } from "../features/game/store/browserStorage";
import { useGameApp } from "../features/game/useGameApp";
import { usePrefersReducedMotion } from "../features/game/usePrefersReducedMotion";
import { ItemEventNotice } from "../features/game/components/ItemEventNotice";
import { deriveTurnMomentDisplay } from "../features/game/turnMomentPresentation";
import type { TurnMomentDisplay, TurnRevealState } from "../features/game/turnMomentPresentation";
import type { RollAttempt, TurnMomentObservation, TurnOrigin } from "../features/game/animation/turnMoments";
import { attemptOwnsAnimation, useTurnMoments } from "../features/game/animation/useTurnMoments";
import { TurnMomentHost, turnMomentDiceModel } from "../features/game/components/TurnMomentHost";
import { DiceTumble } from "../features/game/components/DiceTumble";
import type { GameSession } from "../features/game/gameSession";
import { createPresentationResolver } from "../features/game/presentationResolver";
import { type MapFollow, RailwayMap } from "../features/map/RailwayMap";
import type { MapProgress } from "../features/map/railwayLayers";
import type { GameState, ItemRollAdjustment, ItemTurnCommand, LineMetadata } from "../types/network";
import { trackEvent } from "../features/analytics/analytics";
import type { SaveLookup } from "../features/game/store/persistence";
import { hasGameProgress } from "../features/game/gameSession";
import { summarizeGame } from "../features/game/gameSummary";
import type { RevealStage } from "../features/game/animation/useRevealSequence";
import { ToastHost } from "../features/game/components/ToastHost";
import type { ToastInput } from "../features/game/toastQueue";

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
  /** Narrow input seam for mounted publication-boundary tests; production leaves it unset. */
  turnMomentBoundary?: Readonly<{ attempt: RollAttempt | null; revealStage: TurnRevealState; restoredOrOmitted: boolean }>;
}

type PendingConfirm = { kind: "new-game"; message: string } | { kind: "delete-save" } | null;

const NO_PROGRESS: MapProgress = { completedFeatureIds: [], currentPosition: null };
const NO_LINES: readonly LineMetadata[] = [];
/** Post-move stages stay empty until their moments are rendered (S12-S15): nothing waits for an unrendered stage. */
const NO_REVEAL_STAGES: readonly RevealStage[] = [];
const NO_MOVE_EVENTS: TurnMomentObservation["movementEvents"] = [];
/** Phases in which `lastMove` still describes the previous turn: the current record is not yet save-attempted. */
const PRE_RECORD_PHASES: ReadonlySet<GameSession["phase"]> = new Set(["committing", "awaiting-adjust", "resolving"]);

/** Toast keys of the record a session was entered with; they are never shown (no replay on resume). */
interface ToastBaseline {
  /** `undefined` before the first session observation, so the first effect always captures one. */
  sessionId: number | null | undefined;
  keys: ReadonlySet<string>;
}

const NO_TOAST_BASELINE: ToastBaseline = { sessionId: undefined, keys: new Set() };

function speedById(id: AnimationSpeedId) {
  return ANIMATION_SPEEDS.find((speed) => speed.id === id) ?? ANIMATION_SPEEDS[1];
}

function nextSpeedId(id: AnimationSpeedId): AnimationSpeedId {
  const index = ANIMATION_SPEEDS.findIndex((speed) => speed.id === id);
  return ANIMATION_SPEEDS[(index + 1) % ANIMATION_SPEEDS.length]?.id ?? DEFAULT_ANIMATION_SPEED;
}

/** Title, play and clear screens over one persistent map. */
export function GameApp({ data, network, edition, picker, turnMomentBoundary }: GameAppProps) {
  const storage = useMemo(getBrowserStorage, []);
  const uiPresentation = data.manifest.ok ? data.manifest.value.uiPresentation : undefined;
  const presentation = useMemo(
    () => createPresentationResolver(network, uiPresentation),
    [network, uiPresentation],
  );
  const config = edition.config;
  const app = useGameApp(network, storage, config, edition.saveKey);
  const reducedMotion = usePrefersReducedMotion();
  const [speedId, setSpeedId] = useState<AnimationSpeedId>(DEFAULT_ANIMATION_SPEED);
  const [follow, setFollow] = useState(true);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);

  const geometry = useMemo(
    () => buildGeometryIndex(data.geometry.ok ? data.geometry.value : undefined),
    [data],
  );
  const requiredIds = useMemo(
    () => new Set(targetSegmentIds(edition.config, network)),
    [edition.config, network],
  );
  const session = app.state.screen === "game" ? app.state.session : null;
  const game = session?.game ?? null;
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
  const moments = useTurnMoments({
    sessionId: session?.sessionId ?? 0,
    gameTurn: game?.turn ?? 0,
    decisionRevision: session?.item?.decisionRevision ?? 0,
    origin: turnOrigin,
    stepMs: speed?.stepMs ?? 0,
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
    revealStages: NO_REVEAL_STAGES,
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
    app.resume(app.saveLookup?.kind === "valid" ? app.saveLookup.game : saved);
  }, [app.resume, app.saveLookup]);
  // The attempt's movement runs at the speed captured with its roll and only once its pre-move moment released it.
  const ownsAnimation = attemptOwnsAnimation(liveAttempt, animation);
  // Reduced motion seen at any point of the attempt finishes its movement instantly, even if turned off again since.
  const stepMs = reducedMotion || (ownsAnimation && moments.attemptMotionReduced) ? 0
    : ownsAnimation && liveAttempt ? liveAttempt.timing.stepMs : speed?.stepMs ?? 0;
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
  const resumeBaseline = useRef<{ sessionId: number | null; turn: number } | null>(null);
  if (resumeBaseline.current?.sessionId !== (session?.sessionId ?? null)) {
    resumeBaseline.current = { sessionId: session?.sessionId ?? null, turn: game?.turn ?? 0 };
  }
  const classicAnnouncement = useRef({ sessionId: session?.sessionId, text: "" });
  if (classicAnnouncement.current.sessionId !== session?.sessionId) {
    classicAnnouncement.current = { sessionId: session?.sessionId, text: "" };
  }
  const restoredHistory = (game?.turn ?? 0) <= (resumeBaseline.current?.turn ?? 0);
  // The record the session was entered with stays published, until an attempt for a newer turn takes over.
  const baselineTurn = resumeBaseline.current?.turn ?? 0;
  const restoredRecordShown = reveal.key !== null && Number(reveal.key.split(":").at(-1)) <= baselineTurn
    && !(liveAttempt !== null && liveAttempt.recordTurn > baselineTurn);
  const turnDisplay = useMemo(() => session && shown ? deriveTurnMomentDisplay({
    session,
    network,
    presentation,
    progress: shown,
    attempt: presentedAttempt,
    revealStage: turnMomentBoundary?.revealStage ?? (reveal.stage === "done" ? "done" : "waiting"),
    restoredOrOmitted: turnMomentBoundary?.restoredOrOmitted ?? (moments.restoredOrOmitted || restoredRecordShown),
    itemView,
    restoredHistory,
    previousClassicAnnouncement: classicAnnouncement.current.text,
  }) : null, [session, shown, network, presentation, turnMomentBoundary, presentedAttempt, reveal.stage, moments.restoredOrOmitted, restoredRecordShown, itemView, restoredHistory]);
  if (!itemView && turnDisplay && session?.phase === "idle" && !restoredHistory) {
    classicAnnouncement.current.text = turnDisplay.announcement;
  }
  // Presented permissions, read at call time so a direct or stale invocation cannot bypass them.
  const turnDisplayRef = useRef<TurnMomentDisplay | null>(null);
  turnDisplayRef.current = turnDisplay;
  const toastInputs = turnDisplay?.toastInputs ?? [];
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
    if (!reveal.ready || !reveal.key) return;
    if (toastInputs !== processedToastInputs.current) {
      processedToastInputs.current = toastInputs;
      setAcceptedToastInputs(toastInputs.filter((input) => !toastBaseline.current.keys.has(input.key)));
    }
  }, [toastSessionId, reveal.key, reveal.ready, toastInputs]);
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

  const stopFollowing = useCallback(() => setFollow(false), []);
  const toggleFollow = useCallback(() => setFollow((value) => !value), []);
  const cycleSpeed = useCallback(() => setSpeedId(nextSpeedId), []);
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
    if (!turnDisplayRef.current?.canRoll) return;
    beginTurnMoment("click");
    roll();
  }, [roll, beginTurnMoment]);
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
    newGame();
  }, [newGame]);

  const requestNewGame = useCallback(() => {
    const saved = saveLookup?.kind === "valid" ? saveLookup.game : null;
    const current = game ?? saved;
    if (current?.status === "playing" && hasGameProgress(current)) {
      const message = game
        ? "現在のゲームを終了して新しく始めますか？今の進行は上書きされます。"
        : `保存中のゲーム（${current.turn}ターン目）は上書きされます。はじめから始めますか？`;
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
    if (!turnDisplayRef.current?.canSkip) return;
    skipTurnMoment();
    const current = currentAnimationRef.current;
    if (current) finishAnimation(current);
  }, [finishAnimation, skipTurnMoment]);

  // A game resumed at its pending adjustment never tumbles: the restored attempt keeps the saved die as published.
  const restoredRollSession = useRef<number | null>(null);
  const sessionId = session?.sessionId ?? null;
  const enteredAwaitingAdjust = session?.phase === "awaiting-adjust";
  useEffect(() => {
    if (sessionId === null || restoredRollSession.current === sessionId) return;
    restoredRollSession.current = sessionId;
    if (enteredAwaitingAdjust) beginTurnMoment("restored-roll");
  }, [sessionId, enteredAwaitingAdjust, beginTurnMoment]);
  const diceModel = session ? turnMomentDiceModel(presentedAttempt, acceptedRecord, reducedMotion) : null;

  const showTitle = useCallback(() => {
    setNotice(null);
    showTitleScreen();
  }, [showTitleScreen]);

  const showClear = turnDisplay?.showClear ?? false;
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
          presentation={presentation}
          display={edition.display}
          {...picker}
          saveLookup={titleSave}
          unavailableReason={null}
          notice={notice}
          focusOnMount={app.state.lastSessionId > 0}
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
          network={network}
          presentation={presentation}
          display={edition.display}
          lines={data.services.ok ? data.services.value.lines : NO_LINES}
          requiredCount={requiredIds.size}
          saveStatus={app.saveStatus}
          follow={follow}
          speedLabel={speed?.label ?? ""}
          reducedMotion={reducedMotion}
          onRoll={guardedRoll}
          onEditItemDraft={guardedEditItemDraft}
          onAdjustItemRoll={guardedAdjustItemRoll}
          onDiscardItem={guardedDiscardItem}
          onSkip={skip}
          onToggleFollow={toggleFollow}
          onCycleSpeed={cycleSpeed}
          onNewGame={requestNewGame}
          onShowTitle={showTitle}
          onItemDialogOpenChange={setItemDialogOpen}
        />
      )}
      {session && shown && turnDisplay && !showClear && diceModel && (
        <TurnMomentHost onTap={skip}>
          <DiceTumble model={diceModel} />
        </TurnMomentHost>
      )}
      <ToastHost
        sessionId={toastSessionId}
        inputs={acceptedToastInputs}
        saveFailed={app.saveStatus === "failed"}
        obscured={confirm !== null || turnDisplay?.decision != null || itemDialogOpen}
        reducedMotion={reducedMotion}
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
          display={edition.display}
          saveStatus={app.saveStatus}
          onPlayAgain={startNewGame}
          onShowTitle={showTitle}
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
        targetServiceId={edition.config.targetServiceId}
        presentation={presentation}
        progress={progress}
        livePosition={livePosition}
        follow={mapFollow}
        panelKey={session && shown && !showClear ? session.sessionId : undefined}
        overviewKey={session?.game.turn === 0 ? session.sessionId : undefined}
        inert={app.state.screen === "title" || showClear}
      />
    </>
  );
}
