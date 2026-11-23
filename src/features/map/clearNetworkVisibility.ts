import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { hideAllLineGroups, updateLineGroupVisibility } from "./lineVisibility";
import { LAYER_IDS } from "./mapConfig";
import type { MapPresentationIndex } from "./mapPresentation";
import { watchRemoval } from "./useClearRouteMap";

/**
 * The gameplay overlays that colour the network apart from the two legend-controlled background layers: the
 * current-service highlight and the Yamanote progress lines. On the clear screen every Yamanote segment is
 * completed, so these would paint the whole loop in colour beside the travelled route and compete with it.
 */
export const CLEAR_HIDDEN_OVERLAY_LAYER_IDS: readonly string[] = [
  LAYER_IDS.currentService,
  LAYER_IDS.segmentsPendingCasing,
  LAYER_IDS.segmentsPending,
  LAYER_IDS.segmentsCompleted,
  LAYER_IDS.segmentsFlash,
];

/** Show or hide the overlays through layout visibility, which leaves their filters and paint untouched. */
export function setNetworkOverlaysVisible(map: MapLibreMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const id of CLEAR_HIDDEN_OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
  }
}

export interface ClearNetworkVisibilityInput {
  /** The map once its railway layers exist; null before that and while it is rebuilt. */
  readonly map: MapLibreMap | null;
  /** Bumped when a replaced style dropped the layers, so the state is applied to the new ones. */
  readonly layersRevision: number;
  /** True while the clear screen owns the map. */
  readonly active: boolean;
  readonly index: MapPresentationIndex;
  /** The player's legend selection; null means every group is shown. */
  readonly selectedGroupIds: ReadonlySet<string> | null;
  readonly targetServiceId: string;
}

/**
 * Applies the legend selection to the background lines; on the clear screen it treats the legend as fully
 * cleared and hides the progress overlays as well, so only the basemap's grey railways and the travelled
 * route remain. Leaving the clear screen runs the ordinary branch again with the player's own selection
 * (filters) and shows the overlays (layout visibility), so nothing the player set is lost.
 */
export function useClearNetworkVisibility(
  { map, layersRevision, active, index, selectedGroupIds, targetServiceId }: ClearNetworkVisibilityInput,
): void {
  useEffect(() => {
    if (!map) return;
    if (!active) {
      updateLineGroupVisibility(map, index, selectedGroupIds, targetServiceId);
      return;
    }
    const removal = watchRemoval(map);
    hideAllLineGroups(map, targetServiceId);
    setNetworkOverlaysVisible(map, false);
    return () => {
      if (!removal.isRemoved()) setNetworkOverlaysVisible(map, true);
      removal.stop();
    };
  }, [map, layersRevision, active, index, selectedGroupIds, targetServiceId]);
}
