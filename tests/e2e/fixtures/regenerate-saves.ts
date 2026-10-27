// Run through Vite's SSR loader; see README.md for the exact command.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isItemSave, restoreGame, serializeGame } from "../../../src/features/game/engine";
import { DEFAULT_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { createGame, playTurn } from "./productGame";
import { loadBundle } from "./bundle";
import { PRODUCT_HISTORY_GAME_SEED, PRODUCT_HISTORY_SCENARIO_TURNS, PRODUCT_KORAKUEN_TRANSFER_SEED,
  PRODUCT_KORAKUEN_TRANSFER_TURN, PRODUCT_OEDO_GAME_SEED, PRODUCT_OEDO_LOTTERY_TURN } from "./seeds";

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
