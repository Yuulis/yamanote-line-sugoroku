import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { PRODUCT_HISTORY_GAME_SEED, PRODUCT_HUB_GAME_SEED } from "./fixtures/seeds";
import { itemScenario } from "./fixtures/itemScenarios";
import { serializeGame } from "../../src/features/game/engine";
import {
  closeGameMenu,
  diceButton,
  gamePanel,
  openGameMenu,
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
  test.use({ reducedMotion: "reduce", gameSeed: PRODUCT_HISTORY_GAME_SEED });

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
    await openGameMenu(page);
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
    await expect(summary).toHaveText("サイコロを振れます");
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
          if (/^\d+ターン目/.test(current)) changes.push(current);
        }
      }).observe(region, { childList: true, characterData: true, subtree: true });
      (window as unknown as { __announcementChanges?: string[] }).__announcementChanges = changes;
    });

    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: "追尾: ON" }).click();
    await closeGameMenu(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(0);

    for (let turn = 1; turn <= 5; turn += 1) {
      await rollOnce(page);
      const save = await readSave(page);
      if (!save) throw new Error("turn was not saved");
      const move = save.movementHistory.at(-1);
      if (!move || move.kind !== "item-ride") throw new Error("turn summary has no matching move");
      rolls.push(move.rawRoll);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __announcementChanges?: string[] }).__announcementChanges?.length ?? -1)).toBe(turn);
      const arrival = panelStat(page, "現在駅");
      await expect(summary).toContainText(`${turn}ターン目：出目${move.rawRoll}`);
      await expect(summary).toContainText(await arrival.innerText());
      await expect(summary).toContainText(`踏破 ${save.completedSegmentIds.filter((id) => id.startsWith("jr-yamanote:")).length}/30`);
    }

    expect(rolls[1]).toBe(rolls[2]);
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

    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: "新規" }).click();
    await page.getByRole("alertdialog", { name: "新しく始めますか？" }).getByRole("button", { name: "新しく始める" }).click();
    await expect(panelStat(page, "ターン数")).toHaveText("0");
    await expect(summary).toHaveText("サイコロを振れます");

    await rollOnce(page);
    await expect(summary).toContainText("1ターン目");
    await expect(summary).not.toContainText("2ターン目");
  });

  test("restoring a game announces the saved item turn and each new finished turn", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await rollOnce(page);
    await page.reload();
    await expect(titleScreen(page)).toBeVisible();
    await titleScreen(page).getByRole("button", { name: /つづきから/ }).click();

    const summary = gamePanel(page).locator(".visually-hidden[role=status][aria-live=polite]");
    await expect(summary).toContainText("1ターン目");
    await page.evaluate(() => {
      const region = document.querySelector<HTMLElement>(".visually-hidden[role=status][aria-live=polite]");
      if (!region) throw new Error("turn announcement region is missing");
      const changes: string[] = [];
      let previous = region.textContent ?? "";
      new MutationObserver(() => {
        const current = region.textContent ?? "";
        if (current !== previous) {
          previous = current;
          if (/^\d+ターン目/.test(current)) changes.push(current);
        }
      }).observe(region, { childList: true, characterData: true, subtree: true });
      (window as unknown as { __announcementChanges?: string[] }).__announcementChanges = changes;
    });

    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: "追尾: ON" }).click();
    await closeGameMenu(page);
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

test.describe("game menu disclosure", () => {
  test.use({ dataset: "fixture", reducedMotion: "reduce" });

  test("starts closed and keeps hidden menu controls out of keyboard navigation", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const panel = gamePanel(page);
    const trigger = panel.getByRole("button", { name: "メニュー", exact: true });
    const region = panel.locator("section.game-panel__menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(region).toBeHidden();
    await trigger.focus();
    for (let tabIndex = 0; tabIndex < 12; tabIndex += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".game-panel__menu")))).toBe(false);
    }
  });

  test("opens with Enter and Space, closes on Escape, and restores visible keyboard focus", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const panel = gamePanel(page);
    const trigger = panel.getByRole("button", { name: "メニュー", exact: true });
    const region = panel.getByRole("region", { name: "メニュー", exact: true });
    for (const key of ["Enter", "Escape", "Space", "Escape"]) {
      await trigger.focus();
      await page.keyboard.press(key);
      const isOpen = key === "Enter" || key === "Space";
      await expect(trigger).toHaveAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        await expect(region).toBeVisible();
        await expect(trigger).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(panel.getByRole("button", { name: "追尾: ON" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(trigger).toBeFocused();
        expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      }
    }
  });

  test("keeps legend expansion and filter state after the menu closes", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await openGameMenu(page);
    const panel = gamePanel(page);
    const trigger = panel.getByRole("button", { name: "メニュー", exact: true });
    const legendToggle = panel.locator(".game-panel__legend-toggle").first();
    const operator = panel.locator(".game-panel__legend-operator").first();
    await operator.locator("summary").click();
    const groupFilter = operator.getByRole("checkbox").last();
    await groupFilter.uncheck();
    await expect(groupFilter).not.toBeChecked();
    const initial = await legendToggle.getAttribute("aria-expanded");
    await legendToggle.click();
    const expanded = await legendToggle.getAttribute("aria-expanded");
    expect(expanded).not.toBe(initial);
    await closeGameMenu(page);
    await openGameMenu(page);
    await expect(legendToggle).toHaveAttribute("aria-expanded", expanded!);
    if (expanded !== "true") await legendToggle.click();
    if (!(await operator.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await operator.locator("summary").click();
    }
    await expect(operator.getByRole("checkbox").last()).not.toBeChecked();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("returns keyboard focus visibly to the menu trigger after cancelling 新規", async ({ page }) => {
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await rollOnce(page);
    const panel = gamePanel(page);
    await openGameMenu(page);
    const trigger = panel.getByRole("button", { name: "メニュー", exact: true });
    const newGame = panel.getByRole("button", { name: "新規", exact: true });
    await newGame.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  });

  test("Escape closes a native adjust dialog before the open menu", async ({ page, railwayBundle }) => {
    const game = itemScenario("adjust", railwayBundle.network);
    await page.goto("/");
    await writeSaveText(page, serializeGame(game));
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    const panel = gamePanel(page);
    await openGameMenu(page);
    await diceButton(page).click();
    const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(adjustment).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(adjustment).toBeHidden();
    await expect(panel.getByRole("button", { name: "メニュー", exact: true })).toHaveAttribute("aria-expanded", "true");
  });

  test("新規 confirmation Escape preserves the staged item before the next Escape clears it", async ({ page, railwayBundle }) => {
    const game = itemScenario("double", railwayBundle.network);
    await page.goto("/");
    await writeSaveText(page, serializeGame(game));
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    const panel = gamePanel(page);
    const trigger = panel.getByRole("button", { name: "メニュー", exact: true });
    const slot = panel.locator(".item-slot").filter({ has: page.getByRole("heading", { name: "倍速券", exact: true }) });
    await slot.getByRole("button").click();
    await expect(panel.getByText("倍速券を選択中")).toBeVisible();
    await openGameMenu(page);
    const newGame = panel.getByRole("button", { name: "新規", exact: true });
    await newGame.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(panel.getByText("倍速券を選択中")).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel.getByText("倍速券を選択中")).toBeHidden();
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
    await openGameMenu(page);
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

  // Integration check: after a new game and a resume the follow padding tracks the replacement panel and the
  // map is reused. The panel has a fixed height since S10b, so the test resizes it directly. Follow is off at
  // turn 0 and on the title screen, which also rebinds the observer; the `panelKey`-specific rebinding is
  // pinned by `tests/unit/map-panel-observer.test.ts`.
  test("follow padding rebinds to replacement panels without recreating the map", async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);

    const preserveMapIdentity = async () => page.evaluate(() => {
      const hook = (window as unknown as { __sugorokuE2E?: { map?: object | null; originalMap?: object } }).__sugorokuE2E;
      if (!hook?.map) throw new Error("MapLibre instance is missing");
      hook.originalMap = hook.map;
    });
    const sameMapInstance = async () => page.evaluate(() => {
      const hook = (window as unknown as { __sugorokuE2E?: { map?: object | null; originalMap?: object } }).__sugorokuE2E;
      return Boolean(hook?.map && hook.originalMap === hook.map);
    });
    const hasExpandedPanelPadding = async () => page.evaluate(() => {
      interface PaddedMap { getPadding(): { bottom: number } }
      const map = (window as unknown as { __sugorokuE2E?: { map?: PaddedMap | null } }).__sugorokuE2E?.map;
      return (map?.getPadding().bottom ?? 0) > 250;
    });
    const markerAbovePanel = async () => page.evaluate(async () => {
      interface CameraMap {
        getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> } | undefined;
        project(position: [number, number]): { x: number; y: number };
      }
      const map = (window as unknown as { __sugorokuE2E?: { map?: CameraMap | null } }).__sugorokuE2E?.map;
      const panel = document.querySelector<HTMLElement>(".game-panel");
      const source = await map?.getSource("game-current-position")?.getData();
      const coordinates = source?.features[0]?.geometry.coordinates;
      return Boolean(map && panel && coordinates && map.project(coordinates).y < panel.getBoundingClientRect().top - 12);
    });
    const verifyReplacementPanel = async () => {
      await expect.poll(markerAbovePanel).toBe(true);
      await gamePanel(page).evaluate((panel) => { panel.style.height = "65%"; });
      await expect.poll(hasExpandedPanelPadding).toBe(true);
      await expect.poll(markerAbovePanel).toBe(true);
      await gamePanel(page).locator(".game-panel__route-summary > summary").click();
      await expect(gamePanel(page).getByRole("region", { name: "山手線の未踏破区間" })).toBeVisible();
      await expect.poll(markerAbovePanel).toBe(true);
      await expect.poll(sameMapInstance).toBe(true);
    };

    await preserveMapIdentity();
    await rollOnce(page);
    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: "新規" }).click();
    await page.getByRole("alertdialog", { name: "新しく始めますか？" }).getByRole("button", { name: "新しく始める" }).click();
    await expect(panelStat(page, "ターン数")).toHaveText("0");
    await rollOnce(page);
    await verifyReplacementPanel();

    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: "タイトル" }).click();
    await expect(titleScreen(page)).toBeVisible();
    await titleScreen(page).getByRole("button", { name: /つづきから/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    await rollOnce(page);
    await verifyReplacementPanel();
  });

  test("a desktop panel resize leaves a camera moved off the marker where it is", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await rollOnce(page);

    interface CameraMap {
      isMoving(): boolean;
      getCenter(): { lng: number; lat: number };
      jumpTo(options: { center: [number, number] }): void;
      getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> } | undefined;
    }
    // The follow camera has settled on the marker.
    await expect.poll(() => page.evaluate(async () => {
      const map = (window as unknown as { __sugorokuE2E?: { map?: CameraMap | null } }).__sugorokuE2E?.map;
      const source = await map?.getSource("game-current-position")?.getData();
      const marker = source?.features[0]?.geometry.coordinates;
      if (!map || !marker || map.isMoving()) return false;
      const { lng, lat } = map.getCenter();
      return Math.abs(lng - marker[0]) < 1e-6 && Math.abs(lat - marker[1]) < 1e-6;
    })).toBe(true);

    // A programmatic move (not a user gesture) keeps following on.
    const away = await page.evaluate(() => {
      const map = (window as unknown as { __sugorokuE2E: { map: CameraMap } }).__sugorokuE2E.map;
      const { lng, lat } = map.getCenter();
      const target: [number, number] = [lng + 0.05, lat + 0.05];
      map.jumpTo({ center: target });
      return target;
    });
    // Desktop follow padding is zero, so growing the panel changes no camera layout.
    await gamePanel(page).locator(".game-panel__route-summary > summary").click();
    await expect(gamePanel(page).getByRole("region", { name: "山手線の未踏破区間" })).toBeVisible();

    // Let the resize observer, its animation frame and the React effects run.
    const LAYOUT_SETTLE_FRAMES = 10;
    const center = await page.evaluate(async (frames) => {
      for (let frame = 0; frame < frames; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const { lng, lat } = (window as unknown as { __sugorokuE2E: { map: CameraMap } }).__sugorokuE2E.map.getCenter();
      return [lng, lat];
    }, LAYOUT_SETTLE_FRAMES);
    expect(center[0]).toBeCloseTo(away[0], 6);
    expect(center[1]).toBeCloseTo(away[1], 6);
  });
});
