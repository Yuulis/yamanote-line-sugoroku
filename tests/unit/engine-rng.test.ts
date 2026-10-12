import { describe, expect, it } from "vitest";
import {
  drawIndex,
  faceFromDraw,
  indexFromDraw,
  isValidRngState,
  rollDie,
  seedRng,
} from "../../src/features/game/engine";

const SAMPLE_ROLLS = 60_000;
const FACES = [1, 2, 3, 4, 5, 6] as const;
const EXPECTED_PER_FACE = SAMPLE_ROLLS / FACES.length;
/** About 4.4 standard deviations (sd ~ 91) around 10,000. */
const PER_FACE_TOLERANCE = 400;
/** Chi-square critical value for 5 degrees of freedom at p = 0.001. */
const CHI_SQUARE_LIMIT = 20.52;

function rollSequence(rngState: string, count: number): number[] {
  const values: number[] = [];
  let state = rngState;
  for (let index = 0; index < count; index += 1) {
    const roll = rollDie(state);
    values.push(roll.value);
    state = roll.nextRngState;
  }
  return values;
}

describe("seedRng", () => {
  it("produces a well-formed, deterministic state for the same seed", () => {
    const state = seedRng("seed-a");
    expect(isValidRngState(state)).toBe(true);
    expect(seedRng("seed-a")).toBe(state);
  });

  it("produces different states for different seeds", () => {
    expect(seedRng("seed-a")).not.toBe(seedRng("seed-b"));
  });

  it("rejects an empty seed", () => {
    expect(() => seedRng("")).toThrowError(
      expect.objectContaining({ code: "INVALID_SEED" }),
    );
  });
});

describe("rollDie", () => {
  it("is reproducible: same state gives the same sequence", () => {
    const state = seedRng("replay");
    expect(rollSequence(state, 50)).toEqual(rollSequence(state, 50));
  });

  it("locks the dice sequence for a fixed seed (regression guard)", () => {
    // Changing this sequence breaks every existing save; bump the RNG version instead.
    expect(rollSequence(seedRng("yamanote"), 12)).toMatchInlineSnapshot(`
      [
        2,
        6,
        1,
        3,
        1,
        4,
        2,
        6,
        1,
        4,
        1,
        6,
      ]
    `);
  });

  it("only returns integers 1-6", () => {
    const values = rollSequence(seedRng("range"), 1000);
    expect(values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)).toBe(true);
  });

  it("is close to uniform over 60k rolls", () => {
    const counts = new Map<number, number>(FACES.map((face) => [face, 0]));
    for (const value of rollSequence(seedRng("distribution"), SAMPLE_ROLLS)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let chiSquare = 0;
    for (const face of FACES) {
      const count = counts.get(face) ?? 0;
      expect(Math.abs(count - EXPECTED_PER_FACE)).toBeLessThan(PER_FACE_TOLERANCE);
      chiSquare += (count - EXPECTED_PER_FACE) ** 2 / EXPECTED_PER_FACE;
    }
    expect(chiSquare).toBeLessThan(CHI_SQUARE_LIMIT);
  });

  it("redraws when the first draw lands in the rejected top bucket", () => {
    // With a = 0xffffffff and b = c = d = 0 the first output is 0xffffffff
    // (rejected); the second output is 1, i.e. face 2, after two steps.
    const roll = rollDie("sfc32-v1:ffffffff:00000000:00000000:00000000");
    expect(roll.value).toBe(2);
    expect(roll.nextRngState.endsWith(":00000002")).toBe(true);
  });

  it.each([
    "",
    "sfc32-v1:1:2:3:4",
    "SFC32-V1:00000000:00000000:00000000:00000000",
    "xoshiro:00000000:00000000:00000000:00000000",
  ])("rejects the malformed state %j", (bad) => {
    expect(() => rollDie(bad)).toThrowError(
      expect.objectContaining({ code: "INVALID_RNG_STATE" }),
    );
  });
});

describe("faceFromDraw (no modulo bias by construction)", () => {
  it("maps the lowest draws to faces 1 and 6", () => {
    expect(faceFromDraw(0)).toBe(1);
    expect(faceFromDraw(5)).toBe(6);
  });

  it("accepts the last draw of the final complete bucket", () => {
    expect(faceFromDraw(4_294_967_291)).toBe(6);
  });

  it("rejects the four draws above the largest multiple of 6", () => {
    for (const draw of [4_294_967_292, 4_294_967_293, 4_294_967_294, 4_294_967_295]) {
      expect(faceFromDraw(draw)).toBeUndefined();
    }
  });
});

const UINT32_MAX = 0xffffffff;
const TWO_POW_32 = 2 ** 32;
const INVALID_STATE = expect.objectContaining({ code: "INVALID_STATE" });

function indexSequence(rngState: string, k: number, count: number): number[] {
  const values: number[] = [];
  let state = rngState;
  for (let index = 0; index < count; index += 1) {
    const draw = drawIndex(state, k);
    values.push(draw.index);
    state = draw.nextRngState;
  }
  return values;
}

describe("indexFromDraw (rejection boundary)", () => {
  it.each([
    // [k, draw, expected]: last accepted draw and first rejected draw per k.
    [2, 0, 0],
    [2, 1, 1],
    [2, UINT32_MAX, 1], // 2^32 mod 2 = 0: nothing rejected
    [3, UINT32_MAX - 1, 2], // limit = 2^32 - 1
    [3, UINT32_MAX, undefined],
    [6, 4_294_967_291, 5],
    [6, 4_294_967_292, undefined],
    [3_000_000_000, 2_999_999_999, 2_999_999_999], // limit = 3e9 (2^32 mod 3e9 = 1294967296)
    [3_000_000_000, 3_000_000_000, undefined],
    [TWO_POW_32 - 1, UINT32_MAX - 1, UINT32_MAX - 1],
    [TWO_POW_32 - 1, UINT32_MAX, undefined],
    [TWO_POW_32, UINT32_MAX, UINT32_MAX], // k = 2^32: every draw accepted
  ])("k = %d, draw %d -> %s", (k, draw, expected) => {
    expect(indexFromDraw(draw, k)).toBe(expected);
  });

  it("agrees with the die mapping for k = 6", () => {
    for (const draw of [0, 5, 6, 123_456_789, 4_294_967_291, 4_294_967_292, UINT32_MAX]) {
      const face = faceFromDraw(draw);
      expect(indexFromDraw(draw, 6)).toBe(face === undefined ? undefined : face - 1);
    }
  });

  it.each([1, 0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, TWO_POW_32 + 1])(
    "rejects the choice count %s",
    (k) => {
      expect(() => indexFromDraw(0, k)).toThrowError(INVALID_STATE);
      expect(() => drawIndex(seedRng("k"), k)).toThrowError(INVALID_STATE);
    },
  );

  it.each([-1, 1.5, TWO_POW_32])("rejects the non-uint32 draw %s", (draw) => {
    expect(() => indexFromDraw(draw, 2)).toThrowError(INVALID_STATE);
  });
});

describe("drawIndex", () => {
  it("redraws on rejection and every rejected draw advances the state", () => {
    // First output 0xffffffff, second output 1 (see the rollDie case above).
    const state = "sfc32-v1:ffffffff:00000000:00000000:00000000";
    const rejectedFirst = drawIndex(state, 3);
    expect(rejectedFirst.index).toBe(1);
    expect(rejectedFirst.nextRngState.endsWith(":00000002")).toBe(true);
    const acceptedFirst = drawIndex(state, 2);
    expect(acceptedFirst.index).toBe(1);
    expect(acceptedFirst.nextRngState.endsWith(":00000001")).toBe(true);
  });

  it("equals the die minus one for k = 6, state for state", () => {
    let state = seedRng("same-stream");
    for (let index = 0; index < 200; index += 1) {
      const roll = rollDie(state);
      const draw = drawIndex(state, 6);
      expect(draw.index).toBe(roll.value - 1);
      expect(draw.nextRngState).toBe(roll.nextRngState);
      state = roll.nextRngState;
    }
  });

  it("is deterministic and rejects a malformed state", () => {
    expect(indexSequence(seedRng("idx"), 3, 20)).toEqual(indexSequence(seedRng("idx"), 3, 20));
    expect(() => drawIndex("bad", 2)).toThrowError(
      expect.objectContaining({ code: "INVALID_RNG_STATE" }),
    );
  });

  // Chi-square critical values at p = 0.001 for k - 1 degrees of freedom.
  it.each([
    [2, 10.83],
    [3, 13.82],
    [5, 18.47],
    [7, 22.46],
  ])("is close to uniform for k = %d", (k, limit) => {
    const samples = 30_000;
    const counts = new Array<number>(k).fill(0);
    for (const index of indexSequence(seedRng(`uniform-${k}`), k, samples)) {
      counts[index] = (counts[index] ?? 0) + 1;
    }
    const expected = samples / k;
    const chiSquare = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(counts.every((count) => count > 0)).toBe(true);
    expect(chiSquare).toBeLessThan(limit);
  });
});
