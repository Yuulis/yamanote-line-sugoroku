import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "./fixtures";
import {
  diceButton,
  diceMoment,
  freezeClock,
  gamePanel,
  openGameMenu,
  openTitle,
  panelStat,
  startNewGame,
} from "./support/app";
import { advanceTumble, awaitMovementRelease } from "./support/turnMoments";

type Variant = "V0 original" | "V1 fixed" | "V2 no-dialog";
type PageSnapshot = {
  stage: string | null;
  diceMomentStage: string | null;
  rulesDialogOpen: boolean;
  turnCount: number | null;
  statusText: string;
  diceButtonText: string;
};
type DiagnosticRecorder = {
  startedAtMs: number;
  /** Shared order counter: fake performance.now() is frozen, so timestamps can tie. */
  seq: number;
  rafCalls: Array<{ seq: number; timestampMs: number; callbackName: string; stack: string[] }>;
  markers: Array<{ seq: number; name: string; timestampMs: number; snapshot: PageSnapshot }>;
  statusAnnouncements: Array<{ text: string; turn: number }>;
  firstMovingMarker: { timestampMs: number; snapshot: PageSnapshot } | null;
};
type RunForMeasurement = {
  attempt: "first" | "recovery";
  startTimestampMs: number;
  endTimestampMs: number;
  wallDurationMs: number;
  turnCountAfter: number | null;
};

test.use({ dataset: "fixture", firstTurnNoticeSeen: false, reducedMotion: "reduce" });

/** Keep the same status recorder used by the issue #111 baseline test. */
async function observeStatusAnnouncements(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    type Observation = { text: string; turn: number };
    const observations: Observation[] = [];
    const record = (): void => {
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

/** Wrap the already-installed fake rAF and watch for the first moving state. */
async function installIssue111Recorder(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const snapshot = (): PageSnapshot => {
      const moment = document.querySelector<HTMLElement>(".turn-moment-host [data-stage]");
      const diceMoment = document.querySelector<HTMLElement>(".turn-moment-host .dice-tumble");
      const statusText = document.querySelector<HTMLElement>(".game-panel [role=status]")?.textContent?.trim() ?? "";
      const diceButtonText = Array.from(document.querySelectorAll<HTMLElement>(".game-panel button"))
        .map((button) => button.innerText.trim())
        .find((text) => text.includes("サイコロを振る") || text.includes("移動中")) ?? "";
      const turnText = document.querySelector<HTMLElement>('[data-stat="turn"]')?.textContent?.trim() ?? "";
      const turnCount = turnText === "" ? null : Number(turnText);
      const rulesDialogOpen = Array.from(document.querySelectorAll<HTMLElement>('dialog, [role="dialog"]'))
        .some((dialog) => {
          const labelledBy = dialog.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
          const accessibleLabel = labelledBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
          const open = dialog instanceof HTMLDialogElement
            ? dialog.open
            : !dialog.hidden && dialog.getAttribute("aria-hidden") !== "true";
          return open && (dialog.textContent?.includes("遊び方") === true || accessibleLabel.includes("遊び方"));
        });
      return {
        stage: moment?.dataset.stage ?? null,
        diceMomentStage: diceMoment?.dataset.stage ?? null,
        rulesDialogOpen,
        turnCount: turnCount !== null && Number.isFinite(turnCount) ? turnCount : null,
        statusText,
        diceButtonText,
      };
    };
    const browserWindow = window as Window & { __diag111?: DiagnosticRecorder };
    const recorder: DiagnosticRecorder = {
      startedAtMs: performance.now(),
      seq: 0,
      rafCalls: [],
      markers: [],
      statusAnnouncements: [],
      firstMovingMarker: null,
    };
    browserWindow.__diag111 = recorder;

    const nativeRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      const stack = new Error().stack?.split("\n").slice(2, 7) ?? [];
      recorder.seq += 1;
      recorder.rafCalls.push({
        seq: recorder.seq,
        timestampMs: performance.now(),
        callbackName: callback.name || "(anonymous)",
        stack,
      });
      return nativeRequestAnimationFrame.call(window, callback);
    }) as typeof window.requestAnimationFrame;

    const recordStatus = (): void => {
      const current = snapshot();
      if (current.statusText && current.turnCount !== null) {
        const previous = recorder.statusAnnouncements.at(-1);
        if (previous?.text !== current.statusText || previous.turn !== current.turnCount) {
          recorder.statusAnnouncements.push({ text: current.statusText, turn: current.turnCount });
        }
      }
      const isMoving = current.statusText.includes("移動中です")
        || (current.diceMomentStage === null && current.diceButtonText.includes("移動中"));
      if (isMoving && recorder.firstMovingMarker === null) {
        recorder.firstMovingMarker = { timestampMs: performance.now(), snapshot: current };
      }
    };
    const observer = new MutationObserver(recordStatus);
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    recordStatus();
  });
}

async function recordMarker(page: import("@playwright/test").Page, name: string): Promise<PageSnapshot> {
  return page.evaluate((markerName) => {
    type Snapshot = PageSnapshot;
    type Recorder = DiagnosticRecorder;
    const browserWindow = window as Window & { __diag111?: Recorder };
    const moment = document.querySelector<HTMLElement>(".turn-moment-host [data-stage]");
    const diceMoment = document.querySelector<HTMLElement>(".turn-moment-host .dice-tumble");
    const statusText = document.querySelector<HTMLElement>(".game-panel [role=status]")?.textContent?.trim() ?? "";
    const diceButtonText = Array.from(document.querySelectorAll<HTMLElement>(".game-panel button"))
      .map((button) => button.innerText.trim())
      .find((text) => text.includes("サイコロを振る") || text.includes("移動中")) ?? "";
    const turnText = document.querySelector<HTMLElement>('[data-stat="turn"]')?.textContent?.trim() ?? "";
    const turnCount = turnText === "" ? null : Number(turnText);
    const rulesDialogOpen = Array.from(document.querySelectorAll<HTMLElement>('dialog, [role="dialog"]'))
      .some((dialog) => {
        const labelledBy = dialog.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
        const accessibleLabel = labelledBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
        const open = dialog instanceof HTMLDialogElement
          ? dialog.open
          : !dialog.hidden && dialog.getAttribute("aria-hidden") !== "true";
        return open && (dialog.textContent?.includes("遊び方") === true || accessibleLabel.includes("遊び方"));
      });
    const current: Snapshot = {
      stage: moment?.dataset.stage ?? null,
      diceMomentStage: diceMoment?.dataset.stage ?? null,
      rulesDialogOpen,
      turnCount: turnCount !== null && Number.isFinite(turnCount) ? turnCount : null,
      statusText,
      diceButtonText,
    };
    const recorder = browserWindow.__diag111;
    if (recorder) {
      recorder.seq += 1;
      recorder.markers.push({ seq: recorder.seq, name: markerName, timestampMs: performance.now(), snapshot: current });
    }
    return current;
  }, name);
}

async function flushQueuedTasks(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

async function runForAndRecord(
  page: import("@playwright/test").Page,
  attempt: RunForMeasurement["attempt"],
  measurements: RunForMeasurement[],
): Promise<PageSnapshot> {
  const markerPrefix = attempt === "first" ? "runFor" : "recovery-runFor";
  const before = await recordMarker(page, `before-${markerPrefix}`);
  const startTimestampMs = await page.evaluate(() => performance.now());
  const wallStartMs = performance.now();
  await page.clock.runFor(30_000);
  const wallDurationMs = performance.now() - wallStartMs;
  const after = await recordMarker(page, `after-${markerPrefix}`);
  const endTimestampMs = await page.evaluate(() => performance.now());
  measurements.push({
    attempt,
    startTimestampMs,
    endTimestampMs,
    wallDurationMs,
    turnCountAfter: after.turnCount,
  });
  console.info("DIAG_111_RUN_FOR", JSON.stringify({ attempt, wallDurationMs, before, after }));
  return after;
}

async function readRecorder(page: import("@playwright/test").Page): Promise<DiagnosticRecorder | null> {
  return page.evaluate(() => {
    const browserWindow = window as Window & { __diag111?: DiagnosticRecorder };
    return browserWindow.__diag111 ?? null;
  });
}

async function runVariant(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  variant: Variant,
): Promise<void> {
  test.setTimeout(60_000);
  await page.clock.install();
  await openTitle(page);
  // Installing now guarantees the wrapper delegates to Playwright's fake rAF.
  await installIssue111Recorder(page);
  await startNewGame(page);
  await freezeClock(page);
  await observeStatusAnnouncements(page);
  await diceButton(page).click();
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");

  const hasRulesDialog = variant !== "V2 no-dialog";
  if (hasRulesDialog) {
    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: "遊び方", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "遊び方" })).toBeVisible();
  }

  const runForMeasurements: RunForMeasurement[] = [];
  await recordMarker(page, "before-advanceTumble");
  await advanceTumble(page);
  await recordMarker(page, "after-advanceTumble");

  if (variant === "V1 fixed") await awaitMovementRelease(page);

  const firstRunFor = await runForAndRecord(page, "first", runForMeasurements);
  let recoveryRunFor: PageSnapshot | null = null;
  if ((variant === "V0 original" || variant === "V2 no-dialog") && firstRunFor.turnCount === 0) {
    await flushQueuedTasks(page);
    recoveryRunFor = await runForAndRecord(page, "recovery", runForMeasurements);
  }

  const recorder = await readRecorder(page);
  const report = {
    schemaVersion: 1,
    runId: `${testInfo.testId}:${testInfo.repeatEachIndex}:${testInfo.retry}`,
    variant,
    browserName: testInfo.project.name,
    testTitle: testInfo.title,
    rulesDialogOpened: hasRulesDialog,
    firstRunTurnCount: firstRunFor.turnCount,
    recoveryTurnCount: recoveryRunFor?.turnCount ?? null,
    runForMeasurements,
    recorder,
  };
  await testInfo.attach(`diag-111-${variant.toLowerCase().replaceAll(" ", "-")}`, {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  const recordPath = testInfo.outputPath("diag-111-record.json");
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, JSON.stringify(report, null, 2), "utf-8");
  console.info("DIAG_111_SUMMARY", JSON.stringify({
    variant,
    browserName: testInfo.project.name,
    firstRunTurnCount: firstRunFor.turnCount,
    recoveryTurnCount: recoveryRunFor?.turnCount ?? null,
    rafCalls: recorder?.rafCalls.length ?? 0,
    firstMovingMarker: recorder?.firstMovingMarker ?? null,
  }));

  if (variant === "V1 fixed") {
    await expect(panelStat(page, "ターン数")).toHaveText("1");
  }
}

test.describe("temporary issue #111 WebKit diagnostic", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const variant of ["V0 original", "V1 fixed", "V2 no-dialog"] as const) {
    test(variant, async ({ page }, testInfo) => {
      test.skip(process.env.DIAG_111 !== "1", "Temporary issue #111 diagnostic; set DIAG_111=1 to run it.");
      await runVariant(page, testInfo, variant);
    });
  }
});
