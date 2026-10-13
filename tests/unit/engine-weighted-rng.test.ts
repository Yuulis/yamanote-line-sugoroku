import { describe, expect, it } from "vitest";
import { drawIndex, drawWeightedIndex, seedRng } from "../../src/features/game/engine";

const RANGE = 2 ** 32;
const INVALID = expect.objectContaining({ code: "INVALID_STATE" });

/** sfc32's first output is a + b + d; choose b = d = 0. */
function stateFor(draw: number): string {
  return `sfc32-v1:${draw.toString(16).padStart(8, "0")}:00000000:00000000:00000000`;
}

describe("weighted integer draw", () => {
  it.each([[0, 0], [1, 0], [2, 1], [4, 1], [5, 2], [9, 2]])(
    "maps cumulative boundary %d to candidate %d in input order",
    (draw, index) => {
      expect(drawWeightedIndex(stateFor(draw), [2, 3, 5])).toEqual({
        index,
        nextRngState: drawIndex(stateFor(draw), 10).nextRngState,
      });
    },
  );

  it("rejects the incomplete top bucket and advances past the rejected draw", () => {
    const state = stateFor(RANGE - 1);
    const result = drawWeightedIndex(state, [2, 3, 5]);
    expect(result.index).toBe(0); // The second raw draw is 1.
    expect(result.nextRngState).toBe(drawIndex(state, 10).nextRngState);
    expect(result.nextRngState.split(":").at(-1)).toBe("00000002");
  });

  it("does not normalize a common divisor", () => {
    expect(drawWeightedIndex(stateFor(3), [2, 4]).index).toBe(1);
    expect(drawIndex(stateFor(3), 3).index).toBe(0);
  });

  it("accepts a total of exactly 2^32 without bitwise overflow", () => {
    expect(drawWeightedIndex(stateFor(RANGE - 1), [1, RANGE - 1]).index).toBe(1);
    expect(drawWeightedIndex(stateFor(0), [1, RANGE - 1]).index).toBe(0);
  });

  it.each([[], [1], [0, 1], [-1, 2], [1.5, 2], [NaN, 1], [Infinity, 1],
    [Number.MAX_SAFE_INTEGER, 1], [Number.MAX_SAFE_INTEGER + 1, 1], [RANGE, 1],
    [RANGE / 2 + 1, RANGE / 2 + 1]].map((weights) => [weights]))(
    "rejects invalid integer weights or totals %j",
    (weights) => {
      expect(() => drawWeightedIndex(seedRng("limits"), weights)).toThrowError(INVALID);
    },
  );

  it.each([1, 2, 1000, RANGE / 2])("equal weights %d delegate exactly to drawIndex(k)", (weight) => {
    for (const state of [seedRng("equal"), stateFor(RANGE - 1), stateFor(17)]) {
      expect(drawWeightedIndex(state, [weight, weight])).toEqual(drawIndex(state, 2));
    }
  });

  it("equal weights preserve rejection consumption for k = 3", () => {
    const state = stateFor(RANGE - 1);
    expect(drawWeightedIndex(state, [37, 37, 37])).toEqual(drawIndex(state, 3));
  });
});
