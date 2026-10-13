import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Map as MapLibreMap } from "maplibre-gl";
import { createGame, playTurn, restoreGame, serializeGame, type MoveResult } from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { buildGeometryIndex, buildMovePlan, positionAlong } from "../../src/features/game/animation/movePath";
import { frameAt, hopDurationMs, HOP_TIMING } from "../../src/features/game/animation/timeline";
import { displayedProgress } from "../../src/features/game/animation/displayedProgress";
import { lastMoveOf, reduceGameSession, startSession } from "../../src/features/game/gameSession";
import { displayedRide, landingText } from "../../src/features/game/presentation";
import { GamePanel } from "../../src/features/game/components/GamePanel";
import { initialOverviewServices } from "../../src/features/map/camera";
import { buildTrackColorExpression } from "../../src/features/map/lineColor";
import { indexServiceGeometry } from "../../src/features/map/serviceGeometry";
import { addRailwayLayers, updateHighlightedService } from "../../src/features/map/railwayLayers";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { loadBundle } from "../e2e/fixtures/bundle";
import { CAPITAL_BRANCH_SEED, CAPITAL_GAME_SEED, CAPITAL_SCENARIO_TURNS } from "../e2e/fixtures/capital-region/seeds";

const bundle = await loadBundle("capital-region");
const { network, data } = bundle;
if (!data.geometry.ok || !data.services.ok || !data.segments.ok || !data.stations.ok) throw new Error("Fixture must be complete");
const geometry = buildGeometryIndex(data.geometry.value);
const services = data.services.value;
const segments = data.segments.value;
const stations = data.stations.value;
const fresh = createGame(MVP_GAME_CONFIG, CAPITAL_GAME_SEED, network);
const turns: MoveResult[] = [];
let game = fresh;
while (game.status === "playing" && game.turn < 100) {
  const result = playTurn(game, network);
  turns.push(result);
  game = result.state;
}

describe("capital-region fixture and pinned seeds", () => {
  it("contains eight services, a seven-way hub, shared multi-line rapid geometry and a branch", () => {
    expect(services.services).toHaveLength(8);
    expect(network.servicesByStation.get("shinagawa")).toHaveLength(7);
    expect(services.services.find((s) => s.id === "capital-rapid")).toMatchObject({ kind: "rapid", lineIds: ["capital-main-a", "capital-main-b"] });
    const forward = segments.find((s) => s.id === "capital-rapid:shinagawa:capital-south")!;
    const reverse = segments.find((s) => s.id === "capital-rapid:capital-south:shinagawa")!;
    expect(reverse.geometryFeatureIds).toEqual([...forward.geometryFeatureIds].reverse());
    expect(new Set(forward.geometryFeatureIds.map((id) => data.geometry.ok && data.geometry.value.features.find((f) => f.id === id)!.properties.serviceId)).size).toBe(2);
    expect(network.servicesById.get("capital-branch")?.stationIds).toEqual(["capital-west", "shinagawa", "capital-branch-end"]);
  });

  it("pins transfer, forward rapid, reverse rapid and completion", () => {
    expect(turns.slice(0, 3).map((t) => ({ roll: t.roll, station: t.state.currentStationId, service: t.state.currentServiceId, direction: t.state.direction }))).toEqual([
      { roll: 4, station: "shinagawa", service: "capital-rapid", direction: 1 },
      { roll: 2, station: "capital-south", service: "capital-rapid", direction: -1 },
      { roll: 6, station: "shinagawa", service: "capital-owner-a", direction: 1 },
    ]);
    expect(game).toMatchObject({ status: "completed", turn: CAPITAL_SCENARIO_TURNS.completed, currentStationId: "shimbashi" });
    expect(game.movementHistory.at(-1)?.landing).toBeNull();
  });

  it("proves the resumed natural-completion browser input rides rapid and lands on owner A", () => {
    const saved = turns[CAPITAL_SCENARIO_TURNS.rapidForward - 1]!.state;
    expect(saved).toMatchObject({ turn: 2, currentStationId: "capital-south", currentServiceId: "capital-rapid", direction: -1 });
    const restored = restoreGame(serializeGame(saved), network, { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true });
    const result = playTurn(restored, network);
    expect(result).toEqual(turns[CAPITAL_SCENARIO_TURNS.rapidReverse - 1]);
    expect(result.state.movementHistory.at(-1)).toMatchObject({
      roll: 6,
      serviceId: "capital-rapid",
      fromStationId: "capital-south",
      toStationId: "shinagawa",
      traversedSegmentIds: ["capital-rapid:capital-south:shinagawa"],
      landing: { serviceId: "capital-owner-a", direction: 1 },
    });
    const plan = buildMovePlan(result.events, network, geometry);
    expect(plan).toHaveLength(1);
    expect(hopDurationMs(plan[0]!, 450)).toBe(1200);
    expect(frameAt(plan, 650, 450).done).toBe(false);
    expect(frameAt(plan, 1300, 450).done).toBe(true);
  });

  it("proves the independent branch seed uses a service-boundary then crosses the fork", () => {
    let state = createGame(MVP_GAME_CONFIG, CAPITAL_BRANCH_SEED, network);
    const results: MoveResult[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = playTurn(state, network);
      results.push(result);
      state = result.state;
    }
    expect(results[2]?.state.currentServiceId).toBe("capital-branch");
    expect(results[3]?.state.movementHistory.at(-1)).toMatchObject({ serviceId: "capital-branch", toStationId: "capital-branch-end", stopReason: "endpoint" });
    expect(lastMoveOf(results[3]!.state, network)?.endpointKind).toBe("service-boundary");
    expect(results[4]?.state.movementHistory.at(-1)?.traversedSegmentIds).toEqual(["capital-branch:capital-branch-end:shinagawa", "capital-branch:shinagawa:capital-west"]);
  });

  it("restores every pinned save without redrawing any lottery", () => {
    for (const state of [fresh, ...turns.map((turn) => turn.state)]) {
      const restored = restoreGame(serializeGame(state), network, { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true });
      expect(restored).toEqual(state);
      if (state.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });
});

describe("scaled map and presentation", () => {
  const legendMarkup = (): string => renderToStaticMarkup(createElement(GamePanel, {
    session: startSession(MVP_GAME_CONFIG, CAPITAL_GAME_SEED, network, 1),
    network,
    lines: services.lines,
    displayedStationId: fresh.currentStationId,
    displayedCompletedCount: 0,
    requiredCount: 30,
    saveStatus: null,
    follow: true,
    speedLabel: "ふつう",
    reducedMotion: true,
    onRoll: () => {},
    onSkip: () => {},
    onToggleFollow: () => {},
    onCycleSpeed: () => {},
    onNewGame: () => {},
    onShowTitle: () => {},
  }));

  it("renders a single-service line as a flat service-name legend item", () => {
    const markup = legendMarkup();
    expect(markup).toMatch(/<li><span class="legend-swatch legend-swatch--service"[^>]*><\/span>広域支線<\/li>/);
    expect(markup).not.toContain("テスト支線");
    expect(markup).not.toContain("（1系統）");
  });

  it("renders multiple services under a collapsible line header with all service names", () => {
    const markup = legendMarkup();
    expect(markup).toMatch(/<details><summary>.*?テスト広域線（3系統）<\/summary><ul><li>広域北系統<\/li><li>広域東系統<\/li><li>広域海岸系統<\/li><\/ul><\/details>/);
    expect(markup).not.toContain("<details open");
  });

  it("indexes rapid primitives by the ridden service regardless of owner, with no direction duplicates", () => {
    expect(indexServiceGeometry(segments).get("capital-rapid")).toEqual(["capital-owner-a:shinagawa~capital-joint", "capital-owner-b:capital-joint~capital-south"]);
  });

  it("uses line metadata, configured target and a separate service-coloured highlight", () => {
    const layers: Record<string, Record<string, unknown>> = {};
    const filters: Record<string, unknown> = {};
    const paints: Record<string, unknown> = {};
    const map = {
      addSource: () => {},
      addLayer: (layer: { id: string }) => { layers[layer.id] = layer; },
      getLayer: (id: string) => layers[id],
      setFilter: (id: string, filter: unknown) => { filters[id] = filter; },
      setPaintProperty: (id: string, name: string, value: unknown) => { paints[`${id}:${name}`] = value; },
    } as unknown as MapLibreMap;
    addRailwayLayers(map, { geometry: data.geometry.ok ? data.geometry.value : undefined, lines: services.lines, services: services.services, targetServiceId: "custom-target" });
    expect(layers[LAYER_IDS.services]?.filter).toEqual(["!=", ["get", "serviceId"], "custom-target"]);
    expect(layers[LAYER_IDS.base]?.paint).toMatchObject({ "line-color": buildTrackColorExpression(services.lines) });
    expect(layers[LAYER_IDS.services]?.paint).not.toHaveProperty("line-offset");
    expect(layers[LAYER_IDS.segmentsPending]?.filter).toEqual(expect.arrayContaining([["==", ["get", "serviceId"], "custom-target"]]));
    const ids = indexServiceGeometry(segments).get("capital-rapid")!;
    updateHighlightedService(map, ids, "#EE2222");
    expect(filters[LAYER_IDS.currentService]).toEqual(["in", ["get", "featureId"], ["literal", ids]]);
    expect(paints[`${LAYER_IDS.currentService}:line-color`]).toBe("#EE2222");
  });

  it("keeps the compact shipped overview, starts the regional map on the target", async () => {
    expect(initialOverviewServices(services.services, MVP_GAME_CONFIG.targetServiceId).map((s) => s.id)).toEqual([MVP_GAME_CONFIG.targetServiceId]);
    const compact = await loadBundle("real");
    if (!compact.data.services.ok) throw new Error("Missing services");
    expect(initialOverviewServices(compact.data.services.value.services, MVP_GAME_CONFIG.targetServiceId)).toEqual(compact.data.services.value.services);
    expect(stations).toHaveLength(37);
  });

  it("summarizes the hub result and retains every candidate in the landing event", () => {
    const move = lastMoveOf(turns[0]!.state, network)!;
    expect(landingText(move, network)).toBe("品川：7系統から抽選 → 広域直通快速 ／ 乗車方向は南・東方面のみ");
    expect(move.landing?.serviceCandidates).toEqual(["jr-yamanote", "capital-owner-a", "capital-rapid", "capital-branch", "capital-north", "capital-east", "capital-coast"]);
  });

  it("reveals the highlight only on the accepted completion, ignoring stale callbacks", () => {
    const session = startSession(MVP_GAME_CONFIG, CAPITAL_GAME_SEED, network, 1);
    const rolled = reduceGameSession(session, { type: "roll", sessionId: 1, rngSeed: CAPITAL_GAME_SEED, turn: 0 }, MVP_GAME_CONFIG, network);
    expect(displayedRide(rolled).serviceId).toBe("jr-yamanote");
    const stale = reduceGameSession(rolled, { type: "animation-finished", sessionId: 2, turn: 1 }, MVP_GAME_CONFIG, network);
    expect(stale).toBe(rolled);
    const finished = reduceGameSession(rolled, { type: "animation-finished", sessionId: 1, turn: 1 }, MVP_GAME_CONFIG, network);
    expect(displayedRide(finished).serviceId).toBe("capital-rapid");
    expect(finished.game).toBe(rolled.game);
  });
});

describe("composed hop pacing and progress", () => {
  it.each([1, 2])("turn %i is one hop, with no intermediate landing or progress", (index) => {
    const result = turns[index]!;
    const plan = buildMovePlan(result.events, network, geometry);
    expect(plan).toHaveLength(1);
    const path = plan[0]!;
    const duration = hopDurationMs(path, 450);
    expect(path.points).toHaveLength(5);
    expect(path.distanceKm).toBeGreaterThan(50);
    expect(duration).toBe(1200);
    const midway = frameAt(plan, duration / 2, 450);
    expect(midway).toMatchObject({ stepsCompleted: 0, done: false });
    expect(displayedProgress(result.state, network, { fromStationId: path.fromStationId, steps: plan, frame: midway }).stationId).toBe(path.fromStationId);
    expect(frameAt(plan, duration, 450)).toEqual({ stepsCompleted: 1, position: positionAlong(path, 1), done: true });
    expect(frameAt(plan, 0, 0).done).toBe(true);
    expect(result.events.filter((e) => e.type === "landing-resolved")).toHaveLength(1);
  });

  it("paces unequal hop lengths, clamps both bounds and applies the selected speed", () => {
    const path = buildMovePlan(turns[1]!.events, network, geometry)[0]!;
    const steps = [0, 1, 4, 100].map((distanceKm) => ({ ...path, distanceKm }));
    expect(steps.map((step) => hopDurationMs(step, 450))).toEqual([300, 450, 900, 1200]);
    expect(hopDurationMs(path, 300)).toBe(800);
    expect(hopDurationMs(path, 600)).toBe(1600);
    expect(hopDurationMs(path, 0)).toBe(0);
    expect(frameAt(steps, 750, 450).stepsCompleted).toBe(2);
    expect(frameAt(steps, 2850, 450).done).toBe(true);
    expect(hopDurationMs(path, 450, { ...HOP_TIMING, maxScale: 2 })).toBe(900);
  });
});
