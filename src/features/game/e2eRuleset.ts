import type { GameConfig } from "../../types/network";
import { ITEM_GAME_CONFIG } from "./gameConfig";

/** Same compile-time boundary as map/e2eHook.ts; no production rules selector. */
export function configForE2E(config: GameConfig): GameConfig {
  if (import.meta.env.MODE === "e2e" && new URLSearchParams(window.location.search).get("e2e-items") === "1") {
    return ITEM_GAME_CONFIG;
  }
  return config;
}
