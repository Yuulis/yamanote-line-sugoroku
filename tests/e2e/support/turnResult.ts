import { createPresentationResolver, type PresentationResolver } from "../../../src/features/game/presentationResolver";
import { itemLastMove } from "../../../src/features/game/itemSession";
import { deriveTurnResult, replayTurnResultHistory } from "../../../src/features/game/turnResultCard";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame, targetSegmentIds, type RailwayNetwork }
  from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import type { ItemGameState, ItemTurnRecord } from "../../../src/types/network";
import { FIXTURE_GAME_SEED, PRODUCT_HISTORY_GAME_SEED, PRODUCT_HISTORY_SCENARIO_TURNS } from "../fixtures/seeds";
import { expect, type Page } from "@playwright/test";
import { gamePanel, writeSaveText } from "./app";

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
    const hasAdjustmentChoice: boolean = before.inventory.some((item) => item.kind === "roll-adjust");
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
