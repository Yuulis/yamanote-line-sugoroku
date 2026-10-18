import { readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fontPath = process.argv[2] ?? process.env.GLYPH_FONT_PATH;
if (!fontPath) {
  throw new Error("Pass the Noto Sans JP font path as an argument or GLYPH_FONT_PATH.");
}
const fontBytes = readFileSync(resolve(fontPath));
const stations = JSON.parse(readFileSync(resolve(repositoryRoot, "public/data/stations.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "public/data/manifest.json"), "utf8"));
const presentation = manifest.uiPresentation;
const labelParts = stations.map((station) => station.name);
for (const station of presentation.stations) labelParts.push(...station.aliases);
for (const stop of presentation.serviceStopNames) labelParts.push(stop.name);

const characters = [...new Set(labelParts.flatMap((part) => [...part]))]
  .sort((first, second) => first.codePointAt(0) - second.codePointAt(0));
const ranges = [...new Set(characters.map((character) => Math.floor(character.codePointAt(0) / 256) * 256))]
  .sort((first, second) => first - second);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const tinySdfPath = resolve(repositoryRoot, "node_modules/@mapbox/tiny-sdf/index.js");
const tinySdfSource = readFileSync(tinySdfPath, "utf8")
  .replace("export default class TinySDF", "window.TinySDF = class TinySDF");
await page.addScriptTag({ content: tinySdfSource });
const generated = await page.evaluate(async ({ requestedCharacters, fontDataUrl }) => {
  const style = document.createElement("style");
  style.textContent = `@font-face { font-family: FixtureNotoSansJP; src: url('${fontDataUrl}') format('truetype'); font-weight: 100 900; }`;
  document.head.append(style);
  await document.fonts.load("400 24px FixtureNotoSansJP", "駅山");
  const TinySDF = window.TinySDF;
  const sdf = new TinySDF({
    fontSize: 24,
    buffer: 3,
    radius: 8,
    cutoff: 0.25,
    fontFamily: "FixtureNotoSansJP",
    lang: "ja",
  });
  return requestedCharacters.map((character) => {
    const glyph = sdf.draw(character);
    const bitmap = glyph.width === 0 || glyph.height === 0
      ? new Uint8ClampedArray(36)
      : glyph.data;
    return {
      id: character.codePointAt(0) ?? 0,
      bitmap: [...bitmap],
      width: glyph.glyphWidth,
      height: glyph.glyphHeight,
      left: glyph.glyphLeft,
      top: glyph.glyphTop,
      advance: Math.round(glyph.glyphAdvance),
    };
  });
}, {
  requestedCharacters: characters,
  fontDataUrl: `data:font/ttf;base64,${fontBytes.toString("base64")}`,
});
await browser.close();

function varint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  while (remaining > 127n) {
    bytes.push(Number((remaining & 127n) | 128n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function fieldKey(fieldNumber, wireType) {
  return varint((fieldNumber << 3) | wireType);
}

function bytesField(fieldNumber, value) {
  return Buffer.concat([fieldKey(fieldNumber, 2), varint(value.length), value]);
}

function uintField(fieldNumber, value) {
  return Buffer.concat([fieldKey(fieldNumber, 0), varint(value)]);
}

function sintField(fieldNumber, value) {
  return uintField(fieldNumber, (value << 1) ^ (value >> 31));
}

function glyphMessage(glyph) {
  const expectedBitmapSize = (glyph.width + 6) * (glyph.height + 6);
  if (glyph.bitmap.length !== expectedBitmapSize) {
    throw new Error(`Invalid SDF bitmap length for U+${glyph.id.toString(16)}`);
  }
  return Buffer.concat([
    uintField(1, glyph.id),
    bytesField(2, Buffer.from(glyph.bitmap)),
    uintField(3, glyph.width),
    uintField(4, glyph.height),
    sintField(5, glyph.left),
    sintField(6, glyph.top),
    uintField(7, glyph.advance),
  ]);
}

const outputDirectory = resolve(repositoryRoot, "tests/e2e/fixtures/glyphs/Noto Sans Regular");
mkdirSync(outputDirectory, { recursive: true });
const expectedFiles = new Set(ranges.map((start) => `${start}-${start + 255}.pbf`));
for (const existingFile of readdirSync(outputDirectory)) {
  if (existingFile.endsWith(".pbf") && !expectedFiles.has(existingFile)) {
    rmSync(resolve(outputDirectory, existingFile));
  }
}
let totalBytes = 0;
for (const start of ranges) {
  const end = start + 255;
  const members = generated.filter((glyph) => glyph.id >= start && glyph.id <= end);
  const fontstack = Buffer.concat(members.map((glyph) => bytesField(3, glyphMessage(glyph))));
  const pbf = bytesField(1, fontstack);
  writeFileSync(resolve(outputDirectory, `${start}-${end}.pbf`), pbf);
  totalBytes += pbf.length;
}

console.log(`Generated ${generated.length} Japanese glyphs in ${ranges.length} ranges (${totalBytes} bytes).`);
