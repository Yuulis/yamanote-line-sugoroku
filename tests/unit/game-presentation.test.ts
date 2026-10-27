import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame, moveByRoll, playTurn } from "../../src/features/game/engine";
import { lastMoveOf, reduceGameSession, resumeSession, startSession } from "../../src/features/game/gameSession";
import type { LastMove } from "../../src/features/game/gameSession";
import { displayedRide, landingText, landingTransitionText, lastRollText } from "../../src/features/game/presentation";
import { earlyStopNote, summarizeGame } from "../../src/features/game/gameSummary";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import type { UiPresentation } from "../../src/types/data";
import { loadBundle } from "../e2e/fixtures/bundle";
import { LEGACY_FIXTURE_GAME_SEED, LEGACY_FIXTURE_SCENARIO_TURNS } from "../e2e/fixtures/seeds";
import { M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
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

describe("S6 presentation metadata", () => {
  function suburbanFixture() {
    const input = multiServiceInput();
    const stations = input.stations.map((station) => station.id === "b"
      ? { ...station, name: "浜松町" }
      : station);
    const services = input.services.map((service) => ({
      ...service,
      name: service.id === M_LOOP ? "大江戸線（環状部）" : service.id === M_LINE ? "大江戸線（放射部）" : "支線各停",
      operator: "東京都交通局",
    }));
    const network = buildRailwayNetwork({ ...input, stations, services });
    const uiPresentation: UiPresentation = {
      version: 1,
      operators: [{ id: "東京都交通局", name: "東京都交通局" }],
      lineGroups: [
        { id: "toei-oedo", name: "大江戸線", operatorId: "東京都交通局", color: "#cc0066", serviceIds: [M_LOOP, M_LINE] },
        { id: "toei-spur", name: "支線", operatorId: "東京都交通局", color: "#123456", serviceIds: [M_SPUR] },
      ],
      stations: [{ id: "b", aliases: ["大門"] }],
      serviceStopNames: [
        { serviceId: M_LOOP, stationId: "b", name: "大門" },
        { serviceId: M_LINE, stationId: "b", name: "浜松町" },
      ],
    };
    return { network, uiPresentation };
  }

  it("falls back to canonical names when metadata is absent and joins reviewed aliases when present", () => {
    const { network, uiPresentation } = suburbanFixture();
    expect(createPresentationResolver(network).stationName("b")).toBe("浜松町");
    expect(createPresentationResolver(network, uiPresentation).stationName("b")).toBe("浜松町・大門");
  });

  it("uses the approved group name and shows two Oedo lottery slots once", () => {
    const { network, uiPresentation } = suburbanFixture();
    const resolver = createPresentationResolver(network, uiPresentation);
    expect(resolver.serviceName(M_LOOP)).toBe("大江戸線");
    expect(resolver.candidateRows([M_LOOP, M_LINE, M_SPUR])).toEqual([
      { groupId: "toei-oedo", name: "大江戸線", label: "大江戸線（抽選枠2）", serviceIds: [M_LOOP, M_LINE] },
      { groupId: "toei-spur", name: "支線", label: "支線", serviceIds: [M_SPUR] },
    ]);
    const lastMove: LastMove = {
      roll: 1,
      unusedPips: 0,
      stopReason: "roll",
      stopStationId: "b",
      serviceId: M_LOOP,
      direction: 1,
      endpointKind: null,
      landing: {
        type: "landing-resolved",
        stationId: "b",
        serviceCandidates: [M_LOOP, M_LINE, M_SPUR],
        serviceId: M_LINE,
        serviceDrawRequired: true,
        directionCandidates: [1],
        direction: 1,
        directionDrawRequired: false,
        changedService: true,
      },
    };
    expect(landingText(lastMove, network, resolver)).toBe(
      "浜松町・大門：大江戸線（抽選枠2）・支線から抽選 → 大江戸線 ／ 乗車方向は正方向のみ",
    );
  });

  it("retains per-service stop names while deduplicating aliases already in the joined label", () => {
    const { network, uiPresentation } = suburbanFixture();
    const resolver = createPresentationResolver(network, uiPresentation);
    expect(resolver.serviceStationName(M_LOOP, "b")).toBe("浜松町・大門");
    expect(resolver.serviceStationName(M_LINE, "b")).toBe("浜松町・大門");
  });

  it("uses an audited small-ke stop spelling in a station label only without a JR service", () => {
    const input = multiServiceInput();
    const network = buildRailwayNetwork({
      ...input,
      stations: input.stations.map((station) => station.id === "b"
        ? { ...station, name: "つつじケ丘" }
        : station),
      services: input.services.map((service) => ({ ...service, operator: "京王電鉄" })),
    });
    const uiPresentation: UiPresentation = {
      version: 1,
      operators: [{ id: "京王電鉄", name: "京王電鉄" }],
      lineGroups: [
        { id: "keio-main", name: "京王線", operatorId: "京王電鉄", color: "#123456", serviceIds: [M_LOOP] },
        { id: "keio-sub", name: "京王支線", operatorId: "京王電鉄", color: "#234567", serviceIds: [M_LINE, M_SPUR] },
      ],
      stations: [],
      serviceStopNames: [{ serviceId: M_LOOP, stationId: "b", name: "つつじヶ丘" }],
    };
    const resolver = createPresentationResolver(network, uiPresentation);
    expect(resolver.stationName("b")).toBe("つつじヶ丘・つつじケ丘");
    expect(resolver.serviceStationName(M_LOOP, "b")).toBe("つつじヶ丘・つつじケ丘");
  });

  it("keeps the JR spelling in the station label while retaining a private-line stop spelling", () => {
    const input = multiServiceInput();
    const network = buildRailwayNetwork({
      ...input,
      stations: input.stations.map((station) => station.id === "b"
        ? { ...station, name: "市ケ谷" }
        : station),
      services: input.services.map((service) => ({
        ...service,
        operator: service.id === M_LOOP ? "東日本旅客鉄道" : "東京都交通局",
      })),
    });
    const uiPresentation: UiPresentation = {
      version: 1,
      operators: [
        { id: "東日本旅客鉄道", name: "東日本旅客鉄道" },
        { id: "東京都交通局", name: "東京都交通局" },
      ],
      lineGroups: [
        { id: "jr-loop", name: "JR線", operatorId: "東日本旅客鉄道", color: "#123456", serviceIds: [M_LOOP] },
        { id: "toei", name: "都営線", operatorId: "東京都交通局", color: "#234567", serviceIds: [M_LINE, M_SPUR] },
      ],
      stations: [],
      serviceStopNames: [{ serviceId: M_LINE, stationId: "b", name: "市ヶ谷" }],
    };
    const resolver = createPresentationResolver(network, uiPresentation);
    expect(resolver.stationName("b")).toBe("市ケ谷");
    expect(resolver.serviceStationName(M_LINE, "b")).toBe("市ケ谷・市ヶ谷");
  });

  it("does not count transfers between services in the same presentation group", () => {
    const { network, uiPresentation } = suburbanFixture();
    const resolver = createPresentationResolver(network, uiPresentation);
    const game = createGame(multiConfig(), "same-group-transfer", network);
    const record = {
      turn: 1,
      roll: 1,
      serviceId: M_LOOP,
      direction: 1 as const,
      fromStationId: "start",
      toStationId: "b",
      traversedSegmentIds: ["hop"],
      stopReason: "roll" as const,
      landing: { serviceId: M_LINE, direction: 1 as const },
    };
    expect(summarizeGame({ ...game, turn: 1, movementHistory: [record] }, resolver).transfers).toBe(0);
    expect(summarizeGame({ ...game, turn: 1, movementHistory: [record] }).transfers).toBe(1);
  });

  it("shows an Oedo direction change without calling it a transfer", () => {
    const { network, uiPresentation } = suburbanFixture();
    const resolver = createPresentationResolver(network, uiPresentation);
    const record = {
      serviceId: M_LOOP,
      direction: 1 as const,
      landing: { serviceId: M_LINE, direction: -1 as const },
    };
    expect(landingTransitionText(record, network, resolver)).toBe("大江戸線（方向変更: 逆方向）");
    expect(landingTransitionText({ ...record, landing: { ...record.landing, direction: 1 } }, network, resolver)).toBeNull();
  });
});

describe("verified item notices", () => {
  it("keeps pickup, cancellation, chosen discard, countdown and activation copy precise", async () => {
    const { itemEventTexts, activeItemEffectTexts } = await import("../../src/features/game/presentation");
    expect(itemEventTexts([
      { type: "pickup-pending-discard", item: { id: "new", kind: "double" }, candidates: [] },
      { type: "discarded", item: { id: "held", kind: "rapid" } },
      { type: "pickup-retained", item: { id: "new", kind: "double" } },
      { type: "cancelled-by-certificate", item: "oversleep", certificate: { id: "cert", kind: "delay-certificate" } },
      { type: "effect-activated", effect: "delay" },
    ], 8, network)).toEqual([
      "倍速券を拾いました。この回の出目が2倍になる", "快速券を選んで捨てました",
      "拾った寝過ごしを遅延証明書で打ち消しました", "遅延が発動しました",
    ]);
    const effects = { delayDueTurns: [10], suspensions: [{ serviceId: "jr-yamanote", expiresTurn: 12 }], detourPending: true, oversleepPending: true };
    expect(activeItemEffectTexts(effects, 7, network)).toEqual([
      "遅延：10ターン目に発動（あと3ターン）", "運休：山手線、あと5ターン",
      "寄り道：次に別の路線へ乗り換えられる駅で発動します", "寝過ごし：次のターンは終点まで（環状線は6駅）進みます",
    ]);
    expect(activeItemEffectTexts(effects, 8, network)[0]).toContain("あと2ターン");
  });

  it("never calls a null landing a goal unless the recorded stop reason is goal", async () => {
    const { arrivalSummary } = await import("../../src/features/game/presentation");
    const last = { roll: 3, unusedPips: 0, stopReason: "roll" as const, stopStationId: "shimbashi",
      serviceId: "jr-yamanote", direction: 1 as const, endpointKind: null, landing: null };
    expect(arrivalSummary(1, last, 0, 30, network)).not.toContain("ゴール");
    expect(arrivalSummary(1, { ...last, stopReason: "goal" }, 30, 30, network)).toContain("ゴール");
    expect(arrivalSummary(1, { ...last, roll: null, stopReason: "relocation" }, 0, 30, network)).toContain("回送列車で新橋へ移りました（走行区間なし）");
  });
});

it("pins replay-valid item E2E scenarios using the production item policy", async () => {
  const { ITEM_SCENARIOS, itemScenario } = await import("../e2e/fixtures/itemScenarios");
  const { beginItemTurn, playItemTurn, restoreGame, serializeGame } = await import("../../src/features/game/engine");
  for (const name of Object.keys(ITEM_SCENARIOS) as (keyof typeof ITEM_SCENARIOS)[]) {
    const base = itemScenario(name, network);
    expect(restoreGame(serializeGame(base), network, { expectedConfig: base.config })).toEqual(base);
    if (name === "adjust") {
      const pending = beginItemTurn(base, { items: [] }, network).state;
      expect(pending.pending).toMatchObject({ kind: "roll" });
      if (pending.pending?.kind !== "roll") throw new Error("Expected die");
      expect(pending.pending.rawRoll).toBeGreaterThan(1);
      expect(pending.pending.rawRoll).toBeLessThan(6);
      expect(base.inventory.some((item) => item.kind === "roll-adjust")).toBe(true);
    } else if (name === "discard") {
      expect(playItemTurn(base, {}, network).state.pending?.kind).toBe("discard");
    } else if (name === "certificate" || name === "delay") {
      expect(playItemTurn(base, {}, network).events.some((event) => name === "certificate"
        ? event.type === "cancelled-by-certificate" : event.type === "harmful-scheduled" && event.effect === "delay")).toBe(true);
    } else if (name === "oversleep") {
      const result = playItemTurn(base, {}, network);
      expect(result.record).toMatchObject({ movementMode: "oversleep", physicalHops: 6 });
      expect(result.state.status).toBe("playing");
    } else {
      const kind = name === "rapid-long" ? "rapid" : name === "route" ? "route-ticket" : name === "direction" ? "direction-ticket" : name;
      expect(base.inventory.some((item) => item.kind === kind)).toBe(true);
    }
  }
});

it("announces the revealed die and selected adjustment during animation without early pickup notices", async () => {
  const { itemTurnAnnouncement, itemEventTexts } = await import("../../src/features/game/presentation");
  const { itemScenario } = await import("../e2e/fixtures/itemScenarios");
  const { beginItemTurn, finishItemTurn } = await import("../../src/features/game/engine");
  const { itemSessionView } = await import("../../src/features/game/itemSession");
  const base = itemScenario("adjust", network);
  const pending = beginItemTurn(base, { items: [] }, network).state;
  const ticket = base.inventory.find((item) => item.kind === "roll-adjust")!;
  const arrived = finishItemTurn(pending, { instanceId: ticket.id, delta: 1 }, network).state;
  const session = { ...resumeSession(arrived, network), phase: "animating" as const };
  const message = itemTurnAnnouncement(session, itemSessionView(session, network)!, 0, 30, network);
  expect(message).toContain("調整後");
  expect(message).toContain("出目調整券を使いました");
  expect(message).toContain("スキップできます");
  expect(message).not.toContain("拾いました");
  expect(itemEventTexts([
    { type: "harmful-scheduled", item: "suspension", effect: "suspension", serviceId: "jr-yamanote", expiresTurn: 9 },
    { type: "harmful-scheduled", item: "detour", effect: "detour" },
    { type: "harmful-scheduled", item: "oversleep", effect: "oversleep" },
  ], 4, network)).toEqual([
    "運休：山手線、あと5ターン", "寄り道：次に別の路線へ乗り換えられる駅で発動します",
    "寝過ごし：次のターンは終点まで（環状線は6駅）進みます",
  ]);
});

it("shows the recorded arrival ride while a full-inventory choice is pending after resume", async () => {
  const { itemScenario } = await import("../e2e/fixtures/itemScenarios");
  const { playItemTurn } = await import("../../src/features/game/engine");
  const pending = playItemTurn(itemScenario("discard", network), {}, network).state;
  if (pending.pending?.kind !== "discard") throw new Error("Expected pending discard");
  const session = resumeSession(pending, network);
  expect(displayedRide(session)).toEqual({ serviceId: pending.pending.position.currentServiceId,
    direction: pending.pending.position.direction });
  expect(session.lastMove?.itemRecord).toEqual(pending.pending.record);
});

it("restores result history with item pips, physical hops, and relocation instead of classic arithmetic", async () => {
  const { itemScenario } = await import("../e2e/fixtures/itemScenarios");
  const { playItemTurn } = await import("../../src/features/game/engine");
  const { itemHistoryText } = await import("../../src/features/game/presentation");
  for (const name of ["rapid-long", "deadhead"] as const) {
    const base = itemScenario(name, network);
    const kind = name === "rapid-long" ? "rapid" : "deadhead";
    const item = base.inventory.find((entry) => entry.kind === kind)!;
    const arrived = playItemTurn(base, { command: { items: [{ kind, instanceId: item.id }] } }, network).state;
    const record = arrived.movementHistory.at(-1)!;
    const text = itemHistoryText(record, network);
    const restored = resumeSession(arrived, network);
    expect(itemHistoryText(restored.lastMove!.itemRecord!, network)).toBe(text);
    expect(text).not.toContain("残り-");
    if (record.kind === "item-ride") {
      expect(text).toContain(`${record.physicalHops}駅移動`);
      expect(text).toContain(`残り${record.unusedPips}は使わず`);
    } else {
      expect(text).toContain("走行区間なし");
      expect(text).not.toContain("出目");
      expect(text).not.toContain("ゴール");
    }
  }
});
