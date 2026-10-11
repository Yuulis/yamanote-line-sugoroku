import { useMemo } from "react";
import type { RailwayData } from "../data/loaders";
import type { RailwayNetwork } from "../features/game/engine";
import { GamePanel } from "../features/game/GamePanel";
import { useGameSession } from "../features/game/useGameSession";
import { RailwayMap } from "../features/map/RailwayMap";
import type { MapProgress } from "../features/map/railwayLayers";

interface GameScreenProps {
  data: RailwayData;
  network: RailwayNetwork;
}

/** The map with the player's progress plus the control panel. */
export function GameScreen({ data, network }: GameScreenProps) {
  const { session, roll, restart } = useGameSession(network);
  const { completedSegmentIds, currentStationId } = session.game;

  const progress = useMemo<MapProgress>(() => {
    const station = network.stationsById.get(currentStationId);
    return {
      completedSegmentIds,
      currentPosition: station ? [...station.coordinates] : null,
    };
  }, [network, completedSegmentIds, currentStationId]);

  return (
    <>
      <RailwayMap data={data} progress={progress} />
      <GamePanel session={session} network={network} onRoll={roll} onRestart={restart} />
    </>
  );
}
