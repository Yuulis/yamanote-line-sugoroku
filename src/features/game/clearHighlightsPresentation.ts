import type { ItemKind } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import type { ClearHighlights } from "./clearResult";
import { ITEM_DESCRIPTIONS } from "./itemPresentation";
import { serviceName, stationName } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";

export interface ClearHighlightRow {
  readonly key: "longest-ride" | "most-used-line" | "farthest-station" | "used-items" | "avoided-items";
  readonly label: string;
  readonly value: string;
}

export interface ClearHighlightContext {
  readonly network: RailwayNetwork;
  readonly presentation: PresentationResolver;
  readonly startStationId: string;
  readonly targetServiceId: string;
}

const NO_ITEMS_TEXT = "なし";
const ITEM_SEPARATOR = "、";
const DISTANCE_FRACTION_DIGITS = 1;

/** A line group id is a service id when the edition defines no group for it, so both resolve through one lookup. */
function lineGroupName(groupId: string, context: ClearHighlightContext): string {
  const group = context.presentation.lineGroups().find((candidate) => candidate.id === groupId);
  return group?.name ?? serviceName(context.network, groupId, context.presentation);
}

function itemCountsText<Kind extends ItemKind>(counts: ReadonlyMap<Kind, number>): string {
  if (counts.size === 0) return NO_ITEMS_TEXT;
  return [...counts]
    .map(([kind, count]) => `${ITEM_DESCRIPTIONS[kind].name}×${count}`)
    .join(ITEM_SEPARATOR);
}

/** On-screen highlight rows in display order. A row without a value is omitted; item rows read 「なし」 when empty. */
export function buildClearHighlightRows(
  highlights: ClearHighlights,
  context: ClearHighlightContext,
): readonly ClearHighlightRow[] {
  const { network, presentation } = context;
  const rows: ClearHighlightRow[] = [];
  const { longestRide, mostUsedLine, farthestStation } = highlights;
  if (longestRide) {
    rows.push({
      key: "longest-ride",
      label: "最長の乗車",
      value: `${lineGroupName(longestRide.groupId, context)} ${longestRide.count}駅（${
        stationName(network, longestRide.fromStationId, presentation)}→${
        stationName(network, longestRide.toStationId, presentation)}）`,
    });
  }
  if (mostUsedLine) {
    rows.push({
      key: "most-used-line",
      label: `最も使った路線（${serviceName(network, context.targetServiceId, presentation)}以外）`,
      value: `${lineGroupName(mostUsedLine.groupId, context)} ${mostUsedLine.count}区間`,
    });
  }
  if (farthestStation) {
    rows.push({
      key: "farthest-station",
      label: "一番遠くまで行った駅",
      value: `${stationName(network, farthestStation.stationId, presentation)}（${
        stationName(network, context.startStationId, presentation)}から ${
        farthestStation.distanceKm.toFixed(DISTANCE_FRACTION_DIGITS)}km）`,
    });
  }
  rows.push({ key: "used-items", label: "使ったアイテム", value: itemCountsText(highlights.usedItems) });
  rows.push({ key: "avoided-items", label: "避けた不利なアイテム", value: itemCountsText(highlights.avoidedItems) });
  return rows;
}
