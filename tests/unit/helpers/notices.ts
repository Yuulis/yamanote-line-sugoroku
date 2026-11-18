import { writeFirstTurnNotice } from "../../../src/features/game/store/notices";
import type { StorageLike } from "../../../src/features/game/store/persistence";

export function seedFirstTurnNotice(storage: StorageLike): void {
  writeFirstTurnNotice(storage);
}
