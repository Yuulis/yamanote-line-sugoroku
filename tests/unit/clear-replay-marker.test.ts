import { describe, expect, it } from "vitest";
import { shouldShowGameplayPosition } from "../../src/features/map/clearReplayMarker";

describe("gameplay position marker during clear replay", () => {
  it.each(["playing", "paused"] as const)("hides the gameplay marker during the %s phase", (phase) => {
    expect(shouldShowGameplayPosition("clear", phase)).toBe(false);
  });

  it.each(["idle", "done"] as const)("restores the gameplay marker during the %s phase", (phase) => {
    expect(shouldShowGameplayPosition("clear", phase)).toBe(true);
  });

  it("does not hide gameplay markers outside clear mode", () => {
    expect(shouldShowGameplayPosition("game", "playing")).toBe(true);
    expect(shouldShowGameplayPosition("title", "paused")).toBe(true);
  });
});
