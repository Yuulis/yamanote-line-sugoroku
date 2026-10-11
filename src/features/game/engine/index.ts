// Public surface of the game engine. Pure TypeScript: no React, DOM,
// MapLibre, clock, or global randomness may be imported here.

export { GOAL_ARRIVAL_POLICIES, validateConfig } from "./config";
export { GameEngineError, type GameEngineErrorCode, isGameEngineError } from "./errors";
export { createGame, moveByRoll, playTurn, SAVE_VERSION } from "./game";
export { checkGoal, stopsAtGoal, targetSegmentIds } from "./goal";
export {
  buildRailwayNetwork,
  findSegment,
  nextStationId,
  type RailwayNetwork,
  type RailwayNetworkInput,
  type RailwayNetworkOptions,
} from "./network";
export { type DieFace, type DieRoll, faceFromDraw, isValidRngState, rollDie, seedRng } from "./rng";
export { restoreGame, serializeGame } from "./save";
export type {
  GoalReachedEvent,
  MoveEvent,
  MoveResult,
  SegmentTraversedEvent,
} from "./types";
