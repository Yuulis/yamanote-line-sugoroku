import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isManifest, isSegmentList, isServicesData, isStationList } from "../../src/data/guards";
import { buildRailwayNetwork, SERVICE_KINDS, type RailwayNetwork } from "../../src/features/game/engine";
import type { EndpointKind, Segment, ServiceKind, ServicePattern, Station } from "../../src/types/network";
import { parseCsv, required } from "./csv";

export const DEFAULT_CATALOG = ".claude/docs/research/jr-east-capital-region-catalog-v2.csv";
export const DEFAULT_SERVICES = ".claude/docs/research/jr-east-capital-region-services-v2.csv";

export interface SimulationInput {
  network: RailwayNetwork;
  targetServiceId: string;
  startStationId: string;
  provenance: {
    source: "research-csv" | "shipped-bundle";
    sha256: Record<string, string>;
    hashConvention: "LF-normalized UTF-8 bytes";
    catalogRows?: number;
    stations: number;
    services: number;
    directedSegments: number;
    endpointNote?: string;
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readLf(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

function booleanField(row: Record<string, string>, key: string): boolean {
  const value = required(row, key);
  if (value !== "true" && value !== "false") throw new Error(`Invalid boolean ${key}: ${value}`);
  return value === "true";
}

function serviceKind(value: string): ServiceKind {
  const kind = SERVICE_KINDS.find((kind) => kind === value);
  if (!kind) throw new Error(`Unknown research service kind: ${value}`);
  return kind;
}

function endpoint(value: string): EndpointKind {
  // Catalog splits retain their identity; every endpoint stops and discards pips.
  if (value === "through-split") return "service-boundary";
  if (value === "terminus" || value === "area-boundary") return value;
  throw new Error(`Unknown research endpoint: ${value}`);
}

function provenance(
  network: RailwayNetwork,
  source: SimulationInput["provenance"]["source"],
  hashes: Record<string, string>,
): SimulationInput["provenance"] {
  return {
    source, sha256: hashes, hashConvention: "LF-normalized UTF-8 bytes",
    stations: network.stationsById.size, services: network.servicesById.size,
    directedSegments: network.segmentsById.size,
  };
}

/** Build directly from the two approved CSVs; keep catalog service order. */
export function loadResearchCatalog(
  catalogPath: string = DEFAULT_CATALOG,
  servicesPath: string = DEFAULT_SERVICES,
  targetServiceId: string = "yamanote",
  startStationId: string = "shimbashi",
): SimulationInput {
  const catalogText = readLf(catalogPath);
  const servicesText = readLf(servicesPath);
  const rows = parseCsv(catalogText);
  const metadata = new Map<string, Record<string, string>>();
  for (const row of parseCsv(servicesText)) {
    const id = required(row, "service_id");
    if (metadata.has(id)) throw new Error(`Duplicate service metadata: ${id}`);
    metadata.set(id, row);
  }
  const grouped = new Map<string, Record<string, string>[]>();
  const stations = new Map<string, Station>();
  for (const row of rows) {
    const id = required(row, "service_id");
    const group = grouped.get(id) ?? [];
    group.push(row);
    grouped.set(id, group);
    const stationId = required(row, "station_id_proposed");
    const name = required(row, "station_name_ja");
    const prior = stations.get(stationId);
    if (prior && prior.name !== name) throw new Error(`Conflicting station identity: ${stationId}`);
    if (!prior) stations.set(stationId, { id: stationId, name, coordinates: [0, 0] });
  }
  if (metadata.size !== grouped.size || [...metadata.keys()].some((id) => !grouped.has(id))) {
    throw new Error("Catalog and services CSV service sets differ");
  }
  const services: ServicePattern[] = [];
  const segments: Segment[] = [];
  for (const [id, stops] of grouped) {
    const meta = metadata.get(id);
    if (!meta) throw new Error(`Missing service metadata: ${id}`);
    stops.sort((a, b) => Number(required(a, "order")) - Number(required(b, "order")));
    const circular = booleanField(meta, "circular");
    const kind = serviceKind(required(meta, "service_type"));
    for (const [index, stop] of stops.entries()) {
      if (required(stop, "order") !== String(index)) throw new Error(`Non-contiguous stop order: ${id}`);
      if (booleanField(stop, "is_loop") !== circular || required(stop, "service_type") !== kind) {
        throw new Error(`Conflicting service metadata: ${id}`);
      }
    }
    const stationIds = stops.map((stop) => required(stop, "station_id_proposed"));
    if (stationIds.join("|") !== required(meta, "stop_ids")) throw new Error(`Stop order differs: ${id}`);
    const base = {
      id, name: required(meta, "line_name"), kind, stationIds, lineIds: [id] as [string],
      operator: "JR East", color: "#000000",
      directionLabels: { forward: "+1", backward: "-1" },
      platformCoordinates: Object.fromEntries(stationIds.map((id) => [id, [0, 0] as Station["coordinates"]])),
    };
    services.push(circular ? { ...base, circular: true } : {
      ...base, circular: false,
      endpoints: { first: endpoint(required(meta, "first_end_kind")), last: endpoint(required(meta, "last_end_kind")) },
    });
    const pairs = circular ? stationIds.length : stationIds.length - 1;
    for (let index = 0; index < pairs; index += 1) {
      const from = stationIds[index];
      const to = stationIds[(index + 1) % stationIds.length];
      if (from === undefined || to === undefined) throw new Error(`Missing stop: ${id}`);
      const directions: [string, string][] = id === targetServiceId ? [[from, to]] : [[from, to], [to, from]];
      for (const [a, b] of directions) {
        const segmentId = `${id}:${a}:${b}`;
        segments.push({ id: segmentId, serviceId: id, from: a, to: b, geometryFeatureIds: [segmentId] });
      }
    }
  }
  const hashes = { [catalogPath]: sha256(catalogText), [servicesPath]: sha256(servicesText) };
  const network = buildRailwayNetwork({
    dataVersion: `simulation-${hashes[catalogPath]}-${hashes[servicesPath]}`,
    stations: [...stations.values()], services, segments,
  });
  return {
    network, targetServiceId, startStationId,
    provenance: {
      ...provenance(network, "research-csv", hashes), catalogRows: rows.length,
      endpointNote: "Research through-split -> service-boundary; same stop/discard-pips semantics. No geometry loaded.",
    },
  };
}

/** Use product guards so the entry point follows future data-contract changes. */
export function loadShippedBundle(
  directory: string,
  targetServiceId: string = "jr-yamanote",
  startStationId: string = "shimbashi",
): SimulationInput {
  const hashes: Record<string, string> = {};
  const read = <T>(file: string, guard: (value: unknown) => value is T): T => {
    const path = join(directory, file);
    const text = readLf(path);
    hashes[path] = sha256(text);
    const value: unknown = JSON.parse(text);
    if (!guard(value)) throw new Error(`Invalid shipped data: ${path}`);
    return value;
  };
  const manifest = read("manifest.json", isManifest);
  const network = buildRailwayNetwork({
    dataVersion: manifest.dataVersion,
    stations: read("stations.json", isStationList),
    services: read("services.json", isServicesData).services,
    segments: read("segments.json", isSegmentList),
  });
  return { network, targetServiceId, startStationId, provenance: provenance(network, "shipped-bundle", hashes) };
}
