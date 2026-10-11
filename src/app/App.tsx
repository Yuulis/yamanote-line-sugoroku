import { useEffect, useMemo, useState } from "react";
import { listFailures, loadRailwayData, type RailwayData } from "../data/loaders";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { networkFromData } from "../features/game/networkFromData";
import { RailwayMap } from "../features/map/RailwayMap";
import { DataErrorBanner } from "./DataErrorBanner";
import { GameApp } from "./GameApp";

const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`;

function noop(): void {}

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
        <GameApp data={data} network={networkResult.network} />
      ) : (
        <>
          <RailwayMap data={data} />
          {/* Data needed for the game is missing: explain, and block starting. */}
          <TitleScreen
            manifest={data.manifest.ok ? data.manifest.value : null}
            network={null}
            saveLookup={null}
            unavailableReason={networkResult.reason}
            notice={null}
            onNewGame={noop}
            onResume={noop}
            onDeleteSave={noop}
          />
        </>
      )}
      <DataErrorBanner failures={listFailures(data)} />
    </>
  );
}
