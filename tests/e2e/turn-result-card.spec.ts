import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { itemLastMove } from "../../src/features/game/itemSession";
import { deriveTurnResult, replayTurnResultHistory } from "../../src/features/game/turnResultCard";
import { playItemTurn, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import type { ItemGameState, ItemTurnRecord } from "../../src/types/network";
import { CURRENT_POSITION_RADIUS, CURRENT_POSITION_STROKE_WIDTH } from "../../src/features/map/mapConfig";
import { TURN_RESULT_PILL_GAP_PX } from "../../src/features/game/turnResultPillLayout";
import { LOTTERY_FIT_MIN_SCALE, MIN_CARD_REGION_PX } from "../../src/features/game/components/TurnMomentHost";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { expect, test } from "./fixtures";
import type { Page, Locator } from "@playwright/test";
import type { RailwayBundle } from "./fixtures/bundle";
import { itemScenario } from "./fixtures/itemScenarios";
import {
  diceReady,
  gamePanel,
  hudCompactRoll,
  openGameMenu,
  panelStat,
  readMap,
  readSave,
  rollOnce,
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
  const trigger = panel.getByRole("button", { name: "ログ", exact: true });
  const menuTrigger = panel.getByRole("button", { name: "メニュー", exact: true });
  const regionId = await log.getAttribute("id");
  if (!regionId) throw new Error("turn log region has no id");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveRole("button");
  await expect(pill).toHaveAccessibleName(`${expected.compact.accessibleName}。ターンのログを開く`);
  await expect(pill).toHaveAttribute("aria-label", `${expected.compact.accessibleName}。ターンのログを開く`);
  await Promise.all([expect(pill).toHaveAttribute("aria-controls", regionId), expect(trigger).toHaveAttribute("aria-controls", regionId)]);
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
  await pill.click();
  await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
  await assertRevealed();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(pill).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();
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
  const trigger = panel.getByRole("button", { name: "ログ", exact: true });
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
    return [...board.querySelectorAll<HTMLElement>(".lottery-reveal__row")].map((row, index) => {
      const target = box(document.querySelector(targets[index]!)!);
      const animation = row.getAnimations().find((candidate) =>
        candidate instanceof CSSAnimation && candidate.animationName === "lottery-settle");
      if (!animation) throw new Error("Expected the lottery settle CSS animation");
      animation.pause();
      animation.currentTime = Number(animation.effect!.getComputedTiming().duration);
      const end = box(row);
      animation.currentTime = 0;
      return { motion: row.dataset.motion ?? null, end, target };
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
          const centre = (rect: FlightLanding["end"]) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
          expect(Math.abs(centre(landing.end).x - centre(landing.target).x), "settled row centre x").toBeLessThanOrEqual(MAX_FLIGHT_LANDING_ERROR_PX);
          expect(Math.abs(centre(landing.end).y - centre(landing.target).y), "settled row centre y").toBeLessThanOrEqual(MAX_FLIGHT_LANDING_ERROR_PX);
          expect(Math.abs(landing.end.width - landing.target.width), "settled row width").toBeLessThanOrEqual(MAX_FLIGHT_LANDING_ERROR_PX);
          expect(Math.abs(landing.end.height - landing.target.height), "settled row height").toBeLessThanOrEqual(MAX_FLIGHT_LANDING_ERROR_PX);
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
