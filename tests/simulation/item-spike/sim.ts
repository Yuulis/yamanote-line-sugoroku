// Throwaway spike (2026-10-27): Monte Carlo measurement of a station-item system
// on top of the real engine. Nothing here is product code. The engine's own
// `advance` (movement), RNG primitives and network helpers are reused; only the
// landing lottery is re-implemented so that items (suspensions, detours, route
// tickets) and alternative weightings can change the candidate list and weights.
// With items disabled and the "current" weighting the loop is draw-for-draw
// identical to `engine.playTurn` (asserted in item-spike.test.ts).

import * as engine from "../../../src/features/game/engine";
import { advance, type Advance, type GamePosition } from "../../../src/features/game/engine/movement";
import type { Direction, GameConfig, ServiceId, StationId } from "../../../src/types/network";
import { forwardAdjacency, hopsToEndpoint, nearestTargetStation, rapidHops, transferStations } from "./moves";

export interface Weighting {
  id: "uniform" | "mild" | "current" | "direction-only" | "share-only" | "mid";
  label: string;
  /** Target share [numerator, denominator] at stations with >= 2 candidates; null = uniform. */
  targetShare: readonly [number, number] | null;
  /** Direction weights [toward target, away from target]. */
  direction: readonly [number, number];
}

export const WEIGHTINGS: readonly Weighting[] = [
  { id: "uniform", label: "a-uniform", targetShare: null, direction: [1, 1] },
  { id: "mild", label: "b-mild(1/2,3:2)", targetShare: [1, 2], direction: [3, 2] },
  { id: "current", label: "c-current(2/3,2:1)", targetShare: [2, 3], direction: [2, 1] },
  // Diagnostic extras: each half of the mild weighting on its own.
  { id: "direction-only", label: "d-direction-only(uniform,3:2)", targetShare: null, direction: [3, 2] },
  { id: "share-only", label: "e-share-only(1/2,1:1)", targetShare: [1, 2], direction: [1, 1] },
  // Follow-up: mild's Yamanote share with the current direction weight.
  { id: "mid", label: "f-mid(1/2,2:1)", targetShare: [1, 2], direction: [2, 1] },
];

export const BENEFICIAL = ["route", "direction", "adjust", "double"] as const;
export const HARMFUL = ["delay", "suspension", "detour"] as const;
/** Round 2: + 快速券 (rapid), 回送列車 (deadhead), 遅延証明書 (certificate); + 寝過ごし (oversleep). */
export const BENEFICIAL_V2 = [...BENEFICIAL, "rapid", "deadhead", "certificate"] as const;
export const HARMFUL_V2 = [...HARMFUL, "oversleep"] as const;
export type BeneficialItem = (typeof BENEFICIAL_V2)[number];
export type HarmfulItem = (typeof HARMFUL_V2)[number];
export type Policy = "greedy" | "random";
/** v2 minus one new item: leave-one-out ablations that isolate each new item's effect. */
export const ABLATIONS = ["rapid", "deadhead", "certificate", "oversleep"] as const;
export type ItemSet = "v1" | "v2" | `v2-no-${(typeof ABLATIONS)[number]}`;
interface ItemPools { beneficial: readonly BeneficialItem[]; harmful: readonly HarmfulItem[] }
const ITEM_POOLS: Record<ItemSet, ItemPools> = {
  v1: { beneficial: BENEFICIAL, harmful: HARMFUL },
  v2: { beneficial: BENEFICIAL_V2, harmful: HARMFUL_V2 },
  "v2-no-rapid": { beneficial: BENEFICIAL_V2.filter((kind) => kind !== "rapid"), harmful: HARMFUL_V2 },
  "v2-no-deadhead": { beneficial: BENEFICIAL_V2.filter((kind) => kind !== "deadhead"), harmful: HARMFUL_V2 },
  "v2-no-certificate": { beneficial: BENEFICIAL_V2.filter((kind) => kind !== "certificate"), harmful: HARMFUL_V2 },
  "v2-no-oversleep": { beneficial: BENEFICIAL_V2, harmful: HARMFUL },
};

export const INVENTORY_CAP = 3;
export const DELAY_OFFSET_TURNS = 3;
export const SUSPENSION_TURNS = 5;
const PER_MILLE = 1000;
const PERCENT = 100;
const MAX_FACE = 6;
const MIN_FACE = 1;
const DOUBLE_FACTOR = 2;
const CLEAR_SCORE = 1_000_000;
const SCORE_PER_NEW_TARGET_SEGMENT = 1;
const SCORE_PER_TARGET_PROBABILITY = 10;
const SCORE_PER_DISTANCE_HOP = 1;
/** Greedy uses the deadhead ticket only this many hops or more from Yamanote. */
export const DEADHEAD_MIN_DISTANCE = 3;
/** Oversleeping on the (circular) target service moves this many pips. */
export const OVERSLEEP_TARGET_PIPS = 6;

/**
 * Round-3 rules (user decisions 2026-10-27). Present only on round-3 variants;
 * its presence also switches on the round-3 greedy rapid rule (only toward
 * Yamanote or on it) and a separate policy RNG stream (`<seed>|policy`) for
 * random-user choices, so round-1/2 variants replay unchanged.
 */
export interface Round3Rules {
  /** At most one active item per turn (adjust counts; deadhead exclusive; certificate passive). */
  singleItem: boolean;
  /** With a full inventory, the player discards one of the four (instead of the new item). */
  chooseDiscard: boolean;
}

/** Greedy keep-priority for rule 2: the lowest value is discarded (ties: the newest pickup). */
export const KEEP_PRIORITY: Readonly<Record<BeneficialItem, number>> = {
  deadhead: 7, route: 6, direction: 5, double: 4, adjust: 3, rapid: 2, certificate: 1,
};

export interface Variant {
  id: string;
  weighting: Weighting["id"];
  /** Drop probability per station arrival, in per-mille. */
  dropPerMille: number;
  /** Share of drops that are harmful, in percent. */
  harmfulPercent: number;
  policy: Policy;
  itemSet: ItemSet;
  r3?: Round3Rules;
}

export interface SimContext {
  network: engine.RailwayNetwork;
  config: GameConfig;
  weighting: Weighting;
  targetId: ServiceId;
  distances: ReadonlyMap<StationId, number>;
  targetSegmentIds: ReadonlySet<string>;
  transfers: ReadonlySet<StationId>;
  adjacency: ReadonlyMap<StationId, readonly StationId[]>;
  targetStationIds: readonly StationId[];
  /** Memo for nearestTargetStation (pure function of the station). */
  nearestTarget: Map<StationId, StationId>;
}

export interface GameResult {
  turns: number;
  completed: boolean;
  pickups: number;
  beneficialPickups: number;
  harmfulPickups: number;
  discarded: number;
  used: number;
  usedByKind: Record<BeneficialItem, number>;
  harmfulByKind: Record<HarmfulItem, number>;
  /** Turns where the player held at least one item usable that turn (agency proxy). */
  decisionTurns: number;
  /** Turns on which the ridden service was the target (Yamanote). */
  targetTurns: number;
  forcedOneTurns: number;
  /** Harmful pickups cancelled by a held delay certificate (still counted in harmfulPickups/harmfulByKind). */
  cancelledHarmful: number;
  oversleepTurns: number;
  /** Turns on which more than one active (non-certificate) item was used; must be 0 under rule 1. */
  multiItemTurns: number;
}

export function makeContext(network: engine.RailwayNetwork, config: GameConfig, weighting: Weighting): SimContext {
  return {
    network, config, weighting, targetId: config.targetServiceId,
    distances: engine.targetHopDistances(network, config.targetServiceId),
    targetSegmentIds: new Set(engine.targetSegmentIds(config, network)),
    transfers: transferStations(network), adjacency: forwardAdjacency(network),
    targetStationIds: network.servicesById.get(config.targetServiceId)?.stationIds ?? [],
    nearestTarget: new Map(),
  };
}

/** Round-1 (v1) ids are unchanged so their shards stay comparable. */
export function variantId(
  weighting: Weighting["id"], dropPerMille: number, harmfulPercent: number, policy: Policy,
  itemSet: ItemSet = "v1", r3?: Round3Rules,
): string {
  const base = `${weighting}-d${dropPerMille}-h${harmfulPercent}-${policy}${itemSet === "v1" ? "" : `-${itemSet}`}`;
  if (r3 === undefined) return base;
  const suffix = r3.singleItem && r3.chooseDiscard ? "" : r3.singleItem ? "-single" : r3.chooseDiscard ? "-discard" : "-none";
  return `${base}-r3${suffix}`;
}

/** Engine-equivalent service weights (kindWeights are all 1 in the product config). */
export function serviceWeights(services: readonly ServiceId[], ctx: SimContext): number[] {
  const share = ctx.weighting.targetShare;
  const targetIndex = services.indexOf(ctx.targetId);
  if (share === null || targetIndex < 0 || services.length < 2) return services.map(() => 1);
  const [numerator, denominator] = share;
  const others = services.length - 1;
  return services.map((_, index) => (index === targetIndex ? numerator * others : denominator - numerator));
}

function directionsOf(ctx: SimContext, serviceId: ServiceId, stationId: StationId): Direction[] {
  return serviceId === ctx.targetId
    ? [ctx.config.targetDirection]
    : engine.movableDirections(ctx.network, serviceId, stationId);
}

function nextDistance(ctx: SimContext, serviceId: ServiceId, stationId: StationId, direction: Direction): number {
  const next = engine.nextStationId(ctx.network, serviceId, stationId, direction);
  return next === undefined ? Infinity : (ctx.distances.get(next) ?? Infinity);
}

/** Engine-equivalent direction weights in [1, -1] order. */
function directionWeights(ctx: SimContext, serviceId: ServiceId, stationId: StationId, directions: readonly Direction[]): number[] {
  const [toward, away] = ctx.weighting.direction;
  if (toward === away || directions.length < 2) return directions.map(() => 1);
  const [forward = Infinity, backward = Infinity] = directions.map((d) => nextDistance(ctx, serviceId, stationId, d));
  if (forward === backward) return [1, 1];
  return forward < backward ? [toward, away] : [away, toward];
}

function drawFrom<T>(items: readonly T[], weights: readonly number[], rng: string): { value: T; rng: string } {
  if (items.length === 1) return { value: items[0] as T, rng };
  const draw = engine.drawWeightedIndex(rng, weights);
  return { value: items[draw.index] as T, rng: draw.nextRngState };
}

function uniformPick<T>(items: readonly T[], rng: string): { value: T; rng: string } {
  return drawFrom(items, items.map(() => 1), rng);
}

function drawDirection(ctx: SimContext, serviceId: ServiceId, stationId: StationId, rng: string): { value: Direction; rng: string } {
  const directions = directionsOf(ctx, serviceId, stationId);
  return drawFrom(directions, directionWeights(ctx, serviceId, stationId, directions), rng);
}

/** Mutable per-game item state (local to one game; never shared). */
interface ItemState {
  inventory: BeneficialItem[];
  delayTurns: Set<number>;
  suspendedUntil: Map<ServiceId, number>;
  detourPending: boolean;
  oversleepPending: boolean;
}

function activeServices(ctx: SimContext, items: ItemState, stationId: StationId, turn: number): ServiceId[] {
  const all = engine.transferOptions(ctx.network, stationId).map((option) => option.serviceId);
  const active = all.filter((id) => (items.suspendedUntil.get(id) ?? -1) < turn);
  // Simplification: when every candidate is suspended, the suspension is ignored.
  return active.length > 0 ? active : all;
}

interface LandingCandidates { services: ServiceId[]; detourConsumed: boolean }

function landingCandidates(ctx: SimContext, items: ItemState, stationId: StationId, ridden: ServiceId, turn: number): LandingCandidates {
  const active = activeServices(ctx, items, stationId, turn);
  if (!items.detourPending) return { services: active, detourConsumed: false };
  if (!active.includes(ridden)) return { services: active, detourConsumed: true };
  if (active.length < 2) return { services: active, detourConsumed: false };
  return { services: active.filter((id) => id !== ridden), detourConsumed: true };
}

function targetProbability(ctx: SimContext, services: readonly ServiceId[]): number {
  const index = services.indexOf(ctx.targetId);
  if (index < 0) return 0;
  const weights = serviceWeights(services, ctx);
  const total = weights.reduce((sum, w) => sum + w, 0);
  return (weights[index] ?? 0) / total;
}

function takeItem(items: ItemState, kind: BeneficialItem): boolean {
  const index = items.inventory.indexOf(kind);
  if (index < 0) return false;
  items.inventory.splice(index, 1);
  return true;
}

function newTargetSegments(ctx: SimContext, position: GamePosition, moved: Advance): number {
  return moved.completedSegmentIds.length - position.completedSegmentIds.length > 0
    ? moved.completedSegmentIds.slice(position.completedSegmentIds.length).filter((id) => ctx.targetSegmentIds.has(id)).length
    : 0;
}

/** Greedy evaluation of a candidate move for the roll-adjust ticket. */
function scoreMove(ctx: SimContext, items: ItemState, position: GamePosition, moved: Advance, turn: number): number {
  if (moved.cleared) return CLEAR_SCORE;
  const landing = landingCandidates(ctx, items, moved.stationId, position.currentServiceId, turn);
  const distance = ctx.distances.get(moved.stationId) ?? MAX_FACE * DOUBLE_FACTOR * PER_MILLE;
  return SCORE_PER_NEW_TARGET_SEGMENT * newTargetSegments(ctx, position, moved)
    + SCORE_PER_TARGET_PROBABILITY * targetProbability(ctx, landing.services)
    - SCORE_PER_DISTANCE_HOP * distance;
}

interface TurnPlan {
  position: GamePosition;
  doubled: boolean;
  rapid: boolean;
  main: string;
  /** RNG for policy choices: the item stream (rounds 1-2) or the policy stream (round 3). */
  itemRng: string;
  policy: Policy;
  /** Round 3: whether the roll-adjust ticket may (or, for a random choice, must) be used this turn. */
  adjust: "allowed" | "forbidden" | "forced";
  /** Round 3: greedy uses rapid only toward Yamanote or on it. */
  smartRapid: boolean;
}

/** Round-3 rapid rule: on Yamanote, or the current heading gets strictly closer to Yamanote. */
function rapidWorthIt(ctx: SimContext, position: GamePosition): boolean {
  if (position.currentServiceId === ctx.targetId) return true;
  const here = ctx.distances.get(position.currentStationId) ?? Infinity;
  return nextDistance(ctx, position.currentServiceId, position.currentStationId, position.direction) < here;
}

/** The engine's advance, with the rapid ticket converting pips into hops first. */
function computeMove(ctx: SimContext, position: GamePosition, pips: number, rapid: boolean): Advance {
  const hops = rapid
    ? rapidHops(ctx.network, ctx.transfers, position.currentServiceId, position.currentStationId, position.direction, pips)
    : pips;
  return advance(position, hops, ctx.network);
}

function oversleepMove(ctx: SimContext, position: GamePosition): Advance {
  const hops = position.currentServiceId === ctx.targetId
    ? OVERSLEEP_TARGET_PIPS
    : hopsToEndpoint(ctx.network, position.currentServiceId, position.currentStationId, position.direction);
  return advance(position, hops, ctx.network);
}

function nearestTarget(ctx: SimContext, stationId: StationId): StationId {
  const cached = ctx.nearestTarget.get(stationId);
  if (cached !== undefined) return cached;
  const found = nearestTargetStation(ctx.adjacency, ctx.targetStationIds, stationId);
  if (found === undefined) throw new Error(`No target station reachable from ${stationId}`);
  ctx.nearestTarget.set(stationId, found);
  return found;
}

function targetSegmentsRemain(ctx: SimContext, position: GamePosition): boolean {
  return position.completedSegmentIds.filter((id) => ctx.targetSegmentIds.has(id)).length < ctx.targetSegmentIds.size;
}

/** Whether the policy spends a deadhead ticket this turn (it replaces the move). */
function wantsDeadhead(ctx: SimContext, items: ItemState, position: GamePosition, policy: Policy): boolean {
  if (!items.inventory.includes("deadhead")) return false;
  if (policy === "random") return true;
  return (ctx.distances.get(position.currentStationId) ?? Infinity) >= DEADHEAD_MIN_DISTANCE
    && targetSegmentsRemain(ctx, position);
}

function useCounter(result: GameResult, kind: BeneficialItem): void {
  result.used += 1;
  result.usedByKind[kind] += 1;
}

function bestDirection(ctx: SimContext, serviceId: ServiceId, stationId: StationId): { direction: Direction; distance: number } {
  const options = directionsOf(ctx, serviceId, stationId).map((direction) => ({
    direction, distance: nextDistance(ctx, serviceId, stationId, direction),
  }));
  return options.reduce((best, option) => (option.distance < best.distance ? option : best));
}

function greedyPreRoll(ctx: SimContext, items: ItemState, plan: TurnPlan, turn: number, result: GameResult): TurnPlan {
  let { position, main } = plan;
  const station = position.currentStationId;
  const target = ctx.targetId;
  if (items.inventory.includes("route") && position.currentServiceId !== target) {
    const candidates = activeServices(ctx, items, station, turn);
    if (candidates.includes(target)) {
      takeItem(items, "route");
      useCounter(result, "route");
      position = { ...position, currentServiceId: target, direction: ctx.config.targetDirection };
    } else if (candidates.length >= 2) {
      const current = nextDistance(ctx, position.currentServiceId, station, position.direction);
      const ranked = candidates.map((serviceId) => ({ serviceId, ...bestDirection(ctx, serviceId, station) }));
      const best = ranked.reduce((a, b) => (b.distance < a.distance ? b : a));
      if (best.serviceId !== position.currentServiceId && best.distance < current) {
        takeItem(items, "route");
        useCounter(result, "route");
        const drawn = drawDirection(ctx, best.serviceId, station, main);
        main = drawn.rng;
        position = { ...position, currentServiceId: best.serviceId, direction: drawn.value };
      }
    }
  }
  if (items.inventory.includes("direction") && position.currentServiceId !== target) {
    const directions = directionsOf(ctx, position.currentServiceId, station);
    const best = bestDirection(ctx, position.currentServiceId, station);
    const current = nextDistance(ctx, position.currentServiceId, station, position.direction);
    if (directions.length >= 2 && best.distance < current) {
      takeItem(items, "direction");
      useCounter(result, "direction");
      position = { ...position, direction: best.direction };
    }
  }
  let doubled = false;
  if (items.inventory.includes("double") && position.currentServiceId === target) {
    takeItem(items, "double");
    useCounter(result, "double");
    doubled = true;
  }
  let rapid = false;
  const rapidRule = plan.smartRapid ? rapidWorthIt(ctx, position) : position.currentServiceId !== target;
  if (items.inventory.includes("rapid") && rapidRule) {
    takeItem(items, "rapid");
    useCounter(result, "rapid");
    rapid = true;
  }
  return { ...plan, position, main, doubled, rapid };
}

function randomPreRoll(ctx: SimContext, items: ItemState, plan: TurnPlan, turn: number, result: GameResult): TurnPlan {
  let { position, main, itemRng } = plan;
  const station = position.currentStationId;
  if (items.inventory.includes("route")) {
    const candidates = activeServices(ctx, items, station, turn);
    if (candidates.length >= 2) {
      takeItem(items, "route");
      useCounter(result, "route");
      const picked = uniformPick(candidates, itemRng);
      itemRng = picked.rng;
      const drawn = drawDirection(ctx, picked.value, station, main);
      main = drawn.rng;
      position = { ...position, currentServiceId: picked.value, direction: drawn.value };
    }
  }
  if (items.inventory.includes("direction") && position.currentServiceId !== ctx.targetId) {
    const directions = directionsOf(ctx, position.currentServiceId, station);
    if (directions.length >= 2) {
      takeItem(items, "direction");
      useCounter(result, "direction");
      const picked = uniformPick(directions, itemRng);
      itemRng = picked.rng;
      position = { ...position, direction: picked.value };
    }
  }
  let doubled = false;
  if (takeItem(items, "double")) {
    useCounter(result, "double");
    doubled = true;
  }
  let rapid = false;
  if (takeItem(items, "rapid")) {
    useCounter(result, "rapid");
    rapid = true;
  }
  return { ...plan, position, main, itemRng, doubled, rapid };
}

function validDeltas(face: number): number[] {
  return [-1, 1].filter((delta) => face + delta >= MIN_FACE && face + delta <= MAX_FACE);
}

/** Returns the face actually used after an optional roll-adjust ticket. */
function adjustFace(
  ctx: SimContext, items: ItemState, plan: TurnPlan, face: number, turn: number, result: GameResult,
): { face: number; itemRng: string } {
  let itemRng = plan.itemRng;
  if (plan.adjust === "forbidden" || !items.inventory.includes("adjust")) return { face, itemRng };
  const multiplier = plan.doubled ? DOUBLE_FACTOR : 1;
  const deltas = validDeltas(face);
  let delta = 0;
  if (plan.policy === "random") {
    const picked = uniformPick(deltas, itemRng);
    itemRng = picked.rng;
    delta = picked.value;
  } else {
    const score = (f: number): number =>
      scoreMove(ctx, items, plan.position, computeMove(ctx, plan.position, f * multiplier, plan.rapid), turn);
    let bestScore = score(face);
    for (const candidate of deltas) {
      const value = score(face + candidate);
      if (value > bestScore) {
        bestScore = value;
        delta = candidate;
      }
    }
  }
  if (delta === 0) return { face, itemRng };
  takeItem(items, "adjust");
  useCounter(result, "adjust");
  return { face: face + delta, itemRng };
}

function isUsable(ctx: SimContext, items: ItemState, position: GamePosition, turn: number, kind: BeneficialItem): boolean {
  if (kind === "certificate") return false;
  if (kind === "adjust" || kind === "double" || kind === "rapid" || kind === "deadhead") return true;
  if (kind === "direction") {
    return position.currentServiceId !== ctx.targetId
      && directionsOf(ctx, position.currentServiceId, position.currentStationId).length >= 2;
  }
  return activeServices(ctx, items, position.currentStationId, turn).length >= 2;
}

function hasUsableItem(ctx: SimContext, items: ItemState, position: GamePosition, turn: number): boolean {
  return items.inventory.some((kind) => isUsable(ctx, items, position, turn, kind));
}

/** Round-2 greedy secondary route rule: a service whose better direction is strictly closer to Yamanote. */
function secondaryRouteWorthIt(ctx: SimContext, items: ItemState, position: GamePosition, turn: number): boolean {
  const station = position.currentStationId;
  const candidates = activeServices(ctx, items, station, turn);
  if (candidates.length < 2) return false;
  const current = nextDistance(ctx, position.currentServiceId, station, position.direction);
  const best = candidates.map((serviceId) => ({ serviceId, ...bestDirection(ctx, serviceId, station) }))
    .reduce((a, b) => (b.distance < a.distance ? b : a));
  return best.serviceId !== position.currentServiceId && best.distance < current;
}

/**
 * Round-3 greedy single-item priority (pre-roll). `null` = no pre-roll item;
 * the adjust ticket then stays available after the roll.
 */
function greedySingleChoice(ctx: SimContext, items: ItemState, position: GamePosition, turn: number): BeneficialItem | null {
  const has = (kind: BeneficialItem): boolean => items.inventory.includes(kind);
  const station = position.currentStationId;
  const onTarget = position.currentServiceId === ctx.targetId;
  if (wantsDeadhead(ctx, items, position, "greedy")) return "deadhead";
  if (has("route") && !onTarget && activeServices(ctx, items, station, turn).includes(ctx.targetId)) return "route";
  if (has("direction") && !onTarget && directionsOf(ctx, position.currentServiceId, station).length >= 2
    && bestDirection(ctx, position.currentServiceId, station).distance
      < nextDistance(ctx, position.currentServiceId, station, position.direction)) return "direction";
  if (has("double") && onTarget) return "double";
  if (has("rapid") && rapidWorthIt(ctx, position)) return "rapid";
  if (has("route") && !onTarget && secondaryRouteWorthIt(ctx, items, position, turn)) return "route";
  return null;
}

/** Round-3 random user: one uniformly random usable held kind (policy stream). */
function randomSingleChoice(
  ctx: SimContext, items: ItemState, position: GamePosition, turn: number, rng: string,
): { kind: BeneficialItem | null; rng: string } {
  const usable = [...new Set(items.inventory)].filter((kind) => isUsable(ctx, items, position, turn, kind));
  if (usable.length === 0) return { kind: null, rng };
  const picked = uniformPick(usable, rng);
  return { kind: picked.value, rng: picked.rng };
}

/** Apply exactly one pre-roll item by running the policy on a one-item inventory view. */
function applySingle(
  ctx: SimContext, items: ItemState, plan: TurnPlan, turn: number, result: GameResult, kind: BeneficialItem,
): { plan: TurnPlan; used: boolean } {
  const view: ItemState = { ...items, inventory: [kind] };
  const next = plan.policy === "greedy"
    ? greedyPreRoll(ctx, view, plan, turn, result)
    : randomPreRoll(ctx, view, plan, turn, result);
  const used = view.inventory.length === 0;
  if (used) takeItem(items, kind);
  return { plan: next, used };
}

function emptyResult(): GameResult {
  return {
    turns: 0, completed: false, pickups: 0, beneficialPickups: 0, harmfulPickups: 0, discarded: 0, used: 0,
    usedByKind: { route: 0, direction: 0, adjust: 0, double: 0, rapid: 0, deadhead: 0, certificate: 0 },
    harmfulByKind: { delay: 0, suspension: 0, detour: 0, oversleep: 0 },
    decisionTurns: 0, targetTurns: 0, forcedOneTurns: 0, cancelledHarmful: 0, oversleepTurns: 0, multiItemTurns: 0,
  };
}

interface PickUpRngs { itemRng: string; policyRng: string }

/** Rule 2: which of the four (three held + new) to discard. Returns the index in `pool`. */
function discardIndex(pool: readonly BeneficialItem[], policy: Policy, rng: string): { index: number; rng: string } {
  if (policy === "random") {
    const picked = uniformPick(pool.map((_, index) => index), rng);
    return { index: picked.value, rng: picked.rng };
  }
  let index = 0;
  for (const [candidate, kind] of pool.entries()) {
    if (KEEP_PRIORITY[kind] <= KEEP_PRIORITY[pool[index] as BeneficialItem]) index = candidate;
  }
  return { index, rng };
}

function pickUp(
  ctx: SimContext, variant: Variant, items: ItemState, stationId: StationId, turn: number, rngs: PickUpRngs, result: GameResult,
): PickUpRngs {
  let itemRng = rngs.itemRng;
  let policyRng = rngs.policyRng;
  const drop = engine.drawIndex(itemRng, PER_MILLE);
  itemRng = drop.nextRngState;
  if (drop.index >= variant.dropPerMille) return { itemRng, policyRng };
  result.pickups += 1;
  let harmful = false;
  if (variant.harmfulPercent > 0) {
    const roll = engine.drawIndex(itemRng, PERCENT);
    itemRng = roll.nextRngState;
    harmful = roll.index < variant.harmfulPercent;
  }
  const pools = ITEM_POOLS[variant.itemSet];
  if (!harmful) {
    const picked = uniformPick(pools.beneficial, itemRng);
    itemRng = picked.rng;
    result.beneficialPickups += 1;
    if (items.inventory.length < INVENTORY_CAP) {
      items.inventory.push(picked.value);
    } else if (variant.r3?.chooseDiscard) {
      const pool = [...items.inventory, picked.value];
      const chosen = discardIndex(pool, variant.policy, policyRng);
      policyRng = chosen.rng;
      pool.splice(chosen.index, 1);
      items.inventory.splice(0, items.inventory.length, ...pool);
      result.discarded += 1;
    } else {
      result.discarded += 1;
    }
    return { itemRng, policyRng };
  }
  const picked = uniformPick(pools.harmful, itemRng);
  itemRng = picked.rng;
  result.harmfulPickups += 1;
  result.harmfulByKind[picked.value] += 1;
  if (takeItem(items, "certificate")) {
    // 遅延証明書: a held certificate cancels the next harmful item and is consumed.
    useCounter(result, "certificate");
    result.cancelledHarmful += 1;
    return { itemRng, policyRng };
  }
  if (picked.value === "oversleep") items.oversleepPending = true;
  if (picked.value === "delay") items.delayTurns.add(turn + DELAY_OFFSET_TURNS);
  if (picked.value === "detour") items.detourPending = true;
  if (picked.value === "suspension") {
    const services = engine.transferOptions(ctx.network, stationId).map((option) => option.serviceId);
    const suspended = uniformPick(services, itemRng);
    itemRng = suspended.rng;
    items.suspendedUntil.set(suspended.value, turn + SUSPENSION_TURNS);
  }
  return { itemRng, policyRng };
}

/** One game. Turn order: items (pre-roll) -> roll -> adjust -> move -> landing lottery -> item drop. */
export function runItemGame(ctx: SimContext, variant: Variant, seed: string, turnCap: number): GameResult {
  const { movementHistory: _history, ...start } = engine.createGame(ctx.config, seed, ctx.network);
  let position: GamePosition = start;
  let main = position.rngState;
  let itemRng = engine.seedRng(`${seed}|items`);
  // Round 3 only: random-user choices and discards come from their own stream.
  const separatePolicy = variant.r3 !== undefined;
  let policyRng = separatePolicy ? engine.seedRng(`${seed}|policy`) : "";
  const items: ItemState = {
    inventory: [], delayTurns: new Set(), suspendedUntil: new Map(), detourPending: false, oversleepPending: false,
  };
  const result = emptyResult();

  while (position.status === "playing" && position.turn < turnCap) {
    const turn = position.turn + 1;
    const activeUsesBefore = result.used - result.usedByKind.certificate;
    const delayed = items.delayTurns.delete(turn);
    // 寝過ごし: the player is asleep, so no items this turn; it overrides a delay on the same turn.
    const oversleep = items.oversleepPending;
    items.oversleepPending = false;
    let plan: TurnPlan = {
      position, doubled: false, rapid: false, main, itemRng: separatePolicy ? policyRng : itemRng,
      policy: variant.policy, adjust: "allowed", smartRapid: separatePolicy,
    };
    const drops = (stationId: StationId): void => {
      if (variant.dropPerMille === 0) return;
      const next = pickUp(ctx, variant, items, stationId, turn, { itemRng, policyRng }, result);
      itemRng = next.itemRng;
      policyRng = next.policyRng;
    };
    let singleChoice: BeneficialItem | null = null;
    if (!delayed && !oversleep && items.inventory.length > 0 && variant.r3?.singleItem) {
      if (hasUsableItem(ctx, items, position, turn)) result.decisionTurns += 1;
      if (variant.policy === "greedy") {
        singleChoice = greedySingleChoice(ctx, items, position, turn);
      } else {
        const picked = randomSingleChoice(ctx, items, position, turn, plan.itemRng);
        singleChoice = picked.kind;
        plan = { ...plan, itemRng: picked.rng };
        policyRng = picked.rng;
      }
      if (singleChoice === "deadhead") {
        takeItem(items, "deadhead");
        useCounter(result, "deadhead");
        position = {
          ...position, currentStationId: nearestTarget(ctx, position.currentStationId),
          currentServiceId: ctx.targetId, direction: ctx.config.targetDirection, turn,
        };
        drops(position.currentStationId);
        continue;
      }
      if (singleChoice === "adjust") {
        plan = { ...plan, adjust: "forced" };
      } else if (singleChoice !== null) {
        const applied = applySingle(ctx, items, plan, turn, result, singleChoice);
        plan = { ...applied.plan, adjust: applied.used ? "forbidden" : plan.adjust };
      } else if (variant.policy === "random") {
        plan = { ...plan, adjust: "forbidden" };
      }
    } else if (!delayed && !oversleep && items.inventory.length > 0) {
      if (hasUsableItem(ctx, items, position, turn)) result.decisionTurns += 1;
      if (wantsDeadhead(ctx, items, position, variant.policy)) {
        // 回送列車: replaces the move (no roll, no landing lottery, no segments completed).
        takeItem(items, "deadhead");
        useCounter(result, "deadhead");
        position = {
          ...position, currentStationId: nearestTarget(ctx, position.currentStationId),
          currentServiceId: ctx.targetId, direction: ctx.config.targetDirection, turn,
        };
        if (separatePolicy) policyRng = plan.itemRng;
        else itemRng = plan.itemRng;
        drops(position.currentStationId);
        continue;
      }
      plan = variant.policy === "greedy"
        ? greedyPreRoll(ctx, items, plan, turn, result)
        : randomPreRoll(ctx, items, plan, turn, result);
    }
    const roll = engine.rollDie(plan.main);
    plan = { ...plan, main: roll.nextRngState };
    let face: number = roll.value;
    if (oversleep) {
      result.oversleepTurns += 1;
    } else if (delayed) {
      face = 1;
      result.forcedOneTurns += 1;
    } else {
      const adjusted = adjustFace(ctx, items, plan, face, turn, result);
      face = adjusted.face;
      plan = { ...plan, itemRng: adjusted.itemRng };
    }
    const ridden = plan.position;
    const moved = oversleep
      ? oversleepMove(ctx, ridden)
      : computeMove(ctx, ridden, face * (plan.doubled ? DOUBLE_FACTOR : 1), plan.rapid);
    if (ridden.currentServiceId === ctx.targetId) result.targetTurns += 1;
    if (result.used - result.usedByKind.certificate - activeUsesBefore > 1) result.multiItemTurns += 1;
    main = plan.main;
    if (separatePolicy) policyRng = plan.itemRng;
    else itemRng = plan.itemRng;
    if (moved.cleared) {
      position = { ...ridden, status: "completed", currentStationId: moved.stationId, turn, completedSegmentIds: moved.completedSegmentIds };
      break;
    }
    const landing = landingCandidates(ctx, items, moved.stationId, ridden.currentServiceId, turn);
    if (landing.detourConsumed) items.detourPending = false;
    const service = drawFrom(landing.services, serviceWeights(landing.services, ctx), main);
    main = service.rng;
    const direction = drawDirection(ctx, service.value, moved.stationId, main);
    main = direction.rng;
    position = {
      ...ridden, currentStationId: moved.stationId, currentServiceId: service.value, direction: direction.value,
      // Only target segments affect the goal; dropping the rest keeps advance() O(30) per call.
      turn, completedSegmentIds: moved.completedSegmentIds.filter((id) => ctx.targetSegmentIds.has(id)), rngState: main,
    };
    drops(moved.stationId);
  }
  return { ...result, turns: position.turn, completed: position.status === "completed" };
}
