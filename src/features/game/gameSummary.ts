import type { GameState, MoveRecord } from "../../types/network";

export interface GameSummary {
  turns: number;
  /** Station-to-station hops actually travelled (unused pips excluded). */
  moves: number;
}

export function summarizeGame(game: GameState): GameSummary {
  const moves = game.movementHistory.reduce(
    (total, record) => total + record.traversedSegmentIds.length,
    0,
  );
  return { turns: game.turn, moves };
}

/** Pips the move did not use because it stopped at the goal. */
export function unusedPipsOf(record: MoveRecord): number {
  return record.roll - record.traversedSegmentIds.length;
}
