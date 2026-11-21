import { FIRST_TURN_NOTICE_KEY } from "./notices";
import type { StorageLike } from "./persistence";
import {
  FIRST_PLAY_HINT_IDS,
  type GuideHintId,
  type GuideStorageRead,
} from "../firstPlayGuide";

export const GUIDE_STARTED_KEY = "yamanote-line-sugoroku:guide:started:v1";
export const GUIDE_COACH_KEY = "yamanote-line-sugoroku:guide:coach:v1";
export const GUIDE_HINTS_DISABLED_KEY = "yamanote-line-sugoroku:guide:hints-disabled:v1";

const GUIDE_VALUE = "1";

export function guideHintStorageKey(hintId: GuideHintId): string {
  return `yamanote-line-sugoroku:guide:hint:${hintId}:v1`;
}

function readValue(storage: StorageLike | null, key: string): GuideStorageRead {
  if (!storage) return { readable: false, value: null };
  try {
    return { readable: true, value: storage.getItem(key) };
  } catch {
    return { readable: false, value: null };
  }
}

function writeValue(storage: StorageLike | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, GUIDE_VALUE);
    return true;
  } catch {
    return false;
  }
}

export function readGuideStarted(storage: StorageLike | null): GuideStorageRead {
  return readValue(storage, GUIDE_STARTED_KEY);
}

export function writeGuideStarted(storage: StorageLike | null): boolean {
  return writeValue(storage, GUIDE_STARTED_KEY);
}

export function readGuideCoachSeen(storage: StorageLike | null): GuideStorageRead {
  return readValue(storage, GUIDE_COACH_KEY);
}

export function writeGuideCoachSeen(storage: StorageLike | null): boolean {
  return writeValue(storage, GUIDE_COACH_KEY);
}

export function readGuideHintsDisabled(storage: StorageLike | null): GuideStorageRead {
  return readValue(storage, GUIDE_HINTS_DISABLED_KEY);
}

export function writeGuideHintsDisabled(storage: StorageLike | null): boolean {
  return writeValue(storage, GUIDE_HINTS_DISABLED_KEY);
}

export function readGuideHintSeen(storage: StorageLike | null, hintId: GuideHintId): GuideStorageRead {
  return readValue(storage, guideHintStorageKey(hintId));
}

export function writeGuideHintSeen(storage: StorageLike | null, hintId: GuideHintId): boolean {
  return writeValue(storage, guideHintStorageKey(hintId));
}

/** Keep #68's unreadable state distinct so first-play eligibility can fail closed. */
export function readFirstTurnNoticeForGuide(storage: StorageLike | null): GuideStorageRead {
  return readValue(storage, FIRST_TURN_NOTICE_KEY);
}

/** Expose the immutable ids here for storage-only consumers. */
export { FIRST_PLAY_HINT_IDS };
