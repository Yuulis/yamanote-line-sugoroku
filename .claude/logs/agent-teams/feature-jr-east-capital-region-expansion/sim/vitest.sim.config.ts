import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "/home/yuulis/yamanote-line-sugoroku",
    include: [".claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/*.test.ts"],
    environment: "node",
  },
});
