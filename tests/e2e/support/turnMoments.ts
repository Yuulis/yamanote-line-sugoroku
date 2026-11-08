import { expect, type Page } from "@playwright/test";
import { diceMoment, gamePanel, readMap } from "./app";

// Explicit frozen-clock checkpoint helpers for the "turn moments" (dice tumble,
// modifier stamps, movement, arrival banner, lottery flip + settle, item
// pickup).
//
// Contract shared by every helper:
//   - The page clock must already be installed (`page.clock.install()` before
//     navigation) and frozen (`freezeClock` in ./app), so a stage only moves
//     when the test says so.
//   - One helper advances exactly one timed stage. Callers assert the boundary
//     between two calls; nothing here chains stages together.
//   - Stage timers use `page.clock.runFor`, which fires every due timer in
//     order. `fastForward` is deliberately avoided for them: it fires due
//     timers at most once, so a chain of newly scheduled timers would be
//     skipped silently. (Movement is the one exception, see `advanceMovement`.)
//   - Durations are independent constants below, written down from the feature
//     specification. They are never imported from `src/**` and never computed
//     through the production planner, so the production timing table cannot
//     silently agree with itself.
//   - A helper never presses スキップ. Skipping is a separate, explicitly named
//     helper (`pressSkip`) that a test has to choose on purpose.
//
// Active stages wait for their visible checkpoint and timer effect before advancing.

/** Normal ("ふつう") per-hop reference for the legacy slow/normal/fast factor helpers. */
export const NORMAL_STEP_MS = 450;

/** One page animation frame under Playwright's fake clock. */
export const FRAME_MS = 16;

/** Stage durations at normal speed, in milliseconds. */
export const NORMAL_STAGE_MS = {
  tumble: 600,
  stamps: 240,
  arrival: 800,
  lotteryFlip: 1_600,
  lotterySettle: 400,
  pickup: 500,
} as const;

export type TurnMomentStage = keyof typeof NORMAL_STAGE_MS;

/** Scale factor for an animation speed: `stepMs / 450` (slow 600 -> 4/3, fast 300 -> 2/3). */
export function speedFactor(stepMs: number): number {
  return stepMs / NORMAL_STEP_MS;
}

/** Duration of a stage after applying the speed factor (1 = normal speed). */
export function stageDurationMs(stage: TurnMomentStage, factor: number = 1): number {
  return Math.round(NORMAL_STAGE_MS[stage] * factor);
}

async function advanceStage(page: Page, stage: TurnMomentStage, factor: number): Promise<void> {
  await page.clock.runFor(stageDurationMs(stage, factor));
}

/** Stages with a visible overlay or map-flash checkpoint. */
export type PresentedStage = "tumble" | "stamps" | "arrival" | "segment-flash" | "lottery-flip" | "lottery-settle" | "pickup";
export type MomentSpeedId = "slow" | "normal" | "fast" | "very-fast";

/** Independent specification literals; legacy factor helpers above retain their original contract. */
export const STAGE_MS_BY_SPEED = {
  slow: { tumble: 800, stamps: 320, arrival: 1_067, "segment-flash": 1_067,
    "lottery-flip": 2_133, "lottery-settle": 533, pickup: 667 },
  normal: { tumble: 600, stamps: 240, arrival: 800, "segment-flash": 800,
    "lottery-flip": 1_600, "lottery-settle": 400, pickup: 500 },
  fast: { tumble: 400, stamps: 160, arrival: 533, "segment-flash": 533,
    "lottery-flip": 1_067, "lottery-settle": 267, pickup: 333 },
  "very-fast": { tumble: 160, stamps: 64, arrival: null, "segment-flash": 180,
    "lottery-flip": 280, "lottery-settle": 100, pickup: 140 },
} as const satisfies Readonly<Record<MomentSpeedId, Readonly<Record<PresentedStage, number | null>>>>;

export function stageMsForSpeed(stage: PresentedStage, speedId: MomentSpeedId): number | null {
  return STAGE_MS_BY_SPEED[speedId][stage];
}

/** Arrival replacement depends on accepted new geometry; no empty flash checkpoint or delay. */
export function arrivalStagesForSpeed(speedId: MomentSpeedId, hasNewSegmentGeometry: boolean): PresentedStage[] {
  if (stageMsForSpeed("arrival", speedId) !== null) return ["arrival"];
  return hasNewSegmentGeometry ? ["segment-flash"] : [];
}

/** Advance one existing stage at a named speed; an absent arrival must be skipped by the caller. */
export async function advanceStageForSpeed(page: Page, stage: PresentedStage, speedId: MomentSpeedId): Promise<void> {
  const duration = stageMsForSpeed(stage, speedId);
  if (duration === null) throw new Error(`${stage} is absent at ${speedId}`);
  await awaitStage(page, stage);
  await page.clock.runFor(duration);
}

/**
 * Let the page run every task already queued, without moving the (frozen) page
 * clock. The app arms a stage's timer in a React effect after the render that
 * shows the stage; React's scheduler posts that work as a MessageChannel task,
 * which Playwright's clock does not fake. A message posted now is delivered
 * after it, so once this resolves the stage's timer exists. Not a sleep: no
 * real or page time is waited for.
 */
async function flushQueuedTasks(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

/**
 * Wait until `stage` is presented and its timer is armed. Under a frozen clock a
 * stage starts only after an asynchronous step (the accepted save for the
 * tumble, the tumble's own end for the stamps, the movement's final frame for
 * the arrival); advancing the clock before that is silently lost and the stage
 * never ends. Every stage helper below calls this first, so callers never race it.
 */
export async function awaitStage(page: Page, stage: PresentedStage): Promise<void> {
  if (stage === "segment-flash") {
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await expect.poll(async () => (await readMap(page))?.flashFilterIds.length ?? 0).toBeGreaterThan(0);
  } else if (stage === "arrival") {
    await expect(page.locator(".turn-moment-host .arrival-banner")).toBeVisible();
  } else if (stage === "pickup") {
    await expect(page.locator('.turn-moment-host [data-stage="pickup"]')).toBeVisible();
  } else if (stage === "lottery-flip" || stage === "lottery-settle") {
    await expect(page.locator(".lottery-reveal")).toHaveAttribute("data-stage", stage);
  } else {
    await expect(diceMoment(page)).toHaveAttribute("data-stage", stage);
  }
  await flushQueuedTasks(page);
}

/**
 * Dice tumble (before any adjustment dialog or the movement). Waits for the
 * tumble to be presented first (it starts once the saved roll is observed).
 */
export async function advanceTumble(page: Page, factor: number = 1): Promise<void> {
  await awaitStage(page, "tumble");
  await advanceStage(page, "tumble", factor);
}

/**
 * Modifier stamps after the tumble (and after an adjustment, if any); shown
 * only for turns with modifier wording. Waits for the stamps to be presented.
 */
export async function advanceStamps(page: Page, factor: number = 1): Promise<void> {
  await awaitStage(page, "stamps");
  await advanceStage(page, "stamps", factor);
}

/**
 * Wait until the pre-move moment has ended and the released movement has
 * requested its first animation frame. The release renders asynchronously after
 * the clock advance that ended the tumble or stamps, and the frame is requested
 * in an effect after that render; priming before then would be lost.
 */
export async function awaitMovementRelease(page: Page): Promise<void> {
  await expect(diceMoment(page)).toHaveCount(0);
  await flushQueuedTasks(page);
}

/**
 * Prime the movement animation's first requestAnimationFrame. The movement
 * clock starts on its first frame, so a duration advanced before that frame is
 * lost, so this first waits for the release (`awaitMovementRelease`). Harmless
 * when no movement is running.
 */
export async function primeMovementFrame(page: Page): Promise<void> {
  await awaitMovementRelease(page);
  await page.clock.runFor(FRAME_MS);
}

/**
 * Movement: prime the first frame explicitly, jump forward by `durationMs`,
 * then run one frame so the animation reads the new time. The movement is a
 * single time-based requestAnimationFrame loop (not a timer chain), so a jump
 * is safe here and avoids rendering one map frame per 16 ms. `durationMs` is
 * explicit on purpose: the caller passes an exact, independently computed
 * duration, for example half of the first hop or "total movement minus what
 * was already advanced". Hop time is distance-based (about 300-1,200 ms at
 * normal speed) and the whole movement is capped at 6,000 ms, so it is never
 * `physicalHops * stepMs`. The priming and trailing frames add 32 ms on top of
 * `durationMs`. The pre-move gate (S11) holds the movement while the dice
 * moment is shown, so this first waits for that moment to end.
 */
export async function advanceMovement(page: Page, durationMs: number): Promise<void> {
  await primeMovementFrame(page);
  await page.clock.fastForward(durationMs);
  await page.clock.runFor(FRAME_MS);
}

/**
 * Arrival banner after the movement (and the goal turn's banner before
 * ClearScreen). Waits for the banner first: the arrival starts on the frame
 * that ends the movement.
 */
export async function advanceArrival(page: Page, factor: number = 1): Promise<void> {
  await awaitStage(page, "arrival");
  await advanceStage(page, "arrival", factor);
}

/**
 * Lottery board flip at the visible map centre. Activated by S14; present only
 * when the turn draws a lottery.
 */
export async function advanceLotteryFlip(page: Page, factor: number = 1): Promise<void> {
  await awaitStage(page, "lottery-flip");
  await advanceStage(page, "lotteryFlip", factor);
}

/**
 * Lottery board settling into the HUD, after the flip. Activated by S14; the
 * result publishes (ride, lottery text, candidates) at its end.
 */
export async function advanceLotterySettle(page: Page, factor: number = 1): Promise<void> {
  await awaitStage(page, "lottery-settle");
  await advanceStage(page, "lotterySettle", factor);
}

/**
 * Item pickup before any DiscardChoice. Activated by S15; present only when
 * the turn picks up an item.
 */
export async function advancePickup(page: Page, factor: number = 1): Promise<void> {
  await awaitStage(page, "pickup");
  await advanceStage(page, "pickup", factor);
}

/**
 * Press スキップ. One press ends tumble, movement and reveal together, so use it
 * only in tests about Skip, never to make a natural-completion test finish.
 */
export async function pressSkip(page: Page): Promise<void> {
  await gamePanel(page).getByRole("button", { name: "スキップ" }).click();
}
