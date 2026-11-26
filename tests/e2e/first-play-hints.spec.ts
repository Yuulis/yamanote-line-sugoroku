import type { Locator, Page } from "@playwright/test";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { createItemGame, serializeGame } from "../../src/features/game/engine";
import {
  GUIDE_HINTS_DISABLED_KEY,
  guideHintStorageKey,
} from "../../src/features/game/store/guide";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { ITEM_SCENARIOS } from "./fixtures/itemScenarios";
import { endpointKindAt } from "../../src/features/game/gameSummary";
import { isRollAdjustKind } from "../../src/features/game/itemRollAdjust";
import {
  diceReady,
  diceButton,
  diceMoment,
  freezeClock,
  gamePanel,
  inventoryItem,
  openGameMenu,
  openTitle,
  panelStat,
  readSave,
  revealUnadjustedRoll,
  rollOnce,
  SAVE_STORAGE_KEY,
  startNewGame,
  titleScreen,
  useInventoryItem,
  writeSaveText,
} from "./support/app";
import { seedGameSettings } from "./support/settings";
import { advanceTumble } from "./support/turnMoments";

const EXPECTED_COPY: Readonly<Record<string, RegExp>> = {
  lottery: /乗換駅で移動を終えると|移動を終えた駅で|次に乗る路線と進む向き/,
  "off-target": /以外の路線では、.+に近づく向きが抽選で出やすくなっています。/,
  item: /アイテムを手に入れました。使うタイミングは、持ち物の説明で確認できます。|持ち物がいっぱいのときは、持っているものと新しいものから、捨てるものを1つ選びます。/,
  "harmful-item": /不利なアイテムは持ち物には入らず|遅延証明書が、不利なアイテムを打ち消しました。/,
  terminus: /終点に着くと、出目が余っていてもそこで止まります。/,
};
const HINT_ORDER = ["lottery", "off-target", "item", "harmful-item", "terminus"] as const;
const EXPECTED_FIRST_HINTS = ["lottery", "terminus", "harmful-item", "off-target", "item"] as const;

test.use({
  dataset: "fixture",
  gameSeed: "00000000000000000000000000000005",
  firstPlayGuideSeen: false,
  firstTurnNoticeSeen: false,
  reducedMotion: "reduce",
});

function hintCard(page: Page) {
  return page.locator(".first-play-hint");
}

async function watchHintSeenWrites(page: Page, onlyKey?: string): Promise<void> {
  await page.evaluate((trackedKey) => {
    const trackedWindow = window as Window & { __guideHintWrites?: string[]; __guideOriginalSetItem?: typeof Storage.prototype.setItem };
    if (!trackedWindow.__guideOriginalSetItem) {
      trackedWindow.__guideOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string): void {
        if (key.includes(":guide:hint:") && (trackedKey === null || key === trackedKey)) {
          trackedWindow.__guideHintWrites?.push(key);
        }
        trackedWindow.__guideOriginalSetItem!.call(this, key, value);
      };
    }
    trackedWindow.__guideHintWrites = [];
  }, onlyKey ?? null);
}

async function hintSeenWriteCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as Window & { __guideHintWrites?: string[] }).__guideHintWrites?.length ?? 0);
}

interface StatusChange {
  readonly text: string;
  readonly pickupToastVisible: boolean;
}

type StatusObserverWindow = Window & { __hintStatusChanges?: StatusChange[] };
type SaveTurnObserverWindow = Window & { __hintSavedTurnAdvances?: number[] };

async function watchStatusChanges(page: Page): Promise<void> {
  await page.locator('.game-panel [role="status"]').evaluate((status) => {
    const changes: StatusChange[] = [];
    (window as StatusObserverWindow).__hintStatusChanges = changes;
    new MutationObserver((mutations) => {
      const pickupToastVisible = [...document.querySelectorAll(".toast-host__toast")]
        .some((toast) => toast.textContent?.includes("を手に入れた！"));
      // Old values and removed nodes capture text overwritten before this observer runs.
      for (const mutation of mutations) {
        if (mutation.oldValue !== null) changes.push({ text: mutation.oldValue, pickupToastVisible });
        for (const node of mutation.removedNodes) {
          changes.push({ text: node.textContent ?? "", pickupToastVisible });
        }
      }
      changes.push({ text: status.textContent ?? "", pickupToastVisible });
    }).observe(status, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  });
}

async function itemHintStatusChanges(page: Page): Promise<StatusChange[]> {
  const changes = await page.evaluate(() => (window as StatusObserverWindow).__hintStatusChanges ?? []);
  return changes.filter((change) => EXPECTED_COPY.item!.test(change.text));
}

async function isInsideHintScrollport(button: Locator): Promise<boolean> {
  return button.evaluate((element) => {
    const card = element.closest<HTMLElement>(".first-play-hint");
    if (!card) throw new Error("The button needs a hint card");
    const buttonRect = element.getBoundingClientRect();
    const top = card.getBoundingClientRect().top + card.clientTop;
    return buttonRect.top >= top && buttonRect.bottom <= top + card.clientHeight;
  });
}

async function expectHintNotAnnounced(page: Page, copy: string): Promise<void> {
  // The roll-adjustment dialog renders outside the panel and carries the turn status while it is open.
  const status = page.locator('.game-panel [role="status"], .item-adjustment [role="status"]');
  await expect(status).toHaveCount(1);
  await expect(status).not.toContainText(copy);
}

async function watchSavedTurnAdvances(page: Page, initialTurn: number): Promise<void> {
  await page.evaluate(({ saveKey, initialTurn }) => {
    const observedWindow = window as SaveTurnObserverWindow;
    const previousSetItem = Storage.prototype.setItem;
    observedWindow.__hintSavedTurnAdvances = [];
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (key === saveKey) {
        const savedGame = JSON.parse(value) as { turn?: unknown };
        if (typeof savedGame.turn === "number" && savedGame.turn > initialTurn) {
          const advances = observedWindow.__hintSavedTurnAdvances!;
          if (advances.at(-1) !== savedGame.turn) advances.push(savedGame.turn);
        }
      }
      previousSetItem.call(this, key, value);
    };
  }, { saveKey: SAVE_STORAGE_KEY, initialTurn });
}

async function savedTurnAdvances(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as SaveTurnObserverWindow).__hintSavedTurnAdvances ?? []);
}

async function expectTerminusHintOnSameSeed(page: Page): Promise<void> {
  await startEligibleGame(page);
  await firstHint(page);

  for (let turn = 0; turn < 100; turn += 1) {
    const card = hintCard(page);
    if (await card.count()) {
      await expect(card).toBeVisible();
      const key = await card.getAttribute("data-guide-candidate-key");
      if (!key) throw new Error("The visible control-run hint needs a candidate key");
      if (key.endsWith(":terminus")) {
        await expect(card).toContainText(EXPECTED_COPY.terminus!);
        return;
      }

      await card.getByRole("button", { name: "閉じる", exact: true }).click();
      await expect.poll(async () => {
        if (await card.count() === 0) return true;
        return (await card.getAttribute("data-guide-candidate-key")) !== key;
      }).toBe(true);
      continue;
    }

    if (await page.getByRole("heading", { name: "クリア！" }).count()) break;
    await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
    await rollOnce(page);
  }

  throw new Error("The terminus hint did not become visible in the same-seed control run");
}

interface HintSnapshot {
  readonly key: string;
  readonly copy: string;
}

async function visibleHintSnapshot(page: Page): Promise<HintSnapshot> {
  const card = hintCard(page);
  await expect(card).toBeVisible();
  const key = await card.getAttribute("data-guide-candidate-key");
  const copy = await card.locator(".first-play-hint__copy").textContent();
  if (!key || !copy) throw new Error("A visible first-play hint needs its candidate key and copy");
  return { key, copy };
}

async function expectHintRestored(page: Page, snapshot: HintSnapshot): Promise<void> {
  await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
  await expect(hintCard(page)).toBeVisible();
  await expect(hintCard(page)).toHaveAttribute("data-guide-candidate-key", snapshot.key);
  await expectHintNotAnnounced(page, snapshot.copy);
  expect(await hintSeenWriteCount(page)).toBe(0);
}

async function playUntilUsableTicket(page: Page): Promise<string> {
  for (let turn = 0; turn < 70; turn += 1) {
    const saved = await readSave(page);
    for (const item of saved?.inventory ?? []) {
      if (item.kind !== "route-ticket" && item.kind !== "direction-ticket") continue;
      const name = item.kind === "route-ticket" ? "路線指定券" : "方向指定券";
      const slot = inventoryItem(page, name);
      await slot.getByRole("button").click();
      const card = gamePanel(page).getByRole("dialog", { name, exact: true });
      await expect(card).toBeVisible();
      const usable = await card.getByRole("button", { name: "使う", exact: true }).isEnabled();
      await card.getByRole("button", { name: "閉じる", exact: true }).click();
      if (usable) return name;
    }
    if (saved?.status === "completed") break;
    await rollOnce(page);
  }
  throw new Error("No usable route or direction ticket appeared before the game cleared");
}

async function playUntilDiscardDecision(page: Page): Promise<void> {
  for (let turn = 0; turn < 70; turn += 1) {
    const turnBefore = (await readSave(page))?.turn ?? 0;
    await revealUnadjustedRoll(page);
    await expect.poll(async () => {
      const saved = await readSave(page);
      return saved?.pending?.kind === "discard" || saved?.turn === turnBefore + 1;
    }).toBe(true);
    const saved = await readSave(page);
    if (saved?.pending?.kind === "discard") {
      await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
      return;
    }
    if (saved?.status === "completed") break;
    await expect(diceReady(page)).toBeVisible();
  }
  throw new Error("No discard decision appeared before the game cleared");
}

async function measuredHudContentHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const stats = panel?.querySelector<HTMLElement>(".game-panel__stats");
    const actions = panel?.querySelector<HTMLElement>(".game-panel__actions");
    const inventory = panel?.querySelector<HTMLElement>(".item-inventory");
    if (!panel || !stats || !actions || !inventory) throw new Error("Phone HUD measurement targets are missing");
    const vertical = (element: HTMLElement, prefix: "margin" | "padding" | "border"): number => {
      const style = getComputedStyle(element);
      const property = (edge: "top" | "bottom") => prefix === "border" ? `border-${edge}-width` : `${prefix}-${edge}`;
      return Number.parseFloat(style.getPropertyValue(property("top")))
        + Number.parseFloat(style.getPropertyValue(property("bottom")));
    };
    const panelStyle = getComputedStyle(panel);
    return vertical(panel, "padding") + vertical(panel, "border")
      + stats.getBoundingClientRect().height + vertical(stats, "margin")
      + actions.getBoundingClientRect().height + vertical(actions, "margin")
      + inventory.getBoundingClientRect().height + vertical(inventory, "margin")
      + Number.parseFloat(panelStyle.rowGap) * 2;
  });
}

async function startEligibleGame(page: Page): Promise<void> {
  await openTitle(page);
  await startNewGame(page);
  const coach = page.getByRole("dialog", { name: "最初のガイド" });
  await expect(coach).toBeVisible();
  await coach.getByRole("button", { name: "とばす", exact: true }).click();
  await expect(coach).toHaveCount(0);
  await expect(diceButton(page)).toBeFocused();
  await expect(hintCard(page)).toHaveCount(0);
}

async function firstHint(page: Page, maxTurns = 60): Promise<{ key: string; id: string }> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (await hintCard(page).count()) {
      const card = hintCard(page);
      await expect(card).toBeVisible();
      const key = await card.getAttribute("data-guide-candidate-key");
      if (!key) throw new Error("The visible hint card needs a candidate key");
      return { key, id: key.split(":").at(-1) ?? "" };
    }
    if (await page.getByRole("heading", { name: "クリア！" }).count()) break;
    await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
    if (await hintCard(page).count()) continue;
    await rollOnce(page);
  }
  throw new Error("No first-play hint appeared before the search limit or game clear");
}

async function rollUntilFirstHint(page: Page, maxTurns = 20): Promise<{ moments: number; skips: number }> {
  let moments = 0;
  let skips = 0;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (await hintCard(page).count()) return { moments, skips };
    await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
    if (await hintCard(page).count()) return { moments, skips };
    const before = (await readSave(page))?.turn ?? 0;
    await diceReady(page).click();
    const moment = page.locator(".turn-moment-host__card");
    await expect.poll(async () => await moment.isVisible() || await diceReady(page).isVisible()).toBe(true);
    if (await moment.isVisible()) {
      moments += 1;
      await expect(hintCard(page)).toHaveCount(0);
      await gamePanel(page).getByRole("button", { name: "演出をスキップ", exact: true }).click();
      skips += 1;
    }
    await expect.poll(async () => (await readSave(page))?.turn).toBe(before + 1);
    await expect(diceReady(page).or(page.getByRole("heading", { name: "クリア！" }))).toBeVisible();
  }
  throw new Error("No first-play hint appeared before the presentation-path search limit");
}

async function installClickCounter(button: Locator): Promise<void> {
  await button.evaluate((element) => {
    const counterWindow = window as Window & { __hintActionClicks?: number };
    counterWindow.__hintActionClicks = 0;
    element.addEventListener("click", () => { counterWindow.__hintActionClicks = (counterWindow.__hintActionClicks ?? 0) + 1; });
  });
}

async function hintActionCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as Window & { __hintActionClicks?: number }).__hintActionClicks ?? 0);
}

async function writeExistingSave(page: Page, railwayBundle: RailwayBundle): Promise<void> {
  const save = createItemGame(DEFAULT_GAME_CONFIG, "first-play-hints-existing-save", railwayBundle.network);
  await writeSaveText(page, serializeGame(save));
}

test("@layout first eligible published hint opens its rules section and restores 詳しく focus", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await startEligibleGame(page);
  // Larger text makes the hint's actions scroll out of view in the short viewport.
  await page.addStyleTag({ content: ".first-play-hint__copy { font-size: 2rem !important; }" });
  const first = await firstHint(page);
  const card = hintCard(page);
  await expect(card).toContainText(EXPECTED_COPY[first.id] ?? /.+/);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey(first.id as typeof HINT_ORDER[number])))
    .toBe("1");

  const details = card.getByRole("button", { name: "詳しく", exact: true });
  expect(await isInsideHintScrollport(details)).toBe(false);
  await card.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await isInsideHintScrollport(details)).toBe(true);
  await details.click();
  const rules = page.getByRole("dialog", { name: "遊び方" });
  await expect(rules).toBeVisible();
  await expect(rules.locator(`.rules-guide__section[id$="-${first.id === "off-target" ? "lottery" : first.id === "harmful-item" || first.id === "item" ? "items" : first.id === "terminus" ? "goal" : "lottery"}"]`)).toBeVisible();
  await expect(card).toHaveCount(0);
  await rules.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(card).toBeVisible();
  const restoredDetails = card.getByRole("button", { name: "詳しく", exact: true });
  await expect(restoredDetails).toBeFocused();
  expect(await isInsideHintScrollport(restoredDetails)).toBe(true);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey(first.id as typeof HINT_ORDER[number])))
    .toBe("1");
});

test("closing advances one card, and disabling hints persists across reload and resume", async ({ page }) => {
  await startEligibleGame(page);
  await firstHint(page);
  const current = hintCard(page);
  const firstKey = await current.getAttribute("data-guide-candidate-key");
  await current.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(current).toHaveCount(0);

  // A queued same-turn candidate advances immediately; otherwise the next published event supplies the next one.
  const second = await firstHint(page);
  expect(second.key).not.toBe(firstKey);
  const secondId = second.id;
  const disabled = hintCard(page).getByRole("button", { name: "もう表示しない", exact: true });
  await disabled.click();
  await expect(hintCard(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), GUIDE_HINTS_DISABLED_KEY)).toBe("1");

  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
  await expect(hintCard(page)).toHaveCount(0);
  await rollOnce(page);
  await expect(hintCard(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey(secondId as typeof HINT_ORDER[number])))
    .toBe("1");
});

for (const level of [
  { id: "all", label: "すべて" },
  { id: "important", label: "重要なときだけ" },
  { id: "none", label: "なし" },
] as const) {
  test(`first-play hints publish with the ${level.label} presentation level`, async ({ page }) => {
    await seedGameSettings(page, { speedId: "normal", follow: true, presentationLevel: level.id });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await startEligibleGame(page);

    await openGameMenu(page);
    const presentation = gamePanel(page).getByRole("button", { name: /^演出:/ });
    await expect(presentation).toHaveText(`演出: ${level.label}`);
    await gamePanel(page).getByRole("button", { name: "メニュー", exact: true }).click();

    const path = await rollUntilFirstHint(page);
    await expect(hintCard(page)).toBeVisible();
    await expect(hintCard(page)).toContainText(EXPECTED_COPY.lottery!);
    if (level.id === "all") {
      expect(path.moments).toBeGreaterThan(0);
      expect(path.skips).toBeGreaterThan(0);
    }
    if (level.id === "none") expect(path.moments).toBe(0);
  });
}

test("OS reduced motion still publishes hints and allows the coach skip", async ({ page }) => {
  await seedGameSettings(page, { speedId: "normal", follow: true, presentationLevel: "all" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startEligibleGame(page);
  await expect(hintCard(page)).toHaveCount(0);
  const path = await rollUntilFirstHint(page);
  await expect(hintCard(page)).toContainText(EXPECTED_COPY.lottery!);
  expect(path.moments).toBe(0);
  expect(path.skips).toBe(0);
});

test("resuming a save from an eligible guide session does not restore its hints", async ({ page }) => {
  await startEligibleGame(page);
  const first = await firstHint(page);
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
  await expect(hintCard(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey(first.id as typeof HINT_ORDER[number])))
    .toBe("1");
});

for (const action of [
  { name: "閉じる", kind: "close" },
  { name: "詳しく", kind: "details" },
  { name: "もう表示しない", kind: "disable" },
] as const) {
  for (const key of ["Space", "Enter"] as const) {
    test(`${key} activates the focused ${action.name} action exactly once`, async ({ page }) => {
      await startEligibleGame(page);
      const first = await firstHint(page);
      const button = hintCard(page).getByRole("button", { name: action.name, exact: true });
      await installClickCounter(button);
      await button.focus();
      await page.keyboard.press(key);
      await expect.poll(() => hintActionCount(page)).toBe(1);

      if (action.kind === "close") {
        if (await hintCard(page).count()) {
          const currentKey = await hintCard(page).getAttribute("data-guide-candidate-key");
          expect(currentKey).not.toBe(first.key);
        }
      } else if (action.kind === "details") {
        await expect(page.getByRole("dialog", { name: "遊び方" })).toBeVisible();
        await expect(hintCard(page)).toHaveCount(0);
      } else {
        await expect(hintCard(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), GUIDE_HINTS_DISABLED_KEY)).toBe("1");
      }
    });
  }
}

test("existing players receive no first-play hints", async ({ page, railwayBundle }) => {
  await openTitle(page);
  await writeExistingSave(page, railwayBundle);
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  await startNewGame(page);
  await expect(page.locator(".first-play-coach")).toHaveCount(0);
  for (let turn = 0; turn < 8; turn += 1) {
    await rollOnce(page);
    await expect(hintCard(page)).toHaveCount(0);
  }
  expect((await readSave(page))?.turn).toBe(8);
});

test("first-play candidates display in fixed order and only after their publication boundary", async ({ page }) => {
  test.setTimeout(120_000);
  await startEligibleGame(page);
  const shown: string[] = [];

  for (let turn = 0; turn < 100 && shown.length < EXPECTED_FIRST_HINTS.length; turn += 1) {
    if (await hintCard(page).count()) {
      const card = hintCard(page);
      const candidateKey = await card.getAttribute("data-guide-candidate-key");
      if (!candidateKey) throw new Error("The visible hint card needs a candidate key");
      const id = candidateKey.split(":").at(-1) ?? "";
      shown.push(id);
      await expect(card).toContainText(EXPECTED_COPY[id] ?? /.+/);
      await card.getByRole("button", { name: "閉じる", exact: true }).click();
      continue;
    }
    if (await page.getByRole("heading", { name: "クリア！" }).count()) break;
    await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
    if (await hintCard(page).count()) continue;
    await rollOnce(page);
  }

  expect(shown).toEqual(EXPECTED_FIRST_HINTS);
});

test("an item hint stays unpublished throughout the pickup moment", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await startEligibleGame(page);

  for (let turn = 0; turn < 30; turn += 1) {
    if (await hintCard(page).count()) await hintCard(page).getByRole("button", { name: "閉じる", exact: true }).click();
    const before = (await readSave(page))?.turn ?? 0;
    await revealUnadjustedRoll(page);
    const saved = await readSave(page);
    const record = saved?.movementHistory.at(-1);
    if (!record) throw new Error("Expected the accepted turn to include its item record");
    const hasPickup = "itemEvents" in record && record.itemEvents.some((event) =>
      event.type === "pickup-retained" || event.type === "pickup-pending-discard");

    if (hasPickup) {
      const pickup = page.locator('.turn-moment-host [data-stage="pickup"]');
      await expect(pickup).toBeVisible();
      await expect(hintCard(page)).toHaveCount(0);
      await expect(pickup).toHaveCount(0);
      for (let candidateIndex = 0; candidateIndex < 5; candidateIndex += 1) {
        const current = hintCard(page);
        await expect(current).toBeVisible();
        const key = await current.getAttribute("data-guide-candidate-key");
        if (key?.endsWith(":item")) {
          await expect(current).toContainText(EXPECTED_COPY.item!);
          return;
        }
        await current.getByRole("button", { name: "閉じる", exact: true }).click();
      }
      throw new Error("The item hint was not queued after pickup settled");
    }

    if (saved?.status === "completed") break;
    const skip = gamePanel(page).locator(".game-panel__skip");
    if (await skip.isVisible() && await skip.isEnabled()) await skip.click();
    await expect(diceReady(page).or(page.getByRole("heading", { name: "クリア！" }))).toBeVisible();
    if ((await readSave(page))?.turn === before) {
      throw new Error("The turn did not settle after the skip action");
    }
  }
  throw new Error("No pickup occurred within the seed's first 30 turns");
});

test("an item pickup toast delays the overlapping item hint and its seen write", async ({ page }) => {
  test.setTimeout(120_000);
  await startEligibleGame(page);
  await watchStatusChanges(page);

  for (let turn = 0; turn < 35; turn += 1) {
    while (await hintCard(page).count()) {
      await hintCard(page).getByRole("button", { name: "閉じる", exact: true }).click();
    }
    const turnBefore = (await readSave(page))?.turn ?? 0;
    await revealUnadjustedRoll(page);
    await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
    const saved = await readSave(page);
    const record = saved?.movementHistory.at(-1);
    if (!record || !("itemEvents" in record)) continue;
    const pickup = record.itemEvents.find((event) => event.type === "pickup-retained" || event.type === "pickup-pending-discard");
    if (!pickup) continue;

    const itemToast = page.locator(".toast-host__toast").filter({ hasText: /を手に入れた！/ });
    await expect(itemToast).toBeVisible();
    expect(await itemHintStatusChanges(page)).toEqual([]);
    const itemHintKey = guideHintStorageKey("item");
    await expect(hintCard(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), itemHintKey)).toBeNull();
    await watchHintSeenWrites(page, itemHintKey);
    await expect(itemToast).toHaveCount(0, { timeout: 10_000 });

    for (let candidateIndex = 0; candidateIndex < 5; candidateIndex += 1) {
      const card = hintCard(page);
      await expect(card).toBeVisible();
      const key = await card.getAttribute("data-guide-candidate-key");
      if (key?.endsWith(":item")) {
        await expect(card).toContainText(EXPECTED_COPY.item!);
        await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), itemHintKey)).toBe("1");
        expect(await hintSeenWriteCount(page)).toBe(1);
        const statusChanges = await itemHintStatusChanges(page);
        expect(statusChanges.filter((change) => change.pickupToastVisible)).toEqual([]);
        expect(statusChanges.some((change) => !change.pickupToastVisible)).toBe(true);
        return;
      }
      await card.getByRole("button", { name: "閉じる", exact: true }).click();
    }
    throw new Error("The item hint was not presented after its pickup toast expired");
  }
  throw new Error("No pickup with an item toast occurred within the seed's first 35 turns");
});

test("a sticky save failure holds the first hint until a successful save", async ({ page }) => {
  await startEligibleGame(page);
  await page.evaluate((saveKey) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value): void {
      if (key === saveKey) throw new Error("quota");
      setItem.call(this, key, value);
    };
    window.addEventListener("guide-test-restore-save", () => { Storage.prototype.setItem = setItem; }, { once: true });
  }, SAVE_STORAGE_KEY);

  const stickyToast = page.locator(".toast-host__toast--sticky");
  const status = page.locator('.game-panel [role="status"]');
  const lotteryKey = guideHintStorageKey("lottery");
  for (const turn of [1, 2, 3]) {
    await diceReady(page).click();
    await expect(panelStat(page, "ターン数")).toHaveText(String(turn));
    await expect(diceReady(page)).toBeVisible();
    await expect(stickyToast).toHaveText("保存に失敗しました");
    await expect(hintCard(page)).toHaveCount(0);
    await expect(status).not.toContainText(EXPECTED_COPY.lottery!);
    expect(await page.evaluate((key) => localStorage.getItem(key), lotteryKey)).toBeNull();
  }

  await page.evaluate(() => { window.dispatchEvent(new Event("guide-test-restore-save")); });
  await diceReady(page).click();
  await expect(panelStat(page, "ターン数")).toHaveText("4");
  await expect(stickyToast).toHaveCount(0);
  await expect(hintCard(page)).toHaveAttribute("data-guide-candidate-key", /^\d+:2:lottery$/);
  await expect(hintCard(page)).toContainText(EXPECTED_COPY.lottery!);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), lotteryKey)).toBe("1");
});

test("ClearScreen discards queued hints without marking them seen", async ({ page, railwayBundle }) => {
  test.setTimeout(180_000);
  await expectTerminusHintOnSameSeed(page);
  // Clearing storage and reloading reapplies the fixture seed before the real queued-hint run.
  await page.evaluate(() => localStorage.clear());
  await openTitle(page);
  await startEligibleGame(page);
  const first = await firstHint(page);
  expect(first.id).toBe("lottery");
  const card = hintCard(page);
  const currentKey = first.key;
  const visibleHintTurn = (await readSave(page))?.turn;
  expect(visibleHintTurn).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "クリア！" })).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(card).toContainText(EXPECTED_COPY.lottery!);

  for (let turn = (await readSave(page))?.turn ?? 0; turn < 8; turn += 1) {
    await rollOnce(page);
    if (await page.getByRole("heading", { name: "クリア！" }).count()) break;
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-guide-candidate-key", currentKey);
  }

  for (let turn = (await readSave(page))?.turn ?? 0; turn < 100; turn += 1) {
    if (await page.getByRole("heading", { name: "クリア！" }).count()) break;
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-guide-candidate-key", currentKey);
    await rollOnce(page);
  }

  await expect(page.getByRole("heading", { name: "クリア！" })).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey("lottery"))).toBe("1");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey("terminus"))).toBeNull();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey("harmful-item"))).toBeNull();
  const clearedGame = await readSave(page);
  const queuedTerminusEvidence = clearedGame?.movementHistory.find((record) =>
    record.kind === "item-ride" && record.stopReason === "endpoint" && record.unusedPips > 0
      && endpointKindAt(railwayBundle.network, record.resolvedRide.serviceId, record.toStationId) === "terminus");
  expect(queuedTerminusEvidence, "an eligible terminus event was queued behind the visible lottery hint before ClearScreen")
    .toBeDefined();
});

test.describe("adjustment decision overlays a visible hint", () => {
  test.use({ gameSeed: ITEM_SCENARIOS.adjust.seed });

  test("hint details keeps rules above the next turn's pending adjustment", async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await startEligibleGame(page);
    await firstHint(page);

    for (let turn = (await readSave(page))?.turn ?? 0; turn < 8; turn += 1) await rollOnce(page);
    expect((await readSave(page))?.inventory.some((item) => isRollAdjustKind(item.kind))).toBe(true);

    // Drain queued toasts before freezing the clock: a toast that takes a slot after the freeze never
    // finishes its reading time, so the hint it withholds would never return.
    await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
    await freezeClock(page);
    const card = hintCard(page);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "詳しく", exact: true }).click();
    const rules = page.getByRole("dialog", { name: "遊び方" });
    await expect(rules).toBeVisible();
    await expect(card).toHaveCount(0);

    // The rules modal owns input. Dispatch the already-authorized same-session roll directly to exercise
    // the integration race in which a saved decision arrives while Details still owns the screen.
    await diceButton(page).evaluate((button) => (button as HTMLButtonElement).click());
    await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");

    await advanceTumble(page);
    await expect.poll(async () => (await readSave(page))?.pending?.kind).toBe("roll");
    await expect(rules).toBeVisible();
    await expect(page.getByRole("dialog", { name: "出目を調整しますか？" })).toHaveCount(0);

    await rules.getByRole("button", { name: "閉じる", exact: true }).click();
    const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(adjustment).toBeVisible();
    await expect(adjustment.getByRole("heading", { name: "出目を調整しますか？" })).toBeFocused();
  });

  test("Escape continues once and restores the current hint without another announcement or seen write", async ({ page }) => {
    test.setTimeout(90_000);
    await startEligibleGame(page);
    const first = await firstHint(page);
    const snapshot = await visibleHintSnapshot(page);
    await watchHintSeenWrites(page);
    const card = hintCard(page);

    for (let turn = (await readSave(page))?.turn ?? 0; turn < 8; turn += 1) await rollOnce(page);
    // Back-to-back rolls leave milestone and delay toasts queued two at a time; the hint stays withheld
    // until the last of them has been read (here up to 8 s), which can outlast the default expect timeout.
    await expect(page.locator(".toast-host__toast:not(.toast-host__toast--sticky)")).toHaveCount(0, { timeout: 20_000 });
    await expect(card).toBeVisible();
    const saved = await readSave(page);
    expect(saved?.inventory.some((item) => isRollAdjustKind(item.kind))).toBe(true);

    const turnBefore = saved?.turn ?? 0;
    await diceButton(page).click();
    const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(adjustment).toBeVisible();
    await expect(card).toHaveCount(0);
    await expectHintNotAnnounced(page, snapshot.copy);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey(first.id as typeof HINT_ORDER[number])))
      .toBe("1");

    await watchSavedTurnAdvances(page, turnBefore);
    await page.keyboard.press("Escape");
    await expect.poll(() => savedTurnAdvances(page)).toEqual([turnBefore + 1]);
    await expect(diceReady(page).or(page.getByRole("heading", { name: "クリア！" }))).toBeVisible();
    await expect(adjustment).toHaveCount(0);
    expect(await savedTurnAdvances(page)).toEqual([turnBefore + 1]);
    await expectHintRestored(page, snapshot);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), guideHintStorageKey(first.id as typeof HINT_ORDER[number])))
      .toBe("1");
    expect((await readSave(page))?.turn).toBe(turnBefore + 1);
  });
});

test.describe("discard decision overlays a visible hint", () => {
  test.use({ gameSeed: ITEM_SCENARIOS.discard.seed });

  test("withdraws and restores the same hint without status or duplicate seen writes", async ({ page }) => {
    test.setTimeout(120_000);
    await startEligibleGame(page);
    await firstHint(page);
    const snapshot = await visibleHintSnapshot(page);
    await watchHintSeenWrites(page);
    await playUntilDiscardDecision(page);

    await expect(hintCard(page)).toHaveCount(0);
    await expectHintNotAnnounced(page, snapshot.copy);
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await discard.getByRole("button").last().click();
    await expect(diceReady(page).or(page.getByRole("heading", { name: "クリア！" }))).toBeVisible();
    await expectHintRestored(page, snapshot);
  });
});

test.describe("item-use dialog overlays a visible hint", () => {
  test.use({ gameSeed: ITEM_SCENARIOS.route.seed });

  test("withdraws and restores the same hint without status or duplicate seen writes", async ({ page }) => {
    test.setTimeout(120_000);
    await startEligibleGame(page);
    await firstHint(page);
    const snapshot = await visibleHintSnapshot(page);
    await watchHintSeenWrites(page);
    const ticketName = await playUntilUsableTicket(page);
    await useInventoryItem(page, ticketName);
    const itemDialog = page.getByRole("dialog", { name: ticketName === "路線指定券" ? "乗る路線を選ぶ" : "進む向きを選ぶ" });
    await expect(itemDialog).toBeVisible();
    await expect(hintCard(page)).toHaveCount(0);
    await expectHintNotAnnounced(page, snapshot.copy);

    await itemDialog.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expectHintRestored(page, snapshot);
  });
});

test("a new-game confirmation withdraws and restores the same hint without status or duplicate seen writes", async ({ page }) => {
  await startEligibleGame(page);
  await firstHint(page);
  const snapshot = await visibleHintSnapshot(page);
  await watchHintSeenWrites(page);
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "新規", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
  await expect(confirmation).toBeVisible();
  await expect(hintCard(page)).toHaveCount(0);
  await expectHintNotAnnounced(page, snapshot.copy);

  await confirmation.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expectHintRestored(page, snapshot);
});

test("a hidden tab withdraws and restores the same hint without status or duplicate seen writes", async ({ page }) => {
  await startEligibleGame(page);
  await firstHint(page);
  const snapshot = await visibleHintSnapshot(page);
  await watchHintSeenWrites(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(hintCard(page)).toHaveCount(0);
  await expectHintNotAnnounced(page, snapshot.copy);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectHintRestored(page, snapshot);
});

test("coach replay over a visible hint restores the same candidate without status or duplicate seen writes", async ({ page }) => {
  await startEligibleGame(page);
  await firstHint(page);
  const snapshot = await visibleHintSnapshot(page);
  await watchHintSeenWrites(page);
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "遊び方", exact: true }).click();
  const rules = page.getByRole("dialog", { name: "遊び方" });
  await expect(rules).toBeVisible();
  await rules.getByRole("button", { name: "最初のガイドをもう一度見る", exact: true }).click();
  const coach = page.getByRole("dialog", { name: "最初のガイド" });
  await expect(coach).toBeVisible();
  await expect(hintCard(page)).toHaveCount(0);
  await expectHintNotAnnounced(page, snapshot.copy);

  await coach.getByRole("button", { name: "とばす", exact: true }).click();
  await expectHintRestored(page, snapshot);
});

for (const viewport of [
  { width: 320, height: 568, expandAttribution: true },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 601, height: 501 },
]) {
  test(`@layout first-play hint stays in the free map area at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await startEligibleGame(page);
    if (viewport.expandAttribution) {
      const attribution = page.locator(".maplibregl-ctrl-attrib");
      const attributionToggle = attribution.locator(".maplibregl-ctrl-attrib-button");
      await expect(attributionToggle).toBeVisible();
      await attributionToggle.click();
      await expect(attribution).toHaveClass(/maplibregl-compact-show/);
    }
    await firstHint(page);
    // #66 uses the pill on phone, a compact line in short landscape, and the full result otherwise.
    const resultSelector = viewport.width <= 600
      ? ".turn-result__pill"
      : viewport.height <= 500 ? ".turn-result__compact" : ".turn-result";
    const expectedObstacles = [
      ".game-panel",
      resultSelector,
      ".map-overview",
      ".maplibregl-ctrl-top-right .maplibregl-ctrl-group",
      ".maplibregl-ctrl-attrib",
    ];
    for (const selector of expectedObstacles) {
      await expect.poll(async () => page.locator(selector).evaluateAll((elements) => elements.filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 && box.width > 0 && box.height > 0
          && style.visibility !== "hidden" && style.display !== "none";
      }).length), `${selector} must be visible with a positive-area rectangle at ${viewport.width}x${viewport.height}`)
        .toBeGreaterThan(0);
    }
    const layout = await page.evaluate(() => {
      const rect = (selector: string): { left: number; top: number; right: number; bottom: number } | null => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      };
      const rects = (selector: string): { left: number; top: number; right: number; bottom: number }[] =>
        [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        });
      const overlap = (first: NonNullable<ReturnType<typeof rect>>, second: NonNullable<ReturnType<typeof rect>>): boolean =>
        first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
      const card = rect(".first-play-hint");
      if (!card) throw new Error("Expected a visible first-play hint");
      const cardElement = document.querySelector<HTMLElement>(".first-play-hint");
      if (!cardElement) throw new Error("Expected the hint card element");
      const buttons = [...cardElement.querySelectorAll<HTMLElement>("button")];
      const actionsReachable = buttons.every((button) => {
        button.scrollIntoView({ block: "nearest", inline: "nearest" });
        const box = button.getBoundingClientRect();
        const cardBox = cardElement.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
          && box.left >= cardBox.left && box.right <= cardBox.right
          && box.top >= cardBox.top && box.bottom <= cardBox.bottom;
      });
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        card,
        occupied: [".game-panel", ".turn-result__pill", ".map-overview", ".maplibregl-ctrl"]
          .map((selector) => ({ selector, rects: rects(selector) })),
        overlapsOccupied: [".game-panel", ".turn-result__pill", ".map-overview", ".maplibregl-ctrl", ".turn-moment-host__card"]
          .flatMap((selector) => rects(selector).filter((box) => overlap(card, box)).map(() => selector)),
        actionsReachable,
      };
    });

    expect(layout.card.left).toBeGreaterThanOrEqual(0);
    expect(layout.card.top).toBeGreaterThanOrEqual(0);
    expect(layout.card.right).toBeLessThanOrEqual(layout.width);
    expect(layout.card.bottom).toBeLessThanOrEqual(layout.height);
    expect(layout.overlapsOccupied, JSON.stringify(layout)).toEqual([]);
    expect(layout.actionsReachable).toBe(true);
    if (viewport.width === 320) {
      await expect(panelStat(page, "ターン数")).toBeVisible();
      const hudHeight = await measuredHudContentHeight(page);
      expect(hudHeight).toBeLessThanOrEqual(252);
    }

    const visibleKey = await hintCard(page).getAttribute("data-guide-candidate-key");
    expect(visibleKey).not.toBeNull();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await diceReady(page).click();
    const momentCard = page.locator(".turn-moment-host__card");
    await expect(momentCard).toBeVisible();
    await expect(hintCard(page)).toHaveCount(0);
    await gamePanel(page).getByRole("button", { name: "演出をスキップ", exact: true }).click();
    await expect(diceReady(page).or(page.getByRole("heading", { name: "クリア！" }))).toBeVisible();
    await expect(hintCard(page)).toHaveAttribute("data-guide-candidate-key", visibleKey!);
    const restoredCard = await hintCard(page).boundingBox();
    if (!restoredCard) throw new Error("Expected the hint to restore after the turn-moment host left");
    const overlapsAfterRestore = await page.evaluate((card) => {
      const selectors = [".game-panel", ".turn-result__pill", ".map-overview", ".maplibregl-ctrl"];
      return selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => element.getClientRects().length > 0)
        .filter((element) => {
          const obstacle = element.getBoundingClientRect();
          return card.x < obstacle.right && card.x + card.width > obstacle.left
            && card.y < obstacle.bottom && card.y + card.height > obstacle.top;
        })
        .map(() => selector));
    }, restoredCard);
    expect(overlapsAfterRestore, `${viewport.width}x${viewport.height}: restored hint overlaps a HUD or map control`).toEqual([]);
  });
}
