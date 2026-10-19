import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { gameSeed, PRESETS, presetConfig, runSimulation, validateRunOptions, type Preset } from "./harness";
import { DEFAULT_CATALOG, DEFAULT_SERVICES, loadResearchCatalog, loadShippedBundle, sha256 } from "./inputs";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";

const presetName = process.env.SIM_PRESET ?? "decided";
const preset: Preset | undefined = PRESETS.find((value) => value === presetName);
const productConfig = process.env.SIM_CONFIG === "product";
if (process.env.SIM_CONFIG && !productConfig) throw new Error("SIM_CONFIG must be product when set");
if (!productConfig && !preset) throw new Error(`SIM_PRESET must be one of ${PRESETS.join(", ")}`);
const options = {
  baseSeed: Number(process.env.SIM_SEED ?? 20261012),
  games: Number(process.env.SIM_GAMES ?? 200),
  turnCap: Number(process.env.SIM_CAP ?? 20000),
};
validateRunOptions(options);

it(`real-engine Monte Carlo: ${productConfig ? "product" : preset}`, () => {
  if (productConfig && !process.env.SIM_BUNDLE) {
    throw new Error("SIM_CONFIG=product requires SIM_BUNDLE=public/data");
  }
  const input = process.env.SIM_BUNDLE
    ? loadShippedBundle(process.env.SIM_BUNDLE, process.env.SIM_TARGET, process.env.SIM_START)
    : loadResearchCatalog(process.env.SIM_CATALOG ?? DEFAULT_CATALOG, process.env.SIM_SERVICES ?? DEFAULT_SERVICES,
      process.env.SIM_TARGET, process.env.SIM_START);
  const config = productConfig
    ? MVP_GAME_CONFIG
    : presetConfig(preset as Preset, input.targetServiceId, input.startStationId);
  if (productConfig && (
    input.targetServiceId !== config.targetServiceId
    || input.startStationId !== config.startStationId
  )) {
    throw new Error("Product simulation target/start differs from MVP_GAME_CONFIG");
  }
  const seeds = Array.from({ length: options.games }, (_, index) => gameSeed(options.baseSeed, index));
  const started = performance.now();
  const statistics = runSimulation(input.network, config, options);
  const summary = {
    schemaVersion: 1, engine: "createGame/playTurn", preset: productConfig ? "product" : preset,
    input: input.provenance, dataVersion: input.network.dataVersion,
    ...options,
    seedSet: { scheme: "s1m-${baseSeed}-${zeroBasedGameIndex}", first: seeds[0], last: seeds.at(-1),
      sha256: sha256(seeds.join("\n") + "\n") },
    config,
    quantileConvention: "nearest-rank: ceil(p * games) - 1",
    capConvention: "unfinished games counted as cap+1; not completed",
    history: "discarded after each real playTurn; no transition logic replaced",
    statistics, runtimeSeconds: (performance.now() - started) / 1000,
  };
  console.log(JSON.stringify(summary));
  if (process.env.SIM_OUTPUT) writeFileSync(process.env.SIM_OUTPUT, JSON.stringify(summary, null, 2) + "\n", "utf8");
  expect(statistics.games).toBe(options.games);
  expect(statistics.capHits, "Capped runs are incomplete measurements; inspect the saved summary").toBe(0);
}, 3_600_000);
