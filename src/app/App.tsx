import { useEffect, useMemo, useState } from "react";
import { listFailures, loadRailwayData, type RailwayData } from "../data/loaders";
import { networkFromData } from "../features/game/networkFromData";
import { RailwayMap } from "../features/map/RailwayMap";
import { DataErrorBanner } from "./DataErrorBanner";
import { GameScreen } from "./GameScreen";

const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`;

export function App() {
  const [data, setData] = useState<RailwayData | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRailwayData(DATA_BASE_URL).then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const networkResult = useMemo(() => (data ? networkFromData(data) : null), [data]);

  if (!data || !networkResult) return <div className="loading">読み込み中…</div>;

  return (
    <>
      {networkResult.ok ? (
        <GameScreen data={data} network={networkResult.network} />
      ) : (
        <>
          <RailwayMap data={data} />
          <p className="game-unavailable" role="alert">
            ゲームを開始できません: {networkResult.reason}
          </p>
        </>
      )}
      <DataErrorBanner failures={listFailures(data)} />
    </>
  );
}
