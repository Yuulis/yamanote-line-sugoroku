import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EffectChips } from "../../src/features/game/components/EffectChips";
import { TargetProgressBar } from "../../src/features/game/components/TargetProgressBar";
import { effectChipModels, compactRollFor, progressSegments } from "../../src/features/game/hudPresentation";
import { lastMoveOf } from "../../src/features/game/gameSession";
import { itemLastMove } from "../../src/features/game/itemSession";
import { activeItemEffectTexts } from "../../src/features/game/presentation";
import { beginItemTurn, createGame, finishItemTurn, moveByRoll, playItemTurn, resolveItemDiscard } from "../../src/features/game/engine";
import type { ItemGameState, ItemEffectsState, ItemKind, ItemRideRecord, ItemTurnRecord } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");
const MAX_DELAY_SEARCH_TURNS = 20;

function arrivedRecord(state: ItemGameState): ItemTurnRecord {
  const record = state.pending?.kind === "discard" ? state.pending.record : state.movementHistory.at(-1);
  if (!record) throw new Error("Expected an engine-generated item record");
  return record as ItemTurnRecord;
}

function ride(record: ItemTurnRecord): ItemRideRecord {
  if (record.kind !== "item-ride") throw new Error("Expected an engine-generated ride record");
  return record;
}

/** Replay a pinned scenario and resolve its next turn with one owned item through the engine. */
function playWithItem(name: Parameters<typeof itemScenario>[0], kind: ItemKind): ItemTurnRecord {
  const base = itemScenario(name, network);
  const item = base.inventory.find((entry) => entry.kind === kind);
  if (!item) throw new Error(`Scenario ${name} has no ${kind}`);
  const command = { items: [{ kind, instanceId: item.id }] } as Parameters<typeof playItemTurn>[1]["command"];
  return arrivedRecord(playItemTurn(base, { command }, network).state);
}

function adjustedRecord(delta: -1 | 1): ItemRideRecord {
  const base = itemScenario("adjust", network);
  const ticket = base.inventory.find((item) => item.kind === "roll-adjust")!;
  const pending = beginItemTurn(base, { items: [] }, network).state;
  return ride(arrivedRecord(finishItemTurn(pending, { instanceId: ticket.id, delta }, network).state));
}

/** Play the delay scenario until the scheduled delay forces a face of 1 on an unadjusted roll. */
function delayedRecord(): ItemRideRecord {
  let game = itemScenario("delay", network);
  for (let step = 0; step < MAX_DELAY_SEARCH_TURNS; step += 1) {
    game = playItemTurn(game, {}, network).state;
    const record = arrivedRecord(game);
    if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
    if (record.kind === "item-ride" && record.effectiveFace !== record.rawRoll && record.adjustment === null) return record;
  }
  throw new Error("The delay scenario never applied its delay");
}

const SEGMENT_PATTERN = /<span class="target-progress__segment( target-progress__segment--completed)?"><\/span>/g;
const COMPLETED_PATTERN = /target-progress__segment--completed/g;

/** Attributes of the single progressbar element in static markup (no DOM needed). */
function progressbarAttributes(markup: string): Record<string, string> {
  const tags = markup.match(/<[^>]*role="progressbar"[^>]*>/g) ?? [];
  expect(tags).toHaveLength(1);
  return Object.fromEntries([...tags[0]!.matchAll(/([a-z-]+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
}

function compactFor(record: ItemTurnRecord) {
  return compactRollFor(itemLastMove(record, network));
}

describe("compact HUD roll presentation", () => {
  it("shows a dash before the first roll", () => {
    expect(compactRollFor(null)).toEqual({ face: null, label: "—", modifier: null });
  });

  it("shows the classic die face and squares for a legacy move", () => {
    const moved = moveByRoll(createGame(LEGACY_CAPITAL_REGION_CONFIG, "hud-legacy", network), 3, network).state;
    expect(compactRollFor(lastMoveOf(moved, network))).toEqual({ face: 3, label: "3マス", modifier: null });
  });

  it("shows the effective face and squares for a plain item ride", () => {
    const record = ride(arrivedRecord(playItemTurn(itemScenario("route", network), {}, network).state));
    expect(record.movementMode).toBe("normal");
    expect(compactFor(record)).toEqual({ face: record.effectiveFace, label: `${record.pips}マス`, modifier: null });
  });

  it("shows the doubled budget beside the face for a double ticket", () => {
    const record = ride(playWithItem("double", "double"));
    expect(record.pips).toBe(record.effectiveFace * 2);
    expect(compactFor(record)).toEqual({ face: record.effectiveFace, label: `${record.pips}マス`, modifier: "×2" });
  });

  it.each([1, -1] as const)("shows the adjusted face with a %i adjustment cue", (delta: -1 | 1) => {
    const record = adjustedRecord(delta);
    expect(record.effectiveFace).toBe(record.rawRoll + delta);
    expect(compactFor(record)).toEqual({ face: record.effectiveFace, label: `${record.pips}マス`,
      modifier: delta > 0 ? "調整+1" : "調整-1" });
  });

  it("shows the forced face of 1 with a delay cue", () => {
    const record = delayedRecord();
    expect(record.effectiveFace).toBe(1);
    expect(compactFor(record)).toEqual({ face: 1, label: `${record.pips}マス`, modifier: "遅延" });
  });

  it("shows the rapid station budget, not the spent pips", () => {
    const record = ride(playWithItem("rapid-long", "rapid"));
    expect(record.movementMode).toBe("rapid");
    expect(record.hopBudget).not.toBe(record.pips);
    expect(compactFor(record)).toEqual({ face: record.effectiveFace, label: `${record.hopBudget}駅`, modifier: "快速" });
  });

  it("shows oversleep instead of a square count", () => {
    const record = ride(arrivedRecord(playItemTurn(itemScenario("oversleep", network), {}, network).state));
    expect(record.movementMode).toBe("oversleep");
    expect(compactFor(record)).toEqual({ face: record.effectiveFace, label: "寝過ごし", modifier: null });
  });

  it("shows a deadhead relocation without a die face", () => {
    const record = playWithItem("deadhead", "deadhead");
    expect(record.kind).toBe("deadhead");
    expect(compactFor(record)).toEqual({ face: null, label: "回送（サイコロなし）", modifier: null });
  });
});

describe("target progress presentation", () => {
  it.each([
    [30, 0, 0], [30, 12, 12], [30, 30, 30], [30, 40, 30], [4, -1, 0], [4, 2, 2], [4, 4, 4], [4, 8, 4],
  ])("clamps %i segments at completed=%i to %i", (required: number, completed: number, expected: number) => {
    const segments = progressSegments(completed, required);
    expect(segments).toHaveLength(required);
    expect(segments.filter((segment) => segment.completed)).toHaveLength(expected);
    expect(segments.map((segment) => segment.index)).toEqual(Array.from({ length: required }, (_v, index) => index));
  });

  it("renders one accessible progressbar with decorative segments in one unrotated flat row", () => {
    const markup = renderToStaticMarkup(createElement(TargetProgressBar, { completed: 12, required: 30 }));
    const attributes = progressbarAttributes(markup);
    expect(attributes).toMatchObject({ "aria-label": "山手線の踏破区間", "aria-valuemin": "0", "aria-valuemax": "30",
      "aria-valuenow": "12", "aria-valuetext": "12/30" });
    // One aria-hidden flex row whose direct children are exactly the 30 plain segments.
    const row = markup.match(/<div class="target-progress__segments" aria-hidden="true">(.*?)<\/div>/);
    expect(row).not.toBeNull();
    expect(row![1]!.replace(SEGMENT_PATTERN, "")).toBe("");
    expect(row![1]!.match(SEGMENT_PATTERN)).toHaveLength(30);
    expect(row![1]!.match(COMPLETED_PATTERN)).toHaveLength(12);
    expect(markup).not.toMatch(/style=|<svg|<circle|conic-gradient|rotate\(|border-radius:\s*50%/i);
    expect(markup).not.toMatch(/conic-gradient|rotate\(|border-radius:\s*50%/i);
  });
});

describe("target progress values", () => {
  it.each([
    [40, 30, "30", "30", "30/30"], [-2, 30, "0", "30", "0/30"], [2.7, 4, "2", "4", "2/4"],
    [Number.NaN, 4, "0", "4", "0/4"], [3, 0, "0", "0", "0/0"],
  ])("keeps ARIA values equal to the drawn segments for completed=%s of %s", (
    completed: number, required: number, now: string, max: string, text: string,
  ) => {
    const markup = renderToStaticMarkup(createElement(TargetProgressBar, { completed, required }));
    const bar = progressbarAttributes(markup);
    expect(bar["aria-valuenow"]).toBe(now);
    expect(bar["aria-valuemax"]).toBe(max);
    expect(bar["aria-valuetext"]).toBe(text);
    expect(markup.match(COMPLETED_PATTERN) ?? []).toHaveLength(Number(now));
    expect(markup.match(SEGMENT_PATTERN) ?? []).toHaveLength(Number(max));
  });
});

describe("active harmful effect chips", () => {
  const effects = (overrides: Partial<ItemEffectsState> = {}): ItemEffectsState => ({
    delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false, ...overrides,
  });

  it.each([
    [effects({ delayDueTurns: [5] }), 2],
    [effects({ delayDueTurns: [5, 8, 8] }), 2],
    [effects({ suspensions: [{ serviceId: "jr-yamanote", expiresTurn: 8 }, { serviceId: "fixture-south", expiresTurn: 10 }] }), 3],
    [effects({ detourPending: true, oversleepPending: true }), 2],
    [effects({ delayDueTurns: [3], suspensions: [{ serviceId: "jr-yamanote", expiresTurn: 3 }], detourPending: true }), 3],
  ])("uses canonical copy and metadata for %#", (state: ItemEffectsState, turn: number) => {
    const models = effectChipModels(state, turn, network);
    expect(models.map((model) => model.text)).toEqual(activeItemEffectTexts(state, turn, network));
    expect(new Set(models.map((model) => model.key)).size).toBe(models.length);
    expect(effectChipModels(state, turn, network).map((model) => model.key)).toEqual(models.map((model) => model.key));
    models.filter((model) => model.kind === "detour" || model.kind === "oversleep")
      .forEach((model) => expect(model.remainingTurns).toBeNull());
  });

  it("keeps the remaining chips' keys when an earlier delay or suspension expires", () => {
    const before = effects({ delayDueTurns: [3, 6, 6],
      suspensions: [{ serviceId: "jr-yamanote", expiresTurn: 4 }, { serviceId: "fixture-south", expiresTurn: 9 }],
      detourPending: true });
    const after = effects({ delayDueTurns: [6, 6], suspensions: before.suspensions, detourPending: true });
    const keysAt = (state: ItemEffectsState, turn: number): Map<string, string> => new Map(
      effectChipModels(state, turn, network).map((model) => [model.key, model.text]));
    const earlier = keysAt(before, 3);
    const later = keysAt(after, 4);
    expect(earlier.size).toBe(6);
    expect([...later.keys()]).toEqual(["delay:6#0", "delay:6#1", "suspension:fixture-south:9#0", "detour:pending#0"]);
    expect([...later.keys()].every((key) => earlier.has(key))).toBe(true);
  });

  it("expires suspensions at the boundary but retains due-delay copy at zero", () => {
    const state = effects({ delayDueTurns: [4], suspensions: [{ serviceId: "jr-yamanote", expiresTurn: 4 }] });
    const models = effectChipModels(state, 4, network);
    expect(models.map((model) => model.kind)).toEqual(["delay"]);
    expect(models[0]?.remainingTurns).toBe(0);
    expect(models[0]?.text).toBe(activeItemEffectTexts(state, 4, network)[0]);
  });

  it("renders full text and harmful icons, and renders nothing when empty", () => {
    const models = effectChipModels(effects({ delayDueTurns: [4], detourPending: true }), 2, network);
    const markup = renderToStaticMarkup(createElement(EffectChips, { models }));
    expect(markup.match(/<div class="effect-chips" aria-label="続いている効果">/g)).toHaveLength(1);
    expect(markup).not.toMatch(/role=|aria-live/);
    expect([...markup.matchAll(/<span class="effect-chip__text">([^<]*)<\/span>/g)].map((match) => match[1]))
      .toEqual(models.map((model) => model.text));
    expect(markup.match(/<span class="effect-chip"><svg[^>]*aria-hidden="true"/g)).toHaveLength(models.length);
    expect(renderToStaticMarkup(createElement(EffectChips, { models: [] }))).toBe("");
  });
});
