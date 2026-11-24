import { useMemo, useState } from "react";
import { useEffect } from "react";
import type { GameState, ItemGameState } from "../../types/network";
import type { EditionDisplay } from "../editions/types";
import type { GeometryIndex } from "./animation/movePath";
import type { RailwayNetwork } from "./engine";
import { deriveClearResult, type ClearResult } from "./clearResult";
import type { PresentationResolver } from "./presentationResolver";
import { buildHistoryRows, type HistoryRow } from "./historyRows";
import { createClearReplayStore, type ClearReplayStore } from "./clearReplayStore";
import { useClearRouteImage } from "./useClearRouteImage";
import type { RouteImageInput, RouteImageState, RouteImageRailwayCredit } from "../map/routeImage";
import { exposeRouteImageForE2E } from "../map/e2eHook";

export interface PublishedClear {
  /** Increases once per continuous clear publication; the clear screen is keyed by it. */
  readonly generation: number;
  readonly game: GameState | ItemGameState;
  readonly result: ClearResult;
  readonly historyRows: readonly HistoryRow[];
  readonly replayStore: ClearReplayStore;
  readonly routeImage: RouteImageState;
  readonly markRouteImageDownloadStarted: () => void;
}

export interface PublishedClearInput {
  /** The session whose clear is currently published, or null while no clear is shown. */
  readonly sessionId: number | null;
  readonly game: GameState | ItemGameState | null;
  readonly network: RailwayNetwork;
  readonly geometry: GeometryIndex;
  readonly presentation: PresentationResolver;
  readonly display: EditionDisplay;
  readonly railwayCredit?: RouteImageRailwayCredit | null;
  readonly reducedMotion?: boolean;
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
  const { sessionId, game, network, geometry, presentation, display, railwayCredit = null, reducedMotion = false } = input;
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
  const replayStore = useMemo(() => createClearReplayStore({ route: null, reducedMotion }), [current.generation]);
  const historyRows = useMemo(
    () => game === null ? [] : buildHistoryRows(game.movementHistory, network, presentation),
    [game, network, presentation],
  );
  const routeImageInput = useMemo<RouteImageInput | null>(() => {
    if (game === null || !result?.route || !railwayCredit) return null;
    return {
      route: result.route,
      title: display.title,
      editionName: display.subtitle,
      summary: result.summary,
      railwayCredit,
    };
  }, [display.subtitle, display.title, game, result?.route, result?.summary, railwayCredit]);
  const routeImage = useClearRouteImage(routeImageInput, current.generation);
  useEffect(() => { exposeRouteImageForE2E(routeImageInput, routeImage.state); }, [routeImageInput, routeImage.state]);
  useEffect(() => {
    replayStore.activate();
    replayStore.setRoute(result?.route ?? null);
    return () => replayStore.dispose();
  }, [replayStore, result?.route]);
  useEffect(() => { replayStore.setReducedMotion(reducedMotion); }, [replayStore, reducedMotion]);
  if (game === null || result === null) return null;
  return {
    generation: current.generation,
    game,
    result,
    historyRows,
    replayStore,
    routeImage: routeImage.state,
    markRouteImageDownloadStarted: routeImage.markDownloadStarted,
  };
}
