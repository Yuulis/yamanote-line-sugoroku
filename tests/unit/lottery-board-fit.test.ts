// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { TURN_RESULT_PILL_LAYOUT_EVENT } from "../../src/features/game/turnResultPillLayout";
import { LotteryReveal, type LotteryRevealProps } from "../../src/features/game/components/LotteryReveal";
import {
  LOTTERY_FIT_MIN_SCALE,
  lotteryFitScale,
  TURN_RESULT_PILL_SELECTOR,
  TurnMomentHost,
  type EdgeInsets,
  type RectBox,
} from "../../src/features/game/components/TurnMomentHost";
import { multiServiceInput } from "./fixtures/multiService";
import { mountReact, type MountedReact } from "./helpers/reactDom";

// Natural drawn split-flap board measured in Chromium at 320px wide (heading and two rows).
const BOARD_WIDTH_PX = 127.2;
const BOARD_HEIGHT_PX = 190.6;
// The last row's bottom margin collapses through the board into the card box.
const COLLAPSED_MARGIN_PX = 5.6;
const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const PHONE_INSETS: EdgeInsets = { top: 56, right: 84, bottom: 0, left: 56 };
const BOARD = { width: BOARD_WIDTH_PX, height: BOARD_HEIGHT_PX };
const CARD = { width: BOARD_WIDTH_PX, height: BOARD_HEIGHT_PX + COLLAPSED_MARGIN_PX };

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn((_element: Element): void => undefined);
  readonly disconnect = vi.fn((): void => undefined);

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const mounted: MountedReact[] = [];

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  for (const mount of mounted.splice(0)) mount.cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function region(top: number, height: number, width: number = 320): RectBox {
  return { left: 0, top, width, height };
}

describe("lotteryFitScale", () => {
  it("keeps exactly 1 when the board fits, including an exact fit", () => {
    expect(lotteryFitScale(BOARD, region(0, 252.4), PHONE_INSETS)).toBe(1);
    expect(lotteryFitScale({ ...BOARD, height: 191.6 }, region(0, 252.4), PHONE_INSETS)).toBe(1);
    expect(lotteryFitScale(BOARD, region(0, 56 + BOARD_HEIGHT_PX), PHONE_INSETS)).toBe(1);
    expect(lotteryFitScale(BOARD, region(0, 800, 958), { top: 56, right: 84, bottom: 56, left: 0 })).toBe(1);
  });

  it("shrinks a too-tall board to the free height minus the 1px guard", () => {
    const scale = lotteryFitScale(BOARD, region(0, 204), PHONE_INSETS);

    expect(scale).toBeCloseTo((204 - 56 - 1) / BOARD_HEIGHT_PX, 10);
    expect(BOARD_HEIGHT_PX * scale).toBeLessThanOrEqual(204 - 56);
  });

  it("decides fit by the drawn board but shrinks the whole card box once it must shrink", () => {
    const fitsOnlyAsBoard = region(0, 56 + BOARD_HEIGHT_PX + 1);
    expect(lotteryFitScale(BOARD, fitsOnlyAsBoard, PHONE_INSETS, CARD)).toBe(1);

    const scale = lotteryFitScale(BOARD, region(0, 204), PHONE_INSETS, CARD);
    expect(scale).toBeCloseTo((204 - 56 - 1) / CARD.height, 10);
    expect(CARD.height * scale).toBeLessThanOrEqual(204 - 56);
  });

  it.each([
    ["smaller", { width: 10, height: 10 }],
    ["null", null],
    ["NaN", { width: Number.NaN, height: 300 }],
  ] as const)("never fits a %s card box smaller than the board", (_label, card) => {
    expect(lotteryFitScale(BOARD, region(0, 204), PHONE_INSETS, card)).toBeCloseTo((204 - 56 - 1) / BOARD_HEIGHT_PX, 10);
  });

  it("shrinks a too-wide board by width when width is the tighter axis", () => {
    const scale = lotteryFitScale({ width: 300, height: 100 }, region(0, 400, 200), NO_INSETS);

    expect(scale).toBeCloseTo(199 / 300, 10);
  });

  it("stops at the floor and never returns more than 1", () => {
    expect(lotteryFitScale(BOARD, region(0, 60), NO_INSETS)).toBe(LOTTERY_FIT_MIN_SCALE);
    expect(lotteryFitScale(BOARD, region(0, 56), PHONE_INSETS)).toBe(LOTTERY_FIT_MIN_SCALE);
    expect(lotteryFitScale(BOARD, region(0, 10), PHONE_INSETS)).toBe(LOTTERY_FIT_MIN_SCALE);
    expect(lotteryFitScale({ width: 1, height: 1 }, region(0, 10_000), NO_INSETS)).toBe(1);
  });

  it.each([
    ["null", null],
    ["zero width", { width: 0, height: BOARD_HEIGHT_PX }],
    ["NaN height", { width: BOARD_WIDTH_PX, height: Number.NaN }],
    ["infinite height", { width: BOARD_WIDTH_PX, height: Number.POSITIVE_INFINITY }],
  ] as const)("keeps 1 for an unmeasurable %s board", (_label, natural) => {
    expect(lotteryFitScale(natural, region(0, 100), NO_INSETS)).toBe(1);
  });

  it("keeps 1 for a non-finite free rectangle instead of producing NaN", () => {
    expect(lotteryFitScale(BOARD, { left: 0, top: 0, width: Number.NaN, height: 100 }, NO_INSETS)).toBe(1);
  });
});

function lotteryProps(stage: LotteryRevealProps["stage"], target: HTMLElement | null = null): LotteryRevealProps {
  const network = buildRailwayNetwork(multiServiceInput());
  const id = [...network.servicesById.keys()][0]!;
  return {
    network,
    presentation: createPresentationResolver(network),
    stage,
    durationMs: stage === "lottery-flip" ? 1600 : 400,
    landing: {
      type: "landing-resolved", stationId: "a", serviceId: id, direction: 1, serviceCandidates: [id],
      directionCandidates: [1, -1], serviceDrawRequired: false, directionDrawRequired: true, changedService: false,
    },
    rideTarget: target ? { current: target } : createRef<HTMLElement>(),
    directionTarget: target ? { current: target } : createRef<HTMLElement>(),
  };
}

function rowMotion(mount: MountedReact): readonly (readonly [string | undefined, string, string])[] {
  return [...mount.container.querySelectorAll<HTMLElement>(".lottery-reveal__row")].map((row) => [
    row.dataset["motion"], row.style.getPropertyValue("--lottery-x"), row.style.getPropertyValue("--lottery-sx"),
  ] as const);
}

describe("LotteryReveal settle flight under a board scale", () => {
  function mountSettle(boardScale: number | undefined): MountedReact {
    const target = document.createElement("span");
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 80, 40));
    // The measured source is already the scaled, drawn box.
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 120, 80, 40));
    const props: LotteryRevealProps = boardScale === undefined ? lotteryProps("lottery-settle", target)
      : { ...lotteryProps("lottery-settle", target), boardScale };
    const mount = mountReact(createElement(LotteryReveal, props));
    mounted.push(mount);
    return mount;
  }

  it("divides the viewport translation by the board scale and keeps the measured size ratio", () => {
    expect(rowMotion(mountSettle(0.5))).toEqual([["flight", "-160px", "1"], ["flight", "-160px", "1"]]);
  });

  it.each([undefined, 1, 0, Number.NaN, -2])("treats board scale %s as unscaled", (boardScale) => {
    expect(rowMotion(mountSettle(boardScale))).toEqual([["flight", "-80px", "1"], ["flight", "-80px", "1"]]);
  });
});

describe("TurnMomentHost lottery board fit", () => {
  let pillTop = 204;

  function mountLotteryHost(height: number): { readonly mount: MountedReact; readonly card: () => HTMLElement } {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", height);
    const map = document.createElement("div");
    const panel = document.createElement("main");
    const pill = document.createElement("button");
    pill.className = TURN_RESULT_PILL_SELECTOR.slice(1);
    document.body.append(map, panel, pill);
    vi.spyOn(map, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 320, height));
    vi.spyOn(panel, "getBoundingClientRect").mockImplementation(() => new DOMRect(8, pillTop + 52, 304, height - pillTop - 60));
    vi.spyOn(pill, "getBoundingClientRect").mockImplementation(() => new DOMRect(8, pillTop, 124, 44));
    // Boxes report their drawn (scaled) size, as browsers do; the host must undo its own scale. The card box is
    // taller than the board by the collapsed margin, which must not count against the free space.
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLDivElement): DOMRect {
      const card = this.closest<HTMLElement>(".turn-moment-host__card");
      const scale: number = Number(card?.style.scale) || 1;
      if (this.classList.contains("turn-moment-host__card")) {
        return new DOMRect(0, 0, CARD.width * scale, CARD.height * scale);
      }
      if (this.classList.contains("lottery-reveal")) return new DOMRect(0, 0, BOARD_WIDTH_PX * scale, BOARD_HEIGHT_PX * scale);
      return new DOMRect(0, 0, 0, 0);
    });
    const mount = mountReact(createElement(TurnMomentHost, {
      lottery: lotteryProps("lottery-flip"),
      resolveMap: () => map, resolvePanel: () => panel, resolvePill: () => pill,
    }));
    mounted.push(mount);
    return { mount, card: () => mount.container.querySelector<HTMLElement>(".turn-moment-host__card")! };
  }

  beforeEach(() => {
    pillTop = 204;
  });

  it("scales the board into the space above the pill at 320x480 without clamping its height", () => {
    const { card } = mountLotteryHost(480);

    expect(Number(card().style.scale)).toBeCloseTo((204 - 56 - 1) / CARD.height, 10);
    expect(card().style.maxHeight).toBe("none");
    expect(card().style.visibility).toBe("");
  });

  it("keeps scale 1 where the drawn board fits even though the card box with its collapsed margin does not", () => {
    pillTop = 56 + BOARD_HEIGHT_PX + 1;
    const { card } = mountLotteryHost(568);

    expect(card().style.scale).toBe("1");
  });

  it("re-fits on the pill layout event and on card resize, settling back to 1 when space returns", () => {
    const { card } = mountLotteryHost(480);
    const fitted = Number(card().style.scale);

    pillTop = 180;
    act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
    expect(Number(card().style.scale)).toBeCloseTo((180 - 56 - 1) / CARD.height, 10);
    expect(Number(card().style.scale)).toBeLessThan(fitted);

    pillTop = 300;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(card().style.scale).toBe("1");

    act(() => FakeResizeObserver.instances.at(-1)?.trigger());
    expect(card().style.scale).toBe("1");
  });
});
