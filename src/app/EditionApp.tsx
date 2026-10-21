import { useEffect, useMemo, useRef, useState } from "react";
import { listFailures, loadRailwayData, type RailwayData } from "../data/loaders";
import { type EditionId, type EditionRegistry, type Edition } from "../features/editions/types";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { networkFromData } from "../features/game/networkFromData";
import { RailwayMap } from "../features/map/RailwayMap";
import { DataErrorBanner } from "./DataErrorBanner";
import { GameApp } from "./GameApp";
import { trackException } from "../features/analytics/analytics";

interface EditionAppProps {
  edition: Edition;
  editions: EditionRegistry;
  onEditionChange: (id: EditionId) => void;
  focusPicker: boolean;
  onPickerFocusRestored: () => void;
}

function noop(): void {}

export function EditionApp({
  edition,
  editions,
  onEditionChange,
  focusPicker,
  onPickerFocusRestored,
}: EditionAppProps) {
  const [data, setData] = useState<RailwayData | null>(null);
  const reportedFailures = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    setData(null);
    loadRailwayData(edition.dataBaseUrl).then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [edition]);

  useEffect(() => {
    if (!data) return;
    const failures = listFailures(data);
    const key = failures.map(({ file }) => file).sort().join(",");
    if (key === reportedFailures.current) return;
    reportedFailures.current = key;
    for (const failure of failures) trackException(`data_load_${failure.file}`, !data.stations.ok || !data.services.ok);
  }, [data]);

  const networkResult = useMemo(
    () => (data
      ? networkFromData(data, edition.config, edition.expectedStationCounts)
      : null),
    [data, edition],
  );
  const pickerProps = {
    editions,
    editionId: edition.id,
    onEditionChange,
    focusPicker,
    onPickerFocusRestored,
  };

  if (!data) {
    if (editions.length === 1) return <div className="loading">読み込み中…</div>;
    return <TitleScreen
      manifest={null}
      network={null}
      display={edition.display}
      saveLookup={null}
      unavailableReason={null}
      notice={null}
      loading
      {...pickerProps}
      onNewGame={noop}
      onResume={noop}
      onDeleteSave={noop}
    />;
  }

  if (!networkResult?.ok) {
    const reason = networkResult?.reason ?? "必要なデータを読み込めませんでした";
    return <>
      <RailwayMap data={data} targetServiceId={edition.config.targetServiceId} />
      <TitleScreen
        manifest={data.manifest.ok ? data.manifest.value : null}
        network={null}
        display={edition.display}
        saveLookup={null}
        unavailableReason={reason}
        notice={null}
        {...pickerProps}
        onNewGame={noop}
        onResume={noop}
        onDeleteSave={noop}
      />
      <DataErrorBanner failures={listFailures(data)} />
    </>;
  }

  return <>
    <GameApp
      data={data}
      network={networkResult.network}
      edition={edition}
      picker={pickerProps}
    />
    <DataErrorBanner failures={listFailures(data)} />
  </>;
}
