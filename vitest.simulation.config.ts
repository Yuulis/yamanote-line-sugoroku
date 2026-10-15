import { defineConfig } from "vitest/config";

// The default vite.config.ts includes only tests/unit/**. Opt in with npm run sim.
export default defineConfig({
  test: {
    include: ["tests/simulation/**/*.test.ts"], environment: "node",
    fileParallelism: false, reporters: ["verbose"],
  },
});
