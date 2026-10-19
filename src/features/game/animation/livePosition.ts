// The marker position on every animation frame, kept out of React state so a
// frame re-renders only the map that subscribes to it, not the whole game UI.

import type { Position } from "../../../types/data";

export interface LivePosition {
  subscribe(listener: () => void): () => void;
  /** Null until the first frame of the move has been drawn. */
  get(): Position | null;
}

export interface LivePositionWriter extends LivePosition {
  set(position: Position | null): void;
}

export function createLivePosition(): LivePositionWriter {
  let current: Position | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => current,
    set(position) {
      if (position === current) return;
      current = position;
      for (const listener of listeners) listener();
    },
  };
}
