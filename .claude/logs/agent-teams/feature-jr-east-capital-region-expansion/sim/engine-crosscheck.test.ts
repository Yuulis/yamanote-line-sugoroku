// Cross-check: play the draft catalog network with the REAL engine (uniform lottery, R1-a,
// truncate-on-target-service) and compare the turn distribution with montecarlo.mjs.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildRailwayNetwork, createGame, playTurn } from "../../../../../src/features/game/engine";
import type { GameConfig, Segment, ServicePattern, Station } from "../../../../../src/types/network";

const NET = process.env.SIM_NET ?? "net-draft1-core.json";
const GAMES = Number(process.env.SIM_GAMES ?? 1000);
const CAP = 20_000;

it("real engine turn distribution", () => {
  const raw = JSON.parse(readFileSync(new URL(NET, import.meta.url), "utf8")) as {
    target: string;
    services: { id: string; circular: boolean; stops: string[] }[];
  };
  const ids = [...new Set(raw.services.flatMap((s) => s.stops))];
  const stations: Station[] = ids.map((id, i) => ({ id, name: id, coordinates: [139 + i * 1e-4, 35] }));
  const point = (id: string): [number, number] => [139 + ids.indexOf(id) * 1e-4, 35];
  const services: ServicePattern[] = raw.services.map((s) => {
    const base = {
      id: s.id, name: s.id, operator: "JR", color: "#000000", stationIds: s.stops,
      directionLabels: { forward: "f", backward: "b" },
      platformCoordinates: Object.fromEntries(s.stops.map((st) => [st, point(st)])),
    };
    return s.circular
      ? { ...base, circular: true as const }
      : { ...base, circular: false as const, endpoints: { first: "terminus" as const, last: "terminus" as const } };
  });
  const segments: Segment[] = [];
  for (const s of raw.services) {
    const n = s.stops.length;
    for (let i = 0; i < (s.circular ? n : n - 1); i += 1) {
      const a = s.stops[i]!, b = s.stops[(i + 1) % n]!;
      const pairs = s.circular ? [[a, b]] : [[a, b], [b, a]];
      for (const [from, to] of pairs) {
        segments.push({ id: `${s.id}:${from}:${to}`, serviceId: s.id, from: from!, to: to!, geometryFeatureId: `${s.id}:${a}~${b}` });
      }
    }
  }
  const network = buildRailwayNetwork({ dataVersion: "sim", stations, services, segments });
  const config: GameConfig = {
    rulesetVersion: "sim", targetServiceId: raw.target, startStationId: "shimbashi",
    targetDirection: 1, goalArrivalPolicy: "truncate-on-target-service",
  };
  const turns: number[] = [];
  for (let g = 0; g < GAMES; g += 1) {
    let game = createGame(config, `mc-${g}`, network);
    while (game.status === "playing" && game.turn < CAP) {
      game = { ...playTurn(game, network).state, movementHistory: [] };
    }
    turns.push(game.status === "completed" ? game.turn : CAP + 1);
  }
  turns.sort((x, y) => x - y);
  const q = (p: number) => turns[Math.min(turns.length - 1, Math.ceil(p * turns.length) - 1)];
  console.log(JSON.stringify({ engine: true, net: NET, games: GAMES, median: q(0.5), p90: q(0.9), p99: q(0.99) }));
  expect(turns.length).toBe(GAMES);
}, 3_600_000);
