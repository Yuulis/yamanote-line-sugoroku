import { createPresentationResolver, type PresentationResolver } from "../../../src/features/game/presentationResolver";
import { itemLastMove } from "../../../src/features/game/itemSession";
import { deriveTurnResult, replayTurnResultHistory } from "../../../src/features/game/turnResultCard";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame, targetSegmentIds, type RailwayNetwork }
  from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { isRollAdjustKind } from "../../../src/features/game/itemRollAdjust";
import type { ItemGameState, ItemTurnRecord } from "../../../src/types/network";
import { FIXTURE_GAME_SEED, PRODUCT_HISTORY_GAME_SEED, PRODUCT_HISTORY_SCENARIO_TURNS } from "../fixtures/seeds";
import { expect, type Page } from "@playwright/test";
import { diceButton, gamePanel, inventoryItem, writeSaveText } from "./app";

export const STEP12_MAX_REPLAY_TURNS = 48;
const MAX_PRODUCT_HISTORY_TURNS = PRODUCT_HISTORY_SCENARIO_TURNS.completed;
let cachedLongestProductState: ItemGameState | null = null;

export interface ClearReplay {
  readonly predecessor: ItemGameState;
  readonly completed: ItemGameState;
}

export interface TargetTurnReplay {
  readonly before: ItemGameState;
  readonly after: ItemGameState;
  readonly record: ItemTurnRecord;
  readonly newTargetSegmentCount: number;
}

export async function restoreResultState(page: Page, state: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(state));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

export function acceptOfflineTurn(game: ItemGameState, network: RailwayNetwork): ItemGameState {
  const result = playItemTurn(game, {}, network);
  return result.state.pending?.kind === "discard"
    ? resolveItemDiscard(result.state, result.state.pending.item.id).state
    : result.state;
}

export function replayFixtureClear(network: RailwayNetwork): ClearReplay {
  let game: ItemGameState = createItemGame(ITEM_GAME_CONFIG, FIXTURE_GAME_SEED, network);
  for (let index = 0; index < STEP12_MAX_REPLAY_TURNS && game.status === "playing"; index += 1) {
    const predecessor: ItemGameState = game;
    game = acceptOfflineTurn(game, network);
    if (game.status === "completed") {
      const predicates = { predecessorTurn: predecessor.turn, completedTurn: game.turn, completed: game.status === "completed" };
      if (game.turn !== predecessor.turn + 1) throw new Error(`Invalid pre-clear replay: ${JSON.stringify(predicates)}`);
      return { predecessor, completed: game };
    }
  }
  throw new Error(`Fixture seed did not clear within ${STEP12_MAX_REPLAY_TURNS} turns: ${JSON.stringify({
    turn: game.turn, status: game.status, pending: game.pending?.kind ?? null,
  })}`);
}

export function findTargetTurn(start: ItemGameState, network: RailwayNetwork): TargetTurnReplay {
  const presentation = createPresentationResolver(network);
  const targets = targetSegmentIds(start.config, network);
  const attempts: Array<Record<string, unknown>> = [];
  let before: ItemGameState = start;
  for (let index = 0; index < STEP12_MAX_REPLAY_TURNS && before.status === "playing"; index += 1) {
    const after: ItemGameState = acceptOfflineTurn(before, network);
    const record: ItemTurnRecord | undefined = after.movementHistory.at(-1);
    if (!record) throw new Error(`Replay turn ${after.turn} has no completed record`);
    const facts = replayTurnResultHistory(after.movementHistory, record.turn, targets, after.config.targetServiceId, presentation);
    const hasAdjustmentChoice: boolean = before.inventory.some((item) => isRollAdjustKind(item.kind));
    const hasDiscardChoice: boolean = record.itemEvents.some((event) => event.type === "pickup-pending-discard");
    const predicates = { turn: record.turn, newTargetSegmentCount: facts.newTargetSegmentCount,
      noAdjustment: !hasAdjustmentChoice && (record.kind !== "item-ride" || record.adjustment === null),
      noDiscard: after.pending === null && !hasDiscardChoice, beforeInventory: before.inventory.map((item) => item.kind),
      pending: after.pending?.kind ?? null };
    if (facts.newTargetSegmentCount >= 1 && predicates.noAdjustment && predicates.noDiscard) {
      return { before, after, record, newTargetSegmentCount: facts.newTargetSegmentCount };
    }
    attempts.push(predicates);
    before = after;
  }
  throw new Error(`No restorable +segment turn found within ${STEP12_MAX_REPLAY_TURNS} turns: ${JSON.stringify(attempts)}`);
}

export function replayLongestProductResult(network: RailwayNetwork, presentation: PresentationResolver): ItemGameState {
  if (cachedLongestProductState) return cachedLongestProductState;
  let game: ItemGameState = createItemGame(ITEM_GAME_CONFIG, PRODUCT_HISTORY_GAME_SEED, network);
  const targets = targetSegmentIds(game.config, network);
  let longest: { readonly state: ItemGameState; readonly nameLength: number; readonly turn: number } | null = null;
  for (let index = 0; index < MAX_PRODUCT_HISTORY_TURNS && game.status === "playing"; index += 1) {
    game = acceptOfflineTurn(game, network);
    const record: ItemTurnRecord | undefined = game.movementHistory.at(-1);
    if (!record) throw new Error(`Product history turn ${game.turn} has no completed record`);
    const facts = replayTurnResultHistory(game.movementHistory, record.turn, targets, game.config.targetServiceId, presentation);
    if (game.status !== "playing" || facts.newTargetSegmentCount < 1) continue;
    const move = itemLastMove(record, network);
    if (!move) throw new Error(`Product history turn ${record.turn} did not resolve to a move`);
    const model = deriveTurnResult({ sessionId: 1, turn: record.turn, move, records: game.movementHistory,
      targetSegmentIds: targets, initialServiceId: game.config.targetServiceId, itemsPublished: true, network, presentation });
    if (!model) throw new Error(`Product history turn ${record.turn} did not derive a result`);
    if (!longest || model.arrivalStation.length > longest.nameLength) {
      longest = { state: game, nameLength: model.arrivalStation.length, turn: record.turn };
    }
  }
  if (game.status !== "completed" || game.turn !== MAX_PRODUCT_HISTORY_TURNS || !longest) {
    throw new Error(`R5 replay predicates failed: ${JSON.stringify({ status: game.status, turn: game.turn,
      expectedTurn: MAX_PRODUCT_HISTORY_TURNS, longest: longest ? { turn: longest.turn, nameLength: longest.nameLength } : null })}`);
  }
  cachedLongestProductState = longest.state;
  return longest.state;
}

export interface ManualRollReplay {
  readonly before: ItemGameState;
  readonly first: ItemGameState;
  readonly second: ItemGameState;
}

/** R7: a restorable fixture state whose next two manual rolls need no item decision. */
export function replayTwoManualRolls(network: RailwayNetwork): ManualRollReplay {
  const attempts: Array<Record<string, unknown>> = [];
  let before: ItemGameState = createItemGame(ITEM_GAME_CONFIG, FIXTURE_GAME_SEED, network);
  for (let index = 0; index < STEP12_MAX_REPLAY_TURNS && before.status === "playing"; index += 1) {
    const firstResult = playItemTurn(before, {}, network);
    // A pending discard or clear after the first turn cannot be rolled again; skip that candidate.
    const secondResult = firstResult.state.pending === null && firstResult.state.status === "playing"
      ? playItemTurn(firstResult.state, {}, network) : null;
    const predicates = {
      turn: before.turn,
      restoredRecord: before.movementHistory.length > 0,
      restoredPending: before.pending?.kind ?? null,
      noAdjustment: ![before, firstResult.state].some((game) => game.inventory.some((item) => isRollAdjustKind(item.kind))),
      secondPlayed: secondResult !== null,
      pending: [firstResult.state.pending?.kind ?? null, secondResult?.state.pending?.kind ?? null],
      status: [firstResult.state.status, secondResult?.state.status ?? null],
    };
    const valid: boolean = predicates.restoredRecord && predicates.restoredPending === null && predicates.noAdjustment
      && predicates.pending.every((kind) => kind === null) && predicates.status.every((status) => status === "playing");
    if (valid && secondResult) return { before, first: firstResult.state, second: secondResult.state };
    attempts.push(predicates);
    before = acceptOfflineTurn(before, network);
  }
  throw new Error(`R7: no two-turn manual-roll state within ${STEP12_MAX_REPLAY_TURNS} turns: ${JSON.stringify(attempts)}`);
}

const R4_MAX_SEEDS = 256;
const R4_MAX_TURNS = 48;
const R4_INVENTORY_SIZE = 3;
const R4_MIN_EFFECTS = 2;
const R4_EFFECT_SCORE_WEIGHT = 1000;
let cachedPopulatedResult: PopulatedResult | null = null;

export interface PopulatedResult {
  /** Restored predecessor; the browser rolls it once with saving failing. */
  readonly state: ItemGameState;
  /** The accepted (but unsaved) state the populated HUD shows. */
  readonly next: ItemGameState;
  readonly itemName: string;
  readonly effects: number;
}

function activeEffectCount(game: ItemGameState): number {
  return game.effects.delayDueTurns.filter((dueTurn) => dueTurn > game.turn).length
    + game.effects.suspensions.filter((entry) => entry.expiresTurn > game.turn).length
    + (game.effects.detourPending ? 1 : 0) + (game.effects.oversleepPending ? 1 : 0);
}

/** R4: the `ui-pop.spec.ts` populated search (real data), bounded and cached per worker. */
export function populatedResultState(network: RailwayNetwork): PopulatedResult {
  if (cachedPopulatedResult) return cachedPopulatedResult;
  let best: PopulatedResult | null = null;
  let bestScore = -1;
  for (let seedValue = 0; seedValue < R4_MAX_SEEDS; seedValue += 1) {
    let state: ItemGameState = createItemGame(ITEM_GAME_CONFIG, seedValue.toString(16).padStart(32, "0"), network);
    for (let turnIndex = 0; turnIndex < R4_MAX_TURNS && state.status === "playing"; turnIndex += 1) {
      if (state.inventory.length === R4_INVENTORY_SIZE && state.pending === null) {
        const next: ItemGameState = playItemTurn(state, {}, network).state;
        const usable = next.inventory.find((item) => item.kind === "double" || item.kind === "rapid");
        const effects: number = activeEffectCount(next);
        const hasSuspension: boolean = next.effects.suspensions.some((entry) => entry.expiresTurn > next.turn);
        const score: number = effects * R4_EFFECT_SCORE_WEIGHT + (network.servicesById.get(next.currentServiceId)?.name.length ?? 0);
        if (next.pending === null && next.status === "playing" && next.inventory.length === R4_INVENTORY_SIZE && usable
          && effects >= R4_MIN_EFFECTS && hasSuspension && score > bestScore) {
          best = { state, next, itemName: usable.kind === "double" ? "倍速券" : "快速券", effects };
          bestScore = score;
        }
      }
      state = acceptOfflineTurn(state, network);
    }
  }
  if (!best) throw new Error("R4: no seeded real-data state had three items, a usable speed ticket, two effects incl. a suspension and a non-pending next turn");
  cachedPopulatedResult = best;
  return best;
}

/** R4 browser flow: restore, roll once while saving fails, restore saving, then stage the usable ticket. */
export async function openPopulatedResult(page: Page, populated: PopulatedResult): Promise<void> {
  await restoreResultState(page, populated.state);
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    storage.originalSetItem = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save")) throw new Error("quota");
      storage.originalSetItem?.call(this, key, value);
    };
  });
  await diceButton(page).click();
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  const save = gamePanel(page).locator(".game-panel__save");
  await expect.poll(async () => await adjustment.isVisible() || ((await save.textContent()) ?? "").includes("失敗")).toBe(true);
  if (await adjustment.isVisible()) await adjustment.getByRole("button", { name: "そのまま続ける" }).click();
  await expect(save).toContainText("失敗");
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    if (storage.originalSetItem) storage.setItem = storage.originalSetItem;
    delete storage.originalSetItem;
  });
  const slot = inventoryItem(page, populated.itemName).first();
  await slot.getByRole("button").click();
  const card = gamePanel(page).getByRole("dialog", { name: populated.itemName, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "使う", exact: true }).click();
  await expect(slot).toHaveClass(/item-slot--selected/);
  await expect(gamePanel(page).locator(".item-staged-summary")).toBeVisible();
}
