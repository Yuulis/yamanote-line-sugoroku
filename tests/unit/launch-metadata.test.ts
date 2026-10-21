import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EDITIONS } from "../../src/features/editions/registry";
import { RESULT_SHARE_SITE_URL } from "../../src/features/game/shareText";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PUBLIC_DIR = `${REPO_ROOT}public`;
const SITE_ORIGIN = "https://yamanote-line-sugoroku.vercel.app";
const CANONICAL_URL = `${SITE_ORIGIN}/`;
const MAX_DESCRIPTION_LENGTH = 120;
const MAX_OGP_BYTES = 1024 * 1024;
const OGP_WIDTH = 1200;
const OGP_HEIGHT = 630;
const APPLE_TOUCH_SIZE = 180;
const FAVICON_ICO_SIZES = [16, 32, 48];
const PNG_SIGNATURE = "89504e470d0a1a0a";
/** PNG IHDR colour types that carry no alpha channel (greyscale, RGB, palette). */
const OPAQUE_PNG_COLOUR_TYPES = new Set([0, 2, 3]);

type Attributes = Record<string, string>;

const html = readFileSync(`${REPO_ROOT}index.html`, "utf8");

/** Minimal attribute parser for the static, hand-written index.html. */
function tagsNamed(source: string, tag: "meta" | "link"): Attributes[] {
  const tags = source.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
  return tags.map((raw) => {
    const attributes: Attributes = {};
    for (const match of raw.matchAll(/([a-z:-]+)="([^"]*)"/g)) {
      attributes[match[1]!] = match[2]!;
    }
    return attributes;
  });
}

const metas = tagsNamed(html, "meta");
const links = tagsNamed(html, "link");

function metaContent(key: "name" | "property", value: string): string | undefined {
  return metas.find((meta) => meta[key] === value)?.content;
}

function linkHrefs(rel: string): string[] {
  return links.filter((link) => link.rel === rel).map((link) => link.href ?? "");
}

/** Maps a root-relative or canonical-origin URL to its file under public/. */
function publicPathOf(url: string): string {
  const path = url.startsWith(SITE_ORIGIN) ? url.slice(SITE_ORIGIN.length) : url;
  expect(path.startsWith("/")).toBe(true);
  return `${PUBLIC_DIR}${path}`;
}

function pngHeader(file: string): { width: number; height: number; colourType: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes.readUInt8(25) };
}

function icoSizes(file: string): number[] {
  const bytes = readFileSync(file);
  expect(bytes.readUInt16LE(2)).toBe(1); // 1 = icon resource
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => bytes.readUInt8(6 + index * 16) || 256);
}

describe("launch metadata in index.html", () => {
  it("keeps the document title equal to the edition's pinned title", () => {
    expect(html).toContain(`<title>${EDITIONS[0]!.display.documentTitle}</title>`);
  });

  it("declares a Japanese meta description within the length budget", () => {
    const description = metaContent("name", "description");
    expect(description).toBeDefined();
    expect(description!.length).toBeGreaterThan(0);
    expect(description!.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it("points canonical, og:url and the share text at the same canonical origin", () => {
    expect(linkHrefs("canonical")).toEqual([CANONICAL_URL]);
    expect(metaContent("property", "og:url")).toBe(CANONICAL_URL);
    expect(RESULT_SHARE_SITE_URL).toBe(SITE_ORIGIN);
  });

  it("declares every required Open Graph and Twitter card tag", () => {
    for (const property of [
      "og:title",
      "og:description",
      "og:image",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
      "og:url",
      "og:site_name",
    ]) {
      expect(metaContent("property", property), property).toBeTruthy();
    }
    expect(metaContent("property", "og:type")).toBe("website");
    expect(metaContent("property", "og:locale")).toBe("ja_JP");
    expect(metaContent("name", "twitter:card")).toBe("summary_large_image");
    for (const name of ["twitter:title", "twitter:description", "twitter:image"]) {
      expect(metaContent("name", name), name).toBeTruthy();
    }
    expect(metaContent("name", "theme-color")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("uses absolute canonical-origin URLs for the share images", () => {
    for (const image of [metaContent("property", "og:image"), metaContent("name", "twitter:image")]) {
      expect(image?.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    }
  });

  it("serves an OGP image whose declared size matches the file and stays under 1 MB", () => {
    const file = publicPathOf(metaContent("property", "og:image")!);
    const { width, height } = pngHeader(file);
    expect([width, height]).toEqual([OGP_WIDTH, OGP_HEIGHT]);
    expect(metaContent("property", "og:image:width")).toBe(String(width));
    expect(metaContent("property", "og:image:height")).toBe(String(height));
    expect(statSync(file).size).toBeLessThan(MAX_OGP_BYTES);
  });

  it("links icons, apple-touch-icon and manifest files that exist under public/", () => {
    const hrefs = [
      ...linkHrefs("icon"),
      ...linkHrefs("apple-touch-icon"),
      ...linkHrefs("manifest"),
    ];
    expect(hrefs).toEqual(
      expect.arrayContaining(["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest"]),
    );
    for (const href of hrefs) {
      expect(existsSync(publicPathOf(href)), href).toBe(true);
    }
  });

  it("ships a 16/32/48 px favicon.ico and an opaque 180 px apple-touch-icon", () => {
    expect(icoSizes(`${PUBLIC_DIR}/favicon.ico`).sort((a, b) => a - b)).toEqual(FAVICON_ICO_SIZES);
    const apple = pngHeader(`${PUBLIC_DIR}/apple-touch-icon.png`);
    expect([apple.width, apple.height]).toEqual([APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE]);
    expect(OPAQUE_PNG_COLOUR_TYPES.has(apple.colourType)).toBe(true);
  });
});

describe("site.webmanifest", () => {
  const manifest = JSON.parse(readFileSync(`${PUBLIC_DIR}/site.webmanifest`, "utf8")) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    theme_color?: string;
    background_color?: string;
    icons?: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it("names the game, starts at the root and does not claim an installable app display", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(["standalone", "fullscreen", "minimal-ui"]).not.toContain(manifest.display);
    expect(manifest.theme_color).toBe(metaContent("name", "theme-color"));
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists existing PNG icons whose pixel sizes match the declared sizes, including a maskable one", () => {
    const icons = manifest.icons ?? [];
    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const file = publicPathOf(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const { width, height } = pngHeader(file);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });
});

describe("privacy policy", () => {
  it("exists in Japanese and links to support and the analytics opt-out add-on", () => {
    const privacy = readFileSync(`${PUBLIC_DIR}/privacy.html`, "utf8");
    expect(privacy).toContain('<html lang="ja">');
    expect(privacy).toContain('href="https://github.com/Yuulis/yamanote-line-sugoroku/issues"');
    expect(privacy).toContain('href="https://tools.google.com/dlpage/gaoptout"');
  });
});
