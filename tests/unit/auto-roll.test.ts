import { describe, expect, it } from "vitest";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { startSession, type GameSession, type LastMove } from "../../src/features/game/gameSession";
import type { AutoRollSnapshot } from "../../src/features/game/autoRoll";
import {
  AUTO_ROLL_GAP_MS, autoRollBaseline, autoRollDisposition, autoRollPickupOutcome, autoRollReadyKey,
} from "../../src/features/game/autoRoll";
import type { ItemEvent, ItemTurnRecord } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";

const { network } = await loadBundle("fixture");

function record(
  turn: number,
  itemEvents: ItemEvent[] = [],
  discardedInstanceId: string | null = null,
): ItemTurnRecord {
  return {
    kind: "item-ride", turn, fromStationId: "shinagawa", toStationId: "tamachi",
    command: { items: [] }, resolvedRide: { serviceId: "jr-yamanote", direction: 1 },
    rawRoll: 4, effectiveFace: 4, adjustment: null, movementMode: "normal", pips: 4, hopBudget: 4,
    physicalHops: 1, unusedPips: 3, stopReason: "roll", traversedSegmentIds: [], landing: null,
    landingSnapshot: null, itemEvents, discardedInstanceId,
  };
}

function move(itemRecord: ItemTurnRecord | null): LastMove | null {
  if (itemRecord === null) return null;
  return {
    roll: itemRecord.kind === "item-ride" ? itemRecord.effectiveFace : null,
    itemRecord, unusedPips: itemRecord.kind === "item-ride" ? itemRecord.unusedPips : 0,
    stopReason: itemRecord.kind === "item-ride" ? itemRecord.stopReason : "relocation",
    stopStationId: itemRecord.toStationId, serviceId: "jr-yamanote", direction: 1,
    endpointKind: null, landing: null,
  };
}

function snapshot(overrides: Partial<AutoRollSnapshot> = {}): AutoRollSnapshot {
  return {
    readyKey: "1:0:0", visible: true, canRoll: true, phase: "published", decision: null,
    publishedMove: null, surfaceOpen: false, itemDialogOpen: false, confirmationOpen: false,
    draftSelected: false, ...overrides,
  };
}

function sessionAt(sessionId: number, turn: number, decisionRevision: number): GameSession {
  const session = startSession(ITEM_GAME_CONFIG, "auto-roll-ready-key", network, sessionId);
  return {
    ...session,
    game: { ...session.game, turn },
    item: { ...session.item!, decisionRevision },
  };
}

describe("auto-roll pure predicates", () => {
  it("uses a fixed ready gap", () => {
    expect(AUTO_ROLL_GAP_MS).toBe(1_200);
  });

  it.each<ItemEvent>([
    { type: "pickup-retained", item: { id: "new", kind: "route-ticket" } },
    { type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 3 },
    { type: "cancelled-by-certificate", item: "oversleep", certificate: { id: "certificate", kind: "delay-certificate" } },
  ])("classifies %s as a stop outcome", (event) => {
    expect(autoRollPickupOutcome(record(1, [event]))).toBe("stop");
  });

  it("waits for an unresolved pending discard", () => {
    const pending = { type: "pickup-pending-discard", item: { id: "new", kind: "route-ticket" }, candidates: [] } as const;
    expect(autoRollPickupOutcome(record(1, [pending]))).toBe("await-discard");
  });

  it("resumes when the new item itself was discarded and stops when an old item was discarded", () => {
    const newItem = { id: "new", kind: "route-ticket" } as const;
    const pending = { type: "pickup-pending-discard", item: newItem, candidates: [] } as const;
    const discardedNew = record(1, [pending, { type: "discarded", item: newItem }], "new");
    const discardedOld = record(1, [pending, { type: "discarded", item: { id: "old", kind: "double" } }], "old");

    expect(autoRollPickupOutcome(discardedNew)).toBe("discarded-new");
    expect(autoRollPickupOutcome(discardedOld)).toBe("stop");
  });

  it("ignores unrelated events, existing inventory, absent moves and classic moves", () => {
    const unrelated: ItemEvent[] = [
      { type: "consumed", item: { id: "used", kind: "double" } },
      { type: "discarded", item: { id: "old", kind: "double" } },
      { type: "effect-activated", effect: "delay" },
      { type: "effect-expired", effect: "suspension", serviceId: "jr-yamanote" },
    ];
    const classicMove: LastMove = {
      roll: 4, unusedPips: 0, stopReason: "roll", stopStationId: "tamachi",
      serviceId: "jr-yamanote", direction: 1, endpointKind: null, landing: null,
    };

    expect(autoRollPickupOutcome(record(1, unrelated))).toBe("none");
    expect(autoRollDisposition(snapshot(), true, 0).kind).toBe("ready");
    expect(autoRollDisposition(snapshot({ publishedMove: null }), true, 0).kind).toBe("ready");
    expect(autoRollDisposition(snapshot({ publishedMove: classicMove }), true, 0).kind).toBe("ready");
  });

  it.each([3, 4] as const)("does not stop for a pickup outcome at or before baseline turn 4", (turn) => {
    const event: ItemEvent = { type: "pickup-retained", item: { id: "new", kind: "route-ticket" } };
    expect(autoRollDisposition(snapshot({ publishedMove: move(record(turn, [event])) }), true, 4)).toEqual({ kind: "ready" });
  });

  it.each(["pickup-retained", "harmful-scheduled", "cancelled-by-certificate"] as const)(
    "does not stop for a %s record at the baseline",
    (type) => {
      const event: ItemEvent = type === "pickup-retained"
        ? { type, item: { id: "new", kind: "route-ticket" } }
        : type === "harmful-scheduled"
          ? { type, item: "detour", effect: "detour" }
          : { type, item: "oversleep", certificate: { id: "certificate", kind: "delay-certificate" } };
      expect(autoRollDisposition(snapshot({ publishedMove: move(record(4, [event])) }), true, 4)).toEqual({ kind: "ready" });
    },
  );

  it.each(["pre-move", "moving", "arrival", "segment-flash", "lottery-flip", "lottery-settle", "pickup"] as const)(
    "never stops on the unpublished %s phase",
    (phase) => {
      const pickup = record(2, [{ type: "pickup-retained", item: { id: "new", kind: "route-ticket" } }]);
      expect(autoRollDisposition(snapshot({ phase, canRoll: false, publishedMove: move(pickup) }), true, 0).kind).not.toBe("stop");
    },
  );

  it.each(["adjust", "discard"] as const)("waits for a visible %s decision before a pickup stop", (kind) => {
    const decision: NonNullable<AutoRollSnapshot["decision"]> = kind === "adjust"
      ? { kind, turn: 2, rawRoll: 4, resolvedRide: { serviceId: "jr-yamanote", direction: 1 }, allowedDeltas: [-1, 1], itemInstanceIds: ["adjust"], canContinue: true }
      : { kind, turn: 2, candidates: [{ id: "old", kind: "double" }], newItemInstanceId: "new" };
    expect(autoRollDisposition(snapshot({ decision, publishedMove: move(record(2, [
      { type: "pickup-retained", item: { id: "new", kind: "route-ticket" } },
    ])) }), true, 0)).toEqual({ kind: "wait", reason: kind });
  });

  it("stops for a published pickup before pausing for an open surface", () => {
    const pickup = record(2, [{ type: "pickup-retained", item: { id: "new", kind: "route-ticket" } }]);
    expect(autoRollDisposition(snapshot({ surfaceOpen: true, publishedMove: move(pickup) }), true, 0)).toEqual({ kind: "stop", reason: "pickup" });
  });

  it.each([
    [{ canRoll: false }, "presentation"],
    [{ surfaceOpen: true }, "surface"],
    [{ itemDialogOpen: true }, "dialog"],
    [{ confirmationOpen: true }, "dialog"],
    [{ draftSelected: true }, "draft"],
  ] as const)("pauses for %s", (overrides, reason) => {
    expect(autoRollDisposition(snapshot(overrides), true, 0)).toEqual({ kind: "pause", reason });
  });

  it("returns off before other states and stops when the enabled tab is hidden", () => {
    expect(autoRollDisposition(snapshot({ visible: false }), false, 0)).toEqual({ kind: "off" });
    expect(autoRollDisposition(snapshot({ visible: false, canRoll: false }), true, 0)).toEqual({ kind: "stop", reason: "hidden" });
  });

  it("waits on a resolving snapshot that still carries an unresolved published discard", () => {
    const pending = record(3, [{
      type: "pickup-pending-discard", item: { id: "new", kind: "route-ticket" }, candidates: [],
    }]);
    expect(autoRollDisposition(snapshot({ phase: "published", canRoll: false, publishedMove: move(pending) }), true, 2)).toEqual({ kind: "wait", reason: "discard" });
  });

  it("uses the published record turn as the ON baseline, except for an unresolved discard", () => {
    expect(autoRollBaseline(null)).toBe(0);
    expect(autoRollBaseline(move(record(7)))).toBe(7);
    expect(autoRollBaseline(move(record(7, [{
      type: "pickup-pending-discard", item: { id: "new", kind: "route-ticket" }, candidates: [],
    }])))).toBe(6);
    expect(autoRollBaseline(move(record(7, [
      { type: "pickup-pending-discard", item: { id: "new", kind: "route-ticket" }, candidates: [] },
      { type: "discarded", item: { id: "old", kind: "double" } },
    ], "old")))).toBe(7);
  });

  it("judges both resolved discard outcomes against the baseline taken during the pending decision", () => {
    const pendingItem = { id: "new", kind: "route-ticket" } as const;
    const pending = { type: "pickup-pending-discard", item: pendingItem, candidates: [] } as const;
    const baseline = autoRollBaseline(move(record(7, [pending])));
    const discardedNew = move(record(7, [pending, { type: "discarded", item: pendingItem }], "new"));
    const discardedOld = move(record(7, [pending, { type: "discarded", item: { id: "old", kind: "double" } }], "old"));

    expect(autoRollDisposition(snapshot({ publishedMove: discardedNew }), true, baseline)).toEqual({ kind: "ready" });
    expect(autoRollDisposition(snapshot({ publishedMove: discardedOld }), true, baseline)).toEqual({ kind: "stop", reason: "pickup" });
  });

  it("keys readiness by session, turn and item decision revision", () => {
    const base = sessionAt(1, 3, 0);
    expect(autoRollReadyKey(base)).toBe("1:3:0");
    expect(autoRollReadyKey(sessionAt(2, 3, 0))).not.toBe(autoRollReadyKey(base));
    expect(autoRollReadyKey(sessionAt(1, 4, 0))).not.toBe(autoRollReadyKey(base));
    expect(autoRollReadyKey(sessionAt(1, 3, 1))).not.toBe(autoRollReadyKey(base));
  });
});
