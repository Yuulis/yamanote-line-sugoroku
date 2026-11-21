import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { itemLastMove } from "../../src/features/game/itemSession";
import { deriveTurnResult, replayTurnResultHistory } from "../../src/features/game/turnResultCard";
import { playItemTurn, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import type { ItemGameState, ItemTurnRecord } from "../../src/types/network";
import { CURRENT_POSITION_RADIUS, CURRENT_POSITION_STROKE_WIDTH, SOURCE_IDS } from "../../src/features/map/mapConfig";
import { TURN_RESULT_PILL_GAP_PX } from "../../src/features/game/turnResultPillLayout";
import { LOTTERY_FIT_MIN_SCALE, MIN_CARD_REGION_PX } from "../../src/features/game/components/TurnMomentHost";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { expect, test } from "./fixtures";
import type { Page, Locator } from "@playwright/test";
import type { RailwayBundle } from "./fixtures/bundle";
import { itemScenario } from "./fixtures/itemScenarios";
import {
  diceButton,
  diceReady,
  gamePanel,
  hudCompactRoll,
  openGameMenu,
  panelStat,
  readMap,
  readSave,
  rollOnce,
  useInventoryItem,
  startNewGame,
  writeSaveText,
  combinedMomentGame,
  freezeClock,
  clickDice,
  stampsExpected,
  type SavedGame,
} from "./support/app";
import { advanceArrival, advanceLotteryFlip, advanceLotterySettle, advanceMovement, advancePickup,
  advanceStamps, advanceTumble, awaitStage } from "./support/turnMoments";
import { seedGameSettings } from "./support/settings";
import { pressSkip } from "./support/turnMoments";
import { acceptOfflineTurn, findTargetTurn, openPopulatedResult, populatedResultState, replayFixtureClear,
  replayLongestProductResult, replayTwoManualRolls, restoreResultState } from "./support/turnResult";

const MAX_SHORT_LANDSCAPE_ROW_HEIGHT_PX = 22;
const ELLIPSIS_PROBE_WIDTH_PX = 160;
/** 84px overview/toast column + 8px gutter the phone pill must leave free. */
const PILL_RIGHT_CLEARANCE_PX = 92;
const MIN_TOUCH_TARGET_PX = 44;
const PHONE_STATS_HEIGHT_PX = 104;
const LONG_STATION_NAME = "羽田空港第1・第2ターミナル".repeat(3);
const PAST_ANY_MOVEMENT_MS = 6_100;
const MAX_CLIP_TOLERANCE_PX = 0.5;
/** Allowed distance between a settled lottery row and its HUD target (subpixel rounding of measured boxes). */
const MAX_FLIGHT_LANDING_ERROR_PX = 1;
/**
 * Same check when Step 10a scaled the board down: WebKit rounds the scaled, transformed row boxes
 * to a coarser subpixel grid (CI measured 1.24-1.56px at scale 0.749), so allow 2px there only.
 */
const MAX_SCALED_FLIGHT_LANDING_ERROR_PX = 2;
/** Drawn/layout width of an unscaled board can read ~1.0015 from rounding; Step 10a scales are <= ~0.75. */
const SCALED_BOARD_THRESHOLD = 0.99;
const PREVIEW_PANEL_RESIZE_PX = 24;
const FOLLOW_NORMAL_TURN_COUNT = 3;
const PILL_POSITION_CHANGE_TOLERANCE_PX = 1;
const MARKER_HALF_SIZE_PX = CURRENT_POSITION_RADIUS + CURRENT_POSITION_STROKE_WIDTH;
const PREVIEW_VIEWPORTS = [{ width: 320, height: 568 }, { width: 568, height: 320 }] as const;
const FOLLOW_VIEWPORTS = [
  { width: 320, height: 568 }, { width: 375, height: 667 },
  { width: 320, height: 480 }, { width: 568, height: 320 },
] as const;

type ResultModel = NonNullable<ReturnType<typeof deriveTurnResult>>;

interface R3Results {
  readonly base: ItemGameState;
  readonly predicted: ItemGameState;
  readonly record: ItemGameState["movementHistory"][number];
  readonly previous: ResultModel;
  readonly pickup: ResultModel;
  readonly published: ResultModel;
  readonly pickupName: string;
  readonly pickupLabel: string;
  readonly hasLottery: boolean;
}

function r3Results(bundle: RailwayBundle): R3Results {
  const base: ItemGameState = combinedMomentGame(bundle);
  const replay = playItemTurn(base, {}, bundle.network);
  const predicted: ItemGameState = replay.state;
  if (predicted.pending?.kind !== "discard") throw new Error("R3 replay did not produce the turn 11 discard");
  const record: ItemTurnRecord = structuredClone(predicted.pending.record) as ItemTurnRecord;
  if (record.turn !== 11) throw new Error(`R3 replay expected turn 11, received ${record.turn}`);
  const presentation = createPresentationResolver(bundle.network,
    bundle.data.manifest.ok ? bundle.data.manifest.value.uiPresentation : undefined);
  const targetIds = targetSegmentIds(base.config, bundle.network);
  const derive = (turnRecord: typeof record, itemsPublished: boolean): ResultModel => {
    const move = itemLastMove(turnRecord, bundle.network);
    const result = deriveTurnResult({ sessionId: 1, turn: turnRecord.turn, move, records: predicted.movementHistory,
      pending: predicted.pending, targetSegmentIds: targetIds, initialServiceId: base.config.targetServiceId,
      itemsPublished, network: bundle.network, presentation });
    if (!result) throw new Error(`R3 turn ${turnRecord.turn} did not derive a result model`);
    return result;
  };
  const previousRecord = base.movementHistory.at(-1);
  if (!previousRecord) throw new Error("R3 base has no previous turn result");
  const previousMove = itemLastMove(previousRecord, bundle.network);
  const previous = deriveTurnResult({ sessionId: 1, turn: previousRecord.turn, move: previousMove,
    records: base.movementHistory, targetSegmentIds: targetIds, initialServiceId: base.config.targetServiceId,
    itemsPublished: true, network: bundle.network, presentation });
  if (!previous) throw new Error("R3 previous turn did not derive a result model");
  const pickup = derive(record, false);
  const published = derive(record, true);
  const pickupChip = published.chips.find((chip) => chip.kind === "pickup");
  if (!pickupChip || record.kind !== "item-ride") throw new Error("R3 turn has no derived pickup item");
  const pickupEvent = record.itemEvents.find((event) => event.type === "pickup-pending-discard");
  if (pickupEvent?.type !== "pickup-pending-discard") throw new Error("R3 turn is missing the pickup event");
  const selected = record.landingSnapshot?.services.find((service) => service.serviceId === record.landing?.serviceId);
  const hasLottery = (record.landingSnapshot?.services.length ?? 0) > 1 || (selected?.directions.length ?? 0) > 1;
  return { base, predicted, record, previous, pickup, published,
    pickupName: ITEM_DESCRIPTIONS[pickupEvent.item.kind].name, pickupLabel: pickupChip.label, hasLottery };
}

interface MomentGeometry {
  readonly region: string | null;
  readonly scale: number | null;
  readonly card: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number } | null;
  readonly pill: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };
  readonly panel: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly intersectsPill: boolean;
  readonly intersectsPanel: boolean;
  readonly gapPx: number | null;
  readonly clippedPx: number | null;
}

async function readMomentGeometry(page: Page): Promise<MomentGeometry> {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const pill = document.querySelector<HTMLElement>(".turn-result__pill");
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const card = document.querySelector<HTMLElement>(".turn-moment-host__card");
    const region = document.querySelector<HTMLElement>(".turn-moment-host__region");
    if (!pill || !panel) throw new Error("R3 pill or panel is missing");
    const pillBox = box(pill);
    const panelBox = box(panel);
    if (!card || !region) return { region: null, scale: null, card: null, pill: pillBox, panel: panelBox,
      intersectsPill: false, intersectsPanel: false, gapPx: null, clippedPx: null };
    // The arrival banner and split-flap board can overflow their card box; measure what is actually drawn.
    const cardBox = box(card.querySelector(".lottery-reveal, .arrival-banner") ?? card);
    const regionBox = box(region);
    const clippedPx = Math.max(0, regionBox.top - cardBox.top, cardBox.bottom - regionBox.bottom,
      regionBox.left - cardBox.left, cardBox.right - regionBox.right);
    const overlaps = (a: typeof cardBox, b: typeof pillBox): boolean =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const dx = Math.max(0, pillBox.left - cardBox.right, cardBox.left - pillBox.right);
    const dy = Math.max(0, pillBox.top - cardBox.bottom, cardBox.top - pillBox.bottom);
    const scaleValue = getComputedStyle(card).scale;
    return { region: region.dataset.region ?? null, scale: scaleValue === "none" ? 1 : Number.parseFloat(scaleValue),
      card: cardBox, pill: pillBox, panel: panelBox, intersectsPill: overlaps(cardBox, pillBox),
      intersectsPanel: overlaps(cardBox, panelBox), gapPx: Math.hypot(dx, dy), clippedPx };
  });
}

async function restoreFrozenR3(page: Page, state: ItemGameState): Promise<void> {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.goto("/");
  await writeSaveText(page, serializeGame(state));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await freezeClock(page);
}

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

function expectedSavedResult(saved: SavedGame, railwayBundle: RailwayBundle) {
  const record = saved.movementHistory.at(-1);
  if (!record) throw new Error("Saved game has no completed turn result");
  const move = itemLastMove(record, railwayBundle.network);
  if (!move) throw new Error("Saved turn did not resolve to a move");
  const presentation = createPresentationResolver(railwayBundle.network,
    railwayBundle.data.manifest.ok ? railwayBundle.data.manifest.value.uiPresentation : undefined);
  const model = deriveTurnResult({
    sessionId: 1,
    turn: record.turn,
    move,
    records: saved.movementHistory,
    targetSegmentIds: targetSegmentIds(saved.config, railwayBundle.network),
    initialServiceId: saved.config.targetServiceId,
    itemsPublished: true,
    network: railwayBundle.network,
    presentation,
  });
  if (!model) throw new Error("Saved turn did not produce a published result model");
  return model;
}

async function compactText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => ["face", "station", "segments"].map((part) =>
    element.querySelector<HTMLElement>(`.turn-result__compact-${part}`)?.textContent ?? "").join(""));
}

function predictR1NextTurn(railwayBundle: RailwayBundle): { readonly before: ItemGameState; readonly after: ItemGameState } {
  const before: ItemGameState = itemScenario("route", railwayBundle.network);
  const after: ItemGameState = acceptOfflineTurn(before, railwayBundle.network);
  const record = after.movementHistory.at(-1);
  const predicates = { turnAdvanced: after.turn === before.turn + 1, status: after.status,
    hasAdjustmentChoice: before.inventory.some((item) => item.kind === "roll-adjust"),
    pending: after.pending?.kind ?? null,
    hasDiscardChoice: record?.itemEvents.some((event) => event.type === "pickup-pending-discard") ?? null };
  if (!record || !predicates.turnAdvanced || after.pending !== null || predicates.hasAdjustmentChoice || predicates.hasDiscardChoice) {
    throw new Error(`R1 next-turn predicates failed: ${JSON.stringify(predicates)}`);
  }
  return { before, after };
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
    // Step 8 keeps a persistent pill shell while the panel is mounted; short landscape keeps it hidden and empty.
    await expect(page.locator(".turn-result__pill")).toBeHidden();
    await expect(page.locator(".turn-result__pill")).toBeEmpty();
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

test("phone pill follows measured panel", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  const pill = page.locator(".turn-result__pill");
  const viewports = [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 320, height: 480 }, { width: 568, height: 320 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const { panel, expected } = await prepareR1(page, railwayBundle);
    await expect(pill).toBeVisible();
    await expect(page.locator(".map-overview")).toHaveCount(1);
    await expect(page.locator(".maplibregl-ctrl-top-right .maplibregl-ctrl-group")).toHaveCount(1);
    await expect(page.locator(".maplibregl-ctrl-top-left > .maplibregl-ctrl-attrib.maplibregl-compact")).toHaveCount(1);
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing layout element: ${selector}`);
        const { top, left, right, bottom, width, height } = element.getBoundingClientRect();
        return { top, left, right, bottom, width, height };
      };
      const pill = rect(".turn-result__pill");
      const panel = rect(".game-panel");
      const overview = rect(".map-overview");
      const zoom = rect(".maplibregl-ctrl-top-right .maplibregl-ctrl-group");
      const attribution = rect(".maplibregl-ctrl-top-left > .maplibregl-ctrl-attrib.maplibregl-compact");
      const overlaps = (a: typeof pill, b: typeof pill): boolean =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const station = document.querySelector<HTMLElement>(".turn-result__pill .turn-result__compact-station");
      if (!station) throw new Error("Pill station segment is missing");
      const stationRange = document.createRange();
      stationRange.selectNodeContents(station);
      const segments = document.querySelector<HTMLElement>(".turn-result__pill .turn-result__compact-segments");
      const stationLineRects = stationRange.getClientRects();
      const stationEnd = stationRange.getBoundingClientRect().right;
      return {
        viewportWidth: innerWidth,
        panel,
        pill,
        overview,
        zoom,
        attribution,
        overlaps: {
          overview: overlaps(pill, overview),
          zoom: overlaps(pill, zoom),
          attribution: overlaps(pill, attribution),
        },
        stationLineCount: stationLineRects.length,
        segmentsDelta: segments ? segments.getBoundingClientRect().left - stationEnd : null,
        renderedParts: ["face", "station", "segments"].map((part) =>
          document.querySelector<HTMLElement>(`.turn-result__pill .turn-result__compact-${part}`)?.textContent ?? "").join(""),
      };
    });
    expect(Math.abs(geometry.pill.bottom - (geometry.panel.top - TURN_RESULT_PILL_GAP_PX))).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.pill.left - geometry.panel.left)).toBeLessThanOrEqual(1);
    expect(geometry.pill.right).toBeLessThanOrEqual(geometry.viewportWidth - PILL_RIGHT_CLEARANCE_PX);
    expect(geometry.pill.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(geometry.overlaps).toEqual({ overview: false, zoom: false, attribution: false });
    expect(geometry.stationLineCount).toBe(1);
    expect(expected.compact.segmentsText).not.toBeNull();
    expect(geometry.segmentsDelta).not.toBeNull();
    expect(Math.abs(geometry.segmentsDelta!)).toBeLessThanOrEqual(1);
    expect(geometry.renderedParts).toBe(expected.compact.text);
    testInfo.annotations.push({ type: "pill-geometry", description: `${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}` });

    if ((viewport.width === 320 && viewport.height === 480) || (viewport.width === 568 && viewport.height === 320)) {
      const marker = await readMap(page);
      const center = marker?.headingMarker?.projectedCenter ?? null;
      const markerRadius = CURRENT_POSITION_RADIUS + CURRENT_POSITION_STROKE_WIDTH / 2;
      const markerRect = center ? {
        left: center.x - markerRadius, right: center.x + markerRadius,
        top: center.y - markerRadius, bottom: center.y + markerRadius,
      } : null;
      const comparison = { markerRect, pill: geometry.pill,
        pillToMarkerGap: markerRect ? geometry.pill.top - markerRect.bottom : null };
      console.info(`phone pill marker measurement ${viewport.width}x${viewport.height}`, comparison);
      testInfo.annotations.push({ type: "marker-pill-geometry", description: JSON.stringify(comparison) });
    }

    if (viewport.width === 320 && viewport.height === 480) {
      await panel.evaluate((element) => { element.style.height = "160px"; });
      await expect.poll(async () => {
        const panelRect = await panel.boundingBox();
        const pillRect = await pill.boundingBox();
        return panelRect && pillRect ? Math.abs(pillRect.y + pillRect.height - (panelRect.y - TURN_RESULT_PILL_GAP_PX)) : Number.POSITIVE_INFINITY;
      }).toBeLessThanOrEqual(1);
      await panel.evaluate((element) => { element.style.removeProperty("height"); });
      await expect.poll(async () => {
        const panelRect = await panel.boundingBox();
        const pillRect = await pill.boundingBox();
        return panelRect && pillRect ? Math.abs(pillRect.y + pillRect.height - (panelRect.y - TURN_RESULT_PILL_GAP_PX)) : Number.POSITIVE_INFINITY;
      }).toBeLessThanOrEqual(1);

      await page.evaluate(() => {
        const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
        storage.originalSetItem = storage.setItem;
        storage.setItem = function (key: string, value: string): void {
          if (key.includes("save")) throw new Error("quota");
          storage.originalSetItem?.call(this, key, value);
        };
      });
      await diceReady(page).click();
      await expect(page.locator(".toast-host__toast").first()).toBeVisible();
      const toastMeasurement = await page.evaluate(() => {
        const toasts = [...document.querySelectorAll<HTMLElement>(".toast-host__toast")];
        const pillTop = document.querySelector<HTMLElement>(".turn-result__pill")!.getBoundingClientRect().top;
        return { count: toasts.length, maxBottom: Math.max(...toasts.map((toast) => toast.getBoundingClientRect().bottom)), pillTop };
      });
      console.info("320x480 toast stack vs phone pill", toastMeasurement);
      testInfo.annotations.push({ type: "toast-pill-geometry", description: JSON.stringify(toastMeasurement) });
    }
  }
});

test("pill repeatedly reveals log and restores focus", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { panel, expected } = await prepareR1(page, railwayBundle);
  const pill = page.locator(".turn-result__pill");
  const log = panel.locator(".game-panel__log");
  const hamburger = panel.locator(".phone-menu__trigger");
  const settings = panel.getByRole("region", { name: "メニュー", exact: true, includeHidden: true });
  const regionId = await log.getAttribute("id");
  if (!regionId) throw new Error("turn log region has no id");
  const phoneRegionId = await panel.locator(".phone-menu__content").getAttribute("id");
  if (!phoneRegionId) throw new Error("phone menu region has no id");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveRole("button");
  await expect(pill).toHaveAccessibleName(`${expected.compact.accessibleName}。ターンのログを開く`);
  await expect(pill).toHaveAttribute("aria-label", `${expected.compact.accessibleName}。ターンのログを開く`);
  await Promise.all([expect(pill).toHaveAttribute("aria-controls", regionId), expect(hamburger).toHaveAttribute("aria-controls", phoneRegionId)]);
  await expect(hamburger).toHaveAttribute("aria-expanded", "false");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  const pillBox = await pill.boundingBox();
  if (!pillBox) throw new Error("phone pill has no measurable box");
  const revealMeasurements: number[][] = [];
  const panelElementBounds = (selector: string): Promise<number[]> => panel.evaluate((root, target) => {
    const panelRect = root.getBoundingClientRect();
    const elementRect = root.querySelector<HTMLElement>(target)!.getBoundingClientRect();
    return [panelRect.top, panelRect.bottom, elementRect.top, elementRect.bottom];
  }, selector);
  const assertRevealed = async (): Promise<void> => {
    await Promise.all([expect(log).toBeVisible(), expect(log).toBeFocused()]);
    await expect(pill).toHaveAttribute("aria-expanded", "true");
    const bounds = await panelElementBounds(".game-panel__log");
    const [panelTop, panelBottom, logTop] = bounds;
    expect(logTop, `log top ${logTop} must be at or below panel top ${panelTop}`).toBeGreaterThanOrEqual(panelTop!);
    expect(logTop, `log top ${logTop} must be above panel bottom ${panelBottom}`).toBeLessThan(panelBottom!);
    revealMeasurements.push(bounds);
  };
  await pill.click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await assertRevealed();
  await panel.evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => panel.evaluate((root) => root.querySelector<HTMLElement>(".game-panel__log")!.getBoundingClientRect().top - root.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0);
  await pill.click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await assertRevealed();
  await openGameMenu(page);
  await expect(settings).toBeVisible();
  await pill.click();
  await expect(settings).toBeHidden();
  await expect(hamburger).toHaveAttribute("aria-expanded", "true");
  await assertRevealed();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(pill).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();
  const trigger = panel.getByRole("button", { name: "ログ", exact: true });
  await expect(trigger).toBeFocused();
  const triggerBounds = await panelElementBounds(".game-panel__log-trigger");
  const [panelTop, panelBottom, triggerTop, triggerBottom] = triggerBounds;
  expect(triggerTop, `trigger top ${triggerTop} must be at or below panel top ${panelTop}`).toBeGreaterThanOrEqual(panelTop!);
  expect(triggerBottom, `trigger bottom ${triggerBottom} must be within panel bottom ${panelBottom}`).toBeLessThanOrEqual(panelBottom!);
  console.info("320x568 pill and reveal measurements", { pill: { width: pillBox.width, height: pillBox.height }, reveals: revealMeasurements });
});

test("pill-opened log does not leave a stale opener", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { panel } = await prepareR1(page, railwayBundle);
  const pill = page.locator(".turn-result__pill");
  const log = panel.locator(".game-panel__log");
  const trigger = panel.locator(".phone-menu__trigger");
  await pill.click();
  await expect(log).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden(); await expect(pill).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(log).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pill).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(log).toBeVisible();
  await Promise.all([expect(trigger).toHaveAttribute("aria-expanded", "true"), expect(trigger).toBeFocused()]);
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden(); await expect(trigger).toBeFocused();
  await pill.focus();
  await page.keyboard.press("Space");
  await expect(log).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pill).toBeFocused();
  await trigger.click();
  await expect(log).toBeVisible();
  await trigger.click();
  await expect(log).toBeHidden(); await expect(trigger).toBeFocused();
});

test("phone pill appears after first publication", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await startNewGame(page);
  const pill = page.locator(".turn-result__pill");
  await expect(pill).toHaveCount(1);
  await expect(pill).toBeHidden();
  await rollOnce(page);
  const saved = await readSave(page);
  if (!saved) throw new Error("R0 save was unavailable after the first roll");
  const expected = expectedSavedResult(saved, railwayBundle);
  await expect(pill).toBeVisible();
  const parts = await pill.evaluate((element) =>
    ["face", "station", "segments"].map((part) =>
      element.querySelector<HTMLElement>(`.turn-result__compact-${part}`)?.textContent ?? "").join(""));
  expect(parts).toBe(expected.compact.text);
  expect(await pill.getAttribute("role")).toBeNull();
  expect(await pill.getAttribute("tabindex")).toBeNull();
});

test("phone HUD omits roll stat", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 667, height: 375 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const { panel } = await prepareR1(page, railwayBundle);
    const rollLabel = panel.locator('.game-panel__stats dt:has(+ dd > [data-stat="roll-compact"])');
    if (viewport.width === 320) {
      await expect(rollLabel).toBeHidden();
      await expect(hudCompactRoll(page)).toBeHidden();
      const statsHeight = await panel.locator(".game-panel__stats").evaluate((element) => element.getBoundingClientRect().height);
      expect(Math.abs(statsHeight - PHONE_STATS_HEIGHT_PX)).toBeLessThanOrEqual(0.5);
    } else {
      await expect(rollLabel).toBeVisible();
      await expect(hudCompactRoll(page)).toBeVisible();
    }
  }
});

async function assertPhoneMoment(page: Page, model: ResultModel, stage: string, viewport: { width: number; height: number },
  testInfo: { annotations: { type: string; description?: string }[] }): Promise<void> {
  const pill = page.locator(".turn-result__pill");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAccessibleName(`${model.compact.accessibleName}。ターンのログを開く`);
  const geometry = await readMomentGeometry(page);
  testInfo.annotations.push({ type: "moment-clearance", description: `${viewport.width}x${viewport.height} ${stage}: ${JSON.stringify(geometry)}` });
  console.info(`${viewport.width}x${viewport.height} ${stage} moment geometry`, geometry);
  if (!geometry.card || geometry.scale === null) throw new Error(`${stage}: moment card is hidden; measurement=${JSON.stringify(geometry)}`);
  await expect(page.locator(".turn-moment-host__card")).toBeVisible();
  expect(geometry.pill.width).toBeGreaterThan(0);
  expect(geometry.pill.height).toBeGreaterThan(0);
  expect(geometry.intersectsPill, `${stage}: moment card overlaps pill`).toBe(false);
  expect(geometry.intersectsPanel, `${stage}: moment card overlaps panel`).toBe(false);
  expect(geometry.clippedPx, `${stage}: moment content clipped by its region`).toBeLessThanOrEqual(MAX_CLIP_TOLERANCE_PX);
  expect(geometry.scale, `${stage}: card scale`).toBeGreaterThan(0);
  if (stage.startsWith("lottery")) {
    // Step 10a: the split-flap board scales to the free space above the pill instead of a 112px width minimum.
    expect(geometry.scale, `${stage}: lottery board scale`).toBeLessThanOrEqual(1);
    expect(geometry.scale, `${stage}: lottery board scale floor`).toBeGreaterThanOrEqual(LOTTERY_FIT_MIN_SCALE);
    if (viewport.height === 568) expect(geometry.scale, `${stage}: board that fits keeps scale 1`).toBe(1);
    if (viewport.height === 480) expect(geometry.scale, `${stage}: board above the pill is fitted`).toBeLessThan(1);
    if (geometry.scale < 1) {
      // A shrunk card is fitted as a whole, so even its tappable box stays above the pill while settling unclipped.
      const cardBottom = await page.locator(".turn-moment-host__card").evaluate((element) => element.getBoundingClientRect().bottom);
      expect(cardBottom, `${stage}: fitted card box bottom vs pill top`).toBeLessThanOrEqual(geometry.pill.top + MAX_CLIP_TOLERANCE_PX);
    }
  } else if (geometry.scale < 1) {
    expect(geometry.card.width, `${stage}: scaled card width`).toBeGreaterThanOrEqual(MIN_CARD_REGION_PX);
  }
}

interface FlightLanding {
  readonly motion: string | null;
  /** Effective board scale: drawn width / layout width (1 when Step 10a did not shrink the board). */
  readonly boardScale: number;
  readonly end: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly target: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** Seeks each lottery row's settle animation to its end and pairs the landed box with its HUD target. */
async function readSettleLandings(page: Page): Promise<readonly FlightLanding[]> {
  return page.locator(".lottery-reveal").evaluate((board) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const targets = ['[data-stat="ride"]', '[data-stat="direction"]'];
    const boardScale = board.getBoundingClientRect().width / (board as HTMLElement).offsetWidth;
    return [...board.querySelectorAll<HTMLElement>(".lottery-reveal__row")].map((row, index) => {
      const target = box(document.querySelector(targets[index]!)!);
      const animation = row.getAnimations().find((candidate) =>
        candidate instanceof CSSAnimation && candidate.animationName === "lottery-settle");
      if (!animation) throw new Error("Expected the lottery settle CSS animation");
      animation.pause();
      animation.currentTime = Number(animation.effect!.getComputedTiming().duration);
      const end = box(row);
      animation.currentTime = 0;
      return { motion: row.dataset.motion ?? null, boardScale, end, target };
    });
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 320, height: 480 }]) {
  test(`moments preserve and avoid previous result at ${viewport.width}x${viewport.height}`, { tag: "@layout" },
    async ({ page, railwayBundle }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize(viewport);
      const results = r3Results(railwayBundle);
      await restoreFrozenR3(page, results.base);
      await clickDice(page);
      await awaitStage(page, "tumble");
      await assertPhoneMoment(page, results.previous, "tumble", viewport, testInfo);
      await advanceTumble(page);
      if (stampsExpected(results.record)) {
        await awaitStage(page, "stamps");
        await assertPhoneMoment(page, results.previous, "stamps", viewport, testInfo);
        await advanceStamps(page);
      }
      await expect.poll(async () => await readSave(page)).toEqual(results.predicted);
      await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
      await awaitStage(page, "arrival");
      await assertPhoneMoment(page, results.previous, "arrival", viewport, testInfo);
      await advanceArrival(page);
      if (results.hasLottery) {
        await awaitStage(page, "lottery-flip");
        await assertPhoneMoment(page, results.previous, "lottery-flip", viewport, testInfo);
        await advanceLotteryFlip(page);
        await awaitStage(page, "lottery-settle");
        await assertPhoneMoment(page, results.previous, "lottery-settle", viewport, testInfo);
        const landings = await readSettleLandings(page);
        testInfo.annotations.push({ type: "settle-landing", description: JSON.stringify(landings) });
        expect(landings.filter((landing) => landing.motion === "flight").length, "rows flying to the HUD").toBeGreaterThan(0);
        for (const landing of landings.filter((candidate) => candidate.motion === "flight")) {
          const tolerance = landing.boardScale < SCALED_BOARD_THRESHOLD
            ? MAX_SCALED_FLIGHT_LANDING_ERROR_PX
            : MAX_FLIGHT_LANDING_ERROR_PX;
          const centre = (rect: FlightLanding["end"]) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
          expect(Math.abs(centre(landing.end).x - centre(landing.target).x), "settled row centre x").toBeLessThanOrEqual(tolerance);
          expect(Math.abs(centre(landing.end).y - centre(landing.target).y), "settled row centre y").toBeLessThanOrEqual(tolerance);
          expect(Math.abs(landing.end.width - landing.target.width), "settled row width").toBeLessThanOrEqual(tolerance);
          expect(Math.abs(landing.end.height - landing.target.height), "settled row height").toBeLessThanOrEqual(tolerance);
        }
        await advanceLotterySettle(page);
      }
      await awaitStage(page, "pickup");
      await assertPhoneMoment(page, results.pickup, "pickup", viewport, testInfo);
      const pickupName = await page.locator(".turn-result__pill").getAttribute("aria-label");
      expect(pickupName).toBe(`${results.pickup.compact.accessibleName}。ターンのログを開く`);
      expect(pickupName).not.toContain(results.pickupName);
      await advancePickup(page);
      await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
      await expect(page.locator(".turn-result__pill")).toHaveAccessibleName(pickupName!);
      await expect(page.locator(".turn-result__pill")).not.toContainText(results.pickupName);
      await page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })
        .getByRole("button", { name: "このアイテムを捨てる" }).last().click();
    });
}

test("desktop card gates item chips until publication", async ({ page, railwayBundle }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const results = r3Results(railwayBundle);
  await restoreFrozenR3(page, results.base);
  await clickDice(page);
  await advanceTumble(page);
  if (stampsExpected(results.record)) await advanceStamps(page);
  await expect.poll(async () => await readSave(page)).toEqual(results.predicted);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
  await advanceArrival(page);
  if (results.hasLottery) {
    await advanceLotteryFlip(page);
    await advanceLotterySettle(page);
  }
  await awaitStage(page, "pickup");
  const card = gamePanel(page).locator(".turn-result");
  await expect(card).toBeVisible();
  await expect(card.locator(".turn-result__heading")).toHaveText(results.pickup.heading);
  await expect(card.locator(".turn-result__chip-label").filter({ hasText: results.pickupLabel })).toHaveCount(0);
  await advancePickup(page);
  await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
  await expect(card.locator(".turn-result__heading")).toHaveText(results.published.heading);
  await expect(card.locator(".turn-result__chip-label").filter({ hasText: results.pickupLabel })).toBeVisible();
  await page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })
    .getByRole("button", { name: "このアイテムを捨てる" }).last().click();
});

interface LayoutRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface PreviewAvoidanceGeometry {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly map: LayoutRect;
  readonly pill: LayoutRect;
  readonly panel: LayoutRect;
  readonly dialog: LayoutRect | null;
  readonly targets: readonly { readonly kind: "bubble" | "leader" | "origin"; readonly rect: LayoutRect }[];
}

interface MarkerPillMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly marker: LayoutRect;
  readonly pill: LayoutRect;
  readonly verticalClearancePx: number;
  readonly horizontalClearancePx: number;
  readonly intersects: boolean;
}

function rectGap(a: LayoutRect, b: LayoutRect): number {
  const horizontal = Math.max(0, b.left - a.right, a.left - b.right);
  const vertical = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return Math.hypot(horizontal, vertical);
}

function minimumGap(targets: PreviewAvoidanceGeometry["targets"], kind: "bubble" | "leader" | "origin", pill: LayoutRect): number {
  const gaps = targets.filter((target) => target.kind === kind).map((target) => rectGap(target.rect, pill));
  if (gaps.length === 0) throw new Error(`No ${kind} geometry was measured`);
  return Math.min(...gaps);
}

async function readPreviewAvoidanceGeometry(page: Page): Promise<PreviewAvoidanceGeometry> {
  const mapSnapshot = await readMap(page);
  if (!mapSnapshot?.marker) throw new Error("The adjustment preview map marker was not available");
  const geometry = await page.evaluate(async ({ marker, markerHalfSize, markerSourceId }) => {
    interface PreviewMap {
      getContainer(): HTMLElement;
      project(position: [number, number]): { readonly x: number; readonly y: number };
      getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> } | undefined;
    }
    const map = (window as Window & { __sugorokuE2E?: { map?: PreviewMap | null } }).__sugorokuE2E?.map;
    if (!map) throw new Error("The preview map hook was unavailable");
    const rectOf = (element: Element): LayoutRect => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const pill = document.querySelector<HTMLElement>(".turn-result__pill");
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const dialogElement = document.querySelector<HTMLDialogElement>(".item-adjustment");
    if (!pill || !panel) throw new Error("The preview pill or game panel was missing");
    const mapRect = rectOf(map.getContainer());
    const source = await map.getSource(markerSourceId)?.getData();
    const origin = source?.features[0]?.geometry.coordinates ?? marker;
    const projected = map.project(origin);
    const targets: { kind: "bubble" | "leader" | "origin"; rect: LayoutRect }[] = [];
    for (const bubble of document.querySelectorAll<HTMLElement>(".map-adjustment-callout__bubble")) {
      targets.push({ kind: "bubble", rect: rectOf(bubble) });
    }
    for (const leader of document.querySelectorAll<HTMLElement>(".map-adjustment-callout__leader")) {
      targets.push({ kind: "leader", rect: rectOf(leader) });
    }
    targets.push({ kind: "origin", rect: {
      left: mapRect.left + projected.x - markerHalfSize,
      top: mapRect.top + projected.y - markerHalfSize,
      right: mapRect.left + projected.x + markerHalfSize,
      bottom: mapRect.top + projected.y + markerHalfSize,
    } });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      map: mapRect,
      pill: rectOf(pill),
      panel: rectOf(panel),
      dialog: dialogElement?.open && dialogElement.getClientRects().length > 0 ? rectOf(dialogElement) : null,
      targets,
    };
  }, { marker: mapSnapshot.marker, markerHalfSize: MARKER_HALF_SIZE_PX, markerSourceId: SOURCE_IDS.currentPosition });
  return geometry;
}

function assertPreviewAvoidance(geometry: PreviewAvoidanceGeometry): void {
  expect(geometry.dialog, "the adjustment dialog should be part of the preview geometry").not.toBeNull();
  expect(geometry.targets.some((target) => target.kind === "bubble")).toBe(true);
  expect(geometry.targets.some((target) => target.kind === "leader")).toBe(true);
  const obstacles = [geometry.pill, geometry.panel, ...(geometry.dialog ? [geometry.dialog] : [])];
  for (const target of geometry.targets) {
    expect(target.rect.left, `${target.kind} left must stay in map ${JSON.stringify(geometry.map)}`).toBeGreaterThanOrEqual(geometry.map.left);
    expect(target.rect.top, `${target.kind} top must stay in map ${JSON.stringify(geometry.map)}`).toBeGreaterThanOrEqual(geometry.map.top);
    expect(target.rect.right, `${target.kind} right must stay in map ${JSON.stringify(geometry.map)}`).toBeLessThanOrEqual(geometry.map.right);
    expect(target.rect.bottom, `${target.kind} bottom must stay in map ${JSON.stringify(geometry.map)}`).toBeLessThanOrEqual(geometry.map.bottom);
    for (const obstacle of obstacles) {
      const intersects = target.rect.left < obstacle.right && target.rect.right > obstacle.left &&
        target.rect.top < obstacle.bottom && target.rect.bottom > obstacle.top;
      expect(intersects, `${target.kind} ${JSON.stringify(target.rect)} overlaps ${JSON.stringify(obstacle)}`).toBe(false);
    }
  }
}

async function actAndWaitForPreviewMapSettled(page: Page, action: () => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    interface PreviewMap {
      isMoving(): boolean;
      on(event: "idle" | "moveend", listener: () => void): void;
      off(event: "idle" | "moveend", listener: () => void): void;
    }
    interface MapWaiter {
      readonly map: PreviewMap;
      settled: boolean;
      active: boolean;
      cleanup(): void;
      start(): void;
    }
    const windowWithWaiter = window as Window & { __turnResultPreviewWaiter?: MapWaiter };
    const map = (window as Window & { __sugorokuE2E?: { map?: PreviewMap | null } }).__sugorokuE2E?.map;
    if (!map) throw new Error("The map must be ready before changing preview layout");
    const onSettled = (): void => {
      if (waiter.active && !map.isMoving()) waiter.settled = true;
    };
    const waiter: MapWaiter = {
      map,
      settled: false,
      active: false,
      cleanup: () => {
        map.off("idle", onSettled);
        map.off("moveend", onSettled);
      },
      start: () => { waiter.active = true; },
    };
    map.on("idle", onSettled);
    map.on("moveend", onSettled);
    windowWithWaiter.__turnResultPreviewWaiter = waiter;
  });
  await page.evaluate(() => {
    const waiter = (window as Window & { __turnResultPreviewWaiter?: { start(): void } }).__turnResultPreviewWaiter;
    if (!waiter) throw new Error("The preview settle waiter was not registered");
    waiter.start();
  });
  await action();
  await page.waitForFunction(() => {
    const waiter = (window as Window & {
      __turnResultPreviewWaiter?: { readonly map: { isMoving(): boolean }; readonly settled: boolean };
    }).__turnResultPreviewWaiter;
    return waiter?.settled === true && !waiter.map.isMoving();
  });
  await page.evaluate(() => {
    const windowWithWaiter = window as Window & { __turnResultPreviewWaiter?: { cleanup(): void } };
    windowWithWaiter.__turnResultPreviewWaiter?.cleanup();
    delete windowWithWaiter.__turnResultPreviewWaiter;
  });
}

test("adjustment preview avoids result pill", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  for (const viewport of PREVIEW_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const recipe = itemScenario("adjust", railwayBundle.network);
    await page.goto("/");
    await writeSaveText(page, serializeGame(recipe));
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    const pill = page.locator(".turn-result__pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAccessibleName(/\S/);
    await expect(diceReady(page)).toBeVisible();
    await expect.poll(async () => readMap(page)).not.toBeNull();

    const dialog = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await actAndWaitForPreviewMapSettled(page, () => diceButton(page).click());
    await expect(dialog).toBeVisible();
    const initial = await readPreviewAvoidanceGeometry(page);
    assertPreviewAvoidance(initial);
    const initialGaps = {
      bubble: minimumGap(initial.targets, "bubble", initial.pill),
      leader: minimumGap(initial.targets, "leader", initial.pill),
      origin: minimumGap(initial.targets, "origin", initial.pill),
    };

    const resizedViewport = { width: viewport.width, height: viewport.height - PREVIEW_PANEL_RESIZE_PX };
    await actAndWaitForPreviewMapSettled(page, () => page.setViewportSize(resizedViewport));
    await expect.poll(async () => {
      const current = await readPreviewAvoidanceGeometry(page);
      const samePillSize = current.pill.right - current.pill.left === initial.pill.right - initial.pill.left &&
        current.pill.bottom - current.pill.top === initial.pill.bottom - initial.pill.top;
      const pillMoved = Math.abs(current.pill.top - initial.pill.top) > PILL_POSITION_CHANGE_TOLERANCE_PX;
      const initialCallouts = initial.targets.filter((target) => target.kind !== "origin").map((target) => target.rect);
      const currentCallouts = current.targets.filter((target) => target.kind !== "origin").map((target) => target.rect);
      return samePillSize && pillMoved && JSON.stringify(currentCallouts) !== JSON.stringify(initialCallouts);
    }).toBe(true);
    const resized = await readPreviewAvoidanceGeometry(page);
    assertPreviewAvoidance(resized);
    const resizedGaps = {
      bubble: minimumGap(resized.targets, "bubble", resized.pill),
      leader: minimumGap(resized.targets, "leader", resized.pill),
      origin: minimumGap(resized.targets, "origin", resized.pill),
    };
    const measurements = {
      initial: { viewport, pill: initial.pill, panel: initial.panel, minGapsPx: initialGaps },
      afterPanelGeometryChange: { viewport: resizedViewport, pill: resized.pill, panel: resized.panel, minGapsPx: resizedGaps },
    };
    testInfo.annotations.push({ type: "preview-pill-clearance", description: JSON.stringify(measurements) });
    console.info("adjustment preview pill clearance", measurements);
    await dialog.getByRole("button", { name: "そのまま続ける" }).click();
    await expect(dialog).toBeHidden();
  }
});

async function readMarkerPillMeasurement(page: Page): Promise<MarkerPillMeasurement> {
  const mapSnapshot = await readMap(page);
  if (!mapSnapshot?.marker) throw new Error("The current-position marker was not available");
  return page.evaluate(({ marker, markerHalfSize }) => {
    interface MarkerMap {
      getContainer(): HTMLElement;
      project(position: [number, number]): { readonly x: number; readonly y: number };
    }
    const map = (window as Window & { __sugorokuE2E?: { map?: MarkerMap | null } }).__sugorokuE2E?.map;
    const pill = document.querySelector<HTMLElement>(".turn-result__pill");
    if (!map || !pill) throw new Error("The map hook or visible result pill was missing");
    const mapRect = map.getContainer().getBoundingClientRect();
    const pillBounds = pill.getBoundingClientRect();
    const projected = map.project(marker);
    const centerX = mapRect.left + projected.x;
    const centerY = mapRect.top + projected.y;
    const markerRect = {
      left: centerX - markerHalfSize,
      top: centerY - markerHalfSize,
      right: centerX + markerHalfSize,
      bottom: centerY + markerHalfSize,
    };
    const pillRect = { left: pillBounds.left, top: pillBounds.top, right: pillBounds.right, bottom: pillBounds.bottom };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      marker: markerRect,
      pill: pillRect,
      verticalClearancePx: pillRect.top - markerRect.bottom,
      horizontalClearancePx: Math.max(pillRect.left - markerRect.right, markerRect.left - pillRect.right),
      intersects: markerRect.left < pillRect.right && markerRect.right > pillRect.left &&
        markerRect.top < pillRect.bottom && markerRect.bottom > pillRect.top,
    };
  }, { marker: mapSnapshot.marker, markerHalfSize: MARKER_HALF_SIZE_PX });
}

test("follow camera keeps marker clear of result pill", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  for (const viewport of FOLLOW_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await prepareR1(page, railwayBundle);
    const pill = page.locator(".turn-result__pill");
    await expect(pill).toBeVisible();
    for (let turnIndex = 0; turnIndex < FOLLOW_NORMAL_TURN_COUNT; turnIndex += 1) {
      const turnBefore = (await readSave(page))?.turn;
      if (turnBefore === undefined) throw new Error("R1 save was not available before a normal turn");
      await rollOnce(page);
      const saved = await readSave(page);
      const record = saved?.movementHistory.at(-1);
      if (saved?.turn !== turnBefore + 1 || !record) throw new Error(`Normal turn ${turnBefore + 1} did not finish`);
      expect(saved.pending, `turn ${saved.turn} must not leave a pending discard`).toBeNull();
      expect(record.kind, `turn ${saved.turn} must remain a normal item ride`).toBe("item-ride");
      if (record.kind !== "item-ride") throw new Error(`turn ${saved.turn} was not an item ride`);
      expect(record.adjustment, `turn ${saved.turn} must not adjust the die`).toBeNull();
      expect(record.itemEvents.some((event) => event.type === "pickup-pending-discard"),
        `turn ${saved.turn} must not require a discard`).toBe(false);
      await expect(diceReady(page)).toBeVisible();
      await expect.poll(async () => page.evaluate(() => {
        const map = (window as Window & { __sugorokuE2E?: { map?: { isMoving(): boolean } | null } }).__sugorokuE2E?.map;
        return map !== undefined && map !== null && !map.isMoving();
      })).toBe(true);
      const measurement = await readMarkerPillMeasurement(page);
      testInfo.annotations.push({
        type: "follow-marker-pill-clearance",
        description: `turn ${saved.turn} ${JSON.stringify(measurement)}`,
      });
      console.info("follow camera marker vs result pill", { turn: saved.turn, ...measurement });
      expect(measurement.intersects,
        `turn ${saved.turn} marker ${JSON.stringify(measurement.marker)} overlaps pill ${JSON.stringify(measurement.pill)}`)
        .toBe(false);
    }
  }
});

const RECT_CONTAINMENT_TOLERANCE_PX = 1;
const FORCED_TRUNCATION_STATION_CHARACTERS = 3;
const R5_VIEWPORT = { width: 320, height: 568 } as const;
const RESULT_VARIANT_SELECTORS = [".turn-result", ".turn-result__compact", ".turn-result__pill"] as const;
type ResultVariantSelector = (typeof RESULT_VARIANT_SELECTORS)[number];
const ROTATION_SEQUENCE: readonly { readonly width: number; readonly height: number; readonly variant: ResultVariantSelector }[] = [
  { width: 390, height: 844, variant: ".turn-result__pill" },
  { width: 667, height: 375, variant: ".turn-result__compact" },
  { width: 1280, height: 800, variant: ".turn-result" },
  { width: 320, height: 568, variant: ".turn-result__pill" },
  { width: 844, height: 390, variant: ".turn-result__compact" },
  { width: 390, height: 844, variant: ".turn-result__pill" },
];

test("result variants rotate without duplicates", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  const [firstSize] = ROTATION_SEQUENCE;
  if (!firstSize) throw new Error("Rotation sequence is empty");
  await page.setViewportSize(firstSize);
  const { expected } = await prepareR1(page, railwayBundle);
  const pillName = `${expected.compact.accessibleName}。ターンのログを開く`;
  let firstLiveCount: number | null = null;
  for (const size of ROTATION_SEQUENCE) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    // Rendered variants (not display:none, not visibility:hidden, with a box), re-read until the layout settles.
    await expect.poll(async () => page.evaluate((selectors) => selectors.filter((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.getClientRects().length === 0) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }), RESULT_VARIANT_SELECTORS), `${label} rendered variants`).toEqual([size.variant]);
    const visibleVariant = page.locator(size.variant);
    const headingInstances = await page.evaluate(({ selectors, heading }) => selectors
      .flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
      .filter((element) => element.getClientRects().length > 0 &&
        `${element.innerText}\n${element.getAttribute("aria-label") ?? ""}`.includes(heading)).length,
    { selectors: RESULT_VARIANT_SELECTORS, heading: expected.heading });
    expect(headingInstances, `${label} turn heading exposed by one visible variant`).toBe(1);
    if (size.variant === ".turn-result") {
      await expect(visibleVariant).toHaveAccessibleName(expected.heading);
      await expect(visibleVariant.locator(".turn-result__heading")).toHaveText(expected.heading);
      await expect(visibleVariant.locator(".turn-result__move")).toHaveText(expected.moveText);
    } else {
      await expect(visibleVariant).toContainText(expected.heading);
      expect(await compactText(visibleVariant)).toBe(expected.compact.text);
    }
    const pill = page.locator(".turn-result__pill");
    if (size.variant !== ".turn-result__pill") await expect(pill).toBeEmpty();
    if (size.variant === ".turn-result__pill") {
      await expect(pill).toHaveAccessibleName(pillName);
      const readGeometry = async () => page.evaluate(() => {
        const pillElement = document.querySelector<HTMLElement>(".turn-result__pill");
        const panel = document.querySelector<HTMLElement>(".game-panel");
        if (!pillElement || !panel) throw new Error("Phone result geometry is missing");
        const pillRect = pillElement.getBoundingClientRect();
        return { pill: { left: pillRect.left, top: pillRect.top, right: pillRect.right, bottom: pillRect.bottom },
          panelTop: panel.getBoundingClientRect().top, viewportWidth: innerWidth };
      });
      // Pill bottom and panel top are read in one evaluation, retried until the measured position commits.
      await expect.poll(async () => {
        const geometry = await readGeometry();
        return Math.abs(geometry.pill.bottom - (geometry.panelTop - TURN_RESULT_PILL_GAP_PX));
      }, `${label} pill sits on the measured panel top`).toBeLessThanOrEqual(PILL_POSITION_CHANGE_TOLERANCE_PX);
      const geometry = await readGeometry();
      expect(geometry.pill.right).toBeLessThanOrEqual(geometry.viewportWidth - PILL_RIGHT_CLEARANCE_PX);
      testInfo.annotations.push({ type: "variant-phone-geometry", description: `${label}: ${JSON.stringify(geometry)}` });
    }
    const liveCount = await page.locator('[aria-live], [role="status"]').count();
    firstLiveCount ??= liveCount;
    expect(liveCount, `live region count at ${label}`).toBe(firstLiveCount);
    testInfo.annotations.push({ type: "variant-measurement", description: `${label}: ${size.variant}, live=${liveCount}` });
  }
});

test.describe("product R5", () => {
  test.use({ dataset: "real" });
  test.describe.configure({ timeout: 90_000 });

  test("long result truncates with complete accessible name", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
    const presentation = createPresentationResolver(railwayBundle.network,
      railwayBundle.data.manifest.ok ? railwayBundle.data.manifest.value.uiPresentation : undefined);
    const state = replayLongestProductResult(railwayBundle.network, presentation);
    const expected = expectedSavedResult(state, railwayBundle);
    const segmentChip = expected.chips.find((chip) => chip.kind === "segments");
    if (!segmentChip || segmentChip.kind !== "segments") {
      throw new Error(`R5 selected result has no new target segments: ${JSON.stringify({ turn: expected.turn, chips: expected.chips })}`);
    }
    await page.setViewportSize(R5_VIEWPORT);
    await restoreResultState(page, state);
    const pill = page.locator(".turn-result__pill");
    await expect(pill).toBeVisible();
    const accessibleName = `${expected.compact.accessibleName}。ターンのログを開く`;
    await expect(pill).toHaveAccessibleName(accessibleName);
    expect(expected.compact.text).toContain(expected.arrivalStation);
    expect(expected.compact.text).toContain(`+${segmentChip.count}区間`);
    const readParts = async () => pill.evaluate((element) => {
      const part = (name: string): HTMLElement => {
        const found = element.querySelector<HTMLElement>(`.turn-result__compact-${name}`);
        if (!found) throw new Error(`R5 pill is missing ${name}`);
        return found;
      };
      const face = part("face");
      const station = part("station");
      const segments = part("segments");
      const pillRect = element.getBoundingClientRect();
      const box = (node: HTMLElement) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width,
          clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
      };
      const style = (node: HTMLElement) => {
        const computed = getComputedStyle(node);
        return { overflow: computed.overflow, textOverflow: computed.textOverflow };
      };
      return { pill: { left: pillRect.left, right: pillRect.right }, face: box(face), station: box(station),
        segments: box(segments), faceStyle: style(face), stationStyle: style(station), segmentsStyle: style(segments) };
    });
    const contains = (part: { left: number; right: number }, pillBox: { left: number; right: number }): boolean =>
      part.left >= pillBox.left - RECT_CONTAINMENT_TOLERANCE_PX && part.right <= pillBox.right + RECT_CONTAINMENT_TOLERANCE_PX;
    let measurements = await readParts();
    let truncationBranch = "natural";
    if (measurements.station.scrollWidth <= measurements.station.clientWidth) {
      truncationBranch = "forced-measured-width";
      const cap = await pill.evaluate((element, characterCount) => {
        const face = element.querySelector<HTMLElement>(".turn-result__compact-face");
        const station = element.querySelector<HTMLElement>(".turn-result__compact-station");
        const segments = element.querySelector<HTMLElement>(".turn-result__compact-segments");
        if (!face || !station || !segments) throw new Error("R5 truncation parts are missing");
        const computed = getComputedStyle(element);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas text measurement is unavailable");
        context.font = getComputedStyle(station).font;
        const characterWidth = context.measureText(station.textContent?.trim().charAt(0) ?? "駅").width;
        const width = face.getBoundingClientRect().width + segments.getBoundingClientRect().width + characterWidth * characterCount +
          Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight) +
          Number.parseFloat(computed.borderLeftWidth) + Number.parseFloat(computed.borderRightWidth);
        element.style.maxWidth = `${width}px`;
        return { width, characterWidth };
      }, FORCED_TRUNCATION_STATION_CHARACTERS);
      await expect.poll(async () => (await readParts()).station.scrollWidth > (await readParts()).station.clientWidth).toBe(true);
      await expect(pill).toHaveAccessibleName(accessibleName);
      testInfo.annotations.push({ type: "r5-measured-cap", description: JSON.stringify(cap) });
      measurements = await readParts();
    }
    expect(measurements.face.scrollWidth).toBeLessThanOrEqual(measurements.face.clientWidth);
    expect(measurements.segments.scrollWidth).toBeLessThanOrEqual(measurements.segments.clientWidth);
    expect(measurements.station.scrollWidth).toBeGreaterThan(measurements.station.clientWidth);
    expect(measurements.stationStyle).toEqual({ overflow: "hidden", textOverflow: "ellipsis" });
    expect(measurements.faceStyle.overflow).not.toBe("hidden");
    expect(measurements.faceStyle.textOverflow).not.toBe("ellipsis");
    expect(measurements.segmentsStyle.overflow).not.toBe("hidden");
    expect(measurements.segmentsStyle.textOverflow).not.toBe("ellipsis");
    expect(contains(measurements.face, measurements.pill)).toBe(true);
    expect(contains(measurements.segments, measurements.pill)).toBe(true);
    expect(measurements.pill.right).toBeLessThanOrEqual(R5_VIEWPORT.width - PILL_RIGHT_CLEARANCE_PX);
    await expect(pill).toHaveAccessibleName(accessibleName);
    testInfo.annotations.push({ type: "r5-truncation", description: `${truncationBranch}; station=${expected.arrivalStation}; ` +
      `length=${expected.arrivalStation.length}; N=${segmentChip.count}; ${JSON.stringify(measurements)}` });
  });
});

test("native dialog Escape preserves log", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const recipe = itemScenario("adjust", railwayBundle.network);
  await restoreResultState(page, recipe);
  await expect(page.getByRole("heading", { name: ITEM_DESCRIPTIONS["roll-adjust"].name, exact: true })).toBeVisible();
  await expect(diceReady(page)).toBeVisible();
  const savedBefore = await readSave(page);
  if (!savedBefore) throw new Error("R2 save was unavailable before opening the log");
  const turnBefore = savedBefore.turn;
  const pill = page.locator(".turn-result__pill");
  const trigger = gamePanel(page).locator(".phone-menu__trigger");
  const log = gamePanel(page).getByRole("region", { name: "ターンのログ", exact: true });
  await pill.click();
  await expect(log).toBeVisible();
  await expect(log).toBeFocused();
  await diceButton(page).click();
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect(adjustment).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(adjustment).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(log).toBeVisible();
  await expect.poll(async () => {
    const saved = await readSave(page);
    return saved?.pending?.kind === "discard" || saved?.turn === turnBefore + 1;
  }).toBe(true);
  if ((await readSave(page))?.pending?.kind === "discard") {
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button").last().click();
  }
  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  await expect(diceReady(page).or(page.locator("#clear-title"))).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(log).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();
  await expect(pill).toBeFocused();
  await pill.click();
  await expect(log).toBeVisible();
  // One disclosure surface at a time (pre-existing GamePanel contract): the menu replaces the pill-opened log and
  // clears its opener, so closing the menu returns focus to the menu trigger and never to the pill.
  await openGameMenu(page);
  const menu = gamePanel(page).getByRole("region", { name: "メニュー", exact: true });
  const menuTrigger = trigger;
  await expect(log).toBeHidden();
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuTrigger).toBeFocused();
  await expect(log).toBeHidden();
  await expect(pill).not.toBeFocused();
  await trigger.click();
  await expect(log).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(pill).not.toBeFocused();
});

test("turn zero and clear remove visible results", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  const clear = replayFixtureClear(railwayBundle.network);
  const predicted = acceptOfflineTurn(clear.predecessor, railwayBundle.network);
  const clearPredicates = { predecessorTurn: clear.predecessor.turn, predictedStatus: predicted.status,
    predictedTurn: predicted.turn, completedTurn: clear.completed.turn };
  if (predicted.status !== "completed" || predicted.turn !== clear.completed.turn) {
    throw new Error(`Pre-clear fixture predicates failed: ${JSON.stringify(clearPredicates)}`);
  }
  testInfo.annotations.push({ type: "pre-clear-turn", description: JSON.stringify(clearPredicates) });
  await seedGameSettings(page, { speedId: "normal", follow: false, presentationLevel: "none" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startNewGame(page);
  const pill = page.locator(".turn-result__pill");
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(pill).toBeHidden();
  await expect(pill).toBeEmpty();
  await expect(gamePanel(page).locator(".turn-result, .turn-result__compact")).toBeHidden();
  await expect(page.getByRole("button", { name: /ターンのログを開く/ })).toHaveCount(0);
  const expectedBefore = expectedSavedResult(clear.predecessor, railwayBundle);
  await restoreResultState(page, clear.predecessor);
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAccessibleName(`${expectedBefore.compact.accessibleName}。ターンのログを開く`);
  const formerPill = await pill.boundingBox();
  if (!formerPill) throw new Error("Pre-clear result pill had no measured rectangle");
  await diceReady(page).click();
  await expect(page.locator(".clear-screen")).toBeVisible();
  await expect(page.locator("#clear-title")).toBeVisible();
  const checkClear = async () => {
    await expect(page.locator(".game-panel")).toHaveCount(0);
    await expect(page.locator(".turn-result__pill, .turn-result, .turn-result__compact")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ターンのログを開く/ })).toHaveCount(0);
    const leftover = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).some((element) =>
      element.matches(".turn-result__pill, .turn-result, .turn-result__compact") ||
      element.closest(".turn-result__pill, .turn-result, .turn-result__compact") !== null),
    { x: formerPill.x + formerPill.width / 2, y: formerPill.y + formerPill.height / 2 });
    expect(leftover, "former phone pill centre must not contain result UI").toBe(false);
  };
  await checkClear();
  for (const size of [{ width: 1280, height: 800 }, { width: 667, height: 375 }] as const) {
    await page.setViewportSize(size);
    await expect(page.locator(".clear-screen")).toBeVisible();
    await expect(page.locator("#clear-title")).toBeVisible();
    await checkClear();
  }
});

test("resume shows the last turn after reload", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  const chosen = findTargetTurn(itemScenario("route", railwayBundle.network), railwayBundle.network);
  const resultCount = chosen.newTargetSegmentCount;
  testInfo.annotations.push({ type: "resume-replay", description: JSON.stringify({ before: chosen.before.turn,
    after: chosen.after.turn, newTargetSegmentCount: resultCount, pending: chosen.after.pending?.kind ?? null }) });
  await seedGameSettings(page, { speedId: "normal", follow: false, presentationLevel: "none" });
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreResultState(page, chosen.before);
  await diceReady(page).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(chosen.before.turn + 1);
  const saved = await readSave(page);
  if (!saved) throw new Error("Resume result save was unavailable");
  const expected = expectedSavedResult(saved, railwayBundle);
  expect(expected.turn).toBe(chosen.before.turn + 1);
  const segmentChip = expected.chips.find((chip) => chip.kind === "segments");
  if (!segmentChip || segmentChip.kind !== "segments" || segmentChip.count !== resultCount) {
    throw new Error(`Resume result count did not match offline replay: ${JSON.stringify({ resultCount, chips: expected.chips })}`);
  }
  const pill = page.locator(".turn-result__pill");
  await expect(pill).toBeVisible();
  const expectedName = `${expected.compact.accessibleName}。ターンのログを開く`;
  await expect(pill).toHaveAccessibleName(expectedName);
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(pill).toHaveAccessibleName(expectedName);
  await expect.poll(async () => (await readSave(page))?.turn).toBe(expected.turn);
  const resumed = await readSave(page);
  if (!resumed) throw new Error("Resumed result save was unavailable");
  expect(await pill.getAttribute("aria-label")).toBe(`${expectedSavedResult(resumed, railwayBundle).compact.accessibleName}。ターンのログを開く`);
  await page.setViewportSize({ width: 1280, height: 800 });
  const card = gamePanel(page).locator(".turn-result");
  await expect(card).toBeVisible();
  await expect(card.locator(".turn-result__heading")).toHaveText(expected.heading);
  await expect(card.locator(".turn-result__move")).toHaveText(expected.moveText);
  await expect(card.locator(".turn-result__chip-label").filter({ hasText: `+${resultCount}区間` })).toBeVisible();
});

test("presentation none and skip publish immediately — 演出なし", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  const prediction = predictR1NextTurn(railwayBundle);
  const previous = expectedSavedResult(prediction.before, railwayBundle);
  const expected = expectedSavedResult(prediction.after, railwayBundle);
  expect(expected.turn).toBe(previous.turn + 1);
  expect(expected.compact.accessibleName).not.toBe(previous.compact.accessibleName);
  await seedGameSettings(page, { speedId: "normal", follow: false, presentationLevel: "none" });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareR1(page, railwayBundle);
  const pill = page.locator(".turn-result__pill");
  await expect(pill).toHaveAccessibleName(`${previous.compact.accessibleName}。ターンのログを開く`);
  // Record the pill name in the same DOM mutation callback in which the HUD turn first advances with the dice
  // ready again, so a publication later than the returning dice cannot be absorbed by a retrying assertion.
  await page.evaluate(() => {
    const state = window as Window & { __turnResultAtReady?: string | null };
    const turnStat = document.querySelector<HTMLElement>('.game-panel [data-stat="turn"]');
    if (!turnStat) throw new Error("HUD turn stat is missing");
    const turnBefore = turnStat.textContent;
    state.__turnResultAtReady = null;
    const observer = new MutationObserver(() => {
      const dice = document.querySelector<HTMLElement>(".game-panel .game-panel__roll");
      const turnNow = document.querySelector<HTMLElement>('.game-panel [data-stat="turn"]')?.textContent;
      if (turnNow === turnBefore || dice?.getAttribute("aria-disabled") !== "false") return;
      state.__turnResultAtReady = document.querySelector(".turn-result__pill")?.getAttribute("aria-label") ?? "";
      observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await diceReady(page).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(prediction.after.turn);
  await expect(diceReady(page)).toBeVisible();
  const atReady = await page.evaluate(() => (window as Window & { __turnResultAtReady?: string | null }).__turnResultAtReady);
  expect(atReady, "pill name when the dice first became ready").toBe(`${expected.compact.accessibleName}。ターンのログを開く`);
  await expect(pill).not.toContainText(`${previous.turn}ターン目`);
  expect(await compactText(pill)).toBe(expected.compact.text);
});

test("presentation none and skip publish immediately — Skip", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  const prediction = predictR1NextTurn(railwayBundle);
  await seedGameSettings(page, { speedId: "normal", follow: false, presentationLevel: "all" });
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreFrozenR3(page, prediction.before);
  const previous = expectedSavedResult(prediction.before, railwayBundle);
  const pill = page.locator(".turn-result__pill");
  await expect(pill).toHaveAccessibleName(`${previous.compact.accessibleName}。ターンのログを開く`);
  await diceButton(page).click();
  await awaitStage(page, "tumble");
  await expect(pill).toHaveAccessibleName(`${previous.compact.accessibleName}。ターンのログを開く`);
  await pressSkip(page);
  await expect.poll(async () => (await readSave(page))?.turn).toBe(prediction.after.turn);
  await expect(diceReady(page)).toBeVisible();
  const saved = await readSave(page);
  if (!saved) throw new Error("Skip result save was unavailable");
  const expected = expectedSavedResult(saved, railwayBundle);
  await expect(pill).toHaveAccessibleName(`${expected.compact.accessibleName}。ターンのログを開く`);
  expect(await compactText(pill)).toBe(expected.compact.text);
  await expect(page.locator(".turn-moment-host__card")).toHaveCount(0);
});

test.describe("product R4", () => {
  test.use({ dataset: "real", reducedMotion: "reduce" });
  // The first test in each worker scans real-data seeds for the populated save (same budget as ui-pop's S23).
  test.describe.configure({ timeout: 90_000 });

  test("populated result preserves desktop budget", async ({ page, railwayBundle }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const populated = populatedResultState(railwayBundle.network);
    const expected = expectedSavedResult(populated.next, railwayBundle);
    await openPopulatedResult(page, populated);
    const panel = gamePanel(page);
    const card = panel.getByRole("region", { name: expected.heading, exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator(".turn-result__move")).toHaveText(expected.moveText);
    expect(await card.locator(".turn-result__chip-label").allTextContents()).toEqual(expected.chips.map((chip) => chip.label));
    expect(await panel.locator(".item-slot:not(.item-slot--empty)").count()).toBe(3);
    expect(await panel.locator(".effect-chip").count()).toBeGreaterThanOrEqual(2);
    await expect(panel.locator(".game-panel__save")).toContainText("失敗");

    const measurements = await panel.evaluate((root) => {
      const panelRect = root.getBoundingClientRect();
      const fits = (element: Element): boolean => {
        const box = element.getBoundingClientRect();
        return box.top >= panelRect.top - 1 && box.bottom <= panelRect.bottom + 1;
      };
      const allFit = (selector: string): boolean => {
        const elements = [...root.querySelectorAll(selector)];
        return elements.length > 0 && elements.every(fits);
      };
      const box = (selector: string): DOMRect => root.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return {
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        reserveHeight: box(".turn-result__reserve").height,
        headingMoveTopDelta: box(".turn-result__move").top - box(".turn-result__heading").top,
        card: allFit(".turn-result"),
        reserve: allFit(".turn-result__reserve"),
        chips: root.querySelector(".turn-result__chip") === null || allFit(".turn-result__chip"),
        staged: allFit(".item-staged-summary"),
        slots: allFit(".item-slot"),
        effects: allFit(".effect-chip"),
        save: allFit(".game-panel__save"),
        dice: allFit(".game-panel__roll"),
      };
    });
    testInfo.annotations.push({ type: "measurement", description: `1280x800 R4 ${JSON.stringify(measurements)}` });
    expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.clientHeight + 1);
    // #65 slot is named but reserves no space (Revision 4, user 2026-11-14).
    expect(measurements.reserveHeight).toBe(0);
    expect(Math.abs(measurements.headingMoveTopDelta)).toBeLessThanOrEqual(1);
    expect(measurements).toMatchObject({ card: true, reserve: true, chips: true, staged: true, slots: true,
      effects: true, save: true, dice: true });
  });
});

test("manual rolls publish result cards in order and the pill opens the log", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  const replay = replayTwoManualRolls(railwayBundle.network);
  const pillName = (game: ItemGameState): string => `${expectedSavedResult(game, railwayBundle).compact.accessibleName}。ターンのログを開く`;
  const names = [pillName(replay.before), pillName(replay.first), pillName(replay.second)];
  expect(new Set(names).size, "each predicted publication must change the pill name").toBe(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreResultState(page, replay.before);
  const pill = page.locator(".turn-result__pill");
  await expect(pill).toHaveAccessibleName(names[0]!);
  await page.evaluate(() => {
    const state = window as Window & { __pillNames?: string[] };
    // Seed with the restored name so only later publications append.
    const names: string[] = [document.querySelector(".turn-result__pill")?.getAttribute("aria-label") ?? ""];
    state.__pillNames = names;
    new MutationObserver(() => {
      const name = document.querySelector(".turn-result__pill")?.getAttribute("aria-label") ?? "";
      if (name !== "" && name !== names.at(-1)) names.push(name);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
  });
  await expect(gamePanel(page).locator("[role=status]")).toHaveCount(1);
  await rollOnce(page);
  await expect(pill).toHaveAccessibleName(names[1]!);
  await rollOnce(page);
  await expect(pill).toHaveAccessibleName(names[2]!);
  const observed = await page.evaluate(() => (window as Window & { __pillNames?: string[] }).__pillNames ?? []);
  expect(observed, "restored pill name, then one per manual publication, in order").toEqual(names);

  await pill.click();
  const log = gamePanel(page).getByRole("region", { name: "ターンのログ", exact: true });
  await Promise.all([expect(log).toBeVisible(), expect(log).toBeFocused(), expect(pill).toHaveAttribute("aria-expanded", "true")]);
  expect((await readSave(page))?.turn).toBe(replay.second.turn);
  await expect(pill).toHaveAccessibleName(names[2]!);
  await expect(log).toBeVisible();
});

test("a manual roll applies the staged item draft", async ({ page, railwayBundle }) => {
  const base = itemScenario("double", railwayBundle.network);
  const double = base.inventory.find((item) => item.kind === "double");
  if (!double) throw new Error("The fixture has no double ticket to stage");
  await restoreResultState(page, base);
  await useInventoryItem(page, "倍速券");
  await expect(gamePanel(page).locator(".item-staged-summary")).toContainText("倍速券");

  await rollOnce(page);
  const record = (await readSave(page))?.movementHistory.at(-1);
  expect(record?.command.items).toContainEqual(expect.objectContaining({ kind: "double", instanceId: double.id }));
});
