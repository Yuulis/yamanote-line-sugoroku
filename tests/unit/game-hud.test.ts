// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { GameHud } from "../../src/features/game/components/GameHud";
import type { GameHudProps } from "../../src/features/game/components/GameHud";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";

function props(overrides: Partial<GameHudProps> = {}): GameHudProps {
  return {
    station: "東京", ride: "山手線", lineBadge: { groupId: "jr-yamanote", code: "JY", color: "#80c241", name: "山手線", textColor: "#000000" },
    direction: "外回り", turn: 5, completed: 3, required: 30, roll: "3マス", saveStatus: null,
    saveStatusMessage: "未保存", canRoll: true, animating: false, draftSelected: false,
    rollButtonRef: createRef<HTMLButtonElement>(), onRoll: vi.fn(), onSkip: vi.fn(), effects: [], ...overrides,
  };
}

function Harness({ value }: { value: GameHudProps }): React.JSX.Element {
  return createElement(GameHud, value);
}

describe("GameHud", () => {
  it("renders six labelled stats, a separate badge and straight progress bar", () => {
    const mount = mountReact(createElement(GameHud, props()));
    try {
      expect(mount.container.querySelectorAll(".game-panel__stats dt")).toHaveLength(6);
      expect(mount.container.querySelector("[data-stat=ride]")?.textContent).toBe("山手線");
      expect(mount.container.querySelector("[data-stat=ride]")?.previousElementSibling?.classList.contains("line-badge")).toBe(true);
      expect(mount.container.querySelector("[data-stat=progress]")?.nextElementSibling?.getAttribute("role")).toBe("progressbar");
      expect(mount.container.querySelector("[role=progressbar]")?.getAttribute("aria-valuemax")).toBe("30");
      expect(mount.container.querySelectorAll("[role=status]")).toHaveLength(0);
    } finally {
      mount.cleanup();
    }
  });

  it("keeps the three dice labels exact and suppresses clicks while moving", () => {
    const onRoll = vi.fn();
    const initial = props({ onRoll });
    const mount = mountReact(createElement(Harness, { value: initial }));
    try {
      const button = mount.container.querySelector<HTMLButtonElement>(".game-panel__roll")!;
      expect(initial.rollButtonRef.current).toBe(button);
      expect(button.textContent).toBe("サイコロを振る");
      expect(button.classList.contains("button-cta")).toBe(true);
      dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).toHaveBeenCalledTimes(1);
      act(() => mount.root.render(createElement(Harness, { value: { ...initial, canRoll: false, animating: true } })));
      expect(button.textContent).toBe("移動中…");
      expect(button.getAttribute("aria-disabled")).toBe("true");
      dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).toHaveBeenCalledTimes(1);
      act(() => mount.root.render(createElement(Harness, { value: { ...initial, canRoll: false, draftSelected: true } })));
      expect(button.textContent).toBe("この内容でサイコロを振る");
    } finally {
      mount.cleanup();
    }
  });

  it("shows full save text, hiding only the successful indicator label", () => {
    const saved = mountReact(createElement(GameHud, props({ saveStatus: "saved", saveStatusMessage: "自動保存済み" })));
    const failed = mountReact(createElement(GameHud, props({ saveStatus: "failed", saveStatusMessage: "保存に失敗しました（この進行は未保存です）" })));
    const unavailable = mountReact(createElement(GameHud, props({ saveStatus: "unavailable", saveStatusMessage: "この環境では保存できません" })));
    const empty = mountReact(createElement(GameHud, props({ saveStatus: null, saveStatusMessage: "未保存" })));
    try {
      expect(saved.container.querySelector(".game-panel__save")?.querySelector(".visually-hidden")?.textContent).toBe("セーブ: 自動保存済み");
      expect(saved.container.querySelector(".game-panel__save")?.getAttribute("title")).toBe("セーブ: 自動保存済み");
      expect(saved.container.querySelector(".game-panel__save svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(failed.container.querySelector(".game-panel__save")?.textContent).toContain("セーブ: 保存に失敗しました");
      expect(failed.container.querySelector(".game-panel__save--warning")).not.toBeNull();
      expect(unavailable.container.querySelector(".game-panel__save")?.textContent).toContain("この環境では保存できません");
      expect(empty.container.querySelector(".game-panel__save")?.textContent).toBe("セーブ: 未保存");
      for (const mount of [saved, failed, unavailable, empty]) {
        expect(mount.container.querySelector(".game-panel__save")?.hasAttribute("role")).toBe(false);
      }
    } finally {
      for (const mount of [saved, failed, unavailable, empty]) mount.cleanup();
    }
  });
});
