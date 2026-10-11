import { test as base, expect } from "@playwright/test";
import { installMapStub, type MapStub } from "./support/mapStub";

// Every test gets a fresh browser context (so an empty localStorage), the
// map stub and a deterministic `crypto.getRandomValues`, so `generateSeed()`
// (the only CSPRNG use in the app) yields the same game seed on every page
// load. The live map is read through src/features/map/e2eHook.ts, which only
// the `--mode e2e` build served by playwright.config.ts contains.

const DEFAULT_RNG_SEED = 0x5eed_2026;

interface E2EOptions {
  /** Seed of the stubbed `crypto.getRandomValues` byte stream. */
  rngSeed: number;
}

interface E2EFixtures {
  mapStub: MapStub;
}

/** Runs in the page before any app script. */
function installDeterministicRandom(seed: number): void {
  // xorshift32: a reproducible byte stream that restarts on every load.
  let state = seed >>> 0 || 1;
  const nextByte = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state & 0xff;
  };
  const original = crypto.getRandomValues.bind(crypto);
  type RandomTarget = Parameters<Crypto["getRandomValues"]>[0];
  const deterministic = (array: RandomTarget): RandomTarget => {
    if (!(array instanceof Uint8Array)) return original(array);
    for (let index = 0; index < array.length; index += 1) array[index] = nextByte();
    return array;
  };
  crypto.getRandomValues = deterministic as Crypto["getRandomValues"];
}

export const test = base.extend<E2EFixtures & E2EOptions>({
  rngSeed: [DEFAULT_RNG_SEED, { option: true }],
  mapStub: [
    async ({ context, baseURL, rngSeed }, use) => {
      if (!baseURL) throw new Error("baseURL must be configured");
      const stub = await installMapStub(context, baseURL);
      await context.addInitScript(installDeterministicRandom, rngSeed);
      await use(stub);
      // Hermetic: nothing may have tried to leave the stubbed hosts.
      expect(stub.counts.blocked, "unexpected external requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
