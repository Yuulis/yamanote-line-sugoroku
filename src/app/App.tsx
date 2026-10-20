import { useEffect, useMemo, useState } from "react";
import { listFailures, loadRailwayData, type RailwayData } from "../data/loaders";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { networkFromData } from "../features/game/networkFromData";
import { RailwayMap } from "../features/map/RailwayMap";
import { DataErrorBanner } from "./DataErrorBanner";
import { GameApp } from "./GameApp";
import { EDITIONS } from "../features/editions/registry";

const DEFAULT_EDITION = EDITIONS[0]!;

function noop(): void {}

export function App() {
  const [data, setData] = useState<RailwayData | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRailwayData(DEFAULT_EDITION.dataBaseUrl).then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const networkResult = useMemo(
    () => (data
      ? networkFromData(data, DEFAULT_EDITION.config, DEFAULT_EDITION.expectedStationCounts)
      : null),
    [data],
  );

  if (!data || !networkResult) return <div className="loading">読み込み中…</div>;

  return (
    <>
      {networkResult.ok ? (
        <GameApp data={data} network={networkResult.network} edition={DEFAULT_EDITION} />
      ) : (
        <>
          <RailwayMap data={data} targetServiceId={DEFAULT_EDITION.config.targetServiceId} />
          {/* Data needed for the game is missing: explain, and block starting. */}
          <TitleScreen
            manifest={data.manifest.ok ? data.manifest.value : null}
            network={null}
            display={DEFAULT_EDITION.display}
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
