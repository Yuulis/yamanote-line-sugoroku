import { describe, expect, it } from "vitest";
import {
  beginItemTurn, buildRailwayNetwork, createGame, createItemGame, playItemTurn, playTurn, resolveItemDiscard,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  FIRST_TURN_NOTICE_TEXT, isFirstTurnNoticeEligible, selectAnnouncement,
  isNoticeAnnouncementOwned, noticeAnnouncementIdentity,
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
    beneficialKinds: ["double"] as BeneficialItemKind[], beneficialWeights: [1] } };
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
  const firstTurnNotice = { key: "notice-1", text: FIRST_TURN_NOTICE_TEXT };
  const hintAcknowledgement = { sessionId: SESSION, candidateKey: "hint-1", displayGeneration: 1 };
  const hintAnnouncement = {
    key: "guide-hint:1:hint-1:1", text: "抽選のヒントです。", acknowledgement: hintAcknowledgement,
  };
  const idle: NoticeAnnouncementState = { current: null, coveredOrdinary: null, deliveredIds: [] };
  function select(overrides: Partial<NoticeAnnouncementInput> = {}): ReturnType<typeof selectAnnouncement> {
    return selectAnnouncement({
      state: idle, ordinaryAnnouncement: "", previousOrdinary: "", firstTurnNotice, hintAnnouncement,
      decisionOwned: false, ...overrides,
    });
  }

  it("standing turn summary does not block the notice", () => {
    const selected = select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY });
    expect(selected.text).toBe(FIRST_TURN_NOTICE_TEXT);
    expect(selected.announcement).toMatchObject({ key: "notice-1", text: FIRST_TURN_NOTICE_TEXT, source: "first-turn" });
    expect(selected.announcesNotice).toBe(true);
    expect(select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY, hintAnnouncement: null }).announcement)
      .toMatchObject({ key: "notice-1", text: FIRST_TURN_NOTICE_TEXT });
    expect(select({ state: idle, ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY,
      firstTurnNotice: null, hintAnnouncement: null }))
      .toMatchObject({ text: SUMMARY, announcement: null, announcesNotice: false });
  });

  it("selects #68 when no ordinary text follows and no hint is present", () => {
    expect(select({ firstTurnNotice, hintAnnouncement: null, ordinaryAnnouncement: "", previousOrdinary: "" }))
      .toMatchObject({
        text: FIRST_TURN_NOTICE_TEXT,
        announcement: { key: firstTurnNotice.key, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn" },
        announcesNotice: true,
      });
  });

  it("fresh ordinary text defers the notice", () => {
    expect(select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: "" }))
      .toMatchObject({ text: SUMMARY, announcement: null, announcesNotice: false });
    expect(select({ ordinaryAnnouncement: "", previousOrdinary: SUMMARY }))
      .toMatchObject({ text: "", announcement: null, announcesNotice: false });
    expect(select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: null }))
      .toMatchObject({ text: SUMMARY, announcement: null, announcesNotice: false });
  });

  it("hands off from #68 to the current hint without mixing either key or copy", () => {
    const firstTurn = select({ ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY });
    if (!firstTurn.announcement) throw new Error("Expected the #68 announcement");
    const stateAfterFirstTurn: NoticeAnnouncementState = {
      current: firstTurn.announcement,
      coveredOrdinary: SUMMARY,
      deliveredIds: [noticeAnnouncementIdentity(firstTurn.announcement)],
    };

    const handover = select({ state: stateAfterFirstTurn, ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY });
    expect(handover).toMatchObject({
      text: hintAnnouncement.text,
      announcement: {
        key: hintAnnouncement.key,
        text: hintAnnouncement.text,
        source: "hint",
        acknowledgement: hintAcknowledgement,
      },
      announcesNotice: true,
    });

    const stateAfterHint: NoticeAnnouncementState = {
      current: handover.announcement,
      coveredOrdinary: SUMMARY,
      deliveredIds: [noticeAnnouncementIdentity(firstTurn.announcement),
        ...(handover.announcement ? [noticeAnnouncementIdentity(handover.announcement)] : [])],
    };
    expect(select({ state: stateAfterHint, ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY }))
      .toMatchObject({ text: hintAnnouncement.text, announcement: { key: hintAnnouncement.key }, announcesNotice: false });
    expect(select({ state: stateAfterHint, ordinaryAnnouncement: NEXT_SUMMARY, previousOrdinary: SUMMARY }))
      .toMatchObject({ text: NEXT_SUMMARY, announcement: null, announcesNotice: false });
  });

  it("holds acknowledged #68 only until ordinary text changes without a hint", () => {
    const firstTurn = select({ firstTurnNotice, hintAnnouncement: null,
      ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY });
    if (!firstTurn.announcement) throw new Error("Expected the #68 announcement");
    const state: NoticeAnnouncementState = {
      current: firstTurn.announcement,
      coveredOrdinary: SUMMARY,
      deliveredIds: [noticeAnnouncementIdentity(firstTurn.announcement)],
    };

    expect(select({ state, firstTurnNotice, hintAnnouncement: null,
      ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY }))
      .toMatchObject({ text: FIRST_TURN_NOTICE_TEXT, announcement: { key: firstTurnNotice.key }, announcesNotice: false });
    expect(select({ state, firstTurnNotice, hintAnnouncement: null,
      ordinaryAnnouncement: NEXT_SUMMARY, previousOrdinary: SUMMARY }))
      .toMatchObject({ text: NEXT_SUMMARY, announcement: null, announcesNotice: false });
    expect(select({ state, firstTurnNotice, hintAnnouncement: null,
      ordinaryAnnouncement: NEXT_SUMMARY, previousOrdinary: NEXT_SUMMARY }))
      .toMatchObject({ text: NEXT_SUMMARY, announcement: null, announcesNotice: false });
  });

  it("replaces a stale display generation with the current hint acknowledgement", () => {
    const delivered = hintAnnouncement;
    const nextGeneration = {
      key: "guide-hint:1:hint-1:2",
      text: "抽選のヒントを再表示します。",
      acknowledgement: { ...hintAcknowledgement, displayGeneration: 2 },
    };
    const state: NoticeAnnouncementState = {
      current: { ...delivered, source: "hint" },
      coveredOrdinary: SUMMARY,
      deliveredIds: [noticeAnnouncementIdentity({ ...delivered, source: "hint" })],
    };
    const current = select({ state, firstTurnNotice: null, hintAnnouncement: nextGeneration,
      ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY });
    const selected = current.announcement;
    expect(selected).toMatchObject({ key: nextGeneration.key, source: "hint", acknowledgement: nextGeneration.acknowledgement });
    if (!selected || selected.source !== "hint") throw new Error("Expected a selected hint announcement");
    expect(selected.acknowledgement.displayGeneration).not.toBe(delivered.acknowledgement.displayGeneration);
    expect(current.announcesNotice).toBe(true);
  });

  it.each([
    ["engine decision", { engineDecisionOpen: true }],
    ["rules", { rulesOpen: true }],
    ["confirmation", { confirmationOpen: true }],
    ["local item dialog", { itemDialogOpen: true }],
    ["coach", { coachOpen: true }],
  ] as const)("defers notice announcement while the %s owns the panel", (_label, owned) => {
    const decisionOwned = isNoticeAnnouncementOwned({
      engineDecisionOpen: false, rulesOpen: false, confirmationOpen: false, itemDialogOpen: false, coachOpen: false,
      ...owned,
    });
    expect(decisionOwned).toBe(true);
    expect(select({ decisionOwned, ordinaryAnnouncement: SUMMARY, previousOrdinary: SUMMARY }))
      .toMatchObject({ text: SUMMARY, announcement: null, announcesNotice: false });
  });

  it("keeps empty ordinary text while decision ownership suppresses pending or acknowledged #68", () => {
    const currentFirstTurnNotice = { ...firstTurnNotice, source: "first-turn" as const };
    const acknowledgedWithEmptyOrdinary: NoticeAnnouncementState = {
      current: currentFirstTurnNotice,
      coveredOrdinary: "",
      deliveredIds: [noticeAnnouncementIdentity(currentFirstTurnNotice)],
    };
    const expected = { text: "", announcement: null, announcesNotice: false };

    expect(select({
      firstTurnNotice,
      hintAnnouncement: null,
      ordinaryAnnouncement: "",
      previousOrdinary: "",
      decisionOwned: true,
    })).toEqual(expected);
    expect(select({
      state: acknowledgedWithEmptyOrdinary,
      firstTurnNotice,
      hintAnnouncement: null,
      ordinaryAnnouncement: "",
      previousOrdinary: "",
      decisionOwned: true,
    })).toEqual(expected);
  });
});
