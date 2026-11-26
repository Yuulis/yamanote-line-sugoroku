import { createGame, playTurn, type ProductTurnResult } from "../e2e/fixtures/productGame";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGeometryIndex, buildMovePlan } from "../../src/features/game/animation/movePath";
import { hopDurationMs } from "../../src/features/game/animation/timeline";
import {
  restoreGame,
  serializeGame,
  targetSegmentIds,
} from "../../src/features/game/engine";
import { resumeSession } from "../../src/features/game/gameSession";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { landingText } from "../../src/features/game/presentation";
import type { ItemGameState } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import {
  PRODUCT_COMPOSED_GAME_SEED,
  PRODUCT_COMPOSED_SCENARIO_TURNS,
  PRODUCT_HISTORY_GAME_SEED,
  PRODUCT_OEDO_GAME_SEED,
  PRODUCT_OEDO_LOTTERY_TURN,
  PRODUCT_HISTORY_SCENARIO_TURNS,
  PRODUCT_HUB_GAME_SEED,
  PRODUCT_KORAKUEN_TRANSFER_SEED,
  PRODUCT_KORAKUEN_TRANSFER_TURN,
  PRODUCT_UENO_TRANSFER_SEED,
} from "../e2e/fixtures/seeds";

function pinnedSave(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url)), "utf8");
}

const CURRENT_PRODUCT_RECORDS = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/current-product-records.json", import.meta.url)), "utf8",
)) as Record<string, unknown>;

const PRODUCT_COMPOSED_FORWARD = "jr-shonan-shinjuku-rapid-takasaki:musashi-kosugi:yokohama";
const PRODUCT_COMPOSED_REVERSE = "jr-shonan-shinjuku-rapid-takasaki:yokohama:musashi-kosugi";
const PRODUCT_COMPOSED_FEATURES = [
  "jr-yokosuka:musashi-kosugi~shin-kawasaki",
  "jr-yokosuka:shin-kawasaki~yokohama",
];

const bundle = await loadBundle("real");
const { network, data } = bundle;
const geometryResult = data.geometry;
const servicesResult = data.services;
if (!geometryResult.ok || !servicesResult.ok) throw new Error("The current product bundle must be complete");
const geometryData = geometryResult.value;
const servicesData = servicesResult.value;

interface SeededTurn {
  before: ItemGameState;
  result: ProductTurnResult;
}

interface ComposedTrajectory {
  seed: string;
  forward: SeededTurn;
  reverse: SeededTurn;
}

function seedText(candidate: number): string {
  return candidate.toString(16).padStart(32, "0");
}

function findHubLotterySeed(maxCandidate: number): { seed: string; result: ProductTurnResult } {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    const result = playTurn(createGame(DEFAULT_GAME_CONFIG, seed, network), network);
    const landing = result.events.find((event) => event.type === "landing-resolved");
    if (landing?.type === "landing-resolved" && landing.stationId === "shinagawa" && landing.serviceCandidates.length === 6) {
      return { seed, result };
    }
  }
  throw new Error(`No six-candidate Shinagawa arrival found through ${maxCandidate}`);
}

function findComposedTrajectory(maxCandidate: number): ComposedTrajectory {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    let game = createGame(DEFAULT_GAME_CONFIG, seed, network);
    let forward: SeededTurn | null = null;
    let reverse: SeededTurn | null = null;
    while (game.status === "playing" && game.turn < 250) {
      const before = game;
      const result = playTurn(game, network);
      const record = result.state.movementHistory.at(-1);
      const directPlainTurn = !record?.itemEvents.some((event) => event.type === "pickup-pending-discard")
        && record?.movementMode === "normal"
        && record.itemEvents.every((event) => event.type !== "effect-activated");
      if (directPlainTurn && record?.landing && record.traversedSegmentIds.includes(PRODUCT_COMPOSED_FORWARD) && record.landing.serviceId !== record.resolvedRide!.serviceId) {
        forward = { before, result };
      }
      if (directPlainTurn && record?.landing && record.traversedSegmentIds.includes(PRODUCT_COMPOSED_REVERSE) && record.landing.serviceId !== record.resolvedRide!.serviceId) {
        reverse = { before, result };
      }
      game = result.state;
      if (forward && reverse) return { seed, forward, reverse };
    }
  }
  throw new Error(`No forward and reverse composed-hop trajectory found through ${maxCandidate}`);
}

function finishGame(seed: string): ItemGameState {
  let game = createGame(DEFAULT_GAME_CONFIG, seed, network);
  while (game.status === "playing" && game.turn < 250) game = playTurn(game, network).state;
  return game;
}

function findUenoTransferSeed(maxCandidate: number): string {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    let game = createGame(DEFAULT_GAME_CONFIG, seed, network);
    while (game.status === "playing" && game.turn < 5_000) {
      game = playTurn(game, network).state;
      if (game.currentStationId === "ueno" && game.currentServiceId === "jr-joban-rapid") return seed;
    }
  }
  throw new Error(`No Ueno Joban Rapid state found through ${maxCandidate}`);
}

function findKorakuenTransferSeed(maxCandidate: number): { seed: string; before: ItemGameState; result: ProductTurnResult } {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    let game = createGame(DEFAULT_GAME_CONFIG, seed, network);
    while (game.status === "playing" && game.turn < 250) {
      const result = playTurn(game, network);
      const landing = result.events.find((event) => event.type === "landing-resolved");
      if (
        landing?.type === "landing-resolved" && landing.stationId === "metro-korakuen" &&
        landing.changedService &&
        network.servicesById.get(landing.serviceId)?.operator !== network.servicesById.get(result.state.movementHistory.at(-1)?.resolvedRide?.serviceId ?? "")?.operator
      ) return { seed, before: game, result };
      game = result.state;
    }
  }
  throw new Error(`No cross-operator Korakuen transfer found through ${maxCandidate}`);
}

describe("current product E2E scenarios", () => {
  it("matches engine-generated pre-transfer, pre-lottery, and pre-clear saves", () => {
    const fixtures = [
      ["tokyo-suburban-korakuen-before-transfer-save.json", PRODUCT_KORAKUEN_TRANSFER_SEED, PRODUCT_KORAKUEN_TRANSFER_TURN - 1],
      ["tokyo-suburban-oedo-before-lottery-save.json", PRODUCT_OEDO_GAME_SEED, PRODUCT_OEDO_LOTTERY_TURN - 1],
      ["tokyo-suburban-before-clear-save.json", PRODUCT_HISTORY_GAME_SEED, PRODUCT_HISTORY_SCENARIO_TURNS.completed - 1],
    ] as const;
    for (const [filename, seed, turn] of fixtures) {
      let game = createGame(DEFAULT_GAME_CONFIG, seed, network);
      while (game.turn < turn) game = playTurn(game, network).state;
      expect(pinnedSave(filename)).toBe(`${serializeGame(game)}\n`);
    }
  });

  it("finds the first grouped Oedo arrival under item rules", () => {
    let found: { seed: string; turn: number } | undefined;
    for (let candidate = 0; candidate <= Number.parseInt(PRODUCT_OEDO_GAME_SEED, 16) && !found; candidate++) {
      let game = createGame(DEFAULT_GAME_CONFIG, seedText(candidate), network);
      while (game.status === "playing" && game.turn < 5_000) {
        const result = playTurn(game, network);
        const candidates = result.record.landingSnapshot?.services.map((service) => service.serviceId) ?? [];
        game = result.state;
        if (result.record.toStationId === "toei-tochomae" && candidates.includes("toei-oedo-loop") && candidates.includes("toei-oedo-radial")) {
          found = { seed: seedText(candidate), turn: game.turn };
          break;
        }
      }
    }
    expect(found).toEqual({ seed: PRODUCT_OEDO_GAME_SEED, turn: PRODUCT_OEDO_LOTTERY_TURN });
  });

  it("pins regenerated save bytes and every source bundle hash in provenance", () => {
    const provenance = JSON.parse(pinnedSave("item-saves.provenance.json")) as {
      rulesetVersion: string; dataVersion: string; bundleSha256: Record<string, string>;
      saves: { filename: string; seed: string; turn: number; sha256: string }[];
    };
    const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
    expect(provenance.rulesetVersion).toBe(DEFAULT_GAME_CONFIG.rulesetVersion);
    expect(provenance.dataVersion).toBe(network.dataVersion);
    expect(provenance.bundleSha256).toEqual(Object.fromEntries(
      Object.entries(bundle.payloads).map(([file, payload]) => [file, hash(payload)]),
    ));
    expect(provenance.saves).toHaveLength(3);
    for (const entry of provenance.saves) {
      const text = pinnedSave(entry.filename);
      expect(hash(text)).toBe(entry.sha256);
      const game = restoreGame(text, network, { expectedConfig: DEFAULT_GAME_CONFIG, requireSeededRolls: true });
      expect(game.rngSeed).toBe(entry.seed);
      expect(game.turn).toBe(entry.turn);
    }
  });

  it("finds a cross-operator Korakuen transfer seed", () => {
    const scenario = findKorakuenTransferSeed(Number.parseInt(PRODUCT_KORAKUEN_TRANSFER_SEED, 16));
    const next = playTurn(scenario.result.state, network);
    expect(scenario.seed).toBe(PRODUCT_KORAKUEN_TRANSFER_SEED);
    expect(scenario.result.state.turn).toBe(PRODUCT_KORAKUEN_TRANSFER_TURN);
    expect(CURRENT_PRODUCT_RECORDS.metadata).toEqual({
      rulesetVersion: DEFAULT_GAME_CONFIG.rulesetVersion,
      korakuenSeed: PRODUCT_KORAKUEN_TRANSFER_SEED,
      composedSeed: PRODUCT_COMPOSED_GAME_SEED,
    });
    expect(scenario.result.record).toEqual(CURRENT_PRODUCT_RECORDS.korakuenTransfer);

    expect(scenario.result.events.at(-1)).toMatchObject({
      type: "landing-resolved",
      stationId: "metro-korakuen",
      serviceCandidates: ["metro-marunouchi", "metro-namboku", "toei-mita", "toei-oedo-loop"],
      serviceId: "metro-marunouchi",
      changedService: true,
    });
    expect(next.record).toEqual(CURRENT_PRODUCT_RECORDS.korakuenNext);

  });
  it("uses the frozen catalogue counts and derives the six-candidate hub scenario by ascending seed search", () => {
    expect(network.stationsById.size).toBe(1_586);
    expect(network.servicesById.size).toBe(135);
    expect(network.segmentsById.size).toBe(3_988);
    expect(servicesData.services.reduce((sum, service) => sum + service.stationIds.length, 0)).toBe(2_142);

    const scenario = findHubLotterySeed(Number.parseInt(PRODUCT_HUB_GAME_SEED, 16));
    expect(scenario.seed).toBe(PRODUCT_HUB_GAME_SEED);
    expect(scenario.result).toMatchObject({ roll: 4, state: { currentStationId: "shinagawa", currentServiceId: "keikyu-main" } });
    expect(scenario.result.events.at(-1)).toMatchObject({
      type: "landing-resolved",
      stationId: "shinagawa",
      serviceCandidates: ["jr-yamanote", "jr-keihin-tohoku", "jr-tokaido", "jr-yokosuka", "jr-joban-rapid", "keikyu-main"],
      serviceId: "keikyu-main",
      serviceDrawRequired: true,
      directionCandidates: [1, -1],
      direction: 1,
      directionDrawRequired: true,
      changedService: true,
    });
    expect(landingText(resumeSession(scenario.result.state, network).lastMove, network))
      .toBe("品川：6系統から抽選 → 京急本線 普通 ／ 方向抽選 → 浦賀方面");
  });

  it("derives the first ascending seed that reaches Ueno on Joban Rapid", () => {
    expect(findUenoTransferSeed(Number.parseInt(PRODUCT_UENO_TRANSFER_SEED, 16))).toBe(PRODUCT_UENO_TRANSFER_SEED);
  });

  it("proves the first composed-hop seed, turns, geometry chain, and landing transitions under current rules", () => {
    const forwardSegment = network.segmentsById.get(PRODUCT_COMPOSED_FORWARD);
    const reverseSegment = network.segmentsById.get(PRODUCT_COMPOSED_REVERSE);
    expect(forwardSegment?.geometryFeatureIds).toEqual(PRODUCT_COMPOSED_FEATURES);
    expect(reverseSegment?.geometryFeatureIds).toEqual([...PRODUCT_COMPOSED_FEATURES].reverse());

    const trajectory = findComposedTrajectory(Number.parseInt(PRODUCT_COMPOSED_GAME_SEED, 16));
    expect(trajectory.seed).toBe(PRODUCT_COMPOSED_GAME_SEED);
    expect(trajectory.forward.result.state.turn).toBe(PRODUCT_COMPOSED_SCENARIO_TURNS.forward);
    expect(trajectory.reverse.result.state.turn).toBe(PRODUCT_COMPOSED_SCENARIO_TURNS.reverse);
    expect(trajectory.forward.result.record).toEqual(CURRENT_PRODUCT_RECORDS.composedForward);

    expect(trajectory.reverse.result.record).toEqual(CURRENT_PRODUCT_RECORDS.composedReverse);

    expect(landingText(resumeSession(trajectory.forward.result.state, network).lastMove, network))
      .toBe("横浜：10系統から抽選 → 相鉄本線 各停 ／ 乗車方向は海老名方面のみ");
    expect(landingText(resumeSession(trajectory.reverse.result.state, network).lastMove, network))
      .toBe("新宿：12系統から抽選 → 京王線 各停 ／ 乗車方向は京王八王子方面のみ");

    const geometry = buildGeometryIndex(geometryData);
    for (const scenario of [trajectory.forward, trajectory.reverse]) {
      const record = scenario.result.state.movementHistory.at(-1)!;
      const targetId = record.traversedSegmentIds.find((id) => id === PRODUCT_COMPOSED_FORWARD || id === PRODUCT_COMPOSED_REVERSE)!;
      const plan = buildMovePlan(scenario.result.events, network, geometry);
      expect(plan.map((step) => step.segmentId)).toEqual(record.traversedSegmentIds);
      expect(plan.filter((step) => step.segmentId === targetId)).toHaveLength(1);
      const composedStep = plan.find((step) => step.segmentId === targetId)!;
      expect(composedStep.points.length).toBeGreaterThan(2);
      expect(hopDurationMs(composedStep, 450)).toBe(1_200);
    }
  });

  it("pins a current-product completion with the full Yamanote target and strict restore", () => {
    const game = finishGame(PRODUCT_HISTORY_GAME_SEED);
    expect(game).toMatchObject({ status: "completed", turn: PRODUCT_HISTORY_SCENARIO_TURNS.completed, currentStationId: "shimbashi" });
    const targetIds = targetSegmentIds(DEFAULT_GAME_CONFIG, network);
    expect(targetIds).toHaveLength(30);
    expect(targetIds.every((id) => game.completedSegmentIds.includes(id))).toBe(true);
    expect(restoreGame(serializeGame(game), network, { expectedConfig: DEFAULT_GAME_CONFIG, requireSeededRolls: true })).toEqual(game);
  });
});
