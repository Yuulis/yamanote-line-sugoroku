import { expect, test } from "./fixtures";
import {
  gamePanel,
  loadManifestSource,
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

test("[8.3-1] title, then map and controls are visible without hiding the map", async ({
  page,
}) => {
  await openTitle(page);
  await expect(page.getByRole("button", { name: "はじめから" })).toBeVisible();

  await startNewGame(page);
  const map = page.locator(".map-container canvas.maplibregl-canvas");
  await expect(map).toBeVisible();
  await expect(titleScreen(page)).toBeHidden();
  const panel = gamePanel(page);
  await expect(panel.getByRole("button", { name: "サイコロを振る" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "スキップ" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /追尾/ })).toBeVisible();
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
}) => {
  // The data credit comes from the shipped manifest, so the test follows the data.
  const source = await loadManifestSource(railwayBundle);
  await openTitle(page);
  const credits = page.getByRole("region", { name: "出典・ライセンス" });
  await expect(titleScreen(page).getByText("東京近郊版", { exact: true })).toBeVisible();
  await expect(titleScreen(page).getByText(
    "新橋から出発し、東京近郊区間のJR線と対象の私鉄・地下鉄を乗り継ぐすごろくです。山手線外回り全30区間を踏破したあと、新橋に到着するとクリアです。サイコロの出目だけ駅を進み、到着駅で次に乗る路線を抽選します。山手線と他の路線がある駅では、3分の2の確率で山手線を選び、残りの確率を他の運行系統に均等に割り当てます。他の路線で方向を抽選するときは、山手線に近づく方向の抽選重みが反対方向の2倍になります。",
    { exact: true },
  )).toBeVisible();
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

  await startNewGame(page);
  // The app's own attribution control carries the data credit on the play
  // screen. The background-map credit is whatever the style's source declares
  // (the stub mirrors OpenFreeMap's TileJSON); asserting it proves the app's
  // custom attribution does not suppress the provider's credit.
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  const toggle = attribution.getByRole("button", { name: /attribution/i });
  if (await toggle.isVisible()) await toggle.click();
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
  await gamePanel(page).getByRole("button", { name: "タイトル" }).click();
  await expect(credits).toBeVisible();
  await expect(credits).toContainText(source.license);
});
