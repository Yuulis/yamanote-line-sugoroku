import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { PRODUCT_HUB_GAME_SEED } from "./fixtures/seeds";
import {
  diceButton,
  gamePanel,
  openTitle,
  panelStat,
  readMap,
  readSave,
  rollOnce,
  titleScreen,
  writeSaveText,
} from "./support/app";

test.use({ dataset: "real", gameSeed: PRODUCT_HUB_GAME_SEED });

test.describe("animated roll focus", () => {
  test.use({ reducedMotion: "no-preference" });

  test("keeps keyboard focus on the dice while a move is running and after it finishes", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const dice = gamePanel(page).locator(".game-panel__roll");
    await dice.focus();
    await page.keyboard.press("Enter");
    await expect(dice).toHaveText("移動中…");
    await expect(dice).toHaveAttribute("aria-disabled", "true");
    await expect(dice).toBeFocused();
    await expect(dice).toHaveText("サイコロを振る");
    await expect(dice).toBeFocused();
  });
});

test.describe("game accessibility and text navigation", () => {
  test.use({ reducedMotion: "reduce" });

  test("focus moves to each new screen heading and the title map is inert", async ({ page }) => {
    await openTitle(page);
    await expect(titleScreen(page).getByRole("heading", { name: "山手線すごろく" })).not.toBeFocused();
    await expect.poll(() => page.locator(".map-container").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(true);

    await page.getByRole("button", { name: "はじめから" }).click();
    const panelHeading = gamePanel(page).getByRole("heading", { name: "山手線すごろく" });
    await expect(panelHeading).toBeFocused();
    await expect(page.getByRole("main", { name: "ゲーム操作" })).toBeVisible();
    await expect.poll(() => page.locator(".map-container").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);
    const mapAfterPanel = await page.evaluate(() => {
      const panel = document.querySelector(".game-panel");
      const map = document.querySelector(".map-container");
      return Boolean(panel && map && (panel.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(mapAfterPanel).toBe(true);

    await rollOnce(page);
    await gamePanel(page).getByRole("button", { name: "タイトル" }).click();
    const titleHeading = titleScreen(page).getByRole("heading", { name: "山手線すごろく" });
    await expect(titleHeading).toBeFocused();
    await expect.poll(() => page.locator(".map-container").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(true);

    await titleScreen(page).getByRole("button", { name: /つづきから/ }).click();
    await expect(panelHeading).toBeFocused();
    await expect.poll(() => page.locator(".map-container").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);
  });

  test("the failed map can be retried from the inert title screen", async ({ page, mapStub }) => {
    mapStub.failStyle = true;
    await openTitle(page);
    const error = page.getByRole("alert").filter({ hasText: "地図の読み込みに失敗しました。" });
    const retry = error.getByRole("button", { name: "再試行" });
    await expect(error).toBeVisible();
    await expect(retry).toBeEnabled();
    expect(await retry.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);

    mapStub.failStyle = false;
    await retry.click();
    await expect(error).toBeHidden();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  });

  test("a turn summary announces the same roll again with turn, arrival and progress", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const summary = gamePanel(page).locator(".visually-hidden[role=status][aria-live=polite]");
    await expect(summary).toHaveCount(1);
    await expect(summary).toHaveText("");
    const rolls: number[] = [];
    await page.evaluate(() => {
      const region = document.querySelector<HTMLElement>(".visually-hidden[role=status][aria-live=polite]");
      if (!region) throw new Error("turn announcement region is missing");
      const changes: string[] = [];
      let previous = region.textContent ?? "";
      new MutationObserver(() => {
        const current = region.textContent ?? "";
        if (current !== previous) {
          previous = current;
          changes.push(current);
        }
      }).observe(region, { childList: true, characterData: true, subtree: true });
      (window as unknown as { __announcementChanges?: string[] }).__announcementChanges = changes;
    });

    await gamePanel(page).getByRole("button", { name: "追尾: ON" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(0);

    for (let turn = 1; turn <= 5; turn += 1) {
      const before = (await readSave(page))?.turn ?? 0;
      await diceButton(page).click();
      await expect.poll(async () => (await readSave(page))?.turn).toBe(before + 1);
      await expect(diceButton(page)).toHaveText("サイコロを振る");
      const save = await readSave(page);
      if (!save) throw new Error("turn was not saved");
      const move = save.movementHistory.at(-1);
      if (!move) throw new Error("turn summary has no matching move");
      rolls.push(move.roll);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(turn);
      const arrival = panelStat(page, "現在駅");
      await expect(summary).toContainText(`${turn}ターン目：出目${move.roll}`);
      await expect(summary).toContainText(await arrival.innerText());
      await expect(summary).toContainText(`踏破 ${save.completedSegmentIds.filter((id) => id.startsWith("jr-yamanote:")).length}/30`);
    }

    expect(rolls[3]).toBe(rolls[4]);
    const lastSummary = await summary.innerText();
    expect(lastSummary).toContain("5ターン目");
    expect(lastSummary).not.toContain("4ターン目");
    await expect(gamePanel(page).locator(".game-panel__lottery")).not.toHaveAttribute("aria-live", /.+/);
  });

  test("restart clears the previous turn announcement and announces the new session", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const summary = gamePanel(page).locator(".visually-hidden[role=status][aria-live=polite]");
    await rollOnce(page);
    await rollOnce(page);
    await expect(summary).toContainText("2ターン目");

    await gamePanel(page).getByRole("button", { name: "新規" }).click();
    await page.getByRole("alertdialog", { name: "新しく始めますか？" }).getByRole("button", { name: "新しく始める" }).click();
    await expect(panelStat(page, "ターン数")).toHaveText("0");
    await expect(summary).toHaveText("");

    await rollOnce(page);
    await expect(summary).toContainText("1ターン目");
    await expect(summary).not.toContainText("2ターン目");
  });

  test("restoring a game starts with an empty announcement and announces once per finished turn", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await rollOnce(page);
    await page.reload();
    await expect(titleScreen(page)).toBeVisible();
    await titleScreen(page).getByRole("button", { name: /つづきから/ }).click();

    const summary = gamePanel(page).locator(".visually-hidden[role=status][aria-live=polite]");
    await expect(summary).toHaveText("");
    await page.evaluate(() => {
      const region = document.querySelector<HTMLElement>(".visually-hidden[role=status][aria-live=polite]");
      if (!region) throw new Error("turn announcement region is missing");
      const changes: string[] = [];
      let previous = region.textContent ?? "";
      new MutationObserver(() => {
        const current = region.textContent ?? "";
        if (current !== previous) {
          previous = current;
          changes.push(current);
        }
      }).observe(region, { childList: true, characterData: true, subtree: true });
      (window as unknown as { __announcementChanges?: string[] }).__announcementChanges = changes;
    });

    await gamePanel(page).getByRole("button", { name: "追尾: ON" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(0);
    await rollOnce(page);
    await expect(summary).toContainText("2ターン目");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(1);
    await rollOnce(page);
    await expect(summary).toContainText("3ターン目");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(2);
  });

  test("the text route view lists remaining Yamanote sections and upcoming stations", async ({ page, railwayBundle }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const route = gamePanel(page).locator(".game-panel__route-summary");
    await route.getByText("地図なしで確認").click();

    const remaining = route.getByRole("region", { name: "山手線の未踏破区間" });
    await expect(remaining.getByRole("heading")).toHaveText("山手線の未踏破区間（30）");
    await expect(remaining.getByRole("listitem")).toHaveCount(30);

    const currentService = railwayBundle.network.servicesById.get("jr-yamanote");
    if (!currentService) throw new Error("Yamanote service is missing");
    const nextId = currentService.stationIds[currentService.stationIds.indexOf("shimbashi") + 1];
    const nextName = nextId ? railwayBundle.network.stationsById.get(nextId)?.name : undefined;
    if (!nextName) throw new Error("the next Yamanote station is missing");
    await expect(route.getByRole("region", { name: "乗車中の次の駅" })).toContainText(nextName);
  });

  test("resume and clear transitions focus their headings and keep the clear sheet at its top", async ({ page }) => {
    await openTitle(page);
    const savedGame = readFileSync("tests/e2e/fixtures/tokyo-suburban-before-clear-save.json", "utf8").trimEnd();
    await writeSaveText(page, savedGame);
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(gamePanel(page).getByRole("heading", { name: "山手線すごろく" })).toBeFocused();

    await diceButton(page).click();
    const clear = page.getByRole("region", { name: "クリア！" });
    await expect(clear).toBeVisible();
    const heading = clear.getByRole("heading", { name: "クリア！" });
    await expect(heading).toBeFocused();
    const clearScrollTop = await clear.evaluate((element) => element.scrollTop);
    expect(clearScrollTop).toBe(0);
    await expect(heading).toBeInViewport();
  });
});

test.describe("compact layouts and map follow padding", () => {
  test.use({ reducedMotion: "reduce" });

  test("landscape 667 by 375 keeps the lottery and options visible", async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);

    const panel = gamePanel(page);
    const assertCompactControlsVisible = async () => {
      const viewport = page.viewportSize();
      const panelBox = await panel.boundingBox();
      const lotteryBox = await panel.locator(".game-panel__lottery").boundingBox();
      const optionsBox = await panel.locator(".game-panel__options").boundingBox();
      if (!viewport || !panelBox || !lotteryBox || !optionsBox) throw new Error("compact panel boxes are missing");
      expect(panelBox.height).toBeLessThanOrEqual(viewport.height * 0.75 + 1);
      expect(lotteryBox.y).toBeGreaterThanOrEqual(panelBox.y);
      expect(lotteryBox.y + lotteryBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
      expect(optionsBox.y).toBeGreaterThanOrEqual(panelBox.y);
      expect(optionsBox.y + optionsBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
      await expect(panel.locator(".game-panel__lottery")).toBeInViewport();
      await expect(panel.locator(".game-panel__options")).toBeInViewport();
      expect(await panel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await expect(panel.locator(".game-panel__options button")).toHaveCount(4);
    };

    await assertCompactControlsVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await assertCompactControlsVisible();
  });

  test("follow camera leaves the marker above the bottom panel on phone and compact landscape", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await rollOnce(page);

    const markerAbovePanel = async () => page.evaluate(async () => {
      interface CameraMap {
        getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> } | undefined;
        project(position: [number, number]): { x: number; y: number };
      }
      const map = (window as unknown as { __sugorokuE2E?: { map?: CameraMap | null } }).__sugorokuE2E?.map;
      const panel = document.querySelector<HTMLElement>(".game-panel");
      if (!map || !panel) return false;
      const source = await map.getSource("game-current-position")?.getData();
      const coordinates = source?.features[0]?.geometry.coordinates;
      if (!coordinates) return false;
      return map.project(coordinates).y < panel.getBoundingClientRect().top - 12;
    });
    await expect.poll(markerAbovePanel).toBe(true);

    await page.setViewportSize({ width: 667, height: 375 });
    await rollOnce(page);
    await expect.poll(markerAbovePanel).toBe(true);
  });

  test("resizing from phone to desktop clears follow padding while stopped", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await rollOnce(page);

    const markerNearViewportCenter = async () => page.evaluate(async () => {
      interface CameraMap {
        getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> } | undefined;
        project(position: [number, number]): { x: number; y: number };
      }
      const map = (window as unknown as { __sugorokuE2E?: { map?: CameraMap | null } }).__sugorokuE2E?.map;
      const source = await map?.getSource("game-current-position")?.getData();
      const coordinates = source?.features[0]?.geometry.coordinates;
      if (!map || !coordinates) return false;
      return Math.abs(map.project(coordinates).y - window.innerHeight / 2) < 32;
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(markerNearViewportCenter).toBe(true);
  });

  test("rotation and opening the text route keep the stopped marker above the panel", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await rollOnce(page);

    const markerAbovePanel = async () => page.evaluate(async () => {
      interface CameraMap {
        getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> } | undefined;
        project(position: [number, number]): { x: number; y: number };
      }
      const map = (window as unknown as { __sugorokuE2E?: { map?: CameraMap | null } }).__sugorokuE2E?.map;
      const panel = document.querySelector<HTMLElement>(".game-panel");
      const source = await map?.getSource("game-current-position")?.getData();
      const coordinates = source?.features[0]?.geometry.coordinates;
      if (!map || !panel || !coordinates) return false;
      return map.project(coordinates).y < panel.getBoundingClientRect().top - 12;
    });

    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(markerAbovePanel).toBe(true);
    await gamePanel(page).locator(".game-panel__route-summary > summary").click();
    await expect(gamePanel(page).getByRole("region", { name: "山手線の未踏破区間" })).toBeVisible();
    await expect.poll(markerAbovePanel).toBe(true);
  });
});
