// Seeded, serialisable PRNG for the dice (spec 3.2, 3.4, 8.1).
//
// Algorithm: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator,
// 128-bit state, passes PractRand / BigCrush) seeded from the seed string with
// the cyrb128 hash (UTF-16 code units, no trimming or normalisation). The
// fourth word is a counter, so no state (all-zero included) is a fixed point
// and every state has a period of at least 2^32. All arithmetic stays in
// 32-bit integer operations, so results are identical on every JS engine.
//
// Changing the hash, the seeding, or the step order changes every game's
// dice; bump RNG_STATE_PREFIX (and the save version) if that ever happens.
//
// Per-turn draw order (part of the ruleset, see landing.ts): rollDie, then,
// unless the move cleared the game, a service draw iff the arrival station
// has k >= 2 services, then a direction draw iff the chosen service is not
// the target service and both directions are movable. Forced choices draw
// nothing, so a game that never meets a real choice consumes exactly the
// plain dice sequence.

import { GameEngineError } from "./errors";

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

export interface DieRoll {
  value: DieFace;
  nextRngState: string;
}

type Sfc32State = readonly [number, number, number, number];

const RNG_STATE_PREFIX = "sfc32-v1";
const RNG_STATE_PATTERN = /^sfc32-v1(?::[0-9a-f]{8}){4}$/;
const HEX_RADIX = 16;
const WORD_HEX_DIGITS = 8;
/** Standard sfc32 seeding: counter starts at 1, then 15 discarded outputs. */
const SEED_COUNTER_START = 1;
const SEED_WARMUP_ROUNDS = 15;

const DIE_FACES = 6;
const UINT32_RANGE = 2 ** 32;
/** Largest multiple of 6 that fits in 2^32; draws at or above it are rejected. */
const UNBIASED_LIMIT = UINT32_RANGE - (UINT32_RANGE % DIE_FACES);
/** A lottery needs at least two candidates; one candidate is forced and draws nothing. */
const MIN_CHOICES = 2;

/** cyrb128 string hash: four 32-bit words. */
function hashSeed(seed: string): Sfc32State {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** One sfc32 step: a uniform uint32 and the following state. */
function nextUint32(state: Sfc32State): { value: number; next: Sfc32State } {
  const [a, b, c, d] = state;
  const t = (((a + b) | 0) + d) | 0;
  const nextD = (d + 1) | 0;
  const nextA = b ^ (b >>> 9);
  const nextB = (c + (c << 3)) | 0;
  const rotatedC = (c << 21) | (c >>> 11);
  const nextC = (rotatedC + t) | 0;
  return {
    value: t >>> 0,
    next: [nextA >>> 0, nextB >>> 0, nextC >>> 0, nextD >>> 0],
  };
}

function encodeState(state: Sfc32State): string {
  const words = state.map((word) =>
    word.toString(HEX_RADIX).padStart(WORD_HEX_DIGITS, "0"),
  );
  return [RNG_STATE_PREFIX, ...words].join(":");
}

function decodeState(rngState: string): Sfc32State {
  if (!isValidRngState(rngState)) {
    throw new GameEngineError("INVALID_RNG_STATE", "Invalid RNG state");
  }
  const [a = 0, b = 0, c = 0, d = 0] = rngState
    .split(":")
    .slice(1)
    .map((word) => Number.parseInt(word, HEX_RADIX));
  return [a, b, c, d];
}

/** True when `rngState` is a well-formed serialised generator state. */
export function isValidRngState(rngState: unknown): rngState is string {
  return typeof rngState === "string" && RNG_STATE_PATTERN.test(rngState);
}

/** Derive the initial generator state from a non-empty seed string. */
export function seedRng(seed: string): string {
  if (seed.length === 0) {
    throw new GameEngineError("INVALID_SEED", "Seed must be a non-empty string");
  }
  const [a, b, c] = hashSeed(seed);
  let state: Sfc32State = [a, b, c, SEED_COUNTER_START];
  for (let round = 0; round < SEED_WARMUP_ROUNDS; round += 1) {
    state = nextUint32(state).next;
  }
  return encodeState(state);
}

/**
 * Map a uniform uint32 draw to a die face, or `undefined` when the draw falls
 * in the incomplete top bucket [UNBIASED_LIMIT, 2^32) and must be rejected
 * (probability 4 / 2^32). Every face keeps exactly 715827882 accepted draws,
 * so `draw % 6` is never biased.
 */
export function faceFromDraw(draw: number): DieFace | undefined {
  if (draw >= UNBIASED_LIMIT) return undefined;
  return ((draw % DIE_FACES) + 1) as DieFace;
}

/** Roll a fair die, redrawing on rejection; rejected draws still advance the state. */
export function rollDie(rngState: string): DieRoll {
  let state = decodeState(rngState);
  for (;;) {
    const draw = nextUint32(state);
    state = draw.next;
    const value = faceFromDraw(draw.value);
    if (value !== undefined) return { value, nextRngState: encodeState(state) };
  }
}

export interface IndexDraw {
  index: number;
  nextRngState: string;
}

function assertChoiceCount(k: number): void {
  if (!Number.isInteger(k) || k < MIN_CHOICES || k > UINT32_RANGE) {
    throw new GameEngineError("INVALID_STATE", `Choice count must be an integer 2-2^32: ${k}`);
  }
}

/**
 * Map a uniform uint32 draw to an index in [0, k), or `undefined` when the
 * draw falls in the incomplete top bucket [2^32 - (2^32 mod k), 2^32) and
 * must be rejected. The limit is computed in ordinary number arithmetic
 * (a bitwise expression would turn 2^32 into 0), so every index keeps
 * exactly floor(2^32 / k) accepted draws.
 *
 * @throws GameEngineError `INVALID_STATE` for a non-integer k outside 2..2^32
 *   or a draw that is not a uint32.
 */
export function indexFromDraw(draw: number, k: number): number | undefined {
  assertChoiceCount(k);
  if (!Number.isInteger(draw) || draw < 0 || draw >= UINT32_RANGE) {
    throw new GameEngineError("INVALID_STATE", `Draw must be a uint32: ${draw}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % k);
  if (draw >= limit) return undefined;
  return draw % k;
}

/**
 * Draw a uniform index in [0, k) for a lottery over k >= 2 candidates,
 * redrawing on rejection (rejected draws still advance the state). Callers
 * never draw for a forced choice (k = 1): see the per-turn draw order in
 * landing.ts.
 *
 * @throws GameEngineError `INVALID_STATE` (bad k), `INVALID_RNG_STATE`
 */
export function drawIndex(rngState: string, k: number): IndexDraw {
  assertChoiceCount(k);
  let state = decodeState(rngState);
  for (;;) {
    const draw = nextUint32(state);
    state = draw.next;
    const index = indexFromDraw(draw.value, k);
    if (index !== undefined) return { index, nextRngState: encodeState(state) };
  }
}
