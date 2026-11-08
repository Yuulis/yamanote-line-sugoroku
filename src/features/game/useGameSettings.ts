import { useCallback, useEffect, useRef, useState } from "react";
import { ANIMATION_SPEEDS, DEFAULT_ANIMATION_SPEED } from "./gameConfig";
import { nextPresentationLevel, type GameSettings } from "./gameSettings";
import type { SaveWriteResult, StorageLike } from "./store/persistence";
import { readSettings, writeSettings } from "./store/settings";

interface SettingsState {
  readonly preferences: GameSettings;
  readonly followStopped: boolean;
  readonly revision: number;
}

interface GameSettingsControls {
  readonly settings: GameSettings;
  readonly cycleSpeed: () => void;
  readonly toggleFollow: () => void;
  readonly stopFollowing: () => void;
  readonly cyclePresentation: () => void;
  readonly writeStatus: "unchanged" | SaveWriteResult;
}

/** Persist explicit preference changes; camera panning only stops follow for this mount. */
export function useGameSettings(storage: StorageLike | null): GameSettingsControls {
  const [state, setState] = useState<SettingsState>(() => ({
    preferences: readSettings(storage).settings,
    followStopped: false,
    revision: 0,
  }));
  const [writeStatus, setWriteStatus] = useState<GameSettingsControls["writeStatus"]>("unchanged");
  const attemptedRevision = useRef(0);

  useEffect(() => {
    if (state.revision === attemptedRevision.current) return;
    // Mark attempts, including failures, before writing so effect replay never retries them.
    attemptedRevision.current = state.revision;
    setWriteStatus(writeSettings(storage, state.preferences));
  }, [state.preferences, state.revision, storage]);

  const cycleSpeed = useCallback((): void => {
    setState((previous) => {
      const index = ANIMATION_SPEEDS.findIndex(({ id }) => id === previous.preferences.speedId);
      const speedId = ANIMATION_SPEEDS[(index + 1) % ANIMATION_SPEEDS.length]?.id ?? DEFAULT_ANIMATION_SPEED;
      return { ...previous, revision: previous.revision + 1, preferences: { ...previous.preferences, speedId } };
    });
  }, []);

  const toggleFollow = useCallback((): void => {
    setState((previous) => ({
      ...previous,
      revision: previous.revision + 1,
      followStopped: false,
      preferences: { ...previous.preferences, follow: previous.followStopped || !previous.preferences.follow },
    }));
  }, []);

  const stopFollowing = useCallback((): void => {
    setState((previous) => {
      if (previous.followStopped || !previous.preferences.follow) return previous;
      return { ...previous, followStopped: true };
    });
  }, []);

  const cyclePresentation = useCallback((): void => {
    setState((previous) => ({
      ...previous,
      revision: previous.revision + 1,
      preferences: { ...previous.preferences, presentationLevel: nextPresentationLevel(previous.preferences.presentationLevel) },
    }));
  }, []);

  return {
    settings: state.followStopped ? { ...state.preferences, follow: false } : state.preferences,
    cycleSpeed,
    toggleFollow,
    stopFollowing,
    cyclePresentation,
    writeStatus,
  };
}
