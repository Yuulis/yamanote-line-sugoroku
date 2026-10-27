// Public surface of the game engine. Pure TypeScript: no React, DOM,
// MapLibre, clock, or global randomness may be imported here.

export type {
  BeneficialItemKind,
  DirectionLotteryPolicy,
  HarmfulItemKind,
  ItemEffectsState,
  ItemEvent,
  ItemInstance,
  ItemKind,
  ItemPolicy,
  ItemGameState,
  ItemPosition,
  ItemTurnCommand,
  PreRollItemCommand,
  ItemRollAdjustment,
  ItemTurnRecord,
  ItemRideRecord,
  ItemDeadheadRecord,
  ItemLandingSnapshot,
  PendingItemTurn,
  PendingItemRoll,
  PendingItemTurnDiscard,
  LandingChoice,
  ServiceKind,
  ServiceLotteryPolicy,
  StopReason,
} from "../../../types/network";
export { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS, SERVICE_KINDS } from "../../../types/network";
export { GOAL_ARRIVAL_POLICIES, validateConfig } from "./config";
export {
  clearDetour,
  clearOversleep,
  consumeDelayDue,
  consumeInventoryInstance,
  createItemEffectsState,
  isDelayDue,
  pruneExpiredSuspensions,
  scheduleDelay,
  scheduleDetour,
  scheduleOversleep,
  scheduleSuspension,
} from "./itemEffects";
export { drawItemDrop, resolvePendingItemDiscard, seedItemRng, type ItemDropResult, type PendingItemDiscard } from "./items";
export { GameEngineError, type GameEngineErrorCode, isGameEngineError } from "./errors";
export { createGame, createItemGame, moveByRoll, playTurn, SAVE_VERSION } from "./game";
export { checkGoal, stopsAtGoal, targetSegmentIds } from "./goal";
export { nearestTargetStation, type NearestTargetStation, targetHopDistances } from "./proximity";
export {
  advanceWithMode,
  type DeadheadMovement,
  type ItemMovementResult,
  type MovementRequest,
  type RideMovement,
  type RideMovementRequest,
} from "./itemMovement";
export {
  deadheadDestination,
  directionHint,
  itemLandingOptions,
  rapidHeadsTowardTarget,
  routeTicketOptions,
  type DirectionHint,
  type ItemOptionPosition,
  type RelocationOutcome,
  type RouteTicketOptions,
} from "./itemOptions";
export {
  drawLanding,
  filterLandingOptions,
  type FilteredLandingOptions,
  type LandingFilters,
  type LandingDraw,
  type LandingOptions,
  landingOptions,
  resolveLandingEvent,
  type ServiceSuspension,
} from "./landing";
export {
  buildRailwayNetwork,
  DIRECTIONS,
  findSegment,
  movableDirections,
  nextStationId,
  platformPosition,
  type RailwayNetwork,
  type RailwayNetworkInput,
  type RailwayNetworkOptions,
  type TransferOption,
  transferOptions,
} from "./network";
export {
  type DieFace,
  type DieRoll,
  drawIndex,
  drawWeightedIndex,
  MAX_WEIGHT_TOTAL,
  faceFromDraw,
  type IndexDraw,
  indexFromDraw,
  isValidRngState,
  rollDie,
  seedRng,
} from "./rng";
export { type RestoreOptions, restoreGame, serializeGame, verifySeededHistory } from "./save";
export type {
  EndpointReachedEvent,
  GoalReachedEvent,
  LandingResolvedEvent,
  MoveEvent,
  MoveResult,
  ItemTurnEvent,
  ItemTurnResult,
  SegmentTraversedEvent,
} from "./types";

export { beginItemTurn, finishItemTurn, resolveItemDiscard, playItemTurn, type ItemTurnDecisions } from "./itemTurn";
