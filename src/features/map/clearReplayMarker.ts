import type { ClearReplayPhase } from "../game/clearReplayStore";
import type { RailwayMapMode } from "./RailwayMap";

/** Keep the gameplay position hidden only while the clear route is moving or paused mid-replay. */
export function shouldShowGameplayPosition(mode: RailwayMapMode, phase: ClearReplayPhase): boolean {
  return mode !== "clear" || (phase !== "playing" && phase !== "paused");
}
