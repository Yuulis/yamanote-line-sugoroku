import { describe, expect, it } from "vitest";
import {
  beginItemTurn, buildRailwayNetwork, createGame, createItemGame, finishItemTurn,
  isItemSave, movableDirections, playItemTurn, playTurn, routeTicketOptions, resolveItemDiscard, restoreGame, seedRng,
  serializeGame, verifySeededHistory,
} from "../../src/features/game/engine";
import { replayItemSave } from "../../src/features/game/engine/saveItemReplay";
import type { ItemGameState, ItemPolicy, ItemTurnCommand, ItemTurnRecord } from "../../src/types/network";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { deleteSave, readSave, SAVE_STORAGE_KEY, type StorageLike } from "../../src/features/game/store/persistence";
import { longLineInput, multiConfig, multiServiceInput } from "./fixtures/multiService";

const network = buildRailwayNetwork(multiServiceInput());
const noItems = { items: [] };
const invalid = expect.objectContaining({ code: "INVALID_SAVE" });
const rngMismatch = expect.objectContaining({ code: "RNG_MISMATCH" });
function config(overrides: Partial<ItemPolicy> = {}): ItemGameState["config"] {
  return { ...multiConfig(), rulesetVersion: "save-items-1", itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, ...overrides } };
}
function restore(state: ItemGameState): ItemGameState {
  return restoreGame(serializeGame(state), network, { expectedConfig: state.config, requireSeededRolls: true });
}
function edit(state: ItemGameState, change: (copy: ItemGameState) => void): string {
  const copy = structuredClone(state);
  change(copy);
  return serializeGame(copy);
}
function tamperPath(state: ItemGameState, path: string, value: unknown): string {
  const raw = JSON.parse(serializeGame(state)) as Record<string, unknown>;
  const keys = path.split(".");
  let parent = raw;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const key = keys.at(-1)!;
  if (value === undefined) delete parent[key];
  else parent[key] = value;
  return JSON.stringify(raw);
}
function expectRejected(state: ItemGameState, change: (copy: ItemGameState) => void, error = invalid): void {
  expect(() => restoreGame(edit(state, change), network, { expectedConfig: state.config, requireSeededRolls: true })).toThrowError(error);
}
function ride(state: ItemGameState, index = 0): Extract<ItemTurnRecord, { kind: "item-ride" }> {
  const record = state.movementHistory[index];
  if (record?.kind !== "item-ride") throw new Error("Fixture requires a ride");
  return record;
}

/** Search deterministic histories generated only by the production kernel. */
function findState(policy: Partial<ItemPolicy>, predicate: (state: ItemGameState) => boolean,
  command: (state: ItemGameState) => ItemTurnCommand = () => noItems): ItemGameState {
  for (let index = 0; index < 100; index++) {
    let state = createItemGame(config(policy), `save-v4-${index}`, network);
    for (let turn = 0; turn < 100 && state.status === "playing"; turn++) {
      if (predicate(state)) return state;
      let next = beginItemTurn(state, command(state), network).state;
      if (predicate(next)) return next;
      if (next.pending?.kind === "roll") next = finishItemTurn(next, null, network).state;
      if (predicate(next)) return next;
      if (next.pending?.kind === "discard") next = resolveItemDiscard(next, next.pending.item.id).state;
      state = next;
    }
    if (predicate(state)) return state;
  }
  throw new Error("No matching save fixture");
}
const beneficial = { dropChancePerMille: 1000, harmfulChancePercent: 0, beneficialKinds: ["double"] } as const;
const firstDrop = findState(beneficial, (state) => state.turn === 1 && state.pending === null);
const pendingDiscard = findState(beneficial, (state) => state.pending?.kind === "discard");
const delayed = findState({ dropChancePerMille: 1000, harmfulChancePercent: 100, harmfulKinds: ["delay"] },
  (state) => state.turn === 1 && state.pending === null);
const suspended = findState({ dropChancePerMille: 1000, harmfulChancePercent: 100, harmfulKinds: ["suspension"] },
  (state) => state.turn === 1 && state.pending === null);
const completed = findState({ dropChancePerMille: 0 }, (state) => state.status === "completed");

describe("save v4 envelopes and item decision round trips", () => {
  it("round trips classic under v4 and keeps its record shape", () => {
    const state = playTurn(createGame(multiConfig(), "classic-v4", network), network).state;
    expect(state.saveVersion).toBe(4);
    expect(state.movementHistory[0]).not.toHaveProperty("kind");
    expect(restoreGame(serializeGame(state), network, { requireSeededRolls: true })).toEqual(state);
  });
  it.each(["settled", "pending-roll", "pending-discard", "completed"] as const)("restores %s and resumes identically", (phase) => {
    const state = phase === "settled" ? firstDrop : phase === "pending-roll" ? beginItemTurn(firstDrop, noItems, network).state
      : phase === "pending-discard" ? pendingDiscard : completed;
    const restored = restore(state);
    expect(restored).toEqual(state);
    if (state.pending?.kind === "roll") expect(finishItemTurn(restored, null, network)).toEqual(finishItemTurn(state, null, network));
    else if (state.pending?.kind === "discard") {
      for (const candidate of state.pending.candidates) {
        expect(resolveItemDiscard(restored, candidate.id)).toEqual(resolveItemDiscard(state, candidate.id));
      }
    } else if (state.status === "playing") expect(playItemTurn(restored, {}, network)).toEqual(playItemTurn(state, {}, network));
  });
  it("restores a pending roll at turn zero without consuming another die", () => {
    const state = beginItemTurn(createItemGame(config(), "turn-zero", network), noItems, network).state;
    expect(state.turn).toBe(0);
    expect(restore(state)).toEqual(state);
    expect(() => beginItemTurn(restore(state), noItems, network)).toThrow();
  });
  it.each([firstDrop, pendingDiscard])("deep-freezes reconstructed transcripts and their nested arrays", (base) => {
    const state = base.pending ? base : beginItemTurn(base, noItems, network).state;
    const restored = restore(state);
    function checkFrozen(value: unknown): void {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(checkFrozen);
    }
    checkFrozen(restored.pending);
    expect(Object.isFrozen(restored)).toBe(false);
  });
  it("accepts reordered object keys, retaining meaningful inventory/event array order", () => {
    const raw = JSON.parse(serializeGame(pendingDiscard));
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reorder(nested)])) : value;
    expect(restoreGame(JSON.stringify(reorder(raw)), network, { expectedConfig: pendingDiscard.config })).toEqual(pendingDiscard);
  });
  it("round trips consumed items and the deadhead record variant", () => {
    for (const kind of ["double", "deadhead"] as const) {
      const state = findState({ ...beneficial, beneficialKinds: [kind] }, (current) => current.movementHistory.some((record) => record.command.items.length > 0),
        (current) => current.inventory[0] ? { items: [{ kind, instanceId: current.inventory[0].id }] } : noItems);
      expect(restore(state)).toEqual(state);
      expect(state.movementHistory.at(-1)?.kind).toBe(kind === "deadhead" ? "deadhead" : "item-ride");
    }
  });
  it("round trips route/direction ticket choices and roll adjustment from acquired inventory", () => {
    for (const kind of ["route-ticket", "direction-ticket", "roll-adjust"] as const) {
      let seen = false;
      for (let seed = 0; seed < 30 && !seen; seed++) {
        let state = createItemGame(config({ ...beneficial, beneficialKinds: [kind] }), `ticket-${seed}`, network);
        for (let turn = 0; turn < 80 && state.status === "playing" && !seen; turn++) {
          const held = state.inventory[0];
          let command: ItemTurnCommand = noItems;
          if (held && kind === "route-ticket") {
            const { options } = routeTicketOptions(state, { turn: state.turn + 1, suspensions: [] }, network);
            if (options.services.length > 1) command = { items: [{ kind, instanceId: held.id, serviceId: options.services[0]! }] };
          } else if (held && kind === "direction-ticket" && state.currentServiceId !== state.config.targetServiceId &&
              movableDirections(network, state.currentServiceId, state.currentStationId).length === 2) {
            command = { items: [{ kind, instanceId: held.id, direction: -1 }] };
          }
          const rolled = beginItemTurn(state, command, network).state;
          expect(restore(rolled)).toEqual(rolled);
          const adjustment = kind === "roll-adjust" && held && rolled.pending?.kind === "roll"
            ? { instanceId: held.id, delta: rolled.pending.rawRoll === 6 ? -1 as const : 1 as const } : null;
          let next = finishItemTurn(rolled, adjustment, network).state;
          if (next.pending?.kind === "discard") next = resolveItemDiscard(next, next.pending.item.id).state;
          if (command.items.length || adjustment) {
            expect(restore(next)).toEqual(next);
            seen = true;
          }
          state = next;
        }
      }
      expect(seen).toBe(true);
    }
  });
  it("round trips automatic certificate cancellation and both deferred harmful flags", () => {
    const cancelled = findState({ dropChancePerMille: 1000, harmfulChancePercent: 50,
      beneficialKinds: ["delay-certificate"], harmfulKinds: ["suspension"] },
      (state) => state.movementHistory.some((record) => record.itemEvents.some((event) => event.type === "cancelled-by-certificate")));
    expect(restore(cancelled)).toEqual(cancelled);
    for (const kind of ["detour", "oversleep"] as const) {
      const state = findState({ dropChancePerMille: 1000, harmfulChancePercent: 100, harmfulKinds: [kind] },
        (current) => current.turn === 3 && current.pending === null);
      expect(restore(state)).toEqual(state);
    }
  });
  it("restores every recorded legal discard choice, including discarding the new pickup", () => {
    if (pendingDiscard.pending?.kind !== "discard") throw new Error("Expected discard");
    for (const candidate of pendingDiscard.pending.candidates) {
      const next = resolveItemDiscard(pendingDiscard, candidate.id).state;
      expect(restore(next)).toEqual(next);
      expect(next.movementHistory.at(-1)?.discardedInstanceId).toBe(candidate.id);
    }
  });
  it.each([delayed, suspended])("round trips scheduled and subsequently activated/expired effects", (state) => {
    expect(restore(state)).toEqual(state);
    let next = state;
    for (let index = 0; index < 4 && next.status === "playing"; index++) {
      next = playItemTurn(next, {}, network).state;
      expect(restore(next)).toEqual(next);
    }
  });
});

describe("save v4 strict parsing and structural legality", () => {
  it.each(["inventory", "effects", "itemRngState", "pending", "rngState", "movementHistory", "config"])("requires %s", (key) => {
    const raw = JSON.parse(serializeGame(firstDrop));
    delete raw[key];
    expect(() => restoreGame(JSON.stringify(raw), network)).toThrowError(invalid);
  });
  it.each([
    ["root", "extra", true],
    ["config", "config.extra", true],
    ["record", "movementHistory.0.extra", true],
    ["event", "movementHistory.0.itemEvents.0.extra", true],
    ["instance", "inventory.0.extra", true],
    ["effects", "effects.extra", true],
    ["missing record field", "movementHistory.0.landingSnapshot", undefined],
    ["missing effect flag", "effects.detourPending", undefined],
    ["unknown item", "inventory.0.kind", "unknown"],
    ["malformed instance", "inventory.0.id", "held-1"],
    ["future instance", "inventory.0.id", "item-2"],
    ["unknown variant", "movementHistory.0.kind", "ride"],
    ["classic record variant", "movementHistory.0.roll", 3],
    ["unknown suspension service", "effects.suspensions", [{ serviceId: "unknown", expiresTurn: 2 }]],
  ] as const)("rejects %s", (_label, path, value) => {
    expect(() => restoreGame(tamperPath(firstDrop, path, value), network)).toThrowError(invalid);
  });
  it("rejects illegal item consumption even when the instance id is well formed", () => {
    expectRejected(firstDrop, (copy) => { ride(copy).command = { items: [{ kind: "double", instanceId: "item-1" }] }; });
  });
  it("rejects raw die, movement, landing snapshot and record metadata forgery", () => {
    expectRejected(firstDrop, (copy) => { ride(copy).rawRoll = ride(copy).rawRoll === 1 ? 2 : 1; });
    expectRejected(firstDrop, (copy) => { ride(copy).rawRoll = 7; });
    expectRejected(firstDrop, (copy) => { ride(copy).physicalHops++; });
    expectRejected(firstDrop, (copy) => { ride(copy).landing = null; });
    expectRejected(firstDrop, (copy) => { ride(copy).landingSnapshot!.services[0]!.weight++; });
  });
  it("rejects capacity, duplicate ids, inventory and effect flag forgery", () => {
    expectRejected(firstDrop, (copy) => { copy.inventory.push(...copy.inventory); });
    expectRejected(pendingDiscard, (copy) => { copy.inventory.push({ id: "item-1", kind: "double" }); });
    expectRejected(firstDrop, (copy) => { copy.inventory = []; });
    expectRejected(firstDrop, (copy) => { copy.effects = { ...copy.effects, oversleepPending: true }; });
  });
  it("rejects forged delay and suspension timers, including plausible but incorrect bounds", () => {
    for (const offset of [-1, 1, 100]) {
      expectRejected(delayed, (copy) => {
        copy.effects = { ...copy.effects, delayDueTurns: [copy.effects.delayDueTurns[0]! + offset] };
      });
      expectRejected(suspended, (copy) => {
        copy.effects = { ...copy.effects, suspensions: copy.effects.suspensions.map((entry) => ({ ...entry, expiresTurn: entry.expiresTurn + offset })) };
      });
    }
    expectRejected(delayed, (copy) => {
      const event = ride(copy).itemEvents[0];
      if (event?.type !== "harmful-scheduled" || event.effect !== "delay") throw new Error("Expected delay");
      event.dueTurn++;
    });
    expectRejected(suspended, (copy) => {
      const event = ride(copy).itemEvents[0];
      if (event?.type !== "harmful-scheduled" || event.effect !== "suspension") throw new Error("Expected suspension");
      event.expiresTurn++;
    });
  });
  it("rejects certificate cancellation without an owned certificate", () => {
    expectRejected(delayed, (copy) => {
      ride(copy).itemEvents = [{ type: "cancelled-by-certificate", item: "delay", certificate: { id: "item-1", kind: "delay-certificate" } }];
      copy.effects = { ...copy.effects, delayDueTurns: [] };
    });
  });
  it("rejects an illegal discard choice and replayed consumption of a discarded instance", () => {
    if (pendingDiscard.pending?.kind !== "discard") throw new Error("Expected discard");
    const state = resolveItemDiscard(pendingDiscard, pendingDiscard.pending.item.id).state;
    expectRejected(state, (copy) => { copy.movementHistory.at(-1)!.discardedInstanceId = "item-999"; });
    expectRejected(state, (copy) => { copy.movementHistory.at(-1)!.discardedInstanceId = null; });
  });
  it.each([
    ["completed with pending", "status", "completed"],
    ["wrong turn", "pending.turn", pendingDiscard.turn + 2],
    ["unknown pending field", "pending.extra", true],
    ["missing candidates", "pending.candidates", undefined],
    ["nested history", "pending.position.movementHistory", []],
    ["nested config", "pending.position.config.itemPolicy.delayTurns", pendingDiscard.config.itemPolicy.delayTurns + 1],
    ["nested rng", "pending.position.rngState", "bad"],
    ["nested version", "pending.position.saveVersion", 3],
    ["candidate forgery", "pending.candidates", []],
    ["pickup forgery", "pending.item.id", "item-99"],
    ["premature choice", "pending.record.discardedInstanceId", "item-1"],
  ] as const)("rejects pending discard: %s", (_label, path, value) => {
    expect(() => restoreGame(tamperPath(pendingDiscard, path, value), network)).toThrowError(invalid);
  });
});

describe("save v4 seeded outcome and RNG verification", () => {
  it("ties item games to both seeds even without the classic opt-in", () => {
    const state = createItemGame(config(), "initial", network);
    expect(() => restoreGame(edit(state, (copy) => { copy.itemRngState = seedRng("other"); }), network)).toThrowError(rngMismatch);
  });
  it.each(["rngState", "itemRngState"] as const)("rejects %s at turn zero and after completed history", (field) => {
    for (const state of [createItemGame(config(), "zero", network), firstDrop, completed, pendingDiscard]) {
      expectRejected(state, (copy) => { copy[field] = seedRng("different"); }, rngMismatch);
      expectRejected(state, (copy) => { copy[field] = "bad"; });
    }
  });
  it("rejects an internally consistent die/outcome trajectory under another seed", () => {
    const other = createItemGame(firstDrop.config, "another-seed", network);
    expectRejected(firstDrop, (copy) => { copy.rngSeed = other.rngSeed; }, rngMismatch);
  });
  it("rejects a legal alternative landing while structural validation still succeeds", () => {
    const state = findState({ dropChancePerMille: 0 }, (current) => current.turn === 1 && current.pending === null &&
      (ride(current).landingSnapshot?.services.length ?? 0) > 1);
    const record = ride(state);
    const alternative = record.landingSnapshot!.services.find((service) => service.serviceId !== record.landing!.serviceId)!;
    expectRejected(state, (copy) => {
      const landing = { serviceId: alternative.serviceId, direction: alternative.directions[0]! };
      ride(copy).landing = landing;
      copy.currentServiceId = landing.serviceId;
      copy.direction = landing.direction;
    }, rngMismatch);
  });
  it("rejects a legal alternative drop kind consistently forged in events and inventory", () => {
    const state = findState({ ...beneficial, beneficialKinds: ["double", "rapid"] }, (current) => current.turn === 1 && current.pending === null);
    expectRejected(state, (copy) => {
      const kind = copy.inventory[0]!.kind === "double" ? "rapid" : "double";
      copy.inventory[0]!.kind = kind;
      const event = ride(copy).itemEvents[0];
      if (event?.type !== "pickup-retained") throw new Error("Expected pickup");
      event.item.kind = kind;
    }, rngMismatch);
  });
  it("rejects a legal alternative suspension target with a consistently forged timer state", () => {
    const state = findState({ dropChancePerMille: 1000, harmfulChancePercent: 100, harmfulKinds: ["suspension"] },
      (current) => current.turn === 1 && current.pending === null && (network.servicesByStation.get(current.currentStationId)?.length ?? 0) > 1);
    expectRejected(state, (copy) => {
      const event = ride(copy).itemEvents[0];
      if (event?.type !== "harmful-scheduled" || event.effect !== "suspension") throw new Error("Expected suspension");
      const serviceId = network.servicesByStation.get(copy.currentStationId)!.find((id) => id !== event.serviceId)!;
      event.serviceId = serviceId;
      copy.effects = { ...copy.effects, suspensions: [{ serviceId, expiresTurn: event.expiresTurn }] };
    }, rngMismatch);
  });
  it("checks the pending roll's raw die and RNG after reconstructing completed history", () => {
    const state = beginItemTurn(firstDrop, noItems, network).state;
    for (const field of ["rawRoll", "rngStateAfterRoll"] as const) {
      expectRejected(state, (copy) => {
        if (copy.pending?.kind !== "roll") throw new Error("Expected roll");
        copy.pending = field === "rawRoll" ? { ...copy.pending, rawRoll: copy.pending.rawRoll === 1 ? 2 : 1 }
          : { ...copy.pending, rngStateAfterRoll: seedRng("different") };
      }, rngMismatch);
    }
  });
  it("checks every pending discard RNG, including the provisional position", () => {
    for (const field of ["nextItemRngState", "rngState", "itemRngState"] as const) {
      expectRejected(pendingDiscard, (copy) => {
        if (copy.pending?.kind !== "discard") throw new Error("Expected discard");
        copy.pending = field === "nextItemRngState" ? { ...copy.pending, nextItemRngState: seedRng("different") }
          : { ...copy.pending, position: { ...copy.pending.position, [field]: seedRng("different") } };
      }, rngMismatch);
    }
  });
  it("verifies one read per history record and restores a 1,200-turn item game", () => {
    const long = buildRailwayNetwork(longLineInput());
    let state = createItemGame(config({ dropChancePerMille: 0 }), "long-118", long);
    while (state.status === "playing" && state.turn < 1200) state = playItemTurn(state, {}, long).state;
    expect(state.turn).toBe(1200);
    let reads = 0;
    const movementHistory = new Proxy(state.movementHistory, { get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    verifySeededHistory({ ...state, movementHistory }, long);
    expect(reads).toBe(1200);
    reads = 0;
    replayItemSave({ ...state, movementHistory }, long, false);
    expect(reads).toBe(1200);
    expect(restoreGame(serializeGame(state), long, { expectedConfig: state.config })).toEqual(state);
  });
});

describe("v4 version rejection and byte-preserving persistence", () => {
  it.each([1, 2, 3, 5])("rejects version %d before malformed data/config/history and preserves stored bytes", (saveVersion) => {
    const bytes = ` { "saveVersion": ${saveVersion}, "config": null, "movementHistory": "bad" }\n`;
    const values = new Map([[SAVE_STORAGE_KEY, bytes]]);
    const storage: StorageLike = { getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
    expect(() => restoreGame(bytes, network)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_SAVE_VERSION" }));
    for (let index = 0; index < 2; index++) expect(readSave(storage, network, multiConfig())).toEqual({ kind: "invalid", problem: "unsupported-version" });
    expect(values.get(SAVE_STORAGE_KEY)).toBe(bytes);
    expect(deleteSave(storage)).toBe(true);
    expect(readSave(storage, network, multiConfig())).toEqual({ kind: "none" });
  });
  it("checks config mismatch before either replay and identifies item states", () => {
    expect(isItemSave(restore(firstDrop))).toBe(true);
    expect(() => restoreGame(serializeGame(firstDrop), network, { expectedConfig: multiConfig() })).toThrowError(expect.objectContaining({ code: "CONFIG_MISMATCH" }));
  });
});
