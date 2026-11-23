import { useMemo, useState } from "react";
import type { GameState, ItemGameState } from "../../types/network";
import type { EditionDisplay } from "../editions/types";
import type { GeometryIndex } from "./animation/movePath";
import type { RailwayNetwork } from "./engine";
import { deriveClearResult, type ClearResult } from "./clearResult";
import type { PresentationResolver } from "./presentationResolver";

export interface PublishedClear {
  /** Increases once per continuous clear publication; the clear screen is keyed by it. */
  readonly generation: number;
  readonly game: GameState | ItemGameState;
  readonly result: ClearResult;
}

export interface PublishedClearInput {
  /** The session whose clear is currently published, or null while no clear is shown. */
  readonly sessionId: number | null;
  readonly game: GameState | ItemGameState | null;
  readonly network: RailwayNetwork;
  readonly geometry: GeometryIndex;
  readonly presentation: PresentationResolver;
  readonly display: EditionDisplay;
}

interface PublicationTracker {
  readonly sessionId: number | null;
  readonly generation: number;
}

const NOT_PUBLISHED: PublicationTracker = { sessionId: null, generation: 0 };

/**
 * Owns the lifetime of one published clear result. The result is derived once per saved game and data reference
 * (never from the history length), and a new generation starts whenever a clear is published after none was shown
 * or for a different session. Data refreshing within one publication keeps the same generation, so the screen's
 * page and disclosure state survive it.
 */
export function usePublishedClearResult(input: PublishedClearInput): PublishedClear | null {
  const { sessionId, game, network, geometry, presentation, display } = input;
  const publishedSessionId = game === null ? null : sessionId;
  const [tracker, setTracker] = useState(NOT_PUBLISHED);
  let current = tracker;
  if (tracker.sessionId !== publishedSessionId) {
    current = {
      sessionId: publishedSessionId,
      generation: publishedSessionId === null ? tracker.generation : tracker.generation + 1,
    };
    setTracker(current);
  }
  const result = useMemo(
    () => game === null ? null : deriveClearResult({ game, network, geometry, presentation, display }),
    [game, network, geometry, presentation, display],
  );
  if (game === null || result === null) return null;
  return { generation: current.generation, game, result };
}
