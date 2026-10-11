import { useEffect, useState } from "react";
import { listFailures, loadRailwayData, type RailwayData } from "../data/loaders";
import { RailwayMap } from "../features/map/RailwayMap";
import { DataErrorBanner } from "./DataErrorBanner";

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

  if (!data) return <div className="loading">読み込み中…</div>;

  return (
    <>
      <RailwayMap data={data} />
      <DataErrorBanner failures={listFailures(data)} />
    </>
  );
}
