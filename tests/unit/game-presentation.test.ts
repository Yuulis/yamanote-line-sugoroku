import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame, moveByRoll, playTurn } from "../../src/features/game/engine";
import { lastMoveOf, reduceGameSession, resumeSession, startSession } from "../../src/features/game/gameSession";
import { displayedRide, landingText, lastRollText } from "../../src/features/game/presentation";
import { earlyStopNote, summarizeGame } from "../../src/features/game/gameSummary";
import { loadBundle } from "../e2e/fixtures/bundle";
import { LEGACY_FIXTURE_GAME_SEED, LEGACY_FIXTURE_SCENARIO_TURNS } from "../e2e/fixtures/seeds";
import { M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");

// Historical 1/2-share fixture presentation regression. The production-rule
// unit trajectory and browser-visible lottery use the separate searched seed.
describe("legacy atomic turn presentation", () => {
  const started = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 1);
  const rolled = reduceGameSession(started, { type: "roll", sessionId: 1, rngSeed: LEGACY_FIXTURE_GAME_SEED, turn: 0 }, LEGACY_CAPITAL_REGION_CONFIG, network);

  it("shows the ridden service during the animation", () => {
    expect(rolled.game.currentServiceId).toBe("fixture-south");
    expect(displayedRide(rolled)).toEqual({ serviceId: "jr-yamanote", direction: 1 });
  });

  it("reveals the settled service on the accepted finish without another draw", () => {
    const finished = reduceGameSession(rolled, { type: "animation-finished", sessionId: 1, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network);
    expect(displayedRide(finished)).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(finished.game).toBe(rolled.game);
    expect(landingText(finished.lastMove, network)).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(reduceGameSession(finished, { type: "animation-finished", sessionId: 1, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network)).toBe(finished);
  });

  it("ignores a stale completion and resumes directly with the same lottery result", () => {
    expect(reduceGameSession(rolled, { type: "animation-finished", sessionId: 0, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network)).toBe(rolled);
    const resumed = resumeSession(rolled.game, network, 2);
    expect(resumed.phase).toBe("idle");
    expect(displayedRide(resumed)).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(resumed.lastMove).toEqual(rolled.lastMove);
  });
});

describe("legacy lottery and stop text", () => {
  let game = createGame(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network);
  const states = [game];
  while (game.status === "playing") {
    game = playTurn(game, network).state;
    states.push(game);
  }

  it("distinguishes area-boundary truncation from terminus truncation", () => {
    expect(lastRollText(lastMoveOf(states[LEGACY_FIXTURE_SCENARIO_TURNS.boundary]!, network), network)).toBe("3（大森で停止〔エリア端〕、残り1は使わず）");
    expect(lastRollText(lastMoveOf(states[LEGACY_FIXTURE_SCENARIO_TURNS.terminus]!, network), network)).toBe("6（品川で停止〔終点〕、残り4は使わず）");
    expect(landingText(lastMoveOf(states[2]!, network), network)).toBe("テスト南線のみ ／ エリア端のため折り返し（品川方面）");
  });

  it("labels a service boundary and retains stop/discard/reversal behavior", () => {
    const input = multiServiceInput();
    const spur = input.services.find((service) => service.id === M_SPUR)!;
    if (spur.circular) throw new Error("Expected linear fixture");
    spur.endpoints.last = "service-boundary";
    const multi = buildRailwayNetwork(input);
    const before = { ...createGame(multiConfig(), "service-boundary", multi), currentStationId: "s1", currentServiceId: M_SPUR, direction: 1 as const };
    const after = moveByRoll(before, 4, multi).state;
    const last = lastMoveOf(after, multi)!;
    expect(last.endpointKind).toBe("service-boundary");
    expect(last.unusedPips).toBe(3);
    expect(after.direction).toBe(-1);
    expect(lastRollText(last, multi)).toBe("4（駅s2で停止〔系統の端〕、残り3は使わず）");
    expect(landingText(last, multi)).toBe("m-spurのみ ／ 系統の端のため折り返し（逆方向）");
    expect(earlyStopNote(after.movementHistory.at(-1)!, (id) => id, "service-boundary")).toBe("s2で停止〔系統の端〕、残り3");
  });

  it("shows an actual direction-only lottery at a single-service station", () => {
    expect(landingText(lastMoveOf(states[LEGACY_FIXTURE_SCENARIO_TURNS.direction]!, network), network)).toBe("テスト南線のみ ／ 方向抽選 → 品川方面");
  });

  it("takes the endpoint kind from the ridden service when transferring away", () => {
    const multi = buildRailwayNetwork(multiServiceInput());
    const before = { ...createGame(multiConfig(), "endpoint", multi), currentStationId: "s1", currentServiceId: M_SPUR, direction: -1 as const };
    const after = moveByRoll(before, 4, multi, { serviceId: M_LOOP, direction: 1 }).state;
    const last = lastMoveOf(after, multi);
    expect(after.currentServiceId).toBe(M_LOOP);
    expect(last?.endpointKind).toBe("terminus");
    expect(lastRollText(last, multi)).toBe("4（駅bで停止〔終点〕、残り3は使わず）");
  });

  it("counts all hops and service changes in the clear summary", () => {
    expect(summarizeGame(game)).toEqual({ turns: LEGACY_FIXTURE_SCENARIO_TURNS.completed, moves: 44, transfers: 2 });
    expect(landingText(lastMoveOf(game, network), network)).toBe("—");
  });
});
