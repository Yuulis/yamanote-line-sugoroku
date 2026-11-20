import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { createItemGame, serializeGame } from "../../src/features/game/engine";
import { FIRST_PLAY_HINT_IDS } from "../../src/features/game/firstPlayGuide";
import {
  GUIDE_COACH_KEY,
  GUIDE_HINTS_DISABLED_KEY,
  GUIDE_STARTED_KEY,
  guideHintStorageKey,
} from "../../src/features/game/store/guide";
import { FIRST_TURN_NOTICE_KEY } from "../../src/features/game/store/notices";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { itemScenario, type ItemScenario } from "./fixtures/itemScenarios";
import {
  diceButton,
  diceMoment,
  freezeClock,
  gamePanel,
  inventoryItem,
  openGameMenu,
  openTitle,
  panelStat,
  readSave,
  startNewGame,
  titleScreen,
  writeSaveText,
} from "./support/app";
import { advanceTumble } from "./support/turnMoments";

const FIRST_TURN_NOTICE_TEXT = "自動で保存しています。いつでも閉じて、続きから遊べます";
const PHONE_HUD_BUDGET_PX = 252;

test.use({
  dataset: "fixture",
  firstPlayGuideSeen: false,
  firstTurnNoticeSeen: false,
  reducedMotion: "reduce",
});

async function writeExistingSave(page: Parameters<typeof writeSaveText>[0], railwayBundle: RailwayBundle): Promise<void> {
  const save = createItemGame(DEFAULT_GAME_CONFIG, "first-play-existing-save", railwayBundle.network);
  await writeSaveText(page, serializeGame(save));
}

async function resumeItemScenario(
  page: Parameters<typeof writeSaveText>[0], name: ItemScenario, railwayBundle: RailwayBundle,
): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(itemScenario(name, railwayBundle.network)));
  await page.reload();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

function rulesDialog(page: Parameters<typeof writeSaveText>[0]) {
  return page.getByRole("dialog", { name: "遊び方" });
}

async function openMenuRules(page: Parameters<typeof writeSaveText>[0]): Promise<void> {
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "遊び方", exact: true }).click();
  await expect(rulesDialog(page)).toBeVisible();
}

async function rejectCoachReplay(page: Parameters<typeof writeSaveText>[0]): Promise<void> {
  const rules = rulesDialog(page);
  const replay = rules.getByRole("button", { name: "最初のガイドをもう一度見る", exact: true });
  await expect(replay).toBeDisabled();
  await replay.evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(rules).toBeVisible();
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
}

async function hudBudget(page: Parameters<typeof gamePanel>[0]): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const stats = panel?.querySelector<HTMLElement>(".game-panel__stats");
    const actions = panel?.querySelector<HTMLElement>(".game-panel__actions");
    const inventory = panel?.querySelector<HTMLElement>(".item-inventory");
    if (!panel || !stats || !actions || !inventory) throw new Error("Phone HUD budget targets are missing");
    const verticalEdges = (element: HTMLElement, prefix: "margin" | "padding" | "border"): number => {
      const computed = getComputedStyle(element);
      const property = (edge: "top" | "bottom") => prefix === "border"
        ? `border-${edge}-width`
        : `${prefix}-${edge}`;
      return Number.parseFloat(computed.getPropertyValue(property("top")))
        + Number.parseFloat(computed.getPropertyValue(property("bottom")));
    };
    const style = getComputedStyle(panel);
    return verticalEdges(panel, "padding") + verticalEdges(panel, "border")
      + stats.getBoundingClientRect().height + verticalEdges(stats, "margin")
      + actions.getBoundingClientRect().height + verticalEdges(actions, "margin")
      + inventory.getBoundingClientRect().height + verticalEdges(inventory, "margin")
      + Number.parseFloat(style.rowGap) * 2;
  });
}

test("first eligible game shows the three-step coach, blocks input, and releases #68 after close", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);

  const coach = page.getByRole("dialog", { name: "最初のガイド" });
  await expect(coach).toBeVisible();
  await expect(coach.locator(".first-play-coach__step")).toHaveText("ステップ 1 / 3");
  await expect(coach.locator(".first-play-coach__copy")).toHaveText("サイコロを振ると、出た目の数だけ駅を進みます。");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GUIDE_COACH_KEY)).toBe("1");
  await expect(page.locator(".toast-host__text", { hasText: FIRST_TURN_NOTICE_TEXT })).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), FIRST_TURN_NOTICE_KEY)).toBeNull();

  const dice = diceButton(page);
  await expect(dice).toHaveAttribute("aria-disabled", "false");
  await dice.evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (const key of ["Space", "Enter", "s", "Escape"]) await page.keyboard.press(key);
  await page.locator(".map-container").evaluate((map) => map.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(dice).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(".turn-moment-host")).toHaveCount(0);
  await expect(coach).toBeVisible();

  const next = coach.getByRole("button", { name: "次へ", exact: true });
  await next.click();
  await expect(coach.locator(".first-play-coach__step")).toHaveText("ステップ 2 / 3");
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await coach.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await coach.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  const previous = coach.getByRole("button", { name: "前へ", exact: true });
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(coach.locator(".first-play-coach__step")).toHaveText("ステップ 1 / 3");
  await expect(coach.locator(".first-play-coach__bubble")).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await coach.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await coach.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await next.click();
  await next.click();
  await expect(coach.locator(".first-play-coach__step")).toHaveText("ステップ 3 / 3");
  await expect(coach.getByRole("button", { name: "はじめる", exact: true })).toBeVisible();
  await coach.getByRole("button", { name: "はじめる", exact: true }).click();

  await expect(coach).toHaveCount(0);
  await expect(dice).toBeFocused();
  await expect(page.locator(".toast-host__text", { hasText: FIRST_TURN_NOTICE_TEXT })).toHaveCount(0);
  await dice.click();
  await expect(panelStat(page, "ターン数")).toHaveText("1");
  await expect(page.locator(".toast-host__text", { hasText: FIRST_TURN_NOTICE_TEXT })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), FIRST_TURN_NOTICE_KEY)).toBe("1");
});

test("skipping the coach does not disable hints and the coach stays dismissed after reload and resume", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  const coach = page.getByRole("dialog", { name: "最初のガイド" });
  await expect(coach).toBeVisible();
  await coach.getByRole("button", { name: "とばす", exact: true }).click();

  await expect(coach).toHaveCount(0);
  await expect(diceButton(page)).toBeFocused();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GUIDE_HINTS_DISABLED_KEY)).toBeNull();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GUIDE_COACH_KEY)).toBe("1");

  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
});

test("an existing save prevents the coach from opening on a new game", async ({ page, railwayBundle }) => {
  await openTitle(page);
  await writeExistingSave(page, railwayBundle);
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();

  await startNewGame(page);
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GUIDE_STARTED_KEY)).toBeNull();
});

test("resuming an existing save never opens the coach", async ({ page, railwayBundle }) => {
  await openTitle(page);
  await writeExistingSave(page, railwayBundle);
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();

  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GUIDE_STARTED_KEY)).toBeNull();
});

test("in-game rules replay the coach for an ineligible player without changing guide preferences", async ({ page }) => {
  const guideKeys = [GUIDE_STARTED_KEY, GUIDE_COACH_KEY, GUIDE_HINTS_DISABLED_KEY,
    ...FIRST_PLAY_HINT_IDS.map(guideHintStorageKey)];
  await page.addInitScript(({ startedKey, coachKey, disabledKey }) => {
    localStorage.setItem(startedKey, "1");
    localStorage.setItem(coachKey, "1");
    localStorage.setItem(disabledKey, "1");
  }, { startedKey: GUIDE_STARTED_KEY, coachKey: GUIDE_COACH_KEY, disabledKey: GUIDE_HINTS_DISABLED_KEY });
  await openTitle(page);
  await startNewGame(page);
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
  const before = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), guideKeys);

  await openMenuRules(page);
  const rules = rulesDialog(page);
  const replay = rules.getByRole("button", { name: "最初のガイドをもう一度見る", exact: true });
  await expect(replay).toBeEnabled();
  await replay.click();

  const coach = page.getByRole("dialog", { name: "最初のガイド" });
  await expect(rules).toHaveCount(0);
  await expect(coach).toBeVisible();
  await expect(coach.locator(".first-play-coach__bubble")).toBeFocused();
  const afterHandoff = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), guideKeys);
  expect(afterHandoff).toEqual(before);
  await coach.getByRole("button", { name: "とばす", exact: true }).click();
  await expect(diceButton(page)).toBeFocused();
  const afterClose = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), guideKeys);
  expect(afterClose).toEqual(before);
});

test("replay is disabled during an active turn moment", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openTitle(page);
  await startNewGame(page);
  const firstCoach = page.getByRole("dialog", { name: "最初のガイド" });
  await firstCoach.getByRole("button", { name: "とばす", exact: true }).click();
  await diceButton(page).click();
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");

  await openMenuRules(page);
  await rejectCoachReplay(page);
});

test("item-use and confirmation dialogs reject stale replay requests", async ({ page, railwayBundle }) => {
  await resumeItemScenario(page, "route", railwayBundle);
  await openMenuRules(page);

  await inventoryItem(page, "路線指定券").getByRole("button").evaluate((button) => (button as HTMLButtonElement).click());
  const itemCard = gamePanel(page).getByRole("dialog", { name: "路線指定券", exact: true });
  await expect(itemCard).toBeVisible();
  await itemCard.getByRole("button", { name: "使う", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  const itemDialog = page.getByRole("dialog", { name: "乗る路線を選ぶ", exact: true });
  await expect(itemDialog).toBeVisible();
  await rejectCoachReplay(page);
  await itemDialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(itemDialog).toHaveCount(0);

  const newGame = gamePanel(page).locator(".game-panel__menu button").filter({ hasText: "新規" });
  await newGame.evaluate((button) => (button as HTMLButtonElement).click());
  const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
  await expect(confirmation).toBeVisible();
  await rejectCoachReplay(page);
  await confirmation.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(rulesDialog(page)).toHaveCount(0);
});

test("replay stays reachable in the scrollable phone rules dialog @layout", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openTitle(page);
  await startNewGame(page);
  await page.getByRole("dialog", { name: "最初のガイド" })
    .getByRole("button", { name: "とばす", exact: true }).click();
  await openMenuRules(page);

  const replay = rulesDialog(page).getByRole("button", { name: "最初のガイドをもう一度見る", exact: true });
  await replay.scrollIntoViewIfNeeded();
  await expect(replay).toBeInViewport();
  const bounds = await replay.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
});

test("pending adjustment and discard decisions take priority over coach replay", async ({ page, railwayBundle }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await resumeItemScenario(page, "adjust", railwayBundle);
  await freezeClock(page);
  await diceButton(page).click();
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await openMenuRules(page);
  const adjustRules = rulesDialog(page);
  await advanceTumble(page);
  const pendingRoll = await readSave(page);
  expect(pendingRoll?.pending?.kind).toBe("roll");
  await rejectCoachReplay(page);
  await page.keyboard.press("Escape");
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect(adjustRules).toHaveCount(0);
  await expect(adjustment).toBeVisible();
  await expect(adjustment.getByRole("heading", { name: "出目を調整しますか？" })).toBeFocused();
  await adjustment.getByRole("button", { name: "そのまま続ける" }).click();

  await page.goto("/");
  await writeSaveText(page, serializeGame(itemScenario("discard", railwayBundle.network)));
  await page.reload();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await freezeClock(page);
  await diceButton(page).click();
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await openMenuRules(page);
  await advanceTumble(page);
  const possibleRoll = await readSave(page);
  if (possibleRoll?.pending?.kind === "roll") {
    await rejectCoachReplay(page);
    await page.keyboard.press("Escape");
    const pendingAdjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(pendingAdjustment).toBeVisible();
    await pendingAdjustment.getByRole("button", { name: "そのまま続ける" }).click();
    await openMenuRules(page);
  }
  const discardRules = rulesDialog(page);
  await page.clock.runFor(30_000);
  await expect.poll(async () => (await readSave(page))?.pending?.kind).toBe("discard");
  const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
  await rejectCoachReplay(page);
  await page.keyboard.press("Escape");
  await expect(discardRules).toHaveCount(0);
  await expect(discard).toBeVisible();
  await expect(discard.getByRole("heading", { name: "捨てるアイテムを選ぶ" })).toBeFocused();
});

for (const viewport of [
  { name: "320x568 portrait", width: 320, height: 568 },
  { name: "390x844 portrait", width: 390, height: 844 },
  { name: "667x375 landscape", width: 667, height: 375 },
]) {
  test(`coach and HUD stay inside the ${viewport.name} viewport @layout`, { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openTitle(page);
    await startNewGame(page);

    const coach = page.getByRole("dialog", { name: "最初のガイド" });
    const bubble = coach.locator(".first-play-coach__bubble");
    await expect(coach).toBeVisible();
    const expectStepGeometry = async (targetSelector: string): Promise<void> => {
      const geometry = await page.evaluate((selector) => {
        const bubbleElement = document.querySelector<HTMLElement>(".first-play-coach__bubble");
        const spotlightElement = document.querySelector<HTMLElement>(".first-play-coach__spotlight");
        const targetElement = document.querySelector<HTMLElement>(selector);
        const copyElement = bubbleElement?.querySelector<HTMLElement>(".first-play-coach__copy");
        const buttons = [...(bubbleElement?.querySelectorAll<HTMLElement>("button") ?? [])];
        if (!bubbleElement || !spotlightElement || !targetElement || !copyElement || buttons.length === 0) {
          throw new Error(`Coach geometry targets are missing for ${selector}`);
        }
        const box = (element: HTMLElement) => {
          const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
          return { left, right, top, bottom, width, height };
        };
        const bubbleBox = box(bubbleElement);
        return {
          viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
          bubble: bubbleBox,
          spotlight: box(spotlightElement),
          target: box(targetElement),
          bubbleVisible: {
            left: bubbleBox.left + bubbleElement.clientLeft,
            right: bubbleBox.left + bubbleElement.clientLeft + bubbleElement.clientWidth,
            top: bubbleBox.top + bubbleElement.clientTop,
            bottom: bubbleBox.top + bubbleElement.clientTop + bubbleElement.clientHeight,
          },
          copy: box(copyElement),
          buttons: buttons.map(box),
        };
      }, targetSelector);
      const tolerance = 3;
      for (const edge of ["left", "right", "top", "bottom"] as const) {
        expect(Math.abs(geometry.spotlight[edge] - geometry.target[edge]), JSON.stringify(geometry))
          .toBeLessThanOrEqual(tolerance);
      }
      for (const rectangle of [geometry.bubble, geometry.copy, ...geometry.buttons]) {
        expect(rectangle.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
        expect(rectangle.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
        expect(rectangle.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport.width);
        expect(rectangle.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport.height);
      }
      for (const rectangle of [geometry.copy, ...geometry.buttons]) {
        expect(rectangle.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.bubbleVisible.left - tolerance);
        expect(rectangle.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.bubbleVisible.top - tolerance);
        expect(rectangle.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.bubbleVisible.right + tolerance);
        expect(rectangle.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.bubbleVisible.bottom + tolerance);
      }
    };
    await expectStepGeometry(".game-panel__roll");
    await expect(bubble).toBeVisible();
    await coach.getByRole("button", { name: "次へ", exact: true }).click();
    await expect(coach.locator(".first-play-coach__step")).toHaveText("ステップ 2 / 3");
    await expectStepGeometry(".target-progress");
    await coach.getByRole("button", { name: "次へ", exact: true }).click();
    await expect(coach.locator(".first-play-coach__step")).toHaveText("ステップ 3 / 3");
    await expectStepGeometry(".map-container");
    await expect.poll(() => hudBudget(page)).toBeLessThanOrEqual(PHONE_HUD_BUDGET_PX);
  });
}

test("the map step remains completable when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
      if (contextId === "webgl2") return null;
      return Reflect.apply(originalGetContext, this, [contextId, ...args]) as RenderingContext | null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openTitle(page);
  await startNewGame(page);
  const coach = page.getByRole("dialog", { name: "最初のガイド" });
  await coach.getByRole("button", { name: "次へ", exact: true }).click();
  await coach.getByRole("button", { name: "次へ", exact: true }).click();

  await expect(coach.locator(".first-play-coach__copy")).toContainText("山手線を一周して新橋へ");
  await expect(page.locator(".map-error")).toBeVisible();
  await expect(coach.locator(".first-play-coach__bubble")).toHaveAttribute("data-target-available", "true");
  await coach.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(diceButton(page)).toBeFocused();
});
