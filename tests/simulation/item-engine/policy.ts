// Round-3 policy decisions only. Every preview/transition uses production queries.
import * as engine from "../../../src/features/game/engine";
import type { BeneficialItemKind, ItemGameState, ItemInstance, ItemRollAdjustment, ItemTurnCommand, PreRollItemCommand } from "../../../src/types/network";

export type Policy = "greedy" | "random";
export const KEEP_PRIORITY: Readonly<Record<BeneficialItemKind, number>> = {
  deadhead: 7, "route-ticket": 6, "direction-ticket": 5, double: 4,
  "roll-adjust": 3, rapid: 2, "delay-certificate": 1,
};

/** Forced choices consume no policy draw, matching round 3's uniformPick. */
export function pick<T>(values: readonly T[], rng: string): { value: T; rng: string } {
  if (values.length === 0) throw new Error("Cannot choose from an empty pool");
  if (values.length === 1) return { value: values[0]!, rng };
  const drawn = engine.drawIndex(rng, values.length);
  return { value: values[drawn.index]!, rng: drawn.nextRngState };
}

export interface PolicyChoice {
  command: ItemTurnCommand;
  adjust: boolean;
  rng: string;
  decision: boolean;
}

export function choosePreRoll(state: ItemGameState, network: engine.RailwayNetwork, policy: Policy, rng: string): PolicyChoice {
  const none = { command: { items: [] }, adjust: false, rng, decision: false };
  if (state.effects.oversleepPending || engine.isDelayDue(state.effects, state.turn + 1)) return none;
  const hint = engine.directionHint(state, network);
  const routes = engine.routeTicketOptions(state, { turn: state.turn + 1, suspensions: state.effects.suspensions }, network).options.services;
  const usable = [...new Set(state.inventory.map((item) => item.kind))].filter((kind) => {
    if (kind === "delay-certificate") return false;
    if (kind === "direction-ticket") return state.currentServiceId !== state.config.targetServiceId && hint.directions.length === 2;
    if (kind === "route-ticket") return routes.length >= 2;
    return true;
  });
  // Reference greedy boards Yamanote even when suspension leaves it the only eligible route.
  const boardsTarget = policy === "greedy" && state.currentServiceId !== state.config.targetServiceId
    && state.inventory.some((item) => item.kind === "route-ticket") && routes.includes(state.config.targetServiceId);
  if (usable.length === 0 && !boardsTarget) return none;
  let kind: ItemInstance["kind"] | null = null;
  let route = state.config.targetServiceId;
  if (policy === "random") {
    const chosen = pick(usable, rng);
    kind = chosen.value;
    rng = chosen.rng;
  } else {
    const has = (value: BeneficialItemKind): boolean => usable.includes(value);
    const onTarget = state.currentServiceId === state.config.targetServiceId;
    const targets = engine.targetSegmentIds(state.config, network);
    const remains = targets.some((id) => !state.completedSegmentIds.includes(id));
    if (has("deadhead") && remains && engine.deadheadDestination(state, network).distance >= 3) kind = "deadhead";
    else if (boardsTarget) kind = "route-ticket";
    else if (has("direction-ticket") && hint.closerDirection !== null && hint.closerDirection !== state.direction) kind = "direction-ticket";
    else if (has("double") && onTarget) kind = "double";
    else if (has("rapid") && engine.rapidHeadsTowardTarget(state, network)) kind = "rapid";
    else if (has("route-ticket") && !onTarget && routes.length >= 2) {
      const ranked = routes.map((serviceId) => ({ serviceId, distance: Math.min(...engine.directionHint({ ...state, currentServiceId: serviceId }, network).directions.map((d) => d.targetHops)) }));
      const best = ranked.reduce((a, b) => b.distance < a.distance ? b : a);
      const current = hint.directions.find((d) => d.direction === state.direction)!.targetHops;
      if (best.serviceId !== state.currentServiceId && best.distance < current) {
        kind = "route-ticket";
        route = best.serviceId;
      }
    }
  }
  const base = { ...none, rng, decision: true };
  if (kind === null || kind === "roll-adjust") return { ...base, adjust: policy === "greedy" || kind === "roll-adjust" };
  const instanceId = state.inventory.find((item) => item.kind === kind)!.id;
  let action: PreRollItemCommand;
  if (kind === "route-ticket") {
    if (policy === "random") {
      const chosen = pick(routes, rng);
      route = chosen.value;
      rng = chosen.rng;
    }
    action = { kind, instanceId, serviceId: route };
  } else if (kind === "direction-ticket") {
    let direction = hint.closerDirection ?? state.direction;
    if (policy === "random") {
      const chosen = pick(hint.directions.map((d) => d.direction), rng);
      direction = chosen.value;
      rng = chosen.rng;
    }
    action = { kind, instanceId, direction };
  } else if (kind === "double" || kind === "rapid" || kind === "deadhead") action = { kind, instanceId };
  else throw new Error(`Unexpected usable kind ${kind}`);
  return { command: { items: [action] }, adjust: false, rng, decision: true };
}

export function chooseAdjustment(state: ItemGameState, network: engine.RailwayNetwork, policy: Policy, allowed: boolean, rng: string): { adjustment: ItemRollAdjustment | null; rng: string } {
  const pending = state.pending;
  const item = state.inventory.find((entry) => entry.kind === "roll-adjust");
  if (!allowed || !item || pending?.kind !== "roll" || pending.command.items.length > 0 || state.effects.oversleepPending || engine.isDelayDue(state.effects, pending.turn)) return { adjustment: null, rng };
  const deltas = ([-1, 1] as const).filter((delta) => pending.rawRoll + delta >= 1 && pending.rawRoll + delta <= 6);
  if (policy === "random") {
    const chosen = pick(deltas, rng);
    return { adjustment: { instanceId: item.id, delta: chosen.value }, rng: chosen.rng };
  }
  const targetSegments = new Set(engine.targetSegmentIds(state.config, network));
  const distances = engine.targetHopDistances(network, state.config.targetServiceId);
  const score = (face: number): number => {
    const moved = engine.advanceWithMode(state, { mode: "normal", pips: face }, network);
    if (moved.cleared) return 1_000_000;
    const landing = engine.itemLandingOptions({ ...state, currentStationId: moved.stationId }, {
      turn: pending.turn, suspensions: state.effects.suspensions,
      ...(state.effects.detourPending ? { detourServiceId: state.currentServiceId } : {}),
    }, network).options;
    const index = landing.services.indexOf(state.config.targetServiceId);
    const probability = index < 0 ? 0 : landing.serviceWeights[index]! / landing.serviceWeights.reduce((a, b) => a + b, 0);
    const added = moved.completedSegmentIds.filter((id) => targetSegments.has(id) && !state.completedSegmentIds.includes(id)).length;
    return added + 10 * probability - (distances.get(moved.stationId) ?? 12000);
  };
  let bestScore = score(pending.rawRoll);
  let adjustment: ItemRollAdjustment | null = null;
  for (const delta of deltas) {
    const value = score(pending.rawRoll + delta);
    if (value > bestScore) {
      bestScore = value;
      adjustment = { instanceId: item.id, delta };
    }
  }
  return { adjustment, rng };
}

export function chooseDiscard(candidates: readonly ItemInstance[], policy: Policy, rng: string): { instanceId: string; rng: string } {
  if (candidates.length === 0) throw new Error("Empty discard pool");
  if (policy === "random") {
    const chosen = pick(candidates, rng);
    return { instanceId: chosen.value.id, rng: chosen.rng };
  }
  const priority = (item: ItemInstance): number => {
    if (!(item.kind in KEEP_PRIORITY)) throw new Error("Harmful item in inventory");
    return KEEP_PRIORITY[item.kind as BeneficialItemKind];
  };
  const lowest = candidates.reduce((a, b) => priority(b) <= priority(a) ? b : a);
  return { instanceId: lowest.id, rng };
}
