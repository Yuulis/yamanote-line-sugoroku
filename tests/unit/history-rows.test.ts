import { describe, expect, it } from "vitest";
import {
  beginItemTurn, createGame, createItemGame, finishItemTurn, playItemTurn, playTurn, resolveItemDiscard,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { buildHistoryRow, buildHistoryRows } from "../../src/features/game/historyRows";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { LEGACY_FIXTURE_GAME_SEED } from "../e2e/fixtures/seeds";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");
const presentation = createPresentationResolver(network);

function classicGame() {
  let game = createGame(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network);
  while (game.status === "playing") game = playTurn(game, network).state;
  return game;
}

function completedItemGame() {
  let game = createItemGame(ITEM_GAME_CONFIG, "00000000000000000000000000000004", network);
  while (game.status === "playing" && game.turn < 500) {
    game = playItemTurn(game, {}, network).state;
    if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
  }
  return game;
}

function useItem(name: Parameters<typeof itemScenario>[0], kind: "deadhead" | "rapid" | "double") {
  const base = itemScenario(name, network);
  const item = base.inventory.find((entry) => entry.kind === kind)!;
  const state = playItemTurn(base, { command: { items: [{ kind, instanceId: item.id }] } }, network).state;
  return buildHistoryRow(state.movementHistory.at(-1)!, network, presentation);
}

describe("history rows from a classic save", () => {
  const game = classicGame();
  const rows = buildHistoryRows(game.movementHistory, network, presentation);

  it("builds one row per saved turn in saved order", () => {
    expect(rows).toHaveLength(game.movementHistory.length);
    expect(rows.map((row) => row.turn)).toEqual(game.movementHistory.map((record) => record.turn));
    expect(rows.map((row) => row.turnText)).toEqual(game.movementHistory.map((record) => `${record.turn}ターン目`));
  });

  it("splits roll, movement, line and a transfer note into fields", () => {
    expect(rows[0]).toEqual({
      kind: "ride", recordIndex: 0, turn: 1, turnText: "1ターン目", rawRoll: 4, effectiveRoll: 4, adjusted: false,
      effectKinds: [], effectText: "", fromStationName: "新橋", toStationName: "品川", hopCount: 4,
      lineName: "山手線", directionText: "外回り", rollText: "出目4", moveText: "新橋 → 品川（4駅）", lineText: "山手線・外回り",
      notes: [{ kind: "transfer", label: null, text: "乗換: テスト南線（大森方面）" }],
    });
  });

  it("puts a truncated move's stop in a truncation note", () => {
    expect(rows[1]).toMatchObject({ rollText: "出目3", moveText: "品川 → 大森（2駅）", lineText: "テスト南線・大森方面" });
    expect(rows[1]!.notes).toEqual([{ kind: "truncation", label: "途中停止", text: "大森で終了〔エリア端〕、残り1を使わず" }]);
    expect(rows[14]!.notes).toEqual([{ kind: "truncation", label: "途中停止", text: "新橋で終了、残り1を使わず" }]);
  });

  it("has no notes for a move that used every pip without changing service", () => {
    expect(rows[9]).toMatchObject({ turn: 10, rollText: "出目5", moveText: "品川 → 渋谷（5駅）", notes: [] });
  });

  it("keeps a transfer back to the target line as its own note", () => {
    expect(rows[8]!.notes).toEqual([{ kind: "transfer", label: null, text: "乗換: 山手線（外回り）" }]);
  });
});

describe("history rows from an item save", () => {
  it("shows a short roll and carries station count in the move field", () => {
    const rows = buildHistoryRows(completedItemGame().movementHistory, network, presentation);
    expect(rows[0]).toEqual({
      kind: "item-ride", recordIndex: 0, turn: 1, turnText: "1ターン目", rawRoll: 6, effectiveRoll: 6, adjusted: false,
      effectKinds: [], effectText: "", fromStationName: "新橋", toStationName: "五反田", hopCount: 6,
      lineName: "山手線", directionText: "外回り", rollText: "出目6", moveText: "新橋 → 五反田（6駅）", lineText: "山手線・外回り",
      notes: [{ kind: "landing", label: "到着", text: "山手線のみ ／ 外回りに固定" }],
    });
    expect(rows.every((row) => !row.rollText.includes("残り-"))).toBe(true);
  });

  it("lists pickup and discard events as item notes, one per event", () => {
    const rows = buildHistoryRows(completedItemGame().movementHistory, network, presentation);
    const turn7 = rows[6]!.notes.filter((note) => note.kind === "item");
    expect(turn7.map((note) => note.text)).toEqual([
      "遅延証明書を拾いました。持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）",
      "遅延証明書を選んで捨てました",
    ]);
    expect(turn7.every((note) => note.label === "アイテム")).toBe(true);
  });

  it("marks the clearing turn with a goal note and no landing", () => {
    const rows = buildHistoryRows(completedItemGame().movementHistory, network, presentation);
    expect(rows.at(-1)).toEqual({
      kind: "item-ride", recordIndex: 9, turn: 10, turnText: "10ターン目", rawRoll: 1, effectiveRoll: 1, adjusted: false,
      effectKinds: [], effectText: "", fromStationName: "有楽町", toStationName: "新橋", hopCount: 1,
      lineName: "山手線", directionText: "外回り", rollText: "出目1", moveText: "有楽町 → 新橋（1駅）", lineText: "山手線・外回り",
      notes: [{ kind: "goal", label: null, text: "ゴールに到着しました" }],
    });
  });

  it("reports a used effect item and a long truncated rapid ride", () => {
    const base = itemScenario("rapid-long", network);
    const rapid = base.inventory.find((entry) => entry.kind === "rapid")!;
    const record = playItemTurn(base, { command: { items: [{ kind: "rapid", instanceId: rapid.id }] } }, network)
      .state.movementHistory.at(-1)!;
    if (record.kind !== "item-ride") throw new Error("Expected a saved rapid ride");
    const row = buildHistoryRow(record, network, presentation);
    expect(row.rollText).toBe(`出目${record.rawRoll}・快速`);
    expect(row.rawRoll).toBe(record.rawRoll);
    expect(row.effectiveRoll).toBe(record.effectiveFace);
    expect(row.adjusted).toBe(record.adjustment !== null);
    expect(row.effectKinds).toEqual(["rapid"]);
    expect(row.hopCount).toBe(record.traversedSegmentIds.length);
    expect(row.moveText).toBe(`${row.fromStationName} → ${row.toStationName}（${record.traversedSegmentIds.length}駅）`);
    expect(row.notes).toEqual([
      { kind: "truncation", label: "途中停止", text: `${row.toStationName}で終了、残り${record.unusedPips}を使わず` },
      { kind: "goal", label: null, text: "ゴールに到着しました" },
      { kind: "item", label: "アイテム", text: "快速券を使いました" },
    ]);
    const doubled = useItem("double", "double");
    expect(doubled.rollText).toBe("出目1・倍速");
    expect(doubled.moveText).toContain("（2駅）");
  });

  it("shows the adjusted die from the saved adjustment", () => {
    const base = itemScenario("adjust", network);
    const pending = beginItemTurn(base, { items: [] }, network).state;
    const ticket = base.inventory.find((item) => item.kind === "roll-adjust")!;
    const arrived = finishItemTurn(pending, { instanceId: ticket.id, delta: 1 }, network).state;
    const savedRecord = arrived.movementHistory.at(-1)!;
    if (savedRecord.kind !== "item-ride") throw new Error("Expected the adjusted item ride");
    const record = { ...savedRecord, rawRoll: 3, effectiveFace: 4,
      adjustment: { instanceId: ticket.id, delta: 1 as const } };
    const row = buildHistoryRow(record, network, presentation);
    expect(row.rawRoll).toBe(3);
    expect(row.effectiveRoll).toBe(4);
    expect(row.rollText).toBe("出目3→4");
    expect(row.adjusted).toBe(true);
    expect(row.effectKinds).toEqual(["roll-adjust"]);
    expect(row.effectText).toBe("");
    expect(row.notes.map((note) => note.text)).toContain("出目調整券を使いました");
  });

  it("shows a deadhead without a roll or a line, resolving both stations", () => {
    expect(useItem("deadhead", "deadhead")).toEqual({
      kind: "deadhead", recordIndex: 0, turn: 5, turnText: "5ターン目", rawRoll: null, effectiveRoll: null, adjusted: false,
      effectKinds: ["deadhead"], effectText: "回送", fromStationName: "大森", toStationName: "品川", hopCount: 0,
      lineName: null, directionText: null, rollText: "回送", moveText: "大森 → 品川（0駅）", lineText: null,
      notes: [
        { kind: "landing", label: null, text: "回送列車で品川へ移りました（走行区間なし）" },
        { kind: "item", label: "アイテム", text: "回送列車を使いました" },
      ],
    });
  });

  it("keeps the saved suspension fallback as one structured note", () => {
    const record = completedItemGame().movementHistory.find((candidate) =>
      candidate.kind === "item-ride" && candidate.landingSnapshot !== null);
    expect(record?.kind).toBe("item-ride");
    if (!record || record.kind !== "item-ride" || !record.landingSnapshot) throw new Error("Expected an item landing snapshot");
    const row = buildHistoryRow({
      ...record,
      landingSnapshot: { ...record.landingSnapshot, suspensionIgnored: true },
    }, network, presentation, 4);
    expect(row.recordIndex).toBe(4);
    expect(row.notes.filter((note) => note.kind === "suspension")).toEqual([
      { kind: "suspension", label: null, text: "この駅では候補がすべて運休のため、運休を無視して抽選しました" },
    ]);
  });

  it("restores the same rows from a resumed save", () => {
    const game = completedItemGame();
    expect(buildHistoryRows(JSON.parse(JSON.stringify(game.movementHistory)), network, presentation))
      .toEqual(buildHistoryRows(game.movementHistory, network, presentation));
  });
});
