/// <reference types="node" />
// Playwright-free: browser fixtures and Vitest proofs read the same bundle.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRailwayData, type RailwayData } from "../../../src/data/loaders";
import { networkFromData } from "../../../src/features/game/networkFromData";
import type { RailwayNetwork } from "../../../src/features/game/engine";

export type DatasetKind = "fixture" | "capital-region" | "real";
export interface RailwayBundle {
  data: RailwayData;
  network: RailwayNetwork;
  payloads: Record<string, string>;
}

const DATA_FILES = ["stations.json", "services.json", "segments.json", "segments.geojson", "manifest.json"] as const;

export async function loadBundle(kind: DatasetKind): Promise<RailwayBundle> {
  const directory = kind === "capital-region" ? new URL("./capital-region/", import.meta.url) : kind === "fixture" ? new URL("./data/", import.meta.url) : new URL("../../../public/data/", import.meta.url);
  const payloads = Object.fromEntries(DATA_FILES.map((file) => [file, readFileSync(fileURLToPath(new URL(file, directory)), "utf8")]));
  const data = await loadRailwayData("", async (file) => JSON.parse(payloads[file]!));
  const result = networkFromData(data);
  if (!result.ok) throw new Error(`Invalid ${kind} bundle: ${result.reason}`);
  return { data, network: result.network, payloads };
}
