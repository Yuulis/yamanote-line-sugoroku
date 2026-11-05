import type { Page } from "@playwright/test";
import { gamePanel } from "./app";

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
// Until the step that activates a stage lands, that stage does not exist in
// production: calling its helper only advances the page clock. That leaves the
// saved game (rolls, turns, history, pending records) unchanged; on-screen
// progress of an already running move can move further, and toast lifetimes
// count down, as they would for any clock advance. No production hook is
// involved.

/** Normal ("ふつう") per-hop step; every stage scales by `stepMs / NORMAL_STEP_MS`. */
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

/**
 * Dice tumble (before any adjustment dialog or the movement). Activated by S11;
 * absent before that, so this only advances the clock.
 */
export async function advanceTumble(page: Page, factor: number = 1): Promise<void> {
  await advanceStage(page, "tumble", factor);
}

/**
 * Modifier stamps after the tumble (and after an adjustment, if any). Activated
 * by S11; shown only for turns with modifier wording.
 */
export async function advanceStamps(page: Page, factor: number = 1): Promise<void> {
  await advanceStage(page, "stamps", factor);
}

/**
 * Prime the movement animation's first requestAnimationFrame. The movement
 * clock starts on its first frame, so a duration advanced before that frame is
 * lost. Harmless when no movement is running.
 */
export async function primeMovementFrame(page: Page): Promise<void> {
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
 * `durationMs`. Movement is active in production today; the pre-move gate
 * arrives with S11.
 */
export async function advanceMovement(page: Page, durationMs: number): Promise<void> {
  await primeMovementFrame(page);
  await page.clock.fastForward(durationMs);
  await page.clock.runFor(FRAME_MS);
}

/**
 * Arrival banner after the movement (and the goal turn's banner before
 * ClearScreen). Activated by S12.
 */
export async function advanceArrival(page: Page, factor: number = 1): Promise<void> {
  await advanceStage(page, "arrival", factor);
}

/**
 * Lottery board flip at the visible map centre. Activated by S14; present only
 * when the turn draws a lottery.
 */
export async function advanceLotteryFlip(page: Page, factor: number = 1): Promise<void> {
  await advanceStage(page, "lotteryFlip", factor);
}

/**
 * Lottery board settling into the HUD, after the flip. Activated by S14; the
 * result publishes (ride, lottery text, candidates) at its end.
 */
export async function advanceLotterySettle(page: Page, factor: number = 1): Promise<void> {
  await advanceStage(page, "lotterySettle", factor);
}

/**
 * Item pickup before any DiscardChoice. Activated by S15; present only when
 * the turn picks up an item.
 */
export async function advancePickup(page: Page, factor: number = 1): Promise<void> {
  await advanceStage(page, "pickup", factor);
}

/**
 * Press スキップ. One press ends tumble, movement and reveal together, so use it
 * only in tests about Skip, never to make a natural-completion test finish.
 */
export async function pressSkip(page: Page): Promise<void> {
  await gamePanel(page).getByRole("button", { name: "スキップ" }).click();
}
