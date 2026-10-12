import { useCallback, useMemo, useState } from "react";
import type { RailwayData } from "../data/loaders";
import { displayedProgress } from "../features/game/animation/displayedProgress";
import { buildGeometryIndex } from "../features/game/animation/movePath";
import { useMoveAnimation } from "../features/game/animation/useMoveAnimation";
import { ClearScreen } from "../features/game/components/ClearScreen";
import { ConfirmDialog } from "../features/game/components/ConfirmDialog";
import { GamePanel } from "../features/game/components/GamePanel";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { type RailwayNetwork, targetSegmentIds } from "../features/game/engine";
import {
  ANIMATION_SPEEDS,
  type AnimationSpeedId,
  DEFAULT_ANIMATION_SPEED,
  MVP_GAME_CONFIG,
} from "../features/game/gameConfig";
import { getBrowserStorage } from "../features/game/store/browserStorage";
import { useGameApp } from "../features/game/useGameApp";
import { usePrefersReducedMotion } from "../features/game/usePrefersReducedMotion";
import { type MapFollow, RailwayMap } from "../features/map/RailwayMap";
import type { MapProgress } from "../features/map/railwayLayers";

interface GameAppProps {
  data: RailwayData;
  network: RailwayNetwork;
}

type PendingConfirm = { kind: "new-game"; message: string } | { kind: "delete-save" } | null;

const NO_PROGRESS: MapProgress = { completedFeatureIds: [], currentPosition: null };

function speedById(id: AnimationSpeedId) {
  return ANIMATION_SPEEDS.find((speed) => speed.id === id) ?? ANIMATION_SPEEDS[1];
}

function nextSpeedId(id: AnimationSpeedId): AnimationSpeedId {
  const index = ANIMATION_SPEEDS.findIndex((speed) => speed.id === id);
  return ANIMATION_SPEEDS[(index + 1) % ANIMATION_SPEEDS.length]?.id ?? DEFAULT_ANIMATION_SPEED;
}

/** Title, play and clear screens over one persistent map. */
export function GameApp({ data, network }: GameAppProps) {
  const storage = useMemo(getBrowserStorage, []);
  const app = useGameApp(network, storage);
  const reducedMotion = usePrefersReducedMotion();
  const [speedId, setSpeedId] = useState<AnimationSpeedId>(DEFAULT_ANIMATION_SPEED);
  const [follow, setFollow] = useState(true);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const geometry = useMemo(
    () => buildGeometryIndex(data.geometry.ok ? data.geometry.value : undefined),
    [data],
  );
  const requiredIds = useMemo(
    () => new Set(targetSegmentIds(MVP_GAME_CONFIG, network)),
    [network],
  );
  const session = app.state.screen === "game" ? app.state.session : null;
  const game = session?.game ?? null;
  const speed = speedById(speedId);
  const stepMs = reducedMotion ? 0 : speed?.stepMs ?? 0;
  const view = useMoveAnimation(
    session?.animation ?? null,
    network,
    geometry,
    stepMs,
    app.finishAnimation,
  );
  const shown = useMemo(
    () => (game ? displayedProgress(game, network, view) : null),
    [game, network, view],
  );
  const progress = useMemo<MapProgress>(
    () =>
      shown
        ? {
            completedFeatureIds: shown.completedSegmentIds.filter((id) => requiredIds.has(id)).map(
              (id) => network.segmentsById.get(id)!.geometryFeatureId,
            ),
            currentPosition: shown.position,
          }
        : NO_PROGRESS,
    [shown, requiredIds, network],
  );

  const stopFollowing = useCallback(() => setFollow(false), []);
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

  const startNewGame = () => {
    setConfirm(null);
    setNotice(null);
    app.newGame();
  };

  const requestNewGame = () => {
    const saved = app.saveLookup?.kind === "valid" ? app.saveLookup.game : null;
    const current = game ?? saved;
    if (current?.status === "playing" && current.turn > 0) {
      const message = game
        ? "現在のゲームを終了して新しく始めますか？今の進行は上書きされます。"
        : `保存中のゲーム（${current.turn}ターン目）は上書きされます。はじめから始めますか？`;
      setConfirm({ kind: "new-game", message });
      return;
    }
    startNewGame();
  };

  const deleteSaveConfirmed = () => {
    setConfirm(null);
    setNotice(app.removeSave() ? "セーブデータを削除しました。" : "セーブデータを削除できませんでした。");
  };

  const skip = () => {
    if (session?.animation) app.finishAnimation(session.animation);
  };

  const showTitle = () => {
    setNotice(null);
    app.showTitle();
  };

  const showClear = session?.game.status === "completed" && session.phase === "idle";

  return (
    <>
      <RailwayMap data={data} progress={progress} follow={mapFollow} />
      {app.state.screen === "title" && (
        <TitleScreen
          manifest={data.manifest.ok ? data.manifest.value : null}
          network={network}
          saveLookup={app.saveLookup}
          unavailableReason={null}
          notice={notice}
          onNewGame={requestNewGame}
          onResume={app.resume}
          onDeleteSave={() => setConfirm({ kind: "delete-save" })}
        />
      )}
      {session && shown && !showClear && (
        <GamePanel
          session={session}
          network={network}
          displayedStationId={shown.stationId}
          displayedCompletedCount={shown.completedSegmentIds.filter((id) => requiredIds.has(id)).length}
          requiredCount={requiredIds.size}
          saveStatus={app.saveStatus}
          follow={follow}
          speedLabel={speed?.label ?? ""}
          reducedMotion={reducedMotion}
          onRoll={app.roll}
          onSkip={skip}
          onToggleFollow={() => setFollow((value) => !value)}
          onCycleSpeed={() => setSpeedId(nextSpeedId)}
          onNewGame={requestNewGame}
          onShowTitle={showTitle}
        />
      )}
      {session && showClear && (
        <ClearScreen
          game={session.game}
          network={network}
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
    </>
  );
}
