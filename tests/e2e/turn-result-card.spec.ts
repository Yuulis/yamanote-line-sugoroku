import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { itemLastMove } from "../../src/features/game/itemSession";
import { deriveTurnResult, replayTurnResultHistory } from "../../src/features/game/turnResultCard";
import { serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { expect, test } from "./fixtures";
import type { Page, Locator } from "@playwright/test";
import type { RailwayBundle } from "./fixtures/bundle";
import { itemScenario } from "./fixtures/itemScenarios";
import { diceReady, gamePanel, hudCompactRoll, panelStat, readSave, writeSaveText } from "./support/app";

const MAX_SHORT_LANDSCAPE_ROW_HEIGHT_PX = 22;
const ELLIPSIS_PROBE_WIDTH_PX = 160;
const LONG_STATION_NAME = "羽田空港第1・第2ターミナル".repeat(3);

type PreparedR1 = {
  readonly panel: Locator;
  readonly record: ReturnType<typeof itemScenario>["movementHistory"][number];
  readonly expected: NonNullable<ReturnType<typeof deriveTurnResult>>;
  readonly predicates: {
    readonly turn: number;
    readonly newTargetSegmentCount: number;
    readonly chipLabels: string[];
    readonly rideText: string | null;
  };
  readonly diagnostic: string;
};

async function prepareR1(page: Page, railwayBundle: RailwayBundle): Promise<PreparedR1> {
  const recipe = itemScenario("route", railwayBundle.network);
  await page.goto("/");
  await writeSaveText(page, serializeGame(recipe));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  const panel = gamePanel(page);
  await expect(panel).toBeVisible();
  await expect(diceReady(page)).toBeVisible();
  const restoredState = await readSave(page);
  if (!restoredState) throw new Error("R1 save was not available after restore");
  const record = restoredState.movementHistory.at(-1);
  if (!record) throw new Error("R1 restored state has no completed record");
  const presentation = createPresentationResolver(railwayBundle.network,
    railwayBundle.data.manifest.ok ? railwayBundle.data.manifest.value.uiPresentation : undefined);
  const move = itemLastMove(record, railwayBundle.network);
  if (!move) throw new Error("R1 completed record did not resolve to a move");
  const targetIds = targetSegmentIds(restoredState.config, railwayBundle.network);
  const facts = replayTurnResultHistory(restoredState.movementHistory, record.turn, targetIds,
    restoredState.config.targetServiceId, presentation);
  const expected = deriveTurnResult({
    sessionId: 1, turn: record.turn, move, records: restoredState.movementHistory,
    targetSegmentIds: targetIds, initialServiceId: restoredState.config.targetServiceId,
    itemsPublished: true, network: railwayBundle.network, presentation,
  });
  const predicates = {
    turn: record.turn,
    newTargetSegmentCount: facts.newTargetSegmentCount,
    landingServiceId: move.landing?.serviceId ?? null,
    serviceDrawRequired: move.landing?.serviceDrawRequired ?? false,
    candidateCount: move.landing?.serviceCandidates.length ?? 0,
    chipLabels: expected?.chips.map((chip) => chip.label) ?? [],
    rideText: expected?.ride.text ?? null,
  };
  const diagnostic: string = `R1 fixture predicates failed: ${JSON.stringify({ predicates, state: restoredState }, null, 2)}`;
  if (!expected) throw new Error(diagnostic);
  return { panel, record, expected, predicates, diagnostic };
}

test.use({ dataset: "fixture" });

test("desktop result, inline heading and #65 slot fit", async ({ page, railwayBundle }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { panel, record, expected, predicates, diagnostic } = await prepareR1(page, railwayBundle);
  expect(predicates, diagnostic).toMatchObject({
    turn: 2, newTargetSegmentCount: 2, landingServiceId: "fixture-south",
    serviceDrawRequired: true, candidateCount: 2,
  });
  expect(predicates.chipLabels, diagnostic).toEqual(expect.arrayContaining(["+2区間", "乗換"]));
  expect(predicates.rideText?.startsWith("抽選:")).toBe(true);
  expect(expected.heading).toBe(`前のターン（${record.turn}ターン目）`);
  const card = panel.getByRole("region", { name: expected.heading, exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { level: 2, name: expected.heading, exact: true })).toHaveText(expected.heading);
  const moveLine = card.locator(".turn-result__move");
  await expect(moveLine).toHaveText(expected.moveText);
  const visibleMoveText: string = await moveLine.innerText();
  expect(visibleMoveText).not.toContain("（");
  expect(visibleMoveText).not.toContain("）");
  const rideLine = card.locator(".turn-result__ride-text");
  await expect(rideLine).toHaveText(expected.ride.text);
  await expect(card.locator(".turn-result__ride .line-badge")).toBeVisible();

  const chips = card.locator(".turn-result__chip");
  const labels: string[] = await card.locator(".turn-result__chip-label").allTextContents();
  expect(labels).toEqual(expect.arrayContaining(["+2区間", "乗換"]));
  expect(await chips.count()).toBe(expected.chips.length);
  for (let index = 0; index < expected.chips.length; index += 1) {
    const chip = chips.nth(index);
    await expect(chip.locator(".visually-hidden")).toHaveCount(1);
    await expect(chip).toHaveAttribute("title", expected.chips[index]!.text);
  }

  const order: number[] = await panel.evaluate((root) => {
    const all = Array.from(root.querySelectorAll("*"));
    return [".game-panel__actions", ".turn-result", ".turn-result__reserve", ".item-inventory"]
      .map((selector) => all.indexOf(root.querySelector(selector)!));
  });
  expect(order[0]).toBeLessThan(order[1]!);
  expect(order[1]).toBeLessThan(order[2]!);
  expect(order[2]).toBeLessThan(order[3]!);

  const logTrigger = panel.getByRole("button", { name: "ログ", exact: true });
  await expect(logTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("region", { name: "ターンのログ", exact: true })).toBeHidden();
  await expect(card.locator("[aria-live], [role='status']")).toHaveCount(0);

  const measurements = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const cardRect = element.querySelector<HTMLElement>(".turn-result")!.getBoundingClientRect();
    const reserveRect = element.querySelector<HTMLElement>(".turn-result__reserve")!.getBoundingClientRect();
    const headingRect = element.querySelector<HTMLElement>(".turn-result__heading")!.getBoundingClientRect();
    const moveRect = element.querySelector<HTMLElement>(".turn-result__move")!.getBoundingClientRect();
    const flowChildren = Array.from(element.children).filter((child) => {
      const style = getComputedStyle(child);
      return style.display !== "none" && style.position !== "absolute" && style.position !== "fixed";
    });
    const lastChildRect = flowChildren.at(-1)!.getBoundingClientRect();
    return {
      cardHeight: cardRect.height,
      reserveHeight: reserveRect.height,
      reserveGap: reserveRect.top - cardRect.bottom,
      headingMoveTopDelta: moveRect.top - headingRect.top,
      moveRightOfHeading: moveRect.left >= headingRect.right,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      cardInsidePanel: cardRect.top >= panelRect.top - 1 && cardRect.bottom <= panelRect.bottom + 1,
      reserveInsidePanel: reserveRect.top >= panelRect.top - 1 && reserveRect.bottom <= panelRect.bottom + 1,
      contentBottom: lastChildRect.bottom,
      panelBottom: panelRect.bottom,
      contentBottomVsPanelBottom: panelRect.bottom - lastChildRect.bottom,
    };
  });
  testInfo.annotations.push({ type: "measurement", description: `1280x800 R1 ${JSON.stringify(measurements)}` });
  console.info("1280x800 R1 turn-result-card measurements", measurements);
  expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.clientHeight + 1);
  // #65 slot is named but reserves no space until #65 decides its own (user decision 2026-11-14).
  expect(measurements.reserveHeight).toBe(0);
  // Desktop budget: the heading shares line 1 with 出目 → 駅.
  expect(Math.abs(measurements.headingMoveTopDelta)).toBeLessThanOrEqual(1);
  expect(measurements.moveRightOfHeading).toBe(true);
  expect(Math.abs(measurements.reserveGap)).toBeLessThanOrEqual(1);
  expect(measurements.cardInsidePanel).toBe(true);
  expect(measurements.reserveInsidePanel).toBe(true);
});

test("short landscape shows one result row", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  for (const viewport of [{ width: 667, height: 375 }, { width: 640, height: 400 }]) {
    await page.setViewportSize(viewport);
    const { panel, expected, predicates, diagnostic } = await prepareR1(page, railwayBundle);
    expect(predicates, diagnostic).toMatchObject({ turn: 2, newTargetSegmentCount: 2 });
    expect(predicates.chipLabels, diagnostic).toContain("+2区間");
    const row = panel.locator(".turn-result__compact");
    await expect(row).toBeVisible();
    // The row's own innerText puts line breaks between flex items, so join the parts' rendered text.
    // No separator is added here: the rendered spaces must come from the parts themselves.
    const faceText = await row.locator(".turn-result__compact-face").innerText();
    const stationText = await row.locator(".turn-result__compact-station").innerText();
    const segments = row.locator(".turn-result__compact-segments");
    const segmentsText = await segments.count() ? await segments.innerText() : "";
    const visibleText = `${faceText}${stationText}${segmentsText}`;
    expect([visibleText, await row.textContent()]).toEqual([expected.compact.text, expected.compact.accessibleName]);
    expect(await row.innerText()).not.toMatch(/抽選|乗車|乗換/);
    await expect(panel.locator(".turn-result")).toBeHidden();
    await expect(page.locator(".turn-result__pill")).toHaveCount(0);
    await expect(hudCompactRoll(page)).toBeVisible();
    await expect(diceReady(page)).toBeVisible();
    const inventory = panel.locator(".item-inventory");
    await expect(inventory).toBeVisible();
    await expect(row.locator("[aria-live], [role='status']")).toHaveCount(0);
    const measurements = await panel.evaluate((root) => {
      const rect = (selector: string) => root.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const row = rect(".turn-result__compact");
      const dice = rect(".game-panel__roll");
      const inventory = rect(".item-inventory");
      const rowElement = root.querySelector<HTMLElement>(".turn-result__compact")!;
      const style = getComputedStyle(rowElement);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const rowOuterHeight = row.height + Number.parseFloat(style.marginTop) + Number.parseFloat(style.marginBottom);
      return {
        inDomOrder: Boolean(root.querySelector(".game-panel__actions")!.compareDocumentPosition(rowElement) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          Boolean(rowElement.compareDocumentPosition(root.querySelector(".item-inventory")!) & Node.DOCUMENT_POSITION_FOLLOWING),
        belowDice: row.top >= dice.bottom,
        diceInsidePanel: dice.top >= root.getBoundingClientRect().top && dice.bottom <= root.getBoundingClientRect().bottom,
        rowHeight: row.height,
        rowOuterHeight,
        oneLine: row.height <= lineHeight + 1,
        // +N区間 follows the station name directly instead of being pushed to the row's right edge.
        segmentsAdjacent: (() => {
          const stationText = document.createRange();
          stationText.selectNodeContents(root.querySelector(".turn-result__compact-station")!);
          return Math.abs(rect(".turn-result__compact-segments").left - stationText.getBoundingClientRect().right) <= 1;
        })(),
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        scrollTop: root.scrollTop,
        contentInsidePanel: row.top >= root.getBoundingClientRect().top && inventory.bottom <= root.getBoundingClientRect().bottom,
      };
    });
    testInfo.annotations.push({ type: "measurement", description: `${viewport.width}x${viewport.height} ${JSON.stringify(measurements)}` });
    console.info(`${viewport.width}x${viewport.height} short-landscape turn-result measurements`, measurements);
    expect([measurements.inDomOrder, measurements.belowDice, measurements.diceInsidePanel, measurements.oneLine,
      measurements.segmentsAdjacent]).toEqual([true, true, true, true, true]);
    expect(measurements.rowOuterHeight).toBeLessThanOrEqual(MAX_SHORT_LANDSCAPE_ROW_HEIGHT_PX);
    expect([measurements.scrollTop, measurements.contentInsidePanel]).toEqual([0, true]);
    if (viewport.width === 640) {
      const overflow = await row.evaluate((element, probe) => {
        const row = element as HTMLElement;
        row.style.cssText += `;width:${probe.width}px;max-width:${probe.width}px`;
        const station = row.querySelector<HTMLElement>(".turn-result__compact-station")!;
        station.textContent = probe.station;
        const face = row.querySelector<HTMLElement>(".turn-result__compact-face")!;
        const segments = row.querySelector<HTMLElement>(".turn-result__compact-segments")!;
        const rect = row.getBoundingClientRect();
        const inside = (part: HTMLElement) => {
          const partRect = part.getBoundingClientRect();
          return partRect.left >= rect.left && partRect.right <= rect.right;
        };
        return {
          stationOverflow: station.scrollWidth > station.clientWidth,
          textOverflow: getComputedStyle(station).textOverflow,
          faceFits: face.scrollWidth <= face.clientWidth,
          segmentsFit: segments.scrollWidth <= segments.clientWidth,
          faceInside: inside(face), segmentsInside: inside(segments),
        };
      }, { width: ELLIPSIS_PROBE_WIDTH_PX, station: LONG_STATION_NAME });
      expect(overflow).toEqual({ stationOverflow: true, textOverflow: "ellipsis", faceFits: true, segmentsFit: true, faceInside: true, segmentsInside: true });
    }
  }
});

test("short landscape row hidden at turn 0", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("/");
  await page.getByRole("button", { name: "はじめから" }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(gamePanel(page).locator(".turn-result__compact")).toHaveCount(0);
});

test("desktop card hidden at turn 0", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "はじめから" }).click();
  const panel = gamePanel(page);
  await expect(panel).toBeVisible();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(panel.locator(".turn-result")).toHaveCount(0);
  await expect(panel.locator(".turn-result__reserve")).toHaveCount(1);
});
