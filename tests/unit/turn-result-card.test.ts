import { describe, expect, it } from "vitest";
import { itemLastMove } from "../../src/features/game/itemSession";
import type { LastMove } from "../../src/features/game/gameSession";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { shortTurnResultRide, turnResultFaceText, turnResultRollText } from "../../src/features/game/turnResultCard";
import type { ItemRideRecord } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";

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
