import type { RailwayNetwork, SavedGameState } from "./engine";
import { stationName } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";

export interface ResumePresentation {
  readonly label: string;
  readonly nextTurn: number | null;
  readonly stationText: string;
  readonly completedCount: number;
  readonly requiredCount: number;
}

export function resumeTurn(game: SavedGameState): number | null {
  if (game.status === "completed") return null;
  if ("pending" in game && game.pending !== null) return game.pending.turn;
  return game.turn + 1;
}

export function buildResumePresentation(
  game: SavedGameState,
  network: RailwayNetwork,
  requiredIds: ReadonlySet<string>,
  presentation?: PresentationResolver,
): ResumePresentation {
  const position = "pending" in game && game.pending?.kind === "discard"
    ? game.pending.position
    : game;
  const nextTurn = resumeTurn(game);
  const stationText = stationName(network, position.currentStationId, presentation);
  const completedCount = new Set(
    position.completedSegmentIds.filter((segmentId) => requiredIds.has(segmentId)),
  ).size;
  const requiredCount = requiredIds.size;
  const label = nextTurn === null
    ? `クリア結果を見る（${game.turn}ターンでクリア）`
    : `つづきから　踏破 ${completedCount}/${requiredCount}・${nextTurn}ターン目・${stationText}`;

  return { label, nextTurn, stationText, completedCount, requiredCount };
}

export function overwriteProgressText(game: SavedGameState): string {
  const nextTurn = resumeTurn(game);
  if (nextTurn === null) return `${game.turn}ターンでクリア`;
  return `${nextTurn}ターン目から再開`;
}
