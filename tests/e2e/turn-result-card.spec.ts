import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { itemLastMove } from "../../src/features/game/itemSession";
import { deriveTurnResult, replayTurnResultHistory } from "../../src/features/game/turnResultCard";
import { serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { expect, test } from "./fixtures";
import { itemScenario } from "./fixtures/itemScenarios";
import { diceReady, gamePanel, panelStat, readSave, writeSaveText } from "./support/app";

test.use({ dataset: "fixture" });

test("desktop result, inline heading and #65 slot fit", async ({ page, railwayBundle }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
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
  expect(predicates, diagnostic).toMatchObject({
    turn: 2, newTargetSegmentCount: 2, landingServiceId: "fixture-south",
    serviceDrawRequired: true, candidateCount: 2,
  });
  expect(predicates.chipLabels, diagnostic).toEqual(expect.arrayContaining(["+2区間", "乗換"]));
  expect(predicates.rideText?.startsWith("抽選:")).toBe(true);
  if (!expected) throw new Error(diagnostic);

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
