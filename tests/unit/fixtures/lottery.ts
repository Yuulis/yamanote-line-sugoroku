import type { RailwayNetworkInput } from "../../../src/features/game/engine";
import type { GameConfig, ServicePattern } from "../../../src/types/network";
import { bothWays, M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./multiService";

export const SPECIAL = "special";

export function kindInput(): RailwayNetworkInput {
  const base = multiServiceInput();
  const line = base.services.find((service) => service.id === M_LINE)!;
  const services: ServicePattern[] = base.services.map((service) => ({
    ...service,
    kind: service.id === M_LOOP ? "medium-distance" : service.id === M_LINE ? "rapid" : "local",
  }));
  services.push({ ...line, id: SPECIAL, kind: "special-rapid" });
  return { ...base, services, segments: [...base.segments, ...bothWays(SPECIAL, line.stationIds)] };
}

export function lotteryConfig(): GameConfig {
  return {
    ...multiConfig(),
    serviceLottery: {
      kindWeights: { local: 2, rapid: 3, "special-rapid": 5, "medium-distance": 7 },
      target: { kind: "share", numerator: 2, denominator: 5 },
    },
    directionLottery: { towardTargetWeight: 2 },
  };
}

/** A long branch reaches b in one rapid hop, independently of its local stops. */
export function proximityInput(): RailwayNetworkInput {
  const base = multiServiceInput();
  const spur = base.services.find((service) => service.id === M_SPUR)!;
  const branchIds = ["s1", "r", "q"];
  const rapidIds = ["q", "b"];
  const make = (id: string, stationIds: string[]): ServicePattern => ({
    ...spur, id, stationIds,
    platformCoordinates: Object.fromEntries(stationIds.map((stationId) => [stationId, [139, 35]])),
  });
  return {
    ...base,
    stations: [...base.stations, ...["r", "q"].map((id) => ({
      id, name: id, coordinates: [139, 35] as [number, number],
    }))],
    services: [...base.services, make("branch", branchIds), { ...make("rapid", rapidIds), kind: "rapid" }],
    segments: [...base.segments, ...bothWays("branch", branchIds), ...bothWays("rapid", rapidIds)],
  };
}
