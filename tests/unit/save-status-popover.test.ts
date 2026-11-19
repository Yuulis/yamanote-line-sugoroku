// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveStatusPopover, placeSaveStatus } from "../../src/features/game/components/SaveStatusPopover";
import { saveStatusPresentation } from "../../src/features/game/saveStatusPresentation";
import type { SaveWriteResult } from "../../src/features/game/store/persistence";
import { flushReact, mountReact, type MountedReact } from "./helpers/reactDom";

const mounted: MountedReact[] = [];
const popoverNames = ["showPopover", "hidePopover", "togglePopover"] as const;
afterEach(() => mounted.splice(0).forEach((mount) => mount.cleanup()));

function mountPopover(status: SaveWriteResult | null = "saved"): MountedReact {
  const mount = mountReact(createElement("div", null,
    createElement(SaveStatusPopover, {
      status,
      wrapper: (trigger) => createElement("p", { className: "wrapper" }, trigger),
      children: "icon",
    }),
    createElement("button", { className: "elsewhere" }, "other")));
  mounted.push(mount);
  return mount;
}

/** Runs `body` with the Popover API removed (inline fallback) or stubbed (native path). */
async function withPopoverApi(stub: { show: () => void; hide: () => void } | null, body: () => void | Promise<void>): Promise<void> {
  const saved = popoverNames.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
  for (const name of popoverNames) Reflect.deleteProperty(HTMLElement.prototype, name);
  if (stub) {
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: stub.show });
    Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: stub.hide });
  }
  try {
    await body();
  } finally {
    mounted.splice(0).forEach((mount) => mount.cleanup());
    popoverNames.forEach((name, index) => {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    });
  }
}

const escapeKey = (): KeyboardEvent => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

describe("save status popover", () => {
  it("models all four statuses", () => {
    expect(saveStatusPresentation("saved").explanation).toBe("自動保存済みです。ページを閉じても、タイトルの「つづきから」で再開できます。");
    expect(saveStatusPresentation("failed").explanation).toBe("保存に失敗しました。この進行は未保存です。");
    expect(saveStatusPresentation("unavailable").explanation).toBe("この環境では保存できません。ページを閉じると進行は失われます。");
    expect(saveStatusPresentation(null).explanation).toBe("未保存です。まだ保存の完了を確認できていません。");
    expect(["saved", "failed", "unavailable", null].map((status) => saveStatusPresentation(status as SaveWriteResult | null).tone))
      .toEqual(["saved", "warning", "warning", "unsaved"]);
  });

  it("opens and dismisses native popover by keyboard", async () => {
    const show = vi.fn();
    const hide = vi.fn();
    await withPopoverApi({ show, hide }, () => {
      const mount = mountPopover();
      const trigger = mount.container.querySelector<HTMLButtonElement>("button.save-status__trigger")!;
      const popover = mount.container.querySelector<HTMLElement>(".save-status__popover")!;
      expect(popover.getAttribute("popover")).toBe("auto");
      expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
      act(() => trigger.focus());
      act(() => trigger.click());
      expect(show).toHaveBeenCalledTimes(1);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(popover.textContent).toContain("自動保存済みです");
      act(() => { trigger.dispatchEvent(escapeKey()); });
      expect(hide).toHaveBeenCalledTimes(1);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("supports inline fallback and restores trigger focus", async () => {
    await withPopoverApi(null, () => {
      const mount = mountPopover("failed");
      const trigger = mount.container.querySelector<HTMLButtonElement>(".save-status__trigger")!;
      const popover = mount.container.querySelector<HTMLElement>(".save-status__popover")!;
      expect(popover.hasAttribute("popover")).toBe(false);
      expect(popover.hidden).toBe(true);
      act(() => trigger.click());
      expect(popover.hidden).toBe(false);
      expect(popover.contains(document.activeElement)).toBe(true);
      act(() => popover.querySelector<HTMLButtonElement>(".save-status__close")!.click());
      expect(popover.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
      act(() => trigger.click());
      const text = popover.querySelector<HTMLElement>(".save-status__text")!;
      expect(popover.getAttribute("aria-describedby")).toBe(text.id);
      act(() => trigger.click());
      act(() => { popover.dispatchEvent(escapeKey()); });
      expect(popover.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("renders explanation outside the given wrapper", async () => {
    await withPopoverApi(null, () => {
      const mount = mountPopover();
      const wrapper = mount.container.querySelector<HTMLElement>(".wrapper")!;
      const popover = mount.container.querySelector<HTMLElement>(".save-status__popover")!;
      expect(wrapper.querySelector(".save-status__trigger")).not.toBeNull();
      expect(wrapper.contains(popover)).toBe(false);
      expect(wrapper.textContent).toBe("icon");
      expect(wrapper.nextElementSibling).toBe(popover);
    });
  });

  it("closes without restoring focus when a modal opens", async () => {
    await withPopoverApi(null, async () => {
      const mount = mountPopover();
      const trigger = mount.container.querySelector<HTMLButtonElement>(".save-status__trigger")!;
      act(() => trigger.click());
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const modal = document.createElement("dialog");
      const modalButton = document.createElement("button");
      modal.append(modalButton);
      document.body.append(modal);
      act(() => { modal.setAttribute("open", ""); modalButton.focus(); });
      await flushReact();
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(modalButton);
      modal.remove();
    });
  });

  it("focuses the close button on open so Enter closes it and returns focus to the trigger", async () => {
    await withPopoverApi(null, () => {
      const mount = mountPopover();
      const trigger = mount.container.querySelector<HTMLButtonElement>(".save-status__trigger")!;
      const close = mount.container.querySelector<HTMLButtonElement>(".save-status__close")!;
      act(() => trigger.click());
      expect(document.activeElement).toBe(close);
      act(() => close.click());
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("re-clamps the native placement when the viewport changes while open", async () => {
    const viewportSize = { width: window.innerWidth, height: window.innerHeight };
    await withPopoverApi({ show: vi.fn(), hide: vi.fn() }, () => {
      const mount = mountPopover();
      const trigger = mount.container.querySelector<HTMLButtonElement>(".save-status__trigger")!;
      const popover = mount.container.querySelector<HTMLElement>(".save-status__popover")!;
      const box = (left: number, width: number, height: number) => (): DOMRect =>
        ({ top: 10, left, width, height, right: left + width, bottom: 10 + height, x: left, y: 10, toJSON: () => ({}) });
      trigger.getBoundingClientRect = box(300, 16, 16);
      popover.getBoundingClientRect = box(0, 280, 80);
      Object.assign(window, { innerWidth: 320, innerHeight: 568 });
      act(() => trigger.click());
      expect(popover.style.left).toBe("32px");
      Object.assign(window, { innerWidth: 400, innerHeight: 568 });
      act(() => { window.dispatchEvent(new Event("resize")); });
      expect(popover.style.left).toBe("112px");
    }).finally(() => Object.assign(window, { innerWidth: viewportSize.width, innerHeight: viewportSize.height }));
  });

  it("clamps the placement inside the viewport", () => {
    const viewport = { width: 320, height: 568 };
    const size = { width: 280, height: 80 };
    const nearRight = placeSaveStatus({ top: 10, left: 300, width: 16, height: 16 }, size, viewport);
    expect(nearRight.left + size.width).toBeLessThanOrEqual(viewport.width);
    expect(nearRight.left).toBeGreaterThanOrEqual(0);
    expect(nearRight.top).toBeGreaterThan(10);
    const nearBottom = placeSaveStatus({ top: 540, left: 10, width: 16, height: 16 }, size, viewport);
    expect(nearBottom.top + size.height).toBeLessThanOrEqual(540);
  });
});
