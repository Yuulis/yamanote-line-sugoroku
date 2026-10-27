import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeTurns } from "../simulation/harness";
import { envInteger, parityVerdict } from "../simulation/item-engine/report";
import { firstDivergence } from "../simulation/item-engine/reference";
import type { TurnTrace } from "../simulation/item-engine/runner";

function statistics(policy: "greedy" | "random" = "greedy"): ReturnType<typeof summarizeTurns> {
  return { games: 5000, completedGames: 5000, capHits: 0, cappedGameIndices: [],
    median: policy === "greedy" ? 65 : 113, p90: policy === "greedy" ? 143 : 232,
    p99: policy === "greedy" ? 241 : 370, mean: 75, max: 900, over500Count: 0, totalPlayedTurns: 375000 };
}
afterEach(() => vi.unstubAllEnvs());
describe("S7 predeclared acceptance", () => {
  it("uses nearest rank and strict >500, with capped games censored", () => {
    const summary = summarizeTurns([500, 501, 10, 20001], [3], 21011);
    expect(summary).toMatchObject({ median: 500, p90: 20001, p99: 20001, over500Count: 2, completedGames: 3, capHits: 1 });
  });
  it("treats maximum as diagnostic and accepts exact tolerance boundaries", () => {
    const stats = { ...statistics(), median: 71, p90: 157, p99: 265, over500Count: 25 };
    expect(parityVerdict("greedy", stats).pass).toBe(true);
    expect(parityVerdict("greedy", { ...stats, median: 72 }).checks.median).toBe(false);
    expect(parityVerdict("greedy", { ...stats, over500Count: 26 }).checks.over500).toBe(false);
  });
  it("requires p99 strictly below 400, no caps and full completion", () => {
    expect(parityVerdict("random", statistics("random")).pass).toBe(true);
    expect(parityVerdict("random", { ...statistics("random"), p99: 400 }).checks.p99Below400).toBe(false);
    expect(parityVerdict("greedy", { ...statistics(), capHits: 1 }).pass).toBe(false);
    expect(parityVerdict("greedy", { ...statistics(), completedGames: 4999 }).pass).toBe(false);
  });
  it("validates opt-in integer inputs without silent coercion fallback", () => {
    vi.stubEnv("ITEM_ENGINE_GAMES", "0");
    expect(() => envInteger("ITEM_ENGINE_GAMES", 20)).toThrow("safe integer");
    vi.stubEnv("ITEM_ENGINE_GAMES", "1.5");
    expect(() => envInteger("ITEM_ENGINE_GAMES", 20)).toThrow("safe integer");
    vi.stubEnv("ITEM_ENGINE_OFFSET", "0");
    expect(envInteger("ITEM_ENGINE_OFFSET", 0, 0)).toBe(0);
  });
  it("records the first event divergence rather than subsequent cascades", () => {
    const trace: TurnTrace = { turn: 1, station: "a", service: "b", direction: 1, main: "m", items: "i", inventory: [], targets: [], rawRoll: 2, face: 2, action: null, ride: "toei-oedo-loop", mode: "oversleep", hops: 3000,
      fromStation: "x", fromService: "toei-oedo-loop", routes: ["toei-oedo-loop"], rideDirection: 1,
      effects: { delay: [], suspension: [], detour: false, oversleep: false } };
    expect(firstDivergence([trace], [trace])).toBeNull();
    expect(firstDivergence([trace, trace], [{ ...trace, hops: 6 }, { ...trace, action: "rapid" }])).toMatchObject({ turn: 1, classification: "oedo-oversleep-hop-limit", fields: ["hops"] });
  });
});
