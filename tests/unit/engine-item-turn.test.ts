import { describe, expect, it } from "vitest";
import {
  beginItemTurn, buildRailwayNetwork, createGame, createItemGame, drawIndex, drawWeightedIndex,
  finishItemTurn, playItemTurn, playTurn, moveByRoll, resolveItemDiscard, rollDie, seedItemRng,
  seedRng,
} from "../../src/features/game/engine";
import type {
  BeneficialItemKind, ItemGameState, ItemPolicy, ItemRollAdjustment,
  ItemTurnCommand, PreRollItemCommand,
} from "../../src/types/network";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { deepFreeze, inputWithShuttle, SEGMENT_IDS, START, OTHER_SERVICE_ID, yamanoteInput } from "./fixtures/yamanote";

const network = buildRailwayNetwork(multiServiceInput());
const noItems: ItemTurnCommand = { items: [] };
const policy = ITEM_GAME_CONFIG.itemPolicy!;

function game(seed = "item-turn", overrides: Partial<ItemPolicy> = {}): ItemGameState {
  return createItemGame({
    ...multiConfig(), rulesetVersion: "test-items-1",
    serviceLottery: { kindWeights: { local: 1, rapid: 1 }, target: { kind: "share", numerator: 1, denominator: 2 } },
    directionLottery: { towardTargetWeight: 3, awayFromTargetWeight: 2 },
    itemPolicy: { ...policy, dropChancePerMille: 0, ...overrides },
  }, seed, network);
}

function holding(state: ItemGameState, ...kinds: BeneficialItemKind[]): ItemGameState {
  return { ...state, inventory: kinds.map((kind, index) => ({ id: `held-${index}`, kind })) };
}

function command(kind: PreRollItemCommand["kind"], extra: object = {}): ItemTurnCommand {
  return { items: [{ kind, instanceId: "held-0", ...extra } as PreRollItemCommand] };
}

function withRawRoll(face: number): ItemGameState {
  for (let seed = 0; seed < 100; seed++) {
    const state = game(`face-${seed}`);
    if (rollDie(state.rngState).value === face) return state;
  }
  throw new Error(`No seed for face ${face}`);
}

function expectInvalid(action: () => unknown, code = "INVALID_STATE"): void {
  expect(action).toThrowError(expect.objectContaining({ code }));
}

describe("item game creation and compatibility", () => {
  it("initializes the item stream and empty JSON-safe item state from ITEM_GAME_CONFIG", () => {
    const realNetwork = buildRailwayNetwork(inputWithShuttle());
    const state = createItemGame(ITEM_GAME_CONFIG, "creation", realNetwork);
    expect(state).toMatchObject({ inventory: [], pending: null, itemRngState: seedRng("creation|items"),
      effects: { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false } });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expectInvalid(() => createItemGame(multiConfig(), "creation", network), "INVALID_CONFIG");
  });

  it("retains the classic state/record shape and rejects item-mode use of classic transitions", () => {
    const classic = createGame(multiConfig(), "classic", network);
    expect(classic).not.toHaveProperty("pending");
    expect(classic).not.toHaveProperty("itemRngState");
    expect(playTurn(classic, network).state.movementHistory[0]).not.toHaveProperty("kind");
    // The classic entry points also guard callers with broadly typed configs.
    const item = createGame({ ...multiConfig(), itemPolicy: policy }, "classic", network);
    expectInvalid(() => playTurn(item, network));
    expectInvalid(() => moveByRoll(item, 1, network));
  });
});

describe("phased and composed transitions", () => {
  it.each(["double", "rapid", "deadhead", "route-ticket", "direction-ticket", "none"] as const)("composes the same %s transitions", (kind) => {
    let state = { ...game(), currentStationId: "b" };
    if (kind === "direction-ticket") state = { ...state, currentServiceId: M_LINE };
    state = kind === "none" ? state : holding(state, kind);
    const action = kind === "none" ? noItems : command(kind,
      kind === "route-ticket" ? { serviceId: M_SPUR } : kind === "direction-ticket" ? { direction: -1 } : {});
    const before = structuredClone(state);
    const began = beginItemTurn(deepFreeze(state), deepFreeze(action), network);
    const phased = began.state.pending?.kind === "roll" ? finishItemTurn(began.state, null, network) : began;
    expect(playItemTurn(state, { command: action }, network)).toEqual(phased);
    expect(state).toEqual(before);
    expect(phased.record?.itemEvents.filter((event) => event.type === "consumed")).toHaveLength(kind === "none" ? 0 : 1);
    if (kind !== "deadhead") {
      expect(began.state).toMatchObject({ turn: 0, movementHistory: [], rngState: state.rngState,
        currentStationId: "b", inventory: state.inventory, effects: state.effects, itemRngState: state.itemRngState });
      expect(JSON.parse(JSON.stringify(began.state))).toEqual(began.state);
      expect(finishItemTurn(JSON.parse(JSON.stringify(began.state)), null, network)).toEqual(phased);
    }
  });

  it("records rapid pips separately from physical hops", () => {
    const state = holding({ ...withRawRoll(2), currentStationId: "x", currentServiceId: M_LINE }, "rapid");
    const result = playItemTurn(state, { command: command("rapid") }, network);
    expect(result.record).toMatchObject({ kind: "item-ride", rawRoll: 2, effectiveFace: 2,
      movementMode: "rapid", pips: 2, hopBudget: 3, physicalHops: 3, unusedPips: 0, toStationId: "d" });
  });

  it("doubles the die face before movement", () => {
    const state = holding({ ...withRawRoll(2), currentStationId: "b", currentServiceId: M_SPUR }, "double");
    expect(playItemTurn(state, { command: command("double") }, network).record).toMatchObject({
      rawRoll: 2, effectiveFace: 2, pips: 4, hopBudget: 4, physicalHops: 2, unusedPips: 2, stopReason: "endpoint",
    });
  });

  it("retains direction-ticket choice in the resolved ride", () => {
    const state = holding({ ...game(), currentStationId: "y", currentServiceId: M_LINE }, "direction-ticket");
    expect(playItemTurn(state, { command: command("direction-ticket", { direction: -1 }) }, network).record)
      .toMatchObject({ resolvedRide: { serviceId: M_LINE, direction: -1 } });
  });

  it("freezes a copy of the pre-actions and rejects any new command while pending", () => {
    const state = holding({ ...game(), currentStationId: "b" }, "route-ticket");
    const action = { items: [{ kind: "route-ticket" as const, instanceId: "held-0", serviceId: M_LINE }] };
    const began = beginItemTurn(state, action, network);
    action.items[0]!.serviceId = M_SPUR;
    expect(began.state.pending).toMatchObject({ command: { items: [{ serviceId: M_LINE }] } });
    expectInvalid(() => beginItemTurn(began.state, noItems, network));
    expectInvalid(() => playItemTurn(began.state, {}, network));
    const result = finishItemTurn(began.state, null, network);
    expect(result.record).toMatchObject({ command: { items: [{ serviceId: M_LINE }] } });
    expectInvalid(() => finishItemTurn(result.state, null, network));
    expectInvalid(() => resolveItemDiscard(result.state, "held-0"));
  });

  it("freezes the committed command inside a revealed roll", () => {
    const state = holding({ ...withRawRoll(5), currentStationId: "b", currentServiceId: M_SPUR }, "double");
    const began = beginItemTurn(state, noItems, network);
    if (began.state.pending?.kind !== "roll") throw new Error("Expected roll");
    const pending = began.state.pending;
    const mutableCommand = pending.command as unknown as { items: PreRollItemCommand[] };
    expect(() => mutableCommand.items.push({ kind: "double", instanceId: "held-0" })).toThrow();
    const result = finishItemTurn(began.state, null, network);
    expect(result.record).toMatchObject({ command: { items: [] }, rawRoll: 5, pips: 5 });
  });

  it("rejects forged revealed outcomes", () => {
    const state = beginItemTurn(game(), noItems, network).state;
    if (state.pending?.kind !== "roll") throw new Error("Expected roll");
    const pending = state.pending;
    expectInvalid(() => finishItemTurn({ ...state, pending: { ...pending, rawRoll: 7 } }, null, network));
    expectInvalid(() => finishItemTurn({ ...state, pending: { ...pending, turn: 2 } }, null, network));
  });
});

describe("independent RNG streams", () => {
  it("pins route direction before die and the separate drop/classification/kind stream", () => {
    const state = holding({ ...game("ordered-streams", { dropChancePerMille: 1000, harmfulChancePercent: 0 }), currentStationId: "b" }, "route-ticket");
    const direction = drawWeightedIndex(seedRng("ordered-streams"), [1, 1]);
    const die = rollDie(direction.nextRngState);
    expect(direction).toEqual({ index: 1, nextRngState: "sfc32-v1:670a4f14:23bc6cf5:7c111782:00000011" });
    expect(die).toEqual({ value: 5, nextRngState: "sfc32-v1:23adb2c3:5c99d392:7b163e3c:00000012" });
    const began = beginItemTurn(state, command("route-ticket", { serviceId: M_LINE }), network);
    expect(began.state.pending).toMatchObject({ rawRoll: die.value, rngStateAfterRoll: die.nextRngState,
      resolvedRide: { serviceId: M_LINE, direction: direction.index === 0 ? 1 : -1 } });
    const result = finishItemTurn(began.state, null, network);
    const record = result.record!;
    expect(record.kind).toBe("item-ride");
    // This fixed seed reaches an endpoint: landing service and direction are forced.
    expect(record.toStationId).toBe("x");
    expect(record.landing).toEqual({ serviceId: M_LINE, direction: 1 });
    expect(result.state.rngState).toBe(die.nextRngState);
    const drop = drawIndex(seedItemRng("ordered-streams"), 1000);
    const harmful = drawIndex(drop.nextRngState, 100);
    const kind = drawIndex(harmful.nextRngState, policy.beneficialKinds.length);
    expect(result.state.itemRngState).toBe(kind.nextRngState);
    expect(result.state.inventory).toEqual([{ id: "item-1", kind: policy.beneficialKinds[kind.index] }]);
    expect(state.itemRngState).toBe(seedItemRng("ordered-streams"));
  });

  it("draws landing service followed by a two-way landing direction", () => {
    // Face 2 from start lands at b; suspension forces the line, which still draws direction.
    const state = withRawRoll(2);
    const suspended = { ...state, effects: { ...state.effects, suspensions: [
      { serviceId: M_LOOP, expiresTurn: 5 }, { serviceId: M_SPUR, expiresTurn: 5 },
    ] } };
    const die = rollDie(suspended.rngState);
    const direction = drawWeightedIndex(die.nextRngState, [1, 1]);
    const result = playItemTurn(suspended, {}, network);
    expect(result.state.rngState).toBe(direction.nextRngState);
    expect(result.record?.landing).toEqual({ serviceId: M_LINE, direction: direction.index === 0 ? 1 : -1 });
    const unsuspended = playItemTurn(state, {}, network);
    const service = drawWeightedIndex(die.nextRngState, [2, 1, 1]);
    const next = service.index === 1 ? drawWeightedIndex(service.nextRngState, [1, 1]).nextRngState : service.nextRngState;
    expect(unsuspended.state.rngState).toBe(next);
  });

  it("does not draw a route direction when the selected service is target or has only one exit", () => {
    const state = holding({ ...game(), currentStationId: "b" }, "route-ticket");
    for (const serviceId of [M_LOOP, M_SPUR]) {
      expect(beginItemTurn(state, command("route-ticket", { serviceId }), network).state.pending)
        .toMatchObject({ rawRoll: rollDie(state.rngState).value, rngStateAfterRoll: rollDie(state.rngState).nextRngState });
    }
  });
});

describe("active item validation and adjustment", () => {
  it("rejects missing ownership, passive/harmful commands and two-item bundles", () => {
    expectInvalid(() => beginItemTurn(game(), command("double"), network));
    expectInvalid(() => beginItemTurn(game(), { items: [null] } as unknown as ItemTurnCommand, network));
    expectInvalid(() => beginItemTurn(game(), { items: [{ kind: "double" }] } as unknown as ItemTurnCommand, network));
    const state = holding(game(), "double", "rapid");
    expectInvalid(() => beginItemTurn(state, { items: [command("double").items[0]!, { kind: "rapid", instanceId: "held-1" }] }, network));
    expectInvalid(() => beginItemTurn(holding(game(), "delay-certificate"), command("delay-certificate" as PreRollItemCommand["kind"]), network));
    expectInvalid(() => beginItemTurn(holding(game(), "roll-adjust"), command("roll-adjust" as PreRollItemCommand["kind"]), network));
  });

  it("rejects an impossible rapid before committing a revealed roll", () => {
    const isolated = buildRailwayNetwork(yamanoteInput());
    const state = holding(createItemGame(ITEM_GAME_CONFIG, "isolated-rapid", isolated), "rapid");
    expectInvalid(() => beginItemTurn(deepFreeze(state), command("rapid"), isolated));
    expect(state.pending).toBeNull();
  });

  it("rejects direction tickets on target and at endpoints", () => {
    expectInvalid(() => beginItemTurn(holding(game(), "direction-ticket"), command("direction-ticket", { direction: -1 }), network));
    expectInvalid(() => beginItemTurn(holding({ ...game(), currentStationId: "x", currentServiceId: M_LINE }, "direction-ticket"), command("direction-ticket", { direction: 1 }), network));
    expectInvalid(() => beginItemTurn(holding({ ...game(), currentStationId: "b", currentServiceId: M_LINE }, "direction-ticket"), command("direction-ticket", { direction: 0 }), network));
  });

  it("filters route tickets by suspension and requires a real service choice", () => {
    const state = holding({ ...game(), currentStationId: "b" }, "route-ticket");
    const suspended = { ...state, effects: { ...state.effects, suspensions: [{ serviceId: M_LINE, expiresTurn: 1 }] } };
    expectInvalid(() => beginItemTurn(suspended, command("route-ticket", { serviceId: M_LINE }), network));
    expect(beginItemTurn(suspended, command("route-ticket", { serviceId: M_LOOP }), network).state.pending).toMatchObject({ resolvedRide: { serviceId: M_LOOP } });
    expectInvalid(() => beginItemTurn({ ...suspended, effects: { ...suspended.effects, suspensions: [
      ...suspended.effects.suspensions, { serviceId: M_SPUR, expiresTurn: 1 },
    ] } }, command("route-ticket", { serviceId: M_LOOP }), network));
    expectInvalid(() => beginItemTurn(holding(game(), "route-ticket"), command("route-ticket", { serviceId: M_LOOP }), network));
    expectInvalid(() => beginItemTurn(state, command("route-ticket", { serviceId: "unknown" }), network));
  });

  it.each([-1, 1] as const)("adjusts by %s using one owned item, with phased/composed equality", (delta) => {
    const state = holding(withRawRoll(3), "roll-adjust");
    const adjustment = { instanceId: "held-0", delta };
    const began = beginItemTurn(deepFreeze(state), noItems, network);
    const result = finishItemTurn(deepFreeze(began.state), deepFreeze(adjustment), network);
    expect(playItemTurn(state, { adjustment }, network)).toEqual(result);
    expect(result.record).toMatchObject({ rawRoll: 3, effectiveFace: 3 + delta, pips: 3 + delta, adjustment });
    expect(result.state.inventory).toEqual([]);
  });

  it("rejects adjustment after pre-roll use, without ownership, outside face bounds or with invalid deltas", () => {
    const state = holding(withRawRoll(3), "double", "roll-adjust");
    const began = beginItemTurn(state, command("double"), network).state;
    expectInvalid(() => finishItemTurn(began, { instanceId: "held-1", delta: 1 }, network));
    expectInvalid(() => finishItemTurn(beginItemTurn(game(), noItems, network).state, { instanceId: "missing", delta: 1 }, network));
    for (const [face, delta] of [[1, -1], [6, 1]] as const) {
      const pending = beginItemTurn(holding(withRawRoll(face), "roll-adjust"), noItems, network).state;
      expectInvalid(() => finishItemTurn(pending, { instanceId: "held-0", delta }, network), "INVALID_ROLL");
      expect(pending.turn).toBe(0);
    }
    const pending = beginItemTurn(holding(withRawRoll(3), "roll-adjust"), noItems, network).state;
    expectInvalid(() => finishItemTurn(pending, { instanceId: "held-0", delta: 0 } as unknown as ItemRollAdjustment, network));
  });
});

describe("forced effects, clearing and deadhead", () => {
  it.each(["delay", "oversleep", "both"] as const)("blocks all active items on %s turns and consumes the normal die", (effect) => {
    const start = holding({ ...withRawRoll(4), currentStationId: "b", currentServiceId: M_LINE }, "double", "roll-adjust");
    const state = { ...start, effects: { ...start.effects,
      delayDueTurns: effect === "oversleep" ? [] : [1, 4], oversleepPending: effect !== "delay" } };
    expectInvalid(() => beginItemTurn(state, command("double"), network));
    const began = beginItemTurn(state, noItems, network).state;
    expect(began.pending).toMatchObject({ rawRoll: 4, rngStateAfterRoll: rollDie(state.rngState).nextRngState });
    expectInvalid(() => finishItemTurn(began, { instanceId: "held-1", delta: 1 }, network));
    const result = finishItemTurn(began, null, network);
    expect(result.record).toMatchObject(effect === "delay" ? { movementMode: "normal", effectiveFace: 1, physicalHops: 1, toStationId: "y" }
      : { movementMode: "oversleep", effectiveFace: 4, physicalHops: 3, toStationId: "z" });
    expect(result.state.effects).toMatchObject({ delayDueTurns: effect === "oversleep" ? [] : [4], oversleepPending: false });
    expect(result.state.inventory).toEqual(state.inventory);
  });

  it("oversleeps six hops on a loop and skips clearing-turn landing and item draws", () => {
    const base = game("clearing", { dropChancePerMille: 1000 });
    const state = { ...base, effects: { ...base.effects, oversleepPending: true } };
    const result = playItemTurn(deepFreeze(state), {}, network);
    expect(result.record).toMatchObject({ movementMode: "oversleep", hopBudget: 6, physicalHops: 6,
      stopReason: "goal", landing: null, landingSnapshot: null });
    expect(result.state.status).toBe("completed");
    expect(result.state.rngState).toBe(rollDie(state.rngState).nextRngState);
    expect(result.state.itemRngState).toBe(state.itemRngState);
    expect(result.record?.itemEvents.some((event) => event.type.startsWith("pickup"))).toBe(false);
    expectInvalid(() => beginItemTurn(result.state, noItems, network), "GAME_NOT_PLAYING");
  });

  it("deadhead uses no die, lottery, segments or clear, but drops at the arrival", () => {
    const realNetwork = buildRailwayNetwork(inputWithShuttle());
    const base = createItemGame({ ...ITEM_GAME_CONFIG, itemPolicy: { ...policy, dropChancePerMille: 1000, harmfulChancePercent: 0, beneficialKinds: ["double"] } }, "deadhead", realNetwork);
    const state = holding({ ...base, currentStationId: "test-b", currentServiceId: OTHER_SERVICE_ID,
      completedSegmentIds: [...SEGMENT_IDS], effects: { ...base.effects, detourPending: true } }, "deadhead");
    const result = beginItemTurn(deepFreeze(state), command("deadhead"), realNetwork);
    expect(result.record).toMatchObject({ kind: "deadhead", rawRoll: null, effectiveFace: null,
      physicalHops: 0, traversedSegmentIds: [], landing: null, stopReason: "relocation", toStationId: START });
    expect(result.state).toMatchObject({ status: "playing", turn: 1, currentStationId: START, rngState: state.rngState,
      completedSegmentIds: SEGMENT_IDS, inventory: [{ id: "item-1", kind: "double" }], effects: { detourPending: true } });
    expect(result.state.itemRngState).not.toBe(state.itemRngState);
    expect(result.events.some((event) => event.type === "landing-resolved" || event.type === "segment-traversed")).toBe(false);
    expectInvalid(() => playItemTurn(state, { command: command("deadhead"), adjustment: { instanceId: "held-1", delta: 1 } }, realNetwork));
    expectInvalid(() => beginItemTurn(holding(state, "deadhead", "double"), { items: [command("deadhead").items[0]!, { kind: "double", instanceId: "held-1" }] }, realNetwork));
  });

  it("retains detour until an alternative landing exists, then consumes it after suspension filtering", () => {
    const base = withRawRoll(1);
    const state = { ...base, effects: { ...base.effects, detourPending: true } };
    const waiting = playItemTurn(state, {}, network);
    expect(waiting.record?.landingSnapshot).toMatchObject({ detourConsumed: false });
    expect(waiting.state.effects.detourPending).toBe(true);
    const consumed = playItemTurn({ ...state, currentStationId: "a", effects: { ...state.effects,
      suspensions: [{ serviceId: M_LOOP, expiresTurn: 1 }, { serviceId: M_SPUR, expiresTurn: 1 }] } }, {}, network);
    expect(consumed.record?.landingSnapshot).toMatchObject({ detourConsumed: true, services: [{ serviceId: M_LINE }] });
    expect(consumed.state.effects.detourPending).toBe(false);
    expect(consumed.record?.itemEvents).toContainEqual({ type: "effect-activated", effect: "detour" });
  });

  it("emits suspension expiry at the first turn after its inclusive expiry", () => {
    const state = game();
    const result = playItemTurn({ ...state, effects: { ...state.effects, suspensions: [{ serviceId: M_LINE, expiresTurn: 0 }] } }, {}, network);
    expect(result.record?.itemEvents).toContainEqual({ type: "effect-expired", effect: "suspension", serviceId: M_LINE });
    expect(result.state.effects.suspensions).toEqual([]);
  });
});

describe("arrival drops and saveable full inventory", () => {
  it.each(["held-0", "held-1", "held-2", "item-1"])("discards choice %s and commits exactly one record", (discardedInstanceId) => {
    const state = holding({ ...withRawRoll(1), config: { ...game().config, itemPolicy: {
      ...policy, dropChancePerMille: 1000, harmfulChancePercent: 0, beneficialKinds: ["rapid"],
    } } }, "double", "roll-adjust", "delay-certificate");
    const began = beginItemTurn(deepFreeze(state), noItems, network);
    const arrived = finishItemTurn(deepFreeze(began.state), null, network);
    expect(arrived.state.pending).toMatchObject({ kind: "discard", turn: 1, item: { id: "item-1", kind: "rapid" } });
    expect(arrived.state).toMatchObject({ turn: 0, movementHistory: [], inventory: state.inventory,
      rngState: state.rngState, itemRngState: state.itemRngState, currentStationId: state.currentStationId });
    expect(arrived.record).toBeNull();
    expectInvalid(() => beginItemTurn(arrived.state, command("double"), network));
    expectInvalid(() => finishItemTurn(arrived.state, null, network));
    expectInvalid(() => resolveItemDiscard(arrived.state, "missing"));
    const resolved = resolveItemDiscard(deepFreeze(arrived.state), discardedInstanceId);
    expect(resolved.state.turn).toBe(1);
    expect(resolved.state.pending).toBeNull();
    expect(resolved.state.movementHistory).toHaveLength(1);
    expect(resolved.record?.discardedInstanceId).toBe(discardedInstanceId);
    expect(resolved.record?.itemEvents).toContainEqual({ type: "discarded", item: expect.objectContaining({ id: discardedInstanceId }) });
    expect(resolved.state.inventory.map((item) => item.id)).toEqual(["held-0", "held-1", "held-2", "item-1"].filter((id) => id !== discardedInstanceId));
    expect(resolveItemDiscard(JSON.parse(JSON.stringify(arrived.state)), discardedInstanceId)).toEqual(resolved);
    const atomic = playItemTurn(state, { discardedInstanceId }, network);
    expect(atomic.state).toEqual(resolved.state);
    expect(atomic.events).toEqual([...arrived.events, ...resolved.events]);
    expect(playItemTurn(state, {}, network)).toEqual(arrived);
    expectInvalid(() => resolveItemDiscard(resolved.state, discardedInstanceId));
  });

  it("returns independent mutable state and record copies after discard", () => {
    const state = holding({ ...withRawRoll(1), config: { ...game().config, itemPolicy: {
      ...policy, dropChancePerMille: 1000, harmfulChancePercent: 0, beneficialKinds: ["rapid"],
    } } }, "double", "roll-adjust", "delay-certificate");
    const arrived = finishItemTurn(beginItemTurn(state, noItems, network).state, null, network);
    if (arrived.state.pending?.kind !== "discard") throw new Error("Expected discard");
    const transcript = arrived.state.pending;
    const originalEffects = structuredClone(transcript.position.effects);
    const originalSegments = [...transcript.position.completedSegmentIds];
    const originalInventory = structuredClone(transcript.position.inventory);
    const originalCommand = structuredClone(transcript.record.command);
    const resolved = resolveItemDiscard(arrived.state, "held-0");

    expect(resolved.state.effects).not.toBe(transcript.position.effects);
    expect(resolved.state.completedSegmentIds).not.toBe(transcript.position.completedSegmentIds);
    expect(resolved.state.inventory).not.toBe(transcript.position.inventory);
    expect(resolved.record?.command).not.toBe(transcript.record.command);
    resolved.state.effects = { ...resolved.state.effects, suspensions: [{ serviceId: M_LINE, expiresTurn: 9 }] };
    resolved.state.completedSegmentIds.push("mutated-segment" as typeof SEGMENT_IDS[number]);
    resolved.state.inventory.push({ id: "mutated", kind: "rapid" });
    (resolved.record!.command.items as PreRollItemCommand[]).push({ kind: "double", instanceId: "mutated" });

    expect(transcript.position.effects).toEqual(originalEffects);
    expect(transcript.position.completedSegmentIds).toEqual(originalSegments);
    expect(transcript.position.inventory).toEqual(originalInventory);
    expect(transcript.record.command).toEqual(originalCommand);
  });

  it("deadhead frees a slot before its arrival drop with a full starting inventory", () => {
    const state = holding(game("deadhead-drop", { dropChancePerMille: 1000, harmfulChancePercent: 0, beneficialKinds: ["double"] }), "deadhead", "rapid", "roll-adjust");
    const result = beginItemTurn(deepFreeze(state), command("deadhead"), network);
    expect(result.state.pending).toBeNull();
    expect(result.record).toMatchObject({ kind: "deadhead", discardedInstanceId: null });
    expect(result.state.inventory.map((item) => item.id)).toEqual(["held-1", "held-2", "item-1"]);
  });

  it.each(["delay", "suspension", "detour", "oversleep"] as const)("schedules %s only after the landing and cancels it with a passive certificate", (kind) => {
    const state = { ...withRawRoll(2), config: { ...game().config, itemPolicy: {
      ...policy, dropChancePerMille: 1000, harmfulChancePercent: 100, harmfulKinds: [kind],
    } } };
    const result = playItemTurn(deepFreeze(state), {}, network);
    expect(result.record?.itemEvents).toContainEqual(expect.objectContaining({ type: "harmful-scheduled", effect: kind }));
    const landingIndex = result.events.findIndex((event) => event.type === "landing-resolved");
    const effectIndex = result.events.findIndex((event) => event.type === "harmful-scheduled");
    expect(effectIndex).toBeGreaterThan(landingIndex);
    expect(result.record?.landingSnapshot?.services.map((service) => service.serviceId)).toEqual([M_LOOP, M_LINE, M_SPUR]);
    if (kind === "delay") expect(result.state.effects.delayDueTurns).toEqual([4]);
    if (kind === "suspension") expect(result.state.effects.suspensions[0]?.expiresTurn).toBe(6);
    if (kind === "detour") expect(result.state.effects.detourPending).toBe(true);
    if (kind === "oversleep") expect(result.state.effects.oversleepPending).toBe(true);
    const protectedState = holding(state, "delay-certificate", "delay-certificate");
    const cancelled = playItemTurn(protectedState, {}, network);
    expect(cancelled.record?.itemEvents).toContainEqual({ type: "cancelled-by-certificate", item: kind,
      certificate: { id: "held-0", kind: "delay-certificate" } });
    expect(cancelled.state.inventory).toEqual([{ id: "held-1", kind: "delay-certificate" }]);
    expect(cancelled.state.effects).toEqual(state.effects);
    const drop = drawIndex(state.itemRngState, 1000);
    const classification = drawIndex(drop.nextRngState, 100);
    expect(cancelled.state.itemRngState).toBe(classification.nextRngState);
    if (kind === "suspension") expect(result.state.itemRngState).toBe(drawIndex(classification.nextRngState, 3).nextRngState);
  });

  it("rejects a discard decision when no full-inventory choice exists", () => {
    expectInvalid(() => playItemTurn(game(), { discardedInstanceId: "missing" }, network));
  });
});
