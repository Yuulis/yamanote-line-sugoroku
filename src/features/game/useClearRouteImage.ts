import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserRouteImageDependencies,
  renderRouteImage,
  ROUTE_IMAGE_FILENAME,
  type RouteImageDependencies,
  type RouteImageInput,
  type RouteImageState,
} from "../map/routeImage";

const DOWNLOAD_URL_MIN_LIFETIME_MS = 5_000;

interface Selection {
  readonly input: RouteImageInput | null;
  readonly generation: number;
}

interface StateSnapshot {
  readonly selection: Selection;
  readonly state: RouteImageState;
}

interface DownloadMarker {
  readonly selection: Selection;
  readonly mark: () => void;
}

export interface ClearRouteImageController {
  readonly state: RouteImageState;
  /** Call in the same click that starts an anchor download to keep its URL alive for at least five seconds. */
  readonly markDownloadStarted: () => void;
}

function initialState(input: RouteImageInput | null): RouteImageState {
  return input === null ? { kind: "unavailable" } : { kind: "pending" };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function disposeObjectUrl(url: string, retainUntil: number): void {
  const delay = Math.max(0, retainUntil - Date.now());
  if (delay === 0) {
    URL.revokeObjectURL(url);
    return;
  }
  // The timer closes over this URL only; a newer result's URL is owned by its own effect.
  setTimeout(() => URL.revokeObjectURL(url), delay);
}

/** Prepare one cached PNG per published result/route; the deferred start is cancelled by StrictMode cleanup. */
export function useClearRouteImage(
  input: RouteImageInput | null,
  resultGeneration: number,
  dependencies: RouteImageDependencies = browserRouteImageDependencies,
): ClearRouteImageController {
  const selectionRef = useRef<Selection>({ input, generation: resultGeneration });
  if (selectionRef.current.input !== input || selectionRef.current.generation !== resultGeneration) {
    selectionRef.current = { input, generation: resultGeneration };
  }
  const selection = selectionRef.current;
  const runIdRef = useRef(0);
  const downloadMarkerRef = useRef<DownloadMarker | null>(null);
  const [snapshot, setSnapshot] = useState<StateSnapshot>(() => ({ selection, state: initialState(input) }));

  useEffect(() => {
    const runId = ++runIdRef.current;
    let active = true;
    let startTask: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;
    let preparedUrl: string | null = null;
    let downloadRetainUntil = 0;
    setSnapshot({ selection, state: initialState(input) });

    if (input === null || input.route.steps.length === 0) {
      setSnapshot({ selection, state: { kind: "unavailable" } });
    } else {
      setSnapshot({ selection, state: { kind: "pending" } });
      startTask = setTimeout(() => {
        startTask = null;
        if (!active || runIdRef.current !== runId) return;
        abortController = new AbortController();
        void renderRouteImage(input, abortController.signal, dependencies).then((blob) => {
          if (!active || runIdRef.current !== runId || abortController?.signal.aborted) return;
          const file = new File([blob], ROUTE_IMAGE_FILENAME, { type: "image/png" });
          const url = URL.createObjectURL(blob);
          if (!active || runIdRef.current !== runId) {
            URL.revokeObjectURL(url);
            return;
          }
          preparedUrl = url;
          const marker: DownloadMarker = {
            selection,
            mark: () => { downloadRetainUntil = Math.max(downloadRetainUntil, Date.now() + DOWNLOAD_URL_MIN_LIFETIME_MS); },
          };
          downloadMarkerRef.current = marker;
          setSnapshot({
            selection,
            state: { kind: "ready", image: { blob, file, url, filename: ROUTE_IMAGE_FILENAME } },
          });
        }).catch((error: unknown) => {
          if (!active || runIdRef.current !== runId || abortController?.signal.aborted || isAbortError(error)) return;
          setSnapshot({ selection, state: { kind: "failed" } });
        });
      }, 0);
    }

    return () => {
      active = false;
      if (runIdRef.current === runId) runIdRef.current += 1;
      if (startTask !== null) clearTimeout(startTask);
      startTask = null;
      abortController?.abort();
      if (downloadMarkerRef.current?.selection === selection) downloadMarkerRef.current = null;
      if (preparedUrl !== null) disposeObjectUrl(preparedUrl, downloadRetainUntil);
    };
  }, [dependencies, input, resultGeneration, selection]);

  const markDownloadStarted = useCallback(() => {
    const marker = downloadMarkerRef.current;
    if (marker?.selection === selectionRef.current) marker.mark();
  }, []);
  const state = snapshot.selection === selection ? snapshot.state : initialState(input);
  return { state, markDownloadStarted };
}
