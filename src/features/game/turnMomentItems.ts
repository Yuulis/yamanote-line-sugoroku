import type { ItemSessionView } from "./itemSession";

/** Keep origin-derived item facts visible while borrowing the current callback identity. */
export function maskTurnMomentItemView(
  originView: ItemSessionView | null,
  liveView: ItemSessionView | null,
  consumedIds: readonly string[],
): ItemSessionView | null {
  if (!originView) return liveView;
  const consumed = new Set(consumedIds);
  return {
    ...originView,
    identity: liveView?.identity ?? originView.identity,
    inventory: originView.inventory.filter((owned) => !consumed.has(owned.id)),
    usableItems: originView.usableItems.filter((owned) => !consumed.has(owned.instanceId)),
    decision: null,
    events: [],
  };
}
