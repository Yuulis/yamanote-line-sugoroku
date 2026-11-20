import { describe, expect, it } from "vitest";
import {
  buildGuideCopy,
  COACH_STEPS,
  FIRST_PLAY_HINT_IDS,
  isFirstPlayEligible,
  type FirstPlayEligibilityInput,
  type GuideStorageRead,
} from "../../src/features/game/firstPlayGuide";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  buildRailwayNetwork,
  createGame,
  filterLandingOptions,
  landingOptions,
  resolveLandingEvent,
} from "../../src/features/game/engine";
import {
  GUIDE_COACH_KEY,
  GUIDE_HINTS_DISABLED_KEY,
  GUIDE_STARTED_KEY,
  guideHintStorageKey,
  readFirstTurnNoticeForGuide,
  readGuideCoachSeen,
  readGuideHintSeen,
  readGuideHintsDisabled,
  readGuideStarted,
} from "../../src/features/game/store/guide";
import { FIRST_TURN_NOTICE_KEY } from "../../src/features/game/store/notices";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { M_LINE, M_LOOP, multiConfig, multiServiceInput } from "./fixtures/multiService";

const filteredLandingNetwork = buildRailwayNetwork(multiServiceInput());

function memoryStorage(initial: Record<string, string>): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const readable = (value: string | null): GuideStorageRead => ({ readable: true, value });
const unreadable: GuideStorageRead = { readable: false, value: null };

function eligibleInput(overrides: Partial<FirstPlayEligibilityInput> = {}): FirstPlayEligibilityInput {
  return {
    resumed: false,
    existingSaveObserved: false,
    saveLookups: ["none", "none"],
    firstTurnNotice: readable(null),
    guideStarted: readable(null),
    startedInMemory: false,
    ...overrides,
  };
}

describe("first-play guide pure model", () => {
  it("defines the three coach steps and five stable hint ids", () => {
    expect(COACH_STEPS).toEqual(["dice", "progress", "map"]);
    expect(FIRST_PLAY_HINT_IDS).toEqual([
      "lottery",
      "off-target",
      "item",
      "harmful-item",
      "terminus",
    ]);
  });

  it.each([
    ["resume at turn zero", { resumed: true }],
    ["a save observed earlier in this launch", { existingSaveObserved: true }],
    ["a valid save", { saveLookups: ["valid"] }],
    ["an invalid save payload", { saveLookups: ["invalid"] }],
    ["an unavailable save lookup", { saveLookups: ["none", "unavailable"] }],
    ["an unreadable save lookup list", { saveLookups: [] }],
    ["the first-turn notice already seen", { firstTurnNotice: readable("1") }],
    ["an unreadable first-turn notice", { firstTurnNotice: unreadable }],
    ["the guide already started in storage", { guideStarted: readable("1") }],
    ["the guide already started in memory", { startedInMemory: true }],
    ["an unreadable guide started flag", { guideStarted: unreadable }],
  ] as const)("suppresses automatic guidance for %s", (_name, overrides) => {
    expect(isFirstPlayEligible(eligibleInput(overrides))).toBe(false);
  });

  it("allows a genuinely new game after every edition lookup reports no save", () => {
    expect(isFirstPlayEligible(eligibleInput({ saveLookups: ["none", "none", "none"] }))).toBe(true);
  });

  it("treats readable non-one values as unset", () => {
    expect(isFirstPlayEligible(eligibleInput({
      firstTurnNotice: readable("true"),
      guideStarted: readable("0"),
    }))).toBe(true);
  });

  it("keeps coach and hint preferences separate from new-session eligibility", () => {
    const storage = memoryStorage({
      [GUIDE_STARTED_KEY]: "0",
      [FIRST_TURN_NOTICE_KEY]: "0",
      [GUIDE_COACH_KEY]: "1",
      [GUIDE_HINTS_DISABLED_KEY]: "1",
      ...Object.fromEntries(FIRST_PLAY_HINT_IDS.map((hintId) => [guideHintStorageKey(hintId), "1"])),
    });
    const guideStarted = readGuideStarted(storage);
    const firstTurnNotice = readFirstTurnNoticeForGuide(storage);

    expect(readGuideCoachSeen(storage)).toEqual({ readable: true, value: "1" });
    expect(readGuideHintsDisabled(storage)).toEqual({ readable: true, value: "1" });
    for (const hintId of FIRST_PLAY_HINT_IDS) {
      expect(readGuideHintSeen(storage, hintId)).toEqual({ readable: true, value: "1" });
    }
    expect(guideStarted).toEqual({ readable: true, value: "0" });
    expect(firstTurnNotice).toEqual({ readable: true, value: "0" });
    expect(isFirstPlayEligible(eligibleInput({ guideStarted, firstTurnNotice }))).toBe(true);
  });

  it("builds edition-aware coach copy using resolved display names", () => {
    expect(buildGuideCopy({
      kind: "coach",
      step: "dice",
      config: ITEM_GAME_CONFIG,
      targetName: "山手線",
      startName: "新橋",
    })).toMatchObject({
      copyId: "coach-dice",
      hintId: null,
      sectionId: "goal",
      text: "サイコロを振ると、出た目の数だけ駅を進みます。",
    });
    expect(buildGuideCopy({
      kind: "coach",
      step: "progress",
      config: ITEM_GAME_CONFIG,
      targetName: "山手線",
      startName: "新橋",
    })?.text).toBe("踏破区間のバーを埋めて、山手線の全区間をめぐりましょう。");
    expect(buildGuideCopy({
      kind: "coach",
      step: "map",
      config: ITEM_GAME_CONFIG,
      targetName: "山手線",
      startName: "新橋",
    })).toMatchObject({
      copyId: "coach-map-yamanote",
      text: "サイコロと抽選まかせで、山手線を一周して新橋へ。",
    });
    expect(buildGuideCopy({
      kind: "coach",
      step: "map",
      config: { ...ITEM_GAME_CONFIG, targetServiceId: "local-loop", startStationId: "kashiwa" },
      targetName: "常磐線",
      startName: "柏",
    })).toMatchObject({
      copyId: "coach-map-other",
      text: "常磐線の全区間をめぐって、柏を目指しましょう。",
    });
  });

  it("selects lottery copy only for the published draw types that occurred", () => {
    const service = buildGuideCopy({ kind: "lottery", resultPublished: true, serviceDrawRequired: true, directionDrawRequired: false });
    const direction = buildGuideCopy({ kind: "lottery", resultPublished: true, serviceDrawRequired: false, directionDrawRequired: true });
    const both = buildGuideCopy({ kind: "lottery", resultPublished: true, serviceDrawRequired: true, directionDrawRequired: true });

    expect(service).toMatchObject({
      copyId: "lottery-service",
      hintId: "lottery",
      sectionId: "lottery",
      text: "乗換駅で移動を終えると、候補の中から次に乗る路線を抽選します。",
    });
    expect(direction).toMatchObject({
      copyId: "lottery-direction",
      text: "移動を終えた駅で、次に進む向きを抽選します。",
    });
    expect(both).toMatchObject({
      copyId: "lottery-service-direction",
      text: "乗換駅で移動を終えると、候補の中から次に乗る路線と進む向きを抽選します。",
    });
    expect(buildGuideCopy({ kind: "lottery", resultPublished: false, serviceDrawRequired: true, directionDrawRequired: true })).toBeNull();
    expect(buildGuideCopy({ kind: "lottery", resultPublished: true, serviceDrawRequired: false, directionDrawRequired: false })).toBeNull();
  });

  it.each([
    ["detour excludes the ridden target service", { turn: 5, suspensions: [], detourServiceId: M_LOOP }],
    ["suspension excludes the ridden target service", { turn: 5, suspensions: [{ serviceId: M_LOOP, expiresTurn: 5 }] }],
  ] as const)("uses direction-only lottery copy when %s", (_caseName, filters) => {
    const game = createGame(multiConfig(), "guide-filtered-lottery", filteredLandingNetwork);
    const arrival = { ...game, currentStationId: "d", currentServiceId: M_LOOP };
    const unfiltered = landingOptions(arrival, filteredLandingNetwork);
    const filtered = filterLandingOptions(unfiltered, arrival.config, filters, filteredLandingNetwork);
    const unfilteredEvent = resolveLandingEvent(unfiltered, M_LOOP, { serviceId: M_LINE, direction: 1 }).event;

    expect(filtered.options.services).toEqual([M_LINE]);
    expect(filtered.options.directionsByService.get(M_LINE)).toEqual([1, -1]);
    expect(filtered.options.serviceDrawRequired).toBe(false);
    expect(unfilteredEvent.serviceDrawRequired).toBe(true);

    const { event } = resolveLandingEvent(filtered.options, M_LOOP, { serviceId: M_LINE, direction: 1 });
    expect(event).toMatchObject({
      serviceCandidates: [M_LINE],
      serviceDrawRequired: false,
      directionCandidates: [1, -1],
      directionDrawRequired: true,
    });
    expect(buildGuideCopy({
      kind: "lottery",
      resultPublished: true,
      serviceDrawRequired: unfilteredEvent.serviceDrawRequired,
      directionDrawRequired: unfilteredEvent.directionDrawRequired,
    })?.copyId).toBe("lottery-service-direction");

    expect(buildGuideCopy({
      kind: "lottery",
      resultPublished: true,
      serviceDrawRequired: event.serviceDrawRequired,
      directionDrawRequired: event.directionDrawRequired,
    })).toMatchObject({
      copyId: "lottery-direction",
      text: "移動を終えた駅で、次に進む向きを抽選します。",
    });
  });

  it.each([
    ["has two distinct target distances and toward bias", [2, 5], { towardTargetWeight: 3, awayFromTargetWeight: 2 }, true],
    ["supports the classic 2:1 policy", [2, 5], { towardTargetWeight: 2 }, true],
    ["has equal weights", [2, 5], { towardTargetWeight: 2, awayFromTargetWeight: 2 }, false],
    ["favors away from the target", [2, 5], { towardTargetWeight: 1, awayFromTargetWeight: 3 }, false],
    ["has equal distances", [3, 3], { towardTargetWeight: 3, awayFromTargetWeight: 2 }, false],
    ["has only one possible direction", [3], { towardTargetWeight: 3, awayFromTargetWeight: 2 }, false],
    ["has no movable directions", [], { towardTargetWeight: 3, awayFromTargetWeight: 2 }, false],
  ] as const)("applies the off-target candidate rule when it %s", (_name, distances, policy, expected) => {
    const result = buildGuideCopy({
      kind: "off-target",
      resultPublished: true,
      config: { ...ITEM_GAME_CONFIG, directionLottery: policy },
      targetName: "山手線",
      landing: { serviceId: "tozai", directionDistancesToTarget: distances },
    });

    expect(result !== null).toBe(expected);
    if (expected) {
      expect(result).toMatchObject({
        copyId: "off-target",
        hintId: "off-target",
        sectionId: "lottery",
        text: "山手線以外の路線では、山手線に近づく向きが抽選で出やすくなっています。",
      });
    }
  });

  it("keeps off-target unseen until a qualifying published landing", () => {
    const base = {
      kind: "off-target" as const,
      config: ITEM_GAME_CONFIG,
      targetName: "山手線",
      landing: { serviceId: "tozai", directionDistancesToTarget: [2, 5] as const },
    };

    expect(buildGuideCopy({ ...base, resultPublished: false })).toBeNull();
    expect(buildGuideCopy({ ...base, resultPublished: true, landing: { ...base.landing, serviceId: "jr-yamanote" } })).toBeNull();
  });

  it("maps item variants to the original hint ids and exact copy", () => {
    expect(buildGuideCopy({ kind: "item", resultPublished: true })).toMatchObject({
      copyId: "item",
      hintId: "item",
      sectionId: "items",
      text: "アイテムを手に入れました。使うタイミングは、持ち物の説明で確認できます。",
    });
    expect(buildGuideCopy({ kind: "item", resultPublished: true, pendingDiscard: true })).toMatchObject({
      copyId: "item-pending-discard",
      hintId: "item",
      text: "持ち物がいっぱいのときは、持っているものと新しいものから、捨てるものを1つ選びます。",
    });
    expect(buildGuideCopy({ kind: "harmful-item", resultPublished: true })).toMatchObject({
      copyId: "harmful-item",
      hintId: "harmful-item",
      text: "不利なアイテムは持ち物には入らず、それぞれ決まったタイミングで自動で効きます。",
    });
    expect(buildGuideCopy({ kind: "harmful-item", resultPublished: true, cancelled: true })).toMatchObject({
      copyId: "harmful-item-cancelled",
      hintId: "harmful-item",
      text: "遅延証明書が、不利なアイテムを打ち消しました。",
    });
  });

  it.each([
    ["pending item discard", { kind: "item", resultPublished: false, pendingDiscard: true }],
    ["harmful item", { kind: "harmful-item", resultPublished: false }],
    ["certificate-cancelled harmful item", { kind: "harmful-item", resultPublished: false, cancelled: true }],
    ["terminus with unused pips", {
      kind: "terminus",
      resultPublished: false,
      stopReason: "endpoint",
      endpointKind: "terminus",
      unusedPips: 2,
    }],
  ] as const)("does not build unpublished copy for %s", (_caseName, request) => {
    expect(buildGuideCopy(request)).toBeNull();
  });

  it("builds a terminus hint only for an endpoint terminus with unused pips", () => {
    const base = { kind: "terminus" as const, resultPublished: true, stopReason: "endpoint" as const, endpointKind: "terminus" as const, unusedPips: 2 };
    expect(buildGuideCopy(base)).toMatchObject({
      copyId: "terminus",
      hintId: "terminus",
      sectionId: "goal",
      text: "終点ではそこで止まり、残りの出目は使いません。",
    });
    expect(buildGuideCopy({ ...base, endpointKind: "area-boundary" })).toBeNull();
    expect(buildGuideCopy({ ...base, endpointKind: "service-boundary" })).toBeNull();
    expect(buildGuideCopy({ ...base, unusedPips: 0 })).toBeNull();
    expect(buildGuideCopy({ ...base, stopReason: "roll" })).toBeNull();
  });

  it("keeps verified control copy exact", () => {
    expect(buildGuideCopy({ kind: "control", copyId: "skip-label" })?.text).toBe("演出をスキップ");
    expect(buildGuideCopy({ kind: "control", copyId: "skip-help" })?.text).toBe("「演出をスキップ」で、移動の演出を飛ばせます。");
    expect(buildGuideCopy({ kind: "control", copyId: "shortcut-help" })?.text).toBe("Space / Enter：サイコロを振る　S / Escape：演出をスキップ");
    expect(buildGuideCopy({ kind: "control", copyId: "adjustment-escape" })?.text).toBe("Escapeキーでも「そのまま」で続けます。");
    expect(buildGuideCopy({ kind: "control", copyId: "adjustment-caution" })?.text).toBe("出目を見た後はターンを取り消せません。");
  });
});
