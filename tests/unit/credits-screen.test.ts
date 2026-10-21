// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TitleScreen, formatAppVersion } from "../../src/features/game/components/TitleScreen";
import { FIXTURE_EDITIONS } from "./fixtures/editions";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";

function titleScreen() {
  return createElement(TitleScreen, {
    manifest: null,
    network: null,
    display: FIXTURE_EDITIONS[0]!.display,
    saveLookup: null,
    unavailableReason: null,
    notice: null,
    onNewGame: vi.fn(),
    onResume: vi.fn(),
    onDeleteSave: vi.fn(),
  });
}

describe("TitleScreen credits", () => {
  it("opens with heading focus, shows the notice and issue link, and restores trigger focus", () => {
    const mounted = mountReact(titleScreen());
    const trigger = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "クレジット")!;
    dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
    const heading = mounted.container.querySelector("h1#credits-title");
    expect(document.activeElement).toBe(heading);
    expect(mounted.container.textContent).toContain("本作は非公式の個人制作ゲームで、各鉄道事業者・国土交通省とは関係ありません。");
    const issues = mounted.container.querySelector<HTMLAnchorElement>('a[href="https://github.com/Yuulis/yamanote-line-sugoroku/issues"]');
    expect(issues?.textContent).toContain("GitHub Issues");
    const back = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "タイトルへ戻る")!;
    dispatchReactEvent(back, new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement?.textContent).toBe(trigger.textContent);
    mounted.cleanup();
  });

  it("closes on Escape and formats app and data versions", () => {
    const mounted = mountReact(titleScreen());
    dispatchReactEvent(mounted.container.querySelector("button")!, new MouseEvent("click", { bubbles: true }));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(mounted.container.querySelector("#credits-title")).toBeNull();
    expect(formatAppVersion("0.9.0", "abc1234", "2026-10")).toEqual([
      "アプリ v0.9.0（abc1234）",
      "路線データ 2026-10",
    ]);
    expect(formatAppVersion("0.9.0", "abc1234")).toEqual(["アプリ v0.9.0（abc1234）"]);
    mounted.cleanup();
  });
});
