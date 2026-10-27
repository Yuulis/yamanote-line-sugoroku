// Item decisions are pure transitions. Only the save effect acknowledges a
// committing/resolving state, so no outcome is presented before a write attempt.
import type {
  DeepReadonly, GameConfig, ItemGameState, ItemRollAdjustment, ItemTurnCommand, LandingChoice,
  ItemTurnRecord,
} from "../../types/network";
import {
  beginItemTurn, createItemGame, deadheadDestination, directionHint, finishItemTurn, isItemSave,
  rapidHeadsTowardTarget, resolveItemDiscard, routeTicketOptions,
  type ItemTurnEvent, type ItemTurnResult, type MoveEvent, type RailwayNetwork,
} from "./engine";
import type { GameAction, GameSession, LastMove, MoveAnimation } from "./gameSession";
import { MAX_MOVE_DURATION_MS } from "./animation/timeline";
import { endpointKindAt } from "./gameSummary";

export interface ItemActionIdentity {
  sessionId: number;
  /** Top-level engine turn: only fully completed turns count. */
  turn: number;
  decisionRevision: number;
}

export type ItemSessionAction = ItemActionIdentity & (
  | { type: "item-draft"; command: ItemTurnCommand }
  | { type: "item-commit" }
  | { type: "item-save-attempted" }
  | { type: "item-adjust"; adjustment: ItemRollAdjustment | null }
  | { type: "item-discard"; instanceId: string }
);

export interface ItemSessionState {
  readonly decisionRevision: number;
  readonly leaveAfterSave?: true;
  readonly draft: DeepReadonly<ItemTurnCommand>;
  readonly stagedAnimation: MoveAnimation | null;
  readonly events: readonly ItemTurnEvent[];
}

export function itemActionIdentity(session: GameSession): ItemActionIdentity {
  return { sessionId: session.sessionId, turn: session.game.turn,
    decisionRevision: session.item?.decisionRevision ?? 0 };
}

export function adjustmentOptions(game: ItemGameState): readonly (-1 | 1)[] {
  const pending = game.pending;
  if (pending?.kind !== "roll" || pending.command.items.length > 0 ||
      game.effects.oversleepPending || game.effects.delayDueTurns.includes(pending.turn) ||
      !game.inventory.some((item) => item.kind === "roll-adjust")) return [];
  return ([-1, 1] as const).filter((delta) => pending.rawRoll + delta >= 1 && pending.rawRoll + delta <= 6);
}

export function createItemSession(
  config: GameConfig, seed: string, network: RailwayNetwork, sessionId: number,
  restored?: ItemGameState,
): GameSession {
  const game = restored ?? createItemGame(config, seed, network);
  const session: GameSession = {
    sessionId, game, phase: game.pending?.kind === "discard" ? "awaiting-discard"
      : game.pending?.kind === "roll" ? "awaiting-adjust" : "idle",
    lastMove: itemLastMove(game.pending?.kind === "discard" ? game.pending.record : game.movementHistory.at(-1), network), animation: null,
    item: { decisionRevision: 0, draft: { items: [] }, stagedAnimation: null, events: (game.pending?.kind === "discard" ? game.pending.record : game.movementHistory.at(-1))?.itemEvents ?? [] },
  };
  // A persisted roll without any legal adjustment never needs a UI decision.
  if (game.pending?.kind === "roll" && adjustmentOptions(game).length === 0) {
    return stageResolution(session, finishItemTurn(game, null, network));
  }
  return session;
}

export function itemLastMove(record: DeepReadonly<ItemTurnRecord> | undefined, network: RailwayNetwork): LastMove | null {
  if (!record) return null;
  if (record.kind === "deadhead") return {
    roll: null, itemRecord: record, unusedPips: 0, stopReason: "relocation",
    stopStationId: record.toStationId, serviceId: record.relocation.serviceId,
    direction: record.relocation.direction, endpointKind: null, landing: null,
  };
  const { resolvedRide: ride, landing, landingSnapshot: snapshot } = record;
  const service = snapshot?.services.find((candidate) => candidate.serviceId === landing?.serviceId);
  return {
    roll: record.effectiveFace, itemRecord: record, unusedPips: record.unusedPips, stopReason: record.stopReason,
    stopStationId: record.toStationId, serviceId: ride.serviceId, direction: ride.direction,
    endpointKind: endpointKindAt(network, ride.serviceId, record.toStationId),
    landing: landing && snapshot && service ? {
      type: "landing-resolved", stationId: record.toStationId,
      serviceCandidates: snapshot.services.map((candidate) => candidate.serviceId),
      serviceId: landing.serviceId, serviceDrawRequired: snapshot.services.length > 1,
      directionCandidates: service.directions, direction: landing.direction,
      directionDrawRequired: service.directions.length > 1, changedService: ride.serviceId !== landing.serviceId,
    } : null,
  };
}

function movementEvents(events: readonly ItemTurnEvent[]): MoveEvent[] {
  return events.filter((event): event is MoveEvent => event.type === "segment-traversed" ||
    event.type === "goal-reached" || event.type === "endpoint-reached" || event.type === "landing-resolved");
}

function stageResolution(session: GameSession, result: ItemTurnResult): GameSession {
  const revision = session.item!.decisionRevision + 1;
  const record = result.record ?? (result.state.pending?.kind === "discard" ? result.state.pending.record : null);
  return {
    ...session, game: result.state, phase: "resolving", animation: null,
    item: { ...session.item!, decisionRevision: revision, draft: { items: [] }, events: result.events,
      stagedAnimation: record ? {
        sessionId: session.sessionId, turn: result.state.turn, decisionRevision: revision + 1,
        fromStationId: record.fromStationId, events: movementEvents(result.events), maxDurationMs: MAX_MOVE_DURATION_MS,
      } : null },
  };
}

function matches(session: GameSession, action: ItemActionIdentity): boolean {
  return session.sessionId === action.sessionId && session.game.turn === action.turn &&
    session.item?.decisionRevision === action.decisionRevision;
}

export function reduceItemSession(session: GameSession, action: GameAction, network: RailwayNetwork): GameSession {
  const { game, item } = session;
  if (!isItemSave(game) || !item) return session;
  if (action.type === "animation-finished") {
    const animation = session.animation;
    if (session.phase !== "animating" || !animation || action.sessionId !== session.sessionId ||
        action.turn !== game.turn || action.turn !== animation.turn || action.decisionRevision !== item.decisionRevision) return session;
    return { ...session, animation: null, phase: game.pending?.kind === "discard" ? "awaiting-discard" : "idle",
      item: { ...item, decisionRevision: item.decisionRevision + 1 } };
  }
  if (!("decisionRevision" in action) || !matches(session, action)) return session;
  switch (action.type) {
    case "item-draft":
      if (session.phase !== "idle" || game.status !== "playing") return session;
      return { ...session, item: { ...item, decisionRevision: item.decisionRevision + 1,
        draft: { items: action.command.items.map((choice) => ({ ...choice })) } } };
    case "item-commit": {
      if (session.phase !== "idle" || game.status !== "playing" || game.pending) return session;
      const result = beginItemTurn(game, item.draft, network);
      if (result.state.pending?.kind !== "roll") return stageResolution(session, result);
      return { ...session, game: result.state, phase: "committing",
        item: { ...item, draft: { items: [] }, decisionRevision: item.decisionRevision + 1 } };
    }
    case "item-save-attempted": {
      if (session.phase === "committing") {
        if (adjustmentOptions(game).length === 0) return stageResolution(session, finishItemTurn(game, null, network));
        return { ...session, phase: "awaiting-adjust", item: { ...item, decisionRevision: item.decisionRevision + 1 } };
      }
      if (session.phase !== "resolving") return session;
      const record = game.pending?.kind === "discard" ? game.pending.record : game.movementHistory.at(-1);
      return { ...session, phase: item.stagedAnimation ? "animating" : "idle",
        lastMove: itemLastMove(record, network), animation: item.stagedAnimation,
        item: { ...item, stagedAnimation: null, decisionRevision: item.decisionRevision + 1 } };
    }
    case "item-adjust":
      if (session.phase !== "awaiting-adjust") return session;
      return stageResolution(session, finishItemTurn(game, action.adjustment, network));
    case "item-discard": {
      if (session.phase !== "awaiting-discard") return session;
      const result = resolveItemDiscard(game, action.instanceId);
      // Movement was already shown (or omitted on resume); discard never replays it.
      return { ...session, game: result.state, phase: "resolving",
        item: { ...item, events: [...item.events, ...result.events], stagedAnimation: null,
          decisionRevision: item.decisionRevision + 1 } };
    }
    default:
      return session;
  }
}

export type ItemUnavailableReason = "completed" | "decision-pending" | "forced-turn" | "passive"
  | "after-roll" | "item-already-selected" | "no-route-choice" | "fixed-direction" | "no-rapid-stop"
  | "suspended-route";

export interface ItemSessionView {
  readonly phase: GameSession["phase"];
  readonly identity: Readonly<ItemActionIdentity>;
  readonly inventory: DeepReadonly<ItemGameState["inventory"]>;
  readonly position: Readonly<{ currentStationId: string; currentServiceId: string; direction: LandingChoice["direction"] }>;
  readonly draft: DeepReadonly<ItemTurnCommand>;
  readonly usableItems: readonly {
    readonly instanceId: string;
    readonly kind: ItemGameState["inventory"][number]["kind"];
    readonly usable: boolean;
    readonly reason: ItemUnavailableReason | null;
    readonly selected: boolean;
    readonly recommended: boolean;
  }[];
  readonly hints: {
    readonly routes: readonly { readonly serviceId: string; readonly isYamanote: boolean; readonly selectable: boolean;
      readonly direction: DeepReadonly<ReturnType<typeof directionHint>> }[];
    readonly direction: DeepReadonly<ReturnType<typeof directionHint>>;
    readonly rapidHeadsTowardYamanote: boolean;
    readonly deadheadDestination: DeepReadonly<ReturnType<typeof deadheadDestination>>;
    readonly deadheadRecommended: boolean;
    readonly suspensionIgnored: boolean;
    readonly suspendedServiceIds: readonly string[];
  };
  readonly decision: null | {
    readonly kind: "adjust";
    readonly turn: number;
    readonly rawRoll: number;
    readonly resolvedRide: DeepReadonly<LandingChoice>;
    readonly allowedDeltas: readonly (-1 | 1)[];
    readonly itemInstanceIds: readonly string[];
    readonly canContinue: true;
  } | { readonly kind: "discard"; readonly turn: number; readonly candidates: DeepReadonly<ItemGameState["inventory"]>;
    readonly newItemInstanceId: string };
  readonly effects: DeepReadonly<ItemGameState["effects"]>;
  readonly events: DeepReadonly<readonly ItemTurnEvent[]>;
}

/** S9 consumes this view, not the internal pending transcript during a save. */
export function itemSessionView(session: GameSession, network: RailwayNetwork): ItemSessionView | null {
  const { game, item } = session;
  if (!isItemSave(game) || !item) return null;
  const pending = game.pending;
  const arrived = pending?.kind === "discard" && (session.phase === "animating" || session.phase === "awaiting-discard")
    ? pending.position : game;
  const position = { config: game.config, currentStationId: arrived.currentStationId,
    currentServiceId: arrived.currentServiceId, direction: arrived.direction };
  const routes = routeTicketOptions(position, { turn: arrived.turn + 1, suspensions: arrived.effects.suspensions }, network);
  const direction = directionHint(position, network);
  const forced = arrived.effects.oversleepPending || arrived.effects.delayDueTurns.includes(arrived.turn + 1);
  const selected = item.draft.items[0];
  const destination = deadheadDestination(position, network);
  const deadheadRecommended = !network.servicesById.get(game.config.targetServiceId)!.stationIds.includes(position.currentStationId);
  const service = network.servicesById.get(position.currentServiceId)!;
  const rapidAvailable = !service.circular || service.stationIds.some((id) => (network.servicesByStation.get(id)?.length ?? 0) >= 2);
  const deltas = adjustmentOptions(game);
  const decision: ItemSessionView["decision"] = session.phase === "awaiting-adjust" && pending?.kind === "roll" ? {
    kind: "adjust", turn: pending.turn, rawRoll: pending.rawRoll, resolvedRide: pending.resolvedRide, allowedDeltas: deltas,
    itemInstanceIds: game.inventory.filter((owned) => owned.kind === "roll-adjust").map((owned) => owned.id), canContinue: true,
  } : session.phase === "awaiting-discard" && pending?.kind === "discard" ? {
    kind: "discard", turn: pending.turn, candidates: pending.candidates, newItemInstanceId: pending.item.id,
  } : null;
  const suspendedServiceIds = [...new Set(arrived.effects.suspensions
    .filter((suspension) => suspension.expiresTurn >= arrived.turn + 1)
    .map((suspension) => suspension.serviceId))];
  const hasRouteChoice = routes.candidates.some((candidate) =>
    routes.candidates.length > 1 || candidate.serviceId !== position.currentServiceId);
  const hasSuspendedAlternative = !routes.suspensionIgnored && suspendedServiceIds.some((serviceId) =>
    serviceId !== position.currentServiceId && network.servicesByStation.get(position.currentStationId)?.includes(serviceId));
  return {
    phase: session.phase, identity: itemActionIdentity(session), inventory: arrived.inventory, position,
    draft: item.draft, effects: arrived.effects, decision,
    // Arrival notices are withheld until the result has had its save attempt.
    events: session.phase === "resolving" || session.phase === "committing" ? [] : item.events,
    hints: {
      routes: routes.candidates.map((candidate) => ({ serviceId: candidate.serviceId, isYamanote: candidate.isTarget,
        selectable: routes.candidates.length > 1 || candidate.serviceId !== position.currentServiceId,
        direction: directionHint({ ...position, currentServiceId: candidate.serviceId }, network) })),
      direction, rapidHeadsTowardYamanote: rapidHeadsTowardTarget(position, network),
      deadheadDestination: destination, deadheadRecommended, suspensionIgnored: routes.suspensionIgnored,
      suspendedServiceIds,
    },
    usableItems: arrived.inventory.map((owned) => {
      let reason: ItemUnavailableReason | null = null;
      if (game.status !== "playing") reason = "completed";
      else if (owned.kind === "delay-certificate") reason = "passive";
      else if (owned.kind === "roll-adjust" && decision?.kind === "adjust") reason = deltas.length > 0 ? null : "forced-turn";
      else if (session.phase !== "idle") reason = "decision-pending";
      else if (forced) reason = "forced-turn";
      else if (owned.kind === "roll-adjust") reason = "after-roll";
      else if (owned.kind === "route-ticket" && !hasRouteChoice) reason = hasSuspendedAlternative ? "suspended-route" : "no-route-choice";
      else if (owned.kind === "direction-ticket" && (position.currentServiceId === game.config.targetServiceId || direction.directions.length !== 2)) reason = "fixed-direction";
      else if (owned.kind === "rapid" && !rapidAvailable) reason = "no-rapid-stop";
      return { instanceId: owned.id, kind: owned.kind, usable: reason === null, reason,
        selected: selected?.instanceId === owned.id,
        recommended: owned.kind === "deadhead" ? deadheadRecommended
          : owned.kind === "rapid" ? rapidHeadsTowardTarget(position, network) : true };
    }),
  };
}
