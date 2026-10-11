import type { StorageLike } from "./persistence";

/**
 * The page's localStorage, or null when merely touching it throws (blocked
 * cookies, sandboxed frames). No write probe: a full quota must not hide a
 * save that can still be read or deleted, so writes report their own failure.
 */
export function getBrowserStorage(): StorageLike | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
