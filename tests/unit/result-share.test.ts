// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClearScreen } from "../../src/features/game/components/ClearScreen";
import type { GameState } from "../../src/types/network";
import { EDITIONS } from "../../src/features/editions/registry";
import { FIXTURE_EDITION_A } from "./fixtures/editions";
import { buildShareText } from "../../src/features/game/shareText";
import { createResultShareActions } from "../../src/features/game/resultShareActions";
import type { RailwayNetwork } from "../../src/features/game/engine";
import type { PresentationResolver } from "../../src/features/game/presentationResolver";
import { act } from "react";
import { mountReact } from "./helpers/reactDom";

const display = EDITIONS[0]!.display;
const emptyNetwork = { stationsById: new Map() } as unknown as RailwayNetwork;
const presentation = { stationName: (id: string) => id } as unknown as PresentationResolver;
const game = {
  turn: 61,
  movementHistory: [],
  config: { startStationId: "shimbashi" },
} as unknown as GameState;

function mountClearScreen(actions: ReturnType<typeof createResultShareActions>) {
  return mountReact(createElement(ClearScreen, {
    game,
    network: emptyNetwork,
    presentation,
    display,
    shareActions: actions,
    saveStatus: "saved",
    onPlayAgain: vi.fn(),
    onShowTitle: vi.fn(),
  }));
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
}

const expectedText = "山手線すごろく 東京近郊版をクリア！\n所要ターン数 61・移動回数 0・乗換回数 0\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app";

describe("result share text", () => {
  it("builds the exact current edition text", () => {
    expect(buildShareText(display, { turns: 61, moves: 240, transfers: 35 })).toBe(
      "山手線すごろく 東京近郊版をクリア！\n所要ターン数 61・移動回数 240・乗換回数 35\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app",
    );
  });

  it("uses the supplied edition display", () => {
    expect(buildShareText(FIXTURE_EDITION_A.display, { turns: 2, moves: 5, transfers: 1 })).toBe(
      "Fixture A 試験版Aをクリア！\n所要ターン数 2・移動回数 5・乗換回数 1\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app",
    );
  });
});

describe("ClearScreen result sharing", () => {
  it("copies and reports success without showing the fallback field", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const mounted = mountClearScreen(createResultShareActions({ writeText }, undefined));
    await click(mounted.container.querySelector('button')!);
    expect(writeText).toHaveBeenCalledWith(expectedText);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe("結果をコピーしました");
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.cleanup();
  });

  it.each(["rejected clipboard", "missing clipboard"])("shows selectable text on %s", async (failureKind) => {
    const clipboard = failureKind === "missing clipboard"
      ? undefined
      : { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const mounted = mountClearScreen(createResultShareActions(clipboard, undefined));
    await click(mounted.container.querySelector("button")!);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe(
      "コピーできませんでした。下の文面を選択してコピーしてください。",
    );
    const textarea = mounted.container.querySelector("textarea");
    expect(textarea?.readOnly).toBe(true);
    expect(textarea?.value).toBe(expectedText);
    expect(mounted.container.querySelector('label[for="clear-share-text"]')?.textContent).toBe("共有する結果");
    mounted.cleanup();
  });

  it("hides share when unavailable and shows it when supported", () => {
    const unavailable = mountClearScreen(createResultShareActions(undefined, undefined));
    expect(unavailable.container.querySelector('button[aria-label="共有"]')).toBeNull();
    expect([...unavailable.container.querySelectorAll("button")].some((button) => button.textContent === "共有")).toBe(false);
    unavailable.cleanup();

    const share = vi.fn().mockResolvedValue(undefined);
    const available = mountClearScreen(createResultShareActions(undefined, { share }));
    expect([...available.container.querySelectorAll("button")].some((button) => button.textContent === "共有")).toBe(true);
    available.cleanup();
  });

  it("hides share when canShare rejects the text", () => {
    const mounted = mountClearScreen(createResultShareActions(undefined, {
      share: vi.fn(),
      canShare: () => false,
    }));
    expect([...mounted.container.querySelectorAll("button")].some((button) => button.textContent === "共有")).toBe(false);
    mounted.cleanup();
  });

  it("shows no message when sharing is cancelled", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click([...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "共有")!);
    expect(mounted.container.querySelector('[role="status"]')).toBeNull();
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.cleanup();
  });

  it("shows selectable text when sharing fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("failed"));
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click([...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "共有")!);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe(
      "共有できませんでした。下の文面を選択してコピーしてください。",
    );
    expect(mounted.container.querySelector("textarea")?.value).toBe(expectedText);
    mounted.cleanup();
  });
});
