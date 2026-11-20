import { playItemTurn, serializeGame } from "../../src/features/game/engine";
import { expect, test } from "./fixtures";
import { combinedMomentGame, clickDice, freezeClock, writeSaveText } from "./support/app";
import { advanceArrival, advanceLotteryFlip, advanceMovement, advanceStamps, advanceTumble, awaitStage } from "./support/turnMoments";

const VIEWPORT = { width: 320, height: 480 } as const;
const SETTLE_SAMPLE_MS = 384;

/** Installed before navigation. It observes browser events without changing product code or observer targets. */
function installIssue95ObserverRecorder(): void {
  type RecordedEvent = { type: string; timestampMs: number; [key: string]: unknown };
  type Recorder = { events: RecordedEvent[]; samples: unknown[]; samplingActive?: boolean };
  const host = window as Window & { __diag95?: Recorder };
  const recorder: Recorder = { events: [], samples: [] };
  host.__diag95 = recorder;
  const log = (event: RecordedEvent): void => {
    recorder.events.push(event);
  };
  const timestamp = (): number => performance.now();
  const describe = (target: Element): Record<string, unknown> => ({
    tagName: target.tagName,
    id: target.id,
    className: typeof target.className === "string" ? target.className : "",
    dataStage: target.getAttribute("data-stage"),
    dataMotion: target.getAttribute("data-motion"),
    dataStat: target.getAttribute("data-stat"),
  });
  const sizes = (value: ResizeObserverSize | readonly ResizeObserverSize[] | undefined): unknown =>
    value ? Array.from(value as ArrayLike<ResizeObserverSize>, (size) => ({ inlineSize: size.inlineSize, blockSize: size.blockSize })) : null;

  const NativeResizeObserver = window.ResizeObserver;
  if (NativeResizeObserver) {
    class RecordingResizeObserver extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          log({
            type: "resize-observer",
            timestampMs: timestamp(),
            entries: entries.map((entry) => ({
              target: describe(entry.target),
              contentRect: { x: entry.contentRect.x, y: entry.contentRect.y, width: entry.contentRect.width, height: entry.contentRect.height },
              contentBoxSize: sizes(entry.contentBoxSize),
              borderBoxSize: sizes(entry.borderBoxSize),
              devicePixelContentBoxSize: sizes(entry.devicePixelContentBoxSize),
            })),
          });
          callback(entries, observer);
        });
      }
    }
    window.ResizeObserver = RecordingResizeObserver;
  } else {
    log({ type: "resize-observer-unavailable", timestampMs: timestamp() });
  }

  const logEvent = (type: string, detail: Record<string, unknown> = {}): void => log({ type, timestampMs: timestamp(), ...detail });
  for (const type of ["resize", "orientationchange", "scroll", "turn-result-pill-layout"]) {
    window.addEventListener(type, () => logEvent(type, {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualViewport: window.visualViewport ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        scale: window.visualViewport.scale,
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
      } : null,
    }), { passive: true });
  }
  const fontSet = document.fonts;
  for (const type of ["loading", "loadingdone", "loadingerror"] as const) {
    fontSet.addEventListener(type, () => logEvent(`fonts-${type}`, { status: fontSet.status }));
  }
  window.visualViewport?.addEventListener("resize", () => logEvent("visual-viewport-resize", {
    width: window.visualViewport?.width,
    height: window.visualViewport?.height,
    scale: window.visualViewport?.scale,
    offsetLeft: window.visualViewport?.offsetLeft,
    offsetTop: window.visualViewport?.offsetTop,
  }));
  window.visualViewport?.addEventListener("scroll", () => logEvent("visual-viewport-scroll", {
    width: window.visualViewport?.width,
    height: window.visualViewport?.height,
    scale: window.visualViewport?.scale,
    offsetLeft: window.visualViewport?.offsetLeft,
    offsetTop: window.visualViewport?.offsetTop,
  }));
}

test("issue #95: record the scaled lottery landing at 320x480", async ({ page, railwayBundle }, testInfo) => {
  test.skip(process.env.DIAG_95 !== "1", "Temporary issue #95 diagnostic; set DIAG_95=1 to run it.");
  test.setTimeout(60_000);
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.addInitScript(installIssue95ObserverRecorder);
  await page.goto("/");

  const base = combinedMomentGame(railwayBundle);
  const replay = playItemTurn(base, {}, railwayBundle.network);
  const record = replay.state.pending?.kind === "discard" ? replay.state.pending.record : undefined;
  await writeSaveText(page, serializeGame(base));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await freezeClock(page);

  await clickDice(page);
  await advanceTumble(page);
  if (record?.kind === "item-ride" && (record.movementMode !== "normal" || record.adjustment !== null
    || record.command.items.some((item) => item.kind === "double") || record.effectiveFace !== record.rawRoll
    || record.itemEvents.some((event) => event.type === "effect-activated" && event.effect === "delay"))) {
    await advanceStamps(page);
  }
  await advanceMovement(page, 6_100);
  await awaitStage(page, "arrival");
  await advanceArrival(page);
  await awaitStage(page, "lottery-flip");
  await advanceLotteryFlip(page);
  await awaitStage(page, "lottery-settle");

  await page.evaluate(() => {
    type Box = { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number };
    type Sample = Record<string, unknown>;
    type Recorder = { events: unknown[]; samples: Sample[]; samplingActive?: boolean; samplingStartedAtMs?: number };
    const host = window as Window & { __diag95?: Recorder };
    const recorder = host.__diag95;
    if (!recorder) return;
    const rect = (element: Element | null): Box | null => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom,
        width: bounds.width, height: bounds.height };
    };
    const start = performance.now();
    recorder.samples = [];
    recorder.samplingActive = true;
    recorder.samplingStartedAtMs = start;
    const collectFrame = (): void => {
      if (!recorder.samplingActive) return;
      const board = document.querySelector<HTMLElement>(".lottery-reveal");
      const card = document.querySelector<HTMLElement>(".turn-moment-host__card");
      const region = document.querySelector<HTMLElement>(".turn-moment-host__region");
      if (board && card && region) {
        const boardRect = rect(board)!;
        const cardRect = rect(card)!;
        const regionRect = rect(region)!;
        const boardStyle = getComputedStyle(board);
        const cardStyle = getComputedStyle(card);
        const regionStyle = getComputedStyle(region);
        const cardScaleValue = cardStyle.scale;
        const cardScale = cardScaleValue === "none" ? 1 : Number.parseFloat(cardScaleValue) || 1;
        const boardLayoutSize = { width: boardRect.width / cardScale, height: boardRect.height / cardScale };
        const cardLayoutSize = { width: cardRect.width / cardScale, height: cardRect.height / cardScale };
        const insets = {
          top: Number.parseFloat(regionStyle.paddingTop) || 0,
          right: Number.parseFloat(regionStyle.paddingRight) || 0,
          bottom: Number.parseFloat(regionStyle.paddingBottom) || 0,
          left: Number.parseFloat(regionStyle.paddingLeft) || 0,
        };
        const availableSize = {
          width: regionRect.width - insets.left - insets.right,
          height: regionRect.height - insets.top - insets.bottom,
        };
        const fitsAtOne = boardLayoutSize.width <= availableSize.width && boardLayoutSize.height <= availableSize.height;
        const fittedBox = { width: Math.max(boardLayoutSize.width, cardLayoutSize.width), height: Math.max(boardLayoutSize.height, cardLayoutSize.height) };
        const rawFitScale = Math.min((availableSize.width - 1) / fittedBox.width, (availableSize.height - 1) / fittedBox.height);
        const expectedScaleFromInputs = fitsAtOne ? 1 : Math.min(1, Math.max(0.5, rawFitScale));
        const targetSelectors = ['[data-stat="ride"]', '[data-stat="direction"]'];
        const rows = Array.from(board.querySelectorAll<HTMLElement>(".lottery-reveal__row"));
        const rowSamples = rows.map((row, index) => {
          const style = getComputedStyle(row);
          const animation = row.getAnimations().find((candidate) => candidate instanceof CSSAnimation && candidate.animationName === "lottery-settle");
          return {
            index,
            motion: row.dataset.motion ?? null,
            rowRect: rect(row),
            hudTargetRect: rect(document.querySelector(targetSelectors[index] ?? "")),
            transform: style.transform,
            translate: style.translate,
            customProperties: {
              lotteryX: style.getPropertyValue("--lottery-x").trim(),
              lotteryY: style.getPropertyValue("--lottery-y").trim(),
              lotteryScaleX: style.getPropertyValue("--lottery-sx").trim(),
              lotteryScaleY: style.getPropertyValue("--lottery-sy").trim(),
            },
            animation: animation ? {
              currentTimeMs: Number(animation.currentTime),
              durationMs: Number(animation.effect?.getComputedTiming().duration),
              playState: animation.playState,
            } : null,
          };
        });
        const visualViewport = window.visualViewport;
        recorder.samples.push({
          timestampMs: performance.now(),
          dateTimeMs: Date.now(),
          elapsedMs: performance.now() - start,
          stage: board.dataset.stage,
          scale: {
            computedCardScale: cardScale,
            computedCardScaleCss: cardScaleValue,
            effectiveBoardScale: boardRect.width / Math.max(1, board.offsetWidth),
            sourceInputs: {
              boardRect,
              cardRect,
              regionRect,
              boardOffsetSize: { width: board.offsetWidth, height: board.offsetHeight },
              cardOffsetSize: { width: card.offsetWidth, height: card.offsetHeight },
              boardLayoutSize,
              cardLayoutSize,
              insetsPx: insets,
              availableSizePx: availableSize,
              fitGapPx: 1,
              minimumScale: 0.5,
              expectedScaleFromInputs,
            },
          },
          boardRect,
          targetRows: rowSamples,
          transformInUse: { boardTransform: boardStyle.transform, cardTransform: cardStyle.transform, cardScale: cardStyle.scale },
          documentFontsStatus: document.fonts.status,
          visualViewport: visualViewport ? {
            width: visualViewport.width,
            height: visualViewport.height,
            scale: visualViewport.scale,
            offsetLeft: visualViewport.offsetLeft,
            offsetTop: visualViewport.offsetTop,
          } : null,
        });
      }
      if (performance.now() - start < 420) requestAnimationFrame(collectFrame);
    };
    requestAnimationFrame(collectFrame);
  });

  await page.clock.runFor(SETTLE_SAMPLE_MS);
  const finalLandingChecks = await page.evaluate(() => {
    type Recorder = { events: unknown[]; samples: unknown[]; samplingActive?: boolean };
    const host = window as Window & { __diag95?: Recorder };
    if (host.__diag95) host.__diag95.samplingActive = false;
    const board = document.querySelector<HTMLElement>(".lottery-reveal");
    if (!board) return [];
    const rect = (element: Element | null): { x: number; y: number; width: number; height: number } | null => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    const targets = ['[data-stat="ride"]', '[data-stat="direction"]'];
    const boardScale = board.getBoundingClientRect().width / Math.max(1, board.offsetWidth);
    return Array.from(board.querySelectorAll<HTMLElement>(".lottery-reveal__row"), (row, index) => {
      const animation = row.getAnimations().find((candidate) => candidate instanceof CSSAnimation && candidate.animationName === "lottery-settle");
      const originalTime = animation?.currentTime ?? null;
      const durationMs = Number(animation?.effect?.getComputedTiming().duration ?? 0);
      if (animation) {
        animation.pause();
        animation.currentTime = durationMs;
      }
      const rowRect = rect(row);
      const hudTargetRect = rect(document.querySelector(targets[index] ?? ""));
      if (animation && originalTime !== null) animation.currentTime = originalTime;
      const rowCenterY = rowRect ? rowRect.y + rowRect.height / 2 : null;
      const targetCenterY = hudTargetRect ? hudTargetRect.y + hudTargetRect.height / 2 : null;
      return {
        index,
        motion: row.dataset.motion ?? null,
        boardScale,
        animationDurationMs: durationMs,
        rowRect,
        hudTargetRect,
        centerYErrorPx: rowCenterY === null || targetCenterY === null ? null : Math.abs(rowCenterY - targetCenterY),
        tolerancePx: boardScale < 0.99 ? 2 : 1,
      };
    });
  });

  const recorder = await page.evaluate(() => {
    const host = window as Window & { __diag95?: { events: unknown[]; samples: unknown[] } };
    return { events: host.__diag95?.events ?? [], samples: host.__diag95?.samples ?? [] };
  });
  const report = {
    schemaVersion: 1,
    browserName: testInfo.project.name,
    viewport: VIEWPORT,
    finalLandingChecks,
    events: recorder.events,
    samples: recorder.samples,
  };
  await testInfo.attach("diag-95-landing-samples", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  const scales = recorder.samples.map((sample) => (sample as { scale?: { effectiveBoardScale?: number } }).scale?.effectiveBoardScale)
    .filter((scale): scale is number => typeof scale === "number");
  console.info("DIAG_95_SUMMARY", JSON.stringify({
    browserName: testInfo.project.name,
    sampleCount: recorder.samples.length,
    resizeObserverCallbacks: recorder.events.filter((event) => (event as { type?: string }).type === "resize-observer").length,
    pillLayoutEvents: recorder.events.filter((event) => (event as { type?: string }).type === "turn-result-pill-layout").length,
    effectiveBoardScaleRange: scales.length ? [Math.min(...scales), Math.max(...scales)] : null,
    finalLandingChecks,
  }));

  for (const landing of finalLandingChecks.filter((entry) => entry.motion === "flight")) {
    if (landing.centerYErrorPx !== null) {
      expect(landing.centerYErrorPx, `settled row centre y (row ${landing.index})`).toBeLessThanOrEqual(landing.tolerancePx);
    }
  }
});

