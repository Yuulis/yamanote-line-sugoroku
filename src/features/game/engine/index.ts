// Public surface of the game engine. Pure TypeScript: no React, DOM,
// MapLibre, clock, or global randomness may be imported here.

export type { LandingChoice, StopReason } from "../../../types/network";
export { GOAL_ARRIVAL_POLICIES, validateConfig } from "./config";
export { GameEngineError, type GameEngineErrorCode, isGameEngineError } from "./errors";
export { createGame, moveByRoll, playTurn, SAVE_VERSION } from "./game";
export { checkGoal, stopsAtGoal, targetSegmentIds } from "./goal";
export {
  drawLanding,
  type LandingDraw,
  type LandingOptions,
  landingOptions,
  resolveLandingEvent,
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
  SegmentTraversedEvent,
} from "./types";
