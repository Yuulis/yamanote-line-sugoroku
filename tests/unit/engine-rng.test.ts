import { describe, expect, it } from "vitest";
import {
  faceFromDraw,
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
