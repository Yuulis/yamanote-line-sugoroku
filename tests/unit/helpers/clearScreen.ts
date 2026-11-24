import type { EditionDisplay } from "../../../src/features/editions/types";
import type { GeometryIndex } from "../../../src/features/game/animation/movePath";
import { deriveClearResult, type ClearResult } from "../../../src/features/game/clearResult";
import type { RailwayNetwork } from "../../../src/features/game/engine";
import type { PresentationResolver } from "../../../src/features/game/presentationResolver";
import type { GameState, ItemGameState } from "../../../src/types/network";

const NO_GEOMETRY: GeometryIndex = new Map();

/** The result a published clear carries, derived the way the app derives it (no route geometry unless given). */
export function clearResultFor(
  game: GameState | ItemGameState,
  network: RailwayNetwork,
  presentation: PresentationResolver,
  display: EditionDisplay,
  geometry: GeometryIndex = NO_GEOMETRY,
): ClearResult {
  return deriveClearResult({ game, network, geometry, presentation, display });
}

/** Query a button by its accessible name; share buttons must never be addressed by position. */
export function buttonByName(container: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => (button.getAttribute("aria-label") ?? button.textContent) === name);
}
