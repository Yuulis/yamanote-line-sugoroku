// Run through Vite's SSR loader; see README.md for the exact command.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isItemSave, restoreGame, serializeGame } from "../../../src/features/game/engine";
import { DEFAULT_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { createGame, playTurn, type ProductTurnResult } from "./productGame";
import { loadBundle } from "./bundle";
import { PRODUCT_COMPOSED_GAME_SEED, PRODUCT_COMPOSED_SCENARIO_TURNS, PRODUCT_HISTORY_GAME_SEED,
  PRODUCT_HISTORY_SCENARIO_TURNS, PRODUCT_KORAKUEN_TRANSFER_SEED, PRODUCT_KORAKUEN_TRANSFER_TURN,
  PRODUCT_OEDO_GAME_SEED, PRODUCT_OEDO_LOTTERY_TURN } from "./seeds";

const { network, payloads } = await loadBundle("real");
const directory = new URL("./", import.meta.url);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const scenarios = [
  ["tokyo-suburban-before-clear-save.json", PRODUCT_HISTORY_GAME_SEED, PRODUCT_HISTORY_SCENARIO_TURNS.completed - 1],
  ["tokyo-suburban-korakuen-before-transfer-save.json", PRODUCT_KORAKUEN_TRANSFER_SEED, PRODUCT_KORAKUEN_TRANSFER_TURN - 1],
  ["tokyo-suburban-oedo-before-lottery-save.json", PRODUCT_OEDO_GAME_SEED, PRODUCT_OEDO_LOTTERY_TURN - 1],
] as const;
const saves = scenarios.map(([filename, seed, turn]) => {
  let game = createGame(DEFAULT_GAME_CONFIG, seed, network);
  while (game.status === "playing" && game.turn < turn) game = playTurn(game, network).state;
  if (game.turn !== turn || game.pending) throw new Error(`Scenario not reached: ${filename}`);
  const text = serializeGame(game);
  restoreGame(text, network, { expectedConfig: DEFAULT_GAME_CONFIG, requireSeededRolls: true });
  writeFileSync(new URL(filename, directory), `${text}\n`);
  return { filename, seed, turn, sha256: hash(`${text}\n`) };
});

let korakuenGame = createGame(DEFAULT_GAME_CONFIG, PRODUCT_KORAKUEN_TRANSFER_SEED, network);
let korakuenTransfer: ProductTurnResult | undefined;
while (korakuenGame.status === "playing" && korakuenGame.turn < 250) {
  const result = playTurn(korakuenGame, network);
  const landing = result.events.find((event) => event.type === "landing-resolved");
  if (landing?.type === "landing-resolved" && landing.stationId === "metro-korakuen" && landing.changedService &&
      network.servicesById.get(landing.serviceId)?.operator !==
        network.servicesById.get(result.record.resolvedRide.serviceId)?.operator) {
    korakuenTransfer = result;
    break;
  }
  korakuenGame = result.state;
}
if (!korakuenTransfer || korakuenTransfer.state.turn !== PRODUCT_KORAKUEN_TRANSFER_TURN) {
  throw new Error("Korakuen transfer scenario not reached at its pinned turn");
}
const korakuenNext = playTurn(korakuenTransfer.state, network);

const composedForwardSegment = "jr-shonan-shinjuku-rapid-takasaki:musashi-kosugi:yokohama";
const composedReverseSegment = "jr-shonan-shinjuku-rapid-takasaki:yokohama:musashi-kosugi";
let composedGame = createGame(DEFAULT_GAME_CONFIG, PRODUCT_COMPOSED_GAME_SEED, network);
let composedForward: ProductTurnResult["record"] | undefined;
let composedReverse: ProductTurnResult["record"] | undefined;
while (composedGame.status === "playing" && composedGame.turn < 250 && (!composedForward || !composedReverse)) {
  const result = playTurn(composedGame, network);
  const record = result.record;
  if (record.landing && record.traversedSegmentIds.includes(composedForwardSegment) &&
      record.landing.serviceId !== record.resolvedRide.serviceId) composedForward ??= record;
  if (record.landing && record.traversedSegmentIds.includes(composedReverseSegment) &&
      record.landing.serviceId !== record.resolvedRide.serviceId) composedReverse ??= record;
  composedGame = result.state;
}
if (!composedForward || !composedReverse || composedForward.turn !== PRODUCT_COMPOSED_SCENARIO_TURNS.forward ||
    composedReverse.turn !== PRODUCT_COMPOSED_SCENARIO_TURNS.reverse) {
  throw new Error("Composed-hop scenarios not reached at their pinned turns");
}
writeFileSync(new URL("../../unit/fixtures/current-product-records.json", directory), `${JSON.stringify({
  metadata: {
    rulesetVersion: DEFAULT_GAME_CONFIG.rulesetVersion,
    korakuenSeed: PRODUCT_KORAKUEN_TRANSFER_SEED,
    composedSeed: PRODUCT_COMPOSED_GAME_SEED,
  },
  korakuenTransfer: korakuenTransfer.record,
  korakuenNext: korakuenNext.record,
  composedForward,
  composedReverse,
}, null, 2)}\n`);

const source = readFileSync(new URL(scenarios[0][0], directory), "utf8").trimEnd();
const restored = restoreGame(source, network, { expectedConfig: DEFAULT_GAME_CONFIG, requireSeededRolls: true });
if (!isItemSave(restored)) throw new Error("Expected product item save");
writeFileSync(new URL("../../unit/fixtures/edition-save-compatibility.json", directory), `${JSON.stringify({
  sourceSha256: hash(source), resumedSaveSha256: hash(serializeGame(restored)),
  nextTurnSaveSha256: hash(serializeGame(playTurn(restored, network).state)),
}, null, 2)}\n`);
writeFileSync(new URL("item-saves.provenance.json", directory), `${JSON.stringify({
  rulesetVersion: DEFAULT_GAME_CONFIG.rulesetVersion, dataVersion: network.dataVersion,
  policy: "No active item use; no roll adjustment; discard the incoming ticket on overflow",
  bundleSha256: Object.fromEntries(Object.entries(payloads).map(([file, payload]) => [file, hash(payload)])), saves,
}, null, 2)}\n`);
