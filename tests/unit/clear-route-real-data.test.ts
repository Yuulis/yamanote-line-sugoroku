import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGeometryIndex } from "../../src/features/game/animation/movePath";
import { deriveClearResult } from "../../src/features/game/clearResult";
import { buildClearRouteGeoJson } from "../../src/features/game/clearRoute";
import { restoreGame } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { loadBundle } from "../e2e/fixtures/bundle";
import { playTurn } from "../e2e/fixtures/productGame";
import { PRODUCT_HISTORY_CLEAR_ROUTE_LEGS } from "../e2e/fixtures/seeds";

const bundle = await loadBundle("real");
const geometryResult = bundle.data.geometry;
if (!geometryResult.ok) throw new Error("The product bundle must carry its geometry");
const PINNED_SAVE = readFileSync(fileURLToPath(new URL("../e2e/fixtures/tokyo-suburban-before-clear-save.json", import.meta.url)), "utf8");

describe("the pinned one-roll clear on the product data", () => {
  it("derives a verified full route whose GeoJSON has one LineString per leg", () => {
    const restored = restoreGame(PINNED_SAVE, bundle.network);
    if (restored.status !== "playing") throw new Error("The pinned save is one roll before the clear");
    const game = playTurn(restored as Parameters<typeof playTurn>[0], bundle.network).state;
    expect(game.status).toBe("completed");

    const { route } = deriveClearResult({
      game, network: bundle.network, geometry: buildGeometryIndex(geometryResult.value),
      presentation: createPresentationResolver(bundle.network),
      display: { title: "T", subtitle: "S", documentTitle: "T", ruleParagraphs: [] },
    });

    expect(route).not.toBeNull();
    const collection = buildClearRouteGeoJson(route!);
    expect(collection.features).toHaveLength(route!.legs.length);
    expect(collection.features.length).toBe(PRODUCT_HISTORY_CLEAR_ROUTE_LEGS);
    for (const feature of collection.features) expect(feature.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
  });
});
