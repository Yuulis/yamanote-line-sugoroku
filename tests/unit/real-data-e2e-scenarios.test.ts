import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGeometryIndex, buildMovePlan } from "../../src/features/game/animation/movePath";
import { hopDurationMs } from "../../src/features/game/animation/timeline";
import {
  createGame,
  playTurn,
  restoreGame,
  serializeGame,
  targetSegmentIds,
  type MoveResult,
} from "../../src/features/game/engine";
import { lastMoveOf } from "../../src/features/game/gameSession";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { landingText } from "../../src/features/game/presentation";
import type { GameState } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import {
  PRODUCT_COMPOSED_GAME_SEED,
  PRODUCT_COMPOSED_SCENARIO_TURNS,
  PRODUCT_HISTORY_GAME_SEED,
  PRODUCT_HISTORY_SCENARIO_TURNS,
  PRODUCT_HUB_GAME_SEED,
  PRODUCT_KORAKUEN_TRANSFER_SEED,
  PRODUCT_KORAKUEN_TRANSFER_TURN,
  PRODUCT_UENO_TRANSFER_SEED,
} from "../e2e/fixtures/seeds";

function pinnedSave(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url)), "utf8");
}

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
  before: GameState;
  result: MoveResult;
}

interface ComposedTrajectory {
  seed: string;
  forward: SeededTurn;
  reverse: SeededTurn;
}

function seedText(candidate: number): string {
  return candidate.toString(16).padStart(32, "0");
}

function findHubLotterySeed(maxCandidate: number): { seed: string; result: MoveResult } {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    const result = playTurn(createGame(MVP_GAME_CONFIG, seed, network), network);
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
    let game = createGame(MVP_GAME_CONFIG, seed, network);
    let forward: SeededTurn | null = null;
    let reverse: SeededTurn | null = null;
    while (game.status === "playing" && game.turn < 250) {
      const before = game;
      const result = playTurn(game, network);
      const record = result.state.movementHistory.at(-1);
      if (record?.landing && record.traversedSegmentIds.includes(PRODUCT_COMPOSED_FORWARD) && record.landing.serviceId !== record.serviceId) {
        forward = { before, result };
      }
      if (record?.landing && record.traversedSegmentIds.includes(PRODUCT_COMPOSED_REVERSE) && record.landing.serviceId !== record.serviceId) {
        reverse = { before, result };
      }
      game = result.state;
      if (forward && reverse) return { seed, forward, reverse };
    }
  }
  throw new Error(`No forward and reverse composed-hop trajectory found through ${maxCandidate}`);
}

function finishGame(seed: string): GameState {
  let game = createGame(MVP_GAME_CONFIG, seed, network);
  while (game.status === "playing" && game.turn < 250) game = playTurn(game, network).state;
  return game;
}

function findUenoTransferSeed(maxCandidate: number): string {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    let game = createGame(MVP_GAME_CONFIG, seed, network);
    while (game.status === "playing" && game.turn < 5_000) {
      game = playTurn(game, network).state;
      if (game.currentStationId === "ueno" && game.currentServiceId === "jr-joban-rapid") return seed;
    }
  }
  throw new Error(`No Ueno Joban Rapid state found through ${maxCandidate}`);
}

function findKorakuenTransferSeed(maxCandidate: number): { seed: string; before: GameState; result: MoveResult } {
  for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
    const seed = seedText(candidate);
    let game = createGame(MVP_GAME_CONFIG, seed, network);
    while (game.status === "playing" && game.turn < 250) {
      const result = playTurn(game, network);
      const landing = result.events.find((event) => event.type === "landing-resolved");
      if (
        landing?.type === "landing-resolved" && landing.stationId === "metro-korakuen" &&
        landing.changedService &&
        network.servicesById.get(landing.serviceId)?.operator !== network.servicesById.get(result.state.movementHistory.at(-1)?.serviceId ?? "")?.operator
      ) return { seed, before: game, result };
      game = result.state;
    }
  }
  throw new Error(`No cross-operator Korakuen transfer found through ${maxCandidate}`);
}

describe("current product E2E scenarios", () => {
  it("matches engine-generated pre-transfer, pre-lottery, and pre-clear saves", () => {
    const fixtures = [
      ["tokyo-suburban-korakuen-before-transfer-save.json", PRODUCT_KORAKUEN_TRANSFER_SEED, 12],
      ["tokyo-suburban-oedo-before-lottery-save.json", PRODUCT_HISTORY_GAME_SEED, 15],
      ["tokyo-suburban-before-clear-save.json", PRODUCT_HISTORY_GAME_SEED, 41],
    ] as const;
    for (const [filename, seed, turn] of fixtures) {
      let game = createGame(MVP_GAME_CONFIG, seed, network);
      while (game.turn < turn) game = playTurn(game, network).state;
      expect(pinnedSave(filename)).toBe(`${serializeGame(game)}\n`);
    }
  });

  it("finds a cross-operator Korakuen transfer seed", () => {
    const scenario = findKorakuenTransferSeed(Number.parseInt(PRODUCT_KORAKUEN_TRANSFER_SEED, 16));
    const next = playTurn(scenario.result.state, network);
    expect(scenario.seed).toBe(PRODUCT_KORAKUEN_TRANSFER_SEED);
    expect(scenario.result.state.turn).toBe(PRODUCT_KORAKUEN_TRANSFER_TURN);
    expect(scenario.result.state.movementHistory.at(-1)).toMatchObject({
      turn: 13,
      roll: 6,
      serviceId: "toei-mita",
      fromStationId: "toei-onarimon",
      toStationId: "metro-korakuen",
      traversedSegmentIds: [
        "toei-mita:toei-onarimon:toei-uchisaiwaicho",
        "toei-mita:toei-uchisaiwaicho:yurakucho",
        "toei-mita:yurakucho:metro-otemachi",
        "toei-mita:metro-otemachi:metro-jimbocho",
        "toei-mita:metro-jimbocho:suidobashi",
        "toei-mita:suidobashi:metro-korakuen",
      ],
      landing: { serviceId: "metro-marunouchi", direction: 1 },
    });
    expect(scenario.result.events.at(-1)).toMatchObject({
      type: "landing-resolved",
      stationId: "metro-korakuen",
      serviceCandidates: ["metro-marunouchi", "metro-namboku", "toei-mita", "toei-oedo-loop"],
      serviceId: "metro-marunouchi",
      changedService: true,
    });
    expect(next.state.movementHistory.at(-1)).toMatchObject({
      turn: 14,
      serviceId: "metro-marunouchi",
      fromStationId: "metro-korakuen",
      toStationId: "ikebukuro",
      traversedSegmentIds: [
        "metro-marunouchi:metro-korakuen:metro-myogadani",
        "metro-marunouchi:metro-myogadani:metro-shin-otsuka",
        "metro-marunouchi:metro-shin-otsuka:ikebukuro",
      ],
    });
  });
  it("uses the frozen catalogue counts and derives the six-candidate hub scenario by ascending seed search", () => {
    expect(network.stationsById.size).toBe(1_586);
    expect(network.servicesById.size).toBe(135);
    expect(network.segmentsById.size).toBe(3_988);
    expect(servicesData.services.reduce((sum, service) => sum + service.stationIds.length, 0)).toBe(2_142);

    const scenario = findHubLotterySeed(Number.parseInt(PRODUCT_HUB_GAME_SEED, 16));
    expect(scenario.seed).toBe(PRODUCT_HUB_GAME_SEED);
    expect(scenario.result).toMatchObject({ roll: 4, state: { currentStationId: "shinagawa", currentServiceId: "jr-yamanote" } });
    expect(scenario.result.events.at(-1)).toMatchObject({
      type: "landing-resolved",
      stationId: "shinagawa",
      serviceCandidates: ["jr-yamanote", "jr-keihin-tohoku", "jr-tokaido", "jr-yokosuka", "jr-joban-rapid", "keikyu-main"],
      serviceId: "jr-yamanote",
      serviceDrawRequired: true,
      directionCandidates: [1],
      direction: 1,
      directionDrawRequired: false,
      changedService: false,
    });
    expect(landingText(lastMoveOf(scenario.result.state, network), network))
      .toBe("品川：6系統から抽選 → 山手線 ／ 外回りに固定");
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
    expect(trajectory.forward.result.state.movementHistory.at(-1)).toMatchObject({
      turn: 9,
      roll: 6,
      serviceId: "jr-shonan-shinjuku-rapid-takasaki",
      direction: 1,
      fromStationId: "shinjuku",
      toStationId: "totsuka",
      traversedSegmentIds: [
        "jr-shonan-shinjuku-rapid-takasaki:shinjuku:shibuya",
        "jr-shonan-shinjuku-rapid-takasaki:shibuya:ebisu",
        "jr-shonan-shinjuku-rapid-takasaki:ebisu:osaki",
        "jr-shonan-shinjuku-rapid-takasaki:osaki:musashi-kosugi",
        PRODUCT_COMPOSED_FORWARD,
        "jr-shonan-shinjuku-rapid-takasaki:yokohama:totsuka",
      ],
      landing: { serviceId: "jr-yokosuka", direction: 1 },
    });
    expect(trajectory.reverse.result.state.movementHistory.at(-1)).toMatchObject({
      turn: 16,
      roll: 3,
      serviceId: "jr-shonan-shinjuku-rapid-takasaki",
      direction: -1,
      fromStationId: "totsuka",
      toStationId: "osaki",
      traversedSegmentIds: [
        "jr-shonan-shinjuku-rapid-takasaki:totsuka:yokohama",
        PRODUCT_COMPOSED_REVERSE,
        "jr-shonan-shinjuku-rapid-takasaki:musashi-kosugi:osaki",
      ],
      landing: { serviceId: "jr-saikyo", direction: 1 },
    });
    expect(landingText(lastMoveOf(trajectory.forward.result.state, network), network))
      .toBe("戸塚：5系統から抽選 → 横須賀線 ／ 方向抽選 → 西大井方面");
    expect(landingText(lastMoveOf(trajectory.reverse.result.state, network), network))
      .toBe("大崎：5系統から抽選 → 埼京線・川越線 ／ 乗車方向は浮間舟渡方面のみ");

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
    const targetIds = targetSegmentIds(MVP_GAME_CONFIG, network);
    expect(targetIds).toHaveLength(30);
    expect(targetIds.every((id) => game.completedSegmentIds.includes(id))).toBe(true);
    expect(restoreGame(serializeGame(game), network, { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true })).toEqual(game);
  });
});
