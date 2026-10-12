import { test as base, expect } from "@playwright/test";
import { loadBundle, type DatasetKind, type RailwayBundle } from "./fixtures/bundle";
import { FIXTURE_GAME_SEED } from "./fixtures/seeds";
import { installMapStub, type MapStub } from "./support/mapStub";

interface E2EOptions {
  /** Each spec selects its data explicitly; real-data smoke opts out of interception. */
  dataset: DatasetKind;
  gameSeed: string;
}

interface E2EFixtures {
  mapStub: MapStub;
  railwayBundle: RailwayBundle;
}

/** Self-contained: Playwright serializes only this function and its argument. */
function installGameSeed(bytes: number[]): void {
  const original = crypto.getRandomValues.bind(crypto);
  type RandomTarget = Parameters<Crypto["getRandomValues"]>[0];
  let offset = 0;
  const deterministic = (array: RandomTarget): RandomTarget => {
    if (!(array instanceof Uint8Array)) return original(array);
    for (let index = 0; index < array.length; index += 1) {
      array[index] = bytes[offset % bytes.length]!;
      offset += 1;
    }
    return array;
  };
  crypto.getRandomValues = deterministic as Crypto["getRandomValues"];
}

export const test = base.extend<E2EFixtures & E2EOptions>({
  dataset: ["real", { option: true }],
  gameSeed: [FIXTURE_GAME_SEED, { option: true }],
  railwayBundle: [
    async ({ page, baseURL, dataset }, use) => {
      if (!baseURL) throw new Error("baseURL must be configured");
      const bundle = await loadBundle(dataset);
      if (dataset === "fixture") {
        await page.route(`${baseURL}data/*`, async (route) => {
          const file = new URL(route.request().url()).pathname.split("/").at(-1)!;
          const body = bundle.payloads[file];
          if (body === undefined) throw new Error(`Unexpected fixture data request: ${file}`);
          await route.fulfill({ status: 200, contentType: "application/json", body });
        });
      }
      await use(bundle);
    },
    { auto: true },
  ],
  mapStub: [
    async ({ context, baseURL, gameSeed }, use) => {
      if (!baseURL) throw new Error("baseURL must be configured");
      if (!/^[0-9a-f]{32}$/.test(gameSeed)) throw new Error("gameSeed must be 128-bit hex");
      const bytes = gameSeed.match(/../g)!.map((byte) => Number.parseInt(byte, 16));
      const stub = await installMapStub(context, baseURL);
      await context.addInitScript(installGameSeed, bytes);
      await use(stub);
      expect(stub.counts.blocked, "unexpected external requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
