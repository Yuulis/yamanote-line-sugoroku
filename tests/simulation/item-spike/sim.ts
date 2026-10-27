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
export type BeneficialItem = (typeof BENEFICIAL)[number];
export type HarmfulItem = (typeof HARMFUL)[number];
export type Policy = "greedy" | "random";

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

export interface Variant {
  id: string;
  weighting: Weighting["id"];
  /** Drop probability per station arrival, in per-mille. */
  dropPerMille: number;
  /** Share of drops that are harmful, in percent. */
  harmfulPercent: number;
  policy: Policy;
}

export interface SimContext {
  network: engine.RailwayNetwork;
  config: GameConfig;
  weighting: Weighting;
  targetId: ServiceId;
  distances: ReadonlyMap<StationId, number>;
  targetSegmentIds: ReadonlySet<string>;
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
}

export function makeContext(network: engine.RailwayNetwork, config: GameConfig, weighting: Weighting): SimContext {
  return {
    network, config, weighting, targetId: config.targetServiceId,
    distances: engine.targetHopDistances(network, config.targetServiceId),
    targetSegmentIds: new Set(engine.targetSegmentIds(config, network)),
  };
}

export function variantId(weighting: Weighting["id"], dropPerMille: number, harmfulPercent: number, policy: Policy): string {
  return `${weighting}-d${dropPerMille}-h${harmfulPercent}-${policy}`;
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

interface TurnPlan { position: GamePosition; doubled: boolean; main: string; itemRng: string; policy: Policy }

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
  return { ...plan, position, main, doubled };
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
  return { ...plan, position, main, itemRng, doubled };
}

function validDeltas(face: number): number[] {
  return [-1, 1].filter((delta) => face + delta >= MIN_FACE && face + delta <= MAX_FACE);
}

/** Returns the face actually used after an optional roll-adjust ticket. */
function adjustFace(
  ctx: SimContext, items: ItemState, plan: TurnPlan, face: number, turn: number, result: GameResult,
): { face: number; itemRng: string } {
  let itemRng = plan.itemRng;
  if (!items.inventory.includes("adjust")) return { face, itemRng };
  const multiplier = plan.doubled ? DOUBLE_FACTOR : 1;
  const deltas = validDeltas(face);
  let delta = 0;
  if (plan.policy === "random") {
    const picked = uniformPick(deltas, itemRng);
    itemRng = picked.rng;
    delta = picked.value;
  } else {
    const score = (f: number): number =>
      scoreMove(ctx, items, plan.position, advance(plan.position, f * multiplier, ctx.network), turn);
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

function hasUsableItem(ctx: SimContext, items: ItemState, position: GamePosition, turn: number): boolean {
  return items.inventory.some((kind) => {
    if (kind === "adjust" || kind === "double") return true;
    if (kind === "direction") {
      return position.currentServiceId !== ctx.targetId
        && directionsOf(ctx, position.currentServiceId, position.currentStationId).length >= 2;
    }
    return activeServices(ctx, items, position.currentStationId, turn).length >= 2;
  });
}

function emptyResult(): GameResult {
  return {
    turns: 0, completed: false, pickups: 0, beneficialPickups: 0, harmfulPickups: 0, discarded: 0, used: 0,
    usedByKind: { route: 0, direction: 0, adjust: 0, double: 0 },
    harmfulByKind: { delay: 0, suspension: 0, detour: 0 },
    decisionTurns: 0, targetTurns: 0, forcedOneTurns: 0,
  };
}

function pickUp(
  ctx: SimContext, variant: Variant, items: ItemState, stationId: StationId, turn: number, rng: string, result: GameResult,
): string {
  let itemRng = rng;
  const drop = engine.drawIndex(itemRng, PER_MILLE);
  itemRng = drop.nextRngState;
  if (drop.index >= variant.dropPerMille) return itemRng;
  result.pickups += 1;
  let harmful = false;
  if (variant.harmfulPercent > 0) {
    const roll = engine.drawIndex(itemRng, PERCENT);
    itemRng = roll.nextRngState;
    harmful = roll.index < variant.harmfulPercent;
  }
  if (!harmful) {
    const picked = uniformPick(BENEFICIAL, itemRng);
    itemRng = picked.rng;
    result.beneficialPickups += 1;
    if (items.inventory.length < INVENTORY_CAP) items.inventory.push(picked.value);
    else result.discarded += 1;
    return itemRng;
  }
  const picked = uniformPick(HARMFUL, itemRng);
  itemRng = picked.rng;
  result.harmfulPickups += 1;
  result.harmfulByKind[picked.value] += 1;
  if (picked.value === "delay") items.delayTurns.add(turn + DELAY_OFFSET_TURNS);
  if (picked.value === "detour") items.detourPending = true;
  if (picked.value === "suspension") {
    const services = engine.transferOptions(ctx.network, stationId).map((option) => option.serviceId);
    const suspended = uniformPick(services, itemRng);
    itemRng = suspended.rng;
    items.suspendedUntil.set(suspended.value, turn + SUSPENSION_TURNS);
  }
  return itemRng;
}

/** One game. Turn order: items (pre-roll) -> roll -> adjust -> move -> landing lottery -> item drop. */
export function runItemGame(ctx: SimContext, variant: Variant, seed: string, turnCap: number): GameResult {
  const { movementHistory: _history, ...start } = engine.createGame(ctx.config, seed, ctx.network);
  let position: GamePosition = start;
  let main = position.rngState;
  let itemRng = engine.seedRng(`${seed}|items`);
  const items: ItemState = { inventory: [], delayTurns: new Set(), suspendedUntil: new Map(), detourPending: false };
  const result = emptyResult();

  while (position.status === "playing" && position.turn < turnCap) {
    const turn = position.turn + 1;
    const delayed = items.delayTurns.delete(turn);
    let plan: TurnPlan = { position, doubled: false, main, itemRng, policy: variant.policy };
    if (!delayed && items.inventory.length > 0) {
      if (hasUsableItem(ctx, items, position, turn)) result.decisionTurns += 1;
      plan = variant.policy === "greedy"
        ? greedyPreRoll(ctx, items, plan, turn, result)
        : randomPreRoll(ctx, items, plan, turn, result);
    }
    const roll = engine.rollDie(plan.main);
    plan = { ...plan, main: roll.nextRngState };
    let face: number = roll.value;
    if (delayed) {
      face = 1;
      result.forcedOneTurns += 1;
    } else {
      const adjusted = adjustFace(ctx, items, plan, face, turn, result);
      face = adjusted.face;
      plan = { ...plan, itemRng: adjusted.itemRng };
    }
    const ridden = plan.position;
    const moved = advance(ridden, face * (plan.doubled ? DOUBLE_FACTOR : 1), ctx.network);
    if (ridden.currentServiceId === ctx.targetId) result.targetTurns += 1;
    main = plan.main;
    itemRng = plan.itemRng;
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
    if (variant.dropPerMille > 0) itemRng = pickUp(ctx, variant, items, moved.stationId, turn, itemRng, result);
  }
  return { ...result, turns: position.turn, completed: position.status === "completed" };
}
