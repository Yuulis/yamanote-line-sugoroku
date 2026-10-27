import { describe, expect, it } from "vitest";
import {
  drawIndex, drawItemDrop, resolvePendingItemDiscard, seedItemRng,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemEffectsState, ItemInstance, ItemPolicy } from "../../src/types/network";
import { deepFreeze } from "./fixtures/yamanote";

const policy = ITEM_GAME_CONFIG.itemPolicy!;
const emptyEffects: ItemEffectsState = { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false };

function stateWithFirstDraw(value: number): string {
  return `sfc32-v1:${value.toString(16).padStart(8, "0")}:00000000:00000000:00000000`;
}

function stateWithFirstZeroAndSecondIndex(index: number): string {
  const counter = (index + 99) >>> 0;
  const firstWord = (-counter) >>> 0;
  return `sfc32-v1:${firstWord.toString(16).padStart(8, "0")}:00000000:00000000:${counter.toString(16).padStart(8, "0")}`;
}

describe("item drop draws", () => {
  it("uses the exact 299/300 drop boundary", () => {
    const yes = drawItemDrop(stateWithFirstDraw(299), 1, policy, [], emptyEffects, ["service"]);
    const no = drawItemDrop(stateWithFirstDraw(300), 1, policy, [], emptyEffects, ["service"]);
    expect(yes.events).toHaveLength(1);
    expect(no.events).toEqual([]);
    expect(no.nextItemRngState).not.toBe(stateWithFirstDraw(300));
  });

  it("uses the exact 29/30 harmful boundary", () => {
    const at29 = drawItemDrop(stateWithFirstZeroAndSecondIndex(29), 1, policy, [], emptyEffects, ["service"]);
    const at30 = drawItemDrop(stateWithFirstZeroAndSecondIndex(30), 1, policy, [], emptyEffects, ["service"]);
    expect(at29.events[0]?.type).toBe("harmful-scheduled");
    expect(at30.events[0]?.type).toBe("pickup-retained");
  });

  it("can draw every configured kind from its ordered pool", () => {
    const found = new Set<string>();
    for (let index = 0; index < 2_000 && found.size < policy.beneficialKinds.length + policy.harmfulKinds.length; index += 1) {
      const result = drawItemDrop(seedItemRng(`pool-${index}`), index + 1, policy, [], emptyEffects, ["service", "other"]);
      const event = result.events[0];
      if (event?.type === "pickup-retained") found.add(event.item.kind);
      if (event?.type === "harmful-scheduled") found.add(event.item);
    }
    expect(found).toEqual(new Set([...policy.beneficialKinds, ...policy.harmfulKinds]));
  });

  it("returns all four discard candidates and honors each valid choice", () => {
    const held: ItemInstance[] = deepFreeze([
      { id: "a", kind: "double" }, { id: "b", kind: "rapid" }, { id: "c", kind: "deadhead" },
    ]);
    const before = JSON.stringify({ held, emptyEffects });
    const fullPolicy: ItemPolicy = { ...policy, beneficialKinds: ["roll-adjust"] };
    const pending = drawItemDrop(stateWithFirstZeroAndSecondIndex(30), 4, fullPolicy, held, emptyEffects, ["service"]).pendingDiscard!;
    expect(pending.candidates).toHaveLength(4);
    for (const id of pending.candidates.map((item) => item.id)) {
      const resolved = resolvePendingItemDiscard(pending, held, id);
      expect(resolved.inventory).toHaveLength(3);
      expect(resolved.inventory.some((item) => item.id === id)).toBe(false);
      expect(resolved.events.map((event) => event.type)).toContain("discarded");
    }
    expect(() => resolvePendingItemDiscard(pending, held, "missing")).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(JSON.stringify({ held, emptyEffects })).toBe(before);
  });

  it("consumes duplicate certificates oldest first, one per harmful pickup", () => {
    const certificates: ItemInstance[] = [
      { id: "cert-1", kind: "delay-certificate" }, { id: "cert-2", kind: "delay-certificate" },
    ];
    const harmfulPolicy = { ...policy, harmfulKinds: ["delay"] as const };
    const first = drawItemDrop(stateWithFirstZeroAndSecondIndex(0), 2, harmfulPolicy, certificates, emptyEffects, ["service"]);
    const second = drawItemDrop(stateWithFirstZeroAndSecondIndex(0), 3, harmfulPolicy, first.inventory, first.effects, ["service"]);
    expect(first.events[0]).toMatchObject({ type: "cancelled-by-certificate", certificate: { id: "cert-1" } });
    expect(second.events[0]).toMatchObject({ type: "cancelled-by-certificate", certificate: { id: "cert-2" } });
    expect(second.inventory).toEqual([]);
  });

  it("schedules delay for exactly acquisition turn plus the configured delay", () => {
    const delayPolicy = { ...policy, harmfulKinds: ["delay"] as const };
    const result = drawItemDrop(stateWithFirstZeroAndSecondIndex(0), 12, delayPolicy, [], emptyEffects, ["service"]);
    expect(result.events).toEqual([{ type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 15 }]);
    expect(result.effects.delayDueTurns).toEqual([15]);
  });

  it("does not draw a suspension target after certificate cancellation", () => {
    const harmfulPolicy = { ...policy, harmfulKinds: ["suspension", "delay"] as const };
    for (let candidate = 0; candidate < 10_000; candidate += 1) {
      const state = seedItemRng(`cancel-target-${candidate}`);
      const first = drawIndex(state, 1000);
      const harmful = drawIndex(first.nextRngState, 100);
      const kind = drawIndex(harmful.nextRngState, 2);
      if (first.index === 0 && harmful.index < 30 && kind.index === 0) {
        const cancelled = drawItemDrop(state, 5, harmfulPolicy,
          [{ id: "certificate", kind: "delay-certificate" }], emptyEffects, ["a", "b"]);
        expect(cancelled.events[0]?.type).toBe("cancelled-by-certificate");
        expect(cancelled.nextItemRngState).toBe(kind.nextRngState);
        return;
      }
    }
    throw new Error("Could not find a deterministic suspension draw state");
  });
});
