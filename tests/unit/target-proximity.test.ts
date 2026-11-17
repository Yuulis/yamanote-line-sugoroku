import { describe, expect, it } from "vitest";
import { deriveTargetProximity } from "../../src/features/game/targetProximity";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import type { Direction } from "../../src/types/network";
import { M_LINE, M_LOOP, M_SPUR, multiServiceInput } from "./fixtures/multiService";
import { proximityInput } from "./fixtures/lottery";

const network = buildRailwayNetwork(multiServiceInput());
const targetServiceId = M_LOOP;
const input = (stationId: string, serviceId = M_LINE, direction: Direction = 1, targetComplete = false) => ({
  stationId, ride: { serviceId, direction }, targetServiceId, targetComplete,
});

function equalDistanceNetwork() {
  const source = proximityInput();
  const branch = source.services.find((service) => service.id === "branch");
  if (!branch) throw new Error("proximity fixture has no branch");
  source.services = [...source.services, {
    ...branch, id: "equal-link", lineIds: ["equal-link"], stationIds: ["r", "s2"],
    platformCoordinates: { r: [139, 35], s2: [139, 35] },
  }];
  source.segments = [...source.segments,
    { id: "equal:r:s2", serviceId: "equal-link", from: "r", to: "s2", geometryFeatureIds: ["equal:r:s2"] },
    { id: "equal:s2:r", serviceId: "equal-link", from: "s2", to: "r", geometryFeatureIds: ["equal:s2:r"] },
  ];
  return buildRailwayNetwork(source);
}

describe("deriveTargetProximity", () => {
  it("compares the next stop with the current target distance", () => {
    expect(deriveTargetProximity(input("y", M_LINE, -1), network)).toMatchObject({ hops: 1, trend: "closer" });
    const branch = buildRailwayNetwork(proximityInput());
    expect(deriveTargetProximity(input("q", "branch", -1), branch)).toMatchObject({ hops: 1, trend: "farther" });
    expect(deriveTargetProximity(input("r", "equal-link"), equalDistanceNetwork())).toMatchObject({ hops: 2, trend: null });
    expect(deriveTargetProximity(input("s2", M_SPUR), network)).toMatchObject({ hops: 2, trend: null });
  });

  it("counts a rapid stop-to-stop segment as one hop", () => {
    const result = deriveTargetProximity(input("q", "rapid"), buildRailwayNetwork(proximityInput()));
    expect(result).toMatchObject({ hops: 1, trend: "closer" });
  });

  it("formats the exact Japanese copy", () => {
    expect(deriveTargetProximity(input("y", M_LINE, -1), network)?.text).toBe("山手線まで あと1駅（近づく）");
    const branch = buildRailwayNetwork(proximityInput());
    expect(deriveTargetProximity(input("q", "branch", -1), branch)?.text).toBe("山手線まで あと1駅（遠ざかる）");
    expect(deriveTargetProximity(input("s2", M_SPUR), network)?.text).toBe("山手線まで あと2駅");
  });

  it("hides target-service, zero-distance, complete, and unknown-distance states", () => {
    expect(deriveTargetProximity(input("b", M_LOOP), network)).toBeNull();
    expect(deriveTargetProximity(input("b"), network)).toBeNull();
    expect(deriveTargetProximity(input("x", M_LINE, 1, true), network)).toBeNull();
    const source = multiServiceInput();
    source.segments = source.segments.filter((segment) => !(segment.from === "s2" && segment.to === "s1"));
    const oneWay = buildRailwayNetwork(source);
    expect(deriveTargetProximity(input("s1", M_SPUR), oneWay)).toMatchObject({ hops: 1, trend: null });
    expect(deriveTargetProximity(input("s2", M_SPUR), oneWay)).toBeNull();
  });
});
