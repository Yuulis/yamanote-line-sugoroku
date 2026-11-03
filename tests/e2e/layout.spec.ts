import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  closeGameMenu,
  gamePanel,
  loadManifestSource,
  openGameMenu,
  openTitle,
  readMap,
  startNewGame,
  titleScreen,
} from "./support/app";

// Spec 8.3 items covered here:
//   [8.3-1] PC / phone widths show the map and the controls.
//   [8.3-8] Credits and licences can be checked (title and play screens).

/** Most of the map must stay uncovered by the panel at every width (spec 6.2). */
const MAX_PANEL_SHARE_OF_MAP = 0.5;

test.use({ dataset: "fixture" });

/** Rules (any media block) whose selector names `selector` and whose body uses a safe-area inset with a 0px fallback. */
async function safeAreaRules(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((wanted) => {
    const rules: CSSStyleRule[] = [];
    const collect = (list: CSSRuleList): void => {
      for (const rule of [...list]) {
        if (rule instanceof CSSStyleRule) rules.push(rule);
        else if (rule instanceof CSSGroupingRule) collect(rule.cssRules);
      }
    };
    for (const sheet of [...document.styleSheets]) {
      try { collect(sheet.cssRules); } catch { /* cross-origin sheet */ }
    }
    return rules
      .filter((rule) => rule.selectorText.split(",").some((part) => part.trim() === wanted))
      .map((rule) => rule.cssText)
      .filter((text) => /env\(safe-area-inset-(top|right|bottom|left),\s*0px\)/.test(text));
  }, selector);
}

const SAFE_AREA_SELECTORS = [
  ".maplibregl-ctrl-top-left", ".maplibregl-ctrl-top-right", ".maplibregl-ctrl-bottom-right",
  ".map-overview", ".toast-host", ".game-panel",
] as const;

test("viewport-fit=cover is set and fixed overlays stay inside safe-area insets", async ({ page, browserName }, testInfo) => {
  await openTitle(page);
  await startNewGame(page);
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportMeta).toContain("viewport-fit=cover");
  for (const selector of SAFE_AREA_SELECTORS) {
    expect(await safeAreaRules(page, selector), `${selector} uses env(safe-area-inset-*, 0px)`).not.toEqual([]);
  }
  // Inset emulation is Chromium-only (CDP); other engines keep the static checks above.
  if (browserName !== "chromium") return;
  const cases = [
    { name: "portrait", width: 390, height: 844, insets: { top: 47, left: 0, right: 0, bottom: 34 } },
    { name: "landscape", width: 844, height: 390, insets: { top: 0, left: 47, right: 47, bottom: 21 } },
  ];
  const cdp = await page.context().newCDPSession(page);
  for (const entry of cases) {
    await page.setViewportSize({ width: entry.width, height: entry.height });
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: entry.insets });
    const safe = { top: entry.insets.top, left: entry.insets.left, right: entry.width - entry.insets.right, bottom: entry.height - entry.insets.bottom };
    const rects = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return rect && rect.width > 0 ? { selector, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom } : null;
      };
      return [
        box(".maplibregl-ctrl-zoom-in"), box(".maplibregl-ctrl-zoom-out"), box(".maplibregl-ctrl-attrib"),
        box(".map-overview"), box(".game-panel"),
      ].filter((rect) => rect !== null);
    });
    const toastTop = await page.locator(".toast-host").evaluate((element) => getComputedStyle(element).top);
    expect(rects.length, `${entry.name} measured overlays`).toBe(5);
    for (const rect of rects) {
      expect(rect.top, `${entry.name} ${rect.selector} top`).toBeGreaterThanOrEqual(safe.top);
      expect(rect.left, `${entry.name} ${rect.selector} left`).toBeGreaterThanOrEqual(safe.left);
      expect(rect.right, `${entry.name} ${rect.selector} right`).toBeLessThanOrEqual(safe.right);
      expect(rect.bottom, `${entry.name} ${rect.selector} bottom`).toBeLessThanOrEqual(safe.bottom);
    }
    expect(Number.parseFloat(toastTop), `${entry.name} toast host top`).toBeGreaterThanOrEqual(safe.top);
    testInfo.annotations.push({ type: `safe-area-${entry.name}`, description: JSON.stringify(rects) });
  }
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, right: 0, bottom: 0 } });
  await cdp.detach();
});

test("[8.3-1] title, then map and controls are visible without hiding the map", async ({
  page,
}) => {
  await openTitle(page);
  await expect(page).toHaveTitle("山手線すごろく — 東京近郊版");
  await expect(titleScreen(page).getByRole("combobox", { name: "遊ぶ版" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "はじめから" })).toBeVisible();

  await startNewGame(page);
  const map = page.locator(".map-container canvas.maplibregl-canvas");
  await expect(map).toBeVisible();
  await expect(titleScreen(page)).toBeHidden();
  const panel = gamePanel(page);
  await openGameMenu(page);
  await expect(panel.getByRole("button", { name: "サイコロを振る" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "スキップ" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /追尾/ })).toBeVisible();
  await closeGameMenu(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);

  const viewport = page.viewportSize();
  const mapBox = await map.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!viewport || !mapBox || !panelBox) throw new Error("layout boxes are missing");
  // The map fills the viewport behind the controls.
  expect(mapBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(mapBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
  // The panel sits inside the viewport and covers less than half of the map.
  expect(panelBox.x).toBeGreaterThanOrEqual(0);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height);
  const share = (panelBox.width * panelBox.height) / (mapBox.width * mapBox.height);
  expect(share).toBeLessThan(MAX_PANEL_SHARE_OF_MAP);
  // Zoom buttons stay reachable and are not under the panel.
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await expect(zoomIn).toBeVisible();
  const zoomBox = await zoomIn.boundingBox();
  if (!zoomBox) throw new Error("zoom button box is missing");
  const overlapsPanel =
    zoomBox.x < panelBox.x + panelBox.width &&
    zoomBox.x + zoomBox.width > panelBox.x &&
    zoomBox.y < panelBox.y + panelBox.height &&
    zoomBox.y + zoomBox.height > panelBox.y;
  expect(overlapsPanel).toBe(false);
});

test("[8.3-8] data and map attribution are reachable on the title and play screens", async ({
  page,
  railwayBundle,
}, testInfo) => {
  // The data credit comes from the shipped manifest, so the test follows the data.
  const source = await loadManifestSource(railwayBundle);
  await openTitle(page);
  await expect(titleScreen(page).getByRole("img", { name: "山手線すごろく" })).toBeVisible();
  await expect(titleScreen(page).getByText("東京近郊版", { exact: true })).toBeAttached();
  await expect(titleScreen(page).getByRole("button", { name: "クレジット" })).toBeVisible();
  await expect(titleScreen(page).getByText(
    "新橋から出発し、東京近郊の路線を乗り継ぎます。山手線は外回りに固定。全30区間を踏破して新橋に着くとクリアです。山手線では新橋で止まり、他路線ではちょうど止まる必要があります。終点・エリア端・系統の端で余った目は使いません。",
    { exact: true },
  )).toBeVisible();
  await titleScreen(page).getByRole("button", { name: "クレジット" }).click();
  const credits = page.getByRole("region", { name: "出典・ライセンス" });
  await expect(credits).toContainText(source.attribution);
  await expect(credits).toContainText(source.license);
  await expect(credits.getByRole("link", { name: source.attribution })).toHaveAttribute(
    "href",
    source.url,
  );
  await expect(credits.getByRole("link", { name: source.license })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/deed.ja",
  );
  await expect(credits.getByRole("link", { name: "使用ライブラリのライセンス" })).toHaveAttribute(
    "href",
    /third-party-licenses\.txt$/,
  );
  await expect(credits).not.toContainText("本作品は既存作品から着想を得た独立したオリジナルゲームです。");
  await expect(credits).not.toContainText("本作は東日本旅客鉄道株式会社および国土交通省とは関係のない、非公式のファンメイド作品です。");
  await expect(credits.getByRole("link", { name: "OpenFreeMap" })).toHaveAttribute(
    "href",
    "https://openfreemap.org/",
  );
  await expect(
    credits.getByRole("link", { name: "© OpenStreetMap contributors" }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");

  await page.getByRole("button", { name: "タイトルへ戻る" }).click();
  await startNewGame(page);
  // The app's own attribution control carries the data credit on the play
  // screen. The background-map credit is whatever the style's source declares
  // (the stub mirrors OpenFreeMap's TileJSON); asserting it proves the app's
  // custom attribution does not suppress the provider's credit.
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  const toggle = attribution.locator(".maplibregl-ctrl-attrib-button");
  if (testInfo.project.use.hasTouch) {
    await expect(attribution).toHaveClass(/maplibregl-compact/);
    await expect(attribution).not.toHaveClass(/maplibregl-compact-show/);
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(attribution).toHaveClass(/maplibregl-compact-show/);
    // Every credit link is reachable by keyboard, in order, from the toggle.
    const links = attribution.locator(".maplibregl-ctrl-attrib-inner a");
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < linkCount; index += 1) {
      await page.keyboard.press("Tab");
      await expect(links.nth(index)).toBeFocused();
    }
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(attribution).not.toHaveClass(/maplibregl-compact-show/);
    await page.keyboard.press("Space");
    await expect(attribution).toHaveClass(/maplibregl-compact-show/);
  } else {
    const expanded = await attribution.evaluate((element) => element.classList.contains("maplibregl-compact-show"));
    if (!expanded) await toggle.click();
  }
  const inner = attribution.locator(".maplibregl-ctrl-attrib-inner");
  await expect(inner).toContainText(source.attribution);
  await expect(inner).toContainText(source.license);
  await expect(inner.getByRole("link", { name: source.license })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/deed.ja",
  );
  await expect(inner.getByRole("link", { name: "OpenFreeMap" })).toBeVisible();
  await expect(inner.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
  await expect(inner).toBeInViewport();

  // The full credits stay one click away from the play screen.
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "タイトル" }).click();
  await titleScreen(page).getByRole("button", { name: "クレジット" }).click();
  await expect(credits).toBeVisible();
  await expect(credits).toContainText(source.license);
});
