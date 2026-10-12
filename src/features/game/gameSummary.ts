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

/** Pips the move did not use because it stopped early (goal or endpoint). */
export function unusedPipsOf(record: Pick<MoveRecord, "roll" | "traversedSegmentIds">): number {
  return record.roll - record.traversedSegmentIds.length;
}

/**
 * Note for a move that stopped early, e.g. `新橋で停止、残り3`; null when
 * every pip was used. `stationName` resolves the station the move stopped at.
 */
export function earlyStopNote(
  record: Pick<MoveRecord, "roll" | "traversedSegmentIds" | "stopReason" | "toStationId">,
  stationName: (stationId: string) => string,
): string | null {
  const unused = unusedPipsOf(record);
  if (unused === 0 || record.stopReason === "roll") return null;
  return `${stationName(record.toStationId)}で停止、残り${unused}`;
}
