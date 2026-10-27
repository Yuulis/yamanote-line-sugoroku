// Run through Vite's SSR loader; see README.md for the exact command.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createGame, playTurn, restoreGame, serializeGame } from "../../../src/features/game/engine";
import { CLASSIC_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { loadBundle } from "./bundle";

const { network } = await loadBundle("real");
const directory = new URL("./", import.meta.url);
const files = ["tokyo-suburban-before-clear-save.json", "tokyo-suburban-korakuen-before-transfer-save.json", "tokyo-suburban-oedo-before-lottery-save.json"];
for (const filename of files) {
  const prior = JSON.parse(readFileSync(new URL(filename, directory), "utf8"));
  let game = createGame(CLASSIC_GAME_CONFIG, prior.rngSeed, network);
  while (game.turn < prior.turn) game = playTurn(game, network).state;
  // Regenerate through the real engine, preserving every gameplay/RNG field.
  if (JSON.stringify({ ...game, saveVersion: prior.saveVersion }) !== JSON.stringify(prior)) throw new Error(`Trajectory changed: ${filename}`);
  restoreGame(serializeGame(game), network, { expectedConfig: CLASSIC_GAME_CONFIG, requireSeededRolls: true });
  writeFileSync(new URL(filename, directory), `${serializeGame(game)}\n`);
}
const source = readFileSync(new URL(files[0]!, directory), "utf8").trimEnd();
const restored = restoreGame(source, network, { expectedConfig: CLASSIC_GAME_CONFIG, requireSeededRolls: true });
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
writeFileSync(new URL("../../unit/fixtures/edition-save-compatibility.json", directory), `${JSON.stringify({
  sourceSha256: hash(source), resumedSaveSha256: hash(serializeGame(restored)),
  nextTurnSaveSha256: hash(serializeGame(playTurn(restored, network).state)),
}, null, 2)}\n`);
