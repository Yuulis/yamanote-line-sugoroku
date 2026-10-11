import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// maplibre-gl derives its worker URL from its own module location, which
// does not survive Vite's dependency pre-bundling (dev) or chunking (build).
// Let Vite bundle the worker explicitly and hand its URL to maplibre-gl.
setWorkerUrl(workerUrl);
