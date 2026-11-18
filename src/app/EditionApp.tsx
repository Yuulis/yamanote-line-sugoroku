import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listFailures, loadRailwayData, type RailwayData } from "../data/loaders";
import { type EditionId, type EditionRegistry, type Edition } from "../features/editions/types";
import { TitleScreen } from "../features/game/components/TitleScreen";
import { networkFromData } from "../features/game/networkFromData";
import { buildRulesGuide } from "../features/game/rulesGuide";
import { RailwayMap } from "../features/map/RailwayMap";
import { TitleMapPlaceholder } from "../features/map/components/TitleMapPlaceholder";
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
}: EditionAppProps): React.JSX.Element {
  const [data, setData] = useState<RailwayData | null>(null);
  const [loadingRulesOpen, setLoadingRulesOpen] = useState(false);
  const [initialTitleFocus, setInitialTitleFocus] = useState<"rules-trigger" | undefined>();
  const reportedFailures = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadingRulesOpen(false);
    setInitialTitleFocus(undefined);
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
  // Without a loaded network there is no target count or display names; the model keeps its generic wording.
  const rulesModel = useMemo(() => buildRulesGuide(edition.config), [edition.config]);
  const onLoadingRulesViewChange = useCallback((open: boolean): void => {
    if (!open && loadingRulesOpen && networkResult?.ok) setInitialTitleFocus("rules-trigger");
    setLoadingRulesOpen(open);
  }, [loadingRulesOpen, networkResult]);
  const pickerProps = {
    editions,
    editionId: edition.id,
    onEditionChange,
    focusPicker,
    onPickerFocusRestored,
  };

  if (!data || (editions.length === 1 && loadingRulesOpen)) {
    const loadingTitle = <TitleScreen
      manifest={null}
      network={null}
      display={edition.display}
      saveLookup={null}
      unavailableReason={null}
      notice={null}
      loading
      rulesModel={rulesModel}
      onRulesViewChange={editions.length === 1 ? onLoadingRulesViewChange : undefined}
      {...pickerProps}
      onNewGame={noop}
      onResume={noop}
      onDeleteSave={noop}
    />;
    return editions.length === 1 ? <>
      <TitleMapPlaceholder />
      {loadingTitle}
    </> : loadingTitle;
  }

  if (!networkResult?.ok) {
    const reason = networkResult?.reason ?? "必要なデータを読み込めませんでした";
    return <>
      <RailwayMap data={data} mode="title" targetServiceId={edition.config.targetServiceId} />
      <TitleScreen
        manifest={data.manifest.ok ? data.manifest.value : null}
        network={null}
        display={edition.display}
        saveLookup={null}
        unavailableReason={reason}
        notice={null}
        rulesModel={rulesModel}
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
      initialTitleFocus={initialTitleFocus}
    />
    <DataErrorBanner failures={listFailures(data)} />
  </>;
}
