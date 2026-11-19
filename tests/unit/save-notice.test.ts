import { describe, expect, it } from "vitest";
import {
  beginItemTurn, buildRailwayNetwork, createGame, createItemGame, playItemTurn, playTurn, resolveItemDiscard,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  FIRST_TURN_NOTICE_TEXT, isFirstTurnNoticeEligible, selectAnnouncement,
  type NoticeAnnouncementInput, type NoticeAnnouncementState, type SaveAttempt,
} from "../../src/features/game/saveNotice";
import type { StorageLike } from "../../src/features/game/store/persistence";
import {
  FIRST_TURN_NOTICE_KEY, readFirstTurnNotice, writeFirstTurnNotice,
} from "../../src/features/game/store/notices";
import type { BeneficialItemKind, GameState, ItemGameState } from "../../src/types/network";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";

const network = buildRailwayNetwork(multiServiceInput());
const SESSION = 1;
const OTHER_SESSION = 2;
const items = { ...multiConfig(), rulesetVersion: "save-notice-items-1",
  itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille: 1000, harmfulChancePercent: 0,
    beneficialKinds: ["double"] as BeneficialItemKind[] } };
/** A classic game still playing after its first turn (the small network can finish in one). */
function playingAfterFirstTurn(): { baseline: GameState; completed: GameState } {
  for (let seed = 0; seed < 100; seed++) {
    const baseline = createGame(multiConfig(), `notice-classic-${seed}`, network);
    const completed = playTurn(baseline, network).state;
    if (completed.status === "playing") return { baseline, completed };
  }
  throw new Error("No playing classic fixture found");
}
const { baseline, completed } = playingAfterFirstTurn();
/** A classic game still playing after two turns, with the turn-1 game it resumed from. */
function playingAfterTwoTurns(): { first: GameState; second: GameState } {
  for (let seed = 0; seed < 100; seed++) {
    const first = playTurn(createGame(multiConfig(), `notice-resume-${seed}`, network), network).state;
    if (first.status !== "playing") continue;
    const second = playTurn(first, network).state;
    if (second.status === "playing") return { first, second };
  }
  throw new Error("No two-turn playing classic fixture found");
}

function attempt(overrides: Partial<SaveAttempt> = {}): SaveAttempt {
  return { id: 1, sessionId: SESSION, game: completed, result: "saved", entryTurn: 0, ...overrides };
}
function eligible(value: SaveAttempt | null, delivered = false, session: number | null = SESSION): boolean {
  return isFirstTurnNoticeEligible(value, session, delivered);
}
/** An item game waiting for a discard at its committed turn, with the resolved game that follows. */
function discardFixture(): { pending: ItemGameState; resolved: ItemGameState } {
  for (let seed = 0; seed < 100; seed++) {
    let game = createItemGame(items, `notice-${seed}`, network);
    for (let turn = 0; turn < 30 && game.status === "playing"; turn++) {
      game = playItemTurn(game, {}, network).state;
      const choice = game.pending?.kind === "discard" ? game.pending.candidates[0] : undefined;
      if (choice) return { pending: game, resolved: resolveItemDiscard(game, choice.id).state };
    }
  }
  throw new Error("No discard fixture found");
}
function storage(overrides: Partial<StorageLike> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    ...overrides,
  };
}

describe("first-turn notice eligibility", () => {
  it("rejects turn zero restored baseline and wrong-session attempts", () => {
    expect(eligible(null)).toBe(false);
    expect(eligible(attempt({ game: baseline }))).toBe(false);
    expect(eligible(attempt({ entryTurn: completed.turn }))).toBe(false);
    expect(eligible(attempt({ sessionId: OTHER_SESSION }))).toBe(false);
    expect(eligible(attempt(), false, null)).toBe(false);
    expect(eligible(attempt({ result: "failed" }))).toBe(false);
    expect(eligible(attempt({ result: "unavailable" }))).toBe(false);
    expect(eligible(attempt({ game: { ...completed, status: "completed" as const } }))).toBe(false);
    expect(eligible(attempt(), true)).toBe(false);
  });

  it("accepts a successful completed turn beyond session entry", () => {
    expect(eligible(attempt())).toBe(true);
  });

  it("measures progress from a resumed entry turn away from zero", () => {
    const { first, second } = playingAfterTwoTurns();
    const entryTurn = first.turn;

    expect(entryTurn).toBe(1);
    expect(eligible(attempt({ game: first, entryTurn }))).toBe(false);
    expect(eligible(attempt({ game: second, entryTurn }))).toBe(true);
  });

  it("accepts resolved pending discard progress", () => {
    const { pending, resolved } = discardFixture();
    const entryTurn = pending.turn - 1;

    expect(eligible(attempt({ game: pending, entryTurn }))).toBe(false);
    expect(eligible(attempt({ id: 2, game: resolved, entryTurn }))).toBe(true);
    const pendingRoll = beginItemTurn(resolved, { items: [] }, network).state;
    expect(pendingRoll.pending?.kind).toBe("roll");
    expect(eligible(attempt({ game: pendingRoll, entryTurn }))).toBe(false);
  });

  it("failed save then later success is eligible once", () => {
    const failed = attempt({ result: "failed" });
    const recovered = attempt({ id: 2 });

    expect(eligible(failed)).toBe(false);
    expect(eligible(recovered)).toBe(true);
    expect(eligible(recovered, true)).toBe(false);
  });
});

describe("first-turn notice storage", () => {
  it("notice storage handles absent invalid and throwing storage", () => {
    const store = storage();
    const throwing = storage({
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
    });

    expect(FIRST_TURN_NOTICE_KEY).toBe("yamanote-line-sugoroku:notice:auto-resume:v1");
    expect(FIRST_TURN_NOTICE_KEY).not.toMatch(/save/i);
    expect(readFirstTurnNotice(null)).toBe(false);
    expect(writeFirstTurnNotice(null)).toBe(false);
    expect(readFirstTurnNotice(store)).toBe(false);
    store.data.set(FIRST_TURN_NOTICE_KEY, "yes");
    expect(readFirstTurnNotice(store)).toBe(false);
    expect(readFirstTurnNotice(throwing)).toBe(false);
    expect(writeFirstTurnNotice(throwing)).toBe(false);
    expect(writeFirstTurnNotice(store)).toBe(true);
    expect(store.data.get(FIRST_TURN_NOTICE_KEY)).toBe("1");
    expect(readFirstTurnNotice(store)).toBe(true);
  });

  it("uses the agreed notice copy", () => {
    expect(FIRST_TURN_NOTICE_TEXT).toBe("自動で保存しています。いつでも閉じて、続きから遊べます");
  });
});

describe("notice announcement arbitration", () => {
  const SUMMARY = "3ターン目。駅Aに着きました。";
  const NEXT_SUMMARY = "4ターン目。駅Bに着きました。";
  const idle: NoticeAnnouncementState = { pendingKey: null, announcedKey: null, coveredOrdinary: null };
  const requested: NoticeAnnouncementState = { ...idle, pendingKey: "notice-1" };
  const announced = (covered: string): NoticeAnnouncementState => (
    { pendingKey: "notice-1", announcedKey: "notice-1", coveredOrdinary: covered });
  const notice = { text: FIRST_TURN_NOTICE_TEXT, announcesNotice: true };
  const held = { text: FIRST_TURN_NOTICE_TEXT, announcesNotice: false };
  function select(overrides: Partial<NoticeAnnouncementInput> = {}): ReturnType<typeof selectAnnouncement> {
    return selectAnnouncement({
      state: requested, ordinaryAnnouncement: "", previousOrdinary: "", decisionOwned: false, ...overrides,
    });
  }

  it("standing turn summary does not block the notice", () => {
    expect(select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY })).toEqual(notice);
    expect(select()).toEqual(notice);
    expect(select({ state: idle, ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY }))
      .toEqual({ text: SUMMARY, announcesNotice: false });
  });

  it("fresh ordinary text defers the notice", () => {
    expect(select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: "" }))
      .toEqual({ text: SUMMARY, announcesNotice: false });
    expect(select({ ordinaryAnnouncement: "", previousOrdinary: SUMMARY }))
      .toEqual({ text: "", announcesNotice: false });
    expect(select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: null }))
      .toEqual({ text: SUMMARY, announcesNotice: false });
  });

  it("acknowledged notice holds until the ordinary text changes", () => {
    const state = announced(SUMMARY);

    expect(select({ state, ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY })).toEqual(held);
    expect(select({ state, ordinaryAnnouncement: NEXT_SUMMARY, previousOrdinary: SUMMARY }))
      .toEqual({ text: NEXT_SUMMARY, announcesNotice: false });
    expect(select({ state, ordinaryAnnouncement: NEXT_SUMMARY, previousOrdinary: NEXT_SUMMARY }))
      .toEqual({ text: NEXT_SUMMARY, announcesNotice: false });
  });

  it("decision ownership defers notice announcement", () => {
    expect(select({ decisionOwned: true })).toEqual({ text: "", announcesNotice: false });
    expect(select({ decisionOwned: true, ordinaryAnnouncement: "選択中です。", previousOrdinary: "選択中です。" }))
      .toEqual({ text: "選択中です。", announcesNotice: false });
    expect(select({ state: announced(""), decisionOwned: true })).toEqual({ text: "", announcesNotice: false });
    expect(select({ decisionOwned: false })).toEqual(notice);
  });
});
