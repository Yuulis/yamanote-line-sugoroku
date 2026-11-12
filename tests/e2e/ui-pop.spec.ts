import { expect, test } from "./fixtures";
import { itemScenario } from "./fixtures/itemScenarios";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState } from "../../src/types/network";
import { diceButton, freezeClock, gamePanel, inventoryItem, openGameLog, openGameMenu, readSaveText, revealUnadjustedRoll, writeSaveText } from "./support/app";
import type { RailwayBundle } from "./fixtures/bundle";

test.use({ dataset: "fixture" });

interface PopulatedState {
  state: ItemGameState;
  itemName: string;
  /** Active effects (= HUD effect chips) after the failed-save roll. */
  effects: number;
}

// Scanning real data is deterministic but costly, so each worker computes it once.
let populatedCache: PopulatedState | null = null;

function populatedState(bundle: RailwayBundle): PopulatedState {
  if (populatedCache) return populatedCache;
  let best: PopulatedState | null = null;
  let bestScore: number = -1;
  for (let seedValue: number = 0; seedValue < 256; seedValue += 1) {
    const seed: string = seedValue.toString(16).padStart(32, "0");
    let state: ItemGameState = createItemGame(ITEM_GAME_CONFIG, seed, bundle.network);
    for (let turnIndex: number = 0; turnIndex < 48 && state.status === "playing"; turnIndex += 1) {
      if (state.inventory.length === 3 && state.pending === null) {
        // The measured HUD is the one after the failed-save roll, so judge that state, not the restored one.
        const next: ItemGameState = playItemTurn(state, {}, bundle.network).state;
        const eligibleItem = next.inventory.find((item) => item.kind === "double" || item.kind === "rapid");
        const effects: number = next.effects.delayDueTurns.filter((dueTurn) => dueTurn > next.turn).length
          + next.effects.suspensions.filter((entry) => entry.expiresTurn > next.turn).length
          + (next.effects.detourPending ? 1 : 0) + (next.effects.oversleepPending ? 1 : 0);
        const hasSuspension: boolean = next.effects.suspensions.some((entry) => entry.expiresTurn > next.turn);
        const serviceName: string = bundle.network.servicesById.get(next.currentServiceId)?.name ?? "";
        // Prefer more effect chips (so the chip row overflows on narrow phones), then the longer ride name.
        const score: number = effects * 1000 + serviceName.length;
        if (next.pending === null && next.inventory.length === 3 && eligibleItem && effects >= 2 && hasSuspension && score > bestScore) {
          best = { state, itemName: eligibleItem.kind === "double" ? "倍速券" : "快速券", effects };
          bestScore = score;
        }
      }
      const result = playItemTurn(state, {}, bundle.network);
      state = result.state.pending?.kind === "discard"
        ? resolveItemDiscard(result.state, result.state.pending.item.id).state
        : result.state;
    }
  }
  if (!best) throw new Error("No seeded real-data state had three items, a usable speed ticket, active effects and a non-pending next turn");
  populatedCache = best;
  return best;
}

async function buildPopulatedState(page: import("@playwright/test").Page, bundle: RailwayBundle): Promise<PopulatedState> {
  const populated: PopulatedState = populatedState(bundle);
  await page.goto("/");
  await writeSaveText(page, serializeGame(populated.state));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    storage.originalSetItem = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save")) throw new Error("quota");
      storage.originalSetItem?.call(this, key, value);
    };
  });
  await diceButton(page).click();
  // A held 出目調整券 asks before the move finishes; keep the roll as it is.
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  const save = gamePanel(page).locator(".game-panel__save");
  await expect.poll(async () => await adjustment.isVisible() || ((await save.textContent()) ?? "").includes("失敗")).toBe(true);
  if (await adjustment.isVisible()) await adjustment.getByRole("button", { name: "そのまま続ける" }).click();
  await expect(save).toContainText("失敗");
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    if (storage.originalSetItem) storage.setItem = storage.originalSetItem;
    delete storage.originalSetItem;
  });
  const slot = inventoryItem(page, populated.itemName).first();
  await slot.getByRole("button").click();
  const card = gamePanel(page).getByRole("dialog", { name: populated.itemName, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "使う", exact: true }).click();
  await expect(slot).toHaveClass(/item-slot--selected/);
  await expect(gamePanel(page).locator(".item-staged-summary")).toBeVisible();
  expect(await gamePanel(page).locator(".item-slot:not(.item-slot--empty)").count()).toBe(3);
  expect(await gamePanel(page).locator(".effect-chip").count()).toBeGreaterThanOrEqual(2);
  return populated;
}

async function measureIdleDiceOffset(page: import("@playwright/test").Page, itemName: string): Promise<number> {
  await gamePanel(page).locator(".item-staged-summary").getByRole("button", { name: "選択を解除" }).click();
  await gamePanel(page).evaluate((panel) => { panel.scrollTop = 0; });
  const offset: number = await gamePanel(page).evaluate((panel) => {
    const dice = panel.querySelector<HTMLElement>(".game-panel__roll");
    if (!dice) throw new Error("HUD dice button is missing");
    return dice.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  });
  const slot = inventoryItem(page, itemName).first();
  await slot.getByRole("button").click();
  const card = gamePanel(page).getByRole("dialog", { name: itemName, exact: true });
  await card.getByRole("button", { name: "使う", exact: true }).click();
  await expect(slot).toHaveClass(/item-slot--selected/);
  // Focus returns to the staged slot; it must already be in view, so the panel must not have scrolled.
  await expect(slot.getByRole("button")).toBeFocused();
  expect(await gamePanel(page).evaluate((panel) => panel.scrollTop)).toBe(0);
  return offset;
}

async function scenario(page: import("@playwright/test").Page, name: Parameters<typeof itemScenario>[0], bundle: import("./fixtures/bundle").RailwayBundle): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(itemScenario(name, bundle.network)));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

test("opening an item card inspects without changing the save or draft", async ({ page, railwayBundle }) => {
  await scenario(page, "double", railwayBundle);
  const savedBefore = await readSaveText(page);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button", { name: "倍速券の詳細" });
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "倍速券" })).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(gamePanel(page).locator(".item-staged-summary")).toHaveCount(0);
  expect(await readSaveText(page)).toBe(savedBefore);
  await expect(gamePanel(page).locator("[role=status]")).toHaveCount(1);
});

test("menu, log, and item card transitions preserve a selected draft", async ({ page, railwayBundle }) => {
  await scenario(page, "double", railwayBundle);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button");
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await card.getByRole("button", { name: "使う", exact: true }).click();
  await expect(card).toBeHidden();
  await expect(slot).toHaveClass(/item-slot--selected/);
  const staged = gamePanel(page).locator(".item-staged-summary");
  await expect(staged).toContainText("倍速券");

  const log = gamePanel(page).getByRole("region", { name: "ターンのログ", exact: true });
  const menu = gamePanel(page).getByRole("region", { name: "メニュー", exact: true });
  await openGameMenu(page);
  await expect(log).toBeHidden();
  await expect(card).toBeHidden();
  await expect(staged).toContainText("倍速券");
  await openGameLog(page);
  await expect(menu).toBeHidden();
  await expect(card).toBeHidden();
  await expect(staged).toContainText("倍速券");

  await opener.click();
  await expect(log).toBeHidden();
  await expect(menu).toBeHidden();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "選択中・変更する", exact: true })).toBeVisible();
  await expect(staged).toContainText("倍速券");
  await openGameMenu(page);
  await expect(card).toBeHidden();
  await expect(log).toBeHidden();
  await expect(staged).toContainText("倍速券");
  await expect(slot).toHaveClass(/item-slot--selected/);
});

test("reclicking the open slot closes it and switching slots opens the other card", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  test.skip(Boolean(test.info().project.use.hasTouch), "pointer click contract runs on desktop projects");
  await scenario(page, "discard", railwayBundle);
  const slots = gamePanel(page).locator(".item-slot");
  const first = inventoryItem(page, "倍速券");
  const firstOpener = first.getByRole("button");
  await firstOpener.click();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeVisible();
  await firstOpener.click();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeHidden();
  await expect(firstOpener).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeHidden();
  const second = gamePanel(page).locator(".item-slot").filter({ has: page.getByRole("heading", { name: "出目調整券" }) });
  // Switching goes straight from an open card to the other slot's card.
  await firstOpener.click();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeVisible();
  await second.getByRole("button").click();
  await expect(gamePanel(page).getByRole("dialog", { name: "出目調整券" })).toBeVisible();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeHidden();
  await expect(firstOpener).toHaveAttribute("aria-expanded", "false");
  await expect(second.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  await expect(slots).toHaveCount(3);
});

test("phone tap opens, closes, and uses the item card", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  test.skip(!test.info().project.use.hasTouch, "needs a touch project");
  await scenario(page, "double", railwayBundle);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button");
  await opener.tap();
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await expect(card).toBeVisible();
  await opener.tap();
  await expect(card).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(card).toBeHidden();
  await opener.tap();
  await expect(card).toBeVisible();
  const otherSlot = inventoryItem(page, "出目調整券");
  const otherOpener = otherSlot.getByRole("button");
  await otherOpener.tap();
  const otherCard = gamePanel(page).getByRole("dialog", { name: "出目調整券", exact: true });
  await expect(otherCard).toBeVisible();
  await expect(card).toBeHidden();
  await otherOpener.tap();
  await expect(otherCard).toBeHidden();
  await otherOpener.tap();
  await expect(otherCard).toBeVisible();
  await otherCard.getByRole("button", { name: "閉じる", exact: true }).tap();
  await expect(otherCard).toBeHidden();
  await expect(otherOpener).toBeFocused();
  await opener.tap();
  await card.getByRole("button", { name: "使う" }).tap();
  await expect(slot).toHaveClass(/item-slot--selected/);
  await expect(gamePanel(page).locator(".item-staged-summary")).toContainText("倍速券");
  await expect(gamePanel(page).getByRole("status")).toContainText("倍速券を選択中");
  await expect(gamePanel(page).locator("[role=tooltip]")).toHaveCount(0);
  await expect(diceButton(page)).toBeVisible();
});

test("unusable and passive items remain inspectable with the right card actions", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await scenario(page, "adjust", railwayBundle);
  const adjust = inventoryItem(page, "出目調整券");
  await adjust.getByRole("button").click();
  const adjustCard = gamePanel(page).getByRole("dialog", { name: "出目調整券" });
  await expect(adjustCard.getByRole("button", { name: "使う" })).toBeDisabled();
  await expect(adjustCard).toContainText("出目が出た後に使えるアイテムです");
  await scenario(page, "certificate", railwayBundle);
  await page.setViewportSize({ width: 667, height: 375 });
  const certificate = inventoryItem(page, "遅延証明書");
  await certificate.getByRole("button").click();
  const certificateCard = gamePanel(page).getByRole("dialog", { name: "遅延証明書" });
  await expect(certificateCard).toContainText("持っているだけで効く");
  await expect(certificateCard.getByRole("button", { name: "使う" })).toHaveCount(0);
  await expect(certificateCard).not.toContainText("持っているだけで効くアイテムです");
  for (const viewport of [{ width: 667, height: 375 }, { width: 640, height: 400 }]) {
    await page.setViewportSize(viewport);
    const passiveGeometry = await certificateCard.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(".item-card__body");
      const effect = element.querySelector<HTMLElement>(".item-card__effect");
      const footer = element.querySelector<HTMLElement>(".item-card__footer");
      const close = element.querySelector<HTMLElement>(".item-card-popover__close");
      if (!body || !effect || !footer || !close || close.parentElement !== footer) throw new Error("passive sheet card structure is incomplete");
      const bodyBox = body.getBoundingClientRect();
      const effectBox = effect.getBoundingClientRect();
      const closeBox = close.getBoundingClientRect();
      const cardBox = element.getBoundingClientRect();
      const closeHit = (box: DOMRect): boolean => document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === close;
      const beforeScroll = {
        effectInsideBody: effectBox.top >= bodyBox.top - 1 && effectBox.bottom <= bodyBox.bottom + 1,
        closeHit: closeHit(closeBox),
        closeInsideCard: closeBox.top >= cardBox.top && closeBox.bottom <= cardBox.bottom && closeBox.bottom <= innerHeight,
        closeWidth: closeBox.width,
        closeHeight: closeBox.height,
        bodyScrollTop: body.scrollTop,
      };
      body.scrollTop = body.scrollHeight;
      const afterBox = close.getBoundingClientRect();
      const afterScroll = {
        closeHit: closeHit(afterBox),
        closeInsideCard: afterBox.top >= element.getBoundingClientRect().top && afterBox.bottom <= element.getBoundingClientRect().bottom,
        bodyScrollTop: body.scrollTop,
        bodyOverflows: body.scrollHeight > body.clientHeight + 1,
      };
      body.scrollTop = 0;
      return { beforeScroll, afterScroll };
    });
    expect(passiveGeometry.beforeScroll, `${viewport.width}x${viewport.height} passive card`).toMatchObject({
      effectInsideBody: true, closeHit: true, closeInsideCard: true, bodyScrollTop: 0,
    });
    expect(passiveGeometry.beforeScroll.closeWidth, `${viewport.width}x${viewport.height} passive close width`).toBeGreaterThanOrEqual(44);
    expect(passiveGeometry.beforeScroll.closeHeight, `${viewport.width}x${viewport.height} passive close height`).toBeGreaterThanOrEqual(44);
    expect(passiveGeometry.afterScroll, `${viewport.width}x${viewport.height} passive footer after body scroll`).toMatchObject({ closeHit: true, closeInsideCard: true });
    if (passiveGeometry.afterScroll.bodyOverflows) expect(passiveGeometry.afterScroll.bodyScrollTop).toBeGreaterThan(0);
    else expect(passiveGeometry.afterScroll.bodyScrollTop).toBe(0);
  }
});

test("keyboard opening, Escape focus return, and light dismiss keep the slot tooltip out of the card", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  test.skip(Boolean(test.info().project.use.hasTouch), "hover and light dismiss run on desktop projects");
  await scenario(page, "double", railwayBundle);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button");
  await opener.focus();
  await page.keyboard.press("Enter");
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await expect(card).toBeVisible();
  await expect(slot.locator(".item-slot__tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(slot.locator(".item-slot__tooltip")).toHaveCount(0);
  await opener.click();
  await gamePanel(page).getByRole("heading", { name: "山手線すごろく" }).click();
  await expect(card).toBeHidden();
  await expect(opener).not.toBeFocused();
});

test("route ticket card opens the use dialog and cancellation restores its opener", async ({ page, railwayBundle }) => {
  await scenario(page, "route", railwayBundle);
  const slot = inventoryItem(page, "路線指定券");
  const opener = slot.getByRole("button");
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "路線指定券", exact: true });
  await card.getByRole("button", { name: "使う" }).click();
  await expect(card).toBeHidden();
  const useDialog = gamePanel(page).getByRole("dialog", { name: "乗る路線を選ぶ" });
  await expect(useDialog).toBeVisible();
  await useDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(useDialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("direction ticket card opens its use dialog and cancellation restores its opener", async ({ page, railwayBundle }) => {
  await scenario(page, "direction", railwayBundle);
  const slot = inventoryItem(page, "方向指定券");
  const opener = slot.getByRole("button");
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "方向指定券", exact: true });
  await card.getByRole("button", { name: "使う" }).click();
  await expect(card).toBeHidden();
  const useDialog = gamePanel(page).getByRole("dialog", { name: "進む向きを選ぶ" });
  await expect(useDialog).toBeVisible();
  await useDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(useDialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("desktop card hides its own hover tooltip, keeps other slot hover, and closes on Tab out", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  test.skip(Boolean(test.info().project.use.hasTouch), "requires desktop hover and keyboard focus");
  await scenario(page, "discard", railwayBundle);
  const first = inventoryItem(page, "倍速券");
  const firstOpener = first.getByRole("button");
  await firstOpener.click();
  await first.hover();
  await expect(first.locator(".item-slot__tooltip")).toHaveCount(0);
  const second = inventoryItem(page, "出目調整券");
  await second.hover();
  await expect(second.locator(".item-slot__tooltip")).toBeVisible();

  const card = gamePanel(page).getByRole("dialog", { name: "倍速券" });
  await card.getByRole("button", { name: "閉じる" }).focus();
  await page.keyboard.press("Tab");
  await expect(card).toBeHidden();
  await expect(firstOpener).not.toBeFocused();
});

test.describe("S25 failed-save toast expiry", () => {
  test.use({ reducedMotion: "reduce" });

  test("ordinary item toast expires while failed-save status remains visible", async ({ page, railwayBundle }) => {
    await page.clock.install();
    await scenario(page, "double", railwayBundle);
    await freezeClock(page);

    const slot = inventoryItem(page, "倍速券");
    await slot.getByRole("button").click();
    const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
    await card.getByRole("button", { name: "使う", exact: true }).click();
    await expect(slot).toHaveClass(/item-slot--selected/);

    await page.evaluate(() => {
      const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
      storage.originalSetItem = storage.setItem;
      storage.setItem = function (key: string, value: string): void {
        if (key.includes("save")) throw new Error("quota");
        storage.originalSetItem?.call(this, key, value);
      };
    });

    await diceButton(page).click();
    const ordinaryToast = page.locator(".toast-host__toast", { hasText: "倍速券を使った" });
    const failureToast = page.locator(".toast-host__toast", { hasText: "保存に失敗しました" });
    const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    const skip = gamePanel(page).getByRole("button", { name: "スキップ", exact: true });

    await expect.poll(async () => await adjustment.isVisible() || await discard.isVisible()
      || await ordinaryToast.isVisible() || await skip.isEnabled()).toBe(true);
    if (await adjustment.isVisible()) {
      await adjustment.getByRole("button", { name: "そのまま続ける", exact: true }).click();
    }
    if (await discard.isVisible()) {
      await discard.locator(".item-discard__group")
        .filter({ hasText: "新しく拾った" })
        .getByRole("button", { name: "このアイテムを捨てる", exact: true }).click();
    }
    if (await skip.isEnabled()) await skip.click();

    await expect(ordinaryToast).toBeVisible();
    await expect(failureToast).toBeVisible();
    await expect(gamePanel(page).locator(".game-panel__save")).toContainText("失敗");
    await page.clock.runFor(4_200);
    await expect(ordinaryToast).toHaveCount(0);
    await expect(failureToast).toBeVisible();
    await expect(gamePanel(page).locator(".game-panel__save")).toContainText("失敗");
  });
});

test.describe("S23 populated responsive HUD", { tag: "@layout" }, () => {
  test.use({ dataset: "real", reducedMotion: "reduce" });
  // The first test in each worker scans real-data seeds for the populated save, and each test checks several viewports.
  test.describe.configure({ timeout: 90_000 });

  test("desktop populated HUD fits without scrolling", async ({ page, railwayBundle }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await buildPopulatedState(page, railwayBundle);
    const measurements = await gamePanel(page).evaluate((panel) => {
      const inside = (selector: string): boolean => {
        const element = panel.querySelector<HTMLElement>(selector);
        if (!element) return false;
        const parent = panel.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1;
      };
      return {
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        dice: inside(".game-panel__roll"),
        slots: [...panel.querySelectorAll<HTMLElement>(".item-slot")].every((slot) => inside(`.item-slot:nth-child(${[...slot.parentElement!.children].indexOf(slot) + 1})`)),
        staged: inside(".item-staged-summary"),
        triggers: inside(".game-panel__log-trigger") && inside(".game-panel__menu-trigger"),
      };
    });
    expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.clientHeight + 1);
    expect(measurements).toMatchObject({ dice: true, slots: true, staged: true, triggers: true });
  });

  test("phone populated layout keeps controls reachable at four widths", async ({ page, railwayBundle }, testInfo) => {
    const populated = await buildPopulatedState(page, railwayBundle);
    const widths: Array<{ width: number; height: number }> = [
      { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 400, height: 800 }, { width: 412, height: 915 },
    ];
    for (const viewport of widths) {
      await page.setViewportSize(viewport);
      const idleDiceOffset: number = await measureIdleDiceOffset(page, populated.itemName);
      const panel = gamePanel(page);
      await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
      const result = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(".game-panel");
        const map = document.querySelector<HTMLElement>(".map-container");
        const station = document.querySelector<HTMLElement>('[data-stat="station"]');
        const ride = document.querySelector<HTMLElement>('[data-stat="ride"]');
        const chips = document.querySelector<HTMLElement>(".game-panel .effect-chips");
        const dice = document.querySelector<HTMLElement>(".game-panel__roll");
        const zoom = document.querySelector<HTMLElement>('.maplibregl-ctrl-zoom-in');
        if (!panel || !map || !station || !ride || !chips || !dice || !zoom) throw new Error("phone layout elements missing");
        const box = (element: HTMLElement): DOMRect => element.getBoundingClientRect();
        const p = box(panel);
        const inPanel = (element: HTMLElement): boolean => box(element).top >= p.top - 1 && box(element).bottom <= p.bottom + 1;
        const overlap = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.getClientRects().length > 0);
        const offenders = buttons.filter((button) => box(button).width < 44 || box(button).height < 44)
          .map((button) => `${button.textContent?.trim()}:${Math.round(box(button).width)}x${Math.round(box(button).height)}`);
        const slots = [...panel.querySelectorAll<HTMLElement>(".item-slot")];
        const chipStyle = getComputedStyle(chips);
        const chipScrolls = chips.scrollWidth > chips.clientWidth + 1;
        chips.scrollLeft = chips.scrollWidth;
        const chipScrollLeft = chips.scrollLeft;
        const chipList = [...chips.querySelectorAll<HTMLElement>(".effect-chip")];
        const lastChip = chipList.at(-1);
        const lastChipInside = Boolean(lastChip && box(lastChip).left >= box(chips).left - 1 && box(lastChip).right <= box(chips).right + 1);
        chips.scrollLeft = 0;
        return {
          panelHeight: p.height, panelShare: (p.width * p.height) / (box(map).width * box(map).height),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          stationInside: inPanel(station), slotsInside: slots.length === 3 && slots.every(inPanel),
          chipOverflowX: chipStyle.overflowX, chipWrap: chipStyle.flexWrap, chipCount: chipList.length,
          chipScrollLeft, lastChipInside, chipScrolls, offenders, rideFits: ride.scrollWidth <= ride.clientWidth,
          rideText: ride.textContent ?? "", rideTitle: ride.title,
          badgeOverlap: overlap(box(panel.querySelector<HTMLElement>(".line-badge")!), box(ride)),
          zoomOverlap: overlap(box(zoom), p), diceOffset: box(dice).top - p.top,
          gridAreas: getComputedStyle(panel).gridTemplateAreas, gridRows: getComputedStyle(panel).gridTemplateRows,
        };
      });
      expect(result.panelHeight).toBeLessThanOrEqual(viewport.height * 0.45 + 1);
      expect(result.panelShare).toBeLessThan(0.5);
      expect(result.horizontalOverflow).toBe(false);
      expect(result.stationInside).toBe(true);
      expect(result.slotsInside).toBe(true);
      // One horizontally scrollable chip row; the last chip can be scrolled fully into view.
      expect(["auto", "scroll"]).toContain(result.chipOverflowX);
      expect(result.chipWrap).toBe("nowrap");
      if (viewport.width === 320) expect(result.chipScrolls, `${result.chipCount} chips should overflow at 320px`).toBe(true);
      if (result.chipScrolls) expect(result.chipScrollLeft).toBeGreaterThan(0);
      expect(result.lastChipInside).toBe(true);
      expect(result.offenders, `undersized buttons at ${viewport.width}: ${result.offenders.join(", ")}`).toEqual([]);
      expect(result.rideFits).toBe(true);
      expect(result.rideTitle).toBe(result.rideText);
      expect(result.badgeOverlap).toBe(false);
      expect(result.zoomOverlap).toBe(false);
      expect(Math.abs(result.diceOffset - idleDiceOffset), `${viewport.width}px idle ${idleDiceOffset}, staged ${result.diceOffset}, grid ${result.gridRows}`).toBeLessThanOrEqual(1);
      test.info().annotations.push({ type: `phone-grid-${viewport.width}`, description: `${result.gridAreas}; rows ${result.gridRows}` });
    }
    const selectedButton = inventoryItem(page, populated.itemName).first().getByRole("button");
    await diceButton(page).focus();
    for (let tabCount: number = 0; tabCount < 6; tabCount += 1) {
      if (await selectedButton.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(selectedButton).toBeFocused();
    const focusStyle = await selectedButton.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle, width: Number.parseFloat(getComputedStyle(element).outlineWidth) }));
    expect(focusStyle.style).not.toBe("none");
    expect(focusStyle.width).toBeGreaterThanOrEqual(2);
    await expect(inventoryItem(page, populated.itemName).first()).toHaveClass(/item-slot--selected/);
    const borderColor = await selectedButton.evaluate((element) => getComputedStyle(element).borderTopColor);
    expect(borderColor).toBe("rgb(217, 80, 47)");
    const tapHighlight = await selectedButton.evaluate((element) => ({ supported: CSS.supports("-webkit-tap-highlight-color", "transparent"), value: getComputedStyle(element).getPropertyValue("-webkit-tap-highlight-color") }));
    if (tapHighlight.supported) expect(tapHighlight.value).toBe("rgba(0, 0, 0, 0)");
    if (testInfo.project.use.hasTouch) {
      const slot = inventoryItem(page, populated.itemName).first();
      await slot.getByRole("button").tap();
      const card = gamePanel(page).getByRole("dialog", { name: populated.itemName, exact: true });
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: "選択中・変更する", exact: true })).toBeVisible();
      await card.getByRole("button", { name: "閉じる", exact: true }).tap();
      await expect(card).toBeHidden();
      await expect(slot).toHaveClass(/item-slot--selected/);
    }
  });

  test("short landscape keeps staged slots visible and card reachable", async ({ page, railwayBundle }, testInfo) => {
    const populated = await buildPopulatedState(page, railwayBundle);
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 640, height: 400 }]) {
      await page.setViewportSize(viewport);
      const idleOffset: number = await measureIdleDiceOffset(page, populated.itemName);
      const panel = gamePanel(page);
      const result = await panel.evaluate((element) => {
        const rect = (selector: string): DOMRect => {
          const target = element.querySelector<HTMLElement>(selector);
          if (!target) throw new Error(`missing ${selector}`);
          return target.getBoundingClientRect();
        };
        const p = element.getBoundingClientRect();
        const station = rect('[data-stat="station"]');
        const slots = [...element.querySelectorAll<HTMLElement>(".item-slot")].map((slot) => slot.getBoundingClientRect());
        const dice = rect(".game-panel__roll");
        return {
          panelHeight: p.height, scrollTop: element.scrollTop,
          stationInside: station.top >= p.top && station.bottom <= p.bottom,
          slotsInside: slots.length === 3 && slots.every((slot) => slot.top >= p.top && slot.bottom <= p.bottom),
          diceOffset: dice.top - p.top,
          diceOverflow: (element.querySelector<HTMLElement>(".game-panel__roll")?.scrollHeight ?? 0)
            > (element.querySelector<HTMLElement>(".game-panel__roll")?.clientHeight ?? 0) + 1,
          zoomOverlap: (() => {
            const zoom = document.querySelector<HTMLElement>(".maplibregl-ctrl-zoom-in")?.getBoundingClientRect();
            return Boolean(zoom && zoom.left < p.right && zoom.right > p.left && zoom.top < p.bottom && zoom.bottom > p.top);
          })(),
          gridAreas: getComputedStyle(element).gridTemplateAreas, gridRows: getComputedStyle(element).gridTemplateRows,
        };
      });
      expect(result.panelHeight).toBeLessThanOrEqual(viewport.height * 0.75 + 1);
      expect(result.scrollTop).toBe(0);
      expect(result.stationInside).toBe(true);
      expect(result.slotsInside).toBe(true);
      expect(result.diceOverflow).toBe(false);
      expect(result.zoomOverlap).toBe(false);
      expect(Math.abs(result.diceOffset - idleOffset), `${viewport.width}px idle ${idleOffset}, staged ${result.diceOffset}, grid ${result.gridRows}`).toBeLessThanOrEqual(1);
      testInfo.annotations.push({ type: `landscape-grid-${viewport.width}`, description: `${result.gridAreas}; rows ${result.gridRows}` });

      // Effect chips with the item staged: fully inside the visible panel,
      // scrolling the panel if needed (user decision 2026-11-03).
      const chips = panel.locator(".effect-chips");
      await expect(chips).toBeVisible();
      await chips.scrollIntoViewIfNeeded();
      const chipsGeometry = await panel.evaluate((element) => {
        const chipsElement = element.querySelector<HTMLElement>(".effect-chips")!;
        const panelRect = element.getBoundingClientRect();
        const chipsRect = chipsElement.getBoundingClientRect();
        return {
          panel: { top: panelRect.top, bottom: panelRect.bottom },
          chips: { top: chipsRect.top, bottom: chipsRect.bottom },
          inside: chipsRect.height > 0 && chipsRect.top >= panelRect.top && chipsRect.bottom <= panelRect.bottom,
        };
      });
      expect(chipsGeometry.inside, `${viewport.width}x${viewport.height} chips inside the visible panel: ${JSON.stringify(chipsGeometry)}`).toBe(true);
      testInfo.annotations.push({ type: "chips-geometry", description: `${viewport.width}x${viewport.height}: ${JSON.stringify(chipsGeometry)}` });
      await panel.evaluate((element) => { element.scrollTop = 0; });

      const slot = inventoryItem(page, populated.itemName).first();
      const opener = slot.getByRole("button");
      const card = gamePanel(page).getByRole("dialog", { name: populated.itemName, exact: true });
      const close = card.getByRole("button", { name: "閉じる", exact: true });
      // Sheet placement: the card action and 閉じる both stay visible and
      // hit-testable at the bottom of the card (user decision 2026-11-03).
      const expectSheetActionsVisible = async (actionName: string, afterScroll: boolean = false): Promise<void> => {
        const action = card.getByRole("button", { name: actionName, exact: true });
        await expect(action).toBeVisible();
        const geometry = await card.evaluate((element) => {
          const actionElement = element.querySelector<HTMLElement>(".item-card__action")!;
          const closeElement = element.querySelector<HTMLElement>(".item-card-popover__close")!;
          const footer = element.querySelector<HTMLElement>(".item-card__footer")!;
          const body = element.querySelector<HTMLElement>(".item-card__body")!;
          const effect = element.querySelector<HTMLElement>(".item-card__effect")!;
          const cardRect = element.getBoundingClientRect();
          const visible = (target: HTMLElement): boolean => {
            const rect = target.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return rect.top >= cardRect.top && rect.bottom <= cardRect.bottom && rect.bottom <= innerHeight && hit === target;
          };
          const footerBox = footer.getBoundingClientRect();
          const actionBox = actionElement.getBoundingClientRect();
          const closeBox = closeElement.getBoundingClientRect();
          const bodyBox = body.getBoundingClientRect();
          const effectBox = effect.getBoundingClientRect();
          const actionStyle = getComputedStyle(actionElement);
          return {
            action: { top: actionBox.top, bottom: actionBox.bottom },
            close: { top: closeBox.top, bottom: closeBox.bottom },
            // The body is the scrollport; its footer stays outside it.
            overflows: body.scrollHeight > body.clientHeight + 1,
            bodyScrollTop: body.scrollTop,
            effectInsideBody: effectBox.top >= bodyBox.top - 1 && effectBox.bottom <= bodyBox.bottom + 1,
            footerOwnsBothButtons: actionElement.parentElement === footer && closeElement.parentElement === footer,
            footerFitsCard: footerBox.top >= cardRect.top && footerBox.bottom <= cardRect.bottom && footerBox.bottom <= innerHeight,
            sameFooterRow: Math.abs(actionBox.top - closeBox.top) <= 1 && Math.abs(actionBox.bottom - closeBox.bottom) <= 1,
            actionWidth: actionBox.width,
            actionHeight: actionBox.height,
            closeWidth: closeBox.width,
            closeHeight: closeBox.height,
            actionVisible: visible(actionElement),
            closeVisible: visible(closeElement),
            // The pinned action keeps its own fill: its label must not match its background.
            actionLabelVisible: actionStyle.color !== actionStyle.backgroundColor,
          };
        });
        expect(geometry, `${viewport.width}x${viewport.height} ${actionName}`).toMatchObject({
          actionVisible: true,
          closeVisible: true,
          actionLabelVisible: true,
          footerOwnsBothButtons: true,
          footerFitsCard: true,
          sameFooterRow: true,
        });
        expect(geometry.actionWidth, `${viewport.width}x${viewport.height} action width`).toBeGreaterThanOrEqual(44);
        expect(geometry.actionHeight, `${viewport.width}x${viewport.height} action height`).toBeGreaterThanOrEqual(44);
        expect(geometry.closeWidth, `${viewport.width}x${viewport.height} close width`).toBeGreaterThanOrEqual(44);
        expect(geometry.closeHeight, `${viewport.width}x${viewport.height} close height`).toBeGreaterThanOrEqual(44);
        if (!afterScroll) {
          expect(geometry.bodyScrollTop, `${viewport.width}x${viewport.height} body starts unscrolled`).toBe(0);
          expect(geometry.effectInsideBody, `${viewport.width}x${viewport.height} initial effect text is inside the clipped body`).toBe(true);
        } else if (geometry.overflows) {
          expect(geometry.bodyScrollTop, `${viewport.width}x${viewport.height} overflowing body was scrolled`).toBeGreaterThan(0);
        } else {
          expect(geometry.bodyScrollTop, `${viewport.width}x${viewport.height} non-overflowing body remains at its top`).toBe(0);
        }
        testInfo.annotations.push({ type: "sheet-action-geometry", description: `${viewport.width}x${viewport.height} ${actionName}: ${JSON.stringify(geometry)}` });
      };

      if (testInfo.project.use.hasTouch) await opener.tap();
      else await opener.click();
      await expect(card).toBeVisible();
      const cardFits = await card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      });
      expect(cardFits).toBe(true);
      await expect(close).toBeVisible();
      await expectSheetActionsVisible("選択中・変更する");
      const body = card.locator(".item-card__body");
      await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expectSheetActionsVisible("選択中・変更する", true);
      await body.evaluate((element) => { element.scrollTop = 0; });
      const hitTests = await close.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
      });
      expect(hitTests).toBe(true);
      const openerHitTest = await opener.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === element;
      });
      expect(openerHitTest).toBe(true);
      if (testInfo.project.use.hasTouch) await close.tap();
      else await close.click();
      await expect(card).toBeHidden();
      await expect(opener).toBeFocused();

      // Unstaged, the action reads 使う and works without scrolling first.
      await panel.locator(".item-staged-summary").getByRole("button", { name: "選択を解除" }).click();
      if (testInfo.project.use.hasTouch) await opener.tap();
      else await opener.click();
      await expect(card).toBeVisible();
      await expectSheetActionsVisible("使う");
      await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expectSheetActionsVisible("使う", true);
      await body.evaluate((element) => { element.scrollTop = 0; });
      const use = card.getByRole("button", { name: "使う", exact: true });
      if (testInfo.project.use.hasTouch) await use.tap();
      else await use.click();
      await expect(card).toBeHidden();
      await expect(slot).toHaveClass(/item-slot--selected/);
    }
  });

  test("toasts clear attribution and map controls across layouts in both attribution states", async ({ page, railwayBundle }, testInfo) => {
    await buildPopulatedState(page, railwayBundle);
    // Ordinary toasts expire after 4 s, so per-toast rects cover the sticky failure toast and the
    // toast stack itself (fixed top/left/right, growing downwards) is checked independently of its length.
    const assertToastClearance = async (width: number, height: number, expanded: boolean): Promise<void> => {
      await page.setViewportSize({ width, height });
      // Crossing the compact/desktop boundary reattaches the control in the other corner from a
      // media-query change event, which an engine may deliver after setViewportSize resolves. Wait
      // for the corner the product guarantees for this viewport, and only toggle that control, so
      // the test never reads or clicks the outgoing one.
      const corner: string = width <= 600 || height <= 500 ? "top-left" : "bottom-right";
      await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(1);
      const attribution = page.locator(`.maplibregl-ctrl-${corner} > .maplibregl-ctrl-attrib.maplibregl-compact`);
      await expect(attribution).toHaveCount(1);
      const isExpanded = async (): Promise<boolean> => attribution.evaluate((element) => element.classList.contains("maplibregl-compact-show"));
      if (await isExpanded() !== expanded) await attribution.locator(".maplibregl-ctrl-attrib-button").click();
      await expect.poll(isExpanded).toBe(expanded);
      const label = `${width}x${height} ${expanded ? "expanded" : "collapsed"}`;
      const geometry = await page.evaluate((phone) => {
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
        };
        const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const targets = [
          ...document.querySelectorAll<HTMLElement>(".maplibregl-ctrl-attrib"),
          ...document.querySelectorAll<HTMLElement>(".maplibregl-ctrl-top-right .maplibregl-ctrl-group"),
          // Phones: the overview buttons too. In short landscape a later toast may pass over them (accepted).
          ...(phone ? document.querySelectorAll<HTMLElement>(".map-overview button") : []),
          ...document.querySelectorAll<HTMLElement>(".game-panel"),
        ].map((element) => ({ name: element.className, box: box(element) }));
        const toasts = [...document.querySelectorAll<HTMLElement>(".toast-host__toast")].map((toast) => ({
          text: toast.textContent?.trim() ?? "", box: box(toast),
        }));
        const host = box(document.querySelector(".toast-host")!);
        const attributionBox = box(document.querySelector(".maplibregl-ctrl-attrib")!);
        const zoom = document.querySelector(".maplibregl-ctrl-top-right .maplibregl-ctrl-group");
        const toggle = document.querySelector(".maplibregl-ctrl-attrib-button")!.getBoundingClientRect();
        return {
          toggleSize: { width: toggle.width, height: toggle.height },
          // The credit text never runs under the zoom buttons (licence text stays readable).
          attributionClearsZoom: !zoom || !overlaps(attributionBox, box(zoom)),
          toastCount: toasts.length,
          toastOverlaps: toasts.flatMap((toast) => targets.filter((target) => overlaps(toast.box, target.box))
            .map((target) => `${toast.text} × ${target.name}`)),
          // Top-left attribution (phones, short landscape): the stack starts below it or beside it,
          // whatever its length. A bottom attribution (desktop) is covered by the per-toast check.
          stackClearsAttribution: attributionBox.top > innerHeight / 2 || host.top >= attributionBox.bottom
            || host.left >= attributionBox.right || host.right <= attributionBox.left,
          host, attribution: attributionBox, toasts,
        };
      }, width <= 600);
      expect(geometry.toastCount, label).toBeGreaterThan(0);
      expect(geometry.toastOverlaps, label).toEqual([]);
      expect(geometry.attributionClearsZoom, `${label} attribution vs zoom`).toBe(true);
      // Phones and short landscape start collapsed, so the toggle is a required 44×44px target.
      if (width <= 600 || height <= 500) {
        expect(geometry.toggleSize.width, `${label} toggle width`).toBeGreaterThanOrEqual(44);
        expect(geometry.toggleSize.height, `${label} toggle height`).toBeGreaterThanOrEqual(44);
      }
      expect(geometry.stackClearsAttribution, `${label}: ${JSON.stringify({ host: geometry.host, attribution: geometry.attribution })}`).toBe(true);
      testInfo.annotations.push({ type: "toast-geometry", description: `${label}: ${JSON.stringify(geometry)}` });
    };
    for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 915 }, { width: 667, height: 375 }, { width: 640, height: 400 }, { width: 1280, height: 800 }]) {
      for (const expanded of [false, true]) await assertToastClearance(viewport.width, viewport.height, expanded);
    }
  });

  test("short landscape discard choices stay reachable inside the dialog scrollport", async ({ page, railwayBundle }) => {
    await scenario(page, "discard", railwayBundle);
    await page.setViewportSize({ width: 667, height: 375 });
    await revealUnadjustedRoll(page);
    const dialog = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await expect(dialog).toBeVisible();
    const action = dialog.getByRole("button", { name: "このアイテムを捨てる" }).first();
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const hit = await action.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const dialogBox = element.closest("dialog")!.getBoundingClientRect();
      return box.top >= dialogBox.top && box.bottom <= dialogBox.bottom
        && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    });
    expect(hit).toBe(true);
    await action.click();
    await expect(dialog).toBeHidden();
  });

  test("tab order follows the visual inventory, staged, effects, and disclosure order", async ({ page, railwayBundle, browserName }, testInfo) => {
    await buildPopulatedState(page, railwayBundle);
    // An overflowing chips row has no tabindex: Chromium (keyboard-focusable scrollers) and Firefox
    // make such a scroller a tab stop, WebKit (like Safari) does not add it automatically, so it is
    // expected only where the engine adds it.
    // Every other stop and the order are asserted identically in all engines.
    const scrollersAreTabStops: boolean = browserName !== "webkit";
    for (const viewport of [{ width: 320, height: 568 }, { width: 667, height: 375 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      const panel = gamePanel(page);
      await diceButton(page).focus();
      const visited: Array<{ name: string; top: number; left: number }> = [];
      const effectsScrollable = await panel.locator(".effect-chips").evaluate((element) => element.scrollWidth > element.clientWidth);
      const expectedSlots = await panel.locator(".item-slot:not(.item-slot--empty) h3").allTextContents();
      const expected = ["おまかせ: OFF", ...expectedSlots.map((name) => name.trim()), "選択を解除", ...(effectsScrollable && scrollersAreTabStops ? ["effects"] : []), "ログ", "メニュー"];
      for (let index = 0; index < expected.length; index += 1) {
        await page.keyboard.press("Tab");
        const active = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element) throw new Error("no focused element");
          const slot = element.closest<HTMLElement>(".item-slot");
          const name = slot?.querySelector("h3")?.textContent?.trim()
            ?? (element.matches(".effect-chips") ? "effects" : element.textContent?.trim() ?? "");
          const rect = element.getBoundingClientRect();
          const panel = element.closest<HTMLElement>(".game-panel");
          return { name, top: rect.top + (panel?.scrollTop ?? 0), left: rect.left,
            inPanel: Boolean(element.closest(".game-panel")), className: element.className };
        });
        expect(active.inPanel, `${viewport.width}px ${active.name} stays in the game panel`).toBe(true);
        visited.push(active);
      }
      expect(visited.map((entry) => entry.name)).toEqual(expected);
      if (viewport.width === 667) {
        testInfo.annotations.push({ type: "landscape-disclosure-positions", description: JSON.stringify(visited.slice(-2)) });
      }
      for (let index = 1; index < visited.length; index += 1) {
        expect(visited[index]!.top).toBeGreaterThanOrEqual(visited[index - 1]!.top - 1);
        if (Math.abs(visited[index]!.top - visited[index - 1]!.top) <= 1) {
          expect(visited[index]!.left).toBeGreaterThanOrEqual(visited[index - 1]!.left);
        }
      }
      const reversed: string[] = [];
      for (let index = 0; index < visited.length; index += 1) {
        await page.keyboard.press("Shift+Tab");
        reversed.push(await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          return element.closest<HTMLElement>(".item-slot")?.querySelector("h3")?.textContent?.trim()
            ?? (element.matches(".effect-chips") ? "effects" : element.textContent?.trim() ?? "");
        }));
      }
      expect(reversed).toEqual([...expected.slice(0, -1)].reverse().concat((await diceButton(page).innerText()).trim()));
    }
  });
});
