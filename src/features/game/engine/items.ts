import {
  type BeneficialItemKind,
  type HarmfulItemKind,
  type ItemEffectsState,
  type ItemEvent,
  type ItemInstance,
  type ItemPolicy,
  type ServiceId,
} from "../../../types/network";
import { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS } from "../../../types/network";
import { GameEngineError } from "./errors";
import {
  consumeInventoryInstance,
  scheduleDelay,
  scheduleDetour,
  scheduleOversleep,
  scheduleSuspension,
} from "./itemEffects";
import { drawIndex, seedRng } from "./rng";

export interface PendingItemDiscard {
  item: ItemInstance;
  candidates: readonly ItemInstance[];
  nextItemRngState: string;
}

export interface ItemDropResult {
  inventory: ItemInstance[];
  effects: ItemEffectsState;
  events: ItemEvent[];
  pendingDiscard?: PendingItemDiscard;
  nextItemRngState: string;
}

export function seedItemRng(seed: string): string {
  return seedRng(`${seed}|items`);
}

function invalid(message: string): never {
  throw new GameEngineError("INVALID_STATE", message);
}

function ensurePool<T extends string>(pool: readonly T[], known: readonly T[], name: string): void {
  if (pool.length === 0 || pool.some((kind) => !known.includes(kind))) invalid(`${name} item pool is empty or invalid`);
}

function makeInstance(kind: BeneficialItemKind, turn: number, inventory: readonly ItemInstance[]): ItemInstance {
  const item = { id: `item-${turn}`, kind };
  if (inventory.some((held) => held.id === item.id)) invalid(`Duplicate item instance id ${item.id}`);
  return item;
}

function applyHarmful(
  kind: HarmfulItemKind,
  turn: number,
  policy: ItemPolicy,
  inventory: readonly ItemInstance[],
  effects: ItemEffectsState,
  rngState: string,
  arrivalServices: readonly ServiceId[],
): ItemDropResult {
  const certificate = inventory.find((item) => item.kind === "delay-certificate");
  if (certificate) {
    const consumed = consumeInventoryInstance(inventory, certificate.id);
    return {
      inventory: consumed.inventory,
      effects: { ...effects, delayDueTurns: [...effects.delayDueTurns], suspensions: effects.suspensions.map((entry) => ({ ...entry })) },
      events: [{ type: "cancelled-by-certificate", item: kind, certificate: consumed.consumed }],
      nextItemRngState: rngState,
    };
  }

  if (kind === "delay") {
    const dueTurn = turn + policy.delayTurns;
    return {
      inventory: inventory.map((item) => ({ ...item })),
      effects: scheduleDelay(effects, dueTurn),
      events: [{ type: "harmful-scheduled", item: kind, effect: kind, dueTurn }],
      nextItemRngState: rngState,
    };
  }
  if (kind === "detour") {
    return { inventory: inventory.map((item) => ({ ...item })), effects: scheduleDetour(effects), events: [{ type: "harmful-scheduled", item: kind, effect: kind }], nextItemRngState: rngState };
  }
  if (kind === "oversleep") {
    return { inventory: inventory.map((item) => ({ ...item })), effects: scheduleOversleep(effects), events: [{ type: "harmful-scheduled", item: kind, effect: kind }], nextItemRngState: rngState };
  }

  if (arrivalServices.length === 0) invalid("Suspension requires at least one arrival service");
  let serviceIndex = 0;
  let nextItemRngState = rngState;
  if (arrivalServices.length > 1) {
    const targetDraw = drawIndex(rngState, arrivalServices.length);
    serviceIndex = targetDraw.index;
    nextItemRngState = targetDraw.nextRngState;
  }
  const serviceId = arrivalServices[serviceIndex];
  if (serviceId === undefined) invalid("Suspension target service is missing");
  const expiresTurn = turn + policy.suspensionTurns;
  return {
    inventory: inventory.map((item) => ({ ...item })),
    effects: scheduleSuspension(effects, serviceId, expiresTurn),
    events: [{ type: "harmful-scheduled", item: kind, effect: kind, serviceId, expiresTurn }],
    nextItemRngState,
  };
}

/** Resolve a single arrival's drop using only the serialized item RNG stream. */
export function drawItemDrop(
  rngState: string,
  turn: number,
  policy: ItemPolicy,
  inventory: readonly ItemInstance[],
  effects: ItemEffectsState,
  arrivalServices: readonly ServiceId[],
): ItemDropResult {
  ensurePool(policy.beneficialKinds, BENEFICIAL_ITEM_KINDS, "beneficial");
  ensurePool(policy.harmfulKinds, HARMFUL_ITEM_KINDS, "harmful");
  const dropDraw = drawIndex(rngState, 1000);
  if (dropDraw.index >= policy.dropChancePerMille) {
    return { inventory: inventory.map((item) => ({ ...item })), effects: { ...effects, delayDueTurns: [...effects.delayDueTurns], suspensions: effects.suspensions.map((entry) => ({ ...entry })) }, events: [], nextItemRngState: dropDraw.nextRngState };
  }

  const harmfulDraw = drawIndex(dropDraw.nextRngState, 100);
  const harmful = harmfulDraw.index < policy.harmfulChancePercent;
  const pool: readonly string[] = harmful ? policy.harmfulKinds : policy.beneficialKinds;
  const kindDraw = pool.length > 1
    ? drawIndex(harmfulDraw.nextRngState, pool.length)
    : { index: 0, nextRngState: harmfulDraw.nextRngState };
  const kind = pool[kindDraw.index];
  if (kind === undefined) invalid("Item pool draw did not resolve an item");
  if (harmful) {
    return applyHarmful(kind as HarmfulItemKind, turn, policy, inventory, effects, kindDraw.nextRngState, arrivalServices);
  }

  const item = makeInstance(kind as BeneficialItemKind, turn, inventory);
  if (inventory.length >= policy.inventoryCapacity) {
    const candidates = [...inventory.map((held) => ({ ...held })), item];
    return {
      inventory: inventory.map((held) => ({ ...held })),
      effects: { ...effects, delayDueTurns: [...effects.delayDueTurns], suspensions: effects.suspensions.map((entry) => ({ ...entry })) },
      events: [{ type: "pickup-pending-discard", item: { ...item }, candidates }],
      pendingDiscard: { item: { ...item }, candidates, nextItemRngState: kindDraw.nextRngState },
      nextItemRngState: kindDraw.nextRngState,
    };
  }
  return {
    inventory: [...inventory.map((held) => ({ ...held })), item],
    effects: { ...effects, delayDueTurns: [...effects.delayDueTurns], suspensions: effects.suspensions.map((entry) => ({ ...entry })) },
    events: [{ type: "pickup-retained", item: { ...item } }],
    nextItemRngState: kindDraw.nextRngState,
  };
}

/** Commit a full-inventory choice; any candidate, including the new pickup, may be discarded. */
export function resolvePendingItemDiscard(
  pending: PendingItemDiscard,
  inventory: readonly ItemInstance[],
  discardedId: string,
): { inventory: ItemInstance[]; events: ItemEvent[]; nextItemRngState: string } {
  if (!pending.candidates.some((item) => item.id === discardedId)) invalid(`Unknown discard choice ${discardedId}`);
  if (inventory.length !== pending.candidates.length - 1 ||
      pending.candidates.some((candidate) => candidate.id !== pending.item.id && !inventory.some((held) => held.id === candidate.id))) {
    invalid("Inventory no longer matches the pending discard");
  }
  const discarded = pending.candidates.find((item) => item.id === discardedId)!;
  const retained = pending.candidates.filter((item) => item.id !== discardedId);
  return {
    inventory: retained.map((item) => ({ ...item })),
    events: [
      { type: "discarded", item: { ...discarded } },
      ...(discardedId === pending.item.id ? [] : [{ type: "pickup-retained" as const, item: { ...pending.item } }]),
    ],
    nextItemRngState: pending.nextItemRngState,
  };
}
