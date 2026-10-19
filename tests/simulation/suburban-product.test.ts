import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { gameSeed, runGame, summarizeTurns, validateRunOptions } from "./harness";
import {
  loadResearchCatalog,
  loadShippedBundle,
  sha256,
  SIMULATION_CODE_FILES,
} from "./inputs";

const BASE_SEED = 20261012;
const TURN_CAP = 20000;
const RESEARCH_CATALOG = ".claude/docs/research/tokyo-suburban-research-catalog.csv";
const RESEARCH_SERVICES = ".claude/docs/research/tokyo-suburban-research-services.csv";
const PRODUCT_DATA_DIR = resolve("public/data");

function gameplaySignature(network: ReturnType<typeof loadShippedBundle>["network"]): string {
  const services = [...network.servicesById.values()].map((service) => {
    const signature: Record<string, unknown> = {
      id: service.id,
      kind: service.kind,
      stationIds: service.stationIds,
      circular: service.circular,
    };
    if (!service.circular) signature.endpoints = service.endpoints;
    return signature;
  });
  const directedSegments = [...network.segmentsById.values()].map((segment) => ({
    serviceId: segment.serviceId,
    from: segment.from,
    to: segment.to,
  }));
  return JSON.stringify({ services, directedSegments });
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function codeFingerprint(): { files: Record<string, string>; sha256: string } {
  const files = Object.fromEntries(
    SIMULATION_CODE_FILES.map((path) => [path, fileSha256(path)]),
  );
  return { files, sha256: sha256(JSON.stringify(files)) };
}

function bundleHashes(): Record<string, string> {
  return Object.fromEntries(
    ["manifest.json", "stations.json", "services.json", "segments.json", "segments.geojson"]
      .map((file) => [file, fileSha256(`${PRODUCT_DATA_DIR}/${file}`)]),
  );
}

function envInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

it.skipIf(!process.env.SIM_BUNDLE)("S5 product shard preserves frozen gameplay and turns", () => {
  const bundleDirectory = resolve(process.env.SIM_BUNDLE as string);
  if (bundleDirectory !== PRODUCT_DATA_DIR) {
    throw new Error("S5 product measurements require SIM_BUNDLE=public/data");
  }
  const offset = envInteger("S5_OFFSET", 0, 0);
  const games = envInteger("S5_GAMES", 1250, 1);
  const outputPath = resolve(
    process.env.S5_OUTPUT ?? `.claude/logs/s5/sim-${offset}.json`,
  );
  const outputDirectories = [
    resolve(".claude/logs/s5"),
    resolve(".claude/logs/s6/simulation"),
  ];
  if (!outputDirectories.some((directory) => outputPath.startsWith(`${directory}/`))) {
    throw new Error("S5_OUTPUT must be below .claude/logs/s5 or .claude/logs/s6/simulation");
  }
  validateRunOptions({ baseSeed: BASE_SEED, games, turnCap: TURN_CAP });

  const product = loadShippedBundle(
    bundleDirectory,
    MVP_GAME_CONFIG.targetServiceId,
    MVP_GAME_CONFIG.startStationId,
  );
  const research = loadResearchCatalog(
    RESEARCH_CATALOG,
    RESEARCH_SERVICES,
    MVP_GAME_CONFIG.targetServiceId,
    MVP_GAME_CONFIG.startStationId,
  );
  const productSignature = gameplaySignature(product.network);
  const frozenSignature = gameplaySignature(research.network);
  expect(
    productSignature,
    "Product ordered service IDs/stops/kinds/loop endpoints/direct adjacency must match the frozen catalog",
  ).toBe(frozenSignature);

  const seeds = Array.from({ length: games }, (_, index) => gameSeed(BASE_SEED, offset + index));
  const turns: number[] = [];
  const cappedGameIndices: number[] = [];
  let totalPlayedTurns = 0;
  const started = performance.now();
  for (const [localIndex, seed] of seeds.entries()) {
    const game = runGame(product.network, MVP_GAME_CONFIG, seed, TURN_CAP);
    const capped = game.status !== "completed";
    totalPlayedTurns += game.turn;
    if (capped) cappedGameIndices.push(localIndex);
    turns.push(capped ? TURN_CAP + 1 : game.turn);
  }
  const runtimeSeconds = (performance.now() - started) / 1000;
  const statistics = summarizeTurns(turns, cappedGameIndices, totalPlayedTurns);
  const result = {
    schemaVersion: 1,
    measurement: "s5-product",
    shard: { offset, games, baseSeed: BASE_SEED, turnCap: TURN_CAP },
    seeds,
    seedSetSha256: sha256(`${seeds.join("\n")}\n`),
    config: MVP_GAME_CONFIG,
    input: product.provenance,
    bundleHashes: bundleHashes(),
    gameplaySignatureSha256: sha256(productSignature),
    codeFingerprint: codeFingerprint(),
    quantileConvention: "nearest-rank: ceil(p * games) - 1",
    turns,
    statistics,
    runtimeSeconds,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result));
  expect(statistics.games).toBe(games);
  expect(statistics.capHits, "Capped games are incomplete measurements").toBe(0);
}, 3_600_000);
