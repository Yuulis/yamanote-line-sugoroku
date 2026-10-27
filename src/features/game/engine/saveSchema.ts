// Exact JSON shapes for untrusted v4 item transcripts. Semantic legality is replayed.
import { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS } from "../../../types/network";
import { GameEngineError } from "./errors";
import { isValidRngState } from "./rng";

type Shape = (value: unknown, path: string) => void;
export function invalidSave(message: string): never {
  throw new GameEngineError("INVALID_SAVE", message);
}
export function exactKeys(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some((key) => !Object.hasOwn(raw, key)) ||
      Object.keys(raw).some((key) => !required.includes(key) && !optional.includes(key))) {
    invalidSave(`Expected exactly ${required.join(", ")} (optional: ${optional.join(", ")})`);
  }
}
function object(fields: Record<string, Shape>): Shape {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) invalidSave(`${path} must be an object`);
    const raw = value as Record<string, unknown>;
    exactKeys(raw, Object.keys(fields));
    for (const [key, shape] of Object.entries(fields)) shape(raw[key], `${path}.${key}`);
  };
}
function oneOf(...values: readonly unknown[]): Shape {
  return (value, path) => { if (!values.includes(value)) invalidSave(`${path} is unknown`); };
}
function integer(min = 0, max = Number.MAX_SAFE_INTEGER): Shape {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalidSave(`${path} must be an integer ${min}-${max}`);
  };
}
const string: Shape = (value, path) => {
  if (typeof value !== "string" || value.length === 0) invalidSave(`${path} must be a non-empty string`);
};
const rng: Shape = (value, path) => { if (!isValidRngState(value)) invalidSave(`${path} is a malformed RNG state`); };
function array(shape: Shape): Shape {
  return (value, path) => {
    if (!Array.isArray(value)) invalidSave(`${path} must be an array`);
    value.forEach((entry, index) => shape(entry, `${path}[${index}]`));
  };
}
function nullable(shape: Shape): Shape {
  return (value, path) => { if (value !== null) shape(value, path); };
}
function tagged(tag: string, variants: Record<string, Shape>): Shape {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) invalidSave(`${path} must be an object`);
    const key = (value as Record<string, unknown>)[tag];
    if (typeof key !== "string" || !Object.hasOwn(variants, key)) invalidSave(`${path}.${tag} is unknown`);
    variants[key]!(value, path);
  };
}
const direction = oneOf(1, -1);
const boolean = oneOf(true, false);
const id: Shape = (value, path) => {
  string(value, path);
  if (!/^item-[1-9]\d*$/.test(value as string) || !Number.isSafeInteger(Number((value as string).slice(5)))) invalidSave(`${path} must be an item instance id`);
};
const item = object({ id, kind: oneOf(...BENEFICIAL_ITEM_KINDS) });
const ride = object({ serviceId: string, direction });
const action = tagged("kind", Object.fromEntries(["route-ticket", "direction-ticket", "double", "rapid", "deadhead"].map((kind) => [kind,
  object({ kind: oneOf(kind), instanceId: id, ...(kind === "route-ticket" ? { serviceId: string } : {}),
    ...(kind === "direction-ticket" ? { direction } : {}) }),
])));
const command = object({ items: array(action) });
const adjustment = object({ instanceId: id, delta: oneOf(-1, 1) });
const snapshot = object({ stationId: string, suspensionIgnored: boolean, detourConsumed: boolean,
  services: array(object({ serviceId: string, weight: integer(1), directions: array(direction), directionWeights: array(integer(1)) })) });
const harmful = oneOf(...HARMFUL_ITEM_KINDS);
const event = tagged("type", {
  "pickup-retained": object({ type: oneOf("pickup-retained"), item }),
  "pickup-pending-discard": object({ type: oneOf("pickup-pending-discard"), item, candidates: array(item) }),
  discarded: object({ type: oneOf("discarded"), item }),
  consumed: object({ type: oneOf("consumed"), item }),
  "cancelled-by-certificate": object({ type: oneOf("cancelled-by-certificate"), item: harmful, certificate: item }),
  "harmful-scheduled": tagged("effect", {
    delay: object({ type: oneOf("harmful-scheduled"), item: oneOf("delay"), effect: oneOf("delay"), dueTurn: integer(1) }),
    suspension: object({ type: oneOf("harmful-scheduled"), item: oneOf("suspension"), effect: oneOf("suspension"), serviceId: string, expiresTurn: integer(1) }),
    detour: object({ type: oneOf("harmful-scheduled"), item: oneOf("detour"), effect: oneOf("detour") }),
    oversleep: object({ type: oneOf("harmful-scheduled"), item: oneOf("oversleep"), effect: oneOf("oversleep") }),
  }),
  "effect-activated": object({ type: oneOf("effect-activated"), effect: oneOf("delay", "oversleep", "detour") }),
  "effect-expired": object({ type: oneOf("effect-expired"), effect: oneOf("suspension"), serviceId: string }),
});
const commonRecord = {
  turn: integer(1), fromStationId: string, toStationId: string, command,
  traversedSegmentIds: array(string), landing: nullable(ride), landingSnapshot: nullable(snapshot),
  itemEvents: array(event), discardedInstanceId: nullable(id),
};
export const itemRecordShape: Shape = tagged("kind", {
  "item-ride": object({ ...commonRecord, kind: oneOf("item-ride"), resolvedRide: ride,
    rawRoll: integer(1, 6), effectiveFace: integer(1, 6), adjustment: nullable(adjustment),
    movementMode: oneOf("normal", "rapid", "oversleep"), pips: integer(), hopBudget: integer(), physicalHops: integer(), unusedPips: integer(),
    stopReason: oneOf("roll", "goal", "endpoint") }),
  deadhead: object({ ...commonRecord, kind: oneOf("deadhead"), resolvedRide: oneOf(null), rawRoll: oneOf(null), effectiveFace: oneOf(null),
    adjustment: oneOf(null), movementMode: oneOf("deadhead"), pips: oneOf(null), hopBudget: oneOf(null), physicalHops: oneOf(0), unusedPips: oneOf(null),
    stopReason: oneOf("relocation"), relocation: object({ fromStationId: string, toStationId: string, serviceId: string, direction, distance: integer() }) }),
});
export const POSITION_KEYS = ["saveVersion", "dataVersion", "status", "config", "currentStationId", "currentServiceId", "direction", "turn", "completedSegmentIds", "rngSeed", "rngState"] as const;
export const ITEM_KEYS = ["inventory", "effects", "itemRngState"] as const;
export const itemFieldsShape: Shape = object({
  inventory: array(item), itemRngState: rng,
  effects: object({ delayDueTurns: array(integer(1)), suspensions: array(object({ serviceId: string, expiresTurn: integer(1) })),
    detourPending: boolean, oversleepPending: boolean }),
});
export const pendingShape: Shape = nullable(tagged("kind", {
  roll: object({ kind: oneOf("roll"), turn: integer(1), command, resolvedRide: ride, rawRoll: integer(1, 6), rngStateAfterRoll: rng }),
  discard: object({ kind: oneOf("discard"), turn: integer(1), item, candidates: array(item), nextItemRngState: rng,
    position: (value, path) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) invalidSave(`${path} must be an object`);
      exactKeys(value as Record<string, unknown>, [...POSITION_KEYS, ...ITEM_KEYS]);
    }, record: itemRecordShape }),
}));

/** Compare JSON objects independent of key insertion order; array order is meaningful. */
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
