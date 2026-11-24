import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Direction, GameState, ItemGameState, ItemTurnRecord, MoveRecord } from "../../../src/types/network";
import type { RailwayNetwork } from "../../../src/features/game/engine";
import { directionLabel } from "../../../src/features/game/presentation";
import type { PresentationResolver } from "../../../src/features/game/presentationResolver";

type SavedHistoryRecord = MoveRecord | ItemTurnRecord;

function savedRide(record: SavedHistoryRecord): { serviceId: string; direction: Direction } {
  if (!("kind" in record)) return { serviceId: record.serviceId, direction: record.direction };
  if (record.kind === "deadhead") return { serviceId: record.relocation.serviceId, direction: record.relocation.direction };
  return record.resolvedRide;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shape-only roll check: the saved raw die comes first; adjustment and effect suffixes are covered by literals. */
function savedRollPattern(record: SavedHistoryRecord): RegExp {
  if ("kind" in record && record.kind === "deadhead") return /^回送$/;
  const raw = "kind" in record ? record.rawRoll : record.roll;
  return new RegExp(`^出目${escapeRegExp(String(raw))}(→[1-9]\\d*)?(・\\S+)*$`);
}

/** Note kinds that follow directly from saved fields (texts are pinned by literal rows elsewhere). */
function expectedNoteKinds(record: SavedHistoryRecord): { present: string[]; absent: string[] } {
  const present: string[] = [];
  const absent: string[] = [];
  if (!("kind" in record)) {
    const unused = record.roll - record.traversedSegmentIds.length;
    (unused > 0 && record.stopReason !== "roll" ? present : absent).push("truncation");
    return { present, absent };
  }
  if (record.kind === "item-ride") {
    (record.landing ? present : absent).push("landing");
    (record.unusedPips > 0 && record.stopReason !== "roll" ? present : absent).push("truncation");
    (!record.landing && record.stopReason === "goal" ? present : absent).push("goal");
  }
  (record.landingSnapshot?.suspensionIgnored ? present : absent).push("suspension");
  return { present, absent };
}

/**
 * Compare rendered cells to values read from the saved record and network, without production history formatting:
 * turn, stations, hop count and line are derived from saved fields; the roll and note texts are checked by shape
 * and kind here, and pinned exactly by the literal rows in clear-replay-share.spec.ts and tests/unit/history-rows.test.ts.
 */
export async function expectSavedHistoryRowFields(
  element: Locator,
  record: SavedHistoryRecord,
  recordIndex: number,
  network: RailwayNetwork,
  presentation: PresentationResolver,
): Promise<void> {
  const ride = savedRide(record);
  const from = presentation.serviceStationName(ride.serviceId, record.fromStationId);
  const to = presentation.serviceStationName(ride.serviceId, record.toStationId);
  const moveText = `${from} → ${to}（${record.traversedSegmentIds.length}駅）`;
  const turnText = `${record.turn}ターン目`;
  await expect(element).toHaveAttribute("data-record-index", String(recordIndex));
  await expect(element.locator(".clear-history__turn")).toHaveText(turnText);
  await expect(element.locator(".clear-history__roll")).toHaveText(savedRollPattern(record));
  await expect(element.locator(".clear-history__move")).toHaveText(moveText);
  if ("kind" in record && record.kind === "deadhead") {
    await expect(element.locator(".clear-history__line")).toHaveCount(0);
  } else {
    const service = network.servicesById.get(ride.serviceId);
    if (!service) throw new Error(`Saved turn ${record.turn} references missing service ${ride.serviceId}`);
    const lineText = `${presentation.serviceName(ride.serviceId)}・${directionLabel(network, ride.serviceId, ride.direction)}`;
    await expect(element.locator(".clear-history__line")).toHaveText(lineText);
  }
  const kinds = expectedNoteKinds(record);
  for (const kind of kinds.present) await expect(element.locator(`.clear-history__note[data-note="${kind}"]`)).toHaveCount(1);
  for (const kind of kinds.absent) await expect(element.locator(`.clear-history__note[data-note="${kind}"]`)).toHaveCount(0);
}

/** Keep the union visible to callers that load classic saves in fixture tests. */
export type SavedHistory = GameState["movementHistory"][number] | ItemGameState["movementHistory"][number];
