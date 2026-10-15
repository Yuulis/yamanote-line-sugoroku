/** On a phone a legend with more rows than this starts collapsed; shorter ones fit as they are. */
export const PHONE_LEGEND_MAX_EXPANDED_ROWS = 6;

/** Initial state of the service legend: collapsed only for a long legend on a phone. */
export function defaultLegendExpanded(rowCount: number, onPhone: boolean): boolean {
  return !(onPhone && rowCount > PHONE_LEGEND_MAX_EXPANDED_ROWS);
}
