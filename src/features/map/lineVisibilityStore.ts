import { useSyncExternalStore } from "react";

export type VisibleLineGroupIds = ReadonlySet<string> | null;

let visibleLineGroupIds: VisibleLineGroupIds = null;
const listeners = new Set<() => void>();

export function subscribeVisibleLineGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVisibleLineGroupIds(): VisibleLineGroupIds {
  return visibleLineGroupIds;
}

export function setVisibleLineGroupIds(groupIds: Iterable<string> | null): void {
  const next = groupIds === null ? null : new Set(groupIds);
  if (sameSelection(visibleLineGroupIds, next)) return;
  visibleLineGroupIds = next;
  for (const listener of listeners) listener();
}

/** Null is the compact representation of the default, all-visible state. */
export function useVisibleLineGroupIds(): VisibleLineGroupIds {
  return useSyncExternalStore(
    subscribeVisibleLineGroups,
    getVisibleLineGroupIds,
    () => null,
  );
}

export function updateLineGroupSelection(
  current: VisibleLineGroupIds,
  allGroupIds: readonly string[],
  changedGroupIds: readonly string[],
  checked: boolean,
): ReadonlySet<string> | null {
  const next = new Set(current ?? allGroupIds);
  for (const groupId of changedGroupIds) {
    if (checked) next.add(groupId);
    else next.delete(groupId);
  }
  return allGroupIds.every((groupId) => next.has(groupId)) ? null : next;
}

function sameSelection(first: VisibleLineGroupIds, second: VisibleLineGroupIds): boolean {
  if (first === null || second === null) return first === second;
  return first.size === second.size && [...first].every((groupId) => second.has(groupId));
}
