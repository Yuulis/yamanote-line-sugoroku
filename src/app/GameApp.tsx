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
import { itemTurnAnnouncement, displayedRide } from "../features/game/presentation";
import { createPresentationResolver } from "../features/game/presentationResolver";
import { type MapFollow, RailwayMap } from "../features/map/RailwayMap";
import type { MapProgress } from "../features/map/railwayLayers";
import type { GameState, LineMetadata } from "../types/network";
import { trackEvent } from "../features/analytics/analytics";
import type { SaveLookup } from "../features/game/store/persistence";
import { hasGameProgress } from "../features/game/gameSession";
import { summarizeGame } from "../features/game/gameSummary";
import { useRevealSequence, type RevealStage } from "../features/game/animation/useRevealSequence";
import { ToastHost } from "../features/game/components/ToastHost";
import { turnToasts, type ToastInput } from "../features/game/toastQueue";

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
}

type PendingConfirm = { kind: "new-game"; message: string } | { kind: "delete-save" } | null;

const NO_PROGRESS: MapProgress = { completedFeatureIds: [], currentPosition: null };
const NO_LINES: readonly LineMetadata[] = [];
const NO_REVEAL_STAGES: readonly RevealStage[] = [];

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
export function GameApp({ data, network, edition, picker }: GameAppProps) {
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
  const reveal = useRevealSequence({
    observation: {
      sessionId: session?.sessionId ?? 0,
      recordTurn: session?.lastMove?.itemRecord?.turn ?? null,
      gameTurn: game?.turn ?? 0,
      pendingDecisionTurn: app.itemView?.decision ? game?.turn ?? null : null,
      movementComplete: session?.phase !== "animating",
    },
    stages: NO_REVEAL_STAGES,
    reducedMotion,
  });
  const revealSkipRef = useRef(reveal.skip);
  revealSkipRef.current = reveal.skip;
  const toastSessionId = session?.sessionId ?? null;
  const toastInputs = useMemo(
    () => reveal.ready && session ? turnToasts(session.sessionId, session.lastMove, network, presentation) : [],
    [reveal.ready, session, network, presentation],
  );
  const toastBaseline = useRef<ToastBaseline>(NO_TOAST_BASELINE);
  const processedToastInputs = useRef<readonly ToastInput[] | null>(null);
  const [acceptedToastInputs, setAcceptedToastInputs] = useState<readonly ToastInput[]>([]);
  useEffect(() => {
    if (toastBaseline.current.sessionId !== toastSessionId) {
      toastBaseline.current = {
        sessionId: toastSessionId,
        keys: new Set(turnToasts(session?.sessionId ?? 0, session?.lastMove ?? null, network, presentation).map((input) => input.key)),
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
  }, [toastSessionId, reveal.key, reveal.ready, toastInputs, session, network, presentation]);
  const presentationGame = useMemo(() => session ? sessionProgress(session) : null, [session]);
  const titleSave: SaveLookup | null = app.saveLookup?.kind === "valid"
    ? { kind: "valid", game: isItemSave(app.saveLookup.game)
      ? { ...app.saveLookup.game, movementHistory: [] } : app.saveLookup.game }
    : app.saveLookup;
  const resumeSaved = useCallback((saved: GameState) => {
    app.resume(app.saveLookup?.kind === "valid" ? app.saveLookup.game : saved);
  }, [app.resume, app.saveLookup]);
  const speed = speedById(speedId);
  const stepMs = reducedMotion ? 0 : speed?.stepMs ?? 0;
  const { view, livePosition } = useMoveAnimation(
    session?.animation ?? null,
    network,
    geometry,
    stepMs,
    app.finishAnimation,
  );
  const shown = useMemo(
    () => (presentationGame ? displayedProgress(presentationGame, network, view) : null),
    [presentationGame, network, view],
  );
  const progress = useMemo<MapProgress>(
    () =>
      shown
        ? {
            completedFeatureIds: shown.completedSegmentIds.filter((id) => requiredIds.has(id)).flatMap(
              (id) => network.segmentsById.get(id)!.geometryFeatureIds,
            ),
            currentPosition: shown.position,
            highlightedServiceId: session ? displayedRide(session).serviceId : undefined,
          }
        : NO_PROGRESS,
    [shown, requiredIds, network, session],
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
  const { newGame, saveLookup, finishAnimation, showTitle: showTitleScreen } = app;
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

  const currentAnimation = session?.animation;
  const currentAnimationRef = useRef(currentAnimation);
  currentAnimationRef.current = currentAnimation;
  const skip = useCallback(() => {
    revealSkipRef.current();
    const animation = currentAnimationRef.current;
    if (animation) finishAnimation(animation);
  }, [finishAnimation]);

  const showTitle = useCallback(() => {
    setNotice(null);
    showTitleScreen();
  }, [showTitleScreen]);

  const showClear = session?.game.status === "completed" && session.phase === "idle";
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
      {session && shown && !showClear && (
        <GamePanel
          key={session.sessionId}
          session={session}
          network={network}
          presentation={presentation}
          display={edition.display}
          lines={data.services.ok ? data.services.value.lines : NO_LINES}
          displayedStationId={shown.stationId}
          displayedCompletedCount={shown.completedSegmentIds.filter((id) => requiredIds.has(id)).length}
          requiredCount={requiredIds.size}
          saveStatus={app.saveStatus}
          follow={follow}
          speedLabel={speed?.label ?? ""}
          reducedMotion={reducedMotion}
          onRoll={app.roll}
          itemView={app.itemView}
          onEditItemDraft={app.editItemDraft}
          onAdjustItemRoll={app.adjustItemRoll}
          onDiscardItem={app.discardItem}
          onSkip={skip}
          onToggleFollow={toggleFollow}
          onCycleSpeed={cycleSpeed}
          onNewGame={requestNewGame}
          onShowTitle={showTitle}
          onItemDialogOpenChange={setItemDialogOpen}
        />
      )}
      <ToastHost
        sessionId={toastSessionId}
        inputs={acceptedToastInputs}
        saveFailed={app.saveStatus === "failed"}
        obscured={confirm !== null || app.itemView?.decision != null || itemDialogOpen}
        reducedMotion={reducedMotion}
      />
      {session && showClear && presentationGame && (
        <ClearScreen
          game={session.game}
          itemNotice={app.itemView ? <ItemEventNotice
            view={app.itemView} lastMove={session.lastMove} turn={session.game.turn} network={network} presentation={presentation}
            completionAnnouncement={itemTurnAnnouncement(session, app.itemView, shown?.completedSegmentIds.filter((id) => requiredIds.has(id)).length ?? 0,
              requiredIds.size, network, presentation)}
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
