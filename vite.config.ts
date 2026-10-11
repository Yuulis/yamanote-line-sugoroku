import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  worker: {
    // The maplibre-gl worker is an ES module (see src/features/map/maplibreWorker.ts).
    format: "es",
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
