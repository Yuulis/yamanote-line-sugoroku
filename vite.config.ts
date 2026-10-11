import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Emitted into dist/; the title screen links to it by this name. */
const THIRD_PARTY_LICENSES_FILE = "third-party-licenses.txt";

export default defineConfig({
  plugins: [react()],
  build: {
    // Reproduces the licences of bundled third-party code (MapLibre, React, ...)
    // next to the binary; linked from the title-screen credits.
    license: { fileName: THIRD_PARTY_LICENSES_FILE },
  },
  worker: {
    // The maplibre-gl worker is an ES module (see src/features/map/maplibreWorker.ts).
    format: "es",
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
