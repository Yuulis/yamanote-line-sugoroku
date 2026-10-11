// Goal rule (spec 3.3, confirmed 2026-10-11).

import type { GameConfig, GameState, ServiceId } from "../../../types/network";
import { type RailwayNetwork, requiredSegmentIds } from "./network";

/** Segment ids that must all be completed: the target service, target direction. */
export function targetSegmentIds(
  config: GameConfig,
  network: RailwayNetwork,
): string[] {
  return requiredSegmentIds(network, config.targetServiceId, config.targetDirection);
}

/**
 * Goal predicate, independent of status and of how the player got here:
 * standing on the start station with every target segment completed.
 */
export function checkGoal(state: GameState, network: RailwayNetwork): boolean {
  if (state.currentStationId !== state.config.startStationId) return false;
  const completed = new Set(state.completedSegmentIds);
  return targetSegmentIds(state.config, network).every((id) => completed.has(id));
}

/**
 * Whether reaching the goal on this step ends the move. A move that ends on
 * the goal always clears; mid-move arrival clears only under `pass-through`,
 * or under `truncate-on-target-service` while riding the target service
 * (the service that ran this step, not one chosen after arrival).
 */
export function stopsAtGoal(
  config: GameConfig,
  ridingServiceId: ServiceId,
  isLastStep: boolean,
): boolean {
  if (isLastStep) return true;
  switch (config.goalArrivalPolicy) {
    case "pass-through":
      return true;
    case "truncate-on-target-service":
      return ridingServiceId === config.targetServiceId;
    case "exact-stop":
      return false;
  }
}
