/** A route list above this size starts collapsed on every viewport. */
export const MAX_EXPANDED_LEGEND_GROUPS = 6;

/** Keep the regional 134-group list out of the initial control-panel view. */
export function defaultLegendExpanded(rowCount: number): boolean {
  return rowCount <= MAX_EXPANDED_LEGEND_GROUPS;
}
