import { describe, expect, it } from "vitest";
import { playItemTurn, targetSegmentIds } from "../../src/features/game/engine";
import { summarizeGame } from "../../src/features/game/gameSummary";
import { itemLastMove } from "../../src/features/game/itemSession";
import type { LastMove } from "../../src/features/game/gameSession";
import { itemEventTexts } from "../../src/features/game/presentation";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import {
  deriveTurnResult, normalizeTurnResultRecords, replayTurnResultHistory, shortTurnResultRide, turnResultCompact, type TurnResultInput,
  turnResultFaceText, turnResultHistoryChips, turnResultItemChips, turnResultRollText,
} from "../../src/features/game/turnResultCard";
import type { ItemDeadheadRecord, ItemEvent, ItemRideRecord, MoveRecord, PendingItemRoll } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";

const { network } = await loadBundle("fixture");
const presentation = createPresentationResolver(network);
function move(overrides: Partial<LastMove> = {}): LastMove {
  return { roll: 3, unusedPips: 0, stopReason: "roll", stopStationId: "shimbashi", serviceId: "jr-yamanote",
    direction: 1, endpointKind: null, landing: null, ...overrides };
}
function rideRecord(overrides: Partial<ItemRideRecord> = {}): ItemRideRecord {
  return { kind: "item-ride", turn: 1, fromStationId: "shimbashi", toStationId: "shimbashi", command: { items: [] },
    traversedSegmentIds: [], landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: { serviceId: "jr-yamanote", direction: 1 }, rawRoll: 3, effectiveFace: 3, adjustment: null,
    movementMode: "normal", pips: 3, hopBudget: 3, physicalHops: 3, unusedPips: 0, stopReason: "roll", ...overrides };
}
function historyMove(turn: number, serviceId: string, landingServiceId: string | null, segments: string[] = []): MoveRecord {
  return { turn, roll: segments.length, serviceId, direction: 1, fromStationId: "a", toStationId: "b",
    traversedSegmentIds: segments, stopReason: "roll", landing: landingServiceId ? { serviceId: landingServiceId, direction: 1 } : null };
}
function deadheadRecord(turn: number, serviceId: string): ItemDeadheadRecord {
  return { kind: "deadhead", turn, fromStationId: "a", toStationId: "b", command: { items: [] }, traversedSegmentIds: [],
    landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null, resolvedRide: null, rawRoll: null,
    effectiveFace: null, adjustment: null, movementMode: "deadhead", pips: null, hopBudget: null, physicalHops: 0,
    unusedPips: null, stopReason: "relocation", relocation: { fromStationId: "a", toStationId: "b", serviceId, direction: 1, distance: 1 } };
}
function lineGroups(groups: Readonly<Record<string, string>> = {}) {
  return { ...presentation, sameLineGroup: (first: string, second: string) => (groups[first] ?? first) === (groups[second] ?? second) };
}
describe("turn result roll wording", () => {
  it.each([
    ["classic", move(), "出目3", "3"],
    ["item normal", itemLastMove(rideRecord(), network)!, "出目3", "3"],
    ["rapid", itemLastMove(rideRecord({ movementMode: "rapid", effectiveFace: 3, rawRoll: 2, hopBudget: 5, pips: 8, physicalHops: 2 }), network)!, "出目3", "3"],
    ["double", itemLastMove(rideRecord({ effectiveFace: 3, rawRoll: 2, pips: 6, hopBudget: 3, physicalHops: 3 }), network)!, "出目3", "3"],
    ["adjustment +1", itemLastMove(rideRecord({ effectiveFace: 4, rawRoll: 3, adjustment: { instanceId: "adjust", delta: 1 }, pips: 7, hopBudget: 6, physicalHops: 2 }), network)!, "出目4", "4"],
    ["adjustment -1", itemLastMove(rideRecord({ effectiveFace: 2, rawRoll: 3, adjustment: { instanceId: "adjust", delta: -1 } }), network)!, "出目2", "2"],
    ["delay", itemLastMove(rideRecord({ effectiveFace: 1, rawRoll: 4, pips: 5 }), network)!, "出目1", "1"],
    ["oversleep", itemLastMove(rideRecord({ movementMode: "oversleep", effectiveFace: 3, rawRoll: 2, pips: 9 }), network)!, "出目3", "3"],
    ["deadhead", move({ roll: null, stopReason: "relocation" }), "回送", "回送"],
    ["endpoint truncation", move({ unusedPips: 4, stopReason: "endpoint" }), "出目3", "3"],
  ] as const)("uses the effective face for %s without modifier wording", (_mode, lastMove, rollText, faceText) => {
    expect(turnResultRollText(lastMove)).toBe(rollText);
    expect(turnResultFaceText(lastMove)).toBe(faceText);
    expect(`${turnResultRollText(lastMove)} ${turnResultFaceText(lastMove)}`).not.toMatch(/（|快速|×2|調整|遅延|寝過ごし/);
  });
});
describe("short turn result ride", () => {
  it.each([[false, false, "乗車"], [true, false, "抽選"], [false, true, "抽選"], [true, true, "抽選"]] as const)(
    "formats draw flags %s/%s", (serviceDrawRequired, directionDrawRequired, prefix) => {
      const lastMove = move({ landing: { type: "landing-resolved", stationId: "shimbashi", serviceCandidates: ["fixture-south"],
        serviceId: "jr-yamanote", serviceDrawRequired, directionCandidates: [1], direction: -1, directionDrawRequired, changedService: true } });
      const ride = shortTurnResultRide(lastMove, network, presentation);
      expect(ride.prefix).toBe(prefix);
      expect(ride.text).toBe(`${prefix}: 山手線・内回り`);
      expect(ride.lineBadge.name).toBe("山手線");
      expect(ride.lineBadge.code).toBe("JY");
    },
  );

  it("uses the ridden service without a landing and resolves circular directions", () => {
    expect(shortTurnResultRide(move(), network, presentation).text).toBe("乗車: 山手線・外回り");
    expect(shortTurnResultRide(move({ direction: -1 }), network, presentation).text).toBe("乗車: 山手線・内回り");
  });

  it("prefers landing service and direction", () => {
    const result = shortTurnResultRide(move({ landing: { type: "landing-resolved", stationId: "shimbashi", serviceCandidates: ["fixture-south"],
      serviceId: "fixture-south", serviceDrawRequired: false, directionCandidates: [-1], direction: -1, directionDrawRequired: false, changedService: true } }), network, presentation);
    expect(result.text).toBe("乗車: テスト南線・品川方面");
    expect(result.lineBadge.name).toBe("テスト南線");
  });

  it("uses neutral labels for unknown services and numeric direction labels", () => {
    const unknown = shortTurnResultRide(move({ serviceId: "missing-service", direction: -1 }), network, presentation);
    expect(unknown.text).toBe("乗車: 路線不明・方向不明");
    expect(unknown.lineBadge.name).toBe("路線不明");
    const service = network.servicesById.get("jr-yamanote");
    if (!service) throw new Error("Missing fixture service");
    const incompleteNetwork = { ...network, servicesById: new Map([...network.servicesById].map(([id, value]) =>
      [id, id === service.id ? { ...value, directionLabels: { forward: "1", backward: "-1" } } : value] as const)) };
    expect(shortTurnResultRide(move({ direction: -1 }), incompleteNetwork, presentation).directionText).toBe("方向不明");
  });
});

describe("turn result history replay", () => {
  it("counts only first target traversals through the selected turn", () => {
    const records = [historyMove(1, "a", null, ["target-a", "off-target"]),
      historyMove(2, "a", null, ["target-a", "off-target-2", "target-b", "target-b"]), historyMove(3, "b", null, ["target-c"])];
    const targets = ["target-a", "target-b", "target-c"];
    expect(replayTurnResultHistory(records, 2, targets, "a", presentation))
      .toEqual({ newTargetSegmentCount: 1, transferCount: 0 });
    expect(replayTurnResultHistory([...records].reverse(), 2, targets, "a", presentation))
      .toEqual({ newTargetSegmentCount: 1, transferCount: 0 });
  });

  it("returns no progress for missing history or deadhead", () => {
    expect(replayTurnResultHistory([], 1, ["target-a"], "a", presentation))
      .toEqual({ newTargetSegmentCount: 0, transferCount: 0 });
    expect(replayTurnResultHistory([deadheadRecord(1, "b")], 1, ["target-a"], "a", presentation))
      .toEqual({ newTargetSegmentCount: 0, transferCount: 1 });
  });

  it("replays an engine pending discard as the selected turn, appended once, and ignores pending rolls", () => {
    const base = itemScenario("discard", network);
    const next = playItemTurn(base, {}, network).state;
    const pending = next.pending;
    if (pending?.kind !== "discard") throw new Error(`Expected pending discard, got ${pending?.kind ?? "none"}`);
    const targets = targetSegmentIds(base.config, network);
    const before = new Set(base.completedSegmentIds);
    const expected = pending.position.completedSegmentIds.filter((id) => !before.has(id) && targets.includes(id)).length;
    expect(expected, "fixture pending turn must complete a target segment").toBeGreaterThan(0);
    const appended = normalizeTurnResultRecords(next.movementHistory, pending);
    expect(appended.at(-1)).toBe(pending.record);
    expect(normalizeTurnResultRecords(appended, pending)).toEqual(appended);
    const facts = (records: typeof appended) => replayTurnResultHistory(records, pending.turn, targets,
      base.config.targetServiceId, presentation).newTargetSegmentCount;
    expect([facts(appended), facts(normalizeTurnResultRecords(appended, pending))]).toEqual([expected, expected]);
    const roll: PendingItemRoll = { kind: "roll", turn: 2, command: { items: [] },
      resolvedRide: { serviceId: "a", direction: 1 }, rawRoll: 3, rngStateAfterRoll: "0" };
    expect(normalizeTurnResultRecords([historyMove(1, "a", null)], roll)).toEqual([historyMove(1, "a", null)]);
  });

  it("recomputes same-length histories instead of reusing old facts", () => {
    const first = [historyMove(1, "a", null, ["target-a"]), historyMove(2, "a", null)];
    const replacement = [historyMove(1, "a", null, ["off-target"]), historyMove(2, "a", null)];
    const facts = (records: readonly MoveRecord[]) => replayTurnResultHistory(records, 1, ["target-a"], "a", presentation);
    expect(facts(first).newTargetSegmentCount).toBe(1);
    expect(facts(replacement).newTargetSegmentCount).toBe(0);
  });

  it("counts route-ticket and landing group changes on the selected turn", () => {
    const ticketRide = rideRecord({ turn: 2, resolvedRide: { serviceId: "c", direction: 1 }, landing: { serviceId: "d", direction: 1 } });
    const records = [historyMove(1, "a", "b"), ticketRide, historyMove(3, "d", "e")];
    expect(replayTurnResultHistory(records, 2, [], "a", lineGroups()))
      .toEqual({ newTargetSegmentCount: 0, transferCount: 2 });
  });

  it("sums per-turn transfers to the game summary total", () => {
    const game = itemScenario("route", network);
    const perTurn = game.movementHistory.map(({ turn }) => replayTurnResultHistory(game.movementHistory, turn, [],
      game.config.targetServiceId, presentation).transferCount);
    expect(summarizeGame(game, presentation).transfers, "route fixture must transfer").toBeGreaterThan(0);
    expect(perTurn.reduce((sum, count) => sum + count, 0)).toBe(summarizeGame(game, presentation).transfers);
  });

  it("builds +N区間 and one 乗換 chip with stable keys, omitting zero counts", () => {
    expect(turnResultHistoryChips(4, { newTargetSegmentCount: 0, transferCount: 0 })).toEqual([]);
    expect(turnResultHistoryChips(4, { newTargetSegmentCount: 2, transferCount: 3 })).toEqual([
      { kind: "segments", count: 2, key: "4:segments", label: "+2区間", text: "このターンで目標区間を2区間はじめて通過" },
      { kind: "transfer", count: 3, key: "4:transfer", label: "乗換", text: "このターンで3回乗り換え" },
    ]);
    expect(turnResultHistoryChips(4, { newTargetSegmentCount: 0, transferCount: 1 }).map((chip) => chip.label)).toEqual(["乗換"]);
  });

  it("does not count same-group service changes or direction reversals", () => {
    const reversed = { ...historyMove(1, "b", "c"), direction: -1 as const,
      landing: { serviceId: "a", direction: -1 as const } };
    expect(replayTurnResultHistory([reversed], 1, [], "a", lineGroups({ a: "group", b: "group", c: "group" })).transferCount).toBe(0);
  });
});

const RESULT_TURN = 5;
function resultInput(lastMove: LastMove | null, overrides: Partial<TurnResultInput> = {}): TurnResultInput {
  return { sessionId: 9, turn: RESULT_TURN, move: lastMove, records: lastMove?.itemRecord ? [lastMove.itemRecord] : [], targetSegmentIds: [], initialServiceId: lastMove?.serviceId ?? "jr-yamanote", itemsPublished: true, network, presentation, ...overrides };
}
const eventMove = (event: ItemEvent, overrides: Partial<ItemRideRecord> = {}): LastMove => itemLastMove(rideRecord({ turn: RESULT_TURN, itemEvents: [event], ...overrides }), network)!;
function deadheadTo(stationId: string, itemEvents: ItemEvent[]): ItemDeadheadRecord {
  const record = deadheadRecord(RESULT_TURN, "jr-yamanote");
  return { ...record, toStationId: stationId, itemEvents, relocation: { ...record.relocation, toStationId: stationId } };
}
describe("turn result item chips", () => {
  const cases = [
    { event: { type: "pickup-retained", item: { id: "p1", kind: "rapid" } }, kind: "pickup", outcome: "retained", itemKind: "rapid", label: ITEM_DESCRIPTIONS.rapid.name },
    { event: { type: "pickup-pending-discard", item: { id: "p2", kind: "double" }, candidates: [] }, kind: "pickup", outcome: "pending-discard", itemKind: "double", label: `${ITEM_DESCRIPTIONS.double.name}（選択待ち）` },
    { event: { type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 6 }, kind: "pickup", outcome: "harmful", itemKind: "delay", label: ITEM_DESCRIPTIONS.delay.name },
    { event: { type: "cancelled-by-certificate", item: "suspension", certificate: { id: "c1", kind: "delay-certificate" } }, kind: "pickup", outcome: "cancelled", itemKind: "suspension", label: `${ITEM_DESCRIPTIONS.suspension.name}（打ち消し）` },
    { event: { type: "consumed", item: { id: "i1", kind: "rapid" } }, kind: "effect", outcome: "consumed", itemKind: "rapid", label: ITEM_DESCRIPTIONS.rapid.name },
    { event: { type: "consumed", item: { id: "a1", kind: "roll-adjust" } }, kind: "effect", outcome: "consumed", itemKind: "roll-adjust", label: ITEM_DESCRIPTIONS["roll-adjust"].name },
    { event: { type: "effect-activated", effect: "oversleep" }, kind: "effect", outcome: "activated", itemKind: "oversleep", label: ITEM_DESCRIPTIONS.oversleep.name },
  ] as const;
  it.each(cases)("builds $event.type chips with verified event wording", ({ event, kind, outcome, itemKind, label }) => {
    const chips = turnResultItemChips(eventMove(event), RESULT_TURN, network, presentation);
    expect(chips).toHaveLength(1); expect(chips[0]).toMatchObject({ kind, outcome, itemKind, label, text: itemEventTexts([event], RESULT_TURN, network, presentation)[0] });
  });
  it("omits discard/expiry, deduplicates pickup IDs, and keeps keys stable and unique", () => {
    const same = { id: "same", kind: "rapid" } as const;
    const events: ItemEvent[] = [{ type: "pickup-retained", item: same }, { type: "pickup-retained", item: same }, { type: "consumed", item: same },
      { type: "discarded", item: { id: "d1", kind: "double" } }, { type: "effect-expired", effect: "suspension", serviceId: "jr-yamanote" }, { type: "effect-activated", effect: "delay" }, { type: "effect-activated", effect: "delay" }];
    const lastMove = itemLastMove(rideRecord({ turn: RESULT_TURN, itemEvents: events }), network)!, chips = turnResultItemChips(lastMove, RESULT_TURN, network, presentation);
    expect(chips.map(({ kind }) => kind)).toEqual(["pickup", "effect", "effect", "effect"]);
    expect(new Set(chips.map(({ key }) => key)).size).toBe(chips.length); expect(chips[0]?.key).toBe(`${RESULT_TURN}:pickup-retained:same`);
    expect(turnResultItemChips(move(), RESULT_TURN, network, presentation)).toEqual([]);
  });
});

describe("complete turn result model and compact summary", () => {
  it.each([[null, 5], [move(), 0]] as const)("returns null for absent move or invalid turn", (lastMove, turn) => expect(deriveTurnResult(resultInput(lastMove, { turn }))).toBeNull());
  it.each([
    ["normal", move(), ["target-a"], "3", 1],
    ["rapid", eventMove({ type: "consumed", item: { id: "r1", kind: "rapid" } }, { traversedSegmentIds: ["a", "b"] }), ["a", "b"], "3", 2],
    ["double", eventMove({ type: "consumed", item: { id: "d1", kind: "double" } }, { traversedSegmentIds: ["a", "b"] }), ["a", "b"], "3", 2],
    ["adjusted", eventMove({ type: "consumed", item: { id: "a1", kind: "roll-adjust" } }, { rawRoll: 3, effectiveFace: 4, adjustment: { instanceId: "a1", delta: 1 } }), [], "4", 0],
  ] as const)("builds %s compact text", (_name, lastMove, segments, face, count) => {
    const records = lastMove.itemRecord ? [lastMove.itemRecord] : [historyMove(RESULT_TURN, lastMove.serviceId, null, [...segments])];
    const model = deriveTurnResult(resultInput(lastMove, { records, targetSegmentIds: segments }))!;
    const station = presentation.stationName(lastMove.stopStationId), segmentsText = count ? `+${count}区間` : null;
    const text = segmentsText ? `${face} → ${station} ${segmentsText}` : `${face} → ${station}`;
    expect(model.compact).toEqual({ faceText: face, stationText: station, segmentsText, text,
      accessibleName: `前のターン（${RESULT_TURN}ターン目）：${text}` });
    expect([model.ride.text, "乗換", ...model.chips.map((chip) => chip.text)].some((word) => text.includes(word))).toBe(false);
  });
  it.each([
    [eventMove({ type: "consumed", item: { id: "r", kind: "rapid" } }), "快速券"],
    [eventMove({ type: "consumed", item: { id: "d", kind: "double" } }), "倍速券"],
    [eventMove({ type: "consumed", item: { id: "a", kind: "roll-adjust" } }, { rawRoll: 3, effectiveFace: 4, adjustment: { instanceId: "a", delta: 1 } }), "出目調整 +1"],
    [eventMove({ type: "consumed", item: { id: "a", kind: "roll-adjust" } }, { rawRoll: 3, effectiveFace: 2, adjustment: { instanceId: "a", delta: -1 } }), "出目調整 -1"],
    [eventMove({ type: "effect-activated", effect: "delay" }, { effectiveFace: 1 }), "遅延"],
    [eventMove({ type: "effect-activated", effect: "oversleep" }), "寝過ごし"],
    [itemLastMove(deadheadTo("shinagawa", [{ type: "consumed", item: { id: "h", kind: "deadhead" } }]), network)!, "回送列車"],
  ] as const)("shows modifier case %# only in one chip", (lastMove, label) => {
    const model = deriveTurnResult(resultInput(lastMove))!, record = lastMove.itemRecord;
    const face = record?.kind === "item-ride" ? String(record.effectiveFace) : "回送";
    const station = presentation.stationName(lastMove.stopStationId);
    const effectChips = model.chips.filter((item) => item.kind === "effect");
    expect(effectChips).toHaveLength(1); expect(effectChips[0]?.label).toBe(label);
    expect(model.moveText).toBe(record?.kind === "item-ride" ? `出目${face} → ${station}` : `回送 → ${station}`);
    expect(model.compact.text).toBe(`${face} → ${station}`);
    expect(`${model.moveText} ${model.compact.text}`).not.toMatch(/（|快速|×2|倍|調整|遅延|寝過ごし|回送列車/);
    if (record?.kind === "item-ride" && record.adjustment) {
      expect(effectChips[0]?.text).toBe(`${ITEM_DESCRIPTIONS["roll-adjust"].name}を使いました（出目${record.rawRoll} → ${record.effectiveFace}）`);
    }
  });
  it("preserves long names, accessible wording, and neutral missing-station fallback", () => {
    const name = "羽田空港第1・第2ターミナル";
    const input = resultInput(move(), { presentation: { ...presentation, stationName: () => name }, targetSegmentIds: ["s"],
      records: [historyMove(RESULT_TURN, "jr-yamanote", null, ["s"])] });
    expect(deriveTurnResult(input)?.compact.text).toBe(`3 → ${name} +1区間`);
    expect(turnResultCompact("前のターン（5ターン目）", "3", name, 0).accessibleName).toBe(`前のターン（5ターン目）：3 → ${name}`);
    expect(deriveTurnResult(resultInput(move({ stopStationId: "missing" })))?.arrivalStation).toBe("駅不明");
  });
  it("retains history while item publication is off and counts a pending discard once", () => {
    const lastMove = eventMove({ type: "consumed", item: { id: "r", kind: "rapid" } }, { traversedSegmentIds: ["s"] });
    expect(deriveTurnResult(resultInput(lastMove, { itemsPublished: false, targetSegmentIds: ["s"] }))?.chips.map(({ kind }) => kind)).toEqual(["segments"]);
    const base = itemScenario("discard", network), next = playItemTurn(base, {}, network).state;
    const pending = next.pending;
    if (pending?.kind !== "discard") throw new Error("Expected pending discard");
    const targets = targetSegmentIds(base.config, network), before = new Set(base.completedSegmentIds);
    const count = pending.position.completedSegmentIds.filter((id) => !before.has(id) && targets.includes(id)).length;
    const model = deriveTurnResult(resultInput(itemLastMove(pending.record, network), { turn: pending.turn, records: next.movementHistory, pending, targetSegmentIds: targets }));
    expect(model?.chips.find((chip) => chip.kind === "segments")?.count).toBe(count); expect(model?.compact.segmentsText).toBe(`+${count}区間`);
  });
  it("keeps ride, transfer, and published item wording out of compact text", () => {
    const model = deriveTurnResult(resultInput(eventMove({ type: "consumed", item: { id: "r", kind: "rapid" } }), { initialServiceId: "fixture-south" }))!, chips = model.chips;
    expect(chips.some((chip) => chip.kind === "transfer")).toBe(true);
    expect([model.compact.text, model.compact.accessibleName].some((summary) => [model.ride.text, "乗換", ...chips.map((chip) => chip.text)].some((word) => summary.includes(word)))).toBe(false);
  });
});
