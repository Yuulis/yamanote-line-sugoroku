import { writeFirstTurnNotice } from "../../../src/features/game/store/notices";
import { FIRST_PLAY_HINT_IDS } from "../../../src/features/game/firstPlayGuide";
import {
  writeGuideCoachSeen,
  writeGuideHintSeen,
  writeGuideStarted,
} from "../../../src/features/game/store/guide";
import type { StorageLike } from "../../../src/features/game/store/persistence";

export function seedFirstTurnNotice(storage: StorageLike): void {
  writeFirstTurnNotice(storage);
}

/** Seed only first-play guide state; the #68 notice key remains independent. */
export function seedFirstPlayGuide(storage: StorageLike): void {
  writeGuideStarted(storage);
  writeGuideCoachSeen(storage);
  for (const hintId of FIRST_PLAY_HINT_IDS) writeGuideHintSeen(storage, hintId);
}
