import type { StorageLike } from "./persistence";

/** Deliberately free of the word "save": E2E storage stubs throw on such keys. */
export const FIRST_TURN_NOTICE_KEY = "yamanote-line-sugoroku:notice:auto-resume:v1";
const FIRST_TURN_NOTICE_SEEN = "1";

/** True only when the stored flag is exactly "1"; absent, invalid or unreadable storage reads as unset. */
export function readFirstTurnNotice(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(FIRST_TURN_NOTICE_KEY) === FIRST_TURN_NOTICE_SEEN;
  } catch {
    return false;
  }
}

/** Mark the notice as seen. Returns whether the browser accepted the write. */
export function writeFirstTurnNotice(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(FIRST_TURN_NOTICE_KEY, FIRST_TURN_NOTICE_SEEN);
    return true;
  } catch {
    return false;
  }
}
