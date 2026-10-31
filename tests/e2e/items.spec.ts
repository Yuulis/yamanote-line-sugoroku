import type { Page } from "@playwright/test";
import type { ItemGameState } from "../../src/types/network";
import { playItemTurn, serializeGame } from "../../src/features/game/engine";
import { ITEM_DESCRIPTIONS, ITEM_SHORT_NAMES, itemTiming } from "../../src/features/game/itemPresentation";
import { expect, test } from "./fixtures";
import { itemScenario, type ItemScenario } from "./fixtures/itemScenarios";
import type { RailwayBundle } from "./fixtures/bundle";
import { closeGameLog, diceButton, freezeClock, gamePanel, openGameLog, panelStat, readMap, SAVE_STORAGE_KEY, writeSaveText } from "./support/app";

test.use({ dataset: "fixture" });

async function itemSave(page: Page): Promise<ItemGameState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_STORAGE_KEY);
}

async function restore(page: Page, game: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

async function scenario(page: Page, bundle: RailwayBundle, name: ItemScenario): Promise<ItemGameState> {
  const game = itemScenario(name, bundle.network);
  await restore(page, game);
  return game;
}

async function finishReducedTurn(page: Page, turnBefore: number): Promise<void> {
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect.poll(async () => {
    const save = await itemSave(page);
    return await adjustment.isVisible() || save.turn === turnBefore + 1 || save.pending?.kind === "discard";
  }).toBe(true);
  if (await adjustment.isVisible()) await adjustment.getByRole("button", { name: "そのまま続ける" }).click();
  await expect.poll(async () => {
    const save = await itemSave(page);
    return save.pending?.kind === "discard" || save.turn === turnBefore + 1;
  }).toBe(true);
}

function notices(page: Page) {
  return page.getByRole("region", { name: "アイテムのお知らせ" });
}

function inventoryItem(page: Page, name: string) {
  return gamePanel(page).locator(".item-slot").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test("the default edition starts an item game without a rules picker", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめから" }).click();
  expect((await itemSave(page)).config.rulesetVersion).toBe("tokyo-suburban-items-1");
  await expect(page.getByRole("heading", { name: "アイテム（3枠）" })).toBeVisible();
  await expect(gamePanel(page).locator("[role=status]")).toHaveCount(1);
  await expect(gamePanel(page).getByRole("status")).toContainText("サイコロを振れます");
});

test("stages and uses a double ticket, shows physical movement and restores its notice", async ({ page, railwayBundle }) => {
  const base = await scenario(page, railwayBundle, "double");
  const slot = inventoryItem(page, "倍速券");
  await slot.getByRole("button").click();
  await expect(slot.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(gamePanel(page).getByRole("status")).toContainText("倍速券を選択中");
  expect((await itemSave(page)).turn).toBe(base.turn);
  await diceButton(page).click();
  await finishReducedTurn(page, base.turn);
  await openGameLog(page);
  await expect(notices(page)).toContainText("倍速券を使いました");
  const arrived = await itemSave(page);
  const record = arrived.movementHistory.at(-1)!;
  if (record.kind !== "item-ride") throw new Error("Expected ride");
  expect(record.pips).toBe(record.effectiveFace * 2);
  await expect(panelStat(page, "出目")).toContainText(`${record.physicalHops}駅移動`);
  await restore(page, arrived);
  await openGameLog(page);
  await expect(notices(page)).toContainText("倍速券を使いました");
});

test("inventory shows icon slots with short names, persistent descriptions and a hoverable tooltip", async ({ page, railwayBundle }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめから" }).click();
  await expect(gamePanel(page).locator(".item-slot--empty")).toHaveText(["空き枠", "空き枠", "空き枠"]);
  await expect(gamePanel(page).locator(".item-slot button")).toHaveCount(0);
  const base = await scenario(page, railwayBundle, "double");
  const heading = page.getByRole("heading", { name: "アイテム（3枠）" });
  await expect(heading).toBeAttached();
  await expect(gamePanel(page).locator(".item-inventory__label")).toHaveText("持ち物");
  for (const item of base.inventory) {
    const slot = inventoryItem(page, ITEM_DESCRIPTIONS[item.kind].name);
    await expect(slot.locator(".item-slot__short")).toHaveText(ITEM_SHORT_NAMES[item.kind]);
    await expect(slot.getByRole("heading", { name: ITEM_DESCRIPTIONS[item.kind].name })).toBeAttached();
    const button = slot.getByRole("button");
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    const description = page.locator(`#${await button.getAttribute("aria-describedby")}`);
    await expect(description).toContainText(ITEM_DESCRIPTIONS[item.kind].effect);
    await expect(description).toContainText(itemTiming(item.kind));
  }
  await expect(gamePanel(page).locator(".item-slot--empty")).toHaveCount(3 - base.inventory.length);
  const slot = inventoryItem(page, "倍速券");
  const button = slot.getByRole("button");
  await button.hover();
  const tooltip = slot.locator(".item-slot__tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("倍速券");
  await expect(tooltip).toContainText(ITEM_DESCRIPTIONS.double.effect);
  const box = await tooltip.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(tooltip).toBeVisible();
  // The tooltip never takes the click: whatever it covers stays operable.
  expect(await tooltip.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })).toBe(false);
  const panelBox = await gamePanel(page).boundingBox();
  await page.mouse.move(panelBox!.x + panelBox!.width / 2, Math.max(0, panelBox!.y - 20));
  await expect(tooltip).toBeHidden();
  await button.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
});

test("Escape dismisses a slot tooltip before it clears the staged item", async ({ page, railwayBundle }) => {
  const base = await scenario(page, railwayBundle, "double");
  const slot = inventoryItem(page, "倍速券");
  const button = slot.getByRole("button");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(gamePanel(page).getByRole("status")).toContainText("倍速券を選択中");
  const staged = gamePanel(page).locator(".item-staged-summary");
  await expect(staged).toContainText("倍速券");
  await page.mouse.move(0, 0);
  await button.evaluate((element: HTMLButtonElement) => element.blur());
  await button.focus();
  await expect(slot.locator(".item-slot__tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(slot.locator(".item-slot__tooltip")).toBeHidden();
  await expect(gamePanel(page).getByRole("status")).toContainText("倍速券を選択中");
  await expect(staged).toContainText("倍速券");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect((await itemSave(page)).turn).toBe(base.turn);
  await page.keyboard.press("Escape");
  await expect(staged).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(gamePanel(page).getByRole("status")).not.toContainText("倍速券を選択中");
});

test("the passive certificate slot shows timing without the redundant passive hint", async ({ page, railwayBundle }) => {
  await scenario(page, railwayBundle, "certificate");
  const slot = inventoryItem(page, "遅延証明書");
  const button = slot.getByRole("button");
  const description = page.locator(`#${await button.getAttribute("aria-describedby")}`);
  await expect(description).toContainText(ITEM_DESCRIPTIONS["delay-certificate"].effect);
  await expect(description).toContainText("持っているだけで効く");
  await expect(description).not.toContainText("持っているだけで効くアイテムです");
  await button.hover();
  await expect(slot.locator(".item-slot__tooltip")).toContainText("持っているだけで効く");
  await expect(slot.locator(".item-slot__tooltip")).not.toContainText("持っているだけで効くアイテムです");
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).not.toHaveAttribute("aria-pressed");
  await button.dispatchEvent("click");
  await expect(gamePanel(page).locator(".item-staged-summary")).toHaveCount(0);
});

test("inventory height does not depend on how many slots are filled", async ({ page, railwayBundle }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめから" }).click();
  const freshHeight = await gamePanel(page).locator(".item-inventory").evaluate((element) => element.getBoundingClientRect().height);
  await scenario(page, railwayBundle, "discard");
  const fullHeight = await gamePanel(page).locator(".item-inventory").evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(freshHeight - fullHeight)).toBeLessThanOrEqual(1);
});

test("reduced motion leaves slot tooltips without transitions", async ({ page, railwayBundle }) => {
  await scenario(page, railwayBundle, "double");
  const slot = inventoryItem(page, "倍速券");
  await slot.getByRole("button").focus();
  const durations = await slot.evaluate((element) => [
    getComputedStyle(element.querySelector(".item-slot__tooltip")!).transitionDuration,
    getComputedStyle(element.querySelector(".item-slot__button")!).transitionDuration,
  ]);
  expect(durations.map((duration) => duration.split(",").map((entry) => entry.trim()))).toEqual([["0s"], ["0s", "0s", "0s"]]);
});

test("a touch tap still stages an item in one step and opens no tooltip", async ({ page, railwayBundle }) => {
  test.skip(!test.info().project.use.hasTouch, "needs a touch device");
  await scenario(page, railwayBundle, "double");
  const slot = inventoryItem(page, "倍速券");
  await slot.getByRole("button").tap();
  await expect(slot.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(gamePanel(page).getByRole("status")).toContainText("倍速券を選択中");
  await expect(slot.locator(".item-slot__tooltip")).toHaveCount(0);
});

for (const delta of [-1, 1] as const) {
  test(`pending reload retains the same die and supports adjustment ${delta}`, async ({ page, railwayBundle }) => {
    const base = await scenario(page, railwayBundle, "adjust");
    await diceButton(page).click();
    const dialog = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(dialog.getByRole("heading")).toBeFocused();
    const pending = await itemSave(page);
    if (pending.pending?.kind !== "roll") throw new Error("Expected pending roll");
    const raw = pending.pending.rawRoll;
    await expect(dialog.getByRole("status")).toContainText(`出目は${raw}`);
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(dialog.getByRole("heading")).toBeFocused();
    expect((await itemSave(page)).pending).toEqual(pending.pending);
    await expect(gamePanel(page).locator("[role=status]")).toHaveCount(1);
    await dialog.getByRole("radio", { name: delta === -1 ? /−1/ : /\+1/ }).check();
    await dialog.getByRole("button", { name: `出目${raw + delta}で続ける` }).click();
    await expect(dialog).toBeHidden();
    await expect(diceButton(page)).toBeFocused();
    const record = (await itemSave(page)).movementHistory.at(-1)!;
    expect(record).toMatchObject({ turn: base.turn + 1, rawRoll: raw, effectiveFace: raw + delta, adjustment: { delta } });
    await expect(gamePanel(page).getByRole("status")).toContainText(`調整後${raw + delta}`);
  });
}

test("full inventory survives reload and reports the player's chosen discard", async ({ page, railwayBundle }) => {
  const base = await scenario(page, railwayBundle, "discard");
  await diceButton(page).click();
  await finishReducedTurn(page, base.turn);
  const dialog = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
  await expect(dialog.getByRole("button")).toHaveCount(4);
  const pending = await itemSave(page);
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  expect((await itemSave(page)).pending).toEqual(pending.pending);
  const discarded = base.inventory[0]!;
  await dialog.getByRole("button").first().click();
  await expect(dialog).toBeHidden();
  // Opening the log moves focus to its trigger, so check the dialog's focus return first.
  await expect(diceButton(page)).toBeFocused();
  await openGameLog(page);
  await expect(notices(page)).toContainText(`${ITEM_DESCRIPTIONS[discarded.kind].name}を選んで捨てました`);
  expect((await itemSave(page)).inventory.some((item) => item.id === discarded.id)).toBe(false);
});

test("certificate cancellation names the harmful pickup, and restores the same notice", async ({ page, railwayBundle }) => {
  const base = await scenario(page, railwayBundle, "certificate");
  await diceButton(page).click();
  await finishReducedTurn(page, base.turn);
  await openGameLog(page);
  await expect(notices(page)).toContainText("遅延証明書で打ち消しました");
  const arrived = await itemSave(page);
  const event = arrived.movementHistory.at(-1)!.itemEvents.find((entry) => entry.type === "cancelled-by-certificate");
  if (event?.type !== "cancelled-by-certificate") throw new Error("Expected cancellation");
  await expect(notices(page)).toContainText(`拾った${ITEM_DESCRIPTIONS[event.item].name}`);
  expect(arrived.inventory.some((item) => item.id === event.certificate.id)).toBe(false);
  await restore(page, arrived);
  await openGameLog(page);
  await expect(notices(page)).toContainText("遅延証明書で打ち消しました");
});

test("delay countdown updates after each turn, survives resume, and announces activation", async ({ page, railwayBundle }) => {
  const base = await scenario(page, railwayBundle, "delay");
  for (let offset = 1; offset <= 4; offset++) {
    await diceButton(page).click();
    await finishReducedTurn(page, base.turn + offset - 1);
    const turn = base.turn + offset;
    await expect(panelStat(page, "ターン数")).toHaveText(String(turn));
    if (offset < 4) {
      await expect(gamePanel(page).getByLabel("続いている効果")).toContainText(`8ターン目に発動（あと${4 - offset}ターン）`);
      if (offset === 2) {
        await restore(page, await itemSave(page));
        await expect(gamePanel(page).getByLabel("続いている効果")).toContainText("あと2ターン");
      }
    } else {
      await openGameLog(page);
      await expect(notices(page)).toContainText("遅延が発動しました");
      await expect(gamePanel(page).getByRole("status")).toContainText("遅延が発動しました");
      expect((await itemSave(page)).movementHistory.at(-1)).toMatchObject({ effectiveFace: 1 });
    }
  }
});

test("deadhead repositions directly, with no die or invented route", async ({ page, railwayBundle }) => {
  const base = await scenario(page, railwayBundle, "deadhead");
  await inventoryItem(page, "回送列車").getByRole("button").click();
  await diceButton(page).click();
  await finishReducedTurn(page, base.turn);
  const arrived = await itemSave(page);
  const record = arrived.movementHistory.at(-1)!;
  expect(record).toMatchObject({ kind: "deadhead", rawRoll: null, physicalHops: 0, traversedSegmentIds: [] });
  await openGameLog(page);
  await expect(panelStat(page, "出目")).toHaveText("回送（サイコロなし）");
  await expect(gamePanel(page).locator(".game-panel__lottery")).toContainText("走行区間なし");
  await closeGameLog(page);
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(
    railwayBundle.network.servicesById.get(arrived.currentServiceId)!.platformCoordinates[arrived.currentStationId],
  );
  expect(arrived.completedSegmentIds).toEqual(base.completedSegmentIds);
});

test.describe("animated item turns", () => {
  test.use({ reducedMotion: "no-preference" });
  for (const name of ["rapid", "oversleep"] as const) {
    test(`${name} uses physical hops, ignores repeated clicks, and skip changes presentation only`, async ({ page, railwayBundle }) => {
      await page.clock.install();
      const base = await scenario(page, railwayBundle, name);
      await freezeClock(page);
      if (name === "rapid") await inventoryItem(page, "快速券").getByRole("button").click();
      await diceButton(page).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click(); });
      await expect(diceButton(page)).toHaveText("移動中…");
      const committed = await itemSave(page);
      expect(committed.turn).toBe(base.turn + 1);
      const record = committed.movementHistory.at(-1)!;
      if (record.kind !== "item-ride") throw new Error("Expected ride");
      expect(record.movementMode).toBe(name);
      if (name === "rapid") expect(record.physicalHops).toBeGreaterThan(record.pips);
      await diceButton(page).click({ force: true, clickCount: 3 });
      expect(await itemSave(page)).toEqual(committed);
      await gamePanel(page).getByRole("button", { name: "スキップ" }).click();
      await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
      expect(await itemSave(page)).toEqual(committed);
    });
  }
});

for (const name of ["route", "direction", "adjust", "discard"] as const) {
  test(`map failure keeps the ${name} decision usable through text`, async ({ page, railwayBundle, mapStub }) => {
    mapStub.failStyle = true;
    const base = await scenario(page, railwayBundle, name);
    await expect(page.getByRole("alert").filter({ hasText: "地図の読み込みに失敗しました。" })).toBeVisible();
    if (name === "route" || name === "direction") {
      await inventoryItem(page, name === "route" ? "路線指定券" : "方向指定券").getByRole("button").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("radio").first()).toBeVisible();
      await dialog.getByRole("radio").first().check();
      await dialog.getByRole("button", { name: name === "route" ? "この路線に決める" : "この方向に決める" }).click();
    }
    await diceButton(page).click();
    if (name === "adjust") {
      const dialog = page.getByRole("dialog", { name: "出目を調整しますか？" });
      await expect(dialog.getByRole("heading")).toBeFocused();
      await page.keyboard.press("Escape");
    }
    await finishReducedTurn(page, base.turn);
    if (name === "discard") {
      await page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" }).getByRole("button").last().click();
    }
    await expect(panelStat(page, "ターン数")).toHaveText(String(base.turn + 1));
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    await openGameLog(page);
    await gamePanel(page).getByText("地図なしで確認", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "乗車中の次の駅" })).toBeVisible();
    expect(await readMap(page)).toBeNull();
  });
}

for (const name of ["rapid", "oversleep"] as const) {
  test(`reduced motion preserves the complete ${name} result without playing the animation`, async ({ page, railwayBundle }) => {
    const base = await scenario(page, railwayBundle, name);
    const ticket = base.inventory.find((item) => item.kind === "rapid");
    if (name === "rapid") await inventoryItem(page, "快速券").getByRole("button").click();
    const expected = playItemTurn(base, name === "rapid"
      ? { command: { items: [{ kind: "rapid", instanceId: ticket!.id }] } } : {}, railwayBundle.network).state;
    await diceButton(page).click();
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    await expect.poll(() => itemSave(page)).toEqual(expected);
    await expect(gamePanel(page).getByRole("button", { name: "スキップ" })).toBeDisabled();
    await expect(gamePanel(page).getByRole("status")).toContainText(name === "rapid" ? "快速券を使いました" : "寝過ごしが発動しました");
  });
}

test("item controls and the decision sheet fit 320 and 390 pixel widths", async ({ page, railwayBundle }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await scenario(page, railwayBundle, "adjust");
    await expect(page.getByRole("heading", { name: "アイテム（3枠）" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await diceButton(page).click();
    const dialog = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(dialog.getByRole("heading")).toBeFocused();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "そのまま続ける" }).click();
    await expect(diceButton(page)).toBeFocused();
    await expect(gamePanel(page).locator(".game-panel__save")).toContainText("セーブ:");
  }
});

test.describe("long rapid goal arrival", () => {
  test.use({ reducedMotion: "no-preference" });
  test("the bounded animation finishes at the goal and retains the clearing item notice", async ({ page, railwayBundle }) => {
    await page.clock.install();
    const base = await scenario(page, railwayBundle, "rapid-long");
    await freezeClock(page);
    await inventoryItem(page, "快速券").getByRole("button").click();
    await diceButton(page).click();
    await expect(diceButton(page)).toHaveText("移動中…");
    const committed = await itemSave(page);
    expect(committed.status).toBe("completed");
    expect(committed.turn).toBe(base.turn + 1);
    const record = committed.movementHistory.at(-1)!;
    if (record.kind !== "item-ride") throw new Error("Expected rapid ride");
    expect(record.physicalHops).toBeGreaterThan(record.pips);
    // Establish the first animation timestamp, then simulate a delayed frame.
    // Fast-forward avoids rendering hundreds of WebGL frames in software.
    await page.clock.runFor(32);
    await page.clock.fastForward(6_100);
    await page.clock.runFor(32);
    await expect(page.getByRole("heading", { name: "クリア！", exact: true })).toBeFocused();
    await expect(notices(page)).toContainText("快速券を使いました");
    await expect(notices(page).getByRole("status")).toContainText("ゴールに到着しました");
    expect(await itemSave(page)).toEqual(committed);
    const history = page.locator(".clear-screen__history");
    await expect(history).not.toContainText("残り-");
    await expect(history).toContainText(`${record.physicalHops}駅移動`);
    const historicalText = await history.locator("li").allTextContents();
    await page.reload();
    await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
    await expect(page.getByRole("heading", { name: "クリア！", exact: true })).toBeFocused();
    await expect(history.locator("li")).toHaveText(historicalText);
  });
});
