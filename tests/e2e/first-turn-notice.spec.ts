import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  createItemGame,
  playItemTurn,
  resolveItemDiscard,
  serializeGame,
} from "../../src/features/game/engine";
import type { ItemGameState, RailwayNetwork } from "../../src/features/game/engine";
import { FIXTURE_GAME_SEED } from "./fixtures/seeds";
import { expect, test } from "./fixtures";
import {
  diceButton,
  gamePanel,
  openTitle,
  panelStat,
  startNewGame,
  titleScreen,
  writeSaveText,
} from "./support/app";
import { autoRollToggle } from "./support/autoRoll";

const FIRST_TURN_NOTICE_KEY = "yamanote-line-sugoroku:notice:auto-resume:v1";
const FIRST_TURN_NOTICE_TEXT = "自動で保存しています。いつでも閉じて、続きから遊べます";
const NOTICE_SCREENSHOT_DIRECTORY = resolve(process.cwd(), ".claude/logs/screenshots");
const PHONE_VIEWPORT = { width: 320, height: 568 };
const BASELINE_TURN_COUNT = 3;
const PHONE_HUD_BUDGET_PX = 252;

test.use({ dataset: "fixture", firstTurnNoticeSeen: false, reducedMotion: "reduce" });

function baselineGame(network: RailwayNetwork): ItemGameState {
  let game = createItemGame(DEFAULT_GAME_CONFIG, FIXTURE_GAME_SEED, network);
  while (game.turn < BASELINE_TURN_COUNT && game.status === "playing") {
    const result = playItemTurn(game, {}, network);
    game = result.state.pending?.kind === "discard"
      ? resolveItemDiscard(result.state, result.state.pending.item.id).state
      : result.state;
  }
  if (game.turn !== BASELINE_TURN_COUNT || game.status !== "playing") {
    throw new Error("Fixture baseline did not reach the requested turn");
  }
  return game;
}

async function completeOneTurn(page: Page): Promise<void> {
  await diceButton(page).click();
  await expect(panelStat(page, "ターン数")).toHaveText("1");
  await expect(page.locator(".game-panel [role=status]")).not.toHaveText("");
}

async function expectAnnounced(page: Page): Promise<void> {
  await expect(gamePanel(page).locator('[role="status"]')).toHaveText(FIRST_TURN_NOTICE_TEXT);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), FIRST_TURN_NOTICE_KEY)).toBe("1");
}

async function observeStatusAnnouncements(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Observation = { text: string; turn: number };
    const observations: Observation[] = [];
    const record = () => {
      const status = document.querySelector<HTMLElement>(".game-panel [role=status]");
      const turn = Number(document.querySelector<HTMLElement>('[data-stat="turn"]')?.textContent);
      const text = status?.textContent?.trim() ?? "";
      if (!text || !Number.isInteger(turn)) return;
      const previous = observations.at(-1);
      if (previous?.text === text && previous.turn === turn) return;
      observations.push({ text, turn });
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    Object.assign(window, { __firstTurnNoticeObservations: observations, __firstTurnNoticeObserver: observer });
    record();
  });
}

async function readStatusAnnouncements(page: Page): Promise<Array<{ text: string; turn: number }>> {
  return page.evaluate(() => {
    const browserWindow = window as Window & {
      __firstTurnNoticeObservations?: Array<{ text: string; turn: number }>;
      __firstTurnNoticeObserver?: MutationObserver;
    };
    browserWindow.__firstTurnNoticeObserver?.disconnect();
    return browserWindow.__firstTurnNoticeObservations ?? [];
  });
}

async function measurePhoneHudBudget(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const stats = panel?.querySelector<HTMLElement>(".game-panel__stats");
    const actions = panel?.querySelector<HTMLElement>(".game-panel__actions");
    const inventory = panel?.querySelector<HTMLElement>(".item-inventory");
    if (!panel || !stats || !actions || !inventory) throw new Error("Phone HUD budget targets are missing");
    const style = (element: HTMLElement) => getComputedStyle(element);
    const verticalEdges = (element: HTMLElement, prefix: "margin" | "padding" | "border"): number => {
      const property = (edge: "top" | "bottom") => prefix === "border"
        ? `border-${edge}-width`
        : `${prefix}-${edge}`;
      const computed = style(element);
      return Number.parseFloat(computed.getPropertyValue(property("top")))
        + Number.parseFloat(computed.getPropertyValue(property("bottom")));
    };
    return verticalEdges(panel, "padding") + verticalEdges(panel, "border")
      + stats.getBoundingClientRect().height + verticalEdges(stats, "margin")
      + actions.getBoundingClientRect().height + verticalEdges(actions, "margin")
      + inventory.getBoundingClientRect().height + verticalEdges(inventory, "margin")
      + Number.parseFloat(style(panel).rowGap) * 2;
  });
}

async function expectPhoneNoticeToastClear(page: Page): Promise<void> {
  const toast = page.locator(".toast-host__toast", { hasText: FIRST_TURN_NOTICE_TEXT });
  await expect(toast).toBeVisible();
  const geometry = await page.evaluate((noticeText) => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const toastElement = [...document.querySelectorAll<HTMLElement>(".toast-host__toast")]
      .find((element) => element.textContent?.includes(noticeText));
    if (!panel || !toastElement) throw new Error("Phone notice toast or HUD panel is missing");
    const box = (element: Element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const toast = box(toastElement);
    const hud = box(panel);
    return {
      toast,
      hud,
      overlapsHud: toast.left < hud.right && toast.right > hud.left && toast.top < hud.bottom && toast.bottom > hud.top,
      withinViewport: toast.left >= 0 && toast.right <= document.documentElement.clientWidth,
      documentWidth: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
      bodyWidth: { client: document.body.clientWidth, scroll: document.body.scrollWidth },
    };
  }, FIRST_TURN_NOTICE_TEXT);
  expect(geometry.overlapsHud, JSON.stringify(geometry)).toBe(false);
  expect(geometry.withinViewport, JSON.stringify(geometry)).toBe(true);
  expect(geometry.documentWidth.scroll, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.documentWidth.client);
  expect(geometry.bodyWidth.scroll, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.bodyWidth.client);
}

async function captureNotice(page: Page, filename: string): Promise<void> {
  mkdirSync(NOTICE_SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(NOTICE_SCREENSHOT_DIRECTORY, filename), scale: "css" });
}

test("first completed save notices once across reload", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  await completeOneTurn(page);
  await expectAnnounced(page);
  await expect(gamePanel(page).locator('[role="status"]')).toHaveCount(1);
  await expect(page.locator(".toast-host")).toHaveAttribute("aria-hidden", "true");
  await captureNotice(page, "rgts-10b-notice-desktop.png");

  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(page.locator(".toast-host__text", { hasText: FIRST_TURN_NOTICE_TEXT })).toHaveCount(0);
  await expect(gamePanel(page).locator('[role="status"]')).not.toHaveText(FIRST_TURN_NOTICE_TEXT);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), FIRST_TURN_NOTICE_KEY)).toBe("1");
});

test("restored baseline waits for newly completed progress", async ({ page, railwayBundle }) => {
  await openTitle(page);
  const baseline = baselineGame(railwayBundle.network);
  await writeSaveText(page, serializeGame(baseline));
  await page.reload();
  await titleScreen(page).getByRole("button", { name: /^つづきから/ }).click();
  await expect(panelStat(page, "ターン数")).toHaveText(String(BASELINE_TURN_COUNT));
  await expect(page.locator(".toast-host__text", { hasText: FIRST_TURN_NOTICE_TEXT })).toHaveCount(0);
  await expect(gamePanel(page).locator('[role="status"]')).not.toHaveText(FIRST_TURN_NOTICE_TEXT);

  await diceButton(page).click();
  await expect(panelStat(page, "ターン数")).toHaveText(String(BASELINE_TURN_COUNT + 1));
  await expectAnnounced(page);
});

test("hidden tab delays the notice until visible", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await completeOneTurn(page);
  await expect(gamePanel(page).locator('[role="status"]')).not.toHaveText(FIRST_TURN_NOTICE_TEXT);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), FIRST_TURN_NOTICE_KEY)).toBeNull();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectAnnounced(page);
});

test("auto-roll releases the notice slot after its ordinary summary", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  await observeStatusAnnouncements(page);
  await autoRollToggle(page).click();
  await expect(gamePanel(page).locator('[role="status"]')).toHaveText("おまかせで進みます。");
  await expectAnnounced(page);
  const announcements = await readStatusAnnouncements(page);
  const ordinaryIndex = announcements.findIndex(({ text }) => text !== FIRST_TURN_NOTICE_TEXT && /\d+ターン目/.test(text));
  const noticeIndex = announcements.findIndex(({ text }) => text === FIRST_TURN_NOTICE_TEXT);
  expect(ordinaryIndex, JSON.stringify(announcements)).toBeGreaterThanOrEqual(0);
  expect(noticeIndex, JSON.stringify(announcements)).toBeGreaterThan(ordinaryIndex);
  const turnDifference = announcements[noticeIndex]!.turn - announcements[ordinaryIndex]!.turn;
  expect(turnDifference, JSON.stringify(announcements)).toBeGreaterThanOrEqual(0);
  expect(turnDifference, JSON.stringify(announcements)).toBeLessThanOrEqual(1);
});

test("first completed save notice fits at 320x568", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openTitle(page);
  await startNewGame(page);
  await completeOneTurn(page);
  await expectAnnounced(page);
  expect(await measurePhoneHudBudget(page)).toBe(PHONE_HUD_BUDGET_PX);
  await expectPhoneNoticeToastClear(page);
  await captureNotice(page, "rgts-10b-notice-320x568.png");
});
