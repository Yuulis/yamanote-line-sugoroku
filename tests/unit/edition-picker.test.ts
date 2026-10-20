// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditionPicker } from "../../src/features/game/components/EditionPicker";
import { FIXTURE_EDITIONS } from "./fixtures/editions";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";

describe("EditionPicker", () => {
  it("renders no control for one edition", () => {
    const mounted = mountReact(createElement(EditionPicker, {
      editions: [FIXTURE_EDITIONS[0]!], value: "fixture-a", onChange: vi.fn(),
    }));
    expect(mounted.container.querySelector("select")).toBeNull();
    mounted.cleanup();
  });

  it("renders a labeled native select and reports a changed ID", () => {
    const onChange = vi.fn();
    const mounted = mountReact(createElement(EditionPicker, {
      editions: FIXTURE_EDITIONS, value: "fixture-a", onChange,
    }));
    const select = mounted.container.querySelector("select")!;
    expect(mounted.container.querySelector(`label[for="${select.id}"]`)?.textContent).toBe("遊ぶ版");
    expect([...select.options].map((option) => option.textContent)).toEqual(["試験版A", "試験版B"]);
    select.value = "fixture-b";
    dispatchReactEvent(select, new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("fixture-b");
    mounted.cleanup();
  });
});
